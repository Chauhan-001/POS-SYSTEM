/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Products Controller — CRUD for menu products/catalog items.
 * Delegates business logic to productService.
 * The frontend handles search/category filtering client-side.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { productService, stockMovementService } from '../services';
import { resolveMenuProductScope } from '../services/productService';
import { AppError } from '../utils/AppError';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { resolveMenuProduct } from '../modules/voice-inventory/services/ProductResolver';
import { getPriceIntelligence } from '../services/priceIntelligenceService';

/**
 * True when a restaurant-scoped caller may access the product:
 * - the product is owned by their restaurant, OR
 * - the product is part of the shared/global catalog (no owner).
 * Admin callers (no restaurantId) are not restricted by this check.
 * Malformed restaurantIds return false so scoping fails CLOSED.
 */
function canAccess(restId: string | undefined, ownerId: Types.ObjectId | null | undefined): boolean {
  if (!restId) return true; // admin path
  if (!Types.ObjectId.isValid(restId)) return false; // malformed — fail closed
  if (!ownerId) return true; // global/shared product
  return new Types.ObjectId(restId).equals(ownerId);
}

/**
 * POST /api/products/:id/stock — Apply a manual stock adjustment (or waste)
 * through the centralized stock movement engine. Always creates an
 * InventoryEvent + AuditLog. Owner/Manager/Inventory roles only.
 */
export async function adjustProductStock(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: 'Invalid product id' });
      return;
    }
    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: 'delta must be a non-zero number' });
      return;
    }
    const result = await stockMovementService.applyMovement({
      restaurantId: restId,
      branchId: req.body?.branchId,
      productId: req.params.id,
      delta,
      type: req.body?.type || 'adjustment',
      reason: req.body?.reason,
      details: req.body?.details,
      unit: req.body?.unit,
      operator: (req as AuthenticatedRequest).user?.name || 'System',
      performedById: (req as AuthenticatedRequest).user?.userId,
      purchasePrice: req.body?.purchasePrice,
    });
    // Live broadcast: other terminals see updated stock levels instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      emitToRestaurant(restId, 'product:updated', {
        productId: req.params.id,
        stockUpdate: { delta, newStock: result?.after },
      });
    } catch { /* socket not ready — non-fatal */ }
    res.json({ data: result });
  } catch (error: any) {
    if (error instanceof AppError && [400, 403, 404, 409].includes(error.statusCode)) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ProductsController] adjustStock error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/products — List all products (with optional category filter).
 * Strict tenant scoping for restaurant callers: a restaurant sees ONLY
 * products saved under its own restaurantId in the database. The shared/global
 * catalog (restaurantId: null) is never merged in, so the POS billing menu
 * cannot surface hardcoded items the restaurant never created. Admin/platform
 * callers (no restaurantId in the token) skip the scope filter entirely and
 * see all products.
 */
