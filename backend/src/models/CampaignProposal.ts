/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CampaignProposal Model — Phase 6: Promotion Orchestration.
 *
 * A CampaignProposal is the intelligence layer between Recommendation and
 * actual Campaign execution. It represents a proposed promotion that has been
 * validated, optimized, and is ready for owner approval.
 *
 * Multi-tenant isolation: All documents are scoped to restaurantId.
 * Client-side authority over campaign state is never trusted — server validates
 * every transition. Backward compatibility with existing Campaign model is preserved.
 *
 * Lifecycle: DRAFT → VALIDATING → READY_FOR_APPROVAL → APPROVED → SCHEDULED → ACTIVE → COMPLETED → MEASURED
 * Failure states: REJECTED | CANCELLED | FAILED | EXPIRED
 *
 * Never overwrites historical data. New entries append. Outcomes are recorded
 * in RecommendationOutcome (Phase 5) after execution.
 *
 * State transition matrix:
 *   DRAFT              → VALIDATING (validation starts)
 *   VALIDATING         → READY_FOR_APPROVAL (validation passes)
 *   VALIDATING         → REJECTED (validation fails, owner rejects)
 *   READY_FOR_APPROVAL → APPROVED (owner approves)
 *   READY_FOR_APPROVAL → REJECTED (owner rejects)
 *   APPROVED           → SCHEDULED (scheduled for execution)
 *   APPROVED           → CANCELLED (owner cancels before schedule)
 *   SCHEDULED          → ACTIVE (execution starts)
 *   ACTIVE             → COMPLETED (execution finished naturally)
 *   ACTIVE → PAUSED    (paused by owner or stop condition)
 *   PAUSED             → ACTIVE (resumed)
 *   PAUSED             → CANCELLED (cancelled while paused)
 *   COMPLETED          → MEASURED (outcomes recorded)
 *   MEASURED           → (terminal)
 *   EXPIRED            → (terminal - schedule endDate passed without action)
 *   FAILED             → (terminal - execution error)
 *
 * Workflow:
 *   System validates → Owner approves → System schedules → System activates →
 *   Campaign runs → System measures → Results fed back into learning.
 *   At any point, owner can reject, cancel, or pause.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CampaignProposalObjective =
  | 'INCREASE_AOV'
  | 'INCREASE_ORDERS'
  | 'FILL_SLOW_HOURS'
  | 'INCREASE_REPEAT_VISITS'
  | 'REACTIVATE_CUSTOMERS'
  | 'PROMOTE_NEW_ITEM'
  | 'INCREASE_ADDON_ATTACHMENT'
  | 'REDUCE_EXCESS_INVENTORY'
  | 'REDUCE_WASTAGE'
  | 'INCREASE_HIGH_MARGIN_SALES'
  | 'PROTECT_HIGH_PERFORMERS';

export type CampaignProposalStrategy =
  | 'COMBO'
  | 'DISCOUNT'
  | 'FREE_ITEM'
  | 'ADDON'
  | 'CROSS_SELL'
  | 'LOYALTY_REWARD'
  | 'REACTIVATION'
  | 'TIME_BASED'
  | 'CATEGORY_PROMOTION';

export type CampaignProposalApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected';

export type CampaignProposalExecutionStatus =
  | 'pending'
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'measured';

export type CampaignProposalChannel = 'sms' | 'whatsapp' | 'email' | 'app_notification' | 'webhook';

