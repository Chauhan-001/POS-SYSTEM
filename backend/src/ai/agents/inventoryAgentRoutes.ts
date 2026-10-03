/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgentRoutes.ts — HTTP surface for the deterministic inventory agent.
 * Mounted at /api/ai/inventory-agent. Same contract style as the marketing
 * agent routes (ai/agents/marketingAgentRoutes.ts):
 *
 *   POST /recommend — read-only inventory action plan (reorders, stockout
 *                     forecasts, expiry risks, wastage signals).
 *
 * Tenant identity comes only from verified authentication
 * (req.user.restaurantId) via the shared tenantContext contract. The agent
 * NEVER writes to inventory — this surface is read-only by design.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { requireFeature } from '../../middleware/subscriptionMiddleware';
import { ai } from '../index';
import { runInventoryAgent } from './inventoryAgent';

const router = Router();

router.post(
  '/recommend',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  requireFeature('inventory'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      ai.bootstrap(); // idempotent
      const ctx = ai.tenantContextFromRequest(req as AuthenticatedRequest);
      const result = await runInventoryAgent({ tenant: ctx });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