export async function listProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, availability, type } = req.query;
    const filter: any = {};
    if (category) filter.category = category;
    if (availability !== undefined) filter.availability = availability === 'true';
    // Server-side type filter: defaults to 'menu' so callers never receive
    // inventory items unless they explicitly request type=inventory.
    filter.type = (type === 'inventory' || type === 'menu') ? type : 'menu';
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (restId && Types.ObjectId.isValid(restId)) {
      // Strict tenant scoping: ONLY this restaurant's own products.
      filter.$or = await resolveMenuProductScope(restId, { includeGlobalFallback: false });
    } else if (restId) {
      // Malformed restaurantId in token — fail CLOSED so the shared/global
      // catalog (hardcoded items that belong to no restaurant) can never leak
      // into a tenant's menu.
      console.warn('[ProductsController] invalid restaurantId in token:', restId);
      res.status(403).json({ error: 'Invalid restaurant token' });
      return;
    }
    const result = await productService.list(filter);
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[ProductsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/products/:id — Get single product with variants.
 * Restaurant users can only read their own or the shared/global catalog —
 * never another restaurant's products (404 to avoid leaking existence).
 */
export async function getProduct(req: Request, res: Response): Promise<void> {
  try {
    const product = await productService.getById(req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (restId && !canAccess(restId, product.restaurantId)) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ data: product });
  } catch (error) {
    console.error('[ProductsController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/products — Create a new product with optional variants.
 * Products created from a POS account are stamped with that restaurant so the
 * catalog is scoped to the owner. Admin/platform-level creations stay global.
 */
export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    // Restaurant-scoped users always get their own restaurantId stamped — never
    // trust a client-supplied one (prevents cross-restaurant catalog tampering).
    // Malformed ids fail closed (403) like the other handlers. Admin/platform
    // requests (no restaurantId) may create global products explicitly.
    if (restId && !Types.ObjectId.isValid(restId)) {
      console.warn('[ProductsController] invalid restaurantId in token:', restId);
      res.status(403).json({ error: 'Invalid restaurant token' });
      return;
    }
    const body = { ...req.body };
    if (restId) {
      body.restaurantId = new Types.ObjectId(restId);
    }
    const product = await productService.create(body);
    // Live broadcast: other terminals see the new product instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      emitToRestaurant(restId, 'product:created', { product });
    } catch { /* socket not ready — non-fatal */ }
    res.status(201).json({ data: product });
  } catch (error) {
    if (error instanceof AppError && [400, 403, 404, 409].includes(error.statusCode)) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ProductsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/products/:id — Update a product and its variants.
 * Restaurant users may only update products their restaurant owns — the
 * shared/global catalog is read-only for them (prevents cross-restaurant
 * tampering of the common menu). Admins (no restaurantId) can update any.
 */
export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (restId) {
      const existing = await productService.getById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      // Restaurant users must OWN the product to edit it — the shared/global
      // catalog is read-only for them. Malformed ids fail closed via canAccess.
      if (!existing.restaurantId || !canAccess(restId, existing.restaurantId)) {
        res.status(403).json({ error: 'You can only edit products owned by your restaurant' });
        return;
      }
    }
    const product = await productService.update(req.params.id, req.body);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    // Live broadcast: other terminals see the update (availability, price, stock, etc.) instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      const rid = restId || String((product as any).restaurantId || '');
      emitToRestaurant(rid, 'product:updated', { product, productId: req.params.id });
    } catch { /* socket not ready — non-fatal */ }
    res.json({ data: product });
  } catch (error) {
    if (error instanceof AppError && [400, 403, 404, 409].includes(error.statusCode)) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ProductsController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/products/:id — Soft-delete a product.
 * Same ownership rule as update: restaurant users can only delete their own
 * products, never the shared/global catalog or another restaurant's items.
 */
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (restId) {
      const existing = await productService.getById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      // Same ownership rule as update: restaurant users must own the product.
      if (!existing.restaurantId || !canAccess(restId, existing.restaurantId)) {
        res.status(403).json({ error: 'You can only delete products owned by your restaurant' });
        return;
      }
    }
    const deleted = await productService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    // Live broadcast: other terminals remove the product from their grid instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      emitToRestaurant(restId, 'product:deleted', { productId: req.params.id });
    } catch { /* socket not ready — non-fatal */ }
    res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError && [400, 403, 404, 409].includes(error.statusCode)) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ProductsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── PHASE 11 — PRODUCT RESOLUTION (POS typed search / SKU / barcode) ─

/**
 * POST /api/products/resolve — resolve a typed/scan query to a product.
 * Deterministic-first cascade (exact → alias → SKU → fuzzy); the LLM semantic
 * stage runs ONLY when allowSemantic=true AND deterministic stages missed.
 * Tenant-scoped from the JWT. Ambiguous queries return ranked alternatives
 * instead of silently picking one.
 */
export async function resolveProductQuery(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    const restaurantId = restId ? String(restId) : undefined;
    const query = String(req.body?.query || req.query?.q || '').trim();
    if (!query) { res.status(400).json({ error: 'Query is required' }); return; }
    if (!restaurantId) { res.status(400).json({ error: 'Restaurant context required' }); return; }
    const result = await resolveMenuProduct(restaurantId, query, {
      allowSemantic: req.body?.allowSemantic === true,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[ProductsController] resolve error:', error.message);
    res.status(500).json({ error: 'Product resolution failed' });
  }
}

// ─── PHASE 10 — PRICE INTELLIGENCE (read-only advisory) ──────────────

/**
 * GET /api/products/price-intelligence — deterministic price-floor and
 * deterioration advisory per costed product. READ-ONLY: it never changes a
 * selling price; the owner edits the price through the existing product
 * editor (authorization + audit flow). Optional branchId scopes pricing to
 * the branch's price override.
 */
export async function productPriceIntelligence(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    const restaurantId = restId ? String(restId) : undefined;
    if (!restaurantId) { res.status(400).json({ error: 'Restaurant context required' }); return; }
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const minUnits = req.query.minUnits ? Number(req.query.minUnits) : undefined;
    const includeHealthy = req.query.healthy !== '0';
    const rows = await getPriceIntelligence(restaurantId, { branchId, minUnits, includeHealthy });
    res.json({ products: rows, targetMargin: 25 });
  } catch (error: any) {
    console.error('[ProductsController] price-intelligence error:', error.message);
    res.status(500).json({ error: 'Price intelligence failed' });
  }
}
