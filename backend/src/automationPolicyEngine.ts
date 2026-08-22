/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AutomationPolicyEngine — Policy layer that defines hard boundaries around automation.
 *
 * This is the critical governance layer that the AI cannot modify.
 * Owner configures policy → AI must respect it.
 *
 * Policy structure:
 *   allowedStrategyTypes - which strategy types are permitted
 *   maximumDiscount      - max % discount allowed
 *   minimumMargin        - min contribution margin %
 *   maximumFrequency     - max promotions per day per restaurant
 *   allowedProducts      - which product IDs can be promoted
 *   allowedCustomerSegments - which segments can be targeted
 *   allowedChannels      - which communication channels are allowed
 *   maximumBudget        - max budget for automated promotions
 *   quietHours           - hours when no automation runs
 *   approvalRequirement  - none | owner | manager
 */

import mongoose from 'mongoose';
import type { AutomationPolicy, AutomationLevel, BusinessObjective } from '../services/restaurantIntelligenceOrchestrator';
import type { RecommendationContext } from './recommendationContext';
import type { StrategyKey, StrategyDefinition } from '../services/restaurantIntelligenceOrchestrator';

/**
 * Default automation policy values
 */
export const DEFAULT_POLICY: AutomationPolicy = {
  allowedStrategyTypes: [
    'SLOW_HOUR_COMBO',
    'REACTIVATION_FREE_ITEM',
    'AOV_ADDON',
    'HIGH_MARGIN_CROSS_SELL',
    'SAFE_INVENTORY_PROMOTION',
  ],
  maximumDiscount: 15,
  minimumMargin: 25,
  maximumFrequency: 3, // max 3 promotions per day
  allowedProducts: [],
  allowedCustomerSegments: [],
  allowedChannels: ['in_app', 'whatsapp', 'email'],
  maximumBudget: 10000,
  quietHours: { start: 12, end: 14 }, // No automation during 12-2 PM lunch rush
  approvalRequirement: 'owner',
};

/**
 * Validate a promotion against the automation policy
 * Returns: { valid, violations, adjustedDiscount, adjustedMargin }
 */
export function validateAgainstPolicy(
  discountPercent: number,
  contributionMarginPercent: number,
  productId?: string,
  customerSegment?: string,
  strategyKey?: StrategyKey,
  policy: AutomationPolicy = DEFAULT_POLICY
): {
  valid: boolean;
  violations: string[];
  adjustedDiscount: number;
  adjustedMargin: number;
} {
  const violations: string[] = [];
  let adjustedDiscount = discountPercent;
  let adjustedMargin = contributionMarginPercent;

  // 1. Check maximum discount
  if (discountPercent > policy.maximumDiscount) {
    violations.push(
      `Discount ${discountPercent}% exceeds maximum ${policy.maximumDiscount}%. ` +
      `Auto-adjusted to ${policy.maximumDiscount}%.`
    );
    adjustedDiscount = policy.maximumDiscount;
  }

  // 2. Check minimum margin
  if (contributionMarginPercent < policy.minimumMargin) {
    violations.push(
      `Margin ${contributionMarginPercent}% below minimum ${policy.minimumMargin}%. ` +
      `Promotion blocked.`
    );
    // Cannot validate - margin too thin
    adjustedMargin = contributionMarginPercent;
  }

  // 3. Check strategy type eligibility
  if (strategyKey && !policy.allowedStrategyTypes.includes(strategyKey)) {
    violations.push(
      `Strategy type "${strategyKey}" is not in allowed types: ${policy.allowedStrategyTypes.join(', ')}`
    );
  }

  // 4. Check quiet hours
  const now = new Date();
  const currentHour = now.getHours();
  if (policy.quietHours && currentHour >= policy.quietHours.start && currentHour < policy.quietHours.end) {
    violations.push(
      `Current time ${currentHour}:00 is within quiet hours (${policy.quietHours.start}-${policy.quietHours.end} PM). ` +
      `Automation paused.`
    );
  }

  // 5. Check maximum frequency
  // (Would need to track per-day count - placeholder for now)
  // if (policy.maximumFrequency) { ... }

  // 6. Check allowed products
  if (productId && policy.allowedProducts.length > 0) {
    if (!policy.allowedProducts.includes(productId)) {
      violations.push(
        `Product ${productId} is not in allowed products list.`
      );
    }
  }

  // 7. Check allowed customer segments
  if (customerSegment && policy.allowedCustomerSegments.length > 0) {
    if (!policy.allowedCustomerSegments.includes(customerSegment)) {
      violations.push(
        `Segment ${customerSegment} is not in allowed segments.`
      );
    }
  }

  const valid = violations.length === 0;

  return {
    valid,
    violations,
    adjustedDiscount,
    adjustedMargin,
  };
}

