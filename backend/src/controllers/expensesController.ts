/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Expenses Controller — Full expense CRUD (Phase 1.7).
 * All operations are tenant-scoped via req.user.restaurantId. Update is PATCH
 * with optimistic versioning. Delete requires Owner/Manager role + (optional)
 * Manager PIN verification. CSV export is server-generated.
 */

import { Request, Response } from 'express';
import { expenseService, billService } from '../services';
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
  console.error(`[ExpensesController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/expenses — paged, filterable, searchable (tenant-scoped). */
export async function listExpenses(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, category, vendorId, paymentMethod, startDate, endDate, search, isCogs, includeDeleted, page, limit, sortBy, sortDir } = req.query;
    const result = await expenseService.list(auth?.restaurantId || '', {
      branchId: branchId as string,
      category: category as string,
      vendorId: vendorId as string,
      paymentMethod: paymentMethod as string,
      startDate: startDate as string,
      endDate: endDate as string,
      search: search as string,
      isCogs: isCogs as string,
      includeDeleted: includeDeleted as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string,
      sortDir: sortDir as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'list'); }
}

/** GET /api/expenses/:id — single expense. */
export async function getExpense(req: Request, res: Response): Promise<void> {
  try {
    const expense = await expenseService.get(userOf(req)?.restaurantId || '', req.params.id);
    res.json({ data: expense });
  } catch (error) { handleError(res, error, 'get'); }
}

/** POST /api/expenses — create (Owner/Manager). */
export async function createExpense(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const expense = await expenseService.create(auth?.restaurantId || '', req.body, {
      operator: auth?.name,
      branchId: req.body.branchId || auth?.branchIds?.[0],
    });
    res.status(201).json({ data: expense });
  } catch (error) { handleError(res, error, 'create'); }
}

/** PATCH /api/expenses/:id — update with optimistic versioning. */
export async function updateExpense(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const expense = await expenseService.update(auth?.restaurantId || '', req.params.id, req.body, {
      operator: auth?.name,
    });
    res.json({ data: expense });
  } catch (error) { handleError(res, error, 'update'); }
}

/**
 * DELETE /api/expenses/:id — soft-delete. Owner/Manager role enforced at the
 * route; an optional managerPin is verified server-side for accountability.
 */
export async function deleteExpense(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { reason, managerPin } = req.body || {};

    if (managerPin) {
      const ok = await billService.verifyManagerPin(auth?.restaurantId, managerPin);
      if (!ok) throw new AppError(403, 'Invalid manager PIN — delete denied');
    }

    const deleted = await expenseService.softDelete(auth?.restaurantId || '', req.params.id, {
      operator: auth?.name,
      reason,
      branchId: auth?.branchIds?.[0],
    });
    if (!deleted) throw new AppError(404, 'Expense not found');
    res.json({ success: true });
  } catch (error) { handleError(res, error, 'delete'); }
}

/** POST /api/expenses/:id/restore — restore a soft-deleted expense. */
export async function restoreExpense(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const restored = await expenseService.restore(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!restored) throw new AppError(404, 'Expense not found');
    res.json({ data: restored });
  } catch (error) { handleError(res, error, 'restore'); }
}

/** GET /api/expenses/export — CSV export honoring the same filters. */
export async function exportExpenses(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, category, vendorId, startDate, endDate, search } = req.query;
    const csv = await expenseService.exportCsv(auth?.restaurantId || '', {
      branchId: branchId as string,
      category: category as string,
      vendorId: vendorId as string,
      startDate: startDate as string,
      endDate: endDate as string,
      search: search as string,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
    res.send(csv);
  } catch (error) { handleError(res, error, 'export'); }
}
