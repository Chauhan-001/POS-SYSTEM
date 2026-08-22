/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PublicStoreOrderService — customer-facing menu + cart validation + order
 * submission for online ordering. The customer WEBSITE UI is a separate
 * surface; this is the backend contract it consumes.
 *
 * Authoritative rules:
 *   - Availability comes from MenuAvailability (branch override → restaurant
 *     default → AVAILABLE). Inventory stock is NEVER consulted.
 *   - Prices are read server-side (Product price + branchPrice override).
 *   - Totals are computed server-side; the client's numbers are ignored.
 *   - Order submission re-validates every line: a stale cart (item disabled
 *     after it was added) gets a 409 with the unavailable subset, never a
 *     silent order or silently changed total.
 *   - Idempotency: optional clientRef → { restaurantId, clientRef } unique
 *     index (mirrors Bill.clientRef) so replays cannot duplicate orders.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import Branch from '../../../models/Branch';
import BranchSettings from '../../../models/BranchSettings';
import Table from '../../../models/Table';
import KOTRecord from '../../../models/KOTRecord';
import Offer from '../../../models/Offer';
import Promotion from '../../promotions/models/Promotion';
import QrToken from '../../qr-ordering/models/QrToken';
import CustomerRequest from '../../qr-ordering/models/CustomerRequest';
import QROrderingSession from '../../qr-ordering/models/QROrderingSession';
// Import the service directly (NOT the settings barrel index.ts — it
// re-exports model types like IPrinter as values, which blows up the ESM
// boot under tsx with "does not provide an export named 'IPrinter'").
import { settingsService } from '../../settings/services/settingsService';
import { resolveRestaurantByToken } from './publicStoreService';
import { availabilityService } from '../../../services/availabilityService';
import { resolveMenuProductScope } from '../../../services/productService';
import { offerValidationService } from '../../../services';
import { friendlyOfferReason } from '../../../services/offerValidationService';
import { orderRepo, orderItemRepo, timelineEventRepo } from '../../../repositories';
import { AppError } from '../../../utils/AppError';
import ConfigurationTemplate from '../../menu-config/models/ConfigurationTemplate';
import { resolveGroup, ResolvedProductConfiguration, ResolvedConfigGroup } from '../../menu-config/services/configurationResolver';
import { validateProductConfigurationSelection } from '../../menu-config/services/configurationValidator';
import { calculateLineItemPrice, summarizeSelection } from '../../menu-config/services/pricingEngine';

export interface PublicCartItem {
  productId: string;
  quantity: number;
  /** Phase 4 — configured selections (variants/modifiers/add-ons). The server
   *  re-validates and re-prices these authoritatively; never trusted as-is. */
  configuration?: { selections: Array<{ groupId: string; optionIds: string[]; quantities?: Record<string, number> }> };
}

/** Order statuses that mean the table is no longer occupied. */
const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'];

/**
 * How long a scanned-but-not-yet-ordered table stays reserved for its guest.
 * Heartbeats (cart activity / page open) keep extending it; an abandoned scan
 * expires after this window and the table frees up for the next guest.
 */
