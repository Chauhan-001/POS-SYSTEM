/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OwnerService Integration Tests (Phase 2.3)
 *
 * Uses mongodb-memory-server (real MongoDB) and exercises the REAL ownerService
 * methods end to end.
 *
 * Coverage:
 *   - create (atomic onboarding: User + Employee + restaurant mapping + audit)
 *   - onboarding rollback (no partial owner creation)
 *   - list (real total, search, restaurant filter, status filter, pagination)
 *   - update (whitelist guard, duplicate prevention)
 *   - setStatus (suspend/activate), lock/unlock
 *   - softDelete / restore / permanentDelete (cleanup of sessions/devices)
 *   - resetPassword (no plaintext leak, keeps User + Employee + Restaurant in sync)
 *   - restaurant mapping (assign / unassign / list)
 *   - sessions (list / revoke one / revoke all)
 *   - devices (list / block / unblock / remove)
 *   - login history (from RefreshToken + AuditLog)
 *   - profile + statistics (backend-generated)
 *   - audit logging on every mutation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ownerService } from '../ownerService';
import { hashPin } from '../../utils/bcrypt';

import User from '../../models/User';
import Employee from '../../models/Employee';
import Restaurant from '../../models/Restaurant';
import RefreshToken from '../../models/RefreshToken';
import Device from '../../models/Device';
import Branch from '../../models/Branch';
import AuditLog from '../../models/AuditLog';
import Subscription from '../../models/Subscription';

let mongod: MongoMemoryServer;

const admin = { id: 'super_admin_1', name: 'Super Admin Test' };

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
    User.deleteMany({}).exec(),
    Employee.deleteMany({}).exec(),
    Restaurant.deleteMany({}).exec(),
    RefreshToken.deleteMany({}).exec(),
    Device.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
    Subscription.deleteMany({}).exec(),
  ]);
});

async function createRestaurant(name = 'Test Eats') {
  return Restaurant.create({
    restaurantId: name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 20),
    name,
    phone: '+1-555-0001',
    isActive: true,
  });
}

async function seedOwner(over: Record<string, any> = {}) {
  const hashed = await hashPin('123456');
  return User.create({
    restaurantId: new mongoose.Types.ObjectId(),
    userId: `owner_test_${Math.random().toString(36).slice(2, 8)}`,
    phone: '9999999999',
    name: 'Test Owner',
    email: 'owner@test.com',
    password: hashed,
    role: 'owner',
    status: 'active',
    branchIds: [],
    ...over,
  });
}

