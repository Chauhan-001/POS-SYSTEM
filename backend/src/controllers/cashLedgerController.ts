/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CashLedger Controller — True cash-flow ledger endpoints (Phase 1.7).
 * Opening cash, cash in/out, drawer adjustments, bank movements, shift
 * closing (over/short) and history. All tenant-scoped.
 */

import { Request, Response } from 'express';
import { cashLedgerService } from '../services';
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
  console.error(`[CashLedgerController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/cash-ledger — history (paged, filterable) + current balance. */
export async function getLedger(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { branchId, startDate, endDate, type, page, limit } = req.query;
    const result = await cashLedgerService.history(auth?.restaurantId || '', {
      branchId: branchId as string,
      startDate: startDate as string,
      endDate: endDate as string,
      type: type as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'history'); }
}

/** GET /api/cash-ledger/balance — current cash balance. */
export async function getBalance(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const balance = await cashLedgerService.getBalance(auth?.restaurantId || '', req.query.branchId as string);
    res.json({ data: { balance } });
  } catch (error) { handleError(res, error, 'balance'); }
}

/** POST /api/cash-ledger/opening — record opening cash (once per day). */
export async function openCash(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const entry = await cashLedgerService.openCash(auth?.restaurantId || '', {
      amount: req.body.amount,
      date: req.body.date,
      branchId: req.body.branchId || auth?.branchIds?.[0],
      note: req.body.note,
      performedBy: auth?.name,
    });
    res.status(201).json({ data: entry });
  } catch (error) { handleError(res, error, 'openCash'); }
}

/** POST /api/cash-ledger/entries — cash in/out, adjustment, bank movements. */
export async function addEntry(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const entry = await cashLedgerService.addEntry(auth?.restaurantId || '', {
      type: req.body.type,
      amount: req.body.amount,
      date: req.body.date,
      branchId: req.body.branchId || auth?.branchIds?.[0],
      note: req.body.note,
      refType: req.body.refType,
      refId: req.body.refId,
      performedBy: auth?.name,
    });
    res.status(201).json({ data: entry });
  } catch (error) { handleError(res, error, 'addEntry'); }
}

/** POST /api/cash-ledger/shift-close — close the day with counted cash. */
export async function closeShift(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await cashLedgerService.closeShift(auth?.restaurantId || '', {
      countedCash: req.body.countedCash,
      date: req.body.date,
      branchId: req.body.branchId || auth?.branchIds?.[0],
      note: req.body.note,
      performedBy: auth?.name,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'closeShift'); }
}
