/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentRoutes.ts — HTTP surface for the Marketing module.
 * Mounted at /api/ai/marketing-agent.
 *
 * Exactly TWO marketing intelligence systems are served here:
 *
 *   POST /recommend     — SYSTEM #2: the AGENTIC INSIGHT agent. The LLM
 *                         investigates with read-only tools (LLM → tool →
 *                         result → LLM → … → stop) and returns an INSIGHT for
 *                         the owner. The removed deterministic targeting
 *                         ladder is NOT reachable from any route.
 *   POST /intelligence  — SYSTEM #3: the deterministic Intelligence Pipeline
 *                         (canonical signals → candidate engine → economics →
 *                         ML → ranking → grounded explanation) returning
 *                         ranked, ACTIONABLE recommendations.
 *   POST /proposal      — persists the EXACT ranked recommendation the owner
 *                         selected as a pending CampaignProposal draft
 *                         (`sourceRecommendationId`), for owner approval.
 *   GET  /insight-runs  — lists recent REPLAYABLE investigation episodes for
 *                         this restaurant (bounded, owner/manager only).
 *   GET  /insight-runs/:runId — one full replay: per step, the evidence the
 *                         model saw, the tool it chose and the result it got.
 *
 * Tenant identity comes only from verified authentication
 * (req.user.restaurantId) via the shared tenantContext contract. Nothing here
 * creates, sends or schedules anything: approval stays mandatory.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { intelligenceLimiter, intelligenceConcurrencyGuard, concurrencyGuardFor } from '../../middleware/rateLimiter';
import { ai } from '../index';
import { runMarketingAgent } from './marketingAgent';
import { createProposalFromRankedRecommendation, type SelectedRecommendationInput } from './marketingAgentProposal';
import { runMarketingIntelligence } from '../intelligence/marketingIntelligencePipeline';
import { runMarketingAnalyze } from '../marketing/analyze';
import { analyzeRequestSchema } from '../marketing/contracts';
import { listReplayEpisodes, getReplayEpisode } from '../observability/agentUsage';

const router = Router();

/** Optional correlation id for the bounded-loop observability trace. */
function requestCorrelationId(req: Request): string | undefined {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : undefined;
}

/** Owner question for the agentic insight run (bounded, never trusted raw). */
function parseTask(body: unknown): string | undefined {
  const t = (body as { task?: unknown } | undefined)?.task;
  return typeof t === 'string' && t.trim().length > 0 ? t.slice(0, 300) : undefined;
}

/**
 * POST /recommend — SYSTEM #2, the agentic insight agent.
 *
 * Read-only investigation: the LLM selects tools from the marketing policy,
 * reads their results, and stops when the evidence is sufficient. The response
 * carries the insight card + the exact investigation trace. On any LLM
 * failure it returns an explicitly DEGRADED insight — it never falls back to
 * the removed deterministic targeting ladder, and it never invents facts.
 */
router.post(
  '/recommend',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  // Bounded agentic runs hit the LLM + a tool fan-out: same per-tenant
  // intelligence rate limit as the pipeline. The concurrency guard is NOT
  // applied here on purpose — the Marketing page runs this insight call and
  // /intelligence together, and a per-tenant cap of one would make the two
  // sections mutually exclusive. The run is already bounded by agent budgets.
  intelligenceLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(authReq);
      const result = await runMarketingAgent(
        { tenant: ctx },
        { task: parseTask(req.body), requestId: requestCorrelationId(req) },
      );
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /analyze — the CANONICAL Marketing Agent path.
 *
 * context builder → signal scanner → sequential DOMAIN investigation by the
 * Marketing Manager → situation model → candidate engine → ML enrichment →
 * deterministic validation gate → ranking + diversity → final critic →
 * 8–10 evidence-backed recommendations.
 *
 * READ-ONLY and owner-approved: it creates nothing. `approvalRequired` is
 * always true in the response; the existing /proposal route remains the only
 * way to turn a recommendation into a draft for owner approval.
 */
router.post(
  '/analyze',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  intelligenceLimiter,
  // Deep analysis has its OWN per-tenant counter: it is an owner-invoked,
  // minutes-long sequential investigation, and sharing one counter with
  // /intelligence meant a page load in flight blocked the owner's own
  // "Run deep analysis" click with a 429.
  concurrencyGuardFor('marketing_analyze'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          details: parsed.error.issues.map((i) => i.message),
        });
        return;
      }
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(authReq);
      const result = await runMarketingAnalyze({
        tenant: ctx,
        goal: parsed.data.goal,
        lookbackDays: parsed.data.lookbackDays,
        limit: parsed.data.limit,
        requestId: requestCorrelationId(req),
      });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /intelligence — SYSTEM #3: the canonical Intelligence Pipeline.
 *
 * Runs the deterministic business investigation (signals), the existing
 * candidate engine, ML semantics, deterministic ranking and a grounded
 * explanation. READ-ONLY: it never creates offers, campaigns or proposals —
 * owner approval remains the only path to action (use /proposal for the draft).
 */
router.post(
  '/intelligence',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  // Tenant-aware rate limit + concurrency cap (no tool storms).
  intelligenceLimiter,
  intelligenceConcurrencyGuard,
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
        requestId: requestCorrelationId(req),
      });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /insight-runs — recent replayable AI Insights investigations.
 *
 * Read-only observability: bounded list, tenant-scoped from the verified
 * session, no payloads (the replay detail is one explicit GET away). Owners
 * and managers only — this is diagnostic data, not a customer surface.
 */
router.get(
  '/insight-runs',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const limitRaw = (req.query.limit as string | undefined) ?? undefined;
      const limit = typeof limitRaw === 'string' && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
      const runs = await listReplayEpisodes(ctxRestaurantId(authReq), { agent: 'marketing_agent', limit });
      res.json({ success: true, result: runs });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /insight-runs/:runId — one full replay episode (evidence → decision
 * → result per step). Tenant-scoped: another restaurant's run id returns 404,
 * and a run that recorded no episode returns 404 rather than a fake chain.
 */
router.get(
  '/insight-runs/:runId',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const runId = typeof req.params.runId === 'string' ? req.params.runId.slice(0, 128) : '';
      const episode = await getReplayEpisode(ctxRestaurantId(authReq), runId);
      if (!episode) {
        res.status(404).json({ success: false, error: 'Investigation episode not found.' });
        return;
      }
      res.json({ success: true, result: episode });
    } catch (err) {
      next(err);
    }
  },
);

/** Restaurant id for the read model — the verified tenant, never a query param. */
function ctxRestaurantId(req: AuthenticatedRequest): string {
  return String((req.user as { restaurantId?: string } | undefined)?.restaurantId ?? '');
}

/**
 * POST /proposal — persist the EXACT ranked recommendation the owner selected.
 *
 * The agentic insight agent is NEVER invoked here: an insight is advisory and
 * cannot become a campaign. Only a ranked intelligence recommendation carries
 * the authoritative economics + provenance that a proposal needs, and the
 * selected recommendation id/snapshot is stored as `sourceRecommendationId`.
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
      const selected = (req.body ?? {}).recommendation as SelectedRecommendationInput | undefined;

      if (!selected?.id || !selected?.type || !selected?.title) {
        res.status(400).json({
          success: false,
          error:
            'A ranked recommendation (id, type, title) is required. Agentic insights are advisory and cannot be turned into a proposal — select a Recommended Action instead.',
        });
        return;
      }

      const outcome = await createProposalFromRankedRecommendation(ctx.restaurantId, selected, {
        operator: ctx.actorName || ctx.actorId,
      });
      res.json({ success: true, result: null, proposal: outcome });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
