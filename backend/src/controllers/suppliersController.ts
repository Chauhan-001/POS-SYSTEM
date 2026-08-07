/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suppliers Controller — vendor CRUD, scoped to the authenticated user's
 * restaurant for multi-tenant isolation.
 */

import { Request, Response } from 'express';
import { supplierService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function listSuppliers(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { search, status, limit } = req.query;
    const result = await supplierService.list({
      restaurantId: restId,
      search: search as string | undefined,
      status: status as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[SuppliersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSupplier(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const supplier = await supplierService.getById(req.params.id, restId);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ data: supplier });
  } catch (error: any) {
    if (error?.statusCode === 403 || error?.statusCode === 400) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[SuppliersController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createSupplier(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const supplier = await supplierService.create(req.body, restId);
    res.status(201).json({ data: supplier });
  } catch (error: any) {
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[SuppliersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateSupplier(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const updated = await supplierService.update(req.params.id, restId, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ data: updated });
  } catch (error: any) {
    if (error?.statusCode === 403 || error?.statusCode === 400) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[SuppliersController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteSupplier(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const deleted = await supplierService.delete(req.params.id, restId);
    if (!deleted) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error: any) {
    if (error?.statusCode === 403) {
      res.status(403).json({ error: error.message });
      return;
    }
    console.error('[SuppliersController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
