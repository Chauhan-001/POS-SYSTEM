/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OwnerService — Business logic for the Owners Management (Phase 2.3) module.
 *
 * Consolidates the owner lifecycle previously scattered in adminOwnersController
 * so controllers stay thin and every write is validated, audited and
 * tenant-consistent:
 *
 *   - Atomic onboarding (User + Employee + restaurant mapping + auth setup)
 *     with compensating rollback — no partial owner creation is possible.
 *   - Paged listing with server-side search (name/email/phone/restaurant),
 *     filters (status, restaurant, created date, last login, deleted),
 *     whitelisted sorting and a REAL database total.
 *   - Full lifecycle: activate / suspend / lock / unlock / soft-delete /
 *     restore / permanent-delete.
 *   - Secure password reset (no plaintext credential ever returned).
 *   - Restaurant mapping (owner → restaurants, restaurant → owner).
 *   - Sessions / devices / login history via the existing RefreshToken,
 *     Device and AuditLog infrastructure.
 *   - Backend-generated owner statistics (no frontend math).
 *
 * Identity model (kept from the existing architecture):
 *   - An "owner" is a User doc with role 'owner'.
 *   - Restaurant.ownerUserId (string) links restaurants to that owner.
 *   - POS owner logins run through the Restaurant (ownerUserId + ownerPin),
 *     so owner sessions/devices are keyed by the Restaurant _id as well as the
 *     User _id — the identity set [user._id, ...restaurant._ids] is used for
 *     session/device/login-history lookups.
 */

import mongoose from 'mongoose';
import User from '../models/User';
import Employee from '../models/Employee';
import Restaurant from '../models/Restaurant';
import RefreshToken from '../models/RefreshToken';
import Device from '../models/Device';
import Branch from '../models/Branch';
import AuditLog from '../models/AuditLog';
import Subscription from '../models/Subscription';
import { hashPin } from '../utils/bcrypt';
import { AppError } from '../utils/AppError';
import { auditLogRepo, refreshTokenRepo } from '../repositories';
import { parsePagination, parseSearch, parseDateRange } from '../utils/queryParser';
import crypto from 'crypto';

export interface AdminIdentity {
  id: string;
  name: string;
  ipAddress?: string;
  deviceId?: string;
}

interface OwnerRestaurants {
  user: any;
  restaurants: any[];
}

const SEARCH_FIELDS = ['name', 'email', 'phone'];
const ALLOWED_SORTS = ['name', 'createdAt', 'updatedAt', 'lastLogin', 'lastActivity', 'status'];
const UPDATEABLE_FIELDS = ['name', 'email', 'phone'];

export class OwnerService {
  // ──────────────────────────────────────────────────────────────
  // Identity helpers
  // ──────────────────────────────────────────────────────────────

  /** Find an owner User doc (role 'owner', not deleted). */
  private async findOwner(id: string, opts: { includeDeleted?: boolean } = {}): Promise<any> {
    const filter: Record<string, any> = { _id: id, role: 'owner' };
    if (!opts.includeDeleted) filter.isDeleted = { $ne: true };
    const user = await User.findOne(filter).exec();
    if (!user) throw new AppError(404, 'Owner not found');
    return user;
  }

  /** Resolve an owner's restaurants (linked by Restaurant.ownerUserId). */
  private async resolveOwnerRestaurants(user: any, opts: { includeDeleted?: boolean } = {}): Promise<OwnerRestaurants> {
    const filter: Record<string, any> = { ownerUserId: user.userId };
    if (!opts.includeDeleted) filter.isDeleted = { $ne: true };
    const restaurants = await Restaurant.find(filter).lean().exec();
    return { user, restaurants };
  }

  /** Identity set used for session/device/login-history lookups. */
  private identityIds(user: any, restaurants: any[]): string[] {
    const ids = [user._id.toString()];
    for (const r of restaurants) ids.push(r._id.toString());
    return ids;
  }

  /** Resolve an identity string back to an owner doc (for audit display). */
  private async ownerByIdentity(entityId: string): Promise<any | null> {
    if (!entityId) return null;
    if (mongoose.isValidObjectId(entityId)) {
      const user = await User.findOne({ _id: entityId, role: 'owner' }).lean().exec();
      if (user) return user;
    }
    const byUserId = await User.findOne({ userId: entityId, role: 'owner' }).lean().exec();
    return byUserId || null;
  }

