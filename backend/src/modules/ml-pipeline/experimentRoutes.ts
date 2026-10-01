/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlled Offer Experiment Routes (spec Step 3 wiring).
 *
 * Mounted under /api/ml-pipeline/experiments (see mlPipelineRoutes.ts) — the
 * existing routes there already serve the LEGACY default flow
 * (/experiments/assign, /experiments/convert, /experiments/push,
 * /experiments/diagnostics); this router adds the CONTROLLED flow on top of
 * experimentService + experimentEval.
 *
 * SECURITY (same contract as mlPipelineRoutes.ts):
 *   - requireAuth on everything; restaurantId ONLY from req.user.
 *   - Mutations restricted to owner/manager/super_admin.
 *   - experimentId comes from the path/body but is ALWAYS scoped by the
 *     verified tenant id in every DB query.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../../middleware/authMiddleware';
import {
  createExperiment,
  launchExperiment,
  getExperiment,
  assignCustomerToExperiment,
  recordExposure,
  recordExperimentOutcome,
  analyzeExperimentById,
  validateExperimentDesign,
  type CreateExperimentInput,
} from './experimentService';
import { evaluateExperimentRandomization } from './experimentEval';

const router = Router();

function getVerifiedRestaurantId(req: AuthenticatedRequest): string {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) {
    throw Object.assign(new Error('Verified restaurantId missing from token'), { statusCode: 401 });
  }
  return String(restaurantId);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function handleError(res: Response, err: unknown) {
  const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(statusCode).json({ success: false, error: message });
}

// ─── Definition lifecycle ────────────────────────────────────────────────────

/**
 * POST /experiments — create a draft experiment definition.
 * Body: CreateExperimentInput (minus restaurantId, which comes from the token).
 * Design is validated BEFORE persistence; 400 with the error list on failure.
 */
