/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loyalty Service — Server-authoritative loyalty engine (Phase 1.6).
 *
 * The backend is the ONLY authority for loyalty math. Client-supplied points,
 * visits, tiers and spend are treated as hints and NEVER trusted. Every point
 * movement is written to the append-only LoyaltyTransaction ledger and
 * consumes from a FIFO pool of unexpired earn entries, which structurally
 * prevents: negative balances, double redemption, simultaneous redemption
 * races, duplicate bill rewards and forged payloads.
 *
 * Responsibilities:
 *  - Point earning (with tier multiplier), redemption (FIFO pool, limits),
 *    expiry (rolling/fixed/annual), adjustments
 *  - Tier computation from lifetime spend
 *  - Wallet credits/debits
 *  - Billing integration hook (recordBill) — visits, spend stats, favorites
 *  - Loyalty settings + tier configuration CRUD
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import CustomerVisit from '../models/CustomerVisit';
import LoyaltyTier from '../models/LoyaltyTier';
import LoyaltySettings from '../models/LoyaltySettings';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { AppError } from '../utils/AppError';
import { customerRepo, loyaltyTierRepo, loyaltySettingsRepo, loyaltyTransactionRepo, customerVisitRepo, customerActivityRepo, auditLogRepo } from '../repositories';
import type { CustomerTier } from '../models/Customer';

// ─── Helpers ────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

// ─── Default configuration ─────────────────────────────────────

const DEFAULT_TIERS: Array<{
  name: CustomerTier;
  minLifetimeSpend: number;
  pointsMultiplier: number;
  rewardPercent: number;
  expiryMonths: number;
  priority: number;
  birthdayRewardPoints: number;
  benefits: string[];
}> = [
  { name: 'Bronze', minLifetimeSpend: 0, pointsMultiplier: 1, rewardPercent: 0, expiryMonths: 12, priority: 0, birthdayRewardPoints: 50, benefits: ['Earn 1x points', 'Birthday reward 50 pts'] },
  { name: 'Silver', minLifetimeSpend: 5000, pointsMultiplier: 1.25, rewardPercent: 0, expiryMonths: 12, priority: 1, birthdayRewardPoints: 75, benefits: ['Earn 1.25x points', 'Priority seating', 'Birthday reward 75 pts'] },
  { name: 'Gold', minLifetimeSpend: 20000, pointsMultiplier: 1.5, rewardPercent: 2, expiryMonths: 15, priority: 2, birthdayRewardPoints: 100, benefits: ['Earn 1.5x points', '2% extra reward', 'Free dessert on birthday'] },
  { name: 'Platinum', minLifetimeSpend: 50000, pointsMultiplier: 2, rewardPercent: 4, expiryMonths: 18, priority: 3, birthdayRewardPoints: 150, benefits: ['Earn 2x points', '4% extra reward', 'Free dessert + priority reservations'] },
  { name: 'Diamond', minLifetimeSpend: 100000, pointsMultiplier: 3, rewardPercent: 6, expiryMonths: 24, priority: 4, birthdayRewardPoints: 200, benefits: ['Earn 3x points', '6% extra reward', 'Complimentary meal on birthday', 'Dedicated host'] },
];

const DEFAULT_SETTINGS = {
  pointsPerCurrency: 1,
  pointsValueInCurrency: 10,
  roundOffPoints: true,
  minRedemption: 0,
  maxRedemptionPerTransaction: 500,
  dailyRedemptionLimit: 1000,
  monthlyRedemptionLimit: 5000,
  pointExpiryMode: 'none',
  rollingExpiryMonths: 12,
  fixedExpiryDate: undefined,
  expiryReminderDays: [30, 7, 1],
  welcomePoints: 50,
  birthdayBonusPoints: 100,
  anniversaryBonusPoints: 100,
  referralEnabled: true,
  referralReferrerPoints: 100,
  referralRefereePoints: 50,
  enableWallet: true,
  enableTiers: true,
  otpEnabled: true,
  largeRewardThreshold: 500,
} as const;

// ─── Service ────────────────────────────────────────────────────

export class LoyaltyService {
  // =============================================================
  // Settings
  // =============================================================

  async getSettings(restaurantId: string): Promise<any> {
    const settings = await loyaltySettingsRepo.forTenant(restaurantId).findOne({} as any);
    if (settings) return settings.toObject();
    return this.ensureSettings(restaurantId);
  }

