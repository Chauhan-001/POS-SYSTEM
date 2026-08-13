/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branches Controller — CRUD for multi-branch restaurant locations.
 * Delegates business logic to branchService.
 * Includes per-branch settings management.
 */

import { Request, Response } from 'express';
import { branchService } from '../services';
import { AppError } from '../utils/AppError';

/** GET /api/branches — List branches for the authenticated restaurant */
export async function listBranches(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = (req as any).user?.restaurantId;
    const result = await branchService.list(restaurantId);
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[BranchesController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/branches/:id — Get branch with settings */
export async function getBranch(req: Request, res: Response): Promise<void> {
  try {
    const branch = await branchService.getById(req.params.id, (req as any).user?.restaurantId);
    if (!branch) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }
    res.json({ data: branch });
  } catch (error) {
    console.error('[BranchesController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/branches — Create a new branch */
export async function createBranch(req: Request, res: Response): Promise<void> {
  try {
    // Tenant identity comes exclusively from the JWT — never from the client
    // body (prevents cross-restaurant branch creation).
    const restaurantId = (req as any).user?.restaurantId;
    const data = { ...req.body, restaurantId };
    const branch = await branchService.create(data);
    res.status(201).json({ data: branch });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) {
      res.status(403).json({ error: error.message });
      return;
    }
    console.error('[BranchesController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/branches/:id — Update branch settings */
export async function updateBranch(req: Request, res: Response): Promise<void> {
  try {
    const branch = await branchService.update(req.params.id, req.body);
    if (!branch) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }
    res.json({ data: branch });
  } catch (error) {
    console.error('[BranchesController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/branches/:id — Delete a branch */
export async function deleteBranch(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await branchService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[BranchesController] delete error:', error);
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/branches/:id/settings — Get branch-specific settings */
export async function getBranchSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await branchService.getSettings(req.params.id, (req as any).user?.restaurantId);
    res.json({ data: settings });
  } catch (error) {
    console.error('[BranchesController] getSettings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/branches/:id/settings — Update branch-specific settings */
export async function updateBranchSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await branchService.updateSettings(req.params.id, req.body, (req as any).user?.restaurantId);
    res.json({ data: settings });
  } catch (error) {
    console.error('[BranchesController] updateSettings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