/**
 * Validate a recommendation/offer against the automation policy
 * Used before persisting or executing an automated action
 */
export function validateRecommendationAgainstPolicy(
  recommendation: any,
  policy: AutomationPolicy = DEFAULT_POLICY
): {
  valid: boolean;
  violations: string[];
  policyCompliantDiscount: number;
  policyCompliantMargin: number;
} {
    const violations: string[] = [];
    let policyCompliantDiscount = recommendation.economics?.discount || 0;
    let policyCompliantMargin = recommendation.economics?.marginPercent || 100;

    // Extract discount and margin from recommendation
    const discount = recommendation.economics?.discount
      || (recommendation.offerSuggestion?.value && typeof recommendation.offerSuggestion.value === 'number'
        ? recommendation.offerSuggestion.value
        : 0);
    const margin = recommendation.economics?.marginPercent
      || (recommendation.offerSuggestion?.type !== 'percentage' && recommendation.offerSuggestion?.value !== undefined
        ? 80 // conservative default for flat offers
        : 100);

    // 1. Maximum discount check
    if (discount > policy.maximumDiscount) {
      violations.push(
        `Discount of ${discount}% exceeds maximum ${policy.maximumDiscount}%. ` +
        `Recommendation will be rejected or auto-adjusted.`
      );
      policyCompliantDiscount = policy.maximumDiscount;
    } else {
      policyCompliantDiscount = discount;
    }

    // 2. Minimum margin check
    if (margin < policy.minimumMargin) {
      violations.push(
        `Contribution margin of ${margin}% is below minimum ${policy.minimumMargin}%. ` +
        `Recommendation blocked unless margin can be improved.`
      );
      policyCompliantMargin = margin;
    } else {
      policyCompliantMargin = margin;
    }

    // 3. Strategy type check
    if (recommendation.recommendationType && !policy.allowedStrategyTypes.includes(recommendation.recommendationType)) {
      violations.push(
        `Strategy type "${recommendation.recommendationType}" is not allowed. ` +
        `Allowed types: ${policy.allowedStrategyTypes.join(', ')}`
      );
    }

    // 4. Check for thin-margin warnings (isWarning flag)
    if (recommendation.offerSuggestion?.isWarning) {
      violations.push(
        'Recommendation is a margin warning - not auto-executable. Owner review required.'
      );
    }

    // 5. Check maximum frequency (per day)
    // Placeholder - would integrate with promotion count tracking

    const valid = violations.length === 0;

    return {
      valid,
      violations,
      policyCompliantDiscount: policyCompliantDiscount,
      policyCompliantMargin: policyCompliantMargin,
    };
}

/**
 * Check if an automation level is permitted under the current policy
 */
