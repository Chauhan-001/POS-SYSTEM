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
        ...(p.toObject ? p.toObject() : p),
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
      ...product.toObject(),
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
    const product = await productRepo.create(productData);

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
    const product = await productRepo.update(id, productData);
    if (!product) return null;

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
    // Batch soft-delete all variants (single updateMany call)
    await productVariantRepo.updateMany(
      { productId: id } as any,
      { isDeleted: true, deletedAt: new Date() } as any
    );
    return true;
  }
}
