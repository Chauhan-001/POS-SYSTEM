/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProfitabilityController — product / offer profitability surfaces.
 */

import { NextFunction, Request, Response } from 'express';
import { profitabilityService } from '../services/profitabilityService';

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

function userOf(req: Request): { restaurantId: string; branchId?: string } {
  const u = (req as any).user as { restaurantId?: string; branchId?: string } | undefined;
  return (u || {}) as { restaurantId: string; branchId?: string };
}

function ok(res: Response, data: unknown): void {
  res.json({ data });
}

export const productProfitability = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await profitabilityService.productProfitability(restaurantId, {
    startDate: q.startDate,
    endDate: q.endDate,
    branchId: q.branchId || branchId,
  }));
});

export const offerProfitability = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await profitabilityService.offerProfitability(restaurantId, req.params.offerId));
});

export const productMargin = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await profitabilityService.productMargin(
    restaurantId,
    req.params.productId,
    Number(q.recipeCost) || 0,
    q.branchId || branchId
  ));
});

export const offerPreview = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await profitabilityService.offerEconomics(restaurantId, req.body));
});

/**
 * POST /profitability/bill-preview — read-only bill-level economics for the
 * order screen (shown when a cashier applies an offer / has a combo).
 */
export const billPreview = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await profitabilityService.billEconomics(restaurantId, req.body));
});