const TABLE_CLAIM_TTL_MS = 10 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class PublicStoreOrderService {
  /**
   * Resolve a branch id from the request body when provided; also enforce the
   * branch's online-ordering module toggle when a BranchSettings row exists.
   */
  private async resolveBranch(restaurantId: mongoose.Types.ObjectId, branchId?: string): Promise<mongoose.Types.ObjectId | null> {
    if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) return null;
    const oid = new mongoose.Types.ObjectId(branchId);
    // Branch must belong to this restaurant (tenant isolation).
    const branch = await Branch.findOne({ _id: oid, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!branch) throw new AppError(400, 'Invalid branch');
    // Respect the branch-level online-ordering toggle.
    const settings = await BranchSettings.findOne({ branchId: oid }).lean().exec();
    if (settings?.moduleSettings && (settings as any).moduleSettings.enableOnlineOrders === false) {
      throw new AppError(403, 'Online ordering is disabled for this location');
    }
    return oid;
  }

  /** Product price for the given branch (branchPrice override → base price). */
  private priceFor(product: any, branchId: mongoose.Types.ObjectId | null): number {
    const base = Number(product.price) || 0;
    if (branchId && product.branchPrice) {
      const override = Number(product.branchPrice.get?.(branchId.toString()) ?? product.branchPrice[branchId.toString()]);
      if (Number.isFinite(override) && override > 0) return override;
    }
    return base;
  }

  /** Customer-safe group projection: names, selection rules and option prices.
   *  groupId is included because the server re-validates selections against it
   *  (the customer only ever sends ids the server handed out). */
  private customerGroups(groups: ResolvedConfigGroup[]): Array<{
    id: string;
    name: string;
    type: string;
    required: boolean;
    selectionMode: string;
    minSelections: number;
    maxSelections: number | null;
    freeSelectionCount: number;
    options: Array<{ id: string; name: string; priceDelta: number; price?: number; active: boolean; minQuantity?: number; maxQuantity?: number }>;
  }> {
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      required: g.required,
      selectionMode: g.selectionMode,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      freeSelectionCount: g.freeSelectionCount,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: o.priceDelta ?? 0,
        price: o.price,
        active: o.active !== false,
        minQuantity: o.minQuantity,
        maxQuantity: o.maxQuantity,
      })),
    }));
  }

  /**
   * Phase 4 — batch-resolve the reusable menu configuration for a set of menu
   * products (ONE template query + the PURE resolver core — same engine the
   * POS uses). Returns id → ResolvedProductConfiguration for configured
   * products only. Never touches another tenant's templates.
   */
  private async resolveMenuConfigs(rid: mongoose.Types.ObjectId, products: any[]): Promise<Map<string, ResolvedProductConfiguration>> {
    const out = new Map<string, ResolvedProductConfiguration>();
    const refsByProduct = new Map<string, Array<{ ref: any; type: string }>>();
    const wanted = new Set<string>();
    for (const p of products) {
      const cfg = (p as any).menuConfig ?? { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
      const refs = [
        ...(cfg.variantConfigurations ?? []).map((r: any) => ({ ref: r, type: 'VARIANT_GROUP' as const })),
        ...(cfg.modifierConfigurations ?? []).map((r: any) => ({ ref: r, type: 'MODIFIER_GROUP' as const })),
        ...(cfg.addOnConfigurations ?? []).map((r: any) => ({ ref: r, type: 'ADD_ON_GROUP' as const })),
      ].filter(({ ref }) => ref && ref.templateId);
      if (refs.length === 0) continue;
      refsByProduct.set(String(p._id), refs);
      for (const { ref } of refs) wanted.add(String(ref.templateId));
    }
    if (refsByProduct.size === 0) return out;

    const templates = await ConfigurationTemplate.find({
      _id: { $in: Array.from(wanted).filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) },
      restaurantId: rid,
      status: 'active',
    }).lean().exec();
    const templatesById = new Map<string, any>();
    for (const t of templates) templatesById.set(String(t._id), t);

    for (const [pid, refs] of refsByProduct.entries()) {
      const product = products.find((p: any) => String(p._id) === pid);
      if (!product) continue;
      const variantGroups: ResolvedConfigGroup[] = [];
      const modifierGroups: ResolvedConfigGroup[] = [];
      const addOnGroups: ResolvedConfigGroup[] = [];
      for (const { ref, type } of refs) {
        const template = templatesById.get(String(ref.templateId));
        if (!template || template.status === 'archived') continue;
        const group = resolveGroup(template, ref as any);
        if (type === 'VARIANT_GROUP') variantGroups.push(group);
        else if (type === 'MODIFIER_GROUP') modifierGroups.push(group);
        else addOnGroups.push(group);
      }
      // No ref resolved (missing / archived / another tenant's template): the
      // product behaves like a simple item — never surface an empty config.
      if (variantGroups.length + modifierGroups.length + addOnGroups.length === 0) continue;
      const configVersion = [...variantGroups, ...modifierGroups, ...addOnGroups].reduce((max, g) => Math.max(max, g.version), 0);
      out.set(pid, {
        product: {
          id: pid,
          name: (product as any).name,
          baseProductPrice: Number((product as any).price) || 0,
          category: (product as any).category,
          availability: (product as any).availability !== false,
        },
        configVersion,
        variantGroups,
        modifierGroups,
        addOnGroups,
      });
    }
    return out;
  }

  /**
   * GET /api/public-store/:token/menu — the customer menu with effective
   * online availability. Unavailable items are still listed (available:false)
   * so the site can render SOLD OUT; ?availableOnly=1 filters them out.
   */
  async getMenu(publicToken: string, options: { branchId?: string; availableOnly?: boolean } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);

    // Own products only; shared/global catalog only as fresh-account fallback
    // when the restaurant owns zero products (never another tenant's rows).
    const scope = await resolveMenuProductScope(String(rid));
    const products = await Product.find({
      $or: scope,
      type: 'menu',
      isDeleted: { $ne: true },
    })
      .sort({ category: 1, name: 1 })
      .lean()
      .exec();

    const productIds = products.map((p: any) => String(p._id));
    const availability = await availabilityService.getMap(rid.toString(), branchOid ? branchOid.toString() : null, productIds);

    // Phase 4 — same menu configuration source as the POS: resolve reusable
    // variant/modifier/add-on groups for every configured menu item in one
    // batch, so the customer site renders exactly what the cashier sees.
    const resolvedConfigs = await this.resolveMenuConfigs(rid, products);

    const byCategory = new Map<string, any[]>();
    for (const p of products) {
      const state = availability.get(String(p._id)) || { status: 'AVAILABLE' as const, unavailableUntil: null, visibleOnSite: true };
      // Owner site-visibility control: visibleOnSite=false removes the item
      // from the customer website entirely (not even SOLD OUT).
      if (state.visibleOnSite === false) continue;
      const resolved = resolvedConfigs.get(String(p._id));
      const item = {
        id: String(p._id),
        name: (p as any).name,
        category: (p as any).category,
        price: this.priceFor(p, branchOid),
        gstPercent: (p as any).gstPercent ?? 5,
        image: (p as any).image || null,
        available: state.status === 'AVAILABLE',
        unavailableUntil: state.unavailableUntil || null,
        hasConfiguration: !!resolved,
        // Customer-safe projection — option prices + selection rules only,
        // never internal ids/versions beyond what selection requires.
        configuration: resolved
          ? {
              configVersion: resolved.configVersion,
              variantGroups: this.customerGroups(resolved.variantGroups),
              modifierGroups: this.customerGroups(resolved.modifierGroups),
              addOnGroups: this.customerGroups(resolved.addOnGroups),
            }
          : null,
      };
      if (options.availableOnly && !item.available) continue;
      const arr = byCategory.get(item.category) || [];
      arr.push(item);
      byCategory.set(item.category, arr);
    }

    return {
      store: {
        name: restaurant.brandName || restaurant.name,
        currency: restaurant.currency || 'INR',
        currencySymbol: '₹',
      },
      categories: Array.from(byCategory.entries()).map(([name, items]) => ({ name, items })),
      // Only count items actually listed (hidden products are excluded).
      totalItems: Array.from(byCategory.values()).reduce((n, items) => n + items.length, 0),
    };
  }

  /**
   * GET /api/public-store/:token/offers — customer-facing offer discovery.
   *
   * Returns ONLY offers that are genuinely usable right now (status active,
   * within start/end dates, matching today's schedule window, not exhausted
   * and allowed at the requesting branch). The payload is a safe customer
   * projection — never costs, margins, inventory or internal fields. Combo
   * offers resolve their items + savings so the site can render "Add Combo".
   */
  async getOffers(publicToken: string, options: { branchId?: string } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);
    const branchId = branchOid ? branchOid.toString() : undefined;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const day = now.getDay();

    const offers = await Offer.find({
      restaurantId: rid,
      status: 'active',
      isDeleted: { $ne: true },
    })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();

    // Resolve product names/prices/images for applicable + combo items in one
    // batch (tenant-scoped — never another restaurant's products).
    const wantedIds = new Set<string>();
    for (const o of offers as any[]) {
      for (const id of [...(o.applicableProductIds || []), ...(o.comboProductIds || [])] as string[]) {
        if (id && mongoose.Types.ObjectId.isValid(id)) wantedIds.add(String(id));
      }
    }
    const productById = new Map<string, any>();
    if (wantedIds.size > 0) {
      const wanted: string[] = Array.from(wantedIds);
      const products = await Product.find({
        _id: { $in: wanted.map((id: string) => new mongoose.Types.ObjectId(id)) },
        $or: [{ restaurantId: rid }, { restaurantId: null }],
        isDeleted: { $ne: true },
      }).lean().exec();
      for (const p of products) productById.set(String(p._id), p);
    }

    const live: any[] = [];
    for (const o of offers as any[]) {
      // ── Eligibility filters (mirror offerValidationService rules) ──
      if (o.startDate && o.startDate > today) continue;      // not started
      if (o.endDate && o.endDate < today) continue;           // expired
      if (Array.isArray(o.daysOfWeek) && o.daysOfWeek.length > 0 && !o.daysOfWeek.includes(day)) continue;
      if (typeof o.startHour === 'number' && typeof o.endHour === 'number') {
        if (hour < o.startHour || hour >= o.endHour) continue;
      }
      if (typeof o.maxUses === 'number' && o.maxUses > 0 && (o.currentUses || 0) >= o.maxUses) continue;
      // Branch scope: empty = all branches; otherwise must include the branch.
      if (Array.isArray(o.branchIds) && o.branchIds.length > 0) {
        if (!branchId || !o.branchIds.includes(branchId)) continue;
      }

      const comboProductIds: string[] = (o.comboProductIds || []).map(String);
      const applicableProductIds: string[] = (o.applicableProductIds || []).map(String);
      const comboItems = comboProductIds
        .map((id: string) => productById.get(id))
        .filter(Boolean)
        .map((p: any) => ({
          id: String(p._id),
          name: p.name,
          price: this.priceFor(p, branchOid),
          image: p.image || null,
        }));
      const applicableProducts = applicableProductIds
        .map((id: string) => productById.get(id))
        .filter(Boolean)
        .map((p: any) => ({
          id: String(p._id),
          name: p.name,
          price: this.priceFor(p, branchOid),
          image: p.image || null,
        }));

      const comboIndividualValue = comboItems.reduce((s: number, it: any) => s + (Number(it.price) || 0), 0);
      const comboPrice = Number(o.comboPrice) || (o.type === 'combo' ? Number(o.value) || 0 : 0);

      live.push({
        id: String(o._id),
        type: o.type,
        title: o.title,
        description: o.description || '',
        shortDescription: o.shortDescription || '',
        couponCode: o.couponCode || null,
        value: o.value,
        discountDisplay: this.discountDisplay(o),
        minimumOrderValue: o.minOrderValue || 0,
        maximumDiscount: o.maxDiscount || null,
        applicableProducts,
        applicableCategories: o.applicableCategories || [],
        comboItems,
        comboPrice,
        customerSavings: o.type === 'combo' && comboPrice > 0 ? Math.max(0, round2(comboIndividualValue - comboPrice)) : null,
        validFrom: o.startDate || null,
        validUntil: o.endDate || null,
        daysOfWeek: o.daysOfWeek || [],
        startTime: typeof o.startHour === 'number' ? `${String(o.startHour).padStart(2, '0')}:00` : null,
        endTime: typeof o.endHour === 'number' ? `${String(o.endHour).padStart(2, '0')}:00` : null,
        imageUrl: o.imageUrl || null,
        terms: this.terms(o, comboPrice),
      });
    }

    return { store: { name: restaurant.brandName || restaurant.name }, offers: live };
  }

  /**
   * GET /api/public-store/:token/promotions — published Promotion Studio
   * creatives the customer can see. Only SAFE presentation fields are exposed
   * (title, subtitle, description, CTA, image, colors, language, template),
   * and only when the linked offer is genuinely live right now — an expired,
   * cancelled or not-yet-started offer never surfaces its creative.
   *
   * The customer still applies/validates the offer through the existing
   * public offer check/order endpoints — the creative is presentation only.
   */
  async getPromotions(publicToken: string, options: { branchId?: string } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);
    const branchId = branchOid ? branchOid.toString() : undefined;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const day = now.getDay();

    const promos = await Promotion.find({
      restaurantId: rid,
      status: 'published',
      isDeleted: { $ne: true },
      publishedAt: { $ne: null },
    }).sort({ publishedAt: -1 }).lean().exec();

    const offerIds = [...new Set(promos.map((p) => String(p.offerId)))];
    const offers = offerIds.length
      ? await Offer.find({
        _id: { $in: offerIds.map((id) => new mongoose.Types.ObjectId(id)) },
        restaurantId: rid,
        isDeleted: { $ne: true },
      }).lean().exec()
      : [];
    const offerById = new Map(offers.map((o) => [String(o._id), o]));

    const live: any[] = [];
    for (const p of promos) {
      const o = offerById.get(String(p.offerId));
      if (!o) continue;
      // Same eligibility filters as getOffers — never show a stale creative.
      if (o.status !== 'active') continue;
      if (o.startDate && o.startDate > today) continue;
      if (o.endDate && o.endDate < today) continue;
      if (Array.isArray(o.daysOfWeek) && o.daysOfWeek.length > 0 && !o.daysOfWeek.includes(day)) continue;
      if (typeof o.startHour === 'number' && typeof o.endHour === 'number') {
        if (hour < o.startHour || hour >= o.endHour) continue;
      }
      if (typeof o.maxUses === 'number' && o.maxUses > 0 && (o.currentUses || 0) >= o.maxUses) continue;
      if (Array.isArray(o.branchIds) && o.branchIds.length > 0) {
        if (!branchId || !o.branchIds.includes(branchId)) continue;
      }
      if (Array.isArray(p.channels) && p.channels.length > 0 && !p.channels.includes('website') && !p.channels.includes('qr')) continue;

      live.push({
        id: String(p._id),
        name: p.name,
        templateId: p.templateId,
        creative: {
          title: p.creative.title || o.title,
          subtitle: p.creative.subtitle || '',
          description: p.creative.description || o.shortDescription || '',
          cta: p.creative.cta || 'Order Now',
          language: p.creative.language || 'en',
          colors: p.creative.colors || { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
          imageKey: p.creative.image?.key || null,
          imageSource: p.creative.image?.source || null,
          // Per-screen image overrides (template/screen id → media ref).
          // Consumers fall back to imageKey when a screen has no override.
          screenImages: p.creative.screenImages || {},
          logoKey: p.creative.logoKey || null,
          productImageKeys: p.creative.productImageKeys || [],
          layout: p.creative.layout || p.templateId,
        },
        // Link back to the SAME offer the existing checkout applies.
        offer: {
          id: String(o._id),
          title: o.title,
          type: o.type,
          discountDisplay: this.discountDisplay(o),
          minOrderValue: o.minOrderValue || 0,
          couponCode: o.couponCode || null,
        },
        publishedAt: p.publishedAt,
      });
    }

    return { store: { name: restaurant.brandName || restaurant.name }, promotions: live };
  }

  /** Customer-friendly discount label (display only — server math is authoritative). */
  private discountDisplay(offer: any): string {
    const v = Number(offer.value) || 0;
    switch (offer.type) {
      case 'percentage': return `${v}% OFF`;
      case 'flat': case 'cashback': case 'coupon': return `₹${v} OFF`;
      case 'bogo': return 'Buy 1 Get 1';
      case 'free_item': return offer.freeItemName ? `Free ${offer.freeItemName}` : 'Free item';
      case 'combo': return `Combo · ₹${Number(offer.comboPrice) || v}`;
      case 'reward_points': return `${v} reward points`;
      case 'festival': return `${v}% OFF`;
      default: return `${v}% OFF`;
    }
  }

  /** Human-readable plain-language terms built from offer rules (no rule jargon). */
  private terms(offer: any, comboPrice: number): string[] {
    const out: string[] = [];
    if (offer.type === 'combo' && comboPrice > 0) out.push(`Combo price ₹${Math.round(comboPrice)}`);
    if (offer.minOrderValue) out.push(`Valid on orders above ₹${Math.round(offer.minOrderValue)}`);
    if (offer.maxDiscount && offer.type === 'percentage') out.push(`Maximum discount ₹${Math.round(offer.maxDiscount)}`);
    if (offer.endDate) out.push(`Valid until ${offer.endDate}`);
    if (offer.daysOfWeek && offer.daysOfWeek.length > 0) {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      out.push(`Available on ${offer.daysOfWeek.map((d: number) => names[d]).join(', ')}`);
    }
    if (typeof offer.startHour === 'number' && typeof offer.endHour === 'number') {
      out.push(`Available ${offer.startHour}:00–${offer.endHour}:00`);
    }
    return out;
  }

  /**
   * Validate a cart WITHOUT creating anything. Used by the customer site
   * before submission so a stale cart surfaces immediately.
   */
  async precheck(publicToken: string, items: PublicCartItem[], options: { branchId?: string } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);
    const validated = await this.validateCart(rid, branchOid, items);

    return {
      ok: validated.unavailableItems.length === 0,
      items: validated.items,
      unavailableItems: validated.unavailableItems,
      subtotal: validated.subtotal,
      gst: validated.gst,
      grandTotal: validated.grandTotal,
    };
  }

  /**
   * POST /api/public-store/:token/offers/check — validate an offer against the
   * server-computed cart totals WITHOUT placing an order. The server derives
   * the subtotal from the cart (never trusts the client), validates eligibility
   * and returns the authoritative discount + adjusted totals. Used by the
   * customer cart for the one-tap apply experience.
   */
  async checkOffer(
    publicToken: string,
    body: {
      branchId?: string;
      items: PublicCartItem[];
      offerId?: string;
      couponCode?: string;
      customerPhone?: string;
    } = { items: [] },
  ) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, body.branchId);
    const validated = await this.validateCart(rid, branchOid, body.items || []);
    if (validated.unavailableItems.length > 0) {
      const err: any = new AppError(409, 'Some items in your order are no longer available');
      err.code = 'SOME_ITEMS_UNAVAILABLE';
      err.unavailableItems = validated.unavailableItems;
      throw err;
    }

    if (!body.offerId && !body.couponCode) {
      return {
        ok: false,
        reason: 'Select an offer to continue.',
        subtotal: validated.subtotal,
        gst: validated.gst,
        grandTotal: validated.grandTotal,
      };
    }

    const result = await offerValidationService.validate(String(rid), {
      offerId: body.offerId,
      couponCode: body.couponCode,
      customerPhone: body.customerPhone,
      billSubtotal: validated.subtotal,
      billItems: validated.items,
      branchId: branchOid ? branchOid.toString() : undefined,
    });
    if (!result.valid || !result.offer) {
      return {
        ok: false,
        valid: false,
        reason: friendlyOfferReason(result.reason),
        subtotal: validated.subtotal,
        gst: validated.gst,
        grandTotal: validated.grandTotal,
      };
    }

    const discount = round2(Math.max(0, Number(result.discount) || 0));
    const afterDiscount = round2(Math.max(0, validated.subtotal - discount));
    const grandTotal = round2(afterDiscount + validated.gst);
    return {
      ok: true,
      valid: true,
      offer: result.offer,
      discount,
      subtotal: validated.subtotal,
      afterDiscount,
      gst: validated.gst,
      grandTotal,
      savings: discount,
    };
  }

  /** Mark ACTIVE seat-claims on a table whose reservation has lapsed. */
  private async sweepExpiredClaims(tableOid: mongoose.Types.ObjectId): Promise<void> {
    await QROrderingSession.updateMany(
      { tableId: tableOid, status: 'ACTIVE', expiresAt: { $lt: new Date() } },
      { $set: { status: 'EXPIRED' } }
    ).exec();
  }

  /** Release every ACTIVE seat-claim on a table (order placed / bill closed). */
  async releaseTableClaims(tableOid: mongoose.Types.ObjectId | string): Promise<void> {
    const oid = typeof tableOid === 'string' && mongoose.Types.ObjectId.isValid(tableOid)
      ? new mongoose.Types.ObjectId(tableOid)
      : tableOid;
    if (!oid) return;
    await QROrderingSession.updateMany(
      { tableId: oid, status: 'ACTIVE' },
      { $set: { status: 'COMPLETED' } }
    ).exec();
  }

  /**
   * A table with a LIVE order is occupied — no new QR seating or order may
   * take it. This is the one shared check for BOTH the scan claim and the
   * order submission, so the same table can never end up with two live
   * orders (a POS first-KOT order + a customer QR order).
   */
  private async assertTableNotOccupied(tableOid: mongoose.Types.ObjectId): Promise<void> {
    const occupying = await orderRepo.findOne({
      tableId: String(tableOid),
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);
    if (occupying) {
      const err: any = new AppError(
        409,
        'This table already has an open order. Please ask your server to add more items.',
      );
      err.code = 'TABLE_ALREADY_OCCUPIED';
      throw err;
    }
  }

  /**
   * Atomically claim a table for one QR seating session.
   *
   * Rules (the correct behavior for concurrent scans and abandoned visits):
   *  - A table with a LIVE order is never handed out (POS or QR order).
   *  - The FIRST seating to claim wins — the unique ACTIVE-per-table index
   *    makes the claim atomic, so two guests scanning the same table cannot
   *    both hold it (no double orders later).
   *  - A re-claim from the SAME session (heartbeat, cart activity) just
   *    extends the reservation.
   *  - An abandoned scan (no order, no heartbeat) expires after the TTL and
   *    the table frees up for the next guest — it is never held forever.
   */
  async claimTable(
    rid: mongoose.Types.ObjectId,
    tableOid: mongoose.Types.ObjectId,
    sessionId: string,
    opts: { tableNumber?: number } = {},
  ): Promise<{ sessionId: string; tableId: string; tableNumber?: number; expiresAt: string; ttlMinutes: number }> {
    // Release abandoned claims first so a later guest can take the table
    // instead of being blocked forever by a scan that never ordered.
    await this.sweepExpiredClaims(tableOid);

    // A seating the RESTAURANT ended (POS "expire session") stays dead for
    // the current claim window — the guest must re-scan instead of silently
    // re-claiming the table the moment their next heartbeat fires. Only
    // CANCELLED blocks; a naturally EXPIRED claim may be re-claimed on
    // renewed activity (the guest is still there and active again).
    const endedByRestaurant = await QROrderingSession.findOne({
      tableId: tableOid,
      sessionId,
      status: 'CANCELLED',
      cancelledAt: { $gte: new Date(Date.now() - TABLE_CLAIM_TTL_MS) },
    }).lean().exec();
    if (endedByRestaurant) {
      const e: any = new AppError(
        409,
        'This seating session was ended by the restaurant. Please ask your server or re-scan the QR code.',
      );
      e.code = 'SESSION_ENDED_BY_RESTAURANT';
      throw e;
    }

    // A table with a live order is already occupied — never hand it to a new
    // seating, whether the order came from the POS cashier or a QR scan.
    await this.assertTableNotOccupied(tableOid);

    const expiresAt = new Date(Date.now() + TABLE_CLAIM_TTL_MS);
    try {
      // Upsert on { tableId, ACTIVE, sessionId }: the same session re-claims
      // its own document (extend); a different session's insert hits the
      // unique index and loses the table to the earlier guest.
      const claim = await QROrderingSession.findOneAndUpdate(
        { tableId: tableOid, status: 'ACTIVE', sessionId, restaurantId: rid },
        { $set: { orderType: 'TABLE', status: 'ACTIVE', expiresAt } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean().exec();
      // The scan now holds the table — flip it to Occupied so every POS
      // terminal sees the seating immediately (reconcileTable derives it
      // from this ACTIVE claim). Best-effort: a hiccup here must never fail
      // the claim itself.
      const { tableStateService } = await import('../../../services');
      await tableStateService
        .reconcileTable(String(tableOid), {
          restaurantId: String(rid),
          branchId: undefined,
          operator: 'Customer',
        })
        .catch(() => undefined);
      return {
        sessionId,
        tableId: String(tableOid),
        tableNumber: opts.tableNumber,
        expiresAt: ((claim as any)?.expiresAt || expiresAt).toISOString(),
        ttlMinutes: Math.round(TABLE_CLAIM_TTL_MS / 60000),
      };
    } catch (err: any) {
      if (err?.code === 11000) {
        const e: any = new AppError(
          409,
          'This table was just taken by another guest. Please ask your server to seat you.',
        );
        e.code = 'TABLE_ALREADY_CLAIMED';
        throw e;
      }
      throw err;
    }
  }

  /**
   * Customer-facing table claim (scan). Resolves the table tenant-safely and
   * atomically claims it for this seat session.
   */
  async claimForCustomer(
    publicToken: string,
    sessionId: string,
    tableId?: string,
    tableNumber?: number,
  ): Promise<{ sessionId: string; tableId: string; tableNumber?: number; expiresAt: string; ttlMinutes: number }> {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 6) {
      throw new AppError(400, 'sessionId is required');
    }
    const restaurant = await resolveRestaurantByToken(publicToken);
    if (!tableId || !mongoose.Types.ObjectId.isValid(tableId)) {
      throw new AppError(400, 'tableId is required');
    }
    const oid = new mongoose.Types.ObjectId(tableId);
    // Tenant isolation: a customer may only claim a table of THIS restaurant.
    const table = await Table.findOne({
      _id: oid,
      restaurantId: restaurant._id,
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!table) throw new AppError(404, 'Table not found');
    return this.claimTable(restaurant._id, oid, sessionId, { tableNumber });
  }

  /**
   * Final authoritative validation + order creation. Returns 409 (via AppError)
   * when any line is unavailable — the customer must resolve the cart first.
   *
   * `mode` / `tableId` / `parkingSlot` / `carPlate` carry the QR ordering
   * context (table / drive-in car / pickup counter) that the customer site
   * bakes into its QR URL; the server stores it on the Order so the POS knows
   * exactly where the customer is.
   */
  async createOrder(
    publicToken: string,
    body: {
      branchId?: string;
      items: PublicCartItem[];
      customer?: { name?: string; phone?: string };
      deliveryAddress?: string;
      notes?: string;
      /** QR ordering context (from the sticker URL). */
      mode?: 'TABLE' | 'CAR' | 'PICKUP';
      tableId?: string;
      tableNumber?: number;
      parkingSlot?: string;
      carPlate?: string;
      /** Optional gratuity — added to the grand total, stored separately. */
      tip?: number;
      /** Optional idempotency key — replays return the original order. */
      clientRef?: string;
      /** Stable per-scan seat session (claimed at scan time). */
      seatSessionId?: string;
      /** Phase B — offer the customer applied (validated server-side). */
      offerId?: string;
      couponCode?: string;
    }
  ) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, body.branchId);
    const tip = Math.max(0, Number(body.tip) || 0);
    const mode = body.mode || null;

    // Tenant-safe table context: a customer may only place an order for a
    // table that belongs to THIS restaurant (never another tenant's table).
    // Graceful degradation: a sticker for a deleted/missing table must not
    // lose the sale — the order proceeds without a table link instead.
    let tableOid: mongoose.Types.ObjectId | undefined;
    if (body.tableId && mongoose.Types.ObjectId.isValid(body.tableId)) {
      const table = await Table.findOne({
        _id: new mongoose.Types.ObjectId(body.tableId),
        restaurantId: rid,
        isDeleted: { $ne: true },
      }).lean().exec();
      if (table) tableOid = table._id;
    }

    // Re-run the authoritative availability check (never trust a precheck).
    const validated = await this.validateCart(rid, branchOid, body.items || []);
    if (validated.unavailableItems.length > 0) {
      const err: any = new AppError(409, 'Some items in your order are no longer available');
      err.code = 'SOME_ITEMS_UNAVAILABLE';
      err.unavailableItems = validated.unavailableItems;
      throw err;
    }

    // ── Phase B — offer application (server-authoritative) ───────────
    // The customer's offerId/couponCode is validated against the SERVER-computed
    // cart subtotal + items. The discount is added to the order totals; the
    // redemption is recorded after the order exists so usage caps stay exact.
    let appliedDiscount = 0;
    let appliedOfferResult: any = null;
    if (body.offerId || body.couponCode) {
      const vr = await offerValidationService.validate(String(rid), {
        offerId: body.offerId,
        couponCode: body.couponCode,
        customerPhone: body.customer?.phone,
        billSubtotal: validated.subtotal,
        billItems: validated.items,
        branchId: branchOid ? branchOid.toString() : undefined,
      });
      if (!vr.valid || !vr.offer) {
        throw new AppError(400, friendlyOfferReason(vr.reason));
      }
      appliedDiscount = round2(Math.max(0, Number(vr.discount) || 0));
      appliedOfferResult = vr;
    }

    // Idempotent replay: same restaurant + clientRef → return existing order.
    if (body.clientRef) {
      try {
        const existing = await orderRepo.findOne({ restaurantId: rid, clientRef: body.clientRef } as any);
        if (existing) {
          // Heal a partially-created order: if a previous attempt crashed
          // between order creation and the auto-KOT, create the missing KOT
          // now so the kitchen is never left blind.
          await this.ensureAutoKotAndOccupy(existing, validated.items, (existing as any).mode || mode, rid, branchOid);
          return { order: existing.toObject(), items: validated.items, idempotent: true };
        }
      } catch { /* unique index guards the race below */ }
    }

    // ONE order per seating: a table with a live (open) order is locked on
    // EVERY TABLE-mode submission — not only when a seat session is present,
    // because a direct order without seatSessionId/clientRef previously
    // skipped the occupancy check entirely and could land on a table the
    // cashier's first-KOT order already occupied (a double order). Replays of
    // the SAME clientRef are handled above (idempotent) and never reach here.
    if (mode === 'TABLE' && tableOid) {
      await this.assertTableNotOccupied(tableOid);
    }
    // The seat is claimed ATOMICALLY — the unique ACTIVE claim index lets
    // exactly one guest hold the table, so two people scanning the same table
    // concurrently can never both place an order here (the loser gets a clean
    // 409 instead of a double order).
    const seatSessionId = body.seatSessionId || body.clientRef;
    if (mode === 'TABLE' && tableOid && seatSessionId) {
      await this.claimTable(rid, tableOid, seatSessionId, {
        tableNumber: body.tableNumber,
      });
    }

    const { orderService } = await import('../../../services');
    const orderNumber = await orderService.getNextOrderNumber(1001, branchOid ? branchOid.toString() : undefined);

    // Grand total = subtotal + gst − offer discount + tip (all server-derived).
    const grandTotal = round2(validated.subtotal + validated.gst - appliedDiscount + tip);
    const originalGrandTotal = round2(validated.subtotal + validated.gst + tip);
    const orderData: any = {
      orderNumber,
      type: 'Website',
      platform: 'Website',
      status: 'New',
      restaurantId: rid,
      branchId: branchOid || undefined,
      customerPhone: body.customer?.phone || undefined,
      customerName: body.customer?.name || undefined,
      deliveryAddress: body.deliveryAddress || undefined,
      specialInstructions: body.notes || undefined,
      mode: mode || undefined,
      tableId: tableOid || undefined,
      tableNumber: body.tableNumber || undefined,
      parkingSlot: body.parkingSlot || undefined,
      carPlate: body.carPlate || undefined,
      tip,
      subtotal: validated.subtotal,
      discount: appliedDiscount,
      appliedOfferId: appliedOfferResult?.offer?.id || undefined,
      appliedOfferCode: body.couponCode || appliedOfferResult?.offer?.couponCode || undefined,
      gst: validated.gst,
      grandTotal,
      originalGrandTotal,
      adjustedGrandTotal: grandTotal,
      amountRefunded: 0,
      amountDueAdditional: 0,
      adjustmentStatus: 'NONE',
    };
    if (body.clientRef) orderData.clientRef = body.clientRef;

    let order: any;
    try {
      order = await orderRepo.create(orderData);
    } catch (err: any) {
      if (err?.code === 11000 && body.clientRef) {
        // Race lost on the unique clientRef — return the winning order.
        const existing = await orderRepo.findOne({ restaurantId: rid, clientRef: body.clientRef } as any);
        if (existing) {
          await this.ensureAutoKotAndOccupy(existing, validated.items, (existing as any).mode || mode, rid, branchOid);
          return { order: existing.toObject(), items: validated.items, idempotent: true };
        }
      }
      // A failed submission must not hold the table — release the seat claim
      // so the next guest can take it immediately.
      if (mode === 'TABLE' && tableOid) {
        await this.releaseTableClaims(tableOid).catch(() => undefined);
      }
      throw err;
    }

    // The order now owns the table — release the seat claim so the table can
    // be re-claimed the moment the bill is paid/closed (a stale ACTIVE claim
    // would otherwise block the next seating for the full claim TTL).
    if (mode === 'TABLE' && tableOid) {
      await this.releaseTableClaims(tableOid).catch(() => undefined);
    }

    // ── Record the offer redemption on the authoritative order ledger ──
    // Claims the usage slot atomically (TOCTOU-safe) + updates OfferAnalytics.
    // A redemption failure here fails the order creation (the customer simply
    // retries) so usage caps can never be silently exceeded.
    if (appliedOfferResult && appliedDiscount > 0) {
      try {
        await offerValidationService.recordApplication(String(rid), {
          offerId: appliedOfferResult.offer.id,
          code: appliedOfferResult.offer.couponCode,
          customerPhone: body.customer?.phone,
          billId: String(order._id),
          branchId: branchOid ? branchOid.toString() : undefined,
          discountAmount: appliedDiscount,
          salesAmount: validated.subtotal,
          redeemedBy: 'Customer',
        });
      } catch (err: any) {
        console.warn('[publicStore] offer redemption record failed:', err?.message);
        // The offer was validated a moment ago; on a true race (usage cap hit
        // between validate and claim) keep the order but drop the discount so
        // the customer is never charged less than the server allows.
        if (err instanceof AppError && /limit/i.test(err.message)) {
          await orderRepo.update(String(order._id), { discount: 0, grandTotal: originalGrandTotal, adjustedGrandTotal: originalGrandTotal, appliedOfferId: undefined, appliedOfferCode: undefined } as any).catch(() => undefined);
          appliedDiscount = 0;
        }
      }
    }

    // Every item is KOT'd immediately (auto-sent to the kitchen display) so
    // the cook starts the moment the customer orders — no cashier action
    // required. kotPrinted=true tells the POS these lines are already in the
    // kitchen, so a later manual "send KOT" computes an empty delta instead of
    // duplicating the ticket.
    // (discount may have been dropped by the redemption race-handling above)
    const finalGrandTotal = appliedDiscount > 0 ? grandTotal : originalGrandTotal;
    // Phase 4 — order lines preserve the configured selections + price evidence
    // exactly as validated (a menu change tomorrow never rewrites today's order).
    const itemDocs = validated.items.map((it: any) => ({
      orderId: order._id.toString(),
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      price: it.price,
      isFree: false,
      kotPrinted: true,
      configurationSnapshot: it.configurationSnapshot || undefined,
      configSummary: it.configSummary || undefined,
      pricingSnapshot: it.pricingSnapshot || undefined,
    }));
    if (itemDocs.length > 0) {
      await orderItemRepo.bulkCreate(itemDocs as any);
      await this.ensureAutoKotAndOccupy(order, validated.items, mode, rid, branchOid);
    }

    await timelineEventRepo.create({
      orderId: order._id.toString(),
      type: 'order_created',
      description: `Online order #${orderNumber} created`,
      actor: body.customer?.name || 'Customer',
    } as any);

    // Live push: POS terminals hear `order:created` instantly; the customer's
    // track page hears `order:updated` on the clientRef room.
    const { emitToRestaurant, emitToOrder } = await import('../../../socket');
    const createdPayload = {
      orderId: order._id.toString(),
      orderNumber,
      clientRef: body.clientRef || null,
      status: 'New',
      grandTotal: finalGrandTotal,
      discount: appliedDiscount,
      mode: body.mode || null,
      tableId: body.tableId || null,
      tableNumber: body.tableNumber || null,
      parkingSlot: body.parkingSlot || null,
      carPlate: body.carPlate || null,
      items: validated.items,
    };
    emitToRestaurant(rid, 'order:created', createdPayload);
    emitToOrder(body.clientRef, 'order:updated', { status: 'New', orderNumber });

    // Surface the online order in the POS "Calls" service-bell panel so
    // staff acknowledge + view EVERY customer order — nothing slips through
    // unnoticed. Best-effort: a failed request row must never fail the sale.
    try {
      const summary = validated.items
        .slice(0, 4)
        .map((it: any) => `${it.quantity}× ${it.productName}`)
        .join(', ');
      const request = await CustomerRequest.create({
        sessionId: `online_${order._id.toString()}`,
        restaurantId: rid,
        branchId: branchOid || undefined,
        orderType: (mode || 'TABLE') as any,
        tableId: tableOid,
        carId: body.parkingSlot || body.carPlate || undefined,
        type: 'ONLINE_ORDER',
        priority: 'HIGH',
        status: 'PENDING',
        orderId: order._id,
        orderNumber,
        message: `${summary}${validated.items.length > 4 ? ` +${validated.items.length - 4} more` : ''}`,
      });
      emitToRestaurant(rid, 'waiter:call', {
        id: (request as any)._id.toString(),
        type: 'ONLINE_ORDER',
        orderType: mode || 'TABLE',
        branchId: branchOid ? String(branchOid) : null,
        tableId: body.tableId || null,
        tableNumber: body.tableNumber || null,
        parkingSlot: body.parkingSlot || null,
        carPlate: body.carPlate || null,
        orderId: order._id.toString(),
        orderNumber,
        grandTotal,
        itemsCount: validated.items.reduce((n: number, it: any) => n + it.quantity, 0),
        message: (request as any).message || null,
        createdAt: (request as any).createdAt,
      });
    } catch (err) {
      console.warn('[publicStore] online-order call row skipped:', (err as Error)?.message);
    }

    return {
      order: (await orderService.getById(order._id.toString())),
      items: validated.items,
      idempotent: false,
    };
  }

  /**
   * Auto-KOT #1 (Original) for a placed online order — a persisted snapshot
   * the Kitchen Display renders via getById → kotRecords, FIFO by printedAt
   * (oldest first). Also occupies the table for TABLE-mode orders via the
   * server-authoritative TableStateService. Idempotent (skips when the KOT
   * already exists) and best-effort (a failure must never fail the order).
   */
  private async ensureAutoKotAndOccupy(
    order: any,
    items: any[],
    mode: string | null,
    rid: mongoose.Types.ObjectId,
    branchOid: mongoose.Types.ObjectId | null
  ) {
    if (!order?._id || items.length === 0) return;
    try {
      // Setting (default ON): whether an online order fires its KOT
      // automatically, or waits for the cashier to review the order in the
      // billing workspace and press KOT. Read fresh per order so a toggle
      // takes effect immediately — no cached copy to go stale.
      const autoKot = (await settingsService.getEffective(String(rid))).settings?.onlineOrderAutoKot !== false;
      if (autoKot) {
        const hasKot = await KOTRecord.exists({ orderId: order._id } as any);
        if (!hasKot) {
          await KOTRecord.create({
            orderId: order._id,
            kotNumber: 1,
            type: 'Original',
            status: 'Accepted',
            items: items.map((it: any) => ({
              productId: it.productId,
              lineId: it.productId,
              itemName: it.productName,
              quantity: it.quantity,
              price: it.price,
              configSummary: it.configSummary || undefined,
            })),
            printedBy: 'Customer',
            printedAt: new Date(),
            note: 'Auto-sent from online order',
          });
        }
      }
      if (mode === 'TABLE' && order.tableId) {
        const { tableStateService } = await import('../../../services');
        await tableStateService
          .reconcileTable(String(order.tableId), {
            restaurantId: String(rid),
            branchId: branchOid ? String(branchOid) : undefined,
            operator: 'Customer',
          })
          .catch(() => undefined);
      }
    } catch (err) {
      // The order itself is already persisted — never let a KOT hiccup 500
      // the sale (the cashier can still send it from the POS manually).
      console.warn('[publicStore] auto-KOT skipped:', (err as Error)?.message);
    }
  }

  /**
   * GET /api/public-store/:token/orders/:clientRef — track a placed order by
   * its idempotency key. Tenant-scoped (never returns another restaurant's
   * order) and deliberately minimal: status, totals, items, timeline.
   */
  async trackOrder(publicToken: string, clientRef: string) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;

    const order = await orderRepo.findOne({ restaurantId: rid, clientRef } as any);
    if (!order) throw new AppError(404, 'Order not found');

    const [items, timeline] = await Promise.all([
      orderItemRepo.findAll({ orderId: order._id.toString() } as any, { sort: { createdAt: 1 } }),
      timelineEventRepo.findAll({ orderId: order._id.toString() } as any, { sort: { createdAt: 1 } }),
    ]);

    return {
      order: {
        id: (order as any)._id.toString(),
        orderNumber: (order as any).orderNumber,
        status: (order as any).status,
        subtotal: (order as any).subtotal,
        discount: (order as any).discount || 0,
        gst: (order as any).gst,
        tip: (order as any).tip || 0,
        grandTotal: (order as any).grandTotal,
        mode: (order as any).mode || null,
        tableNumber: (order as any).tableNumber || null,
        parkingSlot: (order as any).parkingSlot || null,
        carPlate: (order as any).carPlate || null,
        createdAt: (order as any).createdAt,
        estimatedWaitMin: (order as any).deliveryEta || null,
      },
      items: (items as any).data || [],
      timeline: ((timeline as any).data || []).map((t: any) => ({
        type: t.type,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * POST /api/public-store/:token/requests — a customer service request
   * (call waiter / water / bill / assistance) from the QR ordering site.
   * Creates a tenant-scoped CustomerRequest that the POS service bell lists.
   */
  async createWaiterRequest(
    publicToken: string,
    body: {
      mode?: 'TABLE' | 'CAR' | 'PICKUP';
      branchId?: string;
      tableId?: string;
      parkingSlot?: string;
      carPlate?: string;
      name?: string;
      phone?: string;
      type?: 'water' | 'tissue' | 'bill' | 'assistance' | 'custom';
      message?: string;
    }
  ) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const mode = body.mode || 'TABLE';
    const reason = body.type || 'custom';

    const TYPE_MAP: Record<string, string> = {
      water: 'WATER',
      bill: 'BILL',
      assistance: 'ASSISTANCE',
      tissue: 'CLEANING',
      custom: 'CALL_WAITER',
    };

    const tableOid =
      body.tableId && mongoose.Types.ObjectId.isValid(body.tableId)
        ? new mongoose.Types.ObjectId(body.tableId)
        : undefined;

    // Branch isolation: derive the request's branch so a multi-branch POS
    // bell only sees its own location. Priority: explicit branchId (validated
    // to belong to this restaurant) → the table's branch (TABLE mode) → the
    // sticker's baked branch (QrToken). Never accept another tenant's branch.
    let branchOid: mongoose.Types.ObjectId | null = null;
    if (body.branchId && mongoose.Types.ObjectId.isValid(body.branchId)) {
      const branch = await Branch.findOne({ _id: body.branchId, restaurantId: rid, isDeleted: { $ne: true } }).lean().exec();
      if (!branch) throw new AppError(400, 'Invalid branch');
      branchOid = branch._id;
    } else if (tableOid) {
      const table = await Table.findOne({ _id: tableOid, restaurantId: rid, isDeleted: { $ne: true } }).lean().exec();
      if (table?.branchId) branchOid = table.branchId;
    }
    if (!branchOid) {
      // Sticker fallback: QrToken.token is the opaque `qr_…` capability, while
      // the public `pbl_…` token lives inside the generated url — so match by
      // url, still tenant-scoped to this restaurant.
      const tokenRow = await QrToken.findOne({
        url: new RegExp(publicToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        restaurantId: rid,
        active: { $ne: false },
      }).lean().exec();
      if (tokenRow?.branchId) branchOid = tokenRow.branchId;
    }

    const request = await CustomerRequest.create({
      sessionId: `pub_${publicToken.slice(0, 12)}_${mode}_${tableOid || body.parkingSlot || body.carPlate || 'guest'}`,
      restaurantId: rid,
      branchId: branchOid || undefined,
      orderType: mode,
      tableId: tableOid,
      carId: body.parkingSlot || body.carPlate || undefined,
      customer: { name: body.name, phone: body.phone },
      type: (TYPE_MAP[reason] || 'CALL_WAITER') as any,
      priority: 'MEDIUM',
      status: 'PENDING',
      message: body.message,
    });

    // Live push: POS service bell hears `waiter:call` immediately.
    const { emitToRestaurant } = await import('../../../socket');
    emitToRestaurant(rid, 'waiter:call', {
      id: (request as any)._id.toString(),
      type: (request as any).type,
      orderType: mode,
      branchId: branchOid ? String(branchOid) : null,
      tableId: body.tableId || null,
      parkingSlot: body.parkingSlot || null,
      carPlate: body.carPlate || null,
      message: body.message || null,
      createdAt: (request as any).createdAt,
    });

    return { request };
  }

  /**
   * Shared authoritative cart validation: availability + price + totals.
   */
  private async validateCart(
    rid: mongoose.Types.ObjectId,
    branchOid: mongoose.Types.ObjectId | null,
    items: PublicCartItem[]
  ) {
    // Per-line validation: two lines of the SAME product with DIFFERENT
    // configurations are distinct items — never merge them into one qty.
    const list = items || [];
    for (const it of list) {
      if (!mongoose.Types.ObjectId.isValid(it.productId)) throw new AppError(400, `Invalid product id: ${it.productId}`);
      const qty = Math.max(1, Number(it.quantity) || 1);
      if (qty > 999) throw new AppError(400, `Quantity too large for ${it.productId}`);
      if (it.configuration != null && !Array.isArray(it.configuration.selections)) {
        throw new AppError(400, `Invalid configuration for ${it.productId}`);
      }
    }

    const productIds = Array.from(new Set(list.map((i) => i.productId)));
    const products = await Product.find({
      _id: { $in: productIds.map((p) => new mongoose.Types.ObjectId(p)) },
      $or: [{ restaurantId: rid }, { restaurantId: null }],
      isDeleted: { $ne: true },
    }).lean().exec();

    const byId = new Map(products.map((p: any) => [String(p._id), p]));
    const availability = await availabilityService.getMap(rid.toString(), branchOid ? branchOid.toString() : null, productIds);

    // Phase 4 — resolve reusable configurations once for every configured line.
    const resolvedConfigs = await this.resolveMenuConfigs(rid, products);

    const validatedItems: any[] = [];
    const unavailableItems: any[] = [];
    let subtotal = 0;
    let gst = 0;

    for (const it of list) {
      const pid = it.productId;
      const qty = Math.max(1, Number(it.quantity) || 1);
      const product = byId.get(pid);
      if (!product) {
        unavailableItems.push({ productId: pid, name: 'Item', reason: 'Not found' });
        continue;
      }
      const state = availability.get(pid) || { status: 'AVAILABLE' as const, visibleOnSite: true };
      // Owner hid the item from the site — a stale cart must not slip through.
      if (state.visibleOnSite === false) {
        unavailableItems.push({ productId: pid, name: (product as any).name, reason: 'No longer listed on the menu' });
        continue;
      }
      if (state.status !== 'AVAILABLE') {
        unavailableItems.push({ productId: pid, name: (product as any).name, reason: state.reason || 'Sold out' });
        continue;
      }

      // Configured line: re-validate against the Phase 1 validator and re-price
      // with the Phase 3 deterministic pricing engine — the browser's numbers
      // are never trusted. Invalid/stale selections surface as unavailable.
      let price = this.priceFor(product, branchOid);
      let configurationSnapshot: any;
      let configSummary: string | undefined;
      let pricingSnapshot: any;
      const selection = it.configuration;
      if (selection && selection.selections && selection.selections.length > 0) {
        const resolved = resolvedConfigs.get(pid);
        if (!resolved) {
          unavailableItems.push({ productId: pid, name: (product as any).name, reason: 'Configuration no longer available' });
          continue;
        }
        const validation = validateProductConfigurationSelection(resolved, selection);
        if (!validation.valid) {
          const first = validation.errors[0];
          unavailableItems.push({ productId: pid, name: (product as any).name, reason: first?.message || 'Invalid selection' });
          continue;
        }
        const priced = calculateLineItemPrice(resolved, selection, qty);
        price = round2(priced.grossItemPrice);
        configurationSnapshot = { selections: selection.selections };
        configSummary = summarizeSelection(resolved, selection) || undefined;
        pricingSnapshot = { ...priced, origin: 'online' };
      }

      const lineTotal = round2(price * qty);
      subtotal = round2(subtotal + lineTotal);
      gst = round2(gst + (lineTotal * ((product as any).gstPercent ?? 5)) / 100);
      validatedItems.push({
        productId: pid,
        productName: (product as any).name,
        quantity: qty,
        price,
        lineTotal,
        configurationSnapshot,
        configSummary,
        pricingSnapshot,
      });
    }

    return {
      items: validatedItems,
      unavailableItems,
      subtotal,
      gst,
      grandTotal: round2(subtotal + gst),
    };
  }
}

export const publicStoreOrderService = new PublicStoreOrderService();
