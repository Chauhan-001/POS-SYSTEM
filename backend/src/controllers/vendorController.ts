/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vendor Controller — Finance vendor management (Phase 1.7).
 */

import { Request, Response } from 'express';
import { vendorService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[VendorController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/vendors — paged + searchable. */
export async function listVendors(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { search, status, includeDeleted, page, limit } = req.query;
    const result = await vendorService.list(auth?.restaurantId || '', {
      search: search as string,
      status: status as string,
      includeDeleted: includeDeleted as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'list'); }
}

/** GET /api/vendors/:id — single vendor. */
export async function getVendor(req: Request, res: Response): Promise<void> {
  try {
    const vendor = await vendorService.get(userOf(req)?.restaurantId || '', req.params.id);
    res.json({ data: vendor });
  } catch (error) { handleError(res, error, 'get'); }
}

/** POST /api/vendors — create (Owner/Manager). */
export async function createVendor(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const vendor = await vendorService.create(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.status(201).json({ data: vendor });
  } catch (error) { handleError(res, error, 'create'); }
}

/** PUT /api/vendors/:id — update. */
export async function updateVendor(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const vendor = await vendorService.update(auth?.restaurantId || '', req.params.id, req.body, { operator: auth?.name });
    res.json({ data: vendor });
  } catch (error) { handleError(res, error, 'update'); }
}

/** DELETE /api/vendors/:id — soft-delete (Owner/Manager). */
export async function deleteVendor(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    await vendorService.softDelete(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ success: true });
  } catch (error) { handleError(res, error, 'delete'); }
}

/** GET /api/vendors/:id/summary — billed/paid/outstanding + history. */
export async function vendorSummary(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { startDate, endDate } = req.query;
    const result = await vendorService.summary(auth?.restaurantId || '', req.params.id, {
      startDate: startDate as string,
      endDate: endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'summary'); }
}
