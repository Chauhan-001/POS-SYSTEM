/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionRoutes.ts — read-only authenticated surface for the Competition
 * Context view (spec §24/§14). The tenant identity comes ONLY from the
 * authenticated request (requireAuth) — a caller can never read another
 * restaurant's competition context (spec §27). The Google API key and base
 * URL never leave the backend. No writes, no campaign actions.
 *
 *   GET  /api/competition/context        — intelligence-ready context
 *   POST /api/competition/context/refresh — explicit on-demand refresh (§14)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { getNearbyCompetition, refreshNearbyCompetition } from './competitionService';

const router = Router();

function serialize(result: Awaited<ReturnType<typeof getNearbyCompetition>>) {
  return {
    success: result.available,
    available: result.available,
    reason: result.reason,
    dataStatus: result.dataStatus,
    providerAvailable: result.providerAvailable,
    lastRefreshedAt: result.lastRefreshedAt,
    searchRadiusMeters: result.searchRadiusMeters,
    competitors: result.competitors.map((c) => ({
      placeId: c.placeId,
      name: c.name,
      distanceMeters: c.distanceMeters,
      primaryType: c.primaryType,
    })),
    summary: result.intelligence
      ? {
          totalCompetitors: result.intelligence.summary.totalCompetitors,
          within500m: result.intelligence.summary.within500m,
          within1km: result.intelligence.summary.within1km,
          within2km: result.intelligence.summary.within2km,
          nearestDistanceMeters: result.intelligence.summary.nearestDistanceMeters,
          density: result.intelligence.summary.density,
          categoryDistribution: result.intelligence.summary.primaryTypeDistribution,
          cuisineOverlap: result.intelligence.summary.cuisineOverlap,
        }
      : undefined,
    signals: result.intelligence?.signals.map((s) => ({
      signalType: s.signalType,
      relevance: s.relevance,
      evidence: s.evidence,
    })),
    generatedAt: result.generatedAt,
  };
}

router.get(
  '/context',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const restaurantId = authReq.user?.restaurantId;
      if (!restaurantId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const result = await getNearbyCompetition({ restaurantId });
      res.json(serialize(result));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/context/refresh',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const restaurantId = authReq.user?.restaurantId;
      if (!restaurantId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const result = await refreshNearbyCompetition(restaurantId);
      res.json(serialize(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
