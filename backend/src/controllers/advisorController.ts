/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advisor Controller — Business Advisor endpoints.
 *
 * Tenant identity is always derived from the JWT (req.user), never from the
 * body. Branch scope is validated against the tenant before use.
 */

import { Request, Response } from 'express';
import {
  generateAdvisorRecommendations,
  recordAdvisorAction,
  recordAdvisorOutcome,
  listAdvisorRecommendations,
  markRecommendationConverted,
  ADVISOR_GOALS,
} from '../services/advisorService';
import type { AdvisorGoal } from '../models/AdvisorRecommendation';
import { resolveBranchScope } from '../services/recommendationContext';

function getRestaurantId(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

/**
 * POST /api/advisor/recommend — analyze the restaurant for a goal and return
 * 3-5 ranked, persisted recommendations. Deterministic facts + optional AI
 * explanation (fallback copy when the LLM is unavailable).
 */
export async function recommend(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const goal: AdvisorGoal = String(req.body?.goal || 'increase_sales') as AdvisorGoal;
    if (!ADVISOR_GOALS.includes(goal)) {
      res.status(400).json({ error: 'Invalid goal' });
      return;
    }

    let branchScope: { branchId?: string } | null = {};
    if (req.body?.branchId) {
      branchScope = await resolveBranchScope(String(restaurantId), String(req.body.branchId));
      if (!branchScope) { res.status(400).json({ error: 'Branch not found for this restaurant' }); return; }
    }

    const result = await generateAdvisorRecommendations(String(restaurantId), goal, {
      branchId: branchScope.branchId,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[Advisor] recommend error:', error.message);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

/**
 * POST /api/advisor/:id/action — record accepted/rejected/dismissed + action taken.
 */
export async function recordAction(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const { status, actionTaken } = req.body || {};
    if (!['accepted', 'rejected', 'dismissed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const ok = await recordAdvisorAction(String(restaurantId), String(req.params.id), status, actionTaken);
    if (!ok) { res.status(404).json({ error: 'Recommendation not found' }); return; }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Advisor] action error:', error.message);
    res.status(500).json({ error: 'Failed to record action' });
  }
}

/**
 * POST /api/advisor/:id/outcome — record a measurable result (feedback loop).
 */
export async function recordOutcome(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const outcome = String(req.body?.outcome || '').trim();
    if (!outcome) { res.status(400).json({ error: 'Missing outcome' }); return; }
    const ok = await recordAdvisorOutcome(String(restaurantId), String(req.params.id), outcome);
    if (!ok) { res.status(404).json({ error: 'Recommendation not found' }); return; }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Advisor] outcome error:', error.message);
    res.status(500).json({ error: 'Failed to record outcome' });
  }
}

/**
 * GET /api/advisor/history — recent recommendations + their status/outcome.
 */
export async function history(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const goal = ADVISOR_GOALS.includes(req.query?.goal as AdvisorGoal) ? (req.query.goal as AdvisorGoal) : undefined;
    const items = await listAdvisorRecommendations(String(restaurantId), { goal, limit: 20 });
    res.json({ recommendations: items });
  } catch (error: any) {
    console.error('[Advisor] history error:', error.message);
    res.status(500).json({ error: 'Failed to load history' });
  }
}

/**
 * POST /api/advisor/:id/converted — mark a recommendation as converted
 * when an offer is successfully created from it.
 */
export async function markConverted(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const { offerId, campaignId } = req.body || {};
    if (!offerId) { res.status(400).json({ error: 'offerId required' }); return; }
    const ok = await markRecommendationConverted(
      String(restaurantId),
      String(req.params.id),
      String(offerId),
      campaignId ? String(campaignId) : undefined,
    );
    if (!ok) { res.status(404).json({ error: 'Recommendation not found' }); return; }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Advisor] converted error:', error.message);
    res.status(500).json({ error: 'Failed to mark as converted' });
  }
}
