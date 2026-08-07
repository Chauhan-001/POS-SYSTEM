/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Routes — Dedicated AI API endpoints.
 * All routes are POST (they receive data from frontend, process, return results).
 * The AI NEVER has direct database access — it only processes what's sent.
 *
 * Route prefix: /api/ai
 *
 * Endpoints:
 *   POST /api/ai/summary              — Daily AI business summary
 *   POST /api/ai/closing              — End-of-day closing assistant
 *   POST /api/ai/inventory-health     — Inventory health score
 *   POST /api/ai/purchase-recs        — Purchase recommendations
 *   POST /api/ai/low-stock            — Low stock predictions
 *   POST /api/ai/waste-analysis       — Waste analysis
 *   POST /api/ai/voice-parse          — Voice inventory command parsing
 *   POST /api/ai/weather              — Weather-based recommendations
 *   GET  /api/ai/status               — AI module health/status
 */

import { Router } from 'express';
import {
  inventoryHealth,
  purchaseRecommendations,
  lowStockPredictions,
  dailySummary,
  wasteAnalysis,
  voiceParse,
  closingAssistant,
  weatherRecommendation,
  offerRecommendations,
} from '../controllers/aiController';
import { requireAuth } from '../../../middleware/authMiddleware';
import { requireFeature } from '../../../middleware/subscriptionMiddleware';
import { aiRateLimiter, voiceRateLimiter } from '../middleware/aiRateLimiter';
import { validate } from '../../../middleware/validate';
import {
  inventoryHealthSchema,
  purchaseRecSchema,
  lowStockSchema,
  dailySummarySchema,
  wasteAnalysisSchema,
  voiceParseSchema,
  closingAssistantSchema,
  weatherSchema,
  offerRecommendationsSchema,
} from '../validators/ai';
import { isAiEnabled } from '../config';

const router = Router();

// ─── AI STATUS (public, uses publicLimiter — imported from parent) ──

/**
 * GET /api/ai/status — Check if AI module is configured and ready.
 * Lightweight public endpoint. Rate-limited by parent's publicLimiter.
 */
router.get('/status', (_req, res) => {
  res.json({
    enabled: isAiEnabled(),
    provider: process.env.AI_PROVIDER || 'not configured',
    features: [
      'summary', 'closing', 'inventory-health', 'purchase-recommendation',
      'low-stock', 'waste-analysis', 'voice-parse', 'weather', 'offers',
    ],
  });
});

// ─── AUTHENTICATED AI ROUTES ───────────────────────────────────────
// Validate BEFORE rate limiter to avoid wasting slots on bad payloads

router.post('/summary',
  requireAuth,
  requireFeature('ai'),
  validate({ body: dailySummarySchema }),
  aiRateLimiter,
  dailySummary,
);
// Alias for spec compatibility
router.post('/daily-summary',
  requireAuth,
  requireFeature('ai'),
  validate({ body: dailySummarySchema }),
  aiRateLimiter,
  dailySummary,
);

router.post('/closing-summary',
  requireAuth,
  requireFeature('ai'),
  validate({ body: closingAssistantSchema }),
  aiRateLimiter,
  closingAssistant,
);
// Alias for frontend compatibility
router.post('/closing',
  requireAuth,
  requireFeature('ai'),
  validate({ body: closingAssistantSchema }),
  aiRateLimiter,
  closingAssistant,
);

router.post('/inventory-health',
  requireAuth,
  requireFeature('ai'),
  validate({ body: inventoryHealthSchema }),
  aiRateLimiter,
  inventoryHealth,
);

router.post('/purchase-recommendation',
  requireAuth,
  requireFeature('ai'),
  validate({ body: purchaseRecSchema }),
  aiRateLimiter,
  purchaseRecommendations,
);
// Alias for frontend compatibility
router.post('/purchase-recs',
  requireAuth,
  requireFeature('ai'),
  validate({ body: purchaseRecSchema }),
  aiRateLimiter,
  purchaseRecommendations,
);

router.post('/low-stock',
  requireAuth,
  requireFeature('ai'),
  validate({ body: lowStockSchema }),
  aiRateLimiter,
  lowStockPredictions,
);

router.post('/waste-analysis',
  requireAuth,
  requireFeature('ai'),
  validate({ body: wasteAnalysisSchema }),
  aiRateLimiter,
  wasteAnalysis,
);

router.post('/inventory-voice',
  requireAuth,
  requireFeature('ai'),
  validate({ body: voiceParseSchema }),
  voiceRateLimiter,
  voiceParse,
);
// Alias for frontend compatibility
router.post('/voice-parse',
  requireAuth,
  requireFeature('ai'),
  validate({ body: voiceParseSchema }),
  voiceRateLimiter,
  voiceParse,
);

router.post('/weather',
  requireAuth,
  requireFeature('ai'),
  validate({ body: weatherSchema }),
  aiRateLimiter,
  weatherRecommendation,
);

router.post('/offer-recommendations',
  requireAuth,
  requireFeature('ai'),
  validate({ body: offerRecommendationsSchema }),
  aiRateLimiter,
  offerRecommendations,
);
// Alias for frontend compatibility
router.post('/offers',
  requireAuth,
  requireFeature('ai'),
  validate({ body: offerRecommendationsSchema }),
  aiRateLimiter,
  offerRecommendations,
);

export default router;
