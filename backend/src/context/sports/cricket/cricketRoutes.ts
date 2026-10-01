/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketRoutes.ts — read-only admin surface for the Cricket Context view
 * (Cricket Phase 2, spec §21). Admin-only (requireAdminAuth); the provider key
 * and base URL are never exposed — only normalized, relevance-filtered
 * matches. No writes, no campaign actions.
 *
 *   GET /api/sports/cricket/context?restaurantId=<id>&daysAhead=<n>
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdminAuth } from '../../../middleware/authMiddleware';
import { getSportsContext } from './cricketService';

const router = Router();

router.get(
  '/cricket/context',
  requireAdminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query as { restaurantId?: string; daysAhead?: string };
      const daysAhead = q.daysAhead ? Math.min(Math.max(parseInt(q.daysAhead, 10) || 14, 1), 60) : 14;
      const result = await getSportsContext({ restaurantId: q.restaurantId, daysAhead });
      res.json({
        success: true,
        available: result.available,
        reason: result.reason,
        dataStatus: result.dataStatus,
        providerAvailable: result.providerAvailable,
        lastFetchedAt: result.lastFetchedAt,
        matches: (result.relevantMatches ?? []).map((m) => ({
          matchId: m.externalId,
          name: m.name,
          competition: m.competition,
          matchType: m.matchType,
          status: m.status,
          isIndiaMatch: m.isIndiaMatch,
          venue: m.venue,
          date: m.date,
          dateTimeGMT: m.dateTimeGMT,
          localDateTime: m.localDateTime,
          timezone: m.timezone,
          timeWindow: m.timeWindow,
          operatingHoursOverlap: m.operatingHoursOverlap,
          relevance: m.relevance,
          signals: m.signals.map((s) => s.signalType),
        })),
        generatedAt: result.generatedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
