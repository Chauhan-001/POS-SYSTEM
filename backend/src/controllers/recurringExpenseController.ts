/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecurringExpense Controller — Recurring expense templates + on-demand
 * scheduler run (Phase 1.7).
 */

import { Request, Response } from 'express';
import { recurringExpenseService } from '../services';
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
  console.error(`[RecurringExpenseController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

export async function listRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { frequency, isPaused, includeDeleted, page, limit } = req.query;
    const result = await recurringExpenseService.list(auth?.restaurantId || '', {
      frequency: frequency as string,
      isPaused: isPaused as string,
      includeDeleted: includeDeleted as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'list'); }
}

export async function getRecurring(req: Request, res: Response): Promise<void> {
  try {
    const result = await recurringExpenseService.get(userOf(req)?.restaurantId || '', req.params.id);
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'get'); }
}

export async function createRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const tpl = await recurringExpenseService.create(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.status(201).json({ data: tpl });
  } catch (error) { handleError(res, error, 'create'); }
}

export async function updateRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const tpl = await recurringExpenseService.update(auth?.restaurantId || '', req.params.id, req.body, { operator: auth?.name });
    res.json({ data: tpl });
  } catch (error) { handleError(res, error, 'update'); }
}

export async function pauseRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const tpl = await recurringExpenseService.pause(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ data: tpl });
  } catch (error) { handleError(res, error, 'pause'); }
}

export async function resumeRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const tpl = await recurringExpenseService.resume(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ data: tpl });
  } catch (error) { handleError(res, error, 'resume'); }
}

export async function deleteRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    await recurringExpenseService.softDelete(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    res.json({ success: true });
  } catch (error) { handleError(res, error, 'delete'); }
}

/** POST /api/recurring-expenses/run — generate all due children now. */
export async function runRecurring(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await recurringExpenseService.generateDue(auth?.restaurantId || '', { operator: auth?.name });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'run'); }
}
