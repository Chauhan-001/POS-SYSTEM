/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Service — Production-grade customer management (Phase 1.6).
 *
 * Multi-tenant: every operation is scoped by restaurantId (from
 * req.user.restaurantId) via customerRepo.forTenant(). No customer from
 * Restaurant A can ever be read or written by Restaurant B.
 *
 * Loyalty numbers (points, visits, tier, spend) are SERVER-AUTHORITATIVE:
 * client hints are stripped on create/update. Point movements go through the
 * LoyaltyService ledger; this service only manages the profile itself.
 *
 * API Contract: schema uses isNewCustomer (avoids Mongoose isNew conflict);
 * mapToAPI() exposes isNew for frontend compatibility.
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import CustomerVisit from '../models/CustomerVisit';
import Bill from '../models/Bill';
import Offer from '../models/Offer';
import CustomerSegment from '../models/CustomerSegment';
import { AppError } from '../utils/AppError';
import { customerRepo, customerVisitRepo, customerActivityRepo, auditLogRepo, billRepo, referralRepo } from '../repositories';
import { loyaltyService, otpService } from './index';
import type { CustomerStatus } from '../models/Customer';

/** Regex to detect phone number IDs (10-15 digits) vs MongoDB ObjectIds */
const PHONE_ID_RE = /^\d{10,15}$/;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/** Generate a unique 8-char referral code (A-Z0-9, no ambiguous chars). */
function generateReferralCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Fields that are server-authoritative and must never be accepted from clients. */
const SERVER_FIELDS = ['points', 'lifetimePoints', 'visits', 'tier', 'totalSpend', 'averageSpend', 'totalOrders', 'lastVisit', 'firstVisit', 'visitFrequency', 'walletBalance', 'referralCount', 'status', 'isDeleted', 'isBlocked', 'isNewCustomer'];

function stripServerFields(data: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!SERVER_FIELDS.includes(k)) clean[k] = v;
  }
  return clean;
}

export class CustomerService {
  /**
   * List customers with pagination + multi-field search.
   * Searchable: phone, name, email, gst, referral code, tags.
   */
  async list(
    restaurantId: string,
    params: {
      search?: string; phone?: string; email?: string; gstNumber?: string;
      referralCode?: string; tag?: string; tier?: string; status?: string;
      isVip?: string; page?: number; limit?: number;
      sortBy?: string; sortDir?: string; includeDeleted?: string;
    } = {},
  ): Promise<any> {
    const query: any = {};
    const or: any[] = [];

    if (params.phone) or.push({ phone: params.phone });
    if (params.email) or.push({ email: params.email.toLowerCase() });
    if (params.gstNumber) or.push({ gstNumber: { $regex: params.gstNumber, $options: 'i' } });
    if (params.referralCode) or.push({ referralCode: params.referralCode.toUpperCase() });
    if (params.tag) or.push({ tags: params.tag });
    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      // Exact phone match first (fast path), then regex across text fields.
      if (/^\d{10,15}$/.test(s)) {
        or.push({ phone: s });
      }
      or.push({ name: { $regex: s, $options: 'i' } });
      or.push({ email: { $regex: s, $options: 'i' } });
      or.push({ gstNumber: { $regex: s, $options: 'i' } });
      or.push({ referralCode: { $regex: s, $options: 'i' } });
      or.push({ tags: { $regex: s, $options: 'i' } });
    }
    if (or.length > 0) query.$or = or;
    if (params.tier) query.tier = params.tier;
    if (params.status) query.status = params.status;
    if (params.isVip === 'true') query.isVip = true;
    if (params.isVip === 'false') query.isVip = false;

    const sortDir = params.sortDir === 'asc' ? 1 : -1;
    const sortKey = (params.sortBy && ['name', 'points', 'totalSpend', 'visits', 'lastVisit', 'createdAt'].includes(params.sortBy))
      ? params.sortBy
      : 'visits';
    const sort: Record<string, 1 | -1> = { [sortKey]: sortDir };
    if (sortKey !== 'createdAt') sort.createdAt = -1;

