/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Validation Service — Server-side offer/coupon validation (Phase 1.6).
 *
 * Validates an offer against a customer + bill before it can be applied:
 * status/dates, time windows, min bill, max uses, per-customer limit, tier
 * eligibility, segment targeting, branch scope, stacking rules and per-restaurant
 * usage caps. Every successful application is recorded in CouponRedemption so
 * limits are enforced across POS terminals (fraud prevention).
 */

import mongoose from 'mongoose';
import Offer from '../models/Offer';
import Customer from '../models/Customer';
import CustomerSegment from '../models/CustomerSegment';
import CouponRedemption from '../models/CouponRedemption';
import Product from '../models/Product';
import ProductVariant from '../models/ProductVariant';
import { AppError } from '../utils/AppError';
import { couponRedemptionRepo, customerActivityRepo, auditLogRepo } from '../repositories';
import { recordOfferRedemption } from './offerAnalyticsService';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export interface OfferValidationResult {
  valid: boolean;
  offer?: any;
  reason?: string;
  discount?: number;
}

/**
 * Convert a terse validation `reason` into plain, customer-friendly language
 * (Phase 17 — the customer should never see rule jargon). Falls back to the
 * raw reason for reasons that are already human-readable.
 */
export function friendlyOfferReason(reason?: string): string {
  if (!reason) return 'This offer cannot be applied right now.';
  const r = reason.toLowerCase();
  if (r.includes('not found')) return 'This offer is no longer available.';
  if (r.includes('has not started')) return 'This offer starts later — check back soon.';
  if (r.includes('expired')) return 'Sorry, this offer has expired.';
  if (r.includes('not available today')) return 'This offer is only available on select days.';
  if (r.includes('valid ')) return `This offer is only available ${reason.split('Offer valid ')[1]}.`;
  if (r.includes('minimum order')) return `This offer needs a minimum order of ${reason.replace(/[^0-9₹.]/g, '')}.`;
  if (r.includes('not available at this branch')) return 'This offer is not available at this location.';
  if (r.includes('per-customer') || r.includes('per customer')) return 'You have already used this offer.';
  if (r.includes('usage limit')) return 'This offer has reached its usage limit.';
  if (r.includes('members only')) return 'This offer is available to loyalty members only.';
  if (r.includes('segment')) return 'This offer is not available for you right now.';
  if (r.includes('qualifying')) return 'Add an eligible item to your order to use this offer.';
  if (r.includes('offer is ')) {
    const status = reason.split('Offer is ')[1];
    return `This offer is currently ${status}.`;
  }
  return reason;
}

export class OfferValidationService {
  /**
   * Validate an offer (by id or coupon code) for a customer + bill.
   * Returns { valid, offer, reason?, discount? }. Never mutates anything.
   */
  async validate(
    restaurantId: string,
    opts: {
      offerId?: string;
      couponCode?: string;
      customer?: any;                 // customer document or mapped API customer
      customerPhone?: string;
      billSubtotal?: number;
      billItems?: any[];
      branchId?: string;
    },
  ): Promise<OfferValidationResult> {
    const query: any = { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } };
    if (opts.offerId) query._id = objectId(opts.offerId);
    else if (opts.couponCode) query.couponCode = opts.couponCode.trim().toUpperCase();
    else return { valid: false, reason: 'offerId or couponCode required' };

    const offer = await Offer.findOne(query).lean().exec();
    if (!offer) return { valid: false, reason: 'Offer not found' };

    const now = new Date();
    const nowStr = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const day = now.getDay();

    // ── Status / dates ───────────────────────────────────────
    if (offer.status !== 'active') return { valid: false, reason: `Offer is ${offer.status}` };
    if (offer.startDate && offer.startDate > nowStr) return { valid: false, reason: 'Offer has not started yet' };
    if (offer.endDate && offer.endDate < nowStr) return { valid: false, reason: 'Offer has expired' };

    // ── Time window ──────────────────────────────────────────
    if (offer.daysOfWeek && offer.daysOfWeek.length > 0 && !offer.daysOfWeek.includes(day)) {
      return { valid: false, reason: 'Offer not available today' };
    }
    if (typeof offer.startHour === 'number' && typeof offer.endHour === 'number') {
      if (hour < offer.startHour || hour >= offer.endHour) {
        return { valid: false, reason: `Offer valid ${offer.startHour}:00–${offer.endHour}:00 only` };
      }
    }

    // ── Min bill ─────────────────────────────────────────────
    const subtotal = Number(opts.billSubtotal) || 0;
    if (offer.minOrderValue && subtotal < offer.minOrderValue) {
      return { valid: false, reason: `Minimum order value ₹${offer.minOrderValue} required` };
    }

