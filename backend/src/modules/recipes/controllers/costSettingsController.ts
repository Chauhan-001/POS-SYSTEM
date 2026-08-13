/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostSettingsController — restaurant-level cost assumptions (layered model).
 * Tenant always derived from the authenticated user.
 */

import { NextFunction, Request, Response } from 'express';
import { costSettingsService } from '../services/costSettingsService';

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function userOf(req: Request): { restaurantId: string; name?: string } {
  const u = (req as any).user as { restaurantId?: string; name?: string } | undefined;
  return (u || {}) as { restaurantId: string; name?: string };
}

export const getCostSettings = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  res.json({ data: await costSettingsService.get(restaurantId) });
});

export const updateCostSettings = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  res.json({ data: await costSettingsService.update(restaurantId, req.body, { operator: name }) });
});

export const calibrateCostSettings = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  res.json({ data: await costSettingsService.calibrate(restaurantId, { days: Number(q.days) || undefined }) });
});
