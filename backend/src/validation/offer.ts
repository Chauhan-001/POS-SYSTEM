/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Validation — Zod schemas for all offer API requests.
 *
 * Phase 3 hardening:
 *  - Type-aware value caps (percentage ≤ 100, flat/cashback/coupon ≤ 1,000,000)
 *  - Real date validation (YYYY-MM-DD, startDate ≤ endDate)
 *  - Coupon code format
 *  - Server-side limits for every numeric field — the frontend is never trusted.
 */

import { z } from 'zod';

const offerTypeEnum = z.enum([
  'percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback',
  'reward_points', 'coupon', 'festival', 'referral', 'loyalty_bonus',
]);

const offerStatusEnum = z.enum([
  'draft', 'active', 'scheduled', 'paused', 'expired', 'cancelled',
]);

/** Sensible server-side caps (Phase 3 — never rely on frontend validation). */
const MAX_PERCENT = 100;
const MAX_MONEY = 1_000_000;      // ₹/currency units
const MAX_POINTS = 10_000_000;    // reward_points value
const MAX_USES = 10_000_000;      // maxUses / maxPerCustomer
const MAX_ORDER = 10_000_000;     // minOrderValue

/** YYYY-MM-DD (or full ISO) date string that actually parses to a valid date. */
function isDateString(v: string | undefined): boolean {
  if (!v) return true;
  const t = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
  const d = new Date(t);
  return !Number.isNaN(d.getTime());
}

/**
 * Cross-field checks shared by create + update. Null-safe so a partial patch
 * never crashes on an undefined field. Zod v4 forbids .partial() on schemas
 * that already contain superRefine — hence the base-object + shared-refine split.
 */
function offerRefine(data: any, ctx: z.RefinementCtx): void {
  // ── Type-aware value caps ─────────────────────────────────────
  if (data.type && typeof data.value === 'number') {
    const cap =
      data.type === 'percentage'
        ? MAX_PERCENT
        : data.type === 'reward_points'
          ? MAX_POINTS
          : MAX_MONEY;
    if (data.value > cap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `Value ${data.value} exceeds the maximum allowed (${cap}) for type "${data.type}"`,
      });
    }
  }

  // ── Date sanity: startDate ≤ endDate ──────────────────────────
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }

  // ── Time window sanity ────────────────────────────────────────
  if (typeof data.startHour === 'number' && typeof data.endHour === 'number' && data.startHour >= data.endHour) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endHour'],
      message: 'endHour must be greater than startHour',
    });
  }
}

const offerBaseSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().min(1, 'Description is required').max(2000),
    shortDescription: z.string().max(500).optional(),
    type: offerTypeEnum,
    value: z.number().min(0, 'Value must be >= 0').max(MAX_MONEY),
    minOrderValue: z.number().min(0).max(MAX_ORDER).optional(),
    maxDiscount: z.number().min(0).max(MAX_MONEY).optional(),
    maxUses: z.number().int().min(0).max(MAX_USES).optional(),
    maxPerCustomer: z.number().int().min(0).max(MAX_USES).optional(),
    applicableCategories: z.array(z.string().max(100)).optional().default([]),
    applicableProductIds: z.array(z.string().max(100)).optional().default([]),
    targetSegmentIds: z.array(z.string().max(100)).optional().default([]),
    targetSegmentNames: z.array(z.string().max(100)).optional().default([]),
    startDate: z.string().refine(isDateString, 'startDate must be a valid YYYY-MM-DD date').optional(),
    endDate: z.string().refine(isDateString, 'endDate must be a valid YYYY-MM-DD date').optional(),
    scheduledDate: z.string().refine(isDateString, 'scheduledDate must be a valid YYYY-MM-DD date').optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
    freeItemId: z.string().max(100).optional(),
    freeItemName: z.string().max(200).optional(),
    freeItemQty: z.number().int().min(1).max(10_000).optional(),
    comboProductIds: z.array(z.string().max(100)).max(200).optional(),
    comboPrice: z.number().min(0).max(MAX_MONEY).optional(),
    cashbackValue: z.number().min(0).max(MAX_MONEY).optional(),
    referrerReward: z.string().max(200).optional(),
    refereeReward: z.string().max(200).optional(),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, 'couponCode must be 3-30 chars of A-Z, 0-9, _ or -')
      .optional(),
    targetTier: z.array(z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'])).optional(),
    stackingAllowed: z.boolean().optional().default(true),
    mutuallyExclusiveGroup: z.string().max(50).optional(),
    recommendationSource: z.string().max(60).optional(),
    recommendationReason: z.string().max(500).optional(),
    estimatedReach: z.number().int().min(0).max(100_000_000).optional(),
    expectedImpact: z.string().max(500).optional(),
    isAiGenerated: z.boolean().optional().default(false),
    isAutoActivate: z.boolean().optional().default(false),
    status: offerStatusEnum.optional().default('draft'),
    whatsappMessage: z.string().max(2000).optional(),
    smsMessage: z.string().max(1000).optional(),
    appNotification: z.string().max(1000).optional(),
    emailSubject: z.string().max(300).optional(),
    emailBody: z.string().max(5000).optional(),
    imageUrl: z.string().max(500).optional(),
    sortOrder: z.number().int().optional().default(0),
    branchIds: z.array(z.string().max(100)).optional().default([]),
  })
  .strict();

export const createOfferSchema = offerBaseSchema.superRefine(offerRefine);

export const updateOfferSchema = offerBaseSchema.partial().superRefine(offerRefine);

export const offerQuerySchema = z
  .object({
    status: z.string().max(20).optional(),
    type: z.string().max(40).optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();

export const offerParamsSchema = z
  .object({
    id: z.string().min(1).max(100),
  })
  .strict();

export const updateOfferStatusSchema = z
  .object({
    status: offerStatusEnum,
  })
  .strict();
