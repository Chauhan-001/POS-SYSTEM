/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * deviceService.ts — Device Management business logic (Phase 2.5).
 *
 * Consolidates the device lifecycle so controllers stay thin and every write
 * is validated, audited and recorded on the device activity feed:
 *
 *   - Registration: first-time registration with fingerprint-based duplicate
 *     detection, metadata capture (platform / browser / os / electron / mobile),
 *     nickname + branch binding, plan-limit enforcement BEFORE registration,
 *     and an optional admin-approval (pending) flow.
 *   - Approval: approve / reject / bulk approve / bulk reject with approved-by,
 *     timestamps and notes recorded. Rejection revokes the device's sessions.
 *   - Removal: soft delete (with reason) + cleanup of refresh tokens; permanent
 *     delete for fully cleaned-up devices; remove-all-inactive.
 *   - Force logout: current / selected / all / restaurant scopes — revokes the
 *     matching refresh tokens (access tokens die at expiry, refresh is gone now).
 *   - Sessions: list a device's active sessions, revoke one session.
 *   - Health: heartbeat ingestion + online/offline/inactive computation with an
 *     automatic stale-device sweep.
 *   - History: queryable device activity feed.
 *   - Statistics: backend-generated aggregates (no frontend math).
 *
 * Reuses the existing devicePolicyService for limit/blocked enforcement and the
 * existing refresh-token architecture for sessions — nothing is duplicated.
 */

import mongoose from 'mongoose';
import Device from '../models/Device';
import DeviceActivity, { DeviceActivityEvent } from '../models/DeviceActivity';
import RefreshToken from '../models/RefreshToken';
import Restaurant from '../models/Restaurant';
import Branch from '../models/Branch';
import User from '../models/User';
import { auditLogRepo, refreshTokenRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { parsePagination, parseSearch, parseDateRange } from '../utils/queryParser';
import {
  checkDeviceCapacity,
  DeviceBlockedError,
  DeviceLimitReachedError,
} from './devicePolicyService';

export interface AdminIdentity {
  id: string;
  name: string;
  ipAddress?: string;
  deviceId?: string;
}

/** A device is offline after 2 minutes without a heartbeat. */
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
/** A device is marked inactive after 7 days offline. */
const INACTIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const SEARCH_FIELDS = ['deviceName', 'nickname', 'deviceId', 'os', 'platform', 'appVersion', 'browser'];
const ALLOWED_SORTS = ['createdAt', 'updatedAt', 'lastActivityAt', 'lastLoginAt', 'deviceName', 'os', 'platform', 'status'];

export interface RegisterInput {
  userId: string;
  restaurantId?: string;
  deviceId: string;
  deviceName?: string;
  nickname?: string;
  fingerprint?: string;
  platform?: string;
  browser?: string;
  os?: string;
  osVersion?: string;
  appVersion?: string;
  isElectron?: boolean;
  isMobile?: boolean;
  branchId?: string;
  requireApproval?: boolean;
  ipAddress?: string;
}

export class DeviceService {
  // ──────────────────────────────────────────────────────────────
  // Row mapping + helpers
  // ──────────────────────────────────────────────────────────────

  private toRow(d: any, names?: { restaurant?: string; branch?: string }): any {
    const restName = names?.restaurant || 'Unknown';
    const branchName = names?.branch || null;
    const status = d.status || (d.isActive ? 'active' : 'inactive');
    const approvalStatus = status === 'pending' ? 'pending' : status === 'rejected' ? 'rejected' : 'approved';
    return {
      id: d._id.toString(),
      deviceId: d.deviceId,
      deviceName: d.deviceName || 'Unknown',
      nickname: d.nickname || null,
      userId: d.userId ? d.userId.toString() : null,
      restaurantId: d.restaurantId ? d.restaurantId.toString() : null,
      restaurantName: restName,
      branchId: d.branchId ? d.branchId.toString() : null,
      branchName: branchName,
      fingerprint: d.fingerprint || null,
      platform: d.platform || null,
      browser: d.browser || null,
      isElectron: !!d.isElectron,
      isMobile: !!d.isMobile,
      os: d.os || '',
      osVersion: d.osVersion || '',
      appVersion: d.appVersion || '',
      electronVersion: d.electronVersion || null,
      status,
      isActive: !!d.isActive,
      isOnline: !!d.isOnline,
      online: !!d.isOnline,
      approvalStatus,
      approvedBy: d.approvedBy || null,
      approvedAt: d.approvedAt ? d.approvedAt.toISOString() : null,
      rejectedBy: d.rejectedBy || null,
      rejectedAt: d.rejectedAt ? d.rejectedAt.toISOString() : null,
      rejectionReason: d.rejectionReason || null,
      notes: d.notes || null,
      trustLevel: d.trustLevel || 'trusted',
      firstSeenAt: d.firstSeenAt ? d.firstSeenAt.toISOString() : (d.createdAt ? d.createdAt.toISOString() : null),
      lastLogin: d.lastLoginAt ? d.lastLoginAt.toISOString() : null,
      lastActivity: d.lastActivityAt ? d.lastActivityAt.toISOString() : null,
      lastHeartbeat: d.lastHeartbeatAt ? d.lastHeartbeatAt.toISOString() : null,
      lastSync: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
      dbSyncStatus: d.dbSyncStatus || 'synced',
      pendingSyncCount: d.pendingSyncCount ?? 0,
      failedSyncCount: d.failedSyncCount ?? 0,
      registeredAt: d.createdAt ? d.createdAt.toISOString() : null,
      isDeleted: !!d.isDeleted,
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      deletionReason: d.deletionReason || null,
    };
  }

  private async findDevice(id: string, opts: { includeDeleted?: boolean } = {}): Promise<any> {
    if (!mongoose.isValidObjectId(id)) throw new AppError(400, 'Invalid device id');
    const filter: Record<string, any> = { _id: id };
    if (!opts.includeDeleted) filter.isDeleted = { $ne: true };
    const device = await Device.findOne(filter).exec();
    if (!device) throw new AppError(404, 'Device not found');
    return device;
  }

  private async activity(
    device: any,
    event: DeviceActivityEvent,
    description: string,
    metadata: Record<string, any> = {},
    ipAddress?: string,
  ): Promise<void> {
    try {
      await DeviceActivity.create({
        deviceId: device._id,
        restaurantId: device.restaurantId || undefined,
        event,
        description,
        metadata,
        ipAddress: ipAddress || '',
      });
    } catch (error) {
      console.error('[DeviceService] Activity write failed:', error);
    }
  }

  private async audit(
    action: string,
    device: any,
    actor: AdminIdentity,
    details: Record<string, any>,
    after: Record<string, any> | null,
  ): Promise<void> {
    try {
      const afterRow = after ? { ...after, versions: undefined } : null;
      await auditLogRepo.create({
        action,
        entityType: 'Device',
        entityId: device._id ? device._id.toString() : device.id,
        performedBy: actor.name,
        performedById: actor.id,
        restaurantId: device.restaurantId || undefined,
        ipAddress: actor.ipAddress,
        details: {
          deviceId: device.deviceId,
          deviceName: device.deviceName || 'Unknown',
          ...details,
          ...(afterRow ? { after: afterRow } : {}),
        },
      } as any);
    } catch (error) {
      console.error('[DeviceService] Audit write failed:', error);
    }
  }

  /** Refresh tokens belonging to a device (matched by the deviceId string). */
  private revokeDeviceTokens(deviceId: string) {
    return refreshTokenRepo.updateMany({ deviceId, isRevoked: false } as any, { isRevoked: true } as any);
  }

  // ──────────────────────────────────────────────────────────────
  // REGISTRATION
  // ──────────────────────────────────────────────────────────────
  async register(input: RegisterInput) {
    if (!input.deviceId) throw new AppError(400, 'deviceId is required');
    if (!input.userId) throw new AppError(401, 'Authentication required');

    // Resolve the restaurant: prefer the explicit binding, otherwise fall back
    // to the principal's own restaurant (User doc) — matches the legacy flow.
    let restaurantId = input.restaurantId;
    if (!restaurantId) {
      const userDoc = await User.findById(input.userId).lean().exec();
      if (userDoc?.restaurantId) restaurantId = userDoc.restaurantId.toString();
    }

    const now = new Date();
    const byDevice = await Device.findOne({
      userId: input.userId,
      deviceId: input.deviceId,
      isDeleted: { $ne: true },
    }).exec();

    // Fingerprint-based duplicate / spoof detection: a fingerprint already
    // registered to this restaurant resolves to the SAME physical device even
    // when presented under a different deviceId — never a second record.
    let target = byDevice;
    if (!target && input.fingerprint && restaurantId) {
      target = await Device.findOne({
        restaurantId: restaurantId as any,
        fingerprint: input.fingerprint,
        isDeleted: { $ne: true },
      }).exec();
    }

    if (target) {
      // Blocked / rejected devices cannot (re)register.
      if (target.status === 'blocked' || target.status === 'rejected') {
        throw new DeviceBlockedError();
      }
      // Existing device → refresh metadata + activity, keep approval state.
      target.lastLoginAt = now;
      target.lastActivityAt = now;
      target.lastHeartbeatAt = now;
      target.isOnline = true;
      target.isActive = true;
      if (target.status !== 'pending') target.status = 'active';
      if (input.deviceName) target.deviceName = input.deviceName;
      if (input.nickname) target.nickname = input.nickname;
      if (input.os) target.os = input.os;
      if (input.osVersion) target.osVersion = input.osVersion;
      if (input.appVersion) target.appVersion = input.appVersion;
      if (input.platform) target.platform = input.platform;
      if (input.browser) target.browser = input.browser;
      if (input.isElectron !== undefined) target.isElectron = input.isElectron;
      if (input.isMobile !== undefined) target.isMobile = input.isMobile;
      if (input.branchId) target.branchId = input.branchId as any;
      if (input.fingerprint) target.fingerprint = input.fingerprint;
      await target.save();
      await this.activity(target, 'device_login', `Device "${target.deviceName || target.deviceId}" logged in`, {}, input.ipAddress);
      return this.toRow(target, { restaurant: await this.restaurantName(restaurantId) });
    }

    // Genuinely new device — enforce the plan limit BEFORE creating the record.
    const { allowed, maxDevices } = await checkDeviceCapacity(restaurantId, input.userId);
    if (!allowed) {
      await this.activity(
        { _id: new mongoose.Types.ObjectId(), restaurantId: restaurantId as any },
        'device_limit_violation',
        `Device registration rejected — limit reached (${maxDevices} devices)`,
        { deviceId: input.deviceId, maxDevices },
        input.ipAddress,
      );
      throw new DeviceLimitReachedError(maxDevices);
    }

    const isPending = !!input.requireApproval;
    const device = await Device.create({
      userId: input.userId,
      restaurantId: restaurantId ? (restaurantId as any) : undefined,
      branchId: input.branchId ? (input.branchId as any) : null,
      deviceId: input.deviceId,
      deviceName: input.deviceName || '',
      nickname: input.nickname || null,
      fingerprint: input.fingerprint || null,
      platform: input.platform || null,
      browser: input.browser || null,
      os: input.os || '',
      osVersion: input.osVersion || '',
      appVersion: input.appVersion || '',
      isElectron: !!input.isElectron,
      isMobile: !!input.isMobile,
      status: isPending ? 'pending' : 'active',
      isActive: !isPending,
      isOnline: true,
      trustLevel: isPending ? 'untrusted' : 'trusted',
      lastLoginAt: now,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      firstSeenAt: now,
      ...(isPending ? {} : { approvedBy: 'system', approvedAt: now }),
    });

    await this.activity(
      device,
      isPending ? 'device_registered' : 'device_registered',
      `Device "${device.deviceName || device.deviceId}" registered${isPending ? ' (pending approval)' : ''}`,
      { deviceId: input.deviceId, requireApproval: isPending },
      input.ipAddress,
    );

    return this.toRow(device, { restaurant: await this.restaurantName(restaurantId) });
  }

  private async restaurantName(restaurantId?: string): Promise<string | undefined> {
    if (!restaurantId) return undefined;
    try {
      const r = await Restaurant.findById(restaurantId).lean().exec();
      return r?.name || undefined;
    } catch {
      return undefined;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // LIST — search / filter / sort / pagination (N+1-free)
  // ──────────────────────────────────────────────────────────────
  async list(query: Record<string, any>) {
    // Keep online flags fresh before querying.
    await this.markStaleDevicesOffline();

    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20 });
    const filter: Record<string, any> = { isDeleted: { $ne: true } };
    if (query.deleted === 'true') {
      filter.isDeleted = true;
      filter.deletedAt = { $exists: true };
    }

    const searchable = parseSearch(query.search, SEARCH_FIELDS);
    if (searchable) Object.assign(filter, searchable);

    if (query.status) filter.status = query.status;
    if (query.restaurantId) filter.restaurantId = query.restaurantId;
    if (query.branchId) filter.branchId = query.branchId;
    if (query.userId) filter.userId = query.userId;
    if (query.platform) filter.platform = query.platform;
    if (query.os) filter.os = query.os;
    if (query.appVersion) filter.appVersion = query.appVersion;

    if (query.pending === 'true') filter.status = 'pending';
    if (query.approved === 'true') filter.status = { $in: ['active', 'inactive', 'blocked'] };
    if (query.approved === 'false') filter.status = { $in: ['pending', 'rejected'] };
    if (query.online === 'true') filter.isOnline = true;
    if (query.offline === 'true') filter.isOnline = { $ne: true };

    const lastActiveRange = parseDateRange(
      [query.lastActiveFrom, query.lastActiveTo].filter(Boolean).join(',') || undefined,
      'lastActivityAt',
    );
    if (lastActiveRange) Object.assign(filter, lastActiveRange);
    const createdRange = parseDateRange(
      [query.createdFrom, query.createdTo].filter(Boolean).join(',') || undefined,
      'createdAt',
    );
    if (createdRange) Object.assign(filter, createdRange);

    const sortBy = ALLOWED_SORTS.includes(query.sortBy) ? query.sortBy : 'lastLoginAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    // Stable default ordering: newest activity first, ties broken by createdAt.
    const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder, createdAt: sortOrder === 1 ? 1 : -1 };

    const [devices, total] = await Promise.all([
      Device.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      Device.countDocuments(filter).exec(),
    ]);

    // N+1 fix: resolve restaurant + branch names in two grouped queries.
    const restaurantIds = [...new Set(devices.map((d) => d.restaurantId?.toString()).filter((x): x is string => Boolean(x)))];
    const branchIds = [...new Set(devices.map((d) => d.branchId?.toString()).filter((x): x is string => Boolean(x)))];
    const [restaurants, branches] = await Promise.all([
      restaurantIds.length
        ? Restaurant.find({ _id: { $in: restaurantIds } }).select('name').lean().exec()
        : Promise.resolve([]),
      branchIds.length
        ? Branch.find({ _id: { $in: branchIds } }).select('name').lean().exec()
        : Promise.resolve([]),
    ]);
    const restMap = new Map(restaurants.map((r) => [r._id.toString(), r.name]));
    const branchMap = new Map(branches.map((b) => [b._id.toString(), b.name]));

    // Per-restaurant device counts in ONE grouped query (devicesUsingCount).
    const countAgg = restaurantIds.length
      ? await Device.aggregate([
          { $match: { restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } } },
          { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
        ]).exec()
      : [];
    const countMap = new Map(countAgg.map((c) => [c._id.toString(), c.count]));

    const data = devices.map((d) => {
      const row = this.toRow(d, {
        restaurant: d.restaurantId ? restMap.get(d.restaurantId.toString()) : undefined,
        branch: d.branchId ? branchMap.get(d.branchId.toString()) : undefined,
      });
      row.devicesUsingCount = d.restaurantId ? countMap.get(d.restaurantId.toString()) || 0 : 0;
      return row;
    });

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      total,
      page,
      limit,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // GET ONE
  // ──────────────────────────────────────────────────────────────
  async getById(id: string) {
    const device = await this.findDevice(id, { includeDeleted: true });
    const [restaurant, branch, sessionCount] = await Promise.all([
      device.restaurantId ? Restaurant.findById(device.restaurantId).lean().exec() : Promise.resolve(null),
      device.branchId ? Branch.findById(device.branchId).lean().exec() : Promise.resolve(null),
      RefreshToken.countDocuments({
        deviceId: device.deviceId,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      }).exec(),
    ]);
    const row = this.toRow(device, {
      restaurant: restaurant?.name,
      branch: branch?.name,
    });
    row.activeSessions = sessionCount;
    row.health = this.computeHealth(device);
    return row;
  }

  // ──────────────────────────────────────────────────────────────
  // APPROVAL WORKFLOW
  // ──────────────────────────────────────────────────────────────
  async approve(id: string, actor: AdminIdentity, note?: string) {
    const device = await this.findDevice(id);
    if (device.isDeleted) throw new AppError(400, 'Device is deleted');
    if (device.status !== 'pending' && device.status !== 'rejected') {
      throw new AppError(400, `Only pending or rejected devices can be approved (current: ${device.status})`);
    }
    const before = this.toRow(device);
    device.status = 'active';
    device.isActive = true;
    device.approvedBy = actor.name;
    device.approvedAt = new Date();
    device.rejectedBy = null;
    device.rejectedAt = null;
    device.rejectionReason = null;
    device.trustLevel = 'trusted';
    if (note) device.notes = note;
    device.lastActivityAt = new Date();
    await device.save();

    await this.activity(device, 'device_approved', `Device "${device.deviceName || device.deviceId}" approved by ${actor.name}`, { approvedBy: actor.name }, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_APPROVE', device, actor, { before }, this.toRow(device));
    return this.toRow(device);
  }

  async reject(id: string, actor: AdminIdentity, reason?: string) {
    const device = await this.findDevice(id);
    if (device.isDeleted) throw new AppError(400, 'Device is deleted');
    if (device.status === 'rejected') throw new AppError(400, 'Device is already rejected');
    const before = this.toRow(device);
    device.status = 'rejected';
    device.isActive = false;
    device.rejectedBy = actor.name;
    device.rejectedAt = new Date();
    device.rejectionReason = reason || null;
    device.trustLevel = 'untrusted';
    device.lastActivityAt = new Date();
    await device.save();

    // A rejected device must not keep its sessions.
    await this.revokeDeviceTokens(device.deviceId);
    await this.activity(device, 'device_rejected', `Device "${device.deviceName || device.deviceId}" rejected by ${actor.name}`, { reason: reason || null }, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_REJECT', device, actor, { before }, this.toRow(device));
    return this.toRow(device);
  }

  async bulkApprove(ids: string[], actor: AdminIdentity, note?: string) {
    let approved = 0;
    const results: Array<{ id: string; status: 'approved' | 'failed'; message: string }> = [];
    for (const id of ids) {
      try {
        await this.approve(id, actor, note);
        approved += 1;
        results.push({ id, status: 'approved', message: 'Device approved' });
      } catch (error: any) {
        results.push({ id, status: 'failed', message: error?.message || 'Failed to approve' });
      }
    }
    await this.audit(
      'ADMIN_DEVICE_BULK_APPROVE',
      { _id: new mongoose.Types.ObjectId(), deviceId: ids.join(','), restaurantId: undefined },
      actor,
      { ids, approved },
      { ids, approved },
    );
    return { approved, results };
  }

  async bulkReject(ids: string[], actor: AdminIdentity, reason?: string) {
    let rejected = 0;
    const results: Array<{ id: string; status: 'rejected' | 'failed'; message: string }> = [];
    for (const id of ids) {
      try {
        await this.reject(id, actor, reason);
        rejected += 1;
        results.push({ id, status: 'rejected', message: 'Device rejected' });
      } catch (error: any) {
        results.push({ id, status: 'failed', message: error?.message || 'Failed to reject' });
      }
    }
    await this.audit(
      'ADMIN_DEVICE_BULK_REJECT',
      { _id: new mongoose.Types.ObjectId(), deviceId: ids.join(','), restaurantId: undefined },
      actor,
      { ids, rejected },
      { ids, rejected },
    );
    return { rejected, results };
  }

  // ──────────────────────────────────────────────────────────────
  // BLOCK / UNBLOCK (legacy, enhanced with session cleanup + audit)
  // ──────────────────────────────────────────────────────────────
  async block(id: string, actor: AdminIdentity) {
    const device = await this.findDevice(id);
    if (device.status === 'blocked') throw new AppError(400, 'Device is already blocked');
    const before = this.toRow(device);
    device.status = 'blocked';
    device.isActive = false;
    device.isOnline = false;
    device.lastActivityAt = new Date();
    await device.save();

    // A blocked device must not keep its sessions alive.
    const revoked = await this.revokeDeviceTokens(device.deviceId);
    await this.activity(device, 'device_blocked', `Device "${device.deviceName || device.deviceId}" blocked by ${actor.name}`, { revokedSessions: revoked }, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_BLOCK', device, actor, { before, revokedSessions: revoked }, this.toRow(device));
    return { revokedSessions: revoked || 0 };
  }

  async unblock(id: string, actor: AdminIdentity) {
    const device = await this.findDevice(id);
    if (device.status !== 'blocked') throw new AppError(400, 'Device is not blocked');
    const before = this.toRow(device);
    device.status = 'active';
    device.isActive = true;
    device.lastActivityAt = new Date();
    await device.save();

    await this.activity(device, 'device_unblocked', `Device "${device.deviceName || device.deviceId}" unblocked by ${actor.name}`, {}, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_UNBLOCK', device, actor, { before }, this.toRow(device));
    return { revokedSessions: 0 };
  }

  // ──────────────────────────────────────────────────────────────
  // REMOVAL
  // ──────────────────────────────────────────────────────────────
  async remove(id: string, actor: AdminIdentity, reason?: string) {
    const device = await this.findDevice(id);
    const before = this.toRow(device);
    device.isDeleted = true;
    device.deletedAt = new Date();
    device.deletionReason = reason || null;
    device.isActive = false;
    device.isOnline = false;
    device.status = 'inactive';
    device.lastActivityAt = new Date();
    await device.save();

    // Cleanup: revoke every session for this device.
    const revoked = await this.revokeDeviceTokens(device.deviceId);

    await this.activity(device, 'device_removed', `Device "${device.deviceName || device.deviceId}" removed by ${actor.name}`, { reason: reason || null, revokedSessions: revoked }, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_REMOVE', device, actor, { before, reason: reason || null, revokedSessions: revoked }, this.toRow(device));
    return { message: 'Device removed', revokedSessions: revoked || 0 };
  }

  async permanentDelete(id: string, actor: AdminIdentity) {
    const device = await this.findDevice(id, { includeDeleted: true });
    if (!device.isDeleted) {
      throw new AppError(400, 'Permanent deletion requires the device to be removed (soft-deleted) first');
    }
    await this.revokeDeviceTokens(device.deviceId);
    await DeviceActivity.deleteMany({ deviceId: device._id }).exec();
    const deviceId = device.deviceId;
    const restaurantId = device.restaurantId;
    await Device.findByIdAndDelete(device._id).exec();
    await this.audit(
      'ADMIN_DEVICE_PERMANENT_DELETE',
      { _id: device._id, deviceId, restaurantId },
      actor,
      { deviceId, reason: device.deletionReason || null },
      { deviceId, deleted: true },
    );
    return { message: 'Device permanently deleted' };
  }

  async removeInactive(actor: AdminIdentity, restaurantId?: string) {
    const filter: Record<string, any> = {
      status: 'inactive',
      isDeleted: { $ne: true },
    };
    if (restaurantId) filter.restaurantId = restaurantId;
    const devices = await Device.find(filter).select('_id deviceId deviceName restaurantId').lean().exec();
    const now = new Date();
    for (const d of devices) {
      await Device.updateOne(
        { _id: d._id },
        { $set: { isDeleted: true, deletedAt: now, deletionReason: 'Removed with all inactive devices', isActive: false, isOnline: false } },
      ).exec();
      await this.revokeDeviceTokens(d.deviceId);
      await this.activity(d as any, 'device_removed', `Inactive device "${d.deviceName || d.deviceId}" removed by ${actor.name}`, { bulk: true }, actor.ipAddress);
    }
    await this.audit(
      'ADMIN_DEVICE_REMOVE_INACTIVE',
      { _id: new mongoose.Types.ObjectId(), deviceId: '', restaurantId: restaurantId as any },
      actor,
      { count: devices.length },
      { count: devices.length },
    );
    return { removed: devices.length };
  }

  // ──────────────────────────────────────────────────────────────
  // FORCE LOGOUT
  // ──────────────────────────────────────────────────────────────
  async forceLogout(
    body: { scope?: string; deviceId?: string; ids?: string[]; restaurantId?: string; reason?: string },
    actor: AdminIdentity,
  ) {
    const scope = body.scope || 'selected';
    let match: Record<string, any> = {};
    let label = '';

    if (scope === 'current' || scope === 'selected') {
      if (body.deviceId) {
        match = { deviceId: body.deviceId };
        label = `device ${body.deviceId}`;
      } else if (body.ids && body.ids.length > 0) {
        const devices = await Device.find({ _id: { $in: body.ids } }).select('deviceId').lean().exec();
        const deviceIds = devices.map((d) => d.deviceId);
        match = { deviceId: { $in: deviceIds } };
        label = `${deviceIds.length} device(s)`;
      } else {
        throw new AppError(400, 'deviceId or ids is required for the selected scope');
      }
    } else if (scope === 'all') {
      match = { userId: actor.id as any };
      label = 'all sessions for the user';
    } else if (scope === 'restaurant') {
      if (!body.restaurantId) throw new AppError(400, 'restaurantId is required for the restaurant scope');
      match = { restaurantId: body.restaurantId as any };
      label = `restaurant ${body.restaurantId}`;
    } else {
      throw new AppError(400, `Unknown logout scope "${scope}"`);
    }

    const revoked = await refreshTokenRepo.updateMany(
      { ...match, isRevoked: false } as any,
      { isRevoked: true } as any,
    );

    await this.audit(
      'ADMIN_DEVICE_FORCE_LOGOUT',
      { _id: new mongoose.Types.ObjectId(), deviceId: body.deviceId || body.ids?.join(',') || '', restaurantId: body.restaurantId as any },
      actor,
      { scope, reason: body.reason || null, revoked: revoked || 0 },
      { scope, revoked: revoked || 0 },
    );

    return { message: 'Sessions revoked', scope, revoked: revoked || 0, label };
  }

  // ──────────────────────────────────────────────────────────────
  // SESSIONS (per device)
  // ──────────────────────────────────────────────────────────────
  async listSessions(deviceIdDoc: string, query: Record<string, any> = {}) {
    const device = await this.findDevice(deviceIdDoc, { includeDeleted: true });
    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20 });
    const now = new Date();
    const filter = { deviceId: device.deviceId };
    const [docs, total] = await Promise.all([
      RefreshToken.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      RefreshToken.countDocuments(filter).exec(),
    ]);
    const sessions = docs.map((d: any) => ({
      id: d._id.toString(),
      deviceId: d.deviceId || null,
      deviceName: d.deviceName || null,
      os: d.os || null,
      appVersion: d.appVersion || null,
      ipAddress: d.ipAddress || null,
      userAgent: d.userAgent || null,
      createdAt: d.createdAt ? d.createdAt.toISOString() : null,
      expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
      lastActivityAt: d.lastActivityAt ? d.lastActivityAt.toISOString() : null,
      isActive: !d.isRevoked && d.expiresAt > now,
      isRevoked: !!d.isRevoked,
    }));
    const totalPages = Math.ceil(total / limit);
    return {
      device: { id: device._id.toString(), deviceId: device.deviceId, deviceName: device.deviceName || 'Unknown' },
      data: sessions,
      total,
      page,
      limit,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
    };
  }

  async revokeSession(deviceIdDoc: string, sessionId: string, actor: AdminIdentity) {
    const device = await this.findDevice(deviceIdDoc);
    const session = await RefreshToken.findById(sessionId).exec();
    if (!session) throw new AppError(404, 'Session not found');
    if (session.deviceId !== device.deviceId) {
      throw new AppError(403, 'Session does not belong to this device');
    }
    if (session.isRevoked) throw new AppError(400, 'Session is already revoked');
    session.isRevoked = true;
    await session.save();
    await this.activity(device, 'device_session_revoked', `Session for "${device.deviceName || device.deviceId}" revoked by ${actor.name}`, { sessionId }, actor.ipAddress);
    await this.audit('ADMIN_DEVICE_SESSION_REVOKE', device, actor, { sessionId }, { sessionId, isRevoked: true });
    return { message: 'Session revoked' };
  }

  // ──────────────────────────────────────────────────────────────
  // HISTORY
  // ──────────────────────────────────────────────────────────────
  async history(deviceIdDoc: string, query: Record<string, any> = {}) {
    const device = await this.findDevice(deviceIdDoc, { includeDeleted: true });
    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20 });
    const filter: Record<string, any> = { deviceId: device._id };
    if (query.event) filter.event = query.event;
    const [docs, total] = await Promise.all([
      DeviceActivity.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      DeviceActivity.countDocuments(filter).exec(),
    ]);
    const data = docs.map((a: any) => ({
      id: a._id.toString(),
      event: a.event,
      description: a.description,
      metadata: a.metadata || {},
      ipAddress: a.ipAddress || null,
      timestamp: a.createdAt ? a.createdAt.toISOString() : null,
    }));
    const totalPages = Math.ceil(total / limit);
    return {
      device: { id: device._id.toString(), deviceId: device.deviceId, deviceName: device.deviceName || 'Unknown' },
      data,
      total,
      page,
      limit,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // HEALTH
  // ──────────────────────────────────────────────────────────────
  async heartbeat(
    input: {
      userId: string;
      restaurantId?: string;
      deviceId: string;
      deviceName?: string;
      os?: string;
      osVersion?: string;
      appVersion?: string;
      electronVersion?: string;
      dbSyncStatus?: string;
      pendingSyncCount?: number;
      failedSyncCount?: number;
      lastSyncAt?: string;
    },
  ) {
    if (!input.deviceId) throw new AppError(400, 'deviceId is required');
    let device = await Device.findOne({ deviceId: input.deviceId, isDeleted: { $ne: true } })
      .sort({ lastHeartbeatAt: -1 })
      .exec();
    if (!device) {
      // First heartbeat without a prior registration — auto-create the record.
      device = await Device.create({
        userId: input.userId,
        restaurantId: input.restaurantId ? (input.restaurantId as any) : undefined,
        deviceId: input.deviceId,
        deviceName: input.deviceName || '',
        os: input.os || '',
        osVersion: input.osVersion || '',
        appVersion: input.appVersion || '',
        status: 'active',
        isActive: true,
        isOnline: true,
        firstSeenAt: new Date(),
      });
    }
    const now = new Date();
    device.lastHeartbeatAt = now;
    device.lastActivityAt = now;
    device.isOnline = true;
    device.lastSyncAt = input.lastSyncAt ? new Date(input.lastSyncAt) : now;
    if (input.dbSyncStatus) device.dbSyncStatus = input.dbSyncStatus as any;
    if (input.pendingSyncCount !== undefined) device.pendingSyncCount = input.pendingSyncCount;
    if (input.failedSyncCount !== undefined) device.failedSyncCount = input.failedSyncCount;
    if (input.appVersion) device.appVersion = input.appVersion;
    if (input.osVersion) device.osVersion = input.osVersion;
    if (input.electronVersion) device.electronVersion = input.electronVersion;
    if (input.os) device.os = input.os;
    if (input.deviceName) device.deviceName = input.deviceName;
    if (device.status === 'inactive') device.status = 'active';
    await device.save();

    return this.healthPayload(device);
  }

  async health(id: string) {
    const device = await this.findDevice(id, { includeDeleted: true });
    await this.markStaleDevicesOffline();
    const fresh = await Device.findById(device._id).lean().exec();
    return this.healthPayload(fresh || device);
  }

  private computeHealth(d: any) {
    const now = Date.now();
    const last = d.lastHeartbeatAt?.getTime() || d.lastActivityAt?.getTime() || d.lastLoginAt?.getTime() || d.createdAt?.getTime() || now;
    const online = d.status === 'active' && d.isOnline !== false && (now - last) < ONLINE_THRESHOLD_MS;
    return {
      status: d.status,
      online,
      offline: !online && d.status !== 'inactive' && d.status !== 'blocked' && d.status !== 'rejected',
      inactive: d.status === 'inactive',
      lastHeartbeat: d.lastHeartbeatAt ? d.lastHeartbeatAt.toISOString() : null,
      lastActivity: d.lastActivityAt ? d.lastActivityAt.toISOString() : null,
      lastLogin: d.lastLoginAt ? d.lastLoginAt.toISOString() : null,
      lastSync: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
      appVersion: d.appVersion || null,
      osVersion: d.osVersion || null,
      electronVersion: d.electronVersion || null,
      dbSyncStatus: d.dbSyncStatus || 'synced',
      pendingSyncCount: d.pendingSyncCount ?? 0,
      failedSyncCount: d.failedSyncCount ?? 0,
    };
  }

  private async healthPayload(d: any) {
    const health = this.computeHealth(d);
    const sessionCount = await RefreshToken.countDocuments({
      deviceId: d.deviceId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).exec();
    return {
      ...this.toRow(d),
      health: { ...health, activeSessions: sessionCount },
      activeSessions: sessionCount,
    };
  }

  /** Auto-maintained health: mark devices offline when heartbeats go stale. */
  async markStaleDevicesOffline(): Promise<number> {
    try {
      const offlineCutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS);
      const res = await Device.updateMany(
        { isOnline: true, lastHeartbeatAt: { $lt: offlineCutoff } },
        { $set: { isOnline: false } },
      ).exec();
      const inactiveCutoff = new Date(Date.now() - INACTIVE_THRESHOLD_MS);
      await Device.updateMany(
        {
          status: { $in: ['active', 'inactive'] },
          isDeleted: { $ne: true },
          lastHeartbeatAt: { $lt: inactiveCutoff },
        },
        { $set: { status: 'inactive', isActive: false } },
      ).exec();
      return res.modifiedCount || 0;
    } catch {
      return 0;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // STATISTICS — backend-generated
  // ──────────────────────────────────────────────────────────────
  async statistics(query: Record<string, any> = {}) {
    await this.markStaleDevicesOffline();
    const match: Record<string, any> = { isDeleted: { $ne: true } };
    if (query.restaurantId) match.restaurantId = query.restaurantId;
    // Aggregations do NOT auto-cast strings to ObjectId (queries do) — cast
    // explicitly so the $match filters work inside $group pipelines.
    if (query.restaurantId) match.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    const now = new Date();

    const [total, active, pending, rejected, blocked, inactive, online, sessions] = await Promise.all([
      Device.countDocuments(match).exec(),
      Device.countDocuments({ ...match, status: 'active' }).exec(),
      Device.countDocuments({ ...match, status: 'pending' }).exec(),
      Device.countDocuments({ ...match, status: 'rejected' }).exec(),
      Device.countDocuments({ ...match, status: 'blocked' }).exec(),
      Device.countDocuments({ ...match, status: 'inactive' }).exec(),
      Device.countDocuments({ ...match, isOnline: true }).exec(),
      RefreshToken.countDocuments({
        ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
        isRevoked: false,
        expiresAt: { $gt: now },
      }).exec(),
    ]);

    const [byStatus, byPlatform, byOs] = await Promise.all([
      Device.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
      Device.aggregate([
        { $match: match },
        { $group: { _id: { $ifNull: ['$platform', 'unknown'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
      Device.aggregate([
        { $match: match },
        { $group: { _id: { $ifNull: ['$os', 'unknown'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
    ]);

    return {
      total,
      active,
      pending,
      rejected,
      blocked,
      inactive,
      online,
      offline: Math.max(0, active - online),
      activeSessions: sessions,
      byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
      byPlatform: byPlatform.map((p) => ({ platform: p._id, count: p.count })),
      byOs: byOs.map((o) => ({ os: o._id, count: o.count })),
      lastUpdated: now.toISOString(),
    };
  }
}

export const deviceService = new DeviceService();
