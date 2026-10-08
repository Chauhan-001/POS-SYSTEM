/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgentRoutes.ts — HTTP surface for the inventory agent.
 * Mounted at /api/ai/inventory-agent. Same contract style as the marketing
 * agent routes (ai/agents/marketingAgentRoutes.ts):
 *
 *   POST /recommend — read-only inventory action plan (reorders, stockout
 *                     forecasts, expiry risks, wastage signals).
 *
 * TWO modes on the SAME route (additive, backward compatible):
 *   - default (no `agentic`) → the EXISTING deterministic agent, byte-for-byte
 *     the same response shape existing callers already consume.
 *   - `{ "agentic": true, "task": "…" }` → the real agentic investigation: the
 *     LLM selects read-only inventory tools through the shared bounded loop and
 *     registry, the EXISTING deterministic analyzer consumes those exact
 *     observations, and the structured assessment is validated server-side.
 *
 * Tenant identity comes only from verified authentication
 * (req.user.restaurantId) via the shared tenantContext contract. The agent
 * NEVER writes to inventory — this surface is read-only by design.
 */

import { Router, Request, Response, NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { requireFeature } from '../../middleware/subscriptionMiddleware';
import { intelligenceLimiter, concurrencyGuardFor } from '../../middleware/rateLimiter';
import { ai } from '../index';
import { runInventoryAgent } from './inventoryAgent';
import { runInventoryAgentic } from './inventoryAgentic';

const router = Router();

/** Correlation id from the request (observability only). */
function requestCorrelationId(req: Request): string | undefined {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : undefined;
}

/** Apply a guard ONLY to agentic runs, so existing callers keep today's behavior. */
function agenticOnly(mw: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as { agentic?: unknown };
    if (body.agentic === true) return mw(req, res, next);
    return next();
  };
}

router.post(
  '/recommend',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  requireFeature('inventory'),
  // Rate + concurrency guards apply to the expensive agentic path only.
  agenticOnly(intelligenceLimiter),
  // Own counter: the inventory agent must not be blocked by — nor block — a
  // marketing run for the same restaurant.
  agenticOnly(concurrencyGuardFor('inventory_agent')),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(req as AuthenticatedRequest);
      const body = (req.body ?? {}) as { task?: unknown; agentic?: unknown };

      if (body.agentic === true) {
        const result = await runInventoryAgentic(
          { tenant: ctx },
          {
            task: typeof body.task === 'string' ? body.task : undefined,
            requestId: requestCorrelationId(req),
          },
        );
        res.json({ success: true, result });
        return;
      }

      const result = await runInventoryAgent({ tenant: ctx });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
