/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportRoutes.ts — HTTP surface for the Daily Summary / Z-Report
 * Intelligence pipeline. Mounted at /api/ai/z-report.
 *
 *   POST /generate — user-triggered "Generate Daily Summary".
 *
 * SEPARATE from the deterministic Z-report (`GET /api/reports/closing/z`),
 * which stays exactly as it is: this route reads that report as ONE input and
 * returns AI-synthesized owner-facing intelligence on top of it.
 *
 * Tenant identity comes only from verified authentication
 * (req.user.restaurantId) via the shared tenantContext contract. A requested
 * branchId is validated against that tenant before any read (a foreign branch
 * is rejected with TOOL_TENANT_MISMATCH). Nothing here writes business data:
 * the pipeline is read-only apart from its own evidence/report history.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { requireFeature } from '../../middleware/subscriptionMiddleware';
import { intelligenceLimiter, concurrencyGuardFor } from '../../middleware/rateLimiter';
import { ai } from '../index';
import { generateDailySummaryIntelligence } from './zReportAgent';

const router = Router();

/** Correlation id for the run (observability; also persisted as runId). */
function requestCorrelationId(req: Request): string | undefined {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : undefined;
}

/**
 * POST /generate — Generate Daily Summary.
 *
 * Body (all optional):
 *   { date?: 'YYYY-MM-DD', branchId?: string,
 *     includeBatch3?: boolean | 'auto' }
 *
 * Invalid input is rejected with 400 BEFORE any data read; the date format and
 * branch ownership are re-validated inside the pipeline (server-side, not
 * trusted from the body).
 */
router.post(
  '/generate',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  // Same subscription feature as GET /reports/closing/z — a tenant that can
  // read the deterministic Z-report can ask for its intelligence.
  requireFeature('analytics'),
  // A run does a bounded parallel tool fan-out plus ONE synthesis call: same
  // per-tenant intelligence rate limit as every other AI surface, with its OWN
  // concurrency counter so a daily-summary run can never block (or be blocked
  // by) a marketing or inventory run for the same restaurant.
  intelligenceLimiter,
  concurrencyGuardFor('z_report'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { date?: unknown; branchId?: unknown; includeBatch3?: unknown };

      if (body.date !== undefined && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) {
        res.status(400).json({ success: false, error: 'date must be a valid YYYY-MM-DD calendar date' });
        return;
      }
      if (body.branchId !== undefined && (typeof body.branchId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(body.branchId))) {
        res.status(400).json({ success: false, error: 'branchId must be a 24-character hex id' });
        return;
      }
      if (
        body.includeBatch3 !== undefined &&
        body.includeBatch3 !== 'auto' &&
        typeof body.includeBatch3 !== 'boolean'
      ) {
        res.status(400).json({ success: false, error: "includeBatch3 must be a boolean or 'auto'" });
        return;
      }

      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(req as AuthenticatedRequest);
      const result = await generateDailySummaryIntelligence({
        tenant: ctx,
        ...(typeof body.date === 'string' ? { date: body.date } : {}),
        branchId: typeof body.branchId === 'string' ? body.branchId : ctx.branchId,
        includeBatch3: body.includeBatch3 === undefined ? 'auto' : (body.includeBatch3 as boolean | 'auto'),
        ...(requestCorrelationId(req) ? { executionId: requestCorrelationId(req)! } : {}),
      });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
