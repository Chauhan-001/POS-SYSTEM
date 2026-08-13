/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostIntelligenceController — cost intelligence report, AI insights, and the
 * AI offer assistant. All deterministic math is tenant-scoped; the LLM is
 * advisory only and everything is confirmed by the user before any mutation.
 */

import { NextFunction, Request, Response } from 'express';
import { costIntelligenceService } from '../services/costIntelligenceService';
import { offerAssistantService } from '../services/offerAssistantService';

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

export const costIntelligence = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await costIntelligenceService.metrics(restaurantId, {
    days: Number(q.days) || 60,
    branchId: q.branchId || branchId,
  }));
});

export const costInsights = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const body = (req.body || {}) as { days?: number };
  ok(res, await costIntelligenceService.insights(restaurantId, {
    days: Number(body.days) || 60,
    branchId,
  }));
});

export const offerAssistant = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const body = (req.body || {}) as { text?: string };
  ok(res, await offerAssistantService.propose(restaurantId, String(body.text || '')));
});

export const comboAssistant = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const body = (req.body || {}) as { text?: string };
  ok(res, await offerAssistantService.proposeCombo(restaurantId, String(body.text || '')));
});


