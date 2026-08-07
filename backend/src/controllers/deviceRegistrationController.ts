/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * deviceRegistrationController.ts — POS-facing device endpoints.
 *
 *   POST /api/devices/register   — register / update the current device
 *   POST /api/devices/heartbeat  — report device health (Phase 2.5)
 *   GET  /api/devices/my-devices — list the caller's restaurant devices
 *
 * Registration now routes through DeviceService so fingerprint deduplication,
 * plan-limit enforcement, the optional pending-approval flow and the activity
 * feed are all handled centrally. The legacy response shape is preserved.
 */

import { Request, Response } from 'express';
import Device from '../models/Device';
import User from '../models/User';
import { deviceService } from '../services/deviceService';
import { DeviceBlockedError, DeviceLimitReachedError } from '../services/devicePolicyService';

function principal(req: Request): { userId: string; restaurantId?: string } {
  const userId = (req as any).user?.userId || (req as any).user?.id || (req as any).user?._id;
  return {
    userId: userId ? String(userId) : '',
    restaurantId: (req as any).user?.restaurantId ? String((req as any).user.restaurantId) : undefined,
  };
}

function clientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || undefined;
}

/**
 * POST /api/devices/register
 *
 * Registers or updates a device entry for the authenticated user.
 * Backward compatible with the legacy payload (deviceId, deviceName, os,
 * osVersion, appVersion); Phase 2.5 adds fingerprint, platform, browser,
 * isElectron, isMobile, nickname and branchId.
 */
export async function registerDevice(req: Request, res: Response): Promise<void> {
  try {
    const { userId, restaurantId } = principal(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { deviceId, deviceName, os, osVersion, appVersion } = req.body;
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }

    // Look up the user to find their restaurantId. For owner/employee logins the
    // JWT userId is a Restaurant/Employee _id (not a User _id), so the lookup may
    // return null — fall back to the restaurantId claim on the token.
    const user = await User.findById(userId).exec();
    const resolvedRestaurantId = user?.restaurantId
      ? user.restaurantId.toString()
      : restaurantId || undefined;

    const row = await deviceService.register({
      userId,
      restaurantId: resolvedRestaurantId,
      deviceId,
      deviceName,
      os,
      osVersion,
      appVersion,
      fingerprint: req.body.fingerprint,
      platform: req.body.platform,
      browser: req.body.browser,
      isElectron: req.body.isElectron,
      isMobile: req.body.isMobile,
      nickname: req.body.nickname,
      branchId: req.body.branchId,
      requireApproval: req.body.requireApproval,
      ipAddress: clientIp(req),
    });

    res.json({
      message: row.status === 'pending' ? 'Device registered — pending approval' : 'Device registered',
      device: {
        id: row.id,
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        status: row.status,
      },
    });
  } catch (error) {
    if (error instanceof DeviceBlockedError || error instanceof DeviceLimitReachedError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[DeviceRegistration] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/devices/heartbeat
 *
 * POS terminals call this periodically to report health (online, app/os/electron
 * version, database sync status and pending/failed sync counts). Health is
 * backend-maintained from these heartbeats.
 */
export async function heartbeatDevice(req: Request, res: Response): Promise<void> {
  try {
    const { userId, restaurantId } = principal(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const health = await deviceService.heartbeat({
      userId,
      restaurantId,
      deviceId: req.body.deviceId,
      deviceName: req.body.deviceName,
      os: req.body.os,
      osVersion: req.body.osVersion,
      appVersion: req.body.appVersion,
      electronVersion: req.body.electronVersion,
      dbSyncStatus: req.body.dbSyncStatus,
      pendingSyncCount: req.body.pendingSyncCount,
      failedSyncCount: req.body.failedSyncCount,
      lastSyncAt: req.body.lastSyncAt,
    });
    res.json({ message: 'Heartbeat received', health });
  } catch (error) {
    if (error instanceof DeviceBlockedError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[DeviceRegistration] Heartbeat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/devices/my-devices
 *
 * Returns all devices registered for the authenticated user's restaurant.
 */
export async function getMyDevices(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id || (req as any).user?._id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await User.findById(userId).exec();
    const restaurantId = user?.restaurantId || (req as any).user?.restaurantId;

    let filter: any = {};
    if (restaurantId) {
      filter = { restaurantId };
    } else {
      filter = { userId };
    }

    const devices = await Device.find(filter)
      .sort({ lastLoginAt: -1 })
      .limit(50)
      .exec();

    const data = devices.map((d) => ({
      id: d._id.toString(),
      deviceId: d.deviceId,
      deviceName: d.deviceName || 'Unknown',
      os: d.os || '',
      osVersion: d.osVersion || '',
      appVersion: d.appVersion || '',
      lastLogin: d.lastLoginAt?.toISOString() || d.createdAt.toISOString(),
      status: d.status || (d.isActive ? 'active' : 'inactive'),
    }));

    res.json({ data });
  } catch (error) {
    console.error('[DeviceRegistration] List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