    const repo = customerRepo.forTenant(restaurantId);
    const result = params.includeDeleted === 'true'
      ? await repo.findAllRaw(query, { page: params.page || 1, limit: params.limit || 20, sort })
      : await repo.findAll(query, { page: params.page || 1, limit: params.limit || 20, sort });

    return {
      data: result.data.map((c) => this.mapToAPI(c)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      nextPage: result.page < result.totalPages ? result.page + 1 : null,
      previousPage: result.page > 1 ? result.page - 1 : null,
    };
  }

  /**
   * Get a customer by ID or phone (tenant-scoped).
   */
  async getById(restaurantId: string, id: string): Promise<any | null> {
    const repo = customerRepo.forTenant(restaurantId);
    let customer: any = null;
    if (PHONE_ID_RE.test(id)) {
      customer = await repo.findOne({ phone: id } as any);
    } else {
      customer = await repo.findById(id);
    }
    return customer ? this.mapToAPI(customer) : null;
  }

  /**
   * Get a customer by phone (used by billing). Returns null when not found.
   */
  async getByPhone(restaurantId: string, phone: string): Promise<any | null> {
    const customer = await customerRepo.forTenant(restaurantId).findOne({ phone } as any);
    return customer ? this.mapToAPI(customer) : null;
  }

  /**
   * Full profile view for the Customer Profile screen: summary + recent
   * orders + reward history + timeline + available offers + coupons +
   * referral status + segments + audit trail.
   */
  async getProfile(restaurantId: string, id: string): Promise<any | null> {
    const customer = await this.getById(restaurantId, id);
    if (!customer) return null;
    const cid = customer._id || customer.id;

    const [recentBills, rewardHistory, transactions, timeline, availableOffers, segmentDocs, couponUses, referral, audit] = await Promise.all([
      billRepo.findAll({ customerId: cid } as any, { page: 1, limit: 10, sort: { createdAt: -1 } }),
      loyaltyService.getTransactions(restaurantId, cid, { limit: 20, type: 'redeem' }),
      loyaltyService.getTransactions(restaurantId, cid, { limit: 50 }),
      this.getTimeline(restaurantId, cid, { page: 1, limit: 20 }),
      this.getAvailableOffers(restaurantId, customer),
      CustomerSegment.find({ restaurantId: objectId(restaurantId), customerPhones: customer.phone, isDeleted: { $ne: true } }).lean().exec(),
      mongoose.model('CouponRedemption').find({ restaurantId: objectId(restaurantId), customerId: cid, status: 'applied' }).sort({ createdAt: -1 }).limit(20).lean().exec(),
      referralRepo.forTenant(restaurantId).findAll({ referrerPhone: customer.phone } as any, { page: 1, limit: 20, sort: { createdAt: -1 } }),
      auditLogRepo.findAll({ entityType: 'customer', entityId: cid } as any, { page: 1, limit: 20, sort: { createdAt: -1 } }),
    ]);

    const orderHistory = recentBills.data.map((b: any) => ({
      id: (b as any)._id?.toString?.() || (b as any).id,
      invoiceNumber: (b as any).invoiceNumber,
      date: (b as any).date,
      grandTotal: (b as any).grandTotal,
      pointsEarned: (b as any).pointsEarned,
      pointsRedeemed: (b as any).pointsRedeemed,
      redeemedRewardTitle: (b as any).redeemedRewardTitle,
    }));

    return {
      ...customer,
      profile: {
        recentOrders: orderHistory,
        totalOrders: customer.totalOrders || 0,
        rewardHistory: rewardHistory.data,
        transactions: transactions.data,
        timeline: timeline.data,
        availableOffers,
        segments: segmentDocs.map((s) => ({ id: s._id.toString(), name: s.name, type: s.type })),
        couponsUsed: couponUses,
        referral: {
          code: customer.referralCode,
          referredBy: customer.referredBy,
          referralCount: customer.referralCount || 0,
          referrals: referral.data.map((r) => this.mapReferral(r)),
        },
        auditTrail: audit.data.map((a) => ({ action: (a as any).action, performedBy: (a as any).performedBy, createdAt: (a as any).createdAt })),
      },
    };
  }

