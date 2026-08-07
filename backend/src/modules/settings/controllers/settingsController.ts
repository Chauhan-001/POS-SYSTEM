/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * settingsController — REST handlers for centralized POS settings (Phase 1.9).
 * Every handler derives restaurantId/branchId/deviceId from req.user and
 * request params — never from the client payload.
 *
 * Every handler catches its own errors and responds with the proper status
 * code — async throws must never become unhandled rejections (the server
 * exits on those).
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { AppError } from '../../../utils/AppError';
import { settingsService, SettingsService } from '../services/settingsService';

function actorOf(req: AuthenticatedRequest) {
  const user = req.user!;
  return {
    performedBy: user.name || user.role || 'unknown',
    performedById: user.employeeId || undefined,
    restaurantId: user.restaurantId,
    branchId: (req as any).branchId || undefined,
    deviceId: (req as any).deviceId || undefined,
    ipAddress: req.ip,
  };
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[SettingsController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

export function makeSettingsController(service: SettingsService = settingsService) {
  return {
    /** GET /api/settings?branchId=&deviceId= → effective merged settings. */
    async getEffective(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
        const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
        const result = await service.getEffective(restaurantId, branchId, deviceId);
        res.json(result);
      } catch (error) { handleError(res, error, 'getEffective'); }
    },

    /** PATCH /api/settings → update a scope with optimistic concurrency. */
    async patch(req: Request, res: Response): Promise<void> {
      try {
        const result = await service.patch(req.body, actorOf(req as AuthenticatedRequest));
        res.json(result);
      } catch (error) { handleError(res, error, 'patch'); }
    },

    /** GET /api/settings/history?scope=&branchId=&deviceId= */
    async listHistory(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const q = req.query as { scope?: string; branchId?: string; deviceId?: string };
        const scope = (q.scope || 'restaurant') as 'restaurant' | 'branch' | 'device';
        const result = await service.listHistory(restaurantId, scope, q.branchId, q.deviceId);
        res.json(result);
      } catch (error) { handleError(res, error, 'listHistory'); }
    },

    /** POST /api/settings/rollback */
    async rollback(req: Request, res: Response): Promise<void> {
      try {
        const result = await service.rollback(req.body, actorOf(req as AuthenticatedRequest));
        res.json(result);
      } catch (error) { handleError(res, error, 'rollback'); }
    },

    /** GET /api/settings/audit?page=&limit= */
    async listAudit(req: Request, res: Response): Promise<void> {
      try {
        const { restaurantId } = (req as AuthenticatedRequest).user!;
        const q = req.query as { page?: string; limit?: string };
        const page = parseInt(q.page || '1', 10) || 1;
        const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
        const result = await service.listAudit(restaurantId, page, limit);
        res.json(result);
      } catch (error) { handleError(res, error, 'listAudit'); }
    },

    /** Health probe for the settings engine (no external deps). */
    async health(_req: Request, res: Response): Promise<void> {
      res.json({ ok: true, module: 'settings', version: 1 });
    },
  };
}

export const settingsController = makeSettingsController();
