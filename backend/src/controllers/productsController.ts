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
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

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
    res.json({ data: result });
  } catch (error: any) {
    if (error?.statusCode === 400 || error?.statusCode === 403 || error?.statusCode === 404 || error?.statusCode === 409) {
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
    const { category, availability } = req.query;
    const filter: any = {};
    if (category) filter.category = category;
    if (availability !== undefined) filter.availability = availability === 'true';
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
    res.status(201).json({ data: product });
  } catch (error) {
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
    res.json({ data: product });
  } catch (error) {
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
    res.json({ success: true });
  } catch (error) {
    console.error('[ProductsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