  /**
   * Create a new customer. Server-authoritative: loyalty fields from the
   * client are ignored; welcome points come from loyalty settings.
   */
  async create(
    restaurantId: string,
    data: Record<string, any>,
    ctx: { operator?: string; branchId?: string } = {},
  ): Promise<{ customer?: any; conflict?: boolean; existing?: any }> {
    const repo = customerRepo.forTenant(restaurantId);
    const existing = await repo.findOne({ phone: data.phone } as any);
    if (existing) {
      return { conflict: true, existing: this.mapToAPI(existing) };
    }

    // Generate a unique referral code for this tenant.
    let referralCode = data.referralCode || generateReferralCode();
    let codeTaken = await repo.findOne({ referralCode } as any);
    while (codeTaken) {
      referralCode = generateReferralCode();
      codeTaken = await repo.findOne({ referralCode } as any);
    }

    const clean = stripServerFields(data);
    const customer = await repo.create({
      ...clean,
      restaurantId: objectId(restaurantId),
      branchId: ctx.branchId ? objectId(ctx.branchId) : clean.branchId ? objectId(clean.branchId) : undefined,
      createdBy: ctx.operator || clean.createdBy,
      referralCode,
      tier: 'Bronze',
      points: 0,
      lifetimePoints: 0,
      walletBalance: 0,
      visits: 0,
      totalSpend: 0,
      averageSpend: 0,
      totalOrders: 0,
      visitFrequency: 0,
      status: 'active',
      isNewCustomer: true,
      isBlocked: false,
    } as any);

    // Welcome points (server-computed; never trust client points).
    try {
      await loyaltyService.earnPoints(restaurantId, (customer as any)._id.toString(), {
        amount: (await loyaltyService.getSettings(restaurantId)).welcomePoints || 0,
        type: 'welcome',
        description: 'Welcome bonus points',
        createdBy: ctx.operator,
        branchId: ctx.branchId,
      });
    } catch (err: any) {
      // Welcome points must never block enrollment.
      console.warn('[CustomerService] welcome points skipped:', err.message);
    }

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: (customer as any)._id,
      customerPhone: data.phone,
      type: 'created',
      title: `Customer enrolled: ${data.name}`,
      description: 'New loyalty profile created',
      performedBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: (customer as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { phone: data.phone, name: data.name },
    } as any);

