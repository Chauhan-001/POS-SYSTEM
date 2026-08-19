/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminPlansController.ts — Plans Management admin endpoints (Phase 2.4).
 *
 * Thin controllers: all business logic lives in PlanService. Every route is
 * validated by zod (validation/plan.ts) and protected by RBAC
 * (requireAuth + requireCollectionAccess) in routes/admin.ts.
 *
 * Response contract — backward compatible with the admin dashboard:
 *   - List:  { data, total, page, limit, totalPages, next, previous }
 *   - Single / mutations: plain object or { message }
 */

import { Request, Response } from 'express';
import { planService, type AdminIdentity } from '../services/planService';
import { AppError } from '../utils/AppError';

function adminIdentity(req: Request): AdminIdentity {
  const user = (req as any).user;
  const fwd = req.headers['x-forwarded-for'];
  const ip = typeof fwd === 'string' && fwd.length > 0 ? fwd.split(',')[0].trim() : req.ip;
  const device = req.headers['x-device-id'] || req.headers['x-client-id'];
  return {
    id: user?._id?.toString() || user?.userId || user?.id || 'system',
    name: user?.name || 'Super Admin',
    ipAddress: ip || undefined,
    deviceId: typeof device === 'string' ? device.slice(0, 120) : undefined,
  };
}

function handleError(res: Response, error: any, logPrefix: string) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  if (error?.statusCode) {
    res.status(error.statusCode).json({ message: error.message || 'Request failed' });
    return;
  }
  console.error(`[${logPrefix}]`, error);
  res.status(500).json({ message: 'Internal server error' });
}

// ─── CRUD ──────────────────────────────────────────────────────

export async function getPlans(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.list(req.query));
  } catch (error) {
    handleError(res, error, 'AdminPlans List');
  }
}

export async function getPlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.getById(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminPlans Get');
  }
}

export async function createPlan(req: Request, res: Response): Promise<void> {
  try {
    const created = await planService.create(req.body, adminIdentity(req));
    res.status(201).json(created);
  } catch (error) {
    handleError(res, error, 'AdminPlans Create');
  }
}

export async function updatePlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.update(req.params.id, req.body, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans Update');
  }
}

export async function clonePlan(req: Request, res: Response): Promise<void> {
  try {
    const created = await planService.clone(req.params.id, req.body, adminIdentity(req));
    res.status(201).json(created);
  } catch (error) {
    handleError(res, error, 'AdminPlans Clone');
  }
}

// ─── Status / Archive / Restore / Delete ───────────────────────

export async function setPlanStatus(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.setStatus(req.params.id, req.body.status, adminIdentity(req), req.body.note));
  } catch (error) {
    handleError(res, error, 'AdminPlans Status');
  }
}

export async function archivePlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.archive(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans Archive');
  }
}

export async function restorePlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.restore(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans Restore');
  }
}

export async function deletePlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.softDelete(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans Delete');
  }
}

export async function permanentDeletePlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.permanentDelete(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans PermanentDelete');
  }
}

// ─── Versioning ─────────────────────────────────────────────────

export async function getPlanVersions(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await planService.listVersions(req.params.id) });
  } catch (error) {
    handleError(res, error, 'AdminPlans Versions');
  }
}

export async function rollbackPlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.rollback(
      req.params.id,
      req.body.version,
      adminIdentity(req),
      req.body.note,
    ));
  } catch (error) {
    handleError(res, error, 'AdminPlans Rollback');
  }
}

// ─── Assignment / Statistics ───────────────────────────────────

export async function assignPlan(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.assign(req.body, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminPlans Assign');
  }
}

export async function convertTrial(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.convertTrial(
      req.body.restaurantId,
      req.body.planId,
      adminIdentity(req),
      req.body.billingPeriod,
    ));
  } catch (error) {
    handleError(res, error, 'AdminPlans TrialConversion');
  }
}

export async function getPlanStatistics(req: Request, res: Response): Promise<void> {
  try {
    res.json(await planService.statistics(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminPlans Statistics');
  }
}