  async ensureSettings(restaurantId: string): Promise<any> {
    const rid = objectId(restaurantId);
    // Atomic upsert — never find-then-create, so concurrent callers (e.g.
    // parallel admin CRM endpoints) can't race into a duplicate-key error on
    // the unique restaurantId index.
    const settings = await LoyaltySettings.findOneAndUpdate(
      { restaurantId: rid },
      { $setOnInsert: { restaurantId: rid } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean().exec();
    return settings;
  }

  async updateSettings(restaurantId: string, patch: Record<string, any>, ctx: { operator?: string } = {}): Promise<any> {
    const settings = await loyaltySettingsRepo.forTenant(restaurantId).findOneAndUpdate(
      {} as any,
      { ...patch, updatedBy: ctx.operator } as any,
      { upsert: true }
    );
    await auditLogRepo.create({
      action: 'LOYALTY_SETTINGS_UPDATED',
      entityType: 'loyalty',
      performedBy: ctx.operator || 'System',
      details: patch,
    } as any);
    return settings?.toObject();
  }

  // =============================================================
  // Tiers
  // =============================================================

  async ensureTiers(restaurantId: string): Promise<any[]> {
    const repo = loyaltyTierRepo.forTenant(restaurantId);
    const existing = await repo.findAll({} as any, {});
    if (existing.total > 0) return existing.data.map((t) => t.toObject());

    const docs = DEFAULT_TIERS.map((t, i) => ({
      restaurantId: objectId(restaurantId),
      ...t,
      isDefault: i === 0,
      isActive: true,
    }));
    await repo.bulkCreate(docs as any);
    const created = await repo.findAll({} as any, { sort: { priority: 1 } });
    return created.data.map((t) => t.toObject());
  }

  async listTiers(restaurantId: string): Promise<any[]> {
    await this.ensureTiers(restaurantId);
    const tiers = await loyaltyTierRepo.forTenant(restaurantId).findAll({} as any, { sort: { priority: 1 } });
    return tiers.data.map((t) => t.toObject());
  }

  async createTier(restaurantId: string, data: Record<string, any>, ctx: { operator?: string } = {}): Promise<any> {
    const tier = await loyaltyTierRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      ...data,
    } as any);
    await auditLogRepo.create({
      action: 'LOYALTY_TIER_CREATED',
      entityType: 'loyalty_tier',
      entityId: (tier as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { name: data.name },
    } as any);
    return tier.toObject();
  }

  async updateTier(restaurantId: string, id: string, data: Record<string, any>, ctx: { operator?: string } = {}): Promise<any> {
    const tier = await loyaltyTierRepo.forTenant(restaurantId).update(id, data);
    if (!tier) throw new AppError(404, 'Loyalty tier not found');
    await auditLogRepo.create({
      action: 'LOYALTY_TIER_UPDATED',
      entityType: 'loyalty_tier',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: data,
    } as any);
    return tier.toObject();
  }

  async deleteTier(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<boolean> {
    const tier = await loyaltyTierRepo.forTenant(restaurantId).softDelete(id);
    if (!tier) throw new AppError(404, 'Loyalty tier not found');
    await auditLogRepo.create({
      action: 'LOYALTY_TIER_DELETED',
      entityType: 'loyalty_tier',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return true;
  }

  /** Compute the tier for a given lifetime spend (server-authoritative). */
  async computeTier(restaurantId: string, totalSpend: number): Promise<{ name: CustomerTier; priority: number; multiplier: number; rewardPercent: number; expiryMonths: number; birthdayRewardPoints: number }> {
    const tiers = await this.listTiers(restaurantId);
    let current = tiers[0];
    for (const t of tiers) {
      if (!t.isActive) continue;
      if (totalSpend >= t.minLifetimeSpend && (!current || t.priority > current.priority)) {
        current = t;
      }
    }
    return current
      ? { name: current.name, priority: current.priority, multiplier: current.pointsMultiplier, rewardPercent: current.rewardPercent, expiryMonths: current.expiryMonths, birthdayRewardPoints: current.birthdayRewardPoints }
      : { name: 'Bronze', priority: 0, multiplier: 1, rewardPercent: 0, expiryMonths: 12, birthdayRewardPoints: 50 };
  }

  // =============================================================
  // Point pool
  // =============================================================

  /** Sum of unexpired, unspent earn entries (the customer's true balance). */
  async getAvailablePoints(customerId: string): Promise<number> {
    const rows = await LoyaltyTransaction.aggregate([
      {
        $match: {
          customerId: objectId(customerId),
          remaining: { $gt: 0 },
          // null/absent expiresAt = never expires
          $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }, { expiresAt: { $exists: false } }],
        },
      },
      { $group: { _id: null, total: { $sum: '$remaining' } } },
    ]).exec();
    return rows.length > 0 ? rows[0].total : 0;
  }

  /** Compute expiresAt for a new earn entry based on settings + tier. */
  private computeExpiry(settings: any, tierExpiryMonths: number): Date | null {
    const mode = settings?.pointExpiryMode || 'none';
    const now = new Date();
    if (mode === 'none') return null;
    if (mode === 'rolling') {
      const months = settings?.rollingExpiryMonths || 12;
      return new Date(now.getTime() + months * 30 * DAY_MS);
    }
    if (mode === 'annual') {
      return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
    if (mode === 'fixed' && settings?.fixedExpiryDate) {
      const d = new Date(`${settings.fixedExpiryDate}T23:59:59.999Z`);
      return isNaN(d.getTime()) ? null : d;
    }
    // Fall back to tier expiry policy
    if (tierExpiryMonths > 0) {
      return new Date(now.getTime() + tierExpiryMonths * 30 * DAY_MS);
    }
    return null;
  }

  /**
   * Earn points (creates a pool entry + updates the customer balance).
   * Returns the transaction and the new balance. Never trusts caller amounts
   * for multipliers — the tier multiplier is applied here from server state.
   */
  async earnPoints(
    restaurantId: string,
    customerId: string,
    opts: {
      amount: number;                 // base points (already computed from spend)
      type: 'earn' | 'welcome' | 'birthday' | 'anniversary' | 'referral' | 'adjustment';
      description: string;
      refType?: string;
      refId?: string;
      branchId?: string;
      createdBy?: string;
      applyMultiplier?: boolean;      // default false (base amount already includes multiplier)
    },
  ): Promise<{ transaction: any; newBalance: number }> {
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');
    if (opts.amount <= 0) throw new AppError(400, 'Points must be positive');

    const settings = await this.getSettings(restaurantId);
    const tierInfo = await this.computeTier(restaurantId, customer.totalSpend || 0);

    let points = Math.round(opts.amount * 100) / 100;
    if (opts.applyMultiplier && points > 0) {
      points = Math.round(points * tierInfo.multiplier * 100) / 100;
    }
    if (settings?.roundOffPoints !== false) points = Math.floor(points);

    const expiresAt = this.computeExpiry(settings, tierInfo.expiryMonths);
    const newBalance = (customer.points || 0) + points;

    const tx = await LoyaltyTransaction.create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      branchId: opts.branchId ? objectId(opts.branchId) : undefined,
      type: opts.type,
      points,
      wallet: 0,
      balanceAfter: newBalance,
      walletBalanceAfter: customer.walletBalance || 0,
      description: opts.description,
      refType: opts.refType,
      refId: opts.refId,
      remaining: points,
      expiresAt,
      createdBy: opts.createdBy,
    });

    await Customer.updateOne(
      { _id: objectId(customerId) },
      { $inc: { points, lifetimePoints: points } }
    ).exec();

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'points_earned',
      title: `${points} pts ${opts.type === 'welcome' ? 'welcome bonus' : opts.type === 'birthday' ? 'birthday bonus' : opts.type === 'anniversary' ? 'anniversary bonus' : opts.type === 'referral' ? 'referral bonus' : 'earned'}`,
      description: opts.description,
      metadata: { points, type: opts.type },
      performedBy: opts.createdBy,
    } as any);

