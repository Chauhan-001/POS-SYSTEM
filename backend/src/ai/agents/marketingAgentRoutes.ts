/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentRoutes.ts — HTTP surface for the marketing agent (spec Step 8).
 * Mounted at /api/ai/marketing-agent.
 *
 *   POST /recommend — read-only targeting recommendation + offer DRAFT.
 *   POST /proposal  — persists the recommendation as a CampaignProposal draft
 *                     (pending approval) via the deterministic mapper. Never
 *                     creates offers or sends campaigns by itself.
 *
 * Tenant identity comes only from verified authentication
 * (req.user.restaurantId) via the shared tenantContext contract.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { ai } from '../index';
import { runMarketingAgent, type MarketingAgentResult } from './marketingAgent';
import { createProposalFromAgentResult } from './marketingAgentProposal';

const router = Router();

function parseMinimumExperimentSize(body: unknown): number | undefined {
  const v = (body as { minimumExperimentSize?: unknown } | undefined)?.minimumExperimentSize;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

router.post(
  '/recommend',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(authReq);
      const result: MarketingAgentResult = await runMarketingAgent(
        { tenant: ctx },
        { minimumExperimentSize: parseMinimumExperimentSize(req.body) },
      );
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /proposal — recommend + persist as a pending CampaignProposal draft.
 * Deterministic: runMarketingAgent → audienceResolver → mapper → validation.
 * A NONE-signal result (new restaurant, ML down/synced-off, uplift gate fail)
 * produces NO proposal — only the agent's nextActions.
 */
router.post(
  '/proposal',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(authReq);
      const result: MarketingAgentResult = await runMarketingAgent(
        { tenant: ctx },
        { minimumExperimentSize: parseMinimumExperimentSize(req.body) },
      );
      const outcome = await createProposalFromAgentResult(ctx.restaurantId, result, {
        operator: ctx.actorName || ctx.actorId,
      });
      res.json({ success: true, result, proposal: outcome });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