router.post(
  '/',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as Record<string, unknown>;

      const input: CreateExperimentInput = {
        restaurantId,
        experimentId: asString(body.experimentId),
        name: asString(body.name),
        objective: asString(body.objective),
        controlDescription: asString(body.controlDescription),
        variants: Array.isArray(body.variants)
          ? (body.variants as Array<Record<string, unknown>>).map((v) => ({
              id: asString(v.id),
              name: asString(v.name),
              kind: v.kind === 'control' ? ('control' as const) : ('treatment' as const),
              offerId: asString(v.offerId) || null,
              allocation: asNumber(v.allocation) ?? -1,
            }))
          : [],
        primaryMetric:
          body.primaryMetric === 'revenue' || body.primaryMetric === 'contribution' || body.primaryMetric === 'aov'
            ? body.primaryMetric
            : 'redemption_rate',
        secondaryMetrics: Array.isArray(body.secondaryMetrics)
          ? (body.secondaryMetrics as string[]).filter((m): m is CreateExperimentInput['primaryMetric'] =>
              ['redemption_rate', 'revenue', 'contribution', 'aov'].includes(m)
            )
          : [],
        attributionWindowDays: asNumber(body.attributionWindowDays) ?? -1,
        minSampleSizePerArm: asNumber(body.minSampleSizePerArm),
        createdBy: String(authReq.user?.userId ?? 'unknown'),
      };

      if (!input.experimentId || !input.name || !input.objective) {
        return res.status(400).json({
          success: false,
          error: 'experimentId, name and objective are required',
        });
      }

      const validation = validateExperimentDesign(input);
      if (!validation.ok) {
        return res.status(400).json({ success: false, errors: validation.errors });
      }

      const experiment = await createExperiment(input);
      res.status(201).json({ success: true, experiment });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * GET /experiments/:experimentId — fetch one experiment definition (tenant-scoped).
 */
router.get(
  '/:experimentId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const experiment = await getExperiment(restaurantId, req.params.experimentId);
      res.json({ success: true, experiment });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * POST /experiments/:experimentId/launch — draft/paused → active.
 */
router.post(
  '/:experimentId/launch',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const experiment = await launchExperiment(restaurantId, req.params.experimentId);
      res.json({ success: true, experiment });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// ─── Assignment / exposure / outcome ─────────────────────────────────────────

/**
 * POST /experiments/:experimentId/assign — deterministic arm assignment
 * (idempotent). Control rows are persisted with treatment=0.
 * Body: { customerId, branchId?, features? }
 */
router.post(
  '/:experimentId/assign',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as Record<string, unknown>;
      const customerId = asString(body.customerId);
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId is required' });
      }
      const result = await assignCustomerToExperiment({
        restaurantId,
        experimentId: req.params.experimentId,
        customerId,
        branchId: asString(body.branchId) || null,
        features:
          body.features && typeof body.features === 'object'
            ? (body.features as Record<string, unknown>)
            : null,
      });
      res.json({
        success: true,
        eventId: String(result.event._id),
        variantId: result.variantId,
        kind: result.kind,
        eligible: result.eligible,
        alreadyAssigned: result.alreadyAssigned,
      });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * POST /experiments/:experimentId/expose — stamp exposure (customer actually
 * saw/received the offer). No-op for control rows.
 * Body: { customerId, exposedAt? }
 */
router.post(
  '/:experimentId/expose',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as Record<string, unknown>;
      const customerId = asString(body.customerId);
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId is required' });
      }
      const exposedAtRaw = asString(body.exposedAt);
      const exposedAt = exposedAtRaw && !Number.isNaN(Date.parse(exposedAtRaw)) ? new Date(exposedAtRaw) : undefined;
      const event = await recordExposure({
        restaurantId,
        experimentId: req.params.experimentId,
        customerId,
        exposedAt,
      });
      res.json({ success: true, eventId: String(event._id), exposedAt: event.exposedAt });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * POST /experiments/:experimentId/outcome — record a conversion for either
 * arm (attribution-window honored inside the service).
 * Body: { customerId, redeemedBillId?, attributedRevenue?, at? }
 */
router.post(
  '/:experimentId/outcome',
  requireAuth,
  requireRole('owner', 'manager', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const body = (req.body || {}) as Record<string, unknown>;
      const customerId = asString(body.customerId);
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId is required' });
      }
      const atRaw = asString(body.at);
      const at = atRaw && !Number.isNaN(Date.parse(atRaw)) ? new Date(atRaw) : undefined;
      const revenue = asNumber(body.attributedRevenue);
      const result = await recordExperimentOutcome({
        restaurantId,
        experimentId: req.params.experimentId,
        customerId,
        redeemedBillId: asString(body.redeemedBillId) || null,
        attributedRevenue: revenue ?? null,
        at,
      });
      res.json({
        success: true,
        eventId: String(result.event._id),
        counted: result.counted,
        reason: result.reason ?? null,
      });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// ─── Analysis + diagnostics ──────────────────────────────────────────────────

/**
 * GET /experiments/:experimentId/analysis — two-arm statistical analysis
 * (inconclusive below minSampleSizePerArm, per spec §46).
 */
router.get(
  '/:experimentId/analysis',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const analysis = await analyzeExperimentById(restaurantId, req.params.experimentId);
      res.json({ success: true, analysis });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * GET /experiments/diagnostics — uplift randomization diagnostics for the
 * whole tenant (gate behind the uplift tool's evaluable flag).
 */
router.get(
  '/diagnostics',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const restaurantId = getVerifiedRestaurantId(authReq);
      const minRaw = asString(req.query.min);
      const min = minRaw && Number.isFinite(Number(minRaw)) ? Math.max(1, Number(minRaw)) : 100;
      const diagnostics = await evaluateExperimentRandomization(restaurantId, min);
      res.json({ success: true, diagnostics });
    } catch (err) {
      handleError(res, err);
    }
  }
);

export default router;
