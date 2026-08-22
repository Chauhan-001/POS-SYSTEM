/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpportunityActionMap — Every opportunity should have a defined action space.
 *
 * Example:
 *   LOW_DEMAND
 *   ├── Discount
 *   ├── Combo
 *   ├── Free item
 *   ├── Targeted campaign
 *   └── No action
 *
 *   HIGH_AOV_OPPORTUNITY
 *   ├── Add-on
 *   ├── Combo
 *   ├── Upsell
 *   └── Premium variant
 *
 * This makes the optimization engine systematic rather than ad hoc.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { AutomationPolicy } from '../services/restaurantIntelligenceOrchestrator';
import type { BusinessObjective } from '../businessObjectiveSelector';

/**
 * Opportunity definition with action space
 */
export interface OpportunityActionSpace {
  opportunityType: string;
  description: string;
  actions: ActionOption[];
  defaultRecommended?: ActionOption;
  dataRequirements: string[];
  confidence: 'Low' | 'Medium' | 'High';
}

/**
 * Action option within an opportunity
 */
export interface ActionOption {
  actionId: string;
  title: string;
  description: string;
  type: 'discount' | 'combo' | 'free_item' | 'campaign' | 'add_on' | 'upsell' | 'no_action';
  estimatedContribution: number;
  confidence: 'Low' | 'Medium' | 'High';
  prerequisites: string[];
  constraints: {
    maxDiscount?: number;
    minMarginPercent?: number;
    requiredStock?: number;
    allowedProductIds?: string[];
    allowedSegmentIds?: string[];
  };
}

/**
 * Complete opportunity → action map for the system
 */
export const OPPORTUNITY_ACTION_MAP: OpportunityActionSpace[] = [
  {
    opportunityType: 'low_demand',
    description: 'Sales below baseline for this time period',
    actions: [
      {
        actionId: 'discount',
        title: 'Percentage Discount',
        description: 'Apply X% discount to drive demand',
        type: 'discount',
        estimatedContribution: 0, // Will be calculated per scenario
        confidence: 'Medium',
        prerequisites: ['baseline_demand', 'elasticity_estimate'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 25,
        },
      },
      {
        actionId: 'combo',
        title: 'Combo Offer',
        description: 'Bundle with popular item to increase basket value',
        type: 'combo',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['attachment_rate', 'compatible_product'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 25,
        },
      },
      {
        actionId: 'free_item',
        title: 'Free Item Offer',
        description: 'Buy main, get add-on free',
        type: 'free_item',
        estimatedContribution: 0,
        confidence: 'Low',
        prerequisites: ['surplus_inventory', 'compatible_addon'],
        constraints: {
          maxDiscount: 0,
          minMarginPercent: 20,
        },
      },
      {
        actionId: 'campaign',
        title: 'Targeted Campaign',
        description: 'Win-back or reactivation campaign',
        type: 'campaign',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['dormant_customer_count', 'customer_segment'],
        constraints: {
          maxDiscount: 20,
          minMarginPercent: 20,
        },
      },
      {
        actionId: 'no_action',
        title: 'No Action',
        description: 'Wait - demand may recover naturally',
        type: 'no_action',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['demand_recovery_expected'],
        constraints: {},
      },
    ],
    dataRequirements: ['baseline_demand', 'current_demand', 'elasticity_estimate', 'time_context'],
    confidence: 'High',
  },
  {
    opportunityType: 'high_aov_opportunity',
    description: 'Average order value below target; opportunity to increase basket value',
    actions: [
      {
        actionId: 'add_on',
        title: 'Add-on Offer',
        description: 'Offer add-on item at small add-on price',
        type: 'add_on',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['top_products', 'attachment_rates'],
        constraints: {
          maxDiscount: 10,
          minMarginPercent: 30,
        },
      },
      {
        actionId: 'combo',
        title: 'Combo Offer',
        description: 'Bundle main + beverage at special price',
        type: 'combo',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['top_products', 'compatible_combo'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 30,
        },
      },
      {
        actionId: 'upsell',
        title: 'Minimum Order Upsell',
        description: 'Discount above minimum order value',
        type: 'upsell',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['average_order_value', 'minimum_order_threshold'],
        constraints: {
          maxDiscount: 15,
          minOrderValue: 200,
        },
      },
      {
        actionId: 'premium_variant',
        title: 'Premium Variant Promote',
        description: 'Promote higher-priced variant or premium item',
        type: 'add_on',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['premium_available', 'customer_price_sensitivity'],
        constraints: {
          maxDiscount: 10,
          minMarginPercent: 45,
        },
      },
    ],
    dataRequirements: ['average_order_value', 'aov_target', 'top_products', 'product_margins'],
    confidence: 'High',
  },
  {
    opportunityType: 'slow_hours',
    description: 'Sales below baseline during specific hours/days',
    actions: [
      {
        actionId: 'discount',
        title: 'Happy Hour Discount',
        description: 'Discount during slow hours to drive traffic',
        type: 'discount',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['slow_hour_baseline', 'time_context'],
        constraints: {
          maxDiscount: 20,
          minMarginPercent: 25,
          quietHours: { start: 12, end: 14 },
        },
      },
      {
        actionId: 'combo',
        title: 'Slow Hour Combo',
        description: 'Combo special during slow hours',
        type: 'combo',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['slow_hour_baseline', 'compatible_combo'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 25,
        },
      },
      {
        actionId: 'campaign',
        title: 'Targeted Campaign',
        description: 'Targeted promotion to slow-hour customers',
        type: 'campaign',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['customer_list', 'time_context'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 20,
        },
      },
    ],
    dataRequirements: ['hourly_sales_baseline', 'current_hour_sales', 'time_of_day', 'day_of_week'],
    confidence: 'High',
  },
  {
    opportunityType: 'high_margin',
    description: 'Products with high contribution margin',
    actions: [
      {
        actionId: 'margin_promotion',
        title: 'Margin Promotion',
        description: 'Promote as add-on to grow profit',
        type: 'add_on',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['high_margin_products'],
        constraints: {
          maxDiscount: 10,
          minMarginPercent: 45,
        },
      },
      {
        actionId: 'no_discount',
        title: 'No Discount - Maintain Margin',
        description: 'Do not discount - margin is already healthy',
        type: 'no_action',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['healthy_margin_products'],
        constraints: {},
      },
    ],
    dataRequirements: ['product_margins', 'contribution_margin_threshold'],
    confidence: 'High',
  },
  {
    opportunityType: 'dormant_customers',
    description: 'Customers who haven\'t visited in 30+ days',
    actions: [
      {
        actionId: 'campaign',
        title: 'Win-Back Campaign',
        description: 'Targeted offer to win back dormant customers',
        type: 'campaign',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['dormant_customer_count', 'customer_segments'],
        constraints: {
          maxDiscount: 20,
          minMarginPercent: 20,
          maxPerCustomer: 1,
        },
      },
      {
        actionId: 'free_item',
        title: 'Free Item Incentive',
        description: 'Free item for return visitors',
        type: 'free_item',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['dormant_customer_count', 'profitable_free_item'],
        constraints: {
          maxDiscount: 0,
          minMarginPercent: 25,
          maxPerCustomer: 1,
        },
      },
    ],
    dataRequirements: ['dormant_30d_count', 'customer_segments', 'profitable_free_item_availability'],
    confidence: 'High',
  },
  {
    opportunityType: 'overstock_inventory',
    description: 'Items above 80% of max stock - inventory opportunity',
    actions: [
      {
        actionId: 'clearance',
        title: 'Clearance Promotion',
        description: 'Discount to move excess stock',
        type: 'discount',
        estimatedContribution: 0,
        confidence: 'High',
        prerequisites: ['surplus_inventory_count', 'product_margins'],
        constraints: {
          maxDiscount: 20,
          minMarginPercent: 20,
        },
      },
      {
        actionId: 'combo',
        title: 'Bundle with Clearance',
        description: 'Bundle overstocked item with popular item',
        type: 'combo',
        estimatedContribution: 0,
        confidence: 'Medium',
        prerequisites: ['surplus_inventory', 'popular_companion'],
        constraints: {
          maxDiscount: 15,
          minMarginPercent: 20,
        },
      },
    ],
    dataRequirements: ['surplus_stock_items', 'product_margins', 'popular_companions'],
    confidence: 'High',
  },
];

