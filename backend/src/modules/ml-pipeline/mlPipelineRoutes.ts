/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ML Pipeline Routes — Node-side surface for the ML data bridge (P0).
 *
 *   POST /api/ml-pipeline/demand/sync   → extract this tenant's bills and push
 *                                         them to the Demand model service
 *   GET  /api/ml-pipeline/status        → is the bridge configured?
 *   GET  /api/ml-pipeline/demand/preview→ extraction preview (no push)
 *
 * SECURITY (non-negotiable, mirrors audit P0 #2):
 *   - All routes require a verified JWT (requireAuth).
 *   - restaurantId is taken ONLY from req.user.restaurantId (server-side),
 *     never from body/query/headers. A tenant can therefore never sync,
 *     preview, or even describe another tenant's data.
 *   - Sync mutates the ML service's dataset → restricted to owner/manager.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import { runDemandSync, type DemandSyncResult } from './demandSyncService';
import { extractBillsForDemandModel, type ExtractWindow } from './billExtractor';
import { getDemandClientConfig } from './demandModelClient';
import { pullDemandPredictions, getDemandPredictions, pullBasketComboPredictions, getBasketPredictions } from './predictionService';
import { runBasketSync, triggerBasketTrainingSafe } from './basketSyncService';
import { extractBillsForBasket } from './basketExtractor';
import { getBasketClientConfig } from './basketModelClient';
import { getUplitClientConfig, fetchUplitRankedCustomers, fetchUplitCampaignTargeting } from './uplitModelClient';
import { getSegmentClientConfig } from './segmentModelClient';
import { runSegmentSync, storeSegments, getStoredSegments } from './segmentSyncService';
import {
  recordOfferAssignment,
  recordOfferConversion,
  exportUplitExperimentRows,
} from './experimentTracker';
import { pushExperimentEventsToUplit } from './uplitModelClient';
import { evaluateExperimentRandomization } from './experimentEval';
import mongoose from 'mongoose';
import MLPrediction from '../../models/intelligence/MLPrediction';
import MLPredictionOutcome from '../../models/intelligence/MLPredictionOutcome';
import { PlatformEvent } from '../adminReports/models';

const router = Router();

// ─── Local date validation (YYYY-MM-DD, same format as Bill.date) ───────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseWindow(req: AuthenticatedRequest): ExtractWindow {
  const body = (req.body || {}) as Record<string, unknown>;
  const query = (req.query || {}) as Record<string, string>;
  const fromDate = (body.fromDate || query.fromDate) as string | undefined;
  const toDate = (body.toDate || query.toDate) as string | undefined;
  const limitBillsRaw = (body.limitBills || query.limitBills) as string | number | undefined;

  if (fromDate && !DATE_RE.test(fromDate)) {
    throw Object.assign(new Error('fromDate must be YYYY-MM-DD'), { statusCode: 400 });
  }
  if (toDate && !DATE_RE.test(toDate)) {
    throw Object.assign(new Error('toDate must be YYYY-MM-DD'), { statusCode: 400 });
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw Object.assign(new Error('fromDate must be ≤ toDate'), { statusCode: 400 });
  }

  let limitBills: number | undefined;
  if (limitBillsRaw !== undefined && limitBillsRaw !== null && limitBillsRaw !== '') {
    const n = typeof limitBillsRaw === 'number' ? limitBillsRaw : parseInt(String(limitBillsRaw), 10);
    if (!Number.isFinite(n) || n < 1 || n > 50_000) {
      throw Object.assign(new Error('limitBills must be between 1 and 50000'), { statusCode: 400 });
    }
    limitBills = n;
  }

  return { fromDate, toDate, limitBills };
}

function getVerifiedRestaurantId(req: AuthenticatedRequest): string {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) {
    throw Object.assign(new Error('Authenticated user has no restaurantId'), { statusCode: 403 });
  }
  return restaurantId;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/ml-pipeline/demand/sync
 * Body (all optional): { fromDate?, toDate?, limitBills? }
 * Extracts the tenant's non-voided bills and pushes them to the Demand model.
 */
