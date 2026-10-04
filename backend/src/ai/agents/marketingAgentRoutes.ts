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
import { runMarketingIntelligence } from '../intelligence/marketingIntelligencePipeline';

const router = Router();

function parseMinimumExperimentSize(body: unknown): number | undefined {
  const v = (body as { minimumExperimentSize?: unknown } | undefined)?.minimumExperimentSize;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

/** Optional correlation id for the Phase 1 bounded-loop observability trace. */
function requestCorrelationId(req: Request): string | undefined {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : undefined;
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
        {
          minimumExperimentSize: parseMinimumExperimentSize(req.body),
          // Phase 1: bounded LLM investigation first; any LLM failure degrades
          // to the unchanged deterministic ladder (contract + output intact).
          agentic: true,
          requestId: requestCorrelationId(req),
        },
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
/**
 * POST /intelligence — Phase 3-7 intelligence pipeline (additive surface).
 *
 * Runs the canonical business investigation (signals), the existing candidate
 * engine, ML semantics, deterministic ranking and a grounded explanation.
 * READ-ONLY: it never creates offers, campaigns or proposals — owner approval
 * remains the only path to action (use /proposal for the draft proposal).
 */
router.post(
  '/intelligence',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(authReq);
      const body = (req.body ?? {}) as { limit?: unknown; includeExplanation?: unknown; lookbackDays?: unknown };
      const limit =
        typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 12
          ? body.limit
          : undefined;
      const lookbackDays =
        typeof body.lookbackDays === 'number' && Number.isInteger(body.lookbackDays) && body.lookbackDays >= 7 && body.lookbackDays <= 365
          ? body.lookbackDays
          : undefined;
      const result = await runMarketingIntelligence({
        tenant: ctx,
        branchId: ctx.branchId,
        limit,
        lookbackDays,
        explain: body.includeExplanation !== false,
      });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

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
        {
          minimumExperimentSize: parseMinimumExperimentSize(req.body),
          // Phase 1: bounded LLM investigation first; any LLM failure degrades
          // to the unchanged deterministic ladder (contract + output intact).
          agentic: true,
          requestId: requestCorrelationId(req),
        },
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