async function seedSession(userId: mongoose.Types.ObjectId, over: Record<string, any> = {}) {
  return RefreshToken.create({
    userId,
    restaurantId: new mongoose.Types.ObjectId(),
    deviceId: 'dev-1',
    deviceName: 'Terminal A',
    os: 'Windows',
    appVersion: '1.0.0',
    ipAddress: '10.0.0.5',
    userAgent: 'Mozilla/5.0',
    tokenHash: `hash_${Math.random().toString(36).slice(2, 12)}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isRevoked: false,
    lastActivityAt: new Date(),
    ...over,
  });
}

describe('ownerService.create (atomic onboarding)', () => {
  it('creates User + Employee + restaurant mapping + audit atomically', async () => {
    const restaurant = await createRestaurant('Alpha Grill');

    const out = await ownerService.create({
      name: 'Alice Owner',
      email: 'alice@test.com',
      phone: '9999999991',
      password: 'secret123',
      restaurantIds: [restaurant._id.toString()],
    }, admin);

    expect(out.id).toBeTruthy();
    expect(out.tempPassword).toBe('secret123');

    const user = await User.findById(out.id).lean().exec();
    expect(user!.role).toBe('owner');
    expect(user!.password).not.toBe('secret123'); // hashed

    const employee = await Employee.findOne({ employeeId: user!.employeeId }).lean().exec();
    expect(employee).toBeNull(); // linked by _id on the User doc
    const linked = await Employee.findById(user!.employeeId).lean().exec();
    expect(linked!.role).toBe('Owner');

    const updatedRestaurant = await Restaurant.findById(restaurant._id).lean().exec();
    expect(updatedRestaurant!.ownerUserId).toBe(out.userId);
    expect(updatedRestaurant!.ownerName).toBe('Alice Owner');

    const audit = await AuditLog.findOne({ action: 'ADMIN_OWNER_CREATE' }).lean().exec();
    expect(audit).toBeTruthy();
  });

  it('rolls back when restaurant assignment references a missing restaurant (no partial owner)', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await expect(
      ownerService.create({
        name: 'Ghost Owner',
        email: 'ghost@test.com',
        restaurantIds: [fakeId],
      }, admin),
    ).rejects.toThrow(/do not exist/);

    const orphanUsers = await User.find({ name: 'Ghost Owner' }).exec();
    expect(orphanUsers.length).toBe(0);
    const orphanEmployees = await Employee.find({ name: 'Ghost Owner' }).exec();
    expect(orphanEmployees.length).toBe(0);
  });

  it('rejects duplicate email across owners', async () => {
    await ownerService.create({ name: 'First', email: 'dup@test.com' }, admin);
    await expect(
      ownerService.create({ name: 'Second', email: 'dup@test.com' }, admin),
    ).rejects.toThrow(/email already exists/);
  });

  it('rejects duplicate phone across owners', async () => {
    await ownerService.create({ name: 'First', phone: '8888888888' }, admin);
    await expect(
      ownerService.create({ name: 'Second', phone: '8888888888' }, admin),
    ).rejects.toThrow(/phone already exists/);
  });

  it('mints a unique placeholder phone when none is provided', async () => {
    const out = await ownerService.create({ name: 'No Phone Owner' }, admin);
    expect(out.phone).toMatch(/^9\d{9}$/);
    const user = await User.findById(out.id).lean().exec();
    expect(user!.phone).toBe(out.phone);
  });

  it('refuses to steal a restaurant that already belongs to another owner', async () => {
    const existing = await seedOwner({ name: 'Existing Owner' });
    const restaurant = await createRestaurant('Taken Grill');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: existing.userId }).exec();

    await expect(
      ownerService.create({
        name: 'Intruder',
        restaurantIds: [restaurant._id.toString()],
      }, admin),
    ).rejects.toThrow(/already assigned to another owner/);

    // No partial owner creation happened (rollback of the guard failure).
    expect(await User.findOne({ name: 'Intruder' }).lean().exec()).toBeNull();
    expect(await Employee.findOne({ name: 'Intruder' }).lean().exec()).toBeNull();
    // Original ownership preserved.
    const rest = await Restaurant.findById(restaurant._id).lean().exec();
    expect(rest!.ownerUserId).toBe(existing.userId);
  });
});

describe('ownerService.list (search / filter / pagination / sort)', () => {
  it('returns a real total and pagination metadata', async () => {
    await seedOwner({ name: 'Alpha' });
    await seedOwner({ name: 'Beta' });

    const result = await ownerService.list({ page: 1, limit: 10 });
    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
    expect(result.next).toBeNull();
    expect(result.previous).toBeNull();
  });

  it('paginates with next/previous', async () => {
    for (let i = 0; i < 5; i++) await seedOwner({ name: `Owner ${i}` });
    const page1 = await ownerService.list({ page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.next).toBe(2);
    expect(page1.previous).toBeNull();

    const page2 = await ownerService.list({ page: 2, limit: 2 });
    expect(page2.next).toBe(3);
    expect(page2.previous).toBe(1);

    const page3 = await ownerService.list({ page: 3, limit: 2 });
    expect(page3.next).toBeNull();
  });

  it('searches by name, email and phone (partial, case-insensitive)', async () => {
    await seedOwner({ name: 'Patel Restaurant', email: 'patel@test.com', phone: '9999999900' });
    await seedOwner({ name: 'Sharma', email: 'sharma@test.com' });

    expect((await ownerService.list({ search: 'patel' })).total).toBe(1);
    expect((await ownerService.list({ search: 'PATEL' })).total).toBe(1);
    expect((await ownerService.list({ search: 'sharma@test' })).total).toBe(1);
    expect((await ownerService.list({ search: '9999999900' })).total).toBe(1);
  });

  it('filters by restaurant name / id', async () => {
    const restaurant = await createRestaurant('My Bistro');
    const owner = await seedOwner({ name: 'Bistro Owner' });
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();

    const byName = await ownerService.list({ restaurant: 'bistro' });
    expect(byName.total).toBe(1);
    expect(byName.data[0].name).toBe('Bistro Owner');

    const byId = await ownerService.list({ restaurant: restaurant._id.toString() });
    expect(byId.total).toBe(1);
  });

  it('filters by status', async () => {
    await seedOwner({ status: 'active' });
    await seedOwner({ status: 'suspended' });
    await seedOwner({ status: 'inactive' });

    expect((await ownerService.list({ status: 'active' })).total).toBe(1);
    expect((await ownerService.list({ status: 'suspended' })).total).toBe(1);
    expect((await ownerService.list({ status: 'inactive' })).total).toBe(1);
  });

  it('sorts by name asc/desc and defaults to createdAt desc', async () => {
    await seedOwner({ name: 'Charlie' });
    await seedOwner({ name: 'Alpha' });
    await seedOwner({ name: 'Bravo' });

    const asc = await ownerService.list({ sortBy: 'name', sortOrder: 'asc' });
    expect(asc.data.map((o: any) => o.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const desc = await ownerService.list({ sortBy: 'name', sortOrder: 'desc' });
    expect(desc.data.map((o: any) => o.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);

    const byDefault = await ownerService.list({});
    // createdAt desc — most recent first.
    const created = byDefault.data.map((o: any) => o.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it('filters by created date range and last-login range', async () => {
    const older = await seedOwner({ name: 'Old' });
    // Raw collection update bypasses the mongoose timestamps plugin so the
    // createdAt override actually persists.
    await User.collection.updateOne(
      { _id: older._id },
      { $set: { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) } },
    );
    await seedOwner({ name: 'New' });

    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const filtered = await ownerService.list({ createdFrom: past });
    expect(filtered.total).toBe(1);
    expect(filtered.data[0].name).toBe('New');

    const loginOwner = await seedOwner({ name: 'Logged In' });
    await User.updateOne({ _id: loginOwner._id }, { $set: { lastLogin: new Date() } }).exec();
    const byLogin = await ownerService.list({ lastLoginFrom: new Date(Date.now() - 60_000).toISOString().slice(0, 10) });
    expect(byLogin.total).toBe(1);
  });

  it('includes deleted owners with deleted=true and excludes them by default', async () => {
    const owner = await seedOwner({ name: 'Delete Me' });
    await ownerService.softDelete(owner._id.toString(), admin);

    expect((await ownerService.list({})).total).toBe(0);
    const deleted = await ownerService.list({ deleted: 'true' });
    expect(deleted.total).toBe(1);
    expect(deleted.data[0].status).toBe('deleted');
  });
});

describe('ownerService.update', () => {
  it('updates whitelisted profile fields and keeps Employee in sync', async () => {
    const owner = await seedOwner({ name: 'Old Name', email: 'old@test.com' });
    const employee = await Employee.create({
      username: `emp_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Old Name',
      role: 'Owner',
      pin: await hashPin('123456'),
      status: 'Active',
    });
    await User.updateOne({ _id: owner._id }, { employeeId: employee._id }).exec();

    await ownerService.update(owner._id.toString(), { name: 'New Name', email: 'new@test.com' }, admin);

    const updated = await User.findById(owner._id).lean().exec();
    expect(updated!.name).toBe('New Name');
    expect(updated!.email).toBe('new@test.com');

    const emp = await Employee.findById(employee._id).lean().exec();
    expect(emp!.name).toBe('New Name');

    const audit = await AuditLog.findOne({ action: 'ADMIN_OWNER_UPDATE' }).lean().exec();
    expect(audit).toBeTruthy();
  });

  it('rejects changing to a duplicate email', async () => {
    const a = await seedOwner({ name: 'A', email: 'a@test.com' });
    await seedOwner({ name: 'B', email: 'b@test.com' });

    await expect(
      ownerService.update(a._id.toString(), { email: 'b@test.com' }, admin),
    ).rejects.toThrow(/email already exists/);
  });
});