    return { customer: this.mapToAPI(customer) };
  }

  /**
   * Update a customer profile. Server-authoritative fields are stripped so a
   * forged payload cannot award itself points/tier/spend.
   */
  async update(
    restaurantId: string,
    id: string,
    data: Record<string, any>,
    ctx: { operator?: string } = {},
  ): Promise<any | null> {
    const repo = customerRepo.forTenant(restaurantId);
    let targetId = id;
    if (PHONE_ID_RE.test(id)) {
      const byPhone = await repo.findOne({ phone: id } as any);
      if (!byPhone) return null;
      targetId = (byPhone as any)._id.toString();
    }

    const clean = stripServerFields(data);
    if (Object.keys(clean).length > 0) clean.updatedBy = ctx.operator || clean.updatedBy;

    const customer = await repo.update(targetId, clean as any);
    if (!customer) return null;

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(targetId),
      customerPhone: (customer as any).phone,
      type: 'updated',
      title: 'Profile updated',
      description: `Fields: ${Object.keys(clean).filter((k) => k !== 'updatedBy').join(', ') || 'none'}`,
      performedBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: targetId,
      performedBy: ctx.operator || 'System',
      details: { fields: Object.keys(clean) },
    } as any);

    return this.mapToAPI(customer);
  }

  /** Regenerate a unique referral code for a customer. */
  async regenerateReferralCode(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<any | null> {
    const repo = customerRepo.forTenant(restaurantId);
    let targetId = id;
    if (PHONE_ID_RE.test(id)) {
      const byPhone = await repo.findOne({ phone: id } as any);
      if (!byPhone) return null;
      targetId = (byPhone as any)._id.toString();
    }
    let code = generateReferralCode();
    while (await repo.findOne({ referralCode: code } as any)) {
      code = generateReferralCode();
    }
    const customer = await repo.update(targetId, { referralCode: code } as any);
    if (!customer) return null;
    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(targetId),
      customerPhone: (customer as any).phone,
      type: 'updated',
      title: 'Referral code regenerated',
      description: `New code ${code}`,
      performedBy: ctx.operator,
    } as any);
    return this.mapToAPI(customer);
  }

  /** Block / unblock a customer with a reason (server-recorded). */
  async setBlocked(
    restaurantId: string,
    id: string,
    block: boolean,
    reason: string | undefined,
    ctx: { operator?: string } = {},
  ): Promise<any | null> {
    const repo = customerRepo.forTenant(restaurantId);
    let targetId = id;
    if (PHONE_ID_RE.test(id)) {
      const byPhone = await repo.findOne({ phone: id } as any);
      if (!byPhone) return null;
      targetId = (byPhone as any)._id.toString();
    }
    const customer = await repo.update(targetId, {
      isBlocked: block,
      status: block ? 'blocked' : 'active',
      ...(block ? { blockReason: reason || null } : { blockReason: null }),
    } as any);
    if (!customer) return null;

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(targetId),
      customerPhone: (customer as any).phone,
      type: block ? 'block' : 'unblock',
      title: block ? 'Customer blocked' : 'Customer unblocked',
      description: reason || undefined,
      performedBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: block ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entityType: 'customer',
      entityId: targetId,
      performedBy: ctx.operator || 'System',
      details: { reason },
    } as any);

    return this.mapToAPI(customer);
  }

  /** Soft-delete a customer (profile stays for history; hidden by default). */
  async delete(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<boolean> {
    const repo = customerRepo.forTenant(restaurantId);
    let targetId = id;
    if (PHONE_ID_RE.test(id)) {
      const byPhone = await repo.findOne({ phone: id } as any);
      if (!byPhone) return false;
      targetId = (byPhone as any)._id.toString();
    }
    const customer = await repo.softDelete(targetId);
    if (!customer) return false;

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(targetId),
      customerPhone: (customer as any).phone,
      type: 'deleted',
      title: 'Customer soft-deleted',
      description: 'Profile hidden from directory',
      performedBy: ctx.operator,
    } as any);
    await auditLogRepo.create({
      action: 'CUSTOMER_DELETED',
      entityType: 'customer',
      entityId: targetId,
      performedBy: ctx.operator || 'System',
    } as any);
    return true;
  }

  /** Restore a soft-deleted customer. */
  async restore(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<any | null> {
    // findAllRaw bypasses the soft-delete exclusion so the deleted doc is found.
    const found = await customerRepo.forTenant(restaurantId).findAllRaw(
      { _id: objectId(id), isDeleted: true } as any,
      { page: 1, limit: 1 },
    );
    if (found.total === 0) return null;
    // Direct model update — repo.update() excludes soft-deleted docs by design.
    await Customer.updateOne(
      { _id: objectId(id), restaurantId: objectId(restaurantId) },
      { $set: { isDeleted: false, deletedAt: null } }
    ).exec();
    const restored = await customerRepo.forTenant(restaurantId).findById(id);

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(id),
      customerPhone: (restored as any)?.phone,
      type: 'restored',
      title: 'Customer restored',
      description: 'Profile visible again in directory',
      performedBy: ctx.operator,
    } as any);
    await auditLogRepo.create({
      action: 'CUSTOMER_RESTORED',
      entityType: 'customer',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return this.mapToAPI(restored);
  }

  /**
   * Merge two duplicate customers. The duplicate's historical records
   * (visits, bills, loyalty ledger, activities, coupons, referrals) are
   * reassigned to the primary, then the duplicate is soft-deleted. Runs in a
   * MongoDB transaction when the deployment supports replica sets.
   */
  async merge(
    restaurantId: string,
    primaryId: string,
    duplicateId: string,
    ctx: { operator?: string } = {},
  ): Promise<any | null> {
    if (primaryId === duplicateId) throw new AppError(400, 'Cannot merge a customer with itself');
    const repo = customerRepo.forTenant(restaurantId);
    const primary = await repo.findById(primaryId);
    const duplicate = await repo.findById(duplicateId);
    if (!primary || !duplicate) throw new AppError(404, 'Customer not found');

    const pId = (primary as any)._id.toString();
    const dId = (duplicate as any)._id.toString();

    let merged: any = null;
    // Transactional merge when the deployment supports replica sets; falls back
    // to sequential updates on standalone MongoDB (common for local POS).
    const transferRecords = async (session?: mongoose.ClientSession) => {
      const run = (query: any) => session ? query.session(session).exec() : query.exec();
      await run(CustomerVisit.updateMany({ customerId: dId }, { $set: { customerId: pId } }));
      await run(mongoose.model('LoyaltyTransaction').updateMany({ customerId: dId }, { $set: { customerId: pId } }));
      await run(mongoose.model('CustomerActivity').updateMany({ customerId: dId }, { $set: { customerId: pId } }));
      await run(mongoose.model('CouponRedemption').updateMany({ customerId: dId }, { $set: { customerId: pId } }));
      await run(Bill.updateMany({ customerId: dId }, { $set: { customerId: pId } }));
      await run(
        mongoose.model('Referral').updateMany(
          { $or: [{ referrerCustomerId: dId }, { refereeCustomerId: dId }] },
          { $set: { referrerCustomerId: pId, refereeCustomerId: pId } }
        )
      );
    };
    const aggregateIntoPrimary = async (session?: mongoose.ClientSession) => {
      const d = duplicate as any;
      const combinedSpend = (primary as any).totalSpend + d.totalSpend;
      const combinedVisits = (primary as any).visits + d.visits;
      const combinedPoints = (primary as any).points + d.points;
      const combinedLifetime = (primary as any).lifetimePoints + d.lifetimePoints;
      const combinedOrders = (primary as any).totalOrders + d.totalOrders;
      const wallet = (primary as any).walletBalance + d.walletBalance;
      const q = Customer.findOneAndUpdate(
        { _id: pId, restaurantId: objectId(restaurantId) },
        {
          $set: {
            totalSpend: Math.round(combinedSpend * 100) / 100,
            visits: combinedVisits,
            totalOrders: combinedOrders,
            points: combinedPoints,
            lifetimePoints: combinedLifetime,
            walletBalance: Math.round(wallet * 100) / 100,
            averageSpend: combinedVisits > 0 ? Math.round((combinedSpend / combinedVisits) * 100) / 100 : 0,
            referralCount: (primary as any).referralCount + (d.referralCount || 0),
            isDeleted: false,
            deletedAt: null,
          },
          $addToSet: {
            favoriteItems: { $each: (d.favoriteItems || []).slice(0, 10) },
            favoriteCategories: { $each: (d.favoriteCategories || []).slice(0, 5) },
          },
        },
        { new: true, session }
      );
      return (session ? q.session(session).exec() : q.exec()) as Promise<any>;
    };

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await transferRecords(session);
        merged = await aggregateIntoPrimary(session);
        await Customer.updateOne(
          { _id: dId },
          { $set: { isDeleted: true, deletedAt: new Date(), status: 'deleted' } }
        ).session(session).exec();
      });
    } catch (err: any) {
      // Standalone MongoDB (no replica set / retryable writes) → the session
      // transaction is unavailable. Fall back to sequential updates — the
      // transfers are idempotent, so this is safe (best-effort merge).
      const txUnavailable = /transaction|retryable writes|replica set|IllegalOperation/i.test(err?.message || '') || err?.codeName === 'IllegalOperation';
      if (txUnavailable) {
        console.warn('[CustomerService] transactions unavailable — falling back to sequential merge');
        await transferRecords(undefined);
        merged = await aggregateIntoPrimary(undefined);
        await Customer.updateOne(
          { _id: dId },
          { $set: { isDeleted: true, deletedAt: new Date(), status: 'deleted' } }
        ).exec();
      } else {
        throw err;
      }
    } finally {
      await session.endSession();
    }

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(pId),
      customerPhone: (primary as any).phone,
      type: 'merged',
      title: `Merged with ${(duplicate as any).name} (${(duplicate as any).phone})`,
      description: 'Duplicate profiles combined',
      performedBy: ctx.operator,
    } as any);
    await auditLogRepo.create({
      action: 'CUSTOMER_MERGED',
      entityType: 'customer',
      entityId: pId,
      performedBy: ctx.operator || 'System',
      details: { primary: pId, duplicate: dId },
    } as any);

    return this.mapToAPI(merged);
  }

  // =============================================================
  // Import / Export
  // =============================================================

  /** Bulk import customers. mode='skip' skips existing phones, 'update' merges them. */
  async importCustomers(
    restaurantId: string,
    customers: Array<Record<string, any>>,
    mode: 'skip' | 'update' = 'skip',
    ctx: { operator?: string; branchId?: string } = {},
  ): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
    const repo = customerRepo.forTenant(restaurantId);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of customers) {
      try {
        const existing = await repo.findOne({ phone: row.phone } as any);
        if (existing) {
          if (mode === 'update') {
            await this.update(restaurantId, (existing as any)._id.toString(), stripServerFields(row), ctx);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }
        const result = await this.create(restaurantId, row, ctx);
        if (result.customer) created++;
        else skipped++;
      } catch (err: any) {
        failed++;
        console.warn('[CustomerService] import row failed:', row.phone, err.message);
      }
    }

    await auditLogRepo.create({
      action: 'CUSTOMER_IMPORT',
      entityType: 'customer',
      performedBy: ctx.operator || 'System',
      details: { created, updated, skipped, failed, total: customers.length },
    } as any);
    return { created, updated, skipped, failed };
  }

  /** Export customers as an array of flat rows (JSON or CSV string). */
  async exportCustomers(
    restaurantId: string,
    params: { search?: string; tier?: string; segment?: string; limit?: number; format?: 'csv' | 'json' } = {},
  ): Promise<{ rows: any[]; csv?: string; count: number }> {
    const query: any = {};
    if (params.search) {
      query.$or = [
        { name: { $regex: params.search, $options: 'i' } },
        { phone: { $regex: params.search } },
        { email: { $regex: params.search, $options: 'i' } },
      ];
    }
    if (params.tier) query.tier = params.tier;

    let customerList: any[];
    if (params.segment) {
      const segment = await CustomerSegment.findOne({ restaurantId: objectId(restaurantId), name: params.segment }).lean().exec();
      const phones = segment?.customerPhones || [];
      const base = { ...query, phone: { $in: phones } };
      customerList = await Customer.find({ restaurantId: objectId(restaurantId), ...base, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(params.limit || 1000)
        .lean()
        .exec();
    } else {
      customerList = await Customer.find({ restaurantId: objectId(restaurantId), ...query, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(params.limit || 1000)
        .lean()
        .exec();
    }

    const rows = customerList.map((c) => ({
      phone: c.phone,
      name: c.name,
      email: c.email || '',
      birthday: c.birthday || '',
      anniversary: c.anniversary || '',
      gender: c.gender || '',
      city: c.city || '',
      state: c.state || '',
      gstNumber: c.gstNumber || '',
      tags: (c.tags || []).join(';'),
      marketingOptIn: c.marketingOptIn ? 'yes' : 'no',
      tier: c.tier,
      points: c.points,
      walletBalance: c.walletBalance,
      totalSpend: c.totalSpend,
      averageSpend: c.averageSpend,
      totalOrders: c.totalOrders,
      visits: c.visits,
      lastVisit: c.lastVisit ? new Date(c.lastVisit).toISOString().slice(0, 10) : '',
      referralCode: c.referralCode || '',
      status: c.status,
    }));

    await auditLogRepo.create({
      action: 'CUSTOMER_EXPORT',
      entityType: 'customer',
      performedBy: 'System',
      details: { count: rows.length, format: params.format || 'csv' },
    } as any);

    if (params.format === 'json') {
      return { rows, count: rows.length };
    }
    return { rows, csv: this.toCsv(rows), count: rows.length };
  }

  private toCsv(rows: Record<string, any>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }

  // =============================================================
  // Timeline / activities
  // =============================================================

  async getTimeline(restaurantId: string, customerId: string, params: { page?: number; limit?: number } = {}): Promise<any> {
    const result = await customerActivityRepo.forTenant(restaurantId).findAll(
      { customerId: objectId(customerId) } as any,
      { page: params.page || 1, limit: params.limit || 20, sort: { createdAt: -1 } },
    );
    return {
      data: result.data.map((a: any) => ({
        id: a._id.toString(),
        type: a.type,
        title: a.title,
        description: a.description,
        performedBy: a.performedBy,
        createdAt: a.createdAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  // =============================================================
  // Profile helpers
  // =============================================================

  /** Active offers that apply to this customer (segment + date + status). */
  async getAvailableOffers(restaurantId: string, customer: any): Promise<any[]> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const offers = await Offer.find({
      restaurantId: objectId(restaurantId),
      status: 'active',
      isDeleted: { $ne: true },
      $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: todayStr } }],
    }).sort({ sortOrder: 1 }).limit(20).lean().exec();

    // Customer's segment names for targeting.
    const segments = await CustomerSegment.find({
      restaurantId: objectId(restaurantId),
      customerPhones: customer.phone,
      isDeleted: { $ne: true },
    }).lean().exec();
    const segmentNames = new Set(segments.map((s) => s.name));

    return offers
      .filter((o) => {
        if (o.targetSegmentIds && o.targetSegmentIds.length > 0) {
          const matched = (o.targetSegmentNames || []).some((n) => segmentNames.has(n)) ||
            o.targetSegmentIds.some((id) => segments.some((s) => s._id.toString() === id));
          if (!matched) return false;
        }
        return true;
      })
      .map((o) => ({
        id: o._id.toString(),
        title: o.title,
        description: o.description,
        type: o.type,
        value: o.value,
        minOrderValue: o.minOrderValue,
        endDate: o.endDate,
        couponCode: o.couponCode,
      }));
  }

  private mapReferral(r: any): any {
    const doc = r.toObject ? r.toObject() : r;
    return {
      id: doc._id.toString(),
      code: doc.code,
      refereePhone: doc.refereePhone,
      refereeName: doc.refereeName,
      status: doc.status,
      referrerRewardPoints: doc.referrerRewardPoints,
      refereeRewardPoints: doc.refereeRewardPoints,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Map isNewCustomer → isNew for Frontend API contract compatibility.
   */
  private mapToAPI(customer: any): any {
    if (!customer) return null;
    const obj = customer.toObject ? customer.toObject() : customer;
    const { isNewCustomer, ...rest } = obj;
    return { ...rest, id: rest._id?.toString?.() || rest.id, isNew: isNewCustomer };
  }
}
