/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Product Service — Business logic for menu product management.
 * Handles product CRUD with branch-specific pricing overrides.
 * Variants are managed in a separate ProductVariant collection.
 *
 * On product creation, the service fires fire-and-forget AI alias generation
 * so the merchant NEVER manually creates voice aliases for new products.
 */

import mongoose from 'mongoose';
import { productRepo, productVariantRepo } from '../repositories';
import { generateAndApplyAliases } from '../modules/voice-inventory/services/AliasGeneratorService';
import { AppError } from '../utils/AppError';
import Offer from '../models/Offer';

/**
 * ─── Meal Combo support ─────────────────────────────────────────────
 * A meal combo is a PRODUCT that bundles other products at a single price.
 * The product is the owner's source of truth; the service auto-syncs a
 * backing Offer (type 'combo', linkedProductId → this product) so the whole
 * existing combo pipeline — billing validation, usage ledger, OfferAnalytics,
 * analytics-driven recommendations, customer store — works unchanged.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic combo-definition rules (rejected server-side, never left to
 * the frontend): ≥2 components, all existing, same tenant, no nested combos,
 * comboPrice > 0 and comboPrice < sum of component base prices.
 */
async function validateComboDefinition(restaurantId: any, comboComponentIds: string[], comboPrice: number): Promise<{ comps: any[]; sum: number }> {
  const ids = (comboComponentIds || []).map((id) => String(id)).filter(Boolean);
  if (ids.length < 2) throw new AppError(400, 'A meal combo needs at least 2 items.');
  if (!(Number(comboPrice) > 0)) throw new AppError(400, 'Combo price must be greater than zero.');

  const found = await productRepo.findAll({ _id: { $in: ids }, isDeleted: { $ne: true } } as any);
  const comps = (found?.data || []) as any[];
  if (!comps || comps.length !== ids.length) {
    throw new AppError(400, 'One or more combo items were not found.');
  }
  for (const c of comps) {
    if (String(c.restaurantId || '') !== String(restaurantId || '')) {
      throw new AppError(400, `"${c.name}" does not belong to this restaurant.`);
    }
    if (c.isCombo) {
      throw new AppError(400, `"${c.name}" is itself a combo — combos cannot contain combos.`);
    }
  }
  const sum = round2(comps.reduce((s: number, c: any) => s + (Number(c.price) || 0), 0));
  if (!(Number(comboPrice) < sum)) {
    throw new AppError(400, `Combo price must be less than the total of its items (₹${sum.toLocaleString('en-IN')}).`);
  }
  return { comps, sum };
}

/** Cancel (soft-delete) a backing combo offer — mirrors offer delete semantics. */
async function cancelLinkedComboOffer(productId: string): Promise<void> {
  await Offer.updateMany(
    { linkedProductId: productId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), status: 'cancelled' } },
  );
}

/**
 * Create or refresh the backing Offer for a meal-combo product. Idempotent:
 * looks the offer up by linkedProductId so repeated saves never duplicate it.
 */
