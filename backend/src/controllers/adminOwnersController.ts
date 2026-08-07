/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminOwnersController.ts — Owner admin endpoints (Phase 2.3).
 *
 * Thin controllers: all business logic lives in OwnerService. Every route is
 * validated by zod (see validation/owner.ts) and protected by RBAC
 * (requireAuth + requireCollectionAccess) in routes/admin.ts.
 *
 * Response contract — backward compatible with the admin dashboard:
 *   - List:  { data, total, page, limit, totalPages, next, previous }
 *   - Single / mutations: plain object or { message }
 */

import { Request, Response } from 'express';
import { ownerService, type AdminIdentity } from '../services/ownerService';
import { AppError } from '../utils/AppError';

interface AdminCtx extends AdminIdentity { ipAddress?: string; deviceId?: string; }

function adminIdentity(req: Request): AdminCtx {
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

export async function getOwners(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.list(req.query));
  } catch (error) {
    handleError(res, error, 'AdminOwners List');
  }
}

export async function getOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.getById(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminOwners Get');
  }
}

export async function createOwner(req: Request, res: Response): Promise<void> {
  try {
    const created = await ownerService.create(req.body, adminIdentity(req));
    res.status(201).json(created);
  } catch (error) {
    handleError(res, error, 'AdminOwners Create');
  }
}

export async function updateOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.update(req.params.id, req.body, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Update');
  }
}

// ─── Status / Lock / Delete ─────────────────────────────────────

export async function suspendOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.setStatus(req.params.id, 'suspend', adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Suspend');
  }
}

export async function activateOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.setStatus(req.params.id, 'activate', adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Activate');
  }
}

/** Legacy alias — deactivate maps to suspend (blocks login + revokes sessions). */
export async function deactivateOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.setStatus(req.params.id, 'suspend', adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Deactivate');
  }
}

export async function lockOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.lock(req.params.id, adminIdentity(req), req.body?.reason));
  } catch (error) {
    handleError(res, error, 'AdminOwners Lock');
  }
}

export async function unlockOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.unlock(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Unlock');
  }
}

export async function deleteOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.softDelete(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Delete');
  }
}

export async function restoreOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.restore(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners Restore');
  }
}

export async function permanentDeleteOwner(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.permanentDelete(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners PermanentDelete');
  }
}

// ─── Password ───────────────────────────────────────────────────

export async function resetOwnerPassword(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.resetPassword(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners ResetPassword');
  }
}

// ─── Restaurant mapping ─────────────────────────────────────────

export async function getOwnerRestaurants(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await ownerService.getRestaurants(req.params.id) });
  } catch (error) {
    handleError(res, error, 'AdminOwners Restaurants');
  }
}

export async function assignOwnerRestaurant(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.assignRestaurant(req.params.id, req.params.restaurantId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners AssignRestaurant');
  }
}

export async function unassignOwnerRestaurant(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.unassignRestaurant(req.params.id, req.params.restaurantId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners UnassignRestaurant');
  }
}

// ─── Sessions ───────────────────────────────────────────────────

export async function getOwnerSessions(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.listSessions(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminOwners Sessions');
  }
}

export async function revokeOwnerSession(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.revokeSession(req.params.id, req.params.sessionId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners RevokeSession');
  }
}

export async function revokeAllOwnerSessions(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.revokeAllSessions(req.params.id, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners RevokeAllSessions');
  }
}

// ─── Devices ────────────────────────────────────────────────────

export async function getOwnerDevices(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await ownerService.listDevices(req.params.id) });
  } catch (error) {
    handleError(res, error, 'AdminOwners Devices');
  }
}

export async function getOwnerDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.getDevice(req.params.id, req.params.deviceId));
  } catch (error) {
    handleError(res, error, 'AdminOwners GetDevice');
  }
}

export async function blockOwnerDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.blockDevice(req.params.id, req.params.deviceId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners BlockDevice');
  }
}

export async function unblockOwnerDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.unblockDevice(req.params.id, req.params.deviceId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners UnblockDevice');
  }
}

export async function removeOwnerDevice(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.removeDevice(req.params.id, req.params.deviceId, adminIdentity(req)));
  } catch (error) {
    handleError(res, error, 'AdminOwners RemoveDevice');
  }
}

// ─── Login history / profile / statistics ───────────────────────

export async function getOwnerLoginHistory(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.loginHistory(req.params.id, req.query));
  } catch (error) {
    handleError(res, error, 'AdminOwners LoginHistory');
  }
}

export async function getOwnerProfile(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.getProfile(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminOwners Profile');
  }
}

export async function getOwnerStatistics(req: Request, res: Response): Promise<void> {
  try {
    res.json(await ownerService.getStatistics(req.params.id));
  } catch (error) {
    handleError(res, error, 'AdminOwners Statistics');
  }
}