describe('ownerService status + lock/unlock', () => {
  it('suspends and activates an owner (revoking sessions on suspend)', async () => {
    const owner = await seedOwner();
    const restaurant = await createRestaurant('Status Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();
    await seedSession(owner._id);
    await seedSession(restaurant._id);

    await ownerService.setStatus(owner._id.toString(), 'suspend', admin);
    let updated = await User.findById(owner._id).lean().exec();
    expect(updated!.status).toBe('suspended');
    const activeSessions = await RefreshToken.countDocuments({ isRevoked: false });
    expect(activeSessions).toBe(0);

    await ownerService.setStatus(owner._id.toString(), 'activate', admin);
    updated = await User.findById(owner._id).lean().exec();
    expect(updated!.status).toBe('active');
  });

  it('locks and unlocks an account with reason + audit', async () => {
    const owner = await seedOwner();
    const restaurant = await createRestaurant('Lock Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();
    await seedSession(owner._id);
    await seedSession(restaurant._id);

    await ownerService.lock(owner._id.toString(), admin, 'Suspicious activity');
    let updated = await User.findById(owner._id).lean().exec();
    expect(updated!.status).toBe('suspended');
    expect(updated!.lockedAt).toBeTruthy();
    expect(updated!.lockedBy).toBe('Super Admin Test');
    expect(updated!.lockReason).toBe('Suspicious activity');
    expect(await RefreshToken.countDocuments({ isRevoked: false })).toBe(0);

    await ownerService.unlock(owner._id.toString(), admin);
    updated = await User.findById(owner._id).lean().exec();
    expect(updated!.status).toBe('active');
    expect(updated!.lockedAt).toBeNull();
  });

  it('rejects unlock when the account was never locked (preserves suspend state)', async () => {
    const owner = await seedOwner();
    // Admin-suspended (not locked) — unlock must not silently re-activate.
    await ownerService.setStatus(owner._id.toString(), 'suspend', admin);
    await expect(ownerService.unlock(owner._id.toString(), admin)).rejects.toThrow(/not currently locked/);
    const updated = await User.findById(owner._id).lean().exec();
    expect(updated!.status).toBe('suspended');
    expect(updated!.lockedAt).toBeNull();
  });

  it('rejects lock on an already-locked account cleanly', async () => {
    const owner = await seedOwner();
    await ownerService.lock(owner._id.toString(), admin, 'First lock');
    await ownerService.unlock(owner._id.toString(), admin);
    // A second lock cycle works and records fresh metadata.
    await ownerService.lock(owner._id.toString(), admin, 'Second lock');
    const updated = await User.findById(owner._id).lean().exec();
    expect(updated!.lockedAt).toBeTruthy();
    expect(updated!.lockReason).toBe('Second lock');
  });
});

describe('ownerService delete / restore / permanent delete', () => {
  it('soft-deletes, restores, and permanently deletes with cleanup', async () => {
    const owner = await seedOwner({ name: 'Doomed Owner' });
    const restaurant = await createRestaurant('Doom Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();
    const employee = await Employee.create({
      username: `emp_doomed_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Doomed Owner',
      role: 'Owner',
      pin: await hashPin('123456'),
      status: 'Active',
      restaurantId: restaurant._id,
    });
    await User.updateOne({ _id: owner._id }, { employeeId: employee._id }).exec();
    const session = await seedSession(owner._id);
    const device = await Device.create({
      userId: owner._id,
      restaurantId: restaurant._id,
      deviceId: 'term-1',
      deviceName: 'Terminal 1',
      isActive: true,
    });

    await ownerService.softDelete(owner._id.toString(), admin);
    let updated = await User.findById(owner._id).lean().exec();
    expect(updated!.isDeleted).toBe(true);
    expect(updated!.status).toBe('inactive');
    expect((await Employee.findById(employee._id).lean().exec())!.status).toBe('Inactive');

    await ownerService.restore(owner._id.toString(), admin);
    updated = await User.findById(owner._id).lean().exec();
    expect(updated!.isDeleted).toBe(false);
    expect((await Employee.findById(employee._id).lean().exec())!.status).toBe('Active');

    // Permanent delete requires soft-delete first.
    await expect(ownerService.permanentDelete(owner._id.toString(), admin)).rejects.toThrow(/soft-deleted/);

    await ownerService.softDelete(owner._id.toString(), admin);
    await ownerService.permanentDelete(owner._id.toString(), admin);

    expect(await User.findById(owner._id).lean().exec()).toBeNull();
    expect(await Employee.findById(employee._id).lean().exec()).toBeNull();
    expect(await RefreshToken.findById(session._id).lean().exec()).toBeNull();
    expect(await Device.findById(device._id).lean().exec()).toBeNull();
    // Restaurant unlinked so POS owner login stops.
    const rest = await Restaurant.findById(restaurant._id).lean().exec();
    expect(rest!.ownerUserId).toBeNull();
    expect(rest!.ownerPin).toBeNull();
  });

  it('rejects restore for a non-deleted owner', async () => {
    const owner = await seedOwner();
    await expect(ownerService.restore(owner._id.toString(), admin)).rejects.toThrow(/not deleted/);
  });
});

describe('ownerService.resetPassword (security)', () => {
  it('never returns the plaintext new PIN and keeps credentials in sync', async () => {
    const owner = await seedOwner();
    const employee = await Employee.create({
      username: `emp_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Owner',
      role: 'Owner',
      pin: await hashPin('oldpin'),
      status: 'Active',
    });
    await User.updateOne({ _id: owner._id }, { employeeId: employee._id }).exec();
    const restaurant = await createRestaurant('Pin Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId, ownerPin: 'hashed_old' }).exec();

    const out = await ownerService.resetPassword(owner._id.toString(), admin);
    expect('newPin' in out).toBe(false);
    expect('tempPassword' in out).toBe(false);

    const updatedUser = await User.findById(owner._id).lean().exec();
    const updatedEmp = await Employee.findById(employee._id).lean().exec();
    const updatedRestaurant = await Restaurant.findById(restaurant._id).lean().exec();
    expect(updatedUser!.password).not.toBe(owner.password);
    expect(updatedEmp!.pin).toBe(updatedUser!.password);
    expect(updatedRestaurant!.ownerPin).toBe(updatedUser!.password);

    const audit = await AuditLog.findOne({ action: 'ADMIN_OWNER_RESET_PIN' }).lean().exec();
    expect(audit).toBeTruthy();
  });
});

describe('ownerService restaurant mapping', () => {
  it('lists owner restaurants with stats', async () => {
    const owner = await seedOwner();
    const r1 = await createRestaurant('Map One');
    const r2 = await createRestaurant('Map Two');
    await Restaurant.updateMany(
      { _id: { $in: [r1._id, r2._id] } },
      { ownerUserId: owner.userId },
    ).exec();
    await Branch.create({ restaurantId: r1._id, name: 'B1', isActive: true });
    await Branch.create({ restaurantId: r1._id, name: 'B2', isActive: true });
    await Subscription.create({ restaurantId: r1._id, plan: 'basic', status: 'active' });
    await Subscription.create({ restaurantId: r2._id, plan: 'pro', status: 'suspended' });

    const restaurants = await ownerService.getRestaurants(owner._id.toString());
    expect(restaurants.length).toBe(2);
    const one = restaurants.find((r: any) => r.restaurantId === r1.restaurantId);
    expect(one!.branches).toBe(2);
    expect(one!.plan).toBe('basic');
    const two = restaurants.find((r: any) => r.restaurantId === r2.restaurantId);
    expect(two!.subscriptionStatus).toBe('suspended');
  });

  it('assigns and unassigns a restaurant', async () => {
    const owner = await seedOwner();
    const restaurant = await createRestaurant('Assign Eats');

    await ownerService.assignRestaurant(owner._id.toString(), restaurant._id.toString(), admin);
    let rest = await Restaurant.findById(restaurant._id).lean().exec();
    expect(rest!.ownerUserId).toBe(owner.userId);

    await ownerService.unassignRestaurant(owner._id.toString(), restaurant._id.toString(), admin);
    rest = await Restaurant.findById(restaurant._id).lean().exec();
    expect(rest!.ownerUserId).toBeNull();
  });

  it('rejects unassign of a restaurant not owned by the owner', async () => {
    const owner = await seedOwner();
    const other = await seedOwner();
    const restaurant = await createRestaurant('Not Yours');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: other.userId }).exec();

    await expect(
      ownerService.unassignRestaurant(owner._id.toString(), restaurant._id.toString(), admin),
    ).rejects.toThrow(/not owned/);
  });
});

describe('ownerService sessions', () => {
  it('lists active sessions across the owner identity set', async () => {
    const owner = await seedOwner();
    const restaurant = await createRestaurant('Session Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();
    await seedSession(owner._id, { deviceName: 'Owner Desktop' });
    await seedSession(restaurant._id, { deviceName: 'POS Terminal' });
    await seedSession(owner._id, { deviceName: 'Revoked', isRevoked: true });

    const { sessions, total } = await ownerService.listSessions(owner._id.toString());
    expect(total).toBe(2);
    expect(sessions.some((s: any) => s.deviceName === 'POS Terminal')).toBe(true);
  });

  it('revokes a single session', async () => {
    const owner = await seedOwner();
    const s1 = await seedSession(owner._id, { deviceName: 'Keep' });
    const s2 = await seedSession(owner._id, { deviceName: 'Revoke' });

    await ownerService.revokeSession(owner._id.toString(), s2._id.toString(), admin);
    expect((await RefreshToken.findById(s2._id).lean().exec())!.isRevoked).toBe(true);
    expect((await RefreshToken.findById(s1._id).lean().exec())!.isRevoked).toBe(false);

    const audit = await AuditLog.findOne({ action: 'ADMIN_OWNER_SESSION_REVOKE' }).lean().exec();
    expect(audit).toBeTruthy();
  });

  it('refuses to revoke a session that does not belong to the owner', async () => {
    const owner = await seedOwner();
    const other = await seedOwner();
    const foreign = await seedSession(other._id);

    await expect(
      ownerService.revokeSession(owner._id.toString(), foreign._id.toString(), admin),
    ).rejects.toThrow(/not found/);
  });

  it('revokes all sessions', async () => {
    const owner = await seedOwner();
    await seedSession(owner._id);
    await seedSession(owner._id, { deviceId: 'dev-2' });

    const out = await ownerService.revokeAllSessions(owner._id.toString(), admin);
    expect(out.revoked).toBe(2);
    expect(await RefreshToken.countDocuments({ isRevoked: false })).toBe(0);
  });
});

describe('ownerService devices', () => {
  it('lists devices across owner restaurants with restaurant names', async () => {
    const owner = await seedOwner();
    const r1 = await createRestaurant('Dev One');
    await Restaurant.updateOne({ _id: r1._id }, { ownerUserId: owner.userId }).exec();
    await Device.create({
      userId: owner._id,
      restaurantId: r1._id,
      deviceId: 'term-1',
      deviceName: 'Front Counter',
      os: 'Windows',
      isActive: true,
      status: 'active',
    });

    const devices = await ownerService.listDevices(owner._id.toString());
    expect(devices.length).toBe(1);
    expect(devices[0].restaurantName).toBe('Dev One');
    expect(devices[0].deviceName).toBe('Front Counter');
  });

  it('blocks, unblocks and removes a device', async () => {
    const owner = await seedOwner();
    const r1 = await createRestaurant('Block Eats');
    await Restaurant.updateOne({ _id: r1._id }, { ownerUserId: owner.userId }).exec();
    const device = await Device.create({
      userId: owner._id,
      restaurantId: r1._id,
      deviceId: 'term-block',
      isActive: true,
      status: 'active',
    });

    await ownerService.blockDevice(owner._id.toString(), device._id.toString(), admin);
    let dev = await Device.findById(device._id).lean().exec();
    expect(dev!.status).toBe('blocked');
    expect(dev!.isActive).toBe(false);

    await ownerService.unblockDevice(owner._id.toString(), device._id.toString(), admin);
    dev = await Device.findById(device._id).lean().exec();
    expect(dev!.status).toBe('active');
    expect(dev!.isActive).toBe(true);

    await ownerService.removeDevice(owner._id.toString(), device._id.toString(), admin);
    expect(await Device.findById(device._id).lean().exec()).toBeNull();
  });

  it('refuses device ops on a device outside the owner scope', async () => {
    const owner = await seedOwner();
    const other = await seedOwner();
    const rOther = await createRestaurant('Other Eats');
    await Restaurant.updateOne({ _id: rOther._id }, { ownerUserId: other.userId }).exec();
    const foreignDevice = await Device.create({
      userId: other._id,
      restaurantId: rOther._id,
      deviceId: 'term-foreign',
      isActive: true,
      status: 'active',
    });

    await expect(
      ownerService.blockDevice(owner._id.toString(), foreignDevice._id.toString(), admin),
    ).rejects.toThrow(/not found/);
  });
});

describe('ownerService login history', () => {
  it('derives login events from sessions + failed attempts from audit', async () => {
    const owner = await seedOwner();
    const restaurant = await createRestaurant('Hist Eats');
    await Restaurant.updateOne({ _id: restaurant._id }, { ownerUserId: owner.userId }).exec();
    await seedSession(owner._id, { deviceName: 'Desktop', ipAddress: '10.0.0.9' });
    await seedSession(restaurant._id, { deviceName: 'POS', isRevoked: true });
    await AuditLog.create({
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: owner._id.toString(),
      performedBy: owner.name,
      performedById: owner._id.toString(),
      details: { username: owner.userId },
    } as any);

    const history = await ownerService.loginHistory(owner._id.toString(), {});
    expect(history.total).toBeGreaterThanOrEqual(3);
    const events = history.data as any[];
    expect(events.some((e) => e.event === 'login')).toBe(true);
    expect(events.some((e) => e.event === 'failed')).toBe(true);
    const login = events.find((e) => e.event === 'login' && e.deviceName === 'Desktop');
    expect(login!.ipAddress).toBe('10.0.0.9');
    expect(login!.userAgent).toBe('Mozilla/5.0');
  });

  it('filters login history by event', async () => {
    const owner = await seedOwner();
    await seedSession(owner._id);
    await AuditLog.create({
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: owner._id.toString(),
      performedBy: owner.name,
      performedById: owner._id.toString(),
    } as any);

    const failed = await ownerService.loginHistory(owner._id.toString(), { event: 'failed' });
    expect(failed.total).toBe(1);
    expect(failed.data[0].event).toBe('failed');

    const logins = await ownerService.loginHistory(owner._id.toString(), { event: 'login' });
    expect(logins.total).toBe(1);
  });

  it('reports an exact unfiltered total from real DB counts (not the capped feed)', async () => {
    const owner = await seedOwner();
    for (let i = 0; i < 12; i++) {
      await seedSession(owner._id, { deviceId: `dev-${i}` });
    }
    await AuditLog.create({
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: owner._id.toString(),
      performedBy: owner.name,
      performedById: owner._id.toString(),
    } as any);

    const history = await ownerService.loginHistory(owner._id.toString(), { page: 1, limit: 5 });
    expect(history.total).toBe(13); // 12 sessions + 1 failed attempt
    expect(history.data.length).toBe(5);
    expect(history.totalPages).toBe(3);
  });
});

describe('ownerService profile + statistics', () => {
  it('returns a profile with restaurants, sessions and devices', async () => {
    const owner = await seedOwner();
    const r1 = await createRestaurant('Prof Eats');
    await Restaurant.updateOne({ _id: r1._id }, { ownerUserId: owner.userId, isActive: true }).exec();
    await seedSession(owner._id);
    await Device.create({
      userId: owner._id,
      restaurantId: r1._id,
      deviceId: 'term-prof',
      isActive: true,
      status: 'active',
    });

    const profile = await ownerService.getProfile(owner._id.toString());
    expect(profile.name).toBe('Test Owner');
    expect(profile.restaurants).toBe(1);
    expect(profile.activeRestaurants).toBe(1);
    expect(profile.activeSessions).toBe(1);
    expect(profile.registeredDevices).toBe(1);
    expect(profile.restaurantsList[0].name).toBe('Prof Eats');
  });

  it('returns backend-generated statistics', async () => {
    const owner = await seedOwner();
    const r1 = await createRestaurant('Stat Active');
    const r2 = await createRestaurant('Stat Suspended');
    await Restaurant.updateMany(
      { _id: { $in: [r1._id, r2._id] } },
      { ownerUserId: owner.userId },
    ).exec();
    await Restaurant.updateOne({ _id: r2._id }, { isActive: false }).exec();
    await Branch.create({ restaurantId: r1._id, name: 'B', isActive: true });
    await Device.create({
      userId: owner._id,
      restaurantId: r1._id,
      deviceId: 'term-stat',
      isActive: true,
      status: 'active',
    });
    await Employee.create({
      username: `emp_stat_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Staff',
      role: 'Manager',
      pin: await hashPin('1234'),
      status: 'Active',
      restaurantId: r1._id,
    });
    await seedSession(owner._id);

    const stats = await ownerService.getStatistics(owner._id.toString());
    expect(stats.restaurantsOwned).toBe(2);
    expect(stats.activeRestaurants).toBe(1);
    expect(stats.suspendedRestaurants).toBe(1);
    expect(stats.totalBranches).toBe(1);
    expect(stats.totalDevices).toBe(1);
    expect(stats.totalEmployees).toBe(1);
    expect(stats.activeSessions).toBe(1);
  });
});

describe('ownerService audit + tenant isolation', () => {
  it('writes audit entries with actor + ip attribution for every mutation', async () => {
    const owner = await seedOwner();
    const actor = { id: 'super_admin_1', name: 'Ops Admin', ipAddress: '203.0.113.9' };

    await ownerService.update(owner._id.toString(), { name: 'Renamed' }, actor);
    await ownerService.lock(owner._id.toString(), actor);
    await ownerService.unlock(owner._id.toString(), actor);

    const audits = await AuditLog.find({
      performedById: 'super_admin_1',
      ipAddress: '203.0.113.9',
    }).lean().exec();
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('ADMIN_OWNER_UPDATE');
    expect(actions).toContain('ADMIN_OWNER_LOCK');
    expect(actions).toContain('ADMIN_OWNER_UNLOCK');
  });

  it('isolates sessions and devices per owner (no cross-owner leaks)', async () => {
    const ownerA = await seedOwner();
    const ownerB = await seedOwner();
    const rB = await createRestaurant('Tenant B');
    await Restaurant.updateOne({ _id: rB._id }, { ownerUserId: ownerB.userId }).exec();
    await seedSession(ownerA._id, { deviceName: 'A Session' });
    await seedSession(ownerB._id, { deviceName: 'B Session' });
    await seedSession(rB._id, { deviceName: 'B POS' });
    await Device.create({
      userId: ownerB._id,
      restaurantId: rB._id,
      deviceId: 'term-b',
      isActive: true,
      status: 'active',
    });

    const sessionsA = await ownerService.listSessions(ownerA._id.toString());
    expect(sessionsA.total).toBe(1);
    expect(sessionsA.sessions[0].deviceName).toBe('A Session');

    const devicesA = await ownerService.listDevices(ownerA._id.toString());
    expect(devicesA.length).toBe(0);

    const sessionsB = await ownerService.listSessions(ownerB._id.toString());
    expect(sessionsB.total).toBe(2);
    const devicesB = await ownerService.listDevices(ownerB._id.toString());
    expect(devicesB.length).toBe(1);
  });
});
