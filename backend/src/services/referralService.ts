/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Referral Service — Referral program (Phase 1.6).
 *
 * Rules enforced server-side:
 *  - The referral code must belong to an existing customer of this restaurant.
 *  - A phone cannot refer itself.
 *  - A referee can only be claimed ONCE (unique restaurantId + refereePhone).
 *  - Rewards (points) are issued via the LoyaltyService ledger and are never
 *    trusted from the client.
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import Referral from '../models/Referral';
import { AppError } from '../utils/AppError';
import { referralRepo, customerRepo, customerActivityRepo, auditLogRepo } from '../repositories';
import { loyaltyService, customerService } from './index';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class ReferralService {
  /**
   * Resolve a referral code to a customer (tenant-scoped). Used for
   * validation and display. Returns null when unknown.
   */
  async resolveCode(restaurantId: string, code: string): Promise<any | null> {
    const customer = await customerRepo.forTenant(restaurantId).findOne({
      referralCode: code.trim().toUpperCase(),
    } as any);
    return customer ? { id: (customer as any)._id.toString(), name: (customer as any).name, phone: (customer as any).phone, code: (customer as any).referralCode } : null;
  }

  /**
   * Register a referral: referee claims a referrer's code.
   * Validates code existence, self-referral, and duplicate referee.
   */
  async createReferral(
    restaurantId: string,
    data: { code: string; refereePhone: string; refereeName?: string },
    ctx: { operator?: string } = {},
  ): Promise<any> {
    const code = data.code.trim().toUpperCase();
    const refereePhone = data.refereePhone.trim();

    const referrer = await customerRepo.forTenant(restaurantId).findOne({ referralCode: code } as any);
    if (!referrer) throw new AppError(404, 'Referral code not found');

    // Self-referral fraud check.
    if ((referrer as any).phone === refereePhone) {
      throw new AppError(400, 'Cannot refer yourself');
    }

    // A referee can only be claimed once per restaurant.
    const dup = await referralRepo.forTenant(restaurantId).findOne({ refereePhone } as any);
    if (dup) throw new AppError(409, 'This phone has already been referred');

    const settings = await loyaltyService.getSettings(restaurantId);
    const referrerReward = settings.referralReferrerPoints || 0;
    const refereeReward = settings.referralRefereePoints || 0;

    // Resolve referee customer (existing or enroll a minimal profile).
    let refereeCustomer = await customerRepo.forTenant(restaurantId).findOne({ phone: refereePhone } as any);
    if (!refereeCustomer) {
      const created = await customerService.create(restaurantId, {
        phone: refereePhone,
        name: data.refereeName || 'Referral Guest',
      }, ctx);
      refereeCustomer = created.customer
        ? await customerRepo.forTenant(restaurantId).findById(created.customer.id)
        : null;
    }
    const refereeId = refereeCustomer ? (refereeCustomer as any)._id.toString() : undefined;

    const referral = await referralRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      code,
      referrerCustomerId: (referrer as any)._id,
      referrerPhone: (referrer as any).phone,
      refereeCustomerId: refereeId ? objectId(refereeId) : undefined,
      refereePhone,
      refereeName: data.refereeName || (refereeCustomer as any)?.name,
      status: 'pending',
      referrerRewardPoints: referrerReward,
      refereeRewardPoints: refereeReward,
      referrerRewarded: false,
      refereeRewarded: false,
      createdBy: ctx.operator,
    } as any);

    // Mark the referee's profile with referredBy (link back).
    if (refereeId) {
      await customerRepo.forTenant(restaurantId).update(refereeId, { referredBy: code } as any);
    }

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: (referrer as any)._id,
      customerPhone: (referrer as any).phone,
      type: 'referral_registered',
      title: `Referred ${data.refereeName || refereePhone}`,
      description: `Referral code ${code}`,
      performedBy: ctx.operator,
    } as any);
    if (refereeId) {
      await customerActivityRepo.forTenant(restaurantId).create({
        restaurantId: objectId(restaurantId),
        customerId: objectId(refereeId),
        customerPhone: refereePhone,
        type: 'referred_by',
        title: 'Referred by a friend',
        description: `Code ${code}`,
        performedBy: ctx.operator,
      } as any);
    }
    await auditLogRepo.create({
      action: 'REFERRAL_CREATED',
      entityType: 'referral',
      entityId: (referral as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { code, referrer: (referrer as any).phone, referee: refereePhone },
    } as any);

    return this.mapReferral(referral);
  }

  /**
   * Mark a referral completed (typically after the referee's first paid bill)
   * and issue both rewards through the loyalty ledger (idempotent).
   */
  async completeReferral(restaurantId: string, referralId: string, ctx: { operator?: string } = {}): Promise<any | null> {
    const referral = await referralRepo.forTenant(restaurantId).findById(referralId);
    if (!referral) throw new AppError(404, 'Referral not found');
    const doc = referral as any;
    if (doc.status === 'rewarded') return this.mapReferral(referral);

    await referralRepo.forTenant(restaurantId).update(referralId, {
      status: 'rewarded',
      completedAt: new Date(),
    } as any);

    // Referrer reward (idempotent — flag guards double issue).
    if (!doc.referrerRewarded && doc.referrerRewardPoints > 0 && doc.referrerCustomerId) {
      await loyaltyService.earnPoints(restaurantId, doc.referrerCustomerId.toString(), {
        amount: doc.referrerRewardPoints,
        type: 'referral',
        description: `Referral reward (${doc.refereePhone})`,
        refType: 'referral',
        refId: referralId,
        createdBy: ctx.operator,
      });
      await referralRepo.forTenant(restaurantId).update(referralId, { referrerRewarded: true } as any);
      await customerRepo.forTenant(restaurantId).update(doc.referrerCustomerId.toString(), {
        $inc: { referralCount: 1 },
      } as any);
    }

    // Referee reward.
    if (!doc.refereeRewarded && doc.refereeRewardPoints > 0 && doc.refereeCustomerId) {
      await loyaltyService.earnPoints(restaurantId, doc.refereeCustomerId.toString(), {
        amount: doc.refereeRewardPoints,
        type: 'referral',
        description: `Referral welcome reward (code ${doc.code})`,
        refType: 'referral',
        refId: referralId,
        createdBy: ctx.operator,
      });
      await referralRepo.forTenant(restaurantId).update(referralId, { refereeRewarded: true } as any);
    }

    const updated = await referralRepo.forTenant(restaurantId).findById(referralId);
    return this.mapReferral(updated);
  }

  /** List referrals with pagination + status filter. */
  async list(restaurantId: string, params: { page?: number; limit?: number; status?: string } = {}): Promise<any> {
    const query: any = {};
    if (params.status) query.status = params.status;
    const result = await referralRepo.forTenant(restaurantId).findAll(query, {
      page: params.page || 1,
      limit: params.limit || 20,
      sort: { createdAt: -1 },
    });
    return {
      data: result.data.map((r) => this.mapReferral(r)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /** Referral analytics summary. */
  async getAnalytics(restaurantId: string): Promise<any> {
    const [total, rewarded, pending, byCode] = await Promise.all([
      Referral.countDocuments({ restaurantId: objectId(restaurantId) }),
      Referral.countDocuments({ restaurantId: objectId(restaurantId), status: 'rewarded' }),
      Referral.countDocuments({ restaurantId: objectId(restaurantId), status: 'pending' }),
      Referral.aggregate([
        { $match: { restaurantId: objectId(restaurantId) } },
        { $group: { _id: '$code', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).exec(),
    ]);
    return { total, rewarded, pending, topCodes: byCode };
  }

  private mapReferral(r: any): any {
    const doc = r.toObject ? r.toObject() : r;
    return {
      id: doc._id.toString(),
      code: doc.code,
      referrerPhone: doc.referrerPhone,
      refereePhone: doc.refereePhone,
      refereeName: doc.refereeName,
      status: doc.status,
      referrerRewardPoints: doc.referrerRewardPoints,
      refereeRewardPoints: doc.refereeRewardPoints,
      referrerRewarded: doc.referrerRewarded,
      refereeRewarded: doc.refereeRewarded,
      completedAt: doc.completedAt,
      createdAt: doc.createdAt,
    };
  }
}