async function syncComboOffer(product: any, opts: { forceDelete?: boolean } = {}): Promise<void> {
  const rid = product.restaurantId ? String(product.restaurantId) : null;
  const pid = String(product._id || product.id);
  if (opts.forceDelete || !product.isCombo) {
    if (!opts.forceDelete) await cancelLinkedComboOffer(pid);
    else await cancelLinkedComboOffer(pid);
    return;
  }
  if (!rid) {
    // Global-catalog (admin) products cannot auto-sync a tenant combo offer.
    throw new AppError(400, 'Meal combos must belong to a restaurant.');
  }
  const { sum } = await validateComboDefinition(rid, product.comboComponentIds, product.comboPrice);

  const title = product.name || 'Meal Combo';
  const desc =
    `${title} — ${(product.comboComponentIds || []).length} items bundled at ` +
    `${(Number(product.comboPrice) || 0).toLocaleString('en-IN')} (items total ₹${sum.toLocaleString('en-IN')}).`;
  const offerData: any = {
    title,
    description: desc,
    shortDescription: `₹${Number(product.comboPrice) || 0} combo`,
    type: 'combo',
    value: 0, // combo discount is derived from comboProductIds + comboPrice, not value
    comboProductIds: (product.comboComponentIds || []).map((id: string) => String(id)),
    comboPrice: round2(Number(product.comboPrice) || 0),
    // Per-branch combo price overrides travel with the offer so the server
    // resolves the branch-aware price at billing (offerValidationService).
    // The product doc may hold a Mongoose Map or a plain object — normalize.
    comboBranchPrices: (() => {
      const raw: any = (product as any).comboBranchPrice;
      const out: Record<string, number> = {};
      if (raw instanceof Map) {
        raw.forEach((v: any, k: any) => { if (Number(v) > 0) out[String(k)] = round2(Number(v)); });
      } else if (raw && typeof raw === 'object') {
        Object.entries(raw).forEach(([k, v]) => { if (Number(v) > 0) out[String(k)] = round2(Number(v)); });
      }
      return out;
    })(),
    restaurantId: product.restaurantId,
    linkedProductId: pid,
    imageUrl: product.image || undefined,
    applicableCategories: [],
    branchIds: [],
    status: product.availability === false ? 'draft' : 'active',
    isAiGenerated: false,
    isAutoActivate: false,
    sortOrder: 0,
    isDeleted: false,
  };

  const existing = await Offer.findOne({ linkedProductId: pid, isDeleted: { $ne: true } }).exec();
  let offer;
  if (existing) {
    existing.set(offerData);
    offer = await existing.save();
  } else {
    offer = await Offer.create(offerData);
  }
  // Keep the product linked to its offer (idempotent).
  await productRepo.update(pid, { linkedComboOfferId: offer._id.toString() } as any);
}

/**
 * Resolve the product scope for a restaurant's menu surfaces (POS products,
 * availability page, customer website).
 *
 * Tenant isolation: a restaurant sees ONLY its OWN products. The shared/global
 * catalog (restaurantId: null) is included ONLY as a bootstrap fallback when
 * the restaurant owns zero products of its own — so a fresh/empty account
 * still has something to sell, but an established restaurant never sees
 * hardcoded items it never created (no duplicate menu rows, no "all DB data").
 *
 * Options:
 *  - includeGlobalFallback: false → the restaurant's OWN products only, never
 *    the shared/global catalog. Used by the POS "Menu Availability" control so
 *    it can only ever display products saved under this restaurant's id in the
 *    database — shared-catalog items (restaurantId: null) that belong to no
 *    restaurant must never appear there.
 */
export async function resolveMenuProductScope(
  restaurantId: string,
  options: { includeGlobalFallback?: boolean } = {},
): Promise<any[]> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const owned = await productRepo.findAll(
    { restaurantId: oid, isDeleted: { $ne: true } } as any,
    { page: 1, limit: 1 },
  );
  if (owned.total > 0) return [{ restaurantId: oid }];
  // Fresh account with no products yet — fall back to the shared/global menu
  // unless the caller explicitly opted out (see options above).
  if (options.includeGlobalFallback === false) return [{ restaurantId: oid }];
  return [{ restaurantId: oid }, { restaurantId: null }];
}

/**
 * Enforce barcode uniqueness within a restaurant (or global catalog).
 * Returns nothing on success; throws 400 AppError when the barcode is already
 * used by another non-deleted product.
 */
async function assertBarcodeUnique(barcode: string | undefined, restaurantId: string | null | undefined, excludeId?: string): Promise<void> {
  if (!barcode || !String(barcode).trim()) return;
  const normalized = String(barcode).trim().toUpperCase();
  const query: any = { barcode: normalized, isDeleted: { $ne: true } };
  if (excludeId) query._id = { $ne: excludeId };
  if (restaurantId) query.restaurantId = restaurantId;
  else query.$or = [{ restaurantId: null }, { restaurantId: { $exists: false } }];
  const existing = await productRepo.findOne(query);
  if (existing) {
    throw new AppError(400, `Barcode "${barcode}" is already used by "${(existing as any).name}"`);
  }
}

