/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchases Controller — inventory purchase history CRUD.
 * Scoped to the authenticated user's restaurant for multi-tenant isolation.
 */

import { Request, Response } from 'express';
import { purchaseService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

/**
 * GET /api/purchases — List purchases for the caller's restaurant.
 * Supports optional branch/supplier/item/date filters.
 */
export async function listPurchases(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { branchId, supplier, item, startDate, endDate, limit } = req.query;
    const result = await purchaseService.list({
      restaurantId: restId,
      branchId: branchId as string | undefined,
      supplier: supplier as string | undefined,
      item: item as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[PurchasesController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/purchases — Record a stock-in purchase.
 * restaurantId is stamped server-side from the JWT, never from the client.
 */
export async function createPurchase(req: Request, res: Response): Promise<void> {
  try {
    const auth = (req as AuthenticatedRequest).user;
    const restId = auth?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const purchase = await purchaseService.create(req.body, restId, {
      operator: auth?.name,
      branchId: req.body?.branchId,
    });
    res.status(201).json({ data: purchase });
  } catch (error) {
    console.error('[PurchasesController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/purchases/:id — Correct a purchase entry (quantity/price/etc).
 * Scoped to the caller's restaurant (403 for cross-tenant ids).
 */
export async function updatePurchase(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const updated = await purchaseService.update(req.params.id, restId, req.body, {
      operator: (req as AuthenticatedRequest).user?.name,
    });
    if (!updated) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }
    res.json({ data: updated });
  } catch (error: any) {
    if (error?.statusCode === 403 || error?.statusCode === 400) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[PurchasesController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/purchases/:id — Remove a mistaken purchase entry.
 * Scoped to the caller's restaurant (403 for cross-tenant ids).
 */
export async function deletePurchase(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const deleted = await purchaseService.delete(req.params.id, restId, {
      operator: (req as AuthenticatedRequest).user?.name,
    });
    if (!deleted) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error: any) {
    if (error?.statusCode === 403) {
      res.status(403).json({ error: error.message });
      return;
    }
    console.error('[PurchasesController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/purchases/suppliers — Supplier spend summary for reports.
 */
export async function supplierSummary(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const data = await purchaseService.supplierSummary(restId);
    res.json({ data });
  } catch (error) {
    console.error('[PurchasesController] supplier summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
