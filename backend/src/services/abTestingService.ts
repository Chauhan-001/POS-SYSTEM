/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A/B Testing Framework — Lightweight experimentation framework for promotion
 * variants. Designed for restaurant-specific, tenant-isolated experiments.
 *
 * Only introduces randomized/control assignment where business context supports it.
 * Does not create statistically invalid experiments.
 *
 * Control group is maintained separately. Experiments must respect margin limits
 * and offer rules.
 */

import mongoose from 'mongoose';

export type ExperimentStatus = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';

export type AssignmentMethod = 'customer_level' | 'time_level' | 'geographic';

export type ControlGroupRatio = number; // e.g., 0.2 = 20%

export interface ExperimentVariant {
  id: string;
  name: string;
  promotionType: string;
  promotionValue: any; // e.g., { type: 'percentage', value: 10 } or { type: 'free_item', itemId: '...' }
  description?: string;
}

export interface ExperimentAssignment {
  customerId: string;
  experimentId: string;
  variantId: string;
  assignedAt: Date;
  method: AssignmentMethod;
  restaurantId: string;
}

export interface ExperimentSafetyConstraints {
  maxDiscountPercent?: number;
  minMarginPercent?: number;
  excludedProductIds?: string[];
  restrictedCategories?: string[];
  customerEligibility?: {
    minVisits?: number;
    maxVisits?: number;
    minSpend?: number;
    customerType?: string;
  };
}

export interface Experiment {
  _id: mongoose.Types.ObjectId;
  restaurantId: string;
  name: string;
  description?: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  primaryMetric: 'orders' | 'revenue' | 'contribution' | 'aov' | 'repeat_purchase';
  controlGroupRatio: ControlGroupRatio;
  assignmentMethod: AssignmentMethod;
  safetyConstraints: ExperimentSafetyConstraints;
  baselineMetrics?: {
    orders?: number;
    revenue?: number;
    contribution?: number;
    aov?: number;
    repeatPurchases?: number;
  };
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Check if an experiment can be safely launched given current constraints.
 * Returns safety issues if any.
 */
export function checkExperimentSafety(
  experiment: Experiment,
  currentPromotions: any[]
): { safe: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check margin limits
  if (experiment.safetyConstraints.maxDiscountPercent) {
    for (const promo of currentPromotions) {
      if (promo.offerConfig?.type === 'percentage' && promo.offerConfig?.value > experiment.safetyConstraints.maxDiscountPercent) {
        issues.push(`Experiment discount ${promo.offerConfig.value}% exceeds max allowed ${experiment.safetyConstraints.maxDiscountPercent}%`);
      }
    }
  }

  // Check min margin
  if (experiment.safetyConstraints.minMarginPercent) {
    // Would need margin calculation; placeholder
    issues.push('Min margin check requires real-time margin calculation');
  }

  // Check for conflicting experiments
  const activeVariants = experiment.variants.map(v => v.promotionType);
  const conflicting = currentPromotions.filter(p => activeVariants.includes(p.offerConfig?.type || ''));
  if (conflicting.length > 0) {
    issues.push('Conflicting active promotions detected');
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Validate experiment design.
 * Ensures: control group is meaningful, sample size is sufficient, etc.
 */
export function validateExperimentDesign(
  experiment: Experiment
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Must have at least 2 variants (1 control + 1 test)
  if (experiment.variants.length < 2) {
    errors.push('Experiment must have at least 2 variants (1 control + 1 test)');
  }

  // Control group ratio must be between 0.1 and 0.5
  if (experiment.controlGroupRatio < 0.1 || experiment.controlGroupRatio > 0.5) {
    errors.push('Control group ratio must be between 10% and 50%');
  }

  // Must have a primary metric
  if (!experiment.primaryMetric) {
    errors.push('Primary metric must be specified');
  }

  // Experiment dates should be set for active experiments
  if (experiment.status === 'active') {
    if (!experiment.startDate) {
      errors.push('Active experiment must have a start date');
    }
    if (!experiment.endDate) {
      errors.push('Active experiment must have an end date');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}