/**
 * Get action space for a given opportunity type
 */
export function getOpportunityActionSpace(
  opportunityType: string
): OpportunityActionSpace | undefined {
  return OPPORTUNITY_ACTION_MAP.find((o) => o.opportunityType === opportunityType);
}

/**
 * Get recommended action from opportunity space
 */
export function getRecommendedAction(
  opportunityType: string,
  ctx: RecommendationContext,
  policy: AutomationPolicy
): ActionOption | undefined {
  const space = getOpportunityActionSpace(opportunityType);
  if (!space) return undefined;

  // In a full implementation, would evaluate each action against
  // current context and policy, then return the best one
  // For now, return the default recommended if set
  return space.actions[0]; // Return first as placeholder
}

/**
 * Evaluate which actions are viable given current context and policy
 */
export function evaluateActionViability(
  action: ActionOption,
  ctx: RecommendationContext,
  policy: AutomationPolicy
): {
  viable: boolean;
  violations: string[];
  adjustedEstimatedContribution: number;
} {
    const violations: string[] = [];
    let adjustedContribution = action.estimatedContribution;

    // Check constraints
    if (action.constraints.maxDiscount !== undefined) {
      if (action.constraints.maxDiscount > policy.maximumDiscount) {
        violations.push(`Action discount ${action.constraints.maxDiscount}% exceeds policy maximum ${policy.maximumDiscount}%`);
        adjustedContribution = Math.max(0, adjustedContribution - 10); // Penalty
      }
    }

    if (action.constraints.minMarginPercent !== undefined) {
      // Would check actual margin - placeholder
      if (action.constraints.minMarginPercent > 30) {
        violations.push(`Minimum margin ${action.constraints.minMarginPercent}% may be restrictive`);
      }
    }

    // Check prerequisites
    const hasPrerequisites = action.prerequisites.some((p) => {
      // Check if prerequisite is satisfied in context
      // This is simplified - full impl would check ctx
      return false;
    });

    const viable = violations.length === 0 && hasPrerequisites;

    return {
      viable,
      violations,
      adjustedEstimatedContribution: adjustedContribution,
    };
  }

  /**
   * Format opportunity action space for owner display
   */
  export function formatOpportunityActionSpace(
    opportunityType: string,
    space: OpportunityActionSpace
  ): string {
    const lines: string[] = [];

    lines.push(`Opportunity: ${space.description}`);
    lines.push('');
    lines.push('Available actions:');

    for (const action of space.actions) {
      const prereqStr = action.prerequisites.length > 0
        ? `(requires: ${action.prerequisites.join(', ')})`
        : '';
      lines.push(`  • ${action.title} (${action.type}) ${prereqStr}`);
      lines.push(`    Contribution: ₹${action.estimatedContribution.toLocaleString('en-IN')} estimated`);
      lines.push(`    Confidence: ${action.confidence}`);
    }

    if (space.defaultRecommended) {
      lines.push('');
      lines.push(`Default recommended: ${space.defaultRecommended.title} (${space.defaultRecommended.type})`);
    }

    return lines.join('\n');
  }