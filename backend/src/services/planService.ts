/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlanService — Business logic for the Plans Management module (Phase 2.4).
 *
 * Consolidates the plan lifecycle so controllers stay thin and every write is
 * validated, versioned and audited:
 *
 *   - Full lifecycle: create / edit / clone / archive / restore / soft-delete /
 *     permanent-delete and status transitions (active / draft / archived /
 *     deprecated / hidden).
 *   - Configurable limits with 0 = unlimited (maxRestaurants, maxBranches,
 *     maxDevices, maxEmployees, maxProducts, maxCustomers, maxMonthlyOrders,
 *     maxStorageMB, maxAIRequests, maxVoiceRequests, maxImages, maxExports).
 *   - Centralized feature flags (see constants/planFeatures.ts) validated on
 *     write and integrated with the existing subscription snapshot.
 *   - Version history: every edit appends a snapshot (before image), tracks
 *     createdBy / updatedBy, and supports rollback.
 *   - Paged listing with server-side search, filters, whitelisted sorting and
 *     a REAL database total + per-plan restaurant counts (N+1-safe).
 *   - Backend-generated plan statistics (restaurant/subscription/usage counts
 *     and revenue) — no frontend math.
 *   - Assignment: assign / upgrade / downgrade / trial conversion with
 *     optional effective date (scheduled) or immediate activation, keeping the
 *     Subscription features/limits snapshot in sync so plan changes take
 *     effect immediately.
 *
 * The subscription module's changePlan() remains the POS-facing assignment
 * path; this service reuses the same snapshot semantics so admin and POS never
 * diverge.
 */