function normalizeVariants(variants: unknown): Array<{ name: string; price: number; [key: string]: any }> {
  if (!Array.isArray(variants)) return [];

  return variants.reduce<Array<{ name: string; price: number; [key: string]: any }>>((acc, rawVariant) => {
    if (!rawVariant || typeof rawVariant !== 'object') return acc;

    const variant = rawVariant as Record<string, any>;
    const name = typeof variant.name === 'string' ? variant.name.trim() : '';
    const priceValue = typeof variant.price === 'number' ? variant.price : Number(variant.price);

    if (!name || !Number.isFinite(priceValue) || priceValue < 0) {
      return acc;
    }

    acc.push({
      ...variant,
      name,
      price: priceValue,
    });

    return acc;
  }, []);
}

export class ProductService {
  /**
   * List all products (non-deleted).
   * Optionally filter by category or availability.
   */
  async list(filter: { category?: string; availability?: boolean; $or?: any[] } = {}) {
    const query: any = {};
    if (filter.category) query.category = filter.category;
    if (filter.availability !== undefined) query.availability = filter.availability;
    // Tenant scoping is built by the callers (products/availability controllers)
    // as an $or of owned + shared/global rows. Forward it so it actually reaches
    // Mongo — previously it was silently dropped, leaking every restaurant's
    // products into every tenant's menu/availability list.
    if (filter.$or && filter.$or.length > 0) query.$or = filter.$or;
    const result = await productRepo.findAll(query, { sort: { name: 1 } });

    // Embed variants (separate ProductVariant collection) in a single batched
    // query so the POS can mirror per-variant branchPrice overrides into its
    // local price cache — the same sync the product-level branchPrice has.
    // Without this the list endpoint never exposed variants at all, so variant
    // branch pricing could only live in one terminal's localStorage.
    const ids = result.data.map((p: any) => String(p._id));
    if (ids.length > 0) {
      const variants = await productVariantRepo.findAll({ productId: { $in: ids } } as any);
      const byProduct = new Map<string, any[]>();
      for (const v of variants.data) {
        const pid = String((v as any).productId);
        if (!byProduct.has(pid)) byProduct.set(pid, []);
        byProduct.get(pid)!.push(v);
      }
      result.data = result.data.map((p: any) => ({
        // flattenMaps keeps branchPrice/comboBranchPrice Map fields as plain
        // objects — plain toObject() drops Map contents (Mongoose quirk).
        ...(p.toObject ? p.toObject({ flattenMaps: true }) : p),
        variants: byProduct.get(String(p._id)) || [],
      }));
    }

    return result;
  }

  /**
   * Get a single product by ID, including its variants.
   */
  async getById(id: string) {
    const product = await productRepo.findById(id);
    if (!product) return null;
    const variants = await productVariantRepo.findAll({ productId: id } as any);
    return {
      ...product.toObject({ flattenMaps: true }),
      variants: variants.data,
    };
  }

  /**
   * Create a new product with optional variants.
   * Automatically generates AI aliases (fire-and-forget).
   */
  async create(data: any) {
    const { variants, ...productData } = data;
    await assertBarcodeUnique(productData.barcode, productData.restaurantId);
    if (productData.barcode) productData.barcode = String(productData.barcode).trim().toUpperCase();
    // Meal combo: validate the definition BEFORE persisting anything, so a
    // rejected combo (wrong tenant component, price >= total, <2 items) never
    // leaves an orphan product behind.
    if (productData.isCombo) {
      await validateComboDefinition(productData.restaurantId, productData.comboComponentIds, productData.comboPrice);
      // A combo's sell price IS its combo price — never allow the two to
      // drift apart (the POS tile and billing both derive from it).
      productData.price = round2(Number(productData.comboPrice) || 0);
    }
    const product = await productRepo.create(productData);

    // Meal combo: create/refresh the backing Offer so the existing combo
    // pipeline (billing, analytics, customer site) works for this product.
    if (productData.isCombo) {
      await syncComboOffer(product);
    }

    const normalizedVariants = normalizeVariants(variants);
    if (normalizedVariants.length > 0) {
      const variantDocs = normalizedVariants.map((v: any) => ({
        ...v,
        productId: product._id.toString(),
      }));
      await productVariantRepo.bulkCreate(variantDocs as any);
    }

    // Fire-and-forget: generate multilingual aliases in the background.
    // The merchant NEVER manually creates aliases.
    generateAndApplyAliases(product._id.toString(), {
      productName: productData.name || '',
      category: productData.category,
    }).catch((err) =>
      console.warn('[ProductService] Background alias generation failed:', err.message)
    );

    return this.getById(product._id.toString());
  }