export function checkAutomationLevel(
  level: AutomationLevel,
  policy: AutomationPolicy
): {
  allowed: boolean;
  restrictions: string[];
  requiredActions: string[];
} {
  const restrictions: string[] = [];
  const requiredActions: string[] = [];

  switch (level.level) {
    case 0: // Advisory only
      restrictions.push('No automated actions - owner must review all recommendations');
      requiredActions.push('Review and accept/reject each recommendation');
      return {
        allowed: false,
        restrictions,
        requiredActions,
      };

    case 1: // Assisted
      restrictions.push('Owner approval required before execution');
      requiredActions.push('Owner must approve each action');
      return {
        allowed: true,
        restrictions,
        requiredActions,
      };

    case 2: // Controlled automation
      // Owner creates rules, system can prepare actions
      if (policy.approvalRequirement === 'manager') {
        restrictions.push('Manager approval required (policy set to manager)');
        requiredActions.push('Manager must approve automated actions');
      }
      if (policy.quietHours) {
        restrictions.push(`Quiet hours (${policy.quietHours.start}-${policy.quietHours.end}) block automation`);
      }
      return {
        allowed: policy.approvalRequirement !== 'none',
        restrictions,
        requiredActions,
      };

    case 3: // Restricted optimization
      // Only predefined strategies from library
      restrictions.push('Only strategies from owner-approved library may auto-execute');
      restrictions.push('AI cannot generate arbitrary promotions');
      restrictions.push('All actions must be from strategy library');
      requiredActions.push('Select from STRATEGY_LIBRARY');
      return {
        allowed: true,
        restrictions,
        requiredActions,
      };

    default:
      return {
        allowed: false,
        restrictions: ['Unknown automation level'],
        requiredActions: [],
      };
  }
}

/**
 * Get policy compliance status for a restaurant
 */
export function getPolicyComplianceStatus(
  restaurantId: string,
  policy: AutomationPolicy
): {
  complianceScore: number; // 0-100
  violationsThisWeek: string[];
  lastViolation?: string;
  recommendationsBlocked: number;
} {
    // In production, this would query the database for actual violations
    // For now, return based on policy configuration

    let complianceScore = 100;
    const violationsThisWeek: string[] = [];
    let recommendationsBlocked = 0;

    // Check policy reasonableness
    if (policy.maximumDiscount > 30) {
      complianceScore -= 10;
      violationsThisWeek.push('Maximum discount exceeds reasonable limit (30%)');
    }

    if (policy.minimumMargin > 35) {
      complianceScore -= 5;
      violationsThisWeek.push('Minimum margin may be too restrictive');
    }

    if (policy.maximumBudget <= 0) {
      complianceScore -= 5;
      violationsThisWeek.push('Maximum budget not configured');
    }

    // Clamp to 0-100
    complianceScore = Math.max(0, Math.min(100, complianceScore));

    return {
      complianceScore,
      violationsThisWeek,
      recommendationsBlocked,
    };
}

/**
 * Policy enforcement middleware concept
 * Used to wrap API endpoints that create promotions/campaigns
 */
export function policyEnforcer(policy: AutomationPolicy) {
    return async function enforce<T>(
      promotionData: {
        discountPercent: number;
        contributionMarginPercent: number;
        strategyKey?: StrategyKey;
        productId?: string;
        customerSegment?: string;
      }
    ): Promise<{
      approved: boolean;
      discountPercent: number;
      marginPercent: number;
      violations: string[];
      message: string;
    }> {
      const result = validateAgainstPolicy(
        promotionData.discountPercent,
        promotionData.contributionMarginPercent,
        promotionData.productId,
        promotionData.customerSegment,
        promotionData.strategyKey,
        policy
      );

      if (result.valid) {
        return {
          approved: true,
          discountPercent: result.adjustedDiscount,
          marginPercent: result.adjustedMargin,
          violations: [],
          message: 'Promotion approved - all policy constraints satisfied',
        };
      }

      // For owner-approved policies, we can still allow with warnings
      // For strict policies, block
      const approval = policy.approvalRequirement;

      let message: string;
      if (approval === 'none') {
        message = `Promotion blocked: ${result.violations.join('; ')}`;
      } else if (approval === 'owner') {
        message = `Promotion requires owner approval: ${result.violations.join('; ')}`;
      } else {
        // manager approval
        message = `Promotion requires manager approval: ${result.violations.join('; ')}`;
      }

      return {
        approved: false,
        discountPercent: result.adjustedDiscount,
        marginPercent: result.adjustedMargin,
        violations: result.violations,
        message,
      };
    };
}