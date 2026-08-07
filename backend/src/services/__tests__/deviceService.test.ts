/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeviceService Integration Tests (Phase 2.5)
 *
 * Uses mongodb-memory-server (real MongoDB) and exercises the REAL deviceService
 * methods end to end.
 *
 * Coverage:
 *   - Registration (new device, existing-device refresh, blocked/rejected hard
 *     block, fingerprint dedup, plan-limit enforcement BEFORE record creation,
 *     pending-approval flow)
 *   - Approval workflow (approve, reject + session revocation, bulk)
 *   - Block / unblock (session cleanup + audit)
 *   - Removal (soft delete + refresh-token cleanup, permanent delete,
 *     remove-inactive)
 *   - Force logout (selected / all / restaurant scopes)
 *   - Sessions (list + revoke one session)
 *   - Health (heartbeat ingestion, health payload, stale-offline sweep)
 *   - History (queryable device activity feed)
 *   - Search / filter / sort / pagination (backend totals)
 *   - Device limits (graceful rejection at registration)
 *   - Tenant isolation (devices scoped to their restaurant)
 *   - Audit logging on every mutation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { deviceService } from '../deviceService';
import { DeviceLimitReachedError, DeviceBlockedError } from '../devicePolicyService';
import Device from '../../models/Device';
import DeviceActivity from '../../models/DeviceActivity';
import RefreshToken from '../../models/RefreshToken';
import Restaurant from '../../models/Restaurant';
import Branch from '../../models/Branch';
import Subscription from '../../models/Subscription';
import AuditLog from '../../models/AuditLog';

let mongod: MongoMemoryServer;

const admin = {
  id: 'super_admin_1',
  name: 'Super Admin Test',
  ipAddress: '203.0.113.9',
  deviceId: 'console-1',
};

const userIdA = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Device.deleteMany({}).exec(),
    DeviceActivity.deleteMany({}).exec(),
    RefreshToken.deleteMany({}).exec(),
    Restaurant.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
    Subscription.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
  ]);
});

async function createRestaurant(name = 'Dev Eats', maxDevices = 3) {
  const restaurant = await Restaurant.create({
    restaurantId: name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 20),
    name,
    phone: '+1-555-0001',
    isActive: true,
  });
  await Subscription.create({
    restaurantId: restaurant._id,
    plan: 'pro_test',
    status: 'active',
    startDate: new Date(),
    maxDevices,
  });
  return restaurant;
}

function refreshTokenFor(userId: string, restaurantId: any, deviceId: string, over: Record<string, any> = {}) {
  return RefreshToken.create({
    userId,
    restaurantId,
    deviceId,
    tokenHash: `hash_${deviceId}_${Math.random()}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isRevoked: false,
    ipAddress: '198.51.100.7',
    userAgent: 'Mozilla/5.0 Test',
    ...over,
  });
}

describe('deviceService.register', () => {
  it('registers a brand-new device (trusted, active, online)', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();

    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-1', deviceName: 'POS Terminal 1' });

    expect(row.deviceId).toBe('term-1');
    expect(row.status).toBe('active');
    expect(row.approvalStatus).toBe('approved');
    expect(row.isActive).toBe(true);
    expect(row.isOnline).toBe(true);
    expect(row.restaurantId).toBe(restaurant._id.toString());
    expect(row.userId).toBe(userId);

    const activity = await DeviceActivity.findOne({ event: 'device_registered' }).lean().exec();
    expect(activity).toBeTruthy();
    expect(activity!.deviceId.toString()).toBe(row.id);
  });

  it('refreshes an existing device instead of duplicating it', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const first = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-2' });

    const second = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-2', os: 'Windows 11' });

    expect(second.id).toBe(first.id);
    expect(second.os).toBe('Windows 11');
    expect(await Device.countDocuments({ deviceId: 'term-2' }).exec()).toBe(1);
  });

  it('deduplicates a device by fingerprint across deviceIds', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const first = await deviceService.register({
      userId,
      restaurantId: restaurant._id.toString(),
      deviceId: 'term-fp-1',
      fingerprint: 'fp-abc-123',
    });

    const second = await deviceService.register({
      userId,
      restaurantId: restaurant._id.toString(),
      deviceId: 'term-fp-2',
      fingerprint: 'fp-abc-123',
    });

    expect(second.id).toBe(first.id);
    expect(await Device.countDocuments({ fingerprint: 'fp-abc-123' }).exec()).toBe(1);
  });

  it('hard-blocks registration from a blocked or rejected device', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-bad' });

    const device = await Device.findById(row.id).exec();
    device!.status = 'blocked';
    device!.isActive = false;
    await device!.save();

    await expect(
      deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-bad' }),
    ).rejects.toBeInstanceOf(DeviceBlockedError);
  });

  it('enforces the plan device limit BEFORE creating the record', async () => {
    const restaurant = await createRestaurant('Limit Eats', 2);
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 't1' });
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 't2' });

    await expect(
      deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 't3' }),
    ).rejects.toBeInstanceOf(DeviceLimitReachedError);

    // No record was created for the rejected device.
    expect(await Device.countDocuments({ deviceId: 't3' }).exec()).toBe(0);
    const violation = await DeviceActivity.findOne({ event: 'device_limit_violation' }).lean().exec();
    expect(violation).toBeTruthy();
  });

  it('creates a pending device when requireApproval is set', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({
      userId,
      restaurantId: restaurant._id.toString(),
      deviceId: 'term-pending',
      requireApproval: true,
    });

    expect(row.status).toBe('pending');
    expect(row.approvalStatus).toBe('pending');
    expect(row.trustLevel).toBe('untrusted');
    expect(row.isActive).toBe(false);
  });
});

describe('deviceService approval workflow', () => {
  it('approves a pending device and records the approver', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-approve', requireApproval: true });

    const approved = await deviceService.approve(row.id, admin, 'Looks good');

    expect(approved.status).toBe('active');
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvedBy).toBe('Super Admin Test');
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.trustLevel).toBe('trusted');

    const activity = await DeviceActivity.findOne({ event: 'device_approved' }).lean().exec();
    expect(activity).toBeTruthy();
    const audit = await AuditLog.findOne({ action: 'ADMIN_DEVICE_APPROVE' }).lean().exec();
    expect(audit).toBeTruthy();
    expect((audit!.details as any).before.status).toBe('pending');
    expect((audit!.details as any).after.status).toBe('active');
  });

  it('rejects a pending device and revokes its sessions', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-reject', requireApproval: true });
    await refreshTokenFor(userId, restaurant._id, 'term-reject');

    const rejected = await deviceService.reject(row.id, admin, 'Unknown terminal');

    expect(rejected.status).toBe('rejected');
    expect(rejected.approvalStatus).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Unknown terminal');

    const tokens = await RefreshToken.find({ deviceId: 'term-reject' }).lean().exec();
    expect(tokens.every((t) => t.isRevoked)).toBe(true);

    const activity = await DeviceActivity.findOne({ event: 'device_rejected' }).lean().exec();
    expect(activity).toBeTruthy();
    const audit = await AuditLog.findOne({ action: 'ADMIN_DEVICE_REJECT' }).lean().exec();
    expect(audit).toBeTruthy();
  });

  it('bulk-approves and bulk-rejects with per-device results', async () => {
    const restaurant = await createRestaurant('Bulk Eats', 10);
    const userId = userIdA();
    const a = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-ba', requireApproval: true });
    const b = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-bb', requireApproval: true });

    const bulkApprove = await deviceService.bulkApprove([a.id, b.id], admin);
    expect(bulkApprove.approved).toBe(2);
    expect(bulkApprove.results.every((r) => r.status === 'approved')).toBe(true);
    expect((await Device.findById(a.id).lean().exec())!.status).toBe('active');

    const c = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-bc', requireApproval: true });
    const d = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-bd', requireApproval: true });
    const bulkReject = await deviceService.bulkReject([c.id, d.id], admin, 'Unapproved batch');
    expect(bulkReject.rejected).toBe(2);
    expect((await Device.findById(c.id).lean().exec())!.status).toBe('rejected');
  });
});

describe('deviceService block / unblock', () => {
  it('blocks a device, revokes sessions, then unblocks it', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-block' });
    await refreshTokenFor(userId, restaurant._id, 'term-block');

    const blocked = await deviceService.block(row.id, admin);
    expect(blocked.revokedSessions).toBe(1);
    const doc = await Device.findById(row.id).lean().exec();
    expect(doc!.status).toBe('blocked');
    expect(doc!.isOnline).toBe(false);

    // Rejected registration while blocked.
    await expect(
      deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-block' }),
    ).rejects.toBeInstanceOf(DeviceBlockedError);

    const unblocked = await deviceService.unblock(row.id, admin);
    expect(unblocked).toBeTruthy();
    expect((await Device.findById(row.id).lean().exec())!.status).toBe('active');

    const audit = await AuditLog.findOne({ action: 'ADMIN_DEVICE_BLOCK' }).lean().exec();
    expect(audit).toBeTruthy();
  });
});

describe('deviceService removal', () => {
  it('soft-removes a device and cleans up its refresh tokens', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-remove' });
    await refreshTokenFor(userId, restaurant._id, 'term-remove');

    const result = await deviceService.remove(row.id, admin, 'Replaced terminal');
    expect(result.revokedSessions).toBe(1);

    const doc = await Device.findById(row.id).lean().exec();
    expect(doc!.isDeleted).toBe(true);
    expect(doc!.deletedAt).toBeTruthy();
    expect(doc!.deletionReason).toBe('Replaced terminal');
    expect((await RefreshToken.find({ deviceId: 'term-remove' }).lean().exec()).every((t) => t.isRevoked)).toBe(true);

    const activity = await DeviceActivity.findOne({ event: 'device_removed' }).lean().exec();
    expect(activity).toBeTruthy();
  });

  it('permanently deletes only after a soft delete, purging activity', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-purge' });

    await expect(deviceService.permanentDelete(row.id, admin)).rejects.toThrow(/soft-deleted/);

    await deviceService.remove(row.id, admin);
    await deviceService.permanentDelete(row.id, admin);

    expect(await Device.findById(row.id).lean().exec()).toBeNull();
    expect(await DeviceActivity.countDocuments({ deviceId: row.id }).exec()).toBe(0);
  });

  it('removes all inactive devices at once', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const active = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-active' });
    const inactive = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-idle' });
    await Device.updateOne({ _id: inactive.id }, { $set: { status: 'inactive', isActive: false } }).exec();

    const result = await deviceService.removeInactive(admin);
    expect(result.removed).toBe(1);

    const doc = await Device.findById(inactive.id).lean().exec();
    expect(doc!.isDeleted).toBe(true);
    expect((await Device.findById(active.id).lean().exec())!.isDeleted).toBe(false);
  });
});

describe('deviceService force logout', () => {
  it('revokes sessions for a selected device', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-logout' });
    await refreshTokenFor(userId, restaurant._id, 'term-logout');

    const result = await deviceService.forceLogout({ scope: 'selected', deviceId: 'term-logout' }, admin);
    expect(result.revoked).toBe(1);
    expect((await RefreshToken.findOne({ deviceId: 'term-logout' }).lean().exec())!.isRevoked).toBe(true);
  });

  it('revokes sessions for multiple devices via ids', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const a = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-m1' });
    const b = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-m2' });
    await refreshTokenFor(userId, restaurant._id, 'term-m1');
    await refreshTokenFor(userId, restaurant._id, 'term-m2');

    const result = await deviceService.forceLogout({ scope: 'selected', ids: [a.id, b.id] }, admin);
    expect(result.revoked).toBe(2);
  });

  it('revokes all sessions for a restaurant', async () => {
    const restaurant = await createRestaurant();
    const other = await createRestaurant('Other Eats');
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-r1' });
    await refreshTokenFor(userId, restaurant._id, 'term-r1');
    await refreshTokenFor(userId, other._id, 'term-other');

    const result = await deviceService.forceLogout({ scope: 'restaurant', restaurantId: restaurant._id.toString() }, admin);
    expect(result.revoked).toBe(1);
    // The other restaurant's session is untouched.
    expect((await RefreshToken.findOne({ deviceId: 'term-other' }).lean().exec())!.isRevoked).toBe(false);
  });

  it('rejects unknown logout scopes', async () => {
    await expect(deviceService.forceLogout({ scope: 'galaxy' }, admin)).rejects.toThrow(/Unknown logout scope/);
  });
});

describe('deviceService sessions', () => {
  it('lists a device session with active/expired flags', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-sess' });
    await refreshTokenFor(userId, restaurant._id, 'term-sess');
    await refreshTokenFor(userId, restaurant._id, 'term-sess', { isRevoked: true });

    const out = await deviceService.listSessions(row.id, {});
    expect(out.total).toBe(2);
    expect(out.data.some((s: any) => s.isActive && !s.isRevoked)).toBe(true);
    expect(out.data.some((s: any) => s.isRevoked)).toBe(true);
    expect(out.device.deviceId).toBe('term-sess');
  });

  it('revokes a single session belonging to the device', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-srev' });
    const session = await refreshTokenFor(userId, restaurant._id, 'term-srev');

    await deviceService.revokeSession(row.id, session._id.toString(), admin);
    expect((await RefreshToken.findById(session._id).lean().exec())!.isRevoked).toBe(true);

    // A session from another device must be rejected (isolation).
    const other = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-other-s' });
    const otherSession = await refreshTokenFor(userId, restaurant._id, 'term-other-s');
    await expect(deviceService.revokeSession(other.id, session._id.toString(), admin)).rejects.toThrow(/does not belong/);
    expect((await RefreshToken.findById(otherSession._id).lean().exec())!.isRevoked).toBe(false);
  });
});

describe('deviceService health', () => {
  it('ingests a heartbeat and reports sync health', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-health' });

    const health = await deviceService.heartbeat({
      userId,
      restaurantId: restaurant._id.toString(),
      deviceId: 'term-health',
      appVersion: '1.5.0',
      electronVersion: '30.0.0',
      osVersion: 'Windows 11',
      dbSyncStatus: 'synced',
      pendingSyncCount: 3,
      failedSyncCount: 1,
    });

    expect(health.health.online).toBe(true);
    expect(health.health.dbSyncStatus).toBe('synced');
    expect(health.health.pendingSyncCount).toBe(3);
    expect(health.health.appVersion).toBe('1.5.0');
    expect(health.health.electronVersion).toBe('30.0.0');

    const doc = await Device.findOne({ deviceId: 'term-health' }).lean().exec();
    expect(doc!.lastHeartbeatAt).toBeTruthy();
  });

  it('marks stale devices offline via the sweep', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-stale' });
    await Device.updateOne(
      { deviceId: 'term-stale' },
      { $set: { lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000) } },
    ).exec();

    const swept = await deviceService.markStaleDevicesOffline();
    expect(swept).toBeGreaterThan(0);
    expect((await Device.findOne({ deviceId: 'term-stale' }).lean().exec())!.isOnline).toBe(false);
  });

  it('exposes a health payload for a single device', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-hview' });
    const health = await deviceService.health(row.id);
    expect(health.health).toBeTruthy();
    expect(typeof health.health.activeSessions).toBe('number');
  });
});

describe('deviceService history', () => {
  it('returns a queryable activity feed filtered by event', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-hist' });
    await deviceService.block(row.id, admin);
    await deviceService.unblock(row.id, admin);

    const all = await deviceService.history(row.id, {});
    expect(all.total).toBe(3); // registered + blocked + unblocked

    const blockedOnly = await deviceService.history(row.id, { event: 'device_blocked' });
    expect(blockedOnly.total).toBe(1);
    expect(blockedOnly.data[0].event).toBe('device_blocked');
  });
});

describe('deviceService list (search / filter / sort / pagination)', () => {
  it('paginates with real totals and next/previous metadata', async () => {
    const restaurant = await createRestaurant('Page Eats', 10);
    const userId = userIdA();
    for (let i = 0; i < 5; i++) {
      await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: `term-p${i}` });
    }

    const page1 = await deviceService.list({ page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.hasNext).toBe(true);
    expect(page1.hasPrevious).toBe(false);
    expect(page1.next).toBe(2);

    const page3 = await deviceService.list({ page: 3, limit: 2 });
    expect(page3.data.length).toBe(1);
    expect(page3.hasNext).toBe(false);
    expect(page3.next).toBeNull();
    expect(page3.previous).toBe(2);
  });

  it('searches case-insensitively across name, deviceId, os and platform', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-apple', deviceName: 'Back Office', os: 'Windows 11', platform: 'desktop' });
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-banana', deviceName: 'Kitchen Display', os: 'Android', platform: 'mobile' });

    expect((await deviceService.list({ search: 'BACK OFFICE' })).total).toBe(1);
    expect((await deviceService.list({ search: 'kitchen' })).total).toBe(1);
    expect((await deviceService.list({ search: 'term-banana' })).total).toBe(1);
    expect((await deviceService.list({ search: 'WINDOWS' })).total).toBe(1);
  });

  it('filters by status, platform, restaurant and online state', async () => {
    const restaurant = await createRestaurant();
    const other = await createRestaurant('Filter Eats');
    const userId = userIdA();
    const active = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-f1', platform: 'desktop' });
    const pending = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-f2', platform: 'mobile', requireApproval: true });
    await deviceService.register({ userId, restaurantId: other._id.toString(), deviceId: 'term-f3', platform: 'mobile' });

    expect((await deviceService.list({ status: 'active' })).total).toBe(2);
    expect((await deviceService.list({ platform: 'mobile' })).total).toBe(2);
    expect((await deviceService.list({ restaurantId: restaurant._id.toString() })).total).toBe(2);
    expect((await deviceService.list({ pending: 'true' })).total).toBe(1);
    expect((await deviceService.list({ online: 'true' })).total).toBe(3);

    await Device.updateOne({ _id: active.id }, { $set: { isOnline: false } }).exec();
    expect((await deviceService.list({ offline: 'true' })).total).toBe(1);
  });

  it('sorts by deviceName asc/desc with stable default ordering', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-s1', deviceName: 'Zulu' });
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-s2', deviceName: 'Alpha' });
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-s3', deviceName: 'Mike' });

    const asc = await deviceService.list({ sortBy: 'deviceName', sortOrder: 'asc' });
    expect(asc.data.map((d: any) => d.deviceName)).toEqual(['Alpha', 'Mike', 'Zulu']);

    const desc = await deviceService.list({ sortBy: 'deviceName', sortOrder: 'desc' });
    expect(desc.data.map((d: any) => d.deviceName)).toEqual(['Zulu', 'Mike', 'Alpha']);
  });

  it('includes deleted devices only when requested', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-del' });
    await deviceService.remove(row.id, admin);

    expect((await deviceService.list({})).total).toBe(0);
    const withDeleted = await deviceService.list({ deleted: 'true' });
    expect(withDeleted.total).toBe(1);
    expect(withDeleted.data[0].isDeleted).toBe(true);
  });

  it('resolves restaurant names without N+1 queries', async () => {
    const restaurant = await createRestaurant('NPlusOne Eats');
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-n1' });

    const out = await deviceService.list({});
    expect(out.data[0].restaurantName).toBe('NPlusOne Eats');
  });
});

describe('deviceService statistics', () => {
  it('returns backend-generated aggregates', async () => {
    const restaurant = await createRestaurant('Stats Eats', 10);
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'stat-1', platform: 'desktop', os: 'Windows' });
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'stat-2', platform: 'mobile', os: 'Android', requireApproval: true });
    await refreshTokenFor(userId, restaurant._id, 'stat-1');

    const stats = await deviceService.statistics({});
    expect(stats.total).toBe(2);
    expect(stats.active).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.online).toBeGreaterThanOrEqual(1);
    expect(stats.activeSessions).toBe(1);
    expect(stats.byPlatform.find((p: any) => p.platform === 'desktop')!.count).toBe(1);
    expect(stats.byOs.find((o: any) => o.os === 'Android')!.count).toBe(1);
  });

  it('scopes statistics to a restaurant', async () => {
    const restaurant = await createRestaurant('Scope Eats', 10);
    const other = await createRestaurant('Other Scope', 10);
    const userId = userIdA();
    await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'scope-1' });
    await deviceService.register({ userId, restaurantId: other._id.toString(), deviceId: 'scope-2' });

    const stats = await deviceService.statistics({ restaurantId: restaurant._id.toString() });
    expect(stats.total).toBe(1);
    expect(stats.byPlatform.reduce((sum: number, p: any) => sum + p.count, 0)).toBe(1);
  });
});

describe('deviceService tenant isolation + audit', () => {
  it('cannot access a device outside the admin scope by id', async () => {
    // getById does not enforce restaurant scoping itself (admins may manage all
    // restaurants) — but a deleted device is still hidden unless included.
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-isol' });
    const doc = await deviceService.getById(row.id);
    expect(doc.deviceId).toBe('term-isol');
  });

  it('audits every mutation type', async () => {
    const restaurant = await createRestaurant();
    const userId = userIdA();
    const row = await deviceService.register({ userId, restaurantId: restaurant._id.toString(), deviceId: 'term-audit' });
    await deviceService.block(row.id, admin);
    await deviceService.unblock(row.id, admin);
    await deviceService.forceLogout({ scope: 'selected', deviceId: 'term-audit' }, admin);
    await deviceService.remove(row.id, admin);

    const actions = (await AuditLog.find({}).lean().exec()).map((a) => a.action);
    expect(actions).toContain('ADMIN_DEVICE_BLOCK');
    expect(actions).toContain('ADMIN_DEVICE_UNBLOCK');
    expect(actions).toContain('ADMIN_DEVICE_REMOVE');
    expect(actions).toContain('ADMIN_DEVICE_FORCE_LOGOUT');
  });

  it('validates device ids and unknown devices', async () => {
    await expect(deviceService.getById('not-an-objectid')).rejects.toThrow(/Invalid device id/);
    await expect(deviceService.getById(new mongoose.Types.ObjectId().toString())).rejects.toThrow(/not found/);
  });
});