import mongoose from 'mongoose';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Subscription from '../models/Subscription';
import Restaurant from '../models/Restaurant';
import Device from '../models/Device';
import Branch from '../models/Branch';
import Payment from '../models/Payment';
import AIUsageLog from '../models/AIUsageLog';
import { auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { parsePagination, parseSearch, parseDateRange } from '../utils/queryParser';
import { DEFAULT_LIMITS, LIMIT_KEYS, FEATURE_KEYS, PLAN_STATUSES, type PlanLimitKey } from '../constants/planFeatures';
import { subscriptionService, SUBSCRIPTION_DURATION_DAYS, GRACE_PERIOD_DAYS } from '../modules/subscription/subscriptionService';
import { entitlementService } from './entitlementService';

export interface AdminIdentity {
  id: string;
  name: string;
  ipAddress?: string;
  deviceId?: string;
}

/** Legacy limit field names → new canonical keys. */
const LEGACY_LIMIT_ALIASES: Record<string, PlanLimitKey> = {
  storageLimitMB: 'maxStorageMB',
};

/** Statuses that make a plan NOT assignable. */
const INACTIVE_STATUSES = new Set(['draft', 'archived', 'deprecated', 'hidden']);

const SEARCH_FIELDS = ['name', 'description', 'planId'];
const ALLOWED_SORTS = ['name', 'price', 'createdAt', 'updatedAt', 'sortOrder', 'restaurantCount'];

/** Normalize a plan doc into the API contract. */
function toPlanRow(p: any): any {
  const limits: Record<string, number> = {};
  for (const key of LIMIT_KEYS) {
    limits[key] = typeof p.limits?.[key] === 'number' ? p.limits[key] : DEFAULT_LIMITS[key];
  }
  return {
    id: p._id.toString(),
    planId: p.planId,
    name: p.name,
    description: p.description || '',
    price: p.price,
    maxUsers: p.maxUsers,
    maxDevices: p.maxDevices,
    features: p.features || [],
    aiEnabled: !!p.aiEnabled,
    trialDays: p.trialDays,
    sortOrder: p.sortOrder,
    isActive: p.isActive,
    isDefault: p.isDefault,
    status: p.status,
    planType: p.planType,
    visibility: p.visibility,
    limits,
    version: p.version || 1,
    versionsCount: p.versions?.length || 0,
    createdBy: p.createdBy || null,
    updatedBy: p.updatedBy || null,
    createdAt: p.createdAt ? p.createdAt.toISOString() : null,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    isDeleted: !!p.isDeleted,
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
  };
}

/** Snapshot helper used for version history. */
function snapshot(plan: any, note: string, actor: AdminIdentity): any {
  return {
    version: plan.version,
    name: plan.name,
    description: plan.description || '',
    price: plan.price,
    maxUsers: plan.maxUsers,
    maxDevices: plan.maxDevices,
    features: plan.features || [],
    aiEnabled: !!plan.aiEnabled,
    trialDays: plan.trialDays,
    sortOrder: plan.sortOrder,
    isDefault: !!plan.isDefault,
    status: plan.status,
    planType: plan.planType,
    visibility: plan.visibility,
    limits: plan.limits || {},
    createdBy: actor.name,
    note: note || '',
    timestamp: new Date(),
  };
}

/** Resolve incoming limits (with legacy aliases) into a full merged limits map. */
function resolveLimits(body: Record<string, any>, existing: any): Record<PlanLimitKey, number> {
  const base: Record<string, number> = { ...DEFAULT_LIMITS };
  // Carry over existing values when updating a plan (merge, not replace).
  if (existing?.limits && typeof existing.limits === 'object') {
    for (const key of LIMIT_KEYS) {
      if (typeof existing.limits[key] === 'number') base[key] = existing.limits[key];
    }
  }
  const incoming = body.limits || body;
  for (const key of LIMIT_KEYS) {
    if (incoming[key] !== undefined && incoming[key] !== null) {
      base[key] = Number(incoming[key]);
    }
  }
  // Top-level shorthand limit fields (e.g. maxDevices on the plan) are merged
  // too, so creating/updating a plan never silently resets unmentioned limits.
  for (const key of LIMIT_KEYS) {
    if (body[key] !== undefined && body[key] !== null) {
      base[key] = Number(body[key]);
    }
  }
  if (incoming.storageLimitMB !== undefined && incoming.storageLimitMB !== null) {
    base.maxStorageMB = Number(incoming.storageLimitMB);
  }
  if (body.storageLimitMB !== undefined && body.storageLimitMB !== null) {
    base.maxStorageMB = Number(body.storageLimitMB);
  }
  return base as Record<PlanLimitKey, number>;
}

export class PlanService {
  // ──────────────────────────────────────────────────────────────
  // Identity + fetch helpers
  // ──────────────────────────────────────────────────────────────

  private async findPlan(id: string, opts: { includeDeleted?: boolean } = {}): Promise<any> {
    const filter: Record<string, any> = { _id: id };
    if (!opts.includeDeleted) filter.isDeleted = { $ne: true };
    const plan = await SubscriptionPlan.findOne(filter).exec();
    if (!plan) throw new AppError(404, 'Plan not found');
    return plan;
  }

  // ──────────────────────────────────────────────────────────────
  // LIST — search / filter / sort / pagination + restaurant counts
  // ──────────────────────────────────────────────────────────────
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20 });

    const filter: Record<string, any> = { isDeleted: { $ne: true } };
    if (query.deleted === 'true') {
      filter.isDeleted = true;
      filter.deletedAt = { $exists: true };
    }

    // Legacy `active` alias → status filter.
    if (query.active === 'true') filter.isActive = true;
    if (query.active === 'false') filter.isActive = false;

    const andConditions: Record<string, any>[] = [];

    const searchable = parseSearch(query.search, SEARCH_FIELDS);
    if (searchable) Object.assign(filter, searchable);

    if (query.status) filter.status = query.status;
    if (query.planType) filter.planType = query.planType;
    if (query.visibility) filter.visibility = query.visibility;

    // Type-boolean shorthands.
    if (query.trial === 'true') andConditions.push({ planType: 'trial' });
    if (query.paid === 'true') andConditions.push({ planType: 'paid' });
    if (query.enterprise === 'true') andConditions.push({ planType: 'enterprise' });
    if (query.archived === 'true') andConditions.push({ status: 'archived' });

    // Feature availability filter (any plan granting this feature).
    if (typeof query.feature === 'string' && query.feature.trim()) {
      andConditions.push({ features: { $in: [query.feature.trim()] } });
    }

    // Created / updated date ranges.
    const createdRange = parseDateRange(
      [query.createdFrom, query.createdTo].filter(Boolean).join(',') || undefined,
      'createdAt',
    );
    if (createdRange) Object.assign(filter, createdRange);
    const updatedRange = parseDateRange(
      [query.updatedFrom, query.updatedTo].filter(Boolean).join(',') || undefined,
      'updatedAt',
    );
    if (updatedRange) Object.assign(filter, updatedRange);

    if (andConditions.length > 0) {
      filter.$and = [...(filter.$and || []), ...andConditions];
    }

    const sortBy = ALLOWED_SORTS.includes(query.sortBy) ? query.sortBy : 'sortOrder';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    const [plans, total] = await Promise.all([
      SubscriptionPlan.find(filter)
        .sort({ [sortBy]: sortOrder, name: 1 })
        .skip(skip).limit(limit)
        .lean().exec(),
      SubscriptionPlan.countDocuments(filter).exec(),
    ]);

    // Per-plan restaurant counts in ONE grouped query (N+1 fix).
    const planIds = plans.map((p) => p.planId);
    const countAgg = planIds.length > 0
      ? await Subscription.aggregate([
          { $match: { plan: { $in: planIds }, status: { $ne: 'suspended' } } },
          { $group: { _id: '$plan', count: { $sum: 1 } } },
        ]).exec()
      : [];
    const countMap = new Map(countAgg.map((c) => [c._id, c.count]));

    let data = plans.map((p) => {
      const row = toPlanRow(p);
      row.restaurantCount = countMap.get(p.planId) || 0;
      return row;
    });

    // `restaurantCount` sorting requires post-sort (not a schema field).
    if (sortBy === 'restaurantCount') {
      data.sort((a, b) => (a.restaurantCount - b.restaurantCount) * sortOrder);
    }

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
    const plan = await this.findPlan(id, { includeDeleted: true });
    const row = toPlanRow(plan);
    row.restaurantCount = await Subscription.countDocuments({
      plan: plan.planId,
      status: { $ne: 'suspended' },
    }).exec();
    row.versions = (plan.versions || []).map((v: any) => ({
      version: v.version,
      name: v.name,
      price: v.price,
      status: v.status,
      createdBy: v.createdBy,
      note: v.note,
      timestamp: v.timestamp ? v.timestamp.toISOString() : null,
    }));
    return row;
  }

  // ──────────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────────
  async create(body: Record<string, any>, actor: AdminIdentity) {
    if (!body.planId?.trim()) throw new AppError(400, 'planId is required');
    if (!body.name?.trim()) throw new AppError(400, 'Plan name is required');

    const planId = body.planId.trim().toLowerCase();
    const existing = await SubscriptionPlan.findOne({ planId }).lean().exec();
    if (existing) throw new AppError(409, `A plan with planId "${planId}" already exists`);

    const features = this.sanitizeFeatures(body.features);

    const limits = resolveLimits(body, null);

    const status = body.status || (body.isActive === false ? 'draft' : 'active');
    if (!(PLAN_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(400, `Invalid plan status "${status}"`);
    }

    const plan = await SubscriptionPlan.create({
      planId,
      name: body.name.trim(),
      description: body.description || '',
      price: body.price ?? 0,
      maxUsers: body.maxUsers ?? 5,
      maxDevices: body.maxDevices ?? 6,
      features,
      aiEnabled: !!body.aiEnabled,
      trialDays: body.trialDays ?? 14,
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive !== false,
      isDefault: !!body.isDefault,
      status,
      planType: body.planType || (body.trialDays ? 'trial' : 'paid'),
      visibility: body.visibility || 'public',
      limits,
      version: 1,
      versions: [],
      createdBy: actor.name,
      updatedBy: actor.name,
    });

    // A plan can only be the default one at a time.
    if (plan.isDefault) {
      await SubscriptionPlan.updateMany(
        { _id: { $ne: plan._id } },
        { $set: { isDefault: false } },
      ).exec();
    }

    await this.audit('ADMIN_PLAN_CREATE', plan, actor, {}, toPlanRow(plan));

    return toPlanRow(plan);
  }

  // ──────────────────────────────────────────────────────────────
  // UPDATE — versioned (appends a before-image snapshot)
  // ──────────────────────────────────────────────────────────────
  async update(id: string, body: Record<string, any>, actor: AdminIdentity) {
    const plan = await this.findPlan(id);
    const before = toPlanRow(plan);

    const updates: Record<string, any> = {};
    const editable = [
      'name', 'description', 'price', 'maxUsers', 'maxDevices', 'aiEnabled',
      'trialDays', 'sortOrder', 'isActive', 'isDefault', 'status', 'planType',
      'visibility',
    ];
    for (const key of editable) {
      if (key in body && body[key] !== undefined) updates[key] = body[key];
    }
    if ('features' in body && body.features !== undefined) {
      updates.features = this.sanitizeFeatures(body.features);
    }
    if ('name' in updates && typeof updates.name === 'string') updates.name = updates.name.trim();
    if (updates.planType === undefined && updates.trialDays !== undefined) {
      updates.planType = updates.trialDays > 0 ? 'trial' : plan.planType;
    }
    if ('isActive' in updates && updates.isActive === false && !updates.status) {
      updates.status = 'draft';
    }
    if ('status' in updates && updates.status !== undefined && !('isActive' in updates)) {
      updates.isActive = updates.status === 'active';
    }
    if ('status' in updates && updates.status !== undefined && !(PLAN_STATUSES as readonly string[]).includes(updates.status)) {
      throw new AppError(400, `Invalid plan status "${updates.status}"`);
    }

    // Limits — merge explicitly-passed nested limits AND any top-level limit
    // shorthand fields so the subscription snapshot never drifts from the plan
    // document (partial updates merge; nothing is replaced unless intended).
    const hasLimitsUpdate =
      ('limits' in body && body.limits !== undefined && Object.keys(body.limits).length > 0) ||
      LIMIT_KEYS.some((key) => body[key] !== undefined && body[key] !== null);
    if (hasLimitsUpdate) {
      updates.limits = resolveLimits(body, plan);
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, 'No valid fields to update');
    }

    if (updates.isDefault) {
      await SubscriptionPlan.updateMany(
        { _id: { $ne: plan._id } },
        { $set: { isDefault: false } },
      ).exec();
    }

    // Version bump + before-image snapshot BEFORE applying the change.
    const nextVersion = (plan.version || 1) + 1;
    updates.version = nextVersion;
    updates.updatedBy = actor.name;

    const updated = await SubscriptionPlan.findByIdAndUpdate(
      id,
      { $set: updates, $push: { versions: snapshot(plan, body.note || 'Updated', actor) } },
      { new: true },
    ).exec();
    if (!updated) throw new AppError(404, 'Plan not found');

    await this.audit('ADMIN_PLAN_UPDATE', updated, actor, { before }, toPlanRow(updated));

    return toPlanRow(updated);
  }

  // ──────────────────────────────────────────────────────────────
  // CLONE
  // ──────────────────────────────────────────────────────────────
  async clone(id: string, body: Record<string, any>, actor: AdminIdentity) {
    const source = await this.findPlan(id);
    const newPlanId = body.planId.trim().toLowerCase();

    const existing = await SubscriptionPlan.findOne({ planId: newPlanId }).lean().exec();
    if (existing) throw new AppError(409, `A plan with planId "${newPlanId}" already exists`);

    const plan = await SubscriptionPlan.create({
      planId: newPlanId,
      name: body.name.trim(),
      description: source.description,
      price: source.price,
      maxUsers: source.maxUsers,
      maxDevices: source.maxDevices,
      features: source.features || [],
      aiEnabled: source.aiEnabled,
      trialDays: source.trialDays,
      sortOrder: source.sortOrder,
      isActive: false, // clones start as draft
      isDefault: false,
      status: 'draft',
      planType: source.planType,
      visibility: source.visibility,
      limits: resolveLimits({ limits: source.limits }, null),
      version: 1,
      versions: [],
      createdBy: actor.name,
      updatedBy: actor.name,
    });

    await this.audit('ADMIN_PLAN_CLONE', plan, actor, {
      sourcePlanId: source.planId,
      sourceId: id,
    }, toPlanRow(plan));

    return toPlanRow(plan);
  }

  // ──────────────────────────────────────────────────────────────
  // STATUS / ARCHIVE / RESTORE
  // ──────────────────────────────────────────────────────────────
  async setStatus(id: string, status: string, actor: AdminIdentity, note?: string) {
    if (!(PLAN_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(400, `Invalid plan status "${status}"`);
    }
    const plan = await this.findPlan(id);
    const before = toPlanRow(plan);

    const updates: Record<string, any> = {
      status,
      isActive: status === 'active',
      updatedBy: actor.name,
    };
    if (status === 'archived') updates.archivedAt = new Date();
    if (status !== 'archived') updates.archivedAt = null;
    if (status === 'hidden') updates.visibility = 'hidden';

    const nextVersion = (plan.version || 1) + 1;
    updates.version = nextVersion;

    const updated = await SubscriptionPlan.findByIdAndUpdate(
      id,
      { $set: updates, $push: { versions: snapshot(plan, note || `Status → ${status}`, actor) } },
      { new: true },
    ).exec();
    if (!updated) throw new AppError(404, 'Plan not found');

    await this.audit('ADMIN_PLAN_STATUS', updated, actor, { before }, toPlanRow(updated));
    return toPlanRow(updated);
  }

  async archive(id: string, actor: AdminIdentity) {
    return this.setStatus(id, 'archived', actor, 'Archived by admin');
  }

  async restore(id: string, actor: AdminIdentity) {
    const plan = await this.findPlan(id, { includeDeleted: true });
    const before = toPlanRow(plan);

    // Restoring clears every deletion/archival flag and reactivates the plan so
    // it is assignable again immediately.
    const updates: Record<string, any> = {
      isDeleted: false,
      deletedAt: null,
      archivedAt: null,
      status: 'active',
      isActive: true,
      updatedBy: actor.name,
    };

    const nextVersion = (plan.version || 1) + 1;
    updates.version = nextVersion;

    const updated = await SubscriptionPlan.findByIdAndUpdate(
      id,
      { $set: updates, $push: { versions: snapshot(plan, 'Restored', actor) } },
      { new: true },
    ).exec();
    if (!updated) throw new AppError(404, 'Plan not found');

    await this.audit('ADMIN_PLAN_RESTORE', updated, actor, { before }, toPlanRow(updated));
    return toPlanRow(updated);
  }

  // ──────────────────────────────────────────────────────────────
  // SOFT DELETE / PERMANENT DELETE
  // ──────────────────────────────────────────────────────────────
  async softDelete(id: string, actor: AdminIdentity) {
    const plan = await this.findPlan(id);
    const before = toPlanRow(plan);

    await SubscriptionPlan.updateOne(
      { _id: plan._id },
      { $set: { isDeleted: true, deletedAt: new Date(), status: 'archived', isActive: false, updatedBy: actor.name } },
    ).exec();

    await this.audit('ADMIN_PLAN_DELETE', plan, actor, { before }, { ...before, isDeleted: true });
    return { message: 'Plan soft deleted successfully' };
  }

  async permanentDelete(id: string, actor: AdminIdentity) {
    const plan = await this.findPlan(id, { includeDeleted: true });
    if (!plan.isDeleted) {
      throw new AppError(400, 'Permanent deletion requires the plan to be soft-deleted first');
    }

    // Guard: never destroy a plan that is still referenced by subscriptions.
    const inUse = await Subscription.countDocuments({ plan: plan.planId }).exec();
    if (inUse > 0) {
      throw new AppError(409, `Cannot permanently delete — ${inUse} subscription(s) still reference this plan`);
    }

    await SubscriptionPlan.findByIdAndDelete(plan._id).exec();

    await this.audit('ADMIN_PLAN_PERMANENT_DELETE', plan, actor, { planId: plan.planId }, null);
    return { message: 'Plan permanently deleted' };
  }

  // ──────────────────────────────────────────────────────────────
  // VERSION HISTORY / ROLLBACK
  // ──────────────────────────────────────────────────────────────
  async listVersions(id: string) {
    const plan = await this.findPlan(id, { includeDeleted: true });
    return (plan.versions || []).map((v: any) => ({
      version: v.version,
      name: v.name,
      price: v.price,
      status: v.status,
      planType: v.planType,
      features: v.features || [],
      limits: v.limits || {},
      createdBy: v.createdBy,
      note: v.note,
      timestamp: v.timestamp ? v.timestamp.toISOString() : null,
    })).reverse(); // newest first
  }

  async rollback(id: string, targetVersion: number, actor: AdminIdentity, note?: string) {
    const plan = await this.findPlan(id);
    const current = plan.version || 1;
    const target = (plan.versions || []).find((v: any) => v.version === targetVersion);
    if (!target) {
      // Unknown versions are "not found" unless they refer to the live version.
      if (targetVersion === current) {
        throw new AppError(400, 'Cannot roll back to the current or a future version');
      }
      throw new AppError(404, `Version ${targetVersion} not found in plan history`);
    }
    if (targetVersion >= current) {
      throw new AppError(400, 'Cannot roll back to the current or a future version');
    }

    const before = toPlanRow(plan);
    const nextVersion = (plan.version || 1) + 1;

    const updated = await SubscriptionPlan.findByIdAndUpdate(
      id,
      {
        $set: {
          name: target.name,
          description: target.description || '',
          price: target.price,
          maxUsers: target.maxUsers,
          maxDevices: target.maxDevices,
          features: target.features || [],
          aiEnabled: !!target.aiEnabled,
          trialDays: target.trialDays,
          sortOrder: target.sortOrder,
          isDefault: !!target.isDefault,
          status: target.status,
          planType: target.planType,
          visibility: target.visibility,
          limits: resolveLimits({ limits: target.limits }, null),
          version: nextVersion,
          updatedBy: actor.name,
        },
        $push: { versions: snapshot(plan, note || `Rolled back to v${targetVersion}`, actor) },
      },
      { new: true },
    ).exec();
    if (!updated) throw new AppError(404, 'Plan not found');

    await this.audit('ADMIN_PLAN_ROLLBACK', updated, actor, { before, targetVersion }, toPlanRow(updated));
    return toPlanRow(updated);
  }

  // ──────────────────────────────────────────────────────────────
  // ASSIGNMENT — assign / upgrade / downgrade / trial conversion
  // ──────────────────────────────────────────────────────────────
  async assign(body: Record<string, any>, actor: AdminIdentity) {
    const { restaurantId, planId } = body;
    const plan = await SubscriptionPlan.findOne({ planId, isDeleted: { $ne: true } }).lean().exec();
    if (!plan) throw new AppError(404, `Plan "${planId}" not found`);
    if (INACTIVE_STATUSES.has(plan.status)) {
      throw new AppError(400, `Plan "${plan.name}" is ${plan.status} and cannot be assigned`);
    }

    const restaurant = await Restaurant.findById(restaurantId).lean().exec();
    if (!restaurant) throw new AppError(404, 'Restaurant not found');

    let sub = await Subscription.findOne({ restaurantId }).exec();

    const effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
    const isScheduled = effectiveDate && effectiveDate.getTime() > Date.now() + 1000;

    // Downgrade / capacity guard — a restaurant may never switch to a plan whose
    // limits its current usage already exceeds (validated on every plan switch,
    // not only on price-based downgrades).
    if (sub && sub.plan !== planId) {
      const validation = await entitlementService.validatePlanDowngrade(restaurantId, planId);
      if (!validation.allowed) {
        throw new AppError(400, validation.reason || 'Cannot switch plan: current usage exceeds plan limits.');
      }
    }

    if (isScheduled) {
      // Store a pending change; getSubscriptionStatus applies it when due.
      if (!sub) {
        sub = await Subscription.create({
          restaurantId,
          plan: planId,
          status: 'trial',
          startDate: new Date(),
          maxUsers: plan.maxUsers,
          maxDevices: plan.maxDevices,
          features: plan.features || [],
          limits: resolveLimits({ limits: plan.limits }, null),
        });
      }
      sub.pendingPlan = planId;
      sub.pendingEffectiveDate = effectiveDate;
      await sub.save();
      await this.audit('ADMIN_PLAN_ASSIGN_SCHEDULED', plan, actor, {
        restaurantId, restaurantName: restaurant.name, effectiveDate: effectiveDate.toISOString(),
      }, { planId });
      return {
        message: `Plan change scheduled for ${effectiveDate.toISOString()}`,
        scheduled: true,
        effectiveDate: effectiveDate.toISOString(),
      };
    }

    // Immediate assignment — reuse the canonical snapshot semantics.
    let changed: any;
    if (sub) {
      changed = await subscriptionService.changePlan(restaurantId, planId);
    } else {
      // No subscription row yet — create one immediately (immediate activation
      // with a fresh billing period, mirroring changePlan's activation block).
      const now = new Date();
      const expiry = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);
      changed = await Subscription.create({
        restaurantId,
        plan: plan.planId,
        status: 'active',
        startDate: now,
        subscriptionStart: now,
        expiryDate: expiry,
        renewalDate: expiry,
        graceEnd: new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
        maxUsers: plan.maxUsers,
        maxDevices: plan.maxDevices,
        features: plan.features || [],
        limits: resolveLimits({ limits: plan.limits }, null),
      });
    }

    await this.audit('ADMIN_PLAN_ASSIGN', plan, actor, {
      restaurantId,
      restaurantName: restaurant.name,
      previousPlan: sub?.plan || null,
    }, { planId });

    return {
      message: `Plan "${plan.name}" assigned to ${restaurant.name}`,
      scheduled: false,
      subscription: changed ? {
        plan: changed.plan,
        status: changed.status,
        features: changed.features || [],
        limits: changed.limits || {},
      } : undefined,
    };
  }

  /** Trial conversion — activate a trial subscription to a paid plan immediately. */
  async convertTrial(restaurantId: string, planId: string, actor: AdminIdentity) {
    const plan = await SubscriptionPlan.findOne({ planId, isDeleted: { $ne: true } }).lean().exec();
    if (!plan) throw new AppError(404, `Plan "${planId}" not found`);
    if (INACTIVE_STATUSES.has(plan.status)) {
      throw new AppError(400, `Plan "${plan.name}" is ${plan.status} and cannot be assigned`);
    }

    const changed = await subscriptionService.changePlan(restaurantId, planId);

    await this.audit('ADMIN_PLAN_TRIAL_CONVERSION', plan, actor, { restaurantId }, { planId });
    return {
      message: 'Trial converted to paid plan',
      subscription: { plan: changed.plan, status: changed.status },
    };
  }

  // ──────────────────────────────────────────────────────────────
  // STATISTICS — backend-generated
  // ──────────────────────────────────────────────────────────────
  async statistics(id: string) {
    const plan = await this.findPlan(id, { includeDeleted: true });
    const planId = plan.planId;

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalSubs,
      activeSubs,
      expiredSubs,
      trialSubs,
      trialConversions,
      revenue,
      monthlyNew,
      deviceCount,
      branchCount,
      aiRequests,
    ] = await Promise.all([
      Subscription.countDocuments({ plan: planId }).exec(),
      Subscription.countDocuments({ plan: planId, status: 'active' }).exec(),
      Subscription.countDocuments({
        plan: planId,
        $or: [{ status: 'suspended' }, { expiryDate: { $lt: now } }],
      }).exec(),
      Subscription.countDocuments({ plan: planId, status: 'trial' }).exec(),
      // Conversions this month: subscriptions that left trial and became active.
      Subscription.countDocuments({
        plan: planId,
        status: 'active',
        subscriptionStart: { $gte: monthAgo },
      }).exec(),
      Payment.aggregate([
        { $match: { status: 'success', createdAt: { $exists: true } } },
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'subscriptionId',
            foreignField: '_id',
            as: 'sub',
          },
        },
        { $unwind: { path: '$sub', preserveNullAndEmptyArrays: true } },
        { $match: { 'sub.plan': planId } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).exec(),
      Subscription.countDocuments({ plan: planId, createdAt: { $gte: monthAgo } }).exec(),
      Device.aggregate([
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'restaurantId',
            foreignField: 'restaurantId',
            as: 'sub',
          },
        },
        { $unwind: { path: '$sub', preserveNullAndEmptyArrays: true } },
        { $match: { 'sub.plan': planId } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]).exec(),
      Branch.aggregate([
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'restaurantId',
            foreignField: 'restaurantId',
            as: 'sub',
          },
        },
        { $unwind: { path: '$sub', preserveNullAndEmptyArrays: true } },
        { $match: { 'sub.plan': planId } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]).exec(),
      AIUsageLog.aggregate([
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'restaurantId',
            foreignField: 'restaurantId',
            as: 'sub',
          },
        },
        { $unwind: { path: '$sub', preserveNullAndEmptyArrays: true } },
        { $match: { 'sub.plan': planId } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]).exec(),
    ]);

    return {
      id: plan._id.toString(),
      planId,
      name: plan.name,
      status: plan.status,
      restaurantsUsing: totalSubs,
      activeSubscriptions: activeSubs,
      expiredSubscriptions: expiredSubs,
      trialSubscriptions: trialSubs,
      trialConversions: trialConversions,
      revenue: revenue[0]?.total || 0,
      monthlyNewSubscriptions: monthlyNew,
      devices: deviceCount[0]?.count || 0,
      branches: branchCount[0]?.count || 0,
      aiRequests: aiRequests[0]?.count || 0,
      avgRestaurantsPerPlan: totalSubs,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────

  /** Validate features against the centralized catalog (drop unknown keys). */
  private sanitizeFeatures(features: unknown): string[] {
    if (!Array.isArray(features)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of features) {
      const key = String(f).trim();
      if (!key) continue;
      if (!FEATURE_KEYS.has(key)) continue; // reject unknown flags silently
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  private async audit(
    action: string,
    plan: any,
    actor: AdminIdentity,
    details: Record<string, any>,
    after: Record<string, any> | null,
  ) {
    try {
      const afterRow = after ? { ...after, versions: undefined, versionsCount: undefined } : null;
      await auditLogRepo.create({
        action,
        entityType: 'SubscriptionPlan',
        entityId: plan._id ? plan._id.toString() : plan.id,
        performedBy: actor.name,
        performedById: actor.id,
        ipAddress: actor.ipAddress,
        details: {
          planId: plan.planId,
          ...details,
          ...(afterRow ? { after: afterRow } : {}),
        },
      } as any);
    } catch (error) {
      console.error('[PlanService] Audit write failed:', error);
    }
  }
}

export const planService = new PlanService();
