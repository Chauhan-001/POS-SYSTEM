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

import { productRepo, productVariantRepo } from '../repositories';
import { generateAndApplyAliases } from '../modules/voice-inventory/services/AliasGeneratorService';
import { AppError } from '../utils/AppError';

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
  async list(filter: { category?: string; availability?: boolean } = {}) {
    const query: any = {};
    if (filter.category) query.category = filter.category;
    if (filter.availability !== undefined) query.availability = filter.availability;
    return productRepo.findAll(query, { sort: { name: 1 } });
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
    const { variants, ...productData } = data;
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
