import { z } from 'zod';
import { optString, nonEmptyString, objectId, dateString } from './common';

// ─── Loyalty settings ────────────────────────────────────────

export const updateLoyaltySettingsSchema = z.object({
  pointsPerCurrency: z.number().min(0).max(1000).optional(),
  pointsValueInCurrency: z.number().min(1).max(100000).optional(),
  roundOffPoints: z.boolean().optional(),
  minRedemption: z.number().min(0).optional(),
  maxRedemptionPerTransaction: z.number().min(0).optional(),
  dailyRedemptionLimit: z.number().min(0).optional(),
  monthlyRedemptionLimit: z.number().min(0).optional(),
  pointExpiryMode: z.enum(['none', 'rolling', 'fixed', 'annual']).optional(),
  rollingExpiryMonths: z.number().int().min(1).max(120).optional(),
  fixedExpiryDate: dateString.optional(),
  expiryReminderDays: z.array(z.number().int().min(1).max(365)).optional(),
  welcomePoints: z.number().min(0).optional(),
  birthdayBonusPoints: z.number().min(0).optional(),
  anniversaryBonusPoints: z.number().min(0).optional(),
  referralEnabled: z.boolean().optional(),
  referralReferrerPoints: z.number().min(0).optional(),
  referralRefereePoints: z.number().min(0).optional(),
  enableWallet: z.boolean().optional(),
  enableTiers: z.boolean().optional(),
  otpEnabled: z.boolean().optional(),
  largeRewardThreshold: z.number().min(0).optional(),
}).strict();

// ─── Loyalty tiers ───────────────────────────────────────────

export const createLoyaltyTierSchema = z.object({
  name: nonEmptyString.max(50),
  minLifetimeSpend: z.number().min(0).default(0),
  pointsMultiplier: z.number().min(0).max(100).default(1),
  rewardPercent: z.number().min(0).max(100).default(0),
  expiryMonths: z.number().int().min(0).max(120).default(12),
  benefits: z.array(z.string().max(300)).default([]),
  priority: z.number().int().min(0).default(0),
  birthdayRewardPoints: z.number().min(0).default(0),
  anniversaryRewardPoints: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
}).strict();

export const updateLoyaltyTierSchema = createLoyaltyTierSchema.partial();

export const loyaltyParamsSchema = z.object({
  id: objectId,
}).strict();

// ─── Redemption & adjustments ────────────────────────────────

export const redeemPointsSchema = z.object({
  points: z.number().int().min(1).max(100000),
  description: optString,
  refType: z.enum(['bill', 'reward', 'offer', 'referral', 'otp']).optional(),
  refId: optString,
}).strict();

export const redeemRewardSchema = z.object({
  rewardId: objectId,
  otpCode: z.string().regex(/^\d{4,8}$/).optional(),   // required when reward.isLargeReward
}).strict();

export const adjustPointsSchema = z.object({
  points: z.number().int().min(-100000).max(100000),
  reason: nonEmptyString.max(300),
}).strict();

export const walletCreditSchema = z.object({
  amount: z.number().min(0.01),
  description: optString,
}).strict();

export const loyaltyTransactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum([
    'earn', 'welcome', 'birthday', 'anniversary', 'referral', 'adjustment',
    'redeem', 'expiry', 'refund', 'wallet_credit', 'wallet_debit',
  ]).optional(),
}).optional();

export const expiryRunSchema = z.object({}).optional();
