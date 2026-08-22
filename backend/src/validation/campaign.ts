import { z } from 'zod';
import { nonEmptyString, optString, objectId } from './common';

export const createCampaignSchema = z.object({
  name: nonEmptyString.max(120),
  description: optString,
  offerId: objectId.optional(),
  audience: z.object({
    segmentIds: z.array(z.string().max(50)).default([]),
    customerPhones: z.array(z.string().regex(/^\d{10}$/)).default([]),
  }).default({ segmentIds: [], customerPhones: [] }),
  template: z.object({
    channel: z.enum(['sms', 'whatsapp', 'email', 'app_notification', 'webhook', 'website']),
    subject: optString,
    message: nonEmptyString.max(5000),
  }),
  schedule: z.object({
    mode: z.enum(['immediate', 'scheduled']).default('immediate'),
    scheduledAt: z.string().datetime().optional(),
  }).default({ mode: 'immediate', scheduledAt: undefined }),
});

export const updateCampaignSchema = createCampaignSchema.partial();

export const campaignParamsSchema = z.object({
  id: objectId,
}).strict();

export const campaignStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'partial']),
}).strict();

export const campaignQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'partial']).optional(),
}).optional();

/**
 * Phase 6: CampaignProposal validation schemas
 */

export type CampaignProposalApprovalStatus =
  | 'pending'
  | 'validating'
  | 'ready_for_approval'
  | 'approved'
  | 'rejected';

export type CampaignProposalExecutionStatus =
  | 'pending'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'measured';

export type CampaignProposalStatusTransition =
  | 'start_validation'
  | 'validation_passed'
  | 'validation_failed'
  | 'approve'
  | 'reject'
  | 'schedule'
  | 'cancel'
  | 'activate'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'measure'
  | 'expire'
  | 'fail';

export const createCampaignProposalSchema = z.object({
  name: nonEmptyString.max(200),
  description: optString,
  objective: z.enum([
    'INCREASE_AOV', 'INCREASE_ORDERS', 'FILL_SLOW_HOURS', 'INCREASE_REPEAT_VISITS',
    'REACTIVATE_CUSTOMERS', 'PROMOTE_NEW_ITEM', 'INCREASE_ADDON_ATTACHMENT',
    'REDUCE_EXCESS_INVENTORY', 'REDUCE_WASTAGE', 'INCREASE_HIGH_MARGIN_SALES', 'PROTECT_HIGH_PERFORMERS'
  ]),
  strategy: z.enum([
    'COMBO', 'DISCOUNT', 'FREE_ITEM', 'ADDON', 'CROSS_SELL',
    'LOYALTY_REWARD', 'REACTIVATION', 'TIME_BASED', 'CATEGORY_PROMOTION'
  ]),
  offerId: objectId.optional(),
  comboId: objectId.optional(),
  audience: z.object({
    segmentIds: z.array(z.string().max(50)).default([]),
    segmentNames: z.array(z.string().max(100)).default([]),
    customerPhones: z.array(z.string().regex(/^\d{10}$/)).default([]),
    excludedProductIds: z.array(z.string().max(50)).default([]),
    excludedSegmentIds: z.array(z.string().max(50)).default([]),
  }).default({ segmentIds: [], segmentNames: [], customerPhones: [], excludedProductIds: [], excludedSegmentIds: [] }),
  schedule: z.object({
    mode: z.enum(['immediate', 'scheduled']).default('immediate'),
    scheduledAt: z.string().datetime().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
    quietPeriods: z.array(z.object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })).default([]),
  }).default({
    mode: 'immediate', scheduledAt: undefined, startDate: undefined, endDate: undefined,
    daysOfWeek: [], startHour: undefined, endHour: undefined, quietPeriods: []
  }),
  channels: z.array(z.enum(['sms', 'whatsapp', 'email', 'app_notification', 'webhook'])).default([]),
  budgetLimits: z.object({
    maxDiscountPercent: z.number().int().min(0).max(100).optional(),
    maxDiscountAmount: z.number().min(0).optional(),
    maxFreeItems: z.number().int().min(0).default(0),
    maxUses: z.number().int().min(0).optional(),
    maxPerCustomer: z.number().int().min(0).optional(),
    communicationCostCap: z.number().int().min(0).optional(),
  }).default({ maxDiscountPercent: undefined, maxDiscountAmount: undefined, maxFreeItems: 0, maxUses: undefined, maxPerCustomer: undefined, communicationCostCap: undefined }),
  financialModel: z.object({
    totalCost: z.number().default(0),
    discountCost: z.number().default(0),
    communicationCost: z.number().default(0),
    freeItemCost: z.number().default(0),
    expectedRevenue: z.number().default(0),
    expectedIncrementalContribution: z.number().default(0),
    expectedROI: z.number().default(0),
    costBreakdown: z.object({
      discountCost: z.number().default(0),
      communicationCost: z.number().default(0),
      freeItemCost: z.number().default(0),
    }).default({ discountCost: 0, communicationCost: 0, freeItemCost: 0 }),
    confidence: z.enum(['high', 'moderate', 'low']).default('low'),
  }),
  expectedImpact: z.object({
    expectedReach: z.number().int().min(0).default(0),
    expectedRedemptionRate: z.number().min(0).max(100).default(0),
    expectedIncrementalOrders: z.number().int().min(0).default(0),
    expectedAOVImpact: z.number().default(0),
    expectedNewCustomers: z.number().int().min(0).default(0),
    expectedRepeatVisits: z.number().int().min(0).default(0),
  }),
  evidence: z.object({
    elasticityEstimate: z.number().optional(),
    historicalPromotionIds: z.array(z.string()).default([]),
    dataSufficiency: z.enum(['INSUFFICIENT_DATA', 'LOW_CONFIDENCE', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE']).default('INSUFFICIENT_DATA'),
    modelVersion: z.string().default('v1'),
  }),
  risks: z.object({
    marginRisk: z.enum(['low', 'moderate', 'high']).default('moderate'),
    cannibalizationRisk: z.enum(['low', 'moderate', 'high']).default('low'),
    fatigueRisk: z.enum(['low', 'moderate', 'high']).default('low'),
    conflictRisk: z.enum(['low', 'moderate', 'high']).default('low'),
    notes: z.array(z.string()).default([]),
  }),
  approvalStatus: z.enum(['pending', 'validating', 'ready_for_approval', 'approved', 'rejected']).default('pending'),
  executionStatus: z.enum(['pending', 'scheduled', 'active', 'paused', 'completed', 'measured']).default('pending'),
}).strict();

export const updateCampaignProposalSchema = createCampaignProposalSchema.partial();

export const campaignProposalParamsSchema = z.object({
  id: objectId,
}).strict();
