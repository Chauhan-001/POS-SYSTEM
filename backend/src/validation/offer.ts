/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Validation — Zod schemas for all offer API requests.
 */

import { z } from 'zod';

const offerTypeEnum = z.enum([
  'percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback',
  'reward_points', 'coupon', 'festival', 'referral', 'loyalty_bonus',
]);

const offerStatusEnum = z.enum([
  'draft', 'active', 'scheduled', 'paused', 'expired', 'cancelled',
]);

export const createOfferSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(2000),
  shortDescription: z.string().max(500).optional(),
  type: offerTypeEnum,
  value: z.number().min(0, 'Value must be >= 0'),
  minOrderValue: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  maxUses: z.number().min(0).optional(),
  maxPerCustomer: z.number().min(0).optional(),
  applicableCategories: z.array(z.string()).optional().default([]),
  applicableProductIds: z.array(z.string()).optional().default([]),
  targetSegmentIds: z.array(z.string()).optional().default([]),
  targetSegmentNames: z.array(z.string()).optional().default([]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  scheduledDate: z.string().optional(),
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  startHour: z.number().min(0).max(23).optional(),
  endHour: z.number().min(0).max(23).optional(),
  freeItemId: z.string().optional(),
  freeItemName: z.string().optional(),
  freeItemQty: z.number().min(1).optional(),
  comboProductIds: z.array(z.string()).optional(),
  comboPrice: z.number().min(0).optional(),
  cashbackValue: z.number().min(0).optional(),
  referrerReward: z.string().optional(),
  refereeReward: z.string().optional(),
  couponCode: z.string().min(3).max(30).optional(),
  targetTier: z.array(z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'])).optional(),
  stackingAllowed: z.boolean().optional().default(true),
  mutuallyExclusiveGroup: z.string().max(50).optional(),
  recommendationSource: z.string().optional(),
  recommendationReason: z.string().optional(),
  estimatedReach: z.number().min(0).optional(),
  expectedImpact: z.string().optional(),
  isAiGenerated: z.boolean().optional().default(false),
  isAutoActivate: z.boolean().optional().default(false),
  status: offerStatusEnum.optional().default('draft'),
  whatsappMessage: z.string().optional(),
  smsMessage: z.string().optional(),
  appNotification: z.string().optional(),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
  imageUrl: z.string().optional(),
  sortOrder: z.number().optional().default(0),
  branchIds: z.array(z.string()).optional().default([]),
}).strict();

export const updateOfferSchema = createOfferSchema.partial();

export const offerQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
}).strict();

export const offerParamsSchema = z.object({
  id: z.string().min(1),
}).strict();

export const updateOfferStatusSchema = z.object({
  status: offerStatusEnum,
}).strict();
