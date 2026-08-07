/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminDevicesController.ts — Admin Device Management endpoints (Phase 2.5).
 *
 * Thin controllers: all business logic lives in DeviceService (validation,
 * approval workflow, removal + session cleanup, force logout, sessions,
 * health, history, statistics, audit). Every route is validated by zod
 * (validation/device.ts) and protected by RBAC
 * (requireAuth + requireCollectionAccess) in routes/admin.ts.
 *
 * Backward compatible: the legacy list/get/block/unblock response shapes are
 * preserved (the existing dashboard keeps working untouched).
 */

import { Request, Response } from 'express';
import { deviceService, type AdminIdentity } from '../services/deviceService';
import { AppError } from '../utils/AppError';

function adminIdentity(req: Request): AdminIdentity {
  const user = (req as any).user;
  const fwd = req.headers['x-forwarded-for'];
  const ip = typeof fwd === 'string' && fwd.length > 0 ? fwd.split(',')[0].trim() : req.ip;
  return {
    id: user?.userId || user?._id?.toString() || 'system',
    name: user?.name || 'Super Admin',
    ipAddress: ip || undefined,
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

// ─── List / Get ────────────────────────────────────────────────

export async function getDevices(req: Request, res: Response): Promise<void> {
  try {
    const result = await deviceService.list(req.query);
    // Backward-compatible shape: { data, total, page, limit, totalPages }.
    res.json(result);
  } catch (error) {
    handleError(res, error, 'AdminDevices List');
  }
}

export async function getDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.getById(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminDevices Get');
  }
}

// ─── Block / Unblock (legacy, enhanced with session cleanup) ───

export async function blockDevice(req: Request, res: Response): Promise<void> {
  try {
    // Keep the legacy mutation path but delegate the write to the service so
    // audit + activity are always recorded.
    const result = await deviceService.block(req.params.id, adminIdentity(req));
    res.json({ message: 'Device blocked', ...result });
  } catch (error) {
    handleError(res, error, 'AdminDevices Block');
  }
}

export async function unblockDevice(req: Request, res: Response): Promise<void> {
  try {
    const result = await deviceService.unblock(req.params.id, adminIdentity(req));
    res.json({ message: 'Device unblocked', ...result });
  } catch (error) {
    handleError(res, error, 'AdminDevices Unblock');
  }
}

// ─── Approval workflow ─────────────────────────────────────────

export async function approveDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.approve(req.params.id, adminIdentity(req), req.body.note));
  } catch (error) {
    handleError(res, error, 'AdminDevices Approve');
  }
}

export async function rejectDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.reject(req.params.id, adminIdentity(req), req.body.reason));
  } catch (error) {
    handleError(res, error, 'AdminDevices Reject');
  }
}

export async function bulkApproveDevices(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.bulkApprove(req.body.ids, adminIdentity(req), req.body.note));
  } catch (error) {
    handleError(res, error, 'AdminDevices BulkApprove');
  }
}

export async function bulkRejectDevices(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.bulkReject(req.body.ids, adminIdentity(req), req.body.reason));
  } catch (error) {
    handleError(res, error, 'AdminDevices BulkReject');
  }
}

// ─── Removal ───────────────────────────────────────────────────

export async function removeDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.remove(req.params.id, adminIdentity(req), req.body.reason));
  } catch (error) {
    handleError(res, error, 'AdminDevices Remove');
  }
}

export async function permanentDeleteDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.permanentDelete(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminDevices PermanentDelete');
  }
}

export async function removeInactiveDevices(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.removeInactive(adminIdentity(req), req.body.restaurantId));
  } catch (error) {
    handleError(res, error, 'AdminDevices RemoveInactive');
  }
}

// ─── Force logout / Sessions ───────────────────────────────────

export async function forceLogoutDevices(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.forceLogout(req.body, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminDevices ForceLogout');
  }
}

export async function getDeviceSessions(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.listSessions(req.params.id, req.query));
  } catch (error) {
    handleError(res, error, 'AdminDevices Sessions');
  }
}

export async function revokeDeviceSession(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.revokeSession(req.params.id, req.params.sessionId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminDevices SessionRevoke');
  }
}

// ─── Health / Statistics ───────────────────────────────────────

export async function getDeviceHealth(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.health(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminDevices Health');
  }
}

export async function getDeviceStatistics(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deviceService.statistics(req.query));
  } catch (error) {
    handleError(res, error, 'AdminDevices Statistics');
  }
}