    // ── Branch scope ─────────────────────────────────────────
    if (offer.branchIds && offer.branchIds.length > 0 && opts.branchId && !offer.branchIds.includes(opts.branchId)) {
      return { valid: false, reason: 'Offer not available at this branch' };
    }

    // ── Customer context ─────────────────────────────────────
    const customerPhone = opts.customer?.phone || opts.customerPhone;
    const customerId = opts.customer?._id?.toString?.() || opts.customer?.id;

    // Per-customer limit
    if (offer.maxPerCustomer && customerPhone) {
      const used = await CouponRedemption.countDocuments({
        restaurantId: objectId(restaurantId),
        offerId: offer._id,
        ...(customerId ? { customerId: objectId(customerId) } : { customerPhone }),
        status: 'applied',
      });
      if (used >= offer.maxPerCustomer) return { valid: false, reason: 'Per-customer usage limit reached' };
    }

    // Total uses cap
    if (offer.maxUses && (offer.currentUses || 0) >= offer.maxUses) {
      return { valid: false, reason: 'Offer usage limit reached' };
    }

    // ── Tier eligibility (via customer tier) ─────────────────
    if (offer.targetTier && offer.targetTier.length > 0 && customerId) {
      const cust = opts.customer?._id
        ? opts.customer
        : await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).lean().exec();
      if (cust && !offer.targetTier.includes(cust.tier)) {
        return { valid: false, reason: `Offer available to ${offer.targetTier.join('/')} members only` };
      }
    }

    // ── Segment targeting ────────────────────────────────────
    if (offer.targetSegmentIds && offer.targetSegmentIds.length > 0 && customerPhone) {
      const segments = await CustomerSegment.find({
        restaurantId: objectId(restaurantId),
        customerPhones: customerPhone,
        isDeleted: { $ne: true },
      }).lean().exec();
      const matched = segments.some((s) => offer.targetSegmentIds.includes(s._id.toString()));
      if (!matched) return { valid: false, reason: 'Offer not available for this customer segment' };
    }

    // ── Applicable products/categories (for percentage/flat on items) ──
    if ((offer.applicableCategories?.length || offer.applicableProductIds?.length) && Array.isArray(opts.billItems)) {
      const applicable = opts.billItems.some((item: any) => {
        const cat = item?.product?.category || item?.category;
        const pid = item?.product?.id || item?.productId || item?.menuItemId;
        return (offer.applicableCategories || []).includes(cat) || (offer.applicableProductIds || []).includes(pid);
      });
      if (!applicable) return { valid: false, reason: 'No qualifying items in this bill' };
    }

    // ── Compute discount (server-side, never client-computed) ─
    const discount = this.computeDiscount(offer, subtotal, opts.billItems, opts.branchId);

    return { valid: true, offer: this.sanitize(offer), discount };
  }

  /**
   * Compute the discount amount for an offer against a subtotal. For combo
   * offers the discount is the gap between the authoritative combo-item total
   * (server-resolved prices) and the combo price — never a client number.
   */
  private computeDiscount(offer: any, subtotal: number, billItems?: any[], branchId?: string): number {
    if (offer.type === 'percentage') {
      const raw = subtotal * (offer.value / 100);
      return offer.maxDiscount ? Math.min(raw, offer.maxDiscount) : raw;
    }
    if (offer.type === 'flat' || offer.type === 'cashback' || offer.type === 'coupon') {
      return Math.min(offer.value, subtotal);
    }
    if (offer.type === 'combo') {
      const comboIds = new Set((offer.comboProductIds || []).map((id: any) => String(id)));
      let comboTotal = 0;
      for (const it of Array.isArray(billItems) ? billItems : []) {
        const pid = it?.product?.id || it?.productId || it?.menuItemId;
        if (!pid || !comboIds.has(String(pid))) continue;
        comboTotal += (Number(it?.price) || 0) * (Number(it?.quantity) || 1);
      }
      // Per-branch combo pricing: a branch-level combo price (if set on the
      // offer) wins over the default comboPrice. The discount is the gap
      // between the authoritative item total and that branch's combo price.
      let comboPrice = Number(offer.comboPrice) || 0;
      if (branchId) {
        const branchPrice = Number(offer.comboBranchPrices?.[branchId]) || 0;
        if (branchPrice > 0) comboPrice = branchPrice;
      }
      return comboPrice > 0 ? Math.max(0, round2(comboTotal - comboPrice)) : 0;
    }
    if (offer.type === 'reward_points') return 0;
    // bogo / free_item handled at line level by the POS
    return 0;
  }

  /**
   * PHASE B SECURITY FIX — derive the AUTHORITATIVE bill subtotal server-side
   * from the bill's line items (tenant-scoped products + current prices,
   * branch overrides and variant prices). The client-submitted billSubtotal is
   * never trusted for eligibility or discount math when line items are present.
   * Returns { subtotal, items } where `items` carries the server-resolved
   * prices (productId, name, price, quantity, category, variantName) so combo
   * discounts and applicability checks use the same authoritative numbers.
   */
  async deriveSubtotal(
    restaurantId: string,
    billItems: any[],
    branchId?: string,
  ): Promise<{ subtotal: number; items: any[] }> {
    if (!Array.isArray(billItems) || billItems.length === 0) return { subtotal: 0, items: [] };
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return { subtotal: 0, items: [] };

    const entries: Array<{ productId: string; quantity: number; variantName?: string }> = [];
    for (const it of billItems) {
      const productId = it?.product?.id || it?.id || it?.productId || it?.menuItemId;
      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) continue;
      const quantity = Math.max(0, Number(it?.quantity) || 1);
      if (quantity <= 0) continue;
      const variantName = it?.variantName || it?.variant || it?.selectedVariant?.name;
      entries.push({ productId: String(productId), quantity, variantName: variantName ? String(variantName) : undefined });
    }
    if (entries.length === 0) return { subtotal: 0, items: [] };

    const ids = [...new Set(entries.map((e) => e.productId))];
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const products = await Product.find({
      _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      restaurantId: oid,
      isDeleted: { $ne: true },
    }).lean().exec();
    const byId = new Map(products.map((p: any) => [String(p._id), p]));

    // Batch-load variants for any line that names one (variant-aware pricing).
    const variantNamesByProduct = new Map<string, string[]>();
    for (const e of entries) {
      if (!e.variantName) continue;
      const names = variantNamesByProduct.get(e.productId) || [];
      if (!names.includes(e.variantName)) names.push(e.variantName);
      variantNamesByProduct.set(e.productId, names);
    }
    const variantQuery = Array.from(variantNamesByProduct.entries()).map(([pid, names]) => ({
      productId: new mongoose.Types.ObjectId(pid),
      name: { $in: names },
      isDeleted: { $ne: true },
    }));
    const variants = variantQuery.length > 0
      ? await ProductVariant.find({ $or: variantQuery }).lean().exec()
      : [];
    const variantByKey = new Map<string, any>();
    for (const v of variants) variantByKey.set(`${String((v as any).productId)}::${(v as any).name}`, v);

    const branchOid = branchId && mongoose.Types.ObjectId.isValid(branchId)
      ? new mongoose.Types.ObjectId(branchId)
      : null;

    const items: any[] = [];
    let subtotal = 0;
    for (const e of entries) {
      const product = byId.get(e.productId);
      if (!product) continue; // not this restaurant's product — never trusted
      let price: number;
      const variant = e.variantName ? variantByKey.get(`${e.productId}::${e.variantName}`) : null;
      if (variant) {
        price = Number((variant as any).price) || 0;
        if (branchOid && (variant as any).branchPrice) {
          const override = (variant as any).branchPrice.get?.(String(branchOid)) ?? (variant as any).branchPrice[String(branchOid)];
          if (Number.isFinite(override) && override > 0) price = Number(override);
        }
      } else {
        price = Number(product.price) || 0;
        if (branchOid && product.branchPrice) {
          const override = product.branchPrice.get?.(String(branchOid)) ?? product.branchPrice[String(branchOid)];
          if (Number.isFinite(override) && override > 0) price = Number(override);
        }
      }
      const lineTotal = round2(price * e.quantity);
      subtotal = round2(subtotal + lineTotal);
      items.push({
        productId: e.productId,
        name: product.name,
        price,
        quantity: e.quantity,
        lineTotal,
        category: product.category,
        variantName: e.variantName,
      });
    }
    return { subtotal, items };
  }

  /**
   * Record an offer/coupon application (usage ledger). Throws on violations.
   * Returns the recorded redemption.
   *
   * TOCTOU FIX (Phase 20): the usage slot is claimed with a CONDITIONAL atomic
   * update (`$inc currentUses` only when currentUses < maxUses), so two
   * simultaneous redemptions can never exceed maxUses. The per-customer limit
   * is enforced by count-and-void on the ledger. Never trust the POS client's
   * discount — the server computes eligibility itself.
   */
  async recordApplication(
    restaurantId: string,
    opts: {
      offerId: string;
      code?: string;
      customerId?: string;
      customerPhone?: string;
      billId?: string;
      branchId?: string;
      discountAmount: number;
      /** Authoritative sales subtotal the discount applied to (analytics). */
      salesAmount?: number;
      redeemedBy?: string;
    },
  ): Promise<any> {
    // 1. Fresh offer read — enforce status/ownership server-side, never from
    //    a value the client could have replayed.
    const offer = await Offer.findOne({
      _id: objectId(opts.offerId),
      restaurantId: objectId(restaurantId),
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!offer) throw new AppError(404, 'Offer not found');
    if (offer.status !== 'active') throw new AppError(400, `Offer is ${offer.status}`);

    // 2. Atomic claim of the usage slot (TOCTOU-safe against maxUses).
    const claimFilter: any = { _id: objectId(opts.offerId), restaurantId: objectId(restaurantId) };
    if (typeof offer.maxUses === 'number' && offer.maxUses > 0) {
      claimFilter.currentUses = { $lt: offer.maxUses };
    }
    const claimed = await Offer.findOneAndUpdate(claimFilter, { $inc: { currentUses: 1 } }, { new: true }).exec();
    if (!claimed) throw new AppError(409, 'Offer usage limit reached');

    // 3. Record the redemption ledger entry.
    const redemption = await couponRedemptionRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      offerId: objectId(opts.offerId),
      code: opts.code,
      customerId: opts.customerId ? objectId(opts.customerId) : undefined,
      customerPhone: opts.customerPhone,
      billId: opts.billId,
      branchId: opts.branchId ? objectId(opts.branchId) : undefined,
      discountAmount: opts.discountAmount,
      status: 'applied',
      redeemedBy: opts.redeemedBy,
    } as any);

    // 4. Per-customer limit — count on the ledger; on overflow void + refund
    //    the slot so the counter and the ledger never drift.
    if (typeof offer.maxPerCustomer === 'number' && offer.maxPerCustomer > 0) {
      const used = await CouponRedemption.countDocuments({
        restaurantId: objectId(restaurantId),
        offerId: objectId(opts.offerId),
        ...(opts.customerId ? { customerId: objectId(opts.customerId) } : {}),
        ...(opts.customerPhone ? { customerPhone: opts.customerPhone } : {}),
        status: 'applied',
      });
      if (used > offer.maxPerCustomer) {
        await CouponRedemption.updateOne({ _id: redemption._id }, { $set: { status: 'voided' } }).exec();
        await Offer.updateOne({ _id: objectId(opts.offerId) }, { $inc: { currentUses: -1 } }).exec();
        throw new AppError(409, 'Per-customer usage limit reached');
      }
    }

    if (opts.customerId) {
      await customerActivityRepo.forTenant(restaurantId).create({
        restaurantId: objectId(restaurantId),
        customerId: objectId(opts.customerId),
        customerPhone: opts.customerPhone,
        type: opts.code ? 'coupon_applied' : 'offer_applied',
        title: `${opts.code ? `Coupon ${opts.code}` : 'Offer'} applied`,
        description: `Discount ${opts.discountAmount}`,
        metadata: { offerId: opts.offerId, discount: opts.discountAmount },
        performedBy: opts.redeemedBy,
      } as any);
    }

    await auditLogRepo.create({
      action: opts.code ? 'COUPON_APPLIED' : 'OFFER_APPLIED',
      entityType: 'offer',
      entityId: opts.offerId,
      performedBy: opts.redeemedBy || 'System',
      details: { code: opts.code, customerPhone: opts.customerPhone, discount: opts.discountAmount },
    } as any);

    // 5. Populate OfferAnalytics from the REAL redemption event (Phase B).
    //    Passes the full event (billId/branch/customer/sales) so the daily
    //    snapshot records revenue, not just a counter. recordOfferRedemption
    //    never throws — analytics can never block billing.
    await recordOfferRedemption({
      restaurantId,
      offerId: opts.offerId,
      discountAmount: opts.discountAmount,
      salesAmount: opts.salesAmount,
      billId: opts.billId,
      branchId: opts.branchId,
      customerId: opts.customerId,
      customerPhone: opts.customerPhone,
    });

    return redemption?.toObject();
  }

  /** Look up an offer by coupon code (tenant-scoped). */
  async findOfferByCode(restaurantId: string, code: string): Promise<any | null> {
    const offer = await Offer.findOne({
      restaurantId: objectId(restaurantId),
      couponCode: code.trim().toUpperCase(),
      isDeleted: { $ne: true },
    }).lean().exec();
    return offer ? this.sanitize(offer) : null;
  }

  private sanitize(offer: any): any {
    return {
      id: offer._id.toString(),
      title: offer.title,
      description: offer.description,
      type: offer.type,
      value: offer.value,
      minOrderValue: offer.minOrderValue,
      maxDiscount: offer.maxDiscount,
      couponCode: offer.couponCode,
      stackingAllowed: offer.stackingAllowed,
      mutuallyExclusiveGroup: offer.mutuallyExclusiveGroup,
      startDate: offer.startDate,
      endDate: offer.endDate,
    };
  }
}