export interface ICampaignProposal extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  objective: CampaignProposalObjective;
  strategy: CampaignProposalStrategy;
  offerId?: mongoose.Types.ObjectId; // reference to Offer document
  comboId?: mongoose.Types.ObjectId; // reference to combo product set
  audience: {
    segmentIds: string[];
    segmentNames: string[];
    customerPhones: string[];
    excludedProductIds: string[];
    excludedSegmentIds: string[];
  };
  schedule: {
    mode: 'immediate' | 'scheduled';
    scheduledAt?: Date | null;
    startDate?: Date;
    endDate?: Date;
    daysOfWeek?: number[];
    startHour?: number;
    endHour?: number;
    quietPeriods?: { startHour: number; endHour: number }[];
  };
  channels: CampaignProposalChannel[];
  budgetLimits: {
    maxDiscountPercent?: number;
    maxDiscountAmount?: number;
    maxFreeItems?: number;
    maxUses?: number;
    maxPerCustomer?: number;
    communicationCostCap?: number;
  };
  financialModel: {
    totalCost: number; // computed: discount + communication + free item costs
    discountCost: number;
    communicationCost: number;
    freeItemCost: number;
    expectedRevenue: number;
    expectedIncrementalContribution: number;
    expectedROI: number; // contribution / cost ratio where meaningful
    costBreakdown: {
      discountCost: number;
      communicationCost: number;
      freeItemCost: number;
    };
    confidence: 'high' | 'moderate' | 'low';
  };
  expectedImpact: {
    expectedReach: number;
    expectedRedemptionRate: number;
    expectedIncrementalOrders: number;
    expectedAOVImpact: number;
    expectedNewCustomers: number;
    expectedRepeatVisits: number;
  };
  evidence: {
    elasticityEstimate?: number; // from Phase 4 elasticity service
    historicalPromotionIds: string[]; // IDs of similar past promotions
    dataSufficiency: 'INSUFFICIENT_DATA' | 'LOW_CONFIDENCE' | 'MODERATE_CONFIDENCE' | 'HIGH_CONFIDENCE';
    modelVersion?: string;
  };
  risks: {
    marginRisk: 'low' | 'moderate' | 'high';
    cannibalizationRisk: 'low' | 'moderate' | 'high';
    fatigueRisk: 'low' | 'moderate' | 'high';
    conflictRisk: 'low' | 'moderate' | 'high';
    notes: string[];
  };
  approvalStatus: CampaignProposalApprovalStatus;
  executionStatus: CampaignProposalExecutionStatus;
  validationResult?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    checks: {
      offer: boolean;
      product: boolean;
      inventory: boolean;
      margin: boolean;
      audience: boolean;
      schedule: boolean;
      communication: boolean;
    };
  };
  ownerFeedback?: {
    rating: 'positive' | 'neutral' | 'negative';
    comment?: string;
    categories?: ('too_expensive' | 'already_tried' | 'not_useful' | 'good_idea' | 'other')[];
    recordedAt: Date;
  };
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const campaignProposalSchema = new Schema<ICampaignProposal>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    objective: { type: String, enum: [
      'INCREASE_AOV', 'INCREASE_ORDERS', 'FILL_SLOW_HOURS', 'INCREASE_REPEAT_VISITS',
      'REACTIVATE_CUSTOMERS', 'PROMOTE_NEW_ITEM', 'INCREASE_ADDON_ATTACHMENT',
      'REDUCE_EXCESS_INVENTORY', 'REDUCE_WASTAGE', 'INCREASE_HIGH_MARGIN_SALES', 'PROTECT_HIGH_PERFORMERS'
    ], required: true },
    strategy: { type: String, enum: [
      'COMBO', 'DISCOUNT', 'FREE_ITEM', 'ADDON', 'CROSS_SELL',
      'LOYALTY_REWARD', 'REACTIVATION', 'TIME_BASED', 'CATEGORY_PROMOTION'
    ], required: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', index: true },
    comboId: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
    audience: {
      type: new Schema({
        segmentIds: [{ type: String, trim: true }],
        segmentNames: [{ type: String, trim: true }],
        customerPhones: [{ type: String, trim: true }],
        excludedProductIds: [{ type: String, trim: true }],
        excludedSegmentIds: [{ type: String, trim: true }],
      }, { _id: false }),
      default: () => ({ segmentIds: [], segmentNames: [], customerPhones: [], excludedProductIds: [], excludedSegmentIds: [] }),
    },
    schedule: {
      type: new Schema({
        mode: { type: String, enum: ['immediate', 'scheduled'], default: 'immediate' },
        scheduledAt: { type: Date },
        startDate: { type: Date },
        endDate: { type: Date },
        daysOfWeek: [{ type: Number, min: 0, max: 6 }],
        startHour: { type: Number, min: 0, max: 23 },
        endHour: { type: Number, min: 0, max: 23 },
        quietPeriods: {
          type: new Schema({
            startHour: { type: Number, min: 0, max: 23 },
            endHour: { type: Number, min: 0, max: 23 },
          }, { _id: false }),
        },
      }, { _id: false }),
      default: () => ({ mode: 'immediate', scheduledAt: undefined, startDate: undefined, endDate: undefined, daysOfWeek: [], startHour: undefined, endHour: undefined, quietPeriods: [] }),
    },
    channels: [{ type: String, enum: ['sms', 'whatsapp', 'email', 'app_notification', 'webhook'] }],
    budgetLimits: {
      type: new Schema({
        maxDiscountPercent: { type: Number, min: 0, max: 100 },
        maxDiscountAmount: { type: Number, min: 0 },
        maxFreeItems: { type: Number, default: 0, min: 0 },
        maxUses: { type: Number, min: 0 },
        maxPerCustomer: { type: Number, min: 0 },
        communicationCostCap: { type: Number, min: 0 },
      }, { _id: false }),
      default: () => ({ maxDiscountPercent: undefined, maxDiscountAmount: undefined, maxFreeItems: 0, maxUses: undefined, maxPerCustomer: undefined, communicationCostCap: undefined }),
    },
    financialModel: {
      type: new Schema({
        totalCost: { type: Number, default: 0 },
        discountCost: { type: Number, default: 0 },
        communicationCost: { type: Number, default: 0 },
        freeItemCost: { type: Number, default: 0 },
        expectedRevenue: { type: Number, default: 0 },
        expectedIncrementalContribution: { type: Number, default: 0 },
        expectedROI: { type: Number, default: 0 },
        costBreakdown: {
          type: new Schema({
            discountCost: { type: Number, default: 0 },
            communicationCost: { type: Number, default: 0 },
            freeItemCost: { type: Number, default: 0 },
          }, { _id: false }),
          default: () => ({ discountCost: 0, communicationCost: 0, freeItemCost: 0 }),
        },
        confidence: { type: String, enum: ['high', 'moderate', 'low'], default: 'low' },
      }, { _id: false }),
      default: () => ({
        totalCost: 0,
        discountCost: 0,
        communicationCost: 0,
        freeItemCost: 0,
        expectedRevenue: 0,
        expectedIncrementalContribution: 0,
        expectedROI: 0,
        costBreakdown: { discountCost: 0, communicationCost: 0, freeItemCost: 0 },
        confidence: 'low',
      }),
    },
    expectedImpact: {
      type: new Schema({
        expectedReach: { type: Number, default: 0, min: 0 },
        expectedRedemptionRate: { type: Number, min: 0, max: 100, default: 0 },
        expectedIncrementalOrders: { type: Number, default: 0, min: 0 },
        expectedAOVImpact: { type: Number, default: 0 },
        expectedNewCustomers: { type: Number, default: 0, min: 0 },
        expectedRepeatVisits: { type: Number, default: 0, min: 0 },
      }, { _id: false }),
      default: () => ({
        expectedReach: 0,
        expectedRedemptionRate: 0,
        expectedIncrementalOrders: 0,
        expectedAOVImpact: 0,
        expectedNewCustomers: 0,
        expectedRepeatVisits: 0,
      }),
    },
    evidence: {
      type: new Schema({
        elasticityEstimate: { type: Number },
        historicalPromotionIds: [{ type: String }],
        dataSufficiency: { type: String, enum: ['INSUFFICIENT_DATA', 'LOW_CONFIDENCE', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'], default: 'INSUFFICIENT_DATA' },
        modelVersion: { type: String, default: 'v1' },
      }, { _id: false }),
      default: () => ({
        elasticityEstimate: undefined,
        historicalPromotionIds: [],
        dataSufficiency: 'INSUFFICIENT_DATA',
        modelVersion: 'v1',
      }),
    },
    risks: {
      type: new Schema({
        marginRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'moderate' },
        cannibalizationRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
        fatigueRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
        conflictRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
        notes: [{ type: String, default: [] }],
      }, { _id: false }),
      default: () => ({
        marginRisk: 'moderate',
        cannibalizationRisk: 'low',
        fatigueRisk: 'low',
        conflictRisk: 'low',
        notes: [],
      }),
    },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    executionStatus: { type: String, enum: ['pending', 'scheduled', 'active', 'completed', 'measured'], default: 'pending' },
    validationResult: {
      type: new Schema({
        valid: { type: Boolean, default: false },
        errors: [{ type: String, default: [] }],
        warnings: [{ type: String, default: [] }],
        checks: {
          offer: { type: Boolean, default: false },
          product: { type: Boolean, default: false },
          inventory: { type: Boolean, default: false },
          margin: { type: Boolean, default: false },
          audience: { type: Boolean, default: false },
          schedule: { type: Boolean, default: false },
          communication: { type: Boolean, default: false },
        },
      }, { _id: false }),
      default: () => ({
        valid: false,
        errors: [],
        warnings: [],
        checks: {
          offer: false,
          product: false,
          inventory: false,
          margin: false,
          audience: false,
          schedule: false,
          communication: false,
        },
      }),
    },
    ownerFeedback: {
      type: new Schema({
        rating: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
        comment: { type: String },
        categories: [{ type: String, enum: ['too_expensive', 'already_tried', 'not_useful', 'good_idea', 'other'], default: [] }],
        recordedAt: { type: Date, default: Date.now },
      }, { _id: false }),
      default: () => ({ rating: 'neutral', comment: undefined, categories: [], recordedAt: new Date() }),
    },
  },
  { timestamps: true }
);

