/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * =============================================================================
 *  devicePolicyService.ts — Device Policy Enforcement
 * =============================================================================
 *
 * Purpose:
 *   Single shared source of truth for device management rules used by the
 *   authentication flows (login, refresh) and the device registration API.
 *
 * Rules enforced:
 *   1. Blocked devices  → login/refresh/registration rejected (403).
 *   2. Active devices   → metadata refreshed (lastLoginAt, reactivated).
 *   3. New devices      → plan device limit (maxDevices) enforced per restaurant.
 *
 * The device limit comes from the restaurant's Subscription (maxDevices or
 * limits.maxDevices, defaulting to 3). A new device is allowed only while the
 * number of non-blocked registered devices is below the limit.
 *
 * Error contract:
 *   DeviceBlockedError        → 403, code DEVICE_BLOCKED
 *   DeviceLimitReachedError   → 403, code DEVICE_LIMIT_REACHED
 *   Both carry .status and .code so controllers can map them consistently.
 */

import Device from '../models/Device';
import Subscription from '../models/Subscription';

// ─── Typed errors (status + code for consistent controller mapping) ─────────

export class DeviceBlockedError extends Error {
  status = 403;
  code = 'DEVICE_BLOCKED';
  constructor(message = 'Device is blocked. Contact your owner or admin.') {
    super(message);
    this.name = 'DeviceBlockedError';
  }
}

export class DeviceLimitReachedError extends Error {
  status = 403;
  code = 'DEVICE_LIMIT_REACHED';
  constructor(maxDevices: number) {
    super(`Device limit reached (${maxDevices} devices). Remove an existing device or upgrade your plan.`);
    this.name = 'DeviceLimitReachedError';
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DevicePolicyOptions {
  /** Principal id from the JWT (User, Employee, or Restaurant _id). */
  userId: string;
  /** Restaurant the device belongs to (drives the plan limit). */
  restaurantId?: string;
  deviceId?: string;
  deviceName?: string;
  os?: string;
  osVersion?: string;
  appVersion?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the plan's device limit for a restaurant.
 * Precedence: subscription.maxDevices → subscription.limits.maxDevices → 3.
 * 0 = unlimited.
 */
export async function getMaxDevices(restaurantId: string): Promise<number> {
  try {
    const sub = await Subscription.findOne({ restaurantId: restaurantId as any }).exec();
    return sub?.maxDevices ?? sub?.limits?.maxDevices ?? 3;
  } catch {
    return 3;
  }
}

/**
 * Check whether a restaurant has capacity for another device (Phase 2.5).
 * Reused by the deviceService registration flow so limits are enforced BEFORE
 * any device record is created. `currentCount` counts non-blocked devices for
 * the restaurant OR the principal (legacy rows keyed only by userId), deduped
 * per document — the same semantics enforceDevicePolicy uses.
 */
export async function checkDeviceCapacity(
  restaurantId: string | undefined,
  userId: string,
): Promise<{ allowed: boolean; maxDevices: number; currentCount: number }> {
  if (!restaurantId) return { allowed: true, maxDevices: 0, currentCount: 0 };
  const maxDevices = await getMaxDevices(restaurantId);
  // 0 = unlimited.
  if (maxDevices === 0) return { allowed: true, maxDevices, currentCount: 0 };
  const currentCount = await Device.countDocuments({
    $or: [{ restaurantId: restaurantId as any }, { userId: userId as any }],
    status: { $ne: 'blocked' },
    isDeleted: { $ne: true },
  }).exec();
  return { allowed: currentCount < maxDevices, maxDevices, currentCount };
}

/**
 * Enforce the device policy for a login / registration attempt.
 *
 * - No deviceId → policy is a no-op (device tracking is optional).
 * - Existing device:
 *     blocked  → throws DeviceBlockedError
 *     active   → refreshes metadata (lastLoginAt, isActive, status)
 * - New device → enforces the restaurant's maxDevices limit, then registers it.
 */
export async function enforceDevicePolicy(opts: DevicePolicyOptions): Promise<void> {
  if (!opts.deviceId) return;

  const existing = await Device.findOne({ userId: opts.userId as any, deviceId: opts.deviceId }).exec();

  if (existing) {
    // Blocked AND rejected devices are hard-blocked. Pending devices may keep
    // logging in while awaiting approval (grace period) but are never silently
    // auto-activated to 'active'.
    if (existing.status === 'blocked' || existing.status === 'rejected') {
      throw new DeviceBlockedError();
    }

    existing.lastLoginAt = new Date();
    existing.lastActivityAt = new Date();
    existing.lastHeartbeatAt = new Date();
    existing.isOnline = true;
    existing.isActive = true;
    if (existing.status !== 'pending') existing.status = 'active';
    if (opts.deviceName) existing.deviceName = opts.deviceName;
    if (opts.os) existing.os = opts.os;
    if (opts.osVersion) existing.osVersion = opts.osVersion;
    if (opts.appVersion) existing.appVersion = opts.appVersion;
    await existing.save();
    return;
  }

  // New device — enforce the restaurant's plan limit first.
  const { allowed, maxDevices } = await checkDeviceCapacity(opts.restaurantId, opts.userId);
  if (!allowed) throw new DeviceLimitReachedError(maxDevices);

  await Device.create({
    userId: opts.userId as any,
    restaurantId: opts.restaurantId ? (opts.restaurantId as any) : undefined,
    deviceId: opts.deviceId,
    deviceName: opts.deviceName || '',
    os: opts.os || '',
    osVersion: opts.osVersion || '',
    appVersion: opts.appVersion || '',
    lastLoginAt: new Date(),
    lastActivityAt: new Date(),
    lastHeartbeatAt: new Date(),
    isOnline: true,
    isActive: true,
    status: 'active',
    firstSeenAt: new Date(),
  } as any);
}

/**
 * Lightweight blocked check for token-refresh flows. A blocked device cannot
 * extend its session — refresh is rejected so the terminal must re-login
 * (where the full policy runs again).
 */
export async function assertDeviceNotBlocked(userId: string, deviceId?: string): Promise<void> {
  if (!deviceId) return;
  const dev = await Device.findOne({ userId: userId as any, deviceId }).exec();
  if (dev && (dev.status === 'blocked' || dev.status === 'rejected')) throw new DeviceBlockedError();
}
