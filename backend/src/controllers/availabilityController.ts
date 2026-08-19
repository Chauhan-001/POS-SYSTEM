/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Availability Controller — online menu availability management.
 * Roles: Owner / Manager / Inventory (route-guarded). Tenant identity comes
 * from the JWT — the client can only scope by branchId (their own branches).
 */

import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { availabilityService } from '../services/availabilityService';
import { productService } from '../services';
import { resolveMenuProductScope } from '../services/productService';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function authCtx(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  return {
    restaurantId: user?.restaurantId,
    operator: user?.name || 'System',
    operatorId: user?.employeeId || user?.userId,
  };
}

/** GET /api/availability?branchId=&status= — full menu with effective states. */
export async function listAvailability(req: Request, res: Response): Promise<void> {
  try {
    const { restaurantId } = authCtx(req);
    if (!restaurantId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    // Malformed restaurantId in the token — fail CLOSED so the shared/global
    // catalog (hardcoded items that belong to no restaurant) can never leak
    // into a tenant's availability list.
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId))) {
      console.warn('[AvailabilityController] invalid restaurantId in token:', restaurantId);
      res.status(403).json({ error: 'Invalid restaurant token' });
      return;
    }
    const branchId = (req.query.branchId as string) || null;
    const statusFilter = (req.query.status as string) || undefined;

    // TENANT SCOPING: ONLY this restaurant's own products — never the
    // shared/global catalog (restaurantId: null) and never another
    // restaurant's rows. The Menu Availability screen must reflect exactly the
    // products saved under the logged-in restaurant's id in MongoDB; hardcoded
    // shared-catalog items that belong to no restaurant are excluded outright.
    const scope = await resolveMenuProductScope(String(restaurantId), { includeGlobalFallback: false });
    const products = await productService.list({ $or: scope });
    // ONLY menu items belong in the availability screen — inventory-only
    // products (availability: false, e.g. raw materials / pre-manufactured
    // stock hidden from the billing menu) must never appear here, matching
    // the billing menu's menu-item definition.
    const menuItems = products.data.filter((p: any) => p.availability !== false);
    const productIds = menuItems.map((p: any) => String(p._id));
    const map = await availabilityService.getMap(restaurantId, branchId, productIds);

    const rows = menuItems
      .map((p: any) => {
        const state = map.get(String(p._id));
        return {
          productId: String(p._id),
          name: p.name,
          category: p.category,
          price: p.price,
          code: p.code,
          image: p.image || null,
          onlineAvailable: state ? state.status === 'AVAILABLE' : true,
          status: state ? state.status : 'AVAILABLE',
          unavailableUntil: state?.unavailableUntil || null,
          reason: state?.reason || null,
          visibleOnSite: state ? state.visibleOnSite !== false : true,
        };
      })
      .filter((r: any) => !statusFilter || r.status === statusFilter);

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[AvailabilityController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/availability/bulk — one or many availability toggles. */
export async function updateAvailability(req: Request, res: Response): Promise<void> {
  try {
    const { restaurantId, operator, operatorId } = authCtx(req);
    if (!restaurantId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { branchId, items } = req.body || {};
    const results = await availabilityService.setBulk(restaurantId, items, {
      branchId: branchId || null,
      operator,
      operatorId,
      source: 'manual',
    });
    res.json({ data: results, count: results.length });
  } catch (error: any) {
    if (error instanceof AppError || error?.statusCode) {
      res.status(error.statusCode || 400).json({ error: error.message });
      return;
    }
    console.error('[AvailabilityController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/availability/history — audit trail for availability changes. */
export async function availabilityHistory(req: Request, res: Response): Promise<void> {
  try {
    const { restaurantId } = authCtx(req);
    if (!restaurantId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { productId, branchId, limit } = req.query;
    const { auditLogRepo } = await import('../repositories');
    const filter: any = {
      action: 'availability.updated',
      restaurantId,
    };
    if (productId) filter.entityId = productId;
    if (branchId) filter.branchId = branchId;

    const rows = await auditLogRepo.findAll(filter as any, {
      sort: { createdAt: -1 },
      limit: Math.min(Number(limit) || 100, 200),
    });
    res.json({ data: rows.data, total: rows.total });
  } catch (error) {
    console.error('[AvailabilityController] history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