// ─── State machine transitions ───────────────────────────────────────────

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

const CAMPAIGN_PROPOSAL_APPROVAL_TRANSITIONS: Record<CampaignProposalApprovalStatus, CampaignProposalApprovalStatus[]> = {
  pending: ['validating'],
  validating: ['ready_for_approval', 'rejected'],
  ready_for_approval: ['approved', 'rejected'],
  approved: ['scheduled', 'cancelled'],
  rejected: [], // terminal
};

const CAMPAIGN_PROPOSAL_EXECUTION_TRANSITIONS: Record<CampaignProposalExecutionStatus, CampaignProposalExecutionStatus[]> = {
  pending: ['scheduled', 'cancelled'],
  scheduled: ['active', 'cancelled'],
  active: ['completed', 'paused', 'failed'],
  paused: ['active', 'cancelled'],
  completed: [], // terminal
  measured: [], // terminal
};

/** Whether an approval-status transition from → to is allowed. */
export function canApproveTransition(
  from: CampaignProposalApprovalStatus,
  to: CampaignProposalApprovalStatus,
): boolean {
  const allowed = CAMPAIGN_PROPOSAL_APPROVAL_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/** Whether an execution-status transition from → to is allowed. */
export function canExecuteTransition(
  from: CampaignProposalExecutionStatus,
  to: CampaignProposalExecutionStatus,
): boolean {
  const allowed = CAMPAIGN_PROPOSAL_EXECUTION_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/** Whether a proposal-internal transition from → to is allowed (combined view). */
export function canTransition(
  from: CampaignProposalApprovalStatus | CampaignProposalExecutionStatus,
  to: CampaignProposalApprovalStatus | CampaignProposalExecutionStatus,
): boolean {
  // If both are approval statuses
  if (
    typeof from === 'string' &&
    typeof to === 'string' &&
    CAMPAIGN_PROPOSAL_APPROVAL_TRANSITIONS[from as CampaignProposalApprovalStatus]
  ) {
    return CAMPAIGN_PROPOSAL_APPROVAL_TRANSITIONS[from as CampaignProposalApprovalStatus].includes(to as CampaignProposalApprovalStatus);
  }
  // If both are execution statuses
  if (
    typeof from === 'string' &&
    typeof to === 'string' &&
    CAMPAIGN_PROPOSAL_EXECUTION_TRANSITIONS[from as CampaignProposalExecutionStatus]
  ) {
    return CAMPAIGN_PROPOSAL_EXECUTION_TRANSITIONS[from as CampaignProposalExecutionStatus].includes(to as CampaignProposalExecutionStatus);
  }
  // Cross-transition: from approval to execution (e.g. approved → scheduled)
  if (
    typeof from === 'string' &&
    typeof to === 'string' &&
    from === 'approved' &&
    to === 'scheduled'
  ) {
    return true;
  }
  // Cross-transition: from execution to approval (shouldn't normally happen but be safe)
  if (
    typeof from === 'string' &&
    typeof to === 'string' &&
    from === 'active' &&
    to === 'ready_for_approval'
  ) {
    return false; // cannot go back to approval once active
  }
  return false;
}

// Indexes for tenant isolation and common query patterns
campaignProposalSchema.index({ restaurantId: 1, approvalStatus: 1, createdAt: -1 });
campaignProposalSchema.index({ restaurantId: 1, strategy: 1, approvalStatus: 1 });
campaignProposalSchema.index({ restaurantId: 1, executionStatus: 1 });
campaignProposalSchema.index({ restaurantId: 1, objective: 1 });
campaignProposalSchema.index({ 'audience.segmentIds': 1 });
campaignProposalSchema.index({ 'schedule.scheduledAt': 1, approvalStatus: 1 });

export interface ICampaignProposalDocument extends ICampaignProposal {
  validateCampaignProposal(): Promise<{ valid: boolean; errors: string[]; warnings: string[] }>;
}

campaignProposalSchema.methods.validateCampaignProposal = async function thisFunction(
  this: ICampaignProposal & Document
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const proposal = this.toObject();
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── Offer validation ───
  if (!proposal.offerId) {
    errors.push('Offer is required');
  } else {
    const Offer = (await import('../models/Offer')).default;
    const offer = await Offer.findById(proposal.offerId);
    if (!offer) {
      errors.push('Offer not found');
    } else {
      // Offer exists and is valid
      if (offer.status !== 'active' && offer.status !== 'scheduled') {
        errors.push('Offer is not in active or scheduled status');
      }
      // Check discount constraints
      if (offer.type === 'percentage' && (offer.maxDiscount === undefined || offer.maxDiscount === null)) {
        // Will be checked against maxDiscountPercent from budgetLimits
      }
      if (offer.maxUses && proposal.budgetLimits?.maxUses) {
        if (offer.currentUses >= offer.maxUses) {
          errors.push('Offer has reached its maximum uses');
        }
      }
    }
  }
  if (proposal.comboId) {
    const Product = (await import('../models/Product')).default;
    const comboProduct = await Product.findById(proposal.comboId);
    if (!comboProduct) {
      errors.push('Combo product not found');
    } else if (comboProduct.isDeleted) {
      errors.push('Combo product is deleted');
    }
  }

  // ─── Inventory validation ───
  // Check if sufficient inventory for the offer products
  if (proposal.offerId) {
    const OfferModel = (await import('../models/Offer')).default;
    const offer = await OfferModel.findById(proposal.offerId);
    if (offer && offer.applicableProductIds && offer.applicableProductIds.length > 0) {
      for (const productId of offer.applicableProductIds) {
        const ProductModel = (await import('../models/Product')).default;
        const product = await ProductModel.findById(productId);
        if (product && product.currentStock <= 0) {
          warnings.push(`Product ${product.name || productId} has no stock`);
        }
      }
    }
  }

  // ─── Margin validation ───
  if (proposal.financialModel) {
    const { expectedIncrementalContribution, totalCost, discountCost, communicationCost, freeItemCost } = proposal.financialModel;
    if (totalCost > 0 && expectedIncrementalContribution > 0) {
      const contributionRatio = expectedIncrementalContribution / totalCost;
      if (contributionRatio < 0.3) {
        warnings.push('Low contribution ratio: contribution is less than 30% of total cost');
      }
    }
    // Check max discount percent constraint
    if (proposal.budgetLimits?.maxDiscountPercent !== undefined) {
      if (proposal.offerId) {
        const OfferModel = (await import('../models/Offer')).default;
        const offer = await OfferModel.findById(proposal.offerId);
        if (offer && offer.type === 'percentage' && offer.value > proposal.budgetLimits.maxDiscountPercent) {
          errors.push(`Offer discount ${offer.value}% exceeds max allowed ${proposal.budgetLimits.maxDiscountPercent}%`);
        }
      }
    }
  }

  // ─── Audience validation ───
  const audience = proposal.audience;
  if (audience.customerPhones.length === 0 && audience.segmentIds.length === 0) {
    errors.push('Audience must have at least one segment or customer phone');
  }

  // Check for conflicting exclusions
  if (audience.excludedProductIds && audience.excludedProductIds.length > 0) {
    warnings.push('Campaign has excluded products - this may significantly reduce audience size');
  }
  if (audience.excludedSegmentIds && audience.excludedSegmentIds.length > 0) {
    warnings.push('Campaign has excluded segments - this may significantly reduce audience size');
  }

  // ─── Schedule validation ───
  const schedule = proposal.schedule;
  if (schedule.mode === 'scheduled') {
    if (!schedule.startDate) {
      errors.push('Scheduled campaign must have a start date');
    }
    if (!schedule.endDate) {
      errors.push('Scheduled campaign must have an end date');
    } else if (schedule.startDate && schedule.endDate && new Date(schedule.startDate) > new Date(schedule.endDate)) {
      errors.push('Start date must be before end date');
    }
    // Check quiet periods
    if (schedule.quietPeriods && schedule.quietPeriods.length > 0) {
      // Validate quiet period times
      for (const qp of schedule.quietPeriods) {
        if (qp.startHour >= qp.endHour) {
          errors.push('Quiet period start hour must be before end hour');
        }
      }
    }
  }

  // ─── Communication validation ───
  if (!proposal.channels || proposal.channels.length === 0) {
    errors.push('At least one communication channel must be selected');
  } else {
    for (const channel of proposal.channels) {
      switch (channel) {
        case 'whatsapp':
          if (!proposal.template?.message) {
            errors.push('WhatsApp template message is required');
          }
          break;
        case 'sms':
          if (!proposal.template?.message) {
            errors.push('SMS template message is required');
          }
          break;
        case 'email':
          if (!proposal.template?.subject) {
            errors.push('Email subject is required');
          }
          if (!proposal.template?.message) {
            errors.push('Email body/message is required');
          }
          break;
      }
    }
  }

  // ─── Budget/limits validation ───
  if (proposal.budgetLimits) {
    if (proposal.budgetLimits.maxDiscountPercent !== undefined && (proposal.budgetLimits.maxDiscountPercent < 0 || proposal.budgetLimits.maxDiscountPercent > 100)) {
      errors.push('Max discount percent must be between 0 and 100');
    }
    if (proposal.budgetLimits.communicationCostCap !== undefined && proposal.budgetLimits.communicationCostCap < 0) {
      errors.push('Communication cost cap must be non-negative');
    }
  }

  // ─── Expected impact validation ───
  if (proposal.expectedImpact) {
    const { expectedReach, expectedRedemptionRate, expectedIncrementalOrders, expectedAOVImpact, expectedNewCustomers, expectedRepeatVisits } = proposal.expectedImpact;
    if (expectedReach <= 0) {
      errors.push('Expected reach must be greater than 0');
    }
    if (expectedRedemptionRate !== undefined && (expectedRedemptionRate < 0 || expectedRedemptionRate > 100)) {
      errors.push('Expected redemption rate must be between 0 and 100');
    }
    if (expectedIncrementalOrders < 0) {
      errors.push('Expected incremental orders must be non-negative');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

export const CampaignProposal = mongoose.model<ICampaignProposal>('CampaignProposal', campaignProposalSchema);
export default CampaignProposal;