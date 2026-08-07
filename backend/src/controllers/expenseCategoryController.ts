/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExpenseCategory Controller — Configurable expense categories (Phase 1.7).
 * System categories are auto-seeded; merchants manage custom categories.
 */

import { Request, Response } from 'express';
import { expenseCategoryService } from '../services';
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
  console.error(`[ExpenseCategoryController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/expense-categories — list (system + custom, sorted). */
export async function listCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await expenseCategoryService.list(
      userOf(req)?.restaurantId || '',
      req.query.includeInactive === 'true'
    );
    res.json({ data: categories });
  } catch (error) { handleError(res, error, 'list'); }
}

/** POST /api/expense-categories — create custom category (Owner/Manager). */
export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const category = await expenseCategoryService.create(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.status(201).json({ data: category });
  } catch (error) { handleError(res, error, 'create'); }
}

/** PUT /api/expense-categories/:id — update. */
export async function updateCategory(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const category = await expenseCategoryService.update(auth?.restaurantId || '', req.params.id, req.body, { operator: auth?.name });
    res.json({ data: category });
  } catch (error) { handleError(res, error, 'update'); }
}

/** DELETE /api/expense-categories/:id — delete custom category. */
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    await expenseCategoryService.delete(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ success: true });
  } catch (error) { handleError(res, error, 'delete'); }
}
