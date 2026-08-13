/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConsumptionController — theoretical consumption + reconciliation surfaces.
 */

import { NextFunction, Request, Response } from 'express';
import { consumptionService } from '../services/consumptionService';

/**
 * Forward async handler errors to the global errorHandler — without this a
 * thrown AppError becomes an unhandled rejection and crashes the process.
 */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function userOf(req: Request): { restaurantId: string; name?: string; branchId?: string } {
  const u = (req as any).user as { restaurantId?: string; name?: string; branchId?: string } | undefined;
  return (u || {}) as { restaurantId: string; name?: string; branchId?: string };
}

function ok(res: Response, data: unknown): void {
  res.json({ data });
}

export const listConsumptions = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await consumptionService.list(restaurantId, {
    date: q.date,
    branchId: q.branchId || branchId,
    productId: q.productId,
    limit: Number(q.limit) || 100,
  }));
});

export const consumptionByBill = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await consumptionService.getByBill(restaurantId, req.params.billId));
});

/** Phase 14 — theoretical vs actual variance report. */
export const reconcile = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await consumptionService.reconcile(restaurantId, {
    startDate: q.startDate,
    endDate: q.endDate,
    branchId: q.branchId || branchId,
    limit: Number(q.limit) || 100,
  }));
});