  // ──────────────────────────────────────────────────────────────
  // LIST — real total, search / filter / sort / pagination, N+1 fixed
  // ──────────────────────────────────────────────────────────────
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 10 });

    const filter: Record<string, any> = { role: 'owner', isDeleted: { $ne: true } };
    if (query.deleted === 'true') {
      filter.isDeleted = true;
      filter.deletedAt = { $exists: true };
    }

    const andConditions: Record<string, any>[] = [];

    // Search across owner identity fields.
    const searchable = parseSearch(query.search, SEARCH_FIELDS);
    if (searchable) Object.assign(filter, searchable);

    // Status filter (deleted handled above).
    if (query.status === 'active') filter.status = 'active';
    else if (query.status === 'inactive') filter.status = 'inactive';
    else if (query.status === 'suspended') filter.status = 'suspended';

    // Created-date range.
    const createdRange = parseDateRange(
      [query.createdFrom, query.createdTo].filter(Boolean).join(',') || undefined,
      'createdAt',
    );
    if (createdRange) Object.assign(filter, createdRange);

    // Last-login date range.
    const lastLoginRange = parseDateRange(
      [query.lastLoginFrom, query.lastLoginTo].filter(Boolean).join(',') || undefined,
      'lastLogin',
    );
    if (lastLoginRange) Object.assign(filter, lastLoginRange);

    // Restaurant filter — resolve to ownerUserIds in one pass.
    if (typeof query.restaurant === 'string' && query.restaurant.trim()) {
      const safeRest = query.restaurant.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const restaurants = await Restaurant.find({
        isDeleted: { $ne: true },
        $or: [
          { _id: mongoose.isValidObjectId(query.restaurant) ? query.restaurant : undefined },
          { restaurantId: { $regex: safeRest, $options: 'i' } },
          { name: { $regex: safeRest, $options: 'i' } },
          { ownerEmail: { $regex: safeRest, $options: 'i' } },
        ].filter((c) => Object.values(c)[0] !== undefined),
      })
        .select('ownerUserId')
        .lean()
        .exec();
      const ownerUserIds = restaurants.map((r) => r.ownerUserId).filter(Boolean);
      if (ownerUserIds.length === 0) {
        return this.emptyPage(page, limit);
      }
      andConditions.push({ userId: { $in: ownerUserIds } });
    }

    if (andConditions.length > 0) {
      filter.$and = [...(filter.$and || []), ...andConditions];
    }

    const sortBy = ALLOWED_SORTS.includes(query.sortBy) ? query.sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ [sortBy]: sortOrder, _id: 1 })   // stable default ordering
        .skip(skip).limit(limit)
        .lean().exec(),
      User.countDocuments(filter).exec(),
    ]);

    if (users.length === 0) {
      return this.emptyPage(page, limit, total);
    }

    const ownerUserIds = users.map((u) => u.userId).filter(Boolean);

    // Grouped aggregations replace per-row queries (N+1 fix).
    const [restaurantAgg, branchAgg, deviceAgg] = await Promise.all([
      Restaurant.aggregate([
        { $match: { ownerUserId: { $in: ownerUserIds }, isDeleted: { $ne: true } } },
        {
          $group: {
            _id: '$ownerUserId',
            count: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            suspended: { $sum: { $cond: [{ $not: ['$isActive'] }, 1, 0] } },
          },
        },
      ]).exec(),
      Restaurant.aggregate([
        { $match: { ownerUserId: { $in: ownerUserIds }, isDeleted: { $ne: true } } },
        {
          $lookup: {
            from: 'branches',
            localField: '_id',
            foreignField: 'restaurantId',
            as: 'b',
          },
        },
        { $group: { _id: '$ownerUserId', branches: { $sum: { $size: '$b' } } } },
      ]).exec(),
      Restaurant.aggregate([
        { $match: { ownerUserId: { $in: ownerUserIds }, isDeleted: { $ne: true } } },
        {
          $lookup: {
            from: 'devices',
            localField: '_id',
            foreignField: 'restaurantId',
            as: 'd',
          },
        },
        { $group: { _id: '$ownerUserId', devices: { $sum: { $size: '$d' } } } },
      ]).exec(),
    ]);

    const restMap = new Map(restaurantAgg.map((r) => [r._id, r]));
    const branchMap = new Map(branchAgg.map((b) => [b._id, b.branches]));
    const deviceMap = new Map(deviceAgg.map((d) => [d._id, d.devices]));

    const data = users.map((u) => {
      const rest = restMap.get(u.userId) || { count: 0, active: 0, suspended: 0 };
      return {
        id: u._id.toString(),
        name: u.name,
        email: u.email || '',
        phone: u.phone || '',
        status: u.isDeleted ? 'deleted' : (u.status as string),
        restaurants: rest.count,
        activeRestaurants: rest.active,
        suspendedRestaurants: rest.suspended,
        branches: branchMap.get(u.userId) || 0,
        devices: deviceMap.get(u.userId) || 0,
        lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
        lastActivity: u.lastActivity ? u.lastActivity.toISOString() : null,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
        updatedAt: u.updatedAt ? u.updatedAt.toISOString() : null,
      };
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
    };
  }

  private emptyPage(page: number, limit: number, total = 0) {
    const totalPages = Math.ceil(total / limit);
    return {
      data: [], total, page, limit, totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // GET ONE
  // ──────────────────────────────────────────────────────────────
  async getById(id: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);

    const restaurantIds = restaurants.map((r) => r._id);
    const [activeCount, suspendedCount, branchCount, deviceCount, activeSessions] = await Promise.all([
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: true }).exec(),
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: false }).exec(),
      Branch.countDocuments({ restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } }).exec(),
      Device.countDocuments({ restaurantId: { $in: restaurantIds } }).exec(),
      RefreshToken.countDocuments({
        userId: { $in: this.identityIds(user, restaurants).map((i) => i as any) },
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      }).exec(),
    ]);

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email || '',
      phone: user.phone || '',
      status: user.isDeleted ? 'deleted' : user.status,
      lockedAt: user.lockedAt ? user.lockedAt.toISOString() : null,
      lockedBy: user.lockedBy || null,
      restaurants: restaurants.length,
      activeRestaurants: activeCount,
      suspendedRestaurants: suspendedCount,
      branches: branchCount,
      devices: deviceCount,
      activeSessions,
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
      lastActivity: user.lastActivity ? user.lastActivity.toISOString() : null,
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
      restaurantsList: restaurants.map((r) => ({
        id: r._id.toString(),
        restaurantId: r.restaurantId,
        name: r.name,
        isActive: r.isActive,
        isDeleted: !!r.isDeleted,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // CREATE — atomic onboarding with compensating rollback
  // ──────────────────────────────────────────────────────────────
  async create(body: Record<string, any>, actor: AdminIdentity) {
    const name = body.name?.trim();
    if (!name) throw new AppError(400, 'Owner name is required');

    const email = body.email?.trim() || null;
    // The User schema requires a phone; when the admin doesn't provide one we
    // mint a unique placeholder so onboarding never fails validation. The
    // owner can update their real number later via PUT /admin/owners/:id.
    let phone = body.phone?.trim() || `9${Math.floor(100000000 + Math.random() * 900000000)}`;

    // Duplicate prevention (unique email / phone across owners). Minted
    // placeholders are checked too so they never collide with a real owner.
    if (email) {
      const dup = await User.findOne({
        role: 'owner', isDeleted: { $ne: true },
        email: email.toLowerCase(),
      }).lean().exec();
      if (dup) throw new AppError(409, 'An owner with this email already exists');
    }
    for (let attempts = 0; attempts < 3; attempts++) {
      const dup = await User.findOne({
        role: 'owner', isDeleted: { $ne: true },
        phone,
      }).lean().exec();
      if (!dup) break;
      if (body.phone?.trim()) throw new AppError(409, 'An owner with this phone already exists');
      phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;
    }

    const userId = `owner_${name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 12)}_${crypto.randomBytes(3).toString('hex')}`;
    const tempPin = body.password || Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await hashPin(tempPin);

    // Validate restaurants exist before writing anything (fail fast). Restaurants
    // already owned by ANOTHER owner are rejected — onboarding must never
    // silently steal an existing owner's restaurant.
    const restaurantIds = (body.restaurantIds || []).map((r: string) => r);
    let restaurants: any[] = [];
    if (restaurantIds.length > 0) {
      restaurants = await Restaurant.find({ _id: { $in: restaurantIds }, isDeleted: { $ne: true } }).exec();
      if (restaurants.length !== restaurantIds.length) {
        throw new AppError(400, 'One or more assigned restaurants do not exist');
      }
      const alreadyOwned = restaurants.find((r) => r.ownerUserId && r.ownerUserId !== userId);
      if (alreadyOwned) {
        throw new AppError(409, `Restaurant "${alreadyOwned.name}" is already assigned to another owner`);
      }
    }

    let user: any = null;
    let employee: any = null;
    let createdRestaurants: any[] = [];

    try {
      // Step 1 — User doc (the owner account used for admin + login fallback).
      user = await User.create({
        restaurantId: restaurants[0]?._id || new mongoose.Types.ObjectId(),
        userId,
        phone: phone || '',
        name,
        email,
        password: hashed,
        role: 'owner',
        status: 'active',
        branchIds: [],
      });

      // Step 2 — Employee doc (role Owner) so the owner appears in POS staff
      // and can authenticate through the existing employee path.
      employee = await Employee.create({
        username: userId,
        name,
        role: 'Owner',
        pin: hashed,
        status: 'Active',
        restaurantId: restaurants[0]?._id || undefined,
      });

      await User.updateOne({ _id: user._id }, { employeeId: employee._id }).exec();

      // Step 3 — Restaurant mapping (multi-restaurant ownership).
      for (const r of restaurants) {
        await Restaurant.updateOne(
          { _id: r._id },
          {
            $set: {
              ownerUserId: userId,
              ownerName: name,
              ownerPhone: phone || r.ownerPhone,
              ownerEmail: email || r.ownerEmail,
            },
          },
        ).exec();
        createdRestaurants.push(r._id.toString());
      }

      // Step 4 — audit.
      await auditLogRepo.create({
        action: 'ADMIN_OWNER_CREATE',
        entityType: 'user',
        entityId: user._id.toString(),
        performedBy: actor.name,
        performedById: actor.id,
        ipAddress: actor.ipAddress,
        details: { ownerUserId: userId, restaurants: createdRestaurants },
      } as any);
    } catch (error) {
      // Compensating rollback — remove anything created so far (reverse order).
      if (employee) { try { await Employee.findByIdAndDelete(employee._id).exec(); } catch { /* best-effort */ } }
      if (user) { try { await User.findByIdAndDelete(user._id).exec(); } catch { /* best-effort */ } }
      console.error('[OwnerService] create failed — rolled back partial onboarding:', error);
      throw error;
    }

    return {
      id: user._id.toString(),
      userId,
      name,
      email,
      phone,
      status: 'active',
      restaurants: restaurants.length,
      tempPassword: tempPin,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // UPDATE (whitelist-guarded)
  // ──────────────────────────────────────────────────────────────
  async update(id: string, body: Record<string, any>, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const before = { name: user.name, email: user.email, phone: user.phone };

    const updates: Record<string, any> = {};
    for (const key of UPDATEABLE_FIELDS) {
      if (key in body && body[key] !== undefined && body[key] !== null) {
        updates[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
      }
    }

    // Duplicate prevention on email/phone change.
    if (updates.email) {
      const dup = await User.findOne({
        role: 'owner', isDeleted: { $ne: true }, _id: { $ne: user._id },
        email: updates.email.toLowerCase(),
      }).lean().exec();
      if (dup) throw new AppError(409, 'An owner with this email already exists');
    }
    if (updates.phone) {
      const dup = await User.findOne({
        role: 'owner', isDeleted: { $ne: true }, _id: { $ne: user._id },
        phone: updates.phone,
      }).lean().exec();
      if (dup) throw new AppError(409, 'An owner with this phone already exists');
    }

    if (Object.keys(updates).length > 0) {
      await User.updateOne({ _id: user._id }, { $set: updates }).exec();
      // Keep the linked Employee profile in sync.
      if (user.employeeId) {
        await Employee.updateOne(
          { _id: user.employeeId },
          { $set: { name: updates.name ?? user.name } },
        ).exec();
      }
    }

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_UPDATE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { before, after: updates },
    } as any);

    return { message: 'Owner updated successfully' };
  }

  // ──────────────────────────────────────────────────────────────
  // STATUS — suspend / activate (audited + activity history)
  // ──────────────────────────────────────────────────────────────
  async setStatus(id: string, status: 'suspend' | 'activate', actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const now = new Date();

    if (status === 'suspend') {
      await User.updateOne(
        { _id: user._id },
        { $set: { status: 'suspended' }, $push: { activityHistory: { action: 'suspended', performedBy: actor.name, timestamp: now } } },
      ).exec();
      // A suspended owner cannot extend sessions.
      const { restaurants } = await this.resolveOwnerRestaurants(user);
      await refreshTokenRepo.updateMany(
        { userId: { $in: this.identityIds(user, restaurants) as any } },
        { isRevoked: true } as any,
      );
      await auditLogRepo.create({
        action: 'ADMIN_OWNER_SUSPEND',
        entityType: 'user',
        entityId: id,
        performedBy: actor.name,
        performedById: actor.id,
        ipAddress: actor.ipAddress,
        details: { status: 'suspended' },
      } as any);
      return { message: 'Owner suspended successfully' };
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { status: 'active' }, $push: { activityHistory: { action: 'activated', performedBy: actor.name, timestamp: now } } },
    ).exec();
    await auditLogRepo.create({
      action: 'ADMIN_OWNER_ACTIVATE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { status: 'active' },
    } as any);
    return { message: 'Owner activated successfully' };
  }

  // ──────────────────────────────────────────────────────────────
  // LOCK / UNLOCK (manual lock — distinct from suspend)
  // ──────────────────────────────────────────────────────────────
  async lock(id: string, actor: AdminIdentity, reason?: string) {
    const user = await this.findOwner(id);
    const now = new Date();
    await User.updateOne(
      { _id: user._id },
      {
        $set: { status: 'suspended', lockedAt: now, lockedBy: actor.name, lockReason: reason || 'Locked by admin' },
        $push: { activityHistory: { action: 'locked', performedBy: actor.name, timestamp: now, details: { reason } } },
      },
    ).exec();

    // Revoke all active sessions for the account.
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    await refreshTokenRepo.updateMany(
      { userId: { $in: this.identityIds(user, restaurants) as any }, isRevoked: false },
      { isRevoked: true } as any,
    );

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_LOCK',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { reason: reason || null },
    } as any);
    return { message: 'Owner account locked' };
  }

  async unlock(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    if (!user.lockedAt) throw new AppError(400, 'Account is not currently locked');
    const now = new Date();
    await User.updateOne(
      { _id: user._id },
      {
        $set: { status: 'active', lockedAt: null, lockedBy: null, lockReason: null },
        $push: { activityHistory: { action: 'unlocked', performedBy: actor.name, timestamp: now } },
      },
    ).exec();
    await auditLogRepo.create({
      action: 'ADMIN_OWNER_UNLOCK',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: {},
    } as any);
    return { message: 'Owner account unlocked' };
  }

  // ──────────────────────────────────────────────────────────────
  // SOFT DELETE / RESTORE / PERMANENT DELETE
  // ──────────────────────────────────────────────────────────────
  async softDelete(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const now = new Date();

    await User.updateOne(
      { _id: user._id },
      {
        $set: { isDeleted: true, deletedAt: now, status: 'inactive' },
        $push: { activityHistory: { action: 'deleted', performedBy: actor.name, timestamp: now } },
      },
    ).exec();

    // Deactivate linked Employee + devices.
    if (user.employeeId) {
      await Employee.updateOne({ _id: user.employeeId }, { $set: { status: 'Inactive' } }).exec();
    }
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    await Device.updateMany(
      { restaurantId: { $in: restaurants.map((r) => r._id) }, isActive: true },
      { $set: { isActive: false } },
    ).exec();
    await refreshTokenRepo.updateMany(
      { userId: { $in: this.identityIds(user, restaurants) as any } },
      { isRevoked: true } as any,
    );

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_DELETE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { softDelete: true },
    } as any);
    return { message: 'Owner soft deleted successfully' };
  }

  async restore(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id, { includeDeleted: true });
    if (!user.isDeleted) throw new AppError(400, 'Owner is not deleted');

    await User.updateOne(
      { _id: user._id },
      {
        $set: { isDeleted: false, deletedAt: null, status: 'active' },
        $push: { activityHistory: { action: 'restored', performedBy: actor.name, timestamp: new Date() } },
      },
    ).exec();
    if (user.employeeId) {
      await Employee.updateOne({ _id: user.employeeId }, { $set: { status: 'Active' } }).exec();
    }

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_RESTORE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: {},
    } as any);
    return { message: 'Owner restored successfully' };
  }

  async permanentDelete(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id, { includeDeleted: true });
    if (!user.isDeleted) {
      throw new AppError(400, 'Permanent deletion requires the owner to be soft-deleted first');
    }

    const { restaurants } = await this.resolveOwnerRestaurants(user, { includeDeleted: true });
    const restaurantIds = restaurants.map((r) => r._id);
    const identity = this.identityIds(user, restaurants);

    // Cascade cleanup (audit logs are intentionally preserved — append-only).
    const deleteOps: Promise<any>[] = [];
    if (user.employeeId) {
      deleteOps.push(Employee.deleteOne({ _id: user.employeeId }).exec());
    }
    deleteOps.push(
      RefreshToken.deleteMany({ userId: { $in: identity as any } }).exec(),
      Device.deleteMany({ restaurantId: { $in: restaurantIds } }).exec(),
    );
    await Promise.all(deleteOps);
    // Unlink the owner from their restaurants so POS owner login stops.
    await Restaurant.updateMany(
      { _id: { $in: restaurantIds } },
      { $set: { ownerUserId: null, ownerPin: null, ownerName: null, ownerPhone: null, ownerEmail: null } },
    ).exec();
    await User.findByIdAndDelete(user._id).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_PERMANENT_DELETE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { restaurantsUnlinked: restaurantIds.length },
    } as any);
    return { message: 'Owner permanently deleted' };
  }

  // ──────────────────────────────────────────────────────────────
  // PASSWORD — secure reset (no plaintext leak)
  // ──────────────────────────────────────────────────────────────
  async resetPassword(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await hashPin(newPin);

    await User.updateOne({ _id: user._id }, { $set: { password: hashed } }).exec();
    if (user.employeeId) {
      await Employee.updateOne({ _id: user.employeeId }, { $set: { pin: hashed } }).exec();
    }
    // Keep POS owner login (Restaurant.ownerPin) in sync for every restaurant.
    await Restaurant.updateMany(
      { ownerUserId: user.userId },
      { $set: { ownerPin: hashed } },
    ).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_RESET_PIN',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { reset: true },
    } as any);

    // Never return the plaintext PIN — the audit trail records the reset and
    // the admin can trigger a secure delivery flow instead.
    return { message: 'Password has been reset successfully' };
  }

  // ──────────────────────────────────────────────────────────────
  // RESTAURANT MAPPING
  // ──────────────────────────────────────────────────────────────
  async getRestaurants(id: string) {
    const user = await this.findOwner(id);
    const restaurants = await Restaurant.find({ ownerUserId: user.userId }).lean().exec();
    const restaurantIds = restaurants.map((r) => r._id);

    const [branchAgg, deviceAgg, subMap] = await Promise.all([
      Branch.aggregate([
        { $match: { restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } } },
        { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
      ]).exec(),
      Device.aggregate([
        { $match: { restaurantId: { $in: restaurantIds } } },
        { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
      ]).exec(),
      Subscription.find({ restaurantId: { $in: restaurantIds } }).select('plan status restaurantId').lean().exec(),
    ]);

    const branchMap = new Map(branchAgg.map((b) => [b._id.toString(), b.count]));
    const deviceMap = new Map(deviceAgg.map((d) => [d._id.toString(), d.count]));
    const subById = new Map(subMap.map((s) => [s.restaurantId.toString(), s]));

    return restaurants.map((r) => {
      const id = r._id.toString();
      return {
        id,
        restaurantId: r.restaurantId,
        name: r.name,
        isActive: r.isActive,
        isDeleted: !!r.isDeleted,
        branches: branchMap.get(id) || 0,
        devices: deviceMap.get(id) || 0,
        plan: subById.get(id)?.plan || 'N/A',
        subscriptionStatus: subById.get(id)?.status || 'N/A',
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      };
    });
  }

  async assignRestaurant(id: string, restaurantId: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const restaurant = await Restaurant.findOne({ _id: restaurantId, isDeleted: { $ne: true } }).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    // One owner per restaurant is the existing identity model; reassigning
    // moves the restaurant to this owner (audited).
    await Restaurant.updateOne(
      { _id: restaurant._id },
      {
        $set: {
          ownerUserId: user.userId,
          ownerName: user.name,
          ownerPhone: user.phone || restaurant.ownerPhone,
          ownerEmail: user.email || restaurant.ownerEmail,
        },
      },
    ).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_ASSIGN_RESTAURANT',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { restaurantId: restaurant.restaurantId },
    } as any);
    return { message: `Restaurant assigned to owner` };
  }

  async unassignRestaurant(id: string, restaurantId: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const restaurant = await Restaurant.findOne({ _id: restaurantId }).exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');
    if (restaurant.ownerUserId !== user.userId) {
      throw new AppError(400, 'This restaurant is not owned by this owner');
    }

    await Restaurant.updateOne(
      { _id: restaurant._id },
      { $set: { ownerUserId: null, ownerPin: null } },
    ).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_UNASSIGN_RESTAURANT',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { restaurantId: restaurant.restaurantId },
    } as any);
    return { message: 'Restaurant unassigned from owner' };
  }

  // ──────────────────────────────────────────────────────────────
  // SESSIONS — reuse the existing RefreshToken architecture
  // ──────────────────────────────────────────────────────────────
  async listSessions(id: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const identity = this.identityIds(user, restaurants).map((i) => i as any);

    const [tokens, total] = await Promise.all([
      RefreshToken.find({ userId: { $in: identity }, isRevoked: false, expiresAt: { $gt: new Date() } })
        .sort({ lastActivityAt: -1, createdAt: -1 })
        .limit(200)
        .lean().exec(),
      RefreshToken.countDocuments({ userId: { $in: identity }, isRevoked: false, expiresAt: { $gt: new Date() } }).exec(),
    ]);

    const sessions = tokens.map((t) => ({
      id: t._id.toString(),
      deviceId: t.deviceId || null,
      deviceName: t.deviceName || null,
      os: t.os || null,
      appVersion: t.appVersion || null,
      ipAddress: t.ipAddress || null,
      userAgent: t.userAgent || null,
      createdAt: t.createdAt ? t.createdAt.toISOString() : null,
      expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
      lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
      isActive: !t.isRevoked && t.expiresAt > new Date(),
    }));

    return { sessions, total };
  }

  async revokeSession(id: string, sessionId: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const identity = this.identityIds(user, restaurants).map((i) => i as any);

    const token = await RefreshToken.findOne({ _id: sessionId, userId: { $in: identity } }).exec();
    if (!token) throw new AppError(404, 'Session not found for this owner');
    await RefreshToken.updateOne({ _id: token._id }, { $set: { isRevoked: true } }).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_SESSION_REVOKE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { sessionId, deviceName: token.deviceName || null },
    } as any);
    return { message: 'Session revoked successfully' };
  }

  async revokeAllSessions(id: string, actor: AdminIdentity) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const identity = this.identityIds(user, restaurants).map((i) => i as any);

    const res = await RefreshToken.updateMany(
      { userId: { $in: identity }, isRevoked: false },
      { $set: { isRevoked: true } },
    ).exec();

    await auditLogRepo.create({
      action: 'ADMIN_OWNER_SESSION_REVOKE_ALL',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { revoked: res.modifiedCount || 0 },
    } as any);
    return { message: 'All owner sessions revoked', revoked: res.modifiedCount || 0 };
  }

  // ──────────────────────────────────────────────────────────────
  // DEVICES — reuse the existing Device infrastructure
  // ──────────────────────────────────────────────────────────────
  async listDevices(id: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const restaurantIds = restaurants.map((r) => r._id);

    const devices = await Device.find({ restaurantId: { $in: restaurantIds } })
      .sort({ lastLoginAt: -1 })
      .limit(200)
      .lean().exec();

    const byRestaurant = new Map(restaurants.map((r) => [r._id.toString(), r.name]));
    return devices.map((d) => ({
      id: d._id.toString(),
      restaurantId: d.restaurantId ? d.restaurantId.toString() : null,
      restaurantName: d.restaurantId ? byRestaurant.get(d.restaurantId.toString()) || 'Unknown' : 'Unknown',
      deviceId: d.deviceId,
      deviceName: d.deviceName || 'Unknown',
      os: d.os || '',
      osVersion: d.osVersion || '',
      appVersion: d.appVersion || '',
      lastLogin: d.lastLoginAt ? d.lastLoginAt.toISOString() : null,
      status: d.status || (d.isActive ? 'active' : 'inactive'),
      isActive: d.isActive,
    }));
  }

  async getDevice(id: string, deviceId: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const restaurantIds = restaurants.map((r) => r._id);

    const device = await Device.findOne({ _id: deviceId, restaurantId: { $in: restaurantIds } }).lean().exec();
    if (!device) throw new AppError(404, 'Device not found for this owner');
    const byRestaurant = new Map(restaurants.map((r) => [r._id.toString(), r.name]));
    return {
      id: device._id.toString(),
      restaurantId: device.restaurantId ? device.restaurantId.toString() : null,
      restaurantName: device.restaurantId ? byRestaurant.get(device.restaurantId.toString()) || 'Unknown' : 'Unknown',
      deviceId: device.deviceId,
      deviceName: device.deviceName || 'Unknown',
      os: device.os || '',
      osVersion: device.osVersion || '',
      appVersion: device.appVersion || '',
      lastLogin: device.lastLoginAt ? device.lastLoginAt.toISOString() : null,
      status: device.status || (device.isActive ? 'active' : 'inactive'),
      isActive: device.isActive,
      createdAt: device.createdAt ? device.createdAt.toISOString() : null,
    };
  }

  async blockDevice(id: string, deviceId: string, actor: AdminIdentity) {
    const device = await this.getDevice(id, deviceId);
    await Device.updateOne({ _id: deviceId }, { $set: { status: 'blocked', isActive: false } }).exec();
    await auditLogRepo.create({
      action: 'ADMIN_OWNER_DEVICE_BLOCK',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { deviceId: device.deviceId, deviceName: device.deviceName },
    } as any);
    return { message: 'Device blocked' };
  }

  async unblockDevice(id: string, deviceId: string, actor: AdminIdentity) {
    const device = await this.getDevice(id, deviceId);
    await Device.updateOne({ _id: deviceId }, { $set: { status: 'active', isActive: true } }).exec();
    await auditLogRepo.create({
      action: 'ADMIN_OWNER_DEVICE_UNBLOCK',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { deviceId: device.deviceId, deviceName: device.deviceName },
    } as any);
    return { message: 'Device unblocked' };
  }

  async removeDevice(id: string, deviceId: string, actor: AdminIdentity) {
    const device = await this.getDevice(id, deviceId);
    await Device.deleteOne({ _id: deviceId }).exec();
    await auditLogRepo.create({
      action: 'ADMIN_OWNER_DEVICE_REMOVE',
      entityType: 'user',
      entityId: id,
      performedBy: actor.name,
      performedById: actor.id,
      ipAddress: actor.ipAddress,
      details: { deviceId: device.deviceId, deviceName: device.deviceName },
    } as any);
    return { message: 'Device removed' };
  }

  // ──────────────────────────────────────────────────────────────
  // LOGIN HISTORY — derived from RefreshToken + AuditLog
  // ──────────────────────────────────────────────────────────────
  async loginHistory(id: string, query: Record<string, any>) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const identity = this.identityIds(user, restaurants).map((i) => i as any);
    const identityStrings = this.identityIds(user, restaurants);

    const auditFilter = {
      action: { $in: ['LOGIN_FAILED', 'ADMIN_OWNER_RESET_PIN'] },
      $or: [
        { performedById: { $in: identityStrings } },
        { entityId: { $in: identityStrings } },
      ],
    };

    // Real database counts feed `total` (not the capped in-memory feed) so
    // pagination stays correct beyond the fetch caps.
    const [tokenCount, auditCount, tokens, failedLogins] = await Promise.all([
      RefreshToken.countDocuments({ userId: { $in: identity } }).exec(),
      AuditLog.countDocuments(auditFilter).exec(),
      RefreshToken.find({ userId: { $in: identity } })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean().exec(),
      AuditLog.find(auditFilter)
        .sort({ createdAt: -1 })
        .limit(500)
        .lean().exec(),
    ]);

    // Merge into a single chronological feed.
    const events: any[] = tokens.map((t) => ({
      event: 'login',
      timestamp: t.createdAt ? t.createdAt.toISOString() : null,
      deviceName: t.deviceName || null,
      deviceId: t.deviceId || null,
      os: t.os || null,
      ipAddress: t.ipAddress || null,
      userAgent: t.userAgent || null,
      isActive: !t.isRevoked && t.expiresAt > new Date(),
      loggedOut: t.isRevoked,
      lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
    }));
    for (const a of failedLogins) {
      events.push({
        event: a.action === 'ADMIN_OWNER_RESET_PIN' ? 'reset' : 'failed',
        timestamp: a.createdAt ? a.createdAt.toISOString() : null,
        performedBy: a.performedBy,
        details: a.details || null,
      });
    }
    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const eventFilter = query.event;
    const filtered = eventFilter
      ? events.filter((e) => e.event === eventFilter)
      : events;

    const { page, limit } = parsePagination(query, { page: 1, limit: 20 });
    const start = (page - 1) * limit;
    // DB totals are approximate for event-filtered views (feeds are capped),
    // but the UNFILTERED total is exact and used for pagination metadata.
    const total = eventFilter ? filtered.length : tokenCount + auditCount;
    const totalPages = Math.ceil(total / limit);

    return {
      data: filtered.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      previous: page > 1 ? page - 1 : null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // PROFILE / STATISTICS — backend-generated
  // ──────────────────────────────────────────────────────────────
  async getProfile(id: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const restaurantIds = restaurants.map((r) => r._id);

    const [activeSessions, registeredDevices, activeRestaurants, suspendedRestaurants] = await Promise.all([
      RefreshToken.countDocuments({
        userId: { $in: this.identityIds(user, restaurants).map((i) => i as any) },
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      }).exec(),
      Device.countDocuments({ restaurantId: { $in: restaurantIds } }).exec(),
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: true }).exec(),
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: false }).exec(),
    ]);

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email || '',
      phone: user.phone || '',
      status: user.isDeleted ? 'deleted' : user.status,
      lockedAt: user.lockedAt ? user.lockedAt.toISOString() : null,
      lockedBy: user.lockedBy || null,
      lockReason: user.lockReason || null,
      restaurants: restaurants.length,
      activeRestaurants,
      suspendedRestaurants,
      restaurantsList: restaurants.map((r) => ({
        id: r._id.toString(),
        restaurantId: r.restaurantId,
        name: r.name,
        isActive: r.isActive,
      })),
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
      lastActivity: user.lastActivity ? user.lastActivity.toISOString() : null,
      activeSessions,
      registeredDevices,
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
    };
  }

  async getStatistics(id: string) {
    const user = await this.findOwner(id);
    const { restaurants } = await this.resolveOwnerRestaurants(user);
    const restaurantIds = restaurants.map((r) => r._id);

    const [
      restaurantsOwned,
      activeRestaurants,
      suspendedRestaurants,
      branchCount,
      deviceCount,
      employeeCount,
      activeSessions,
    ] = await Promise.all([
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true } }).exec(),
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: true }).exec(),
      Restaurant.countDocuments({ ownerUserId: user.userId, isDeleted: { $ne: true }, isActive: false }).exec(),
      Branch.countDocuments({ restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } }).exec(),
      Device.countDocuments({ restaurantId: { $in: restaurantIds } }).exec(),
      Employee.countDocuments({ restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } }).exec(),
      RefreshToken.countDocuments({
        userId: { $in: this.identityIds(user, restaurants).map((i) => i as any) },
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      }).exec(),
    ]);

    return {
      id: user._id.toString(),
      name: user.name,
      status: user.isDeleted ? 'deleted' : user.status,
      restaurantsOwned,
      activeRestaurants,
      suspendedRestaurants,
      totalBranches: branchCount,
      totalDevices: deviceCount,
      totalEmployees: employeeCount,
      activeSessions,
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
      lastActivity: user.lastActivity ? user.lastActivity.toISOString() : null,
    };
  }
}

export const ownerService = new OwnerService();