router.post(
  '/demand/sync',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const window = parseWindow(authReq);
      const result: DemandSyncResult = await runDemandSync(
        restaurantId,
        window,
        { jwt: extractBearerTokenSafe(authReq) }
      );
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/ml-pipeline/demand/predictions/pull
 * Body: { productIds: string[], horizonDays?: number }
 * Pulls forecasts from the Demand model for the given products and stores
 * them in the ml_predictions collection (idempotent upserts).
 */
router.post(
  '/demand/predictions/pull',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as { productIds?: unknown; horizonDays?: unknown };
      const productIds = Array.isArray(body.productIds)
        ? body.productIds.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 200)
        : [];
      if (productIds.length === 0) {
        return res.status(400).json({ success: false, error: 'productIds (non-empty string array, max 200) is required' });
      }
      const horizonDays =
        typeof body.horizonDays === 'number' && body.horizonDays >= 1 && body.horizonDays <= 30
          ? Math.floor(body.horizonDays)
          : 7;
      const stats = await pullDemandPredictions(restaurantId, {
        productIds,
        horizonDays,
        jwt: extractBearerTokenSafe(authReq),
      });
      res.json({ success: true, stats });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/ml-pipeline/demand/predictions?productId=&fromDate=&toDate=
 * Tenant-scoped read of stored demand predictions (for dashboards/agent).
 */
router.get('/demand/predictions', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const query = req.query as Record<string, string>;
    const predictions = await getDemandPredictions(restaurantId, {
      productId: query.productId || undefined,
      fromDate: DATE_RE.test(query.fromDate || '') ? query.fromDate : undefined,
      toDate: DATE_RE.test(query.toDate || '') ? query.toDate : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    res.json({ success: true, count: predictions.length, predictions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ml-pipeline/status
 * Reports whether the ML bridge is configured (no data touched).
 */
router.get('/status', requireAuth, (req: Request, res: Response) => {
  const cfg = getDemandClientConfig();
  const basketCfg = getBasketClientConfig();
  const uplitCfg = getUplitClientConfig();
  res.json({
    success: true,
    demandModel: {
      configured: cfg !== null,
      baseUrl: cfg ? cfg.baseUrl : null,
      serviceTokenSet: Boolean(cfg?.serviceToken),
      timeoutMs: cfg?.timeoutMs ?? null,
    },
    basketModel: {
      configured: basketCfg !== null,
      baseUrl: basketCfg ? basketCfg.baseUrl : null,
      serviceTokenSet: Boolean(basketCfg?.serviceToken),
      timeoutMs: basketCfg?.timeoutMs ?? null,
    },
    uplitModel: {
      configured: uplitCfg !== null,
      baseUrl: uplitCfg ? uplitCfg.baseUrl : null,
      serviceTokenSet: Boolean(uplitCfg?.serviceToken),
      timeoutMs: uplitCfg?.timeoutMs ?? null,
    },
    segmentModel: {
      configured: getSegmentClientConfig() !== null,
      baseUrl: getSegmentClientConfig()?.baseUrl ?? null,
    },
  });
});

/**
 * GET /api/ml-pipeline/demand/preview?limitBills=500
 * Runs the extractor WITHOUT pushing to the ML service, so owners can inspect
 * exactly what would be synced. Same tenant scoping as the sync route.
 */
router.get('/demand/preview', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const window = parseWindow(authReq);
    const { envelope, stats } = await extractBillsForDemandModel(restaurantId, window);
    res.json({
      success: true,
      stats,
      // Small honest sample: first 3 orders only (avoid dumping the ledger)
      sampleOrders: envelope.orders.slice(0, 3),
      totalOrders: envelope.orders.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Basket (combo intelligence) bridge ────────────────────────────────────

/**
 * POST /api/ml-pipeline/basket/sync — extract bills → Basket transactions.
 * Body (optional): { fromDate?, toDate?, limitBills? }
 */
router.post(
  '/basket/sync',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const window = parseWindow(authReq);
      const result = await runBasketSync(restaurantId, window);
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/ml-pipeline/basket/preview — extraction preview (no push). */
router.get('/basket/preview', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const window = parseWindow(authReq);
    const { envelope, stats } = await extractBillsForBasket(restaurantId, window);
    res.json({
      success: true,
      stats,
      sampleTransactions: envelope.transactions.slice(0, 3),
      totalTransactions: envelope.transactions.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ml-pipeline/basket/train — per-tenant training trigger (audit
 * item #5 wiring). The Basket service's own sufficiency gates decide whether
 * a model actually trains; the result is reported verbatim.
 */
router.post(
  '/basket/train',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const outcome = await triggerBasketTrainingSafe(restaurantId);
      res.json({ success: outcome.ok, ...outcome });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/ml-pipeline/basket/predictions/pull — refresh stored combo
 * predictions (basket → ml_predictions).
 */
router.post(
  '/basket/predictions/pull',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const stats = await pullBasketComboPredictions(restaurantId);
      res.json({ success: true, stats });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/ml-pipeline/basket/predictions — stored combo rows (read). */
router.get('/basket/predictions', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const limitRaw = (req.query as Record<string, string>).limit;
    const predictions = await getBasketPredictions(restaurantId, {
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
    });
    res.json({ success: true, count: predictions.length, predictions });
  } catch (err) {
    next(err);
  }
});

// ─── Offer experiments (uplift training data, audit items #4/#5) ────────────

/**
 * POST /api/ml-pipeline/experiments/assign
 * Body: { customerId, offerId? } — records an offer assignment (treatment)
 * with a pre-treatment feature snapshot. Idempotent per (customer, offer).
 */
router.post(
  '/experiments/assign',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as { customerId?: unknown; offerId?: unknown; branchId?: unknown };
      const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId is required' });
      }
      const event = await recordOfferAssignment({
        restaurantId,
        customerId,
        offerId: typeof body.offerId === 'string' && body.offerId.trim() ? body.offerId.trim() : null,
        branchId: typeof body.branchId === 'string' && body.branchId.trim() ? body.branchId.trim() : null,
      });
      res.json({ success: true, eventId: String(event._id) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/ml-pipeline/experiments/convert
 * Body: { customerId, offerId?, redeemedBillId? } — records a redemption
 * backed by a real bill (purchase=1). Idempotent.
 */
router.post(
  '/experiments/convert',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as { customerId?: unknown; offerId?: unknown; redeemedBillId?: unknown };
      const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId is required' });
      }
      const event = await recordOfferConversion({
        restaurantId,
        customerId,
        offerId: typeof body.offerId === 'string' && body.offerId.trim() ? body.offerId.trim() : null,
        redeemedBillId: typeof body.redeemedBillId === 'string' && body.redeemedBillId.trim() ? body.redeemedBillId.trim() : null,
      });
      res.json({ success: true, eventId: String(event._id) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/ml-pipeline/experiments/push — exports the ledger to Uplit's
 * POST /api/ingest/experiment-events (audit item #5). No-ops with an honest
 * response when ML_UPLIT_BASE_URL is unset.
 */
router.post(
  '/experiments/push',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const result = await pushExperimentEventsToUplit(restaurantId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Uplit proxy reads (uplift ranking for the dashboard) ───────────────

/**
 * GET /api/ml-pipeline/uplift/customers — ranked uplift customers (proxy).
 * Tenant identity is injected server-side; Uplit resolves it from the
 * service headers (x-restaurant-id, valid under ML_ALLOW_HEADER_TENANT=on).
 */
router.get('/uplift/customers', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const limitRaw = parseInt((req.query as Record<string, string>).limit || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 50;
    const data = await fetchUplitRankedCustomers(restaurantId, limit);
    res.json({ success: true, ...data });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not configured')) {
      return res.status(503).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/ml-pipeline/uplift/targeting — campaign target list (proxy).
 * Body: { limit?: number }
 */
router.post('/uplift/targeting', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const body = (req.body || {}) as { limit?: unknown };
    const limit = typeof body.limit === 'number' && body.limit >= 1 ? Math.min(Math.floor(body.limit), 1000) : 50;
    const data = await fetchUplitCampaignTargeting(restaurantId, limit);
    res.json({ success: true, ...data });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not configured')) {
      return res.status(503)!.json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ─── Customer segmentation (4th model bridge) ─────────────────────────────

/**
 * POST /api/ml-pipeline/segments/sync — extract customers → push + gated
 * training → fetch segments → store into ml_predictions.
 */
router.post('/segments/sync', requireAuth, requireRole('owner', 'manager', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const result = await runSegmentSync(restaurantId);
    const stored = result.segments ? await storeSegments(restaurantId, result.segments) : { stored: 0 };
    res.json({ success: true, result: { ...result, storedPredictions: stored.stored } });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not configured')) {
      return res.status(503).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/** GET /api/ml-pipeline/segments — stored segments (read, for the UI). */
router.get('/segments', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const query = req.query as Record<string, string>;
    const segments = await getStoredSegments(restaurantId, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      segment: query.segment || undefined,
    });
    res.json({ success: true, count: segments.length, segments });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ml-pipeline/quality — model-quality report for the caller's tenant
 * (Job 3 Sec 30). Read-only aggregation over stored predictions, feedback
 * outcomes, and ML lifecycle events. Honest fields only: no invented accuracy
 * or confidence; sample counts accompany every error metric.
 */
router.get('/quality', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const rid = new mongoose.Types.ObjectId(restaurantId);
    const since = new Date(Date.now() - 30 * 86400000);

    const [{ predictionCount = 0 } = {}, outcomes, recentOutcomes, events] = await Promise.all([
      MLPrediction.aggregate([{ $match: { restaurantId: rid } }, { $group: { _id: null, n: { $sum: 1 } } }]).then(rows => rows[0]),
      MLPredictionOutcome.find({ restaurantId: rid }).sort({ predictionFor: -1 }).limit(200).lean(),
      MLPredictionOutcome.aggregate([
        { $match: { restaurantId: rid, evaluatedAt: { $gte: since }, absoluteError: { $ne: null } } },
        { $group: {
          _id: '$modelName',
          evaluatedCount: { $sum: 1 },
          mae: { $avg: '$absoluteError' },
          bias: { $avg: '$signedError' },
          wapeNum: { $sum: '$absoluteError' },
          wapeDen: { $sum: '$actualValue' },
        } },
      ]),
      PlatformEvent.find(
        { category: 'system', event: { $regex: '^ml_' }, $or: [{ restaurantId: rid }, { restaurantId: { $exists: false } }] },
      ).sort({ occurredAt: -1 }).limit(20).lean(),
    ]);

    res.json({
      success: true,
      restaurantId,
      windowDays: 30,
      predictionsStored: predictionCount,
      feedback: {
        lifetimeEvaluated: outcomes.length,
        recent: recentOutcomes.map(r => ({
          model: r._id,
          evaluatedCount: r.evaluatedCount,
          meanAbsoluteError: r.mae != null ? Number(r.mae.toFixed(3)) : null,
          meanSignedError: r.bias != null ? Number(r.bias.toFixed(3)) : null,
          wape: r.wapeDen > 0 ? Number((r.wapeNum / r.wapeDen).toFixed(4)) : null,
        })),
      },
      recentEvents: events.map(e => ({
        event: e.event,
        severity: e.meta?.severity ?? 'info',
        model: e.meta?.model ?? null,
        modelVersion: e.meta?.modelVersion ?? null,
        reason: e.meta?.reason ?? null,
        occurredAt: e.occurredAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ml-pipeline/experiments/diagnostics — randomization diagnostics for
 * the caller's experiment ledger (Job 3 Sec 22). Honest evaluability: with no
 * application-level control arm, evaluable=false and the reason says so.
 */
router.get('/experiments/diagnostics', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const query = req.query as Record<string, string>;
    const min = query.minimumSize ? Math.max(0, parseInt(query.minimumSize, 10) || 0) : undefined;
    const diagnostics = await evaluateExperimentRandomization(restaurantId, min);
    res.json({ success: true, diagnostics });
  } catch (err) {
    next(err);
  }
});

function extractBearerTokenSafe(req: AuthenticatedRequest): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

// ─── Offer-Response Model proxy (spec Step 5) ──────────────────────────────
// Thin proxy to the Uplift service's /api/offer-response/* endpoints. The
// model is a RESPONSE model (p(redeem | offer, features)) — explicitly
// NON-causal; payloads carry that scope label. Reads are available to all
// authenticated staff; retrain is owner/manager only.
import {
  fetchOfferResponseScore,
  fetchOfferResponseEvaluation,
  triggerOfferResponseRetrain,
  fetchOfferResponseStatus,
} from './offerResponseClient';

router.post('/offer-response/score', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const body = (req.body || {}) as { features?: unknown };
    const features = body.features && typeof body.features === 'object' ? body.features : null;
    if (!features) {
      return res.status(400).json({ success: false, error: 'features (object of pre-treatment fields) is required' });
    }
    const result = await fetchOfferResponseScore(restaurantId, features as Record<string, unknown>);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

router.post('/offer-response/evaluate', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const body = (req.body || {}) as { holdoutFraction?: unknown };
    const hf = typeof body.holdoutFraction === 'number' && Number.isFinite(body.holdoutFraction) ? body.holdoutFraction : 0.3;
    const result = await fetchOfferResponseEvaluation(restaurantId, hf);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

router.post('/offer-response/retrain', requireAuth, requireRole('owner', 'manager', 'super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const result = await triggerOfferResponseRetrain(restaurantId);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

router.get('/offer-response/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const restaurantId = getVerifiedRestaurantId(authReq);
    const result = await fetchOfferResponseStatus(restaurantId);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// ─── Controlled experiment flow (spec Step 3) ───────────────────────────────
// Mounted AFTER the legacy /experiments/* routes above so they keep matching
// first: legacy /experiments/assign, /experiments/convert, /experiments/push
// and /experiments/diagnostics are registered explicitly; everything else
// (POST /experiments, /:id/launch, /:id/assign, /:id/expose, /:id/outcome,
// /:id/analysis) falls through to experimentRoutes.
import experimentRoutes from './experimentRoutes';
router.use('/experiments', experimentRoutes);

export default router;