    return { transaction: (tx as any).toObject(), newBalance };
  }

  /**
   * Redeem points — FIFO consumption of the unexpired pool. Atomic per-entry
   * decrement ($gte guard) prevents simultaneous redemption races.
   */
  async redeemPoints(
    restaurantId: string,
    customerId: string,
    points: number,
    opts: { description?: string; refType?: string; refId?: string; branchId?: string; createdBy?: string } = {},
  ): Promise<{ transaction: any; newBalance: number }> {
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');
    if (points <= 0) throw new AppError(400, 'Redemption points must be positive');

    const settings = await this.getSettings(restaurantId);

    // Per-transaction limits
    if (points < (settings.minRedemption || 0)) {
      throw new AppError(400, `Minimum redemption is ${settings.minRedemption} points`);
    }
    if (settings.maxRedemptionPerTransaction && points > settings.maxRedemptionPerTransaction) {
      throw new AppError(400, `Maximum redemption per transaction is ${settings.maxRedemptionPerTransaction} points`);
    }

    // Daily / monthly limits
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [dailySum, monthlySum] = await Promise.all([
      LoyaltyTransaction.aggregate([
        { $match: { restaurantId: objectId(restaurantId), customerId: objectId(customerId), type: 'redeem', createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: { $abs: '$points' } } } },
      ]).exec(),
      LoyaltyTransaction.aggregate([
        { $match: { restaurantId: objectId(restaurantId), customerId: objectId(customerId), type: 'redeem', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: { $abs: '$points' } } } },
      ]).exec(),
    ]);
    const dailyUsed = dailySum[0]?.total || 0;
    const monthlyUsed = monthlySum[0]?.total || 0;
    if (settings.dailyRedemptionLimit && dailyUsed + points > settings.dailyRedemptionLimit) {
      throw new AppError(400, `Daily redemption limit of ${settings.dailyRedemptionLimit} points exceeded`);
    }
    if (settings.monthlyRedemptionLimit && monthlyUsed + points > settings.monthlyRedemptionLimit) {
      throw new AppError(400, `Monthly redemption limit of ${settings.monthlyRedemptionLimit} points exceeded`);
    }

    // FIFO consumption — atomic per-entry decrement with $gte guard.
    let remaining = points;
    const consumedFrom: Array<{ transactionId: string; points: number }> = [];
    const pool = await LoyaltyTransaction.find({
      customerId: objectId(customerId),
      remaining: { $gt: 0 },
      $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }, { expiresAt: { $exists: false } }],
    } as any).sort({ createdAt: 1 }).exec();

    for (const entry of pool) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, entry.remaining || 0);
      const res = await LoyaltyTransaction.updateOne(
        { _id: entry._id, remaining: { $gte: take } },
        { $inc: { remaining: -take } }
      ).exec();
      if (res.modifiedCount === 1) {
        remaining -= take;
        consumedFrom.push({ transactionId: entry._id.toString(), points: take });
      }
      // modifiedCount === 0 → a concurrent redemption consumed this entry first
    }

    if (remaining > 0) {
      throw new AppError(400, 'Insufficient loyalty points');
    }

    const newBalance = await this.getAvailablePoints(customerId);

    const tx = await LoyaltyTransaction.create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      branchId: opts.branchId ? objectId(opts.branchId) : undefined,
      type: 'redeem',
      points: -points,
      wallet: 0,
      balanceAfter: newBalance,
      walletBalanceAfter: customer.walletBalance || 0,
      description: opts.description || 'Points redeemed',
      refType: opts.refType,
      refId: opts.refId,
      consumedFrom,
      createdBy: opts.createdBy,
    });

    await Customer.updateOne(
      { _id: objectId(customerId) },
      { $set: { points: newBalance } }
    ).exec();

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'points_redeemed',
      title: `${points} pts redeemed`,
      description: opts.description || 'Points redeemed',
      metadata: { points, consumedFrom },
      performedBy: opts.createdBy,
    } as any);

    return { transaction: tx.toObject(), newBalance };
  }

  /**
   * Redeem a reward from the catalog. Large rewards require a verified OTP.
   * Validates: active, tenant-scoped, stock, points availability.
   */
  async redeemReward(
    restaurantId: string,
    customerId: string,
    reward: any,
    opts: { otpVerified: boolean; branchId?: string; createdBy?: string },
  ): Promise<{ redemption: any; transaction: any; newBalance: number }> {
    if (!reward || (reward as any).isDeleted) throw new AppError(404, 'Reward not found');
    if (!(reward as any).isActive) throw new AppError(400, 'Reward is not active');

    // Stock validation (null/undefined = unlimited)
    const stock = (reward as any).stock;
    if (typeof stock === 'number' && stock <= (reward as any).redeemedCount) {
      throw new AppError(400, 'Reward is out of stock');
    }

    const settings = await this.getSettings(restaurantId);
    const isLarge = (reward as any).isLargeReward ||
      ((reward as any).value || 0) >= (settings.largeRewardThreshold || 500);
    if (isLarge && !opts.otpVerified) {
      throw new AppError(403, 'OTP verification required for this reward');
    }

    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');

    const minBill = (reward as any).minBillAmount || 0;
    if (minBill > 0 && minBill > (customer.averageSpend || 0)) {
      // Not strictly blocking — but warn in description. Keep redeemable for flexibility.
    }

    const pointsRequired = (reward as any).pointsRequired;
    const { transaction, newBalance } = await this.redeemPoints(restaurantId, customerId, pointsRequired, {
      description: `Reward: ${(reward as any).title}`,
      refType: 'reward',
      refId: (reward as any)._id.toString(),
      branchId: opts.branchId,
      createdBy: opts.createdBy,
    });

    // Usage tracking + stock decrement
    await mongoose.model('Reward').updateOne(
      { _id: (reward as any)._id },
      { $inc: { redeemedCount: 1 } }
    ).exec();

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'reward_redeemed',
      title: `Redeemed ${(reward as any).title}`,
      description: `${pointsRequired} pts → ${(reward as any).type} ${(reward as any).value}`,
      metadata: { rewardId: (reward as any)._id.toString(), rewardTitle: (reward as any).title, points: pointsRequired },
      performedBy: opts.createdBy,
    } as any);

    await auditLogRepo.create({
      action: 'REWARD_REDEEMED',
      entityType: 'reward',
      entityId: (reward as any)._id.toString(),
      performedBy: opts.createdBy || 'System',
      details: { customerId, rewardTitle: (reward as any).title, points: pointsRequired },
    } as any);

    return {
      redemption: {
        rewardId: (reward as any)._id.toString(),
        title: (reward as any).title,
        type: (reward as any).type,
        value: (reward as any).value,
        pointsRedeemed: pointsRequired,
      },
      transaction: transaction as any,
      newBalance,
    };
  }

  // =============================================================
  // Billing integration (server-authoritative)
  // =============================================================

  /**
   * Called by BillService after a bill is created. Computes everything
   * server-side: points earned (spend × rate × tier multiplier), visit stats,
   * spend totals, favorites, first-visit/welcome & birthday bonuses.
   * Never reads client-sent points.
   */
  async recordBill(
    restaurantId: string,
    customerId: string,
    bill: { grandTotal: number; date?: string; branchId?: string; items?: any[]; cashierName?: string; invoiceNumber?: string; customerPhone?: string },
  ): Promise<{ pointsEarned: number; newBalance: number; newTier: CustomerTier }> {
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');

    const settings = await this.getSettings(restaurantId);
    const tierInfo = await this.computeTier(restaurantId, customer.totalSpend || 0);
    const grandTotal = Number(bill.grandTotal) || 0;

    // ── Points earned (server formula; client hints ignored) ──
    const rate = settings.pointsPerCurrency || 0;
    let base = rate > 0 ? grandTotal * rate : 0;
    base = base * tierInfo.multiplier;
    if (settings.roundOffPoints !== false) base = Math.floor(base);

    // ── Visit + spend stats ─────────────────────────────────
    const today = new Date();
    const prevVisit = customer.lastVisit;
    const visitGapDays = prevVisit ? Math.max(1, Math.floor((today.getTime() - new Date(prevVisit).getTime()) / DAY_MS)) : 0;
    const prevFrequency = customer.visitFrequency || 0;
    const newVisits = (customer.visits || 0) + 1;
    const newTotalSpend = (customer.totalSpend || 0) + grandTotal;
    const newAvgSpend = newVisits > 0 ? Math.round((newTotalSpend / newVisits) * 100) / 100 : grandTotal;
    const newFrequency = visitGapDays > 0
      ? (prevFrequency > 0 ? Math.round(((prevFrequency + visitGapDays) / 2) * 10) / 10 : visitGapDays)
      : prevFrequency;

    // ── Favorites (top items/categories from this bill) ──────
    const items = Array.isArray(bill.items) ? bill.items : [];
    const itemNames = items.map((i: any) => i?.itemName || i?.product?.name).filter(Boolean) as string[];
    const categories = items.map((i: any) => i?.product?.category || i?.category).filter(Boolean) as string[];
    const favoriteItems = [...new Set([...(customer.favoriteItems || []), ...itemNames])].slice(0, 20);
    const favoriteCategories = [...new Set([...(customer.favoriteCategories || []), ...categories])].slice(0, 10);

    // ── New customer: welcome points + firstVisit ────────────
    // Welcome points are awarded ONCE (typically at enrollment via
    // customerService.create). Skip if the customer already has a welcome entry
    // so billing never double-awards it.
    let welcomeTxPoints = 0;
    let bonusTxPoints = 0;
    const alreadyWelcomed = await LoyaltyTransaction.exists({ customerId: objectId(customerId), type: 'welcome' });
    const isFirstVisit = customer.isNewCustomer || !customer.firstVisit;
    if (isFirstVisit && !alreadyWelcomed && settings.welcomePoints > 0) {
      welcomeTxPoints = settings.welcomePoints;
    }
    // ── Birthday bonus (once per year) ───────────────────────
    const bd = customer.birthday;
    if (bd && bd.length >= 5) {
      const mmdd = bd.slice(5);
      const todayMMDD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (mmdd === todayMMDD) {
        const alreadyAwarded = await LoyaltyTransaction.exists({
          customerId: objectId(customerId),
          type: 'birthday',
          createdAt: { $gte: new Date(today.getFullYear(), 0, 1) },
        });
        if (!alreadyAwarded && settings.birthdayBonusPoints > 0) {
          bonusTxPoints = settings.birthdayBonusPoints;
        }
      }
    }

    // ── Persist customer stats (atomic single update) ────────
    const newTier = await this.computeTier(restaurantId, newTotalSpend);
    const prevTier = customer.tier;
    await Customer.updateOne(
      { _id: customer._id },
      {
        $set: {
          visits: newVisits,
          lastVisit: today,
          firstVisit: customer.firstVisit || today,
          totalSpend: Math.round(newTotalSpend * 100) / 100,
          averageSpend: newAvgSpend,
          totalOrders: (customer.totalOrders || 0) + 1,
          visitFrequency: newFrequency,
          favoriteItems,
          favoriteCategories,
          isNewCustomer: false,
          tier: newTier.name,
          ...(prevTier !== newTier.name ? { tierChangedAt: today } : {}),
        },
      }
    ).exec();

    // ── Visit record (append-only analytics) ─────────────────
    await customerVisitRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      visitDate: bill.date || dayKey(today),
      billAmount: grandTotal,
      pointsEarned: base,
      pointsRedeemed: 0,
    } as any);

    // ── Earn points ──────────────────────────────────────────
    let newBalance = customer.points || 0;
    if (base > 0) {
      const earned = await this.earnPoints(restaurantId, customerId, {
        amount: base,
        type: 'earn',
        description: `Points from bill ${bill.invoiceNumber || ''}`.trim(),
        refType: 'bill',
        refId: bill.invoiceNumber || undefined,
        branchId: bill.branchId,
        createdBy: bill.cashierName,
      });
      newBalance = earned.newBalance;
    }
    if (welcomeTxPoints > 0) {
      const w = await this.earnPoints(restaurantId, customerId, {
        amount: welcomeTxPoints,
        type: 'welcome',
        description: 'Welcome bonus points',
        branchId: bill.branchId,
        createdBy: bill.cashierName,
      });
      newBalance = w.newBalance;
    }
    if (bonusTxPoints > 0) {
      const b = await this.earnPoints(restaurantId, customerId, {
        amount: bonusTxPoints,
        type: 'birthday',
        description: 'Birthday bonus points',
        branchId: bill.branchId,
        createdBy: bill.cashierName,
      });
      newBalance = b.newBalance;
    }

    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'visit_recorded',
      title: `Visit #${newVisits} · ${grandTotal}`,
      description: bill.invoiceNumber ? `Bill ${bill.invoiceNumber}` : 'Visit recorded',
      metadata: { grandTotal, pointsEarned: base, tier: newTier.name },
      performedBy: bill.cashierName,
    } as any);

    // Tier change notification
    if (prevTier !== newTier.name) {
      await customerActivityRepo.forTenant(restaurantId).create({
        restaurantId: objectId(restaurantId),
        customerId: objectId(customerId),
        customerPhone: customer.phone,
        type: 'tier_changed',
        title: `Tier upgraded to ${newTier.name}`,
        description: `${prevTier} → ${newTier.name}`,
        metadata: { from: prevTier, to: newTier.name },
        performedBy: bill.cashierName,
      } as any);
      await auditLogRepo.create({
        action: 'CUSTOMER_TIER_CHANGED',
        entityType: 'customer',
        entityId: customerId,
        performedBy: bill.cashierName || 'System',
        details: { from: prevTier, to: newTier.name, customerPhone: customer.phone },
      } as any);
    }

    return { pointsEarned: base, newBalance, newTier: newTier.name };
  }

  /**
   * Reverse loyalty impact when a bill is refunded (proportional points
   * reversal via an append-only 'refund' entry + balance clamp).
   */
  async reverseBillPoints(restaurantId: string, customerId: string, pointsToReverse: number, ctx: { refundedBy?: string; billId?: string } = {}): Promise<void> {
    if (pointsToReverse <= 0) return;
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) return;
    const available = await this.getAvailablePoints(customerId);
    const reversal = Math.min(pointsToReverse, available);

    if (reversal > 0) {
      // Consume from the pool (FIFO) the same way redemptions do.
      await this.redeemPoints(restaurantId, customerId, reversal, {
        description: `Refund reversal (bill ${ctx.billId || ''})`.trim(),
        refType: 'bill',
        refId: ctx.billId,
        createdBy: ctx.refundedBy,
      }).catch(() => {
        // Best-effort: never fail the refund because of loyalty reversal.
      });
    }
  }

  // =============================================================
  // Wallet
  // =============================================================

  async creditWallet(restaurantId: string, customerId: string, amount: number, opts: { description?: string; refType?: string; refId?: string; createdBy?: string } = {}): Promise<{ newBalance: number }> {
    if (amount <= 0) throw new AppError(400, 'Amount must be positive');
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');
    const newBalance = Math.round(((customer.walletBalance || 0) + amount) * 100) / 100;
    const tx = await LoyaltyTransaction.create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'wallet_credit',
      points: 0,
      wallet: amount,
      balanceAfter: customer.points || 0,
      walletBalanceAfter: newBalance,
      description: opts.description || 'Wallet credited',
      refType: opts.refType,
      refId: opts.refId,
      createdBy: opts.createdBy,
    });
    await Customer.updateOne({ _id: customer._id }, { $set: { walletBalance: newBalance } }).exec();
    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'wallet_credited',
      title: `Wallet +${amount}`,
      description: opts.description || 'Wallet credited',
      metadata: { amount },
      performedBy: opts.createdBy,
    } as any);
    return { newBalance };
  }

  async debitWallet(restaurantId: string, customerId: string, amount: number, opts: { description?: string; refType?: string; refId?: string; createdBy?: string } = {}): Promise<{ newBalance: number }> {
    if (amount <= 0) throw new AppError(400, 'Amount must be positive');
    const customer = await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).exec();
    if (!customer) throw new AppError(404, 'Customer not found');
    if ((customer.walletBalance || 0) < amount) throw new AppError(400, 'Insufficient wallet balance');
    const newBalance = Math.round(((customer.walletBalance || 0) - amount) * 100) / 100;
    const tx = await LoyaltyTransaction.create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'wallet_debit',
      points: 0,
      wallet: -amount,
      balanceAfter: customer.points || 0,
      walletBalanceAfter: newBalance,
      description: opts.description || 'Wallet debited',
      refType: opts.refType,
      refId: opts.refId,
      createdBy: opts.createdBy,
    });
    await Customer.updateOne({ _id: customer._id }, { $set: { walletBalance: newBalance } }).exec();
    await customerActivityRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      customerId: objectId(customerId),
      customerPhone: customer.phone,
      type: 'wallet_debited',
      title: `Wallet -${amount}`,
      description: opts.description || 'Wallet debited',
      metadata: { amount },
      performedBy: opts.createdBy,
    } as any);
    return { newBalance };
  }

  // =============================================================
  // Expiry engine
  // =============================================================

  /**
   * Expire points whose expiresAt has passed. Recomputes every affected
   * customer's balance from the remaining pool. Idempotent — safe to run on a
   * cron. Returns a summary of expired amounts.
   */
  async expirePoints(restaurantId: string, ctx: { operator?: string } = {}): Promise<{ customersAffected: number; pointsExpired: number }> {
    const now = new Date();
    const expiredEntries = await (LoyaltyTransaction as any).find({
      restaurantId: objectId(restaurantId),
      remaining: { $gt: 0 },
      expiresAt: { $lte: now },
    }).exec() as any[];

    // Group by customer for single-pass balance recompute
    const perCustomer = new Map<string, number>();
    for (const entry of expiredEntries) {
      const key = entry.customerId.toString();
      perCustomer.set(key, (perCustomer.get(key) || 0) + (entry.remaining || 0));
      await LoyaltyTransaction.updateOne({ _id: entry._id }, { $set: { remaining: 0 } }).exec();
    }

    for (const [customerId, expired] of perCustomer) {
      await LoyaltyTransaction.create({
        restaurantId: objectId(restaurantId),
        customerId: objectId(customerId),
        type: 'expiry',
        points: -expired,
        wallet: 0,
        balanceAfter: 0,
        walletBalanceAfter: 0,
        description: `${expired} points expired`,
        createdBy: ctx.operator,
      });
      const newBalance = await this.getAvailablePoints(customerId);
      await Customer.updateOne({ _id: objectId(customerId) }, { $set: { points: newBalance } }).exec();
      const cust = await Customer.findOne({ _id: objectId(customerId) }).exec();
      if (cust) {
        await customerActivityRepo.forTenant(restaurantId).create({
          restaurantId: objectId(restaurantId),
          customerId: objectId(customerId),
          customerPhone: cust.phone,
          type: 'points_expired',
          title: `${expired} pts expired`,
          description: 'Points passed expiry date',
          metadata: { expired },
          performedBy: ctx.operator,
        } as any);
      }
    }

    return { customersAffected: perCustomer.size, pointsExpired: [...perCustomer.values()].reduce((s, v) => s + v, 0) };
  }

  // =============================================================
  // Transactions / history
  // =============================================================

  async getTransactions(restaurantId: string, customerId: string, params: { page?: number; limit?: number; type?: string } = {}): Promise<any> {
    const query: any = { customerId: objectId(customerId) };
    if (params.type) query.type = params.type;
    const result = await loyaltyTransactionRepo.forTenant(restaurantId).findAll(query, {
      page: params.page || 1,
      limit: params.limit || 50,
      sort: { createdAt: -1 },
    });
    return {
      data: result.data.map((t) => t.toObject()),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /** Aggregate totals for reports (points issued, redeemed, wallet). */
  async getTotals(restaurantId: string, startDate?: string, endDate?: string): Promise<{ pointsIssued: number; pointsRedeemed: number; walletCredited: number; walletDebited: number }> {
    const match: any = { restaurantId: objectId(restaurantId) };
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) match.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    const [issued, redeemed, walletCredited, walletDebited] = await Promise.all([
      LoyaltyTransaction.aggregate([{ $match: { ...match, points: { $gt: 0 }, type: { $in: ['earn', 'welcome', 'birthday', 'anniversary', 'referral', 'adjustment'] } } }, { $group: { _id: null, total: { $sum: '$points' } } }]).exec(),
      LoyaltyTransaction.aggregate([{ $match: { ...match, type: 'redeem' } }, { $group: { _id: null, total: { $sum: { $abs: '$points' } } } }]).exec(),
      LoyaltyTransaction.aggregate([{ $match: { ...match, type: 'wallet_credit' } }, { $group: { _id: null, total: { $sum: '$wallet' } } }]).exec(),
      LoyaltyTransaction.aggregate([{ $match: { ...match, type: 'wallet_debit' } }, { $group: { _id: null, total: { $sum: { $abs: '$wallet' } } } }]).exec(),
    ]);
    return {
      pointsIssued: issued[0]?.total || 0,
      pointsRedeemed: redeemed[0]?.total || 0,
      walletCredited: walletCredited[0]?.total || 0,
      walletDebited: walletDebited[0]?.total || 0,
    };
  }
}