  /**
   * Update a product and optionally replace its variants.
   */
  async update(id: string, data: any) {
    const { variants, variantBranchPrices, ...productData } = data;
    const existing = await productRepo.findById(id);
    if (!existing) return null;
    if (productData.barcode !== undefined) {
      await assertBarcodeUnique(productData.barcode, (existing as any).restaurantId, id);
      productData.barcode = productData.barcode ? String(productData.barcode).trim().toUpperCase() : '';
    }
    // Meal combo: validate the merged definition BEFORE persisting, so a
    // rejected combo update never leaves the product marked isCombo without
    // its backing Offer.
    const willBeCombo =
      (productData.isCombo === undefined && (existing as any).isCombo) ||
      productData.isCombo === true;
    if (willBeCombo) {
      const merged = { ...(existing as any).toObject(), ...productData };
      await validateComboDefinition(merged.restaurantId, merged.comboComponentIds, merged.comboPrice);
      // A combo's sell price IS its combo price — keep them in lockstep.
      productData.price = round2(Number(productData.comboPrice ?? merged.comboPrice) || 0);
    }
    const product = await productRepo.update(id, productData);
    if (!product) return null;

    // Meal combo: if this product is (or just became) a combo, refresh the
    // backing Offer; if it just stopped being a combo, cancel the backing
    // offer. Idempotent — repeated saves never duplicate the offer.
    if (productData.isCombo !== undefined || (existing as any).isCombo) {
      const merged = { ...(existing as any).toObject(), ...productData, _id: (existing as any)._id };
      if (productData.isCombo === false || !merged.isCombo) {
        await cancelLinkedComboOffer(id);
      } else {
        await syncComboOffer(merged);
      }
    }

    if (variants && Array.isArray(variants)) {
      const normalizedVariants = normalizeVariants(variants);
      // Remove existing variants
      await productVariantRepo.bulkDelete({ productId: id } as any);
      // Create new variants
      if (normalizedVariants.length > 0) {
        const variantDocs = normalizedVariants.map((v: any) => ({
          ...v,
          productId: id,
        }));
        await productVariantRepo.bulkCreate(variantDocs as any);
      }
    }

    // In-place per-variant branch-price updates (variantName → branchId → price).
    // Only the branchPrice maps on existing variant docs are touched — variant
    // _ids and metadata are never recreated, so a branch-price save can't
    // clobber the variant set.
    if (variantBranchPrices && typeof variantBranchPrices === 'object') {
      for (const [variantName, branchMap] of Object.entries(variantBranchPrices)) {
        if (!branchMap || typeof branchMap !== 'object') continue;
        const cleanMap: Record<string, number> = {};
        for (const [bid, price] of Object.entries(branchMap as Record<string, number>)) {
          const p = Number(price);
          if (Number.isFinite(p) && p >= 0) cleanMap[bid] = p;
        }
        await productVariantRepo.updateMany(
          { productId: id, name: variantName } as any,
          { $set: { branchPrice: cleanMap } } as any,
        );
      }
    }

    return this.getById(id);
  }

  /**
   * Soft-delete a product (and its variants).
   */
  async delete(id: string) {
    const product = await productRepo.softDelete(id);
    if (!product) return false;
    // Meal combo: cancel the backing combo Offer so the deleted product
    // stops appearing in billing/analytics/customer surfaces.
    if ((product as any).isCombo) {
      await cancelLinkedComboOffer(id);
    }
    // Batch soft-delete all variants (single updateMany call)
    await productVariantRepo.updateMany(
      { productId: id } as any,
      { isDeleted: true, deletedAt: new Date() } as any
    );
    return true;
  }
}
