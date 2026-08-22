/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KillSwitches and EmergencySafety — Controlled autonomy safety mechanisms.
 *
 * Features:
 *   - Pause all automated promotions at restaurant level
 *   - Pause specific campaign
 *   - Disable specific strategy
 *   - Disable communication channel
 *   - Disable AI recommendations
 *   - Disable automated actions
 *   - Billing must remain unaffected
 *   - Emergency safety: auto-stop on anomalies
 */

import mongoose from 'mongoose';

/**
 * Automation kill switch states
 */
export type KillSwitchState = 'active' | 'paused' | 'disabled';

/**
 * Kill switch configuration
 */
export interface KillSwitches {
  /** Pause all automated promotions at restaurant level */
  allAutomatedPromotions: KillSwitchState;

  /** Pause specific campaign by ID */
  campaign?: KillSwitchState;

  /** Disable specific strategy type */
  strategyTypes: Record<StrategyKey, KillSwitchState>;

  /** Disable communication channels */
  channels: {
    in_app: KillSwitchState;
    whatsapp: KillSwitchState;
    email: KillSwitchState;
    sms: KillSwitchState;
  };

  /** Disable AI recommendations */
  aiRecommendations: KillSwitchState;

  /** Disable automated actions */
  automatedActions: KillSwitchState;

  /** Emergency override - immediate stop */
  emergencyStop: KillSwitchState;

  /** Bypass for billing (always true) */
  billingUnaffected: boolean;
}

/**
 * Default kill switches - all active (running)
 */
export const DEFAULT_KILL_SWITCHES: KillSwitches = {
  allAutomatedPromotions: 'active',
  campaign: 'active',
  strategyTypes: {
    SLOW_HOUR_COMBO: 'active',
    REACTIVATION_FREE_ITEM: 'active',
    AOV_ADDON: 'active',
    HIGH_MARGIN_CROSS_SELL: 'active',
    NEW_PRODUCT_PROMOTION: 'active',
    LOYALTY_REWARD: 'active',
    SAFE_INVENTORY_PROMOTION: 'active',
  },
  channels: {
    in_app: 'active',
    whatsapp: 'active',
    email: 'active',
    sms: 'active',
  },
  aiRecommendations: 'active',
  automatedActions: 'active',
  emergencyStop: 'active',
  billingUnaffected: true,
};

/**
 * Check if an action is permitted given the current kill switches
 */
export function checkKillSwitches(
  switches: KillSwitches,
  actionType: 'promotion' | 'campaign' | 'ai_rec' | 'automated' | 'channel',
  strategyKey?: StrategyKey,
  channel?: keyof KillSwitches['channels']
): { allowed: boolean; reason?: string } {
  // Check emergency stop first
  if (switches.emergencyStop === 'disabled') {
    return {
      allowed: false,
      reason: 'Emergency stop is active - all automation paused',
    };
  }

  // Check specific action types
  switch (actionType) {
    case 'promotion':
      if (switches.allAutomatedPromotions === 'paused' ||
          switches.allAutomatedPromotions === 'disabled') {
        return {
          allowed: false,
          reason: 'All automated promotions are paused',
        };
      }
      // Check specific strategy
      if (strategyKey && switches.strategyTypes[strategyKey] === 'disabled') {
        return {
          allowed: false,
          reason: `Strategy "${strategyKey}" is disabled`,
        };
      }
      break;

    case 'campaign':
      if (switches.campaign === 'paused' || switches.campaign === 'disabled') {
        return {
          allowed: false,
          reason: 'Specific campaign is paused/disabled',
        };
      }
      break;

    case 'ai_rec':
      if (switches.aiRecommendations === 'paused' || switches.aiRecommendations === 'disabled') {
        return {
          allowed: false,
          reason: 'AI recommendations are paused/disabled',
        };
      }
      break;

    case 'automated':
      if (switches.automatedActions === 'paused' || switches.automatedActions === 'disabled') {
        return {
          allowed: false,
          reason: 'Automated actions are paused/disabled',
        };
      }
      break;

    case 'channel':
      if (channel && switches.channels[channel] === 'disabled') {
        return {
          allowed: false,
          reason: `Channel ${channel} is disabled`,
        };
      }
      break;
  }

  return { allowed: true };
}

/**
 * Emergency safety check - automatically stop automation if anomalies detected
 */
export function emergencySafetyCheck(
  ctx: RecommendationContext,
  policy: AutomationPolicy,
  recentPromotions: Array<{
    discountPercent: number;
    contributionMarginPercent: number;
    strategyKey: StrategyKey;
    timestamp: Date;
  }>
): {
  safeToProceed: boolean;
  stopReason?: string;
  recommendedAction: 'continue' | 'pause_all' | 'review_policy';
} {
  const warnings: string[] = [];

  // Check for unexpected discounts
  const recentDiscounts = recentPromotions
    .filter(p => p.discountPercent > policy.maximumDiscount);
  if (recentDiscounts.length > 0) {
    warnings.push(
      `Unexpected discount detected: ${recentDiscounts.length} promotion(s) ` +
      `exceeded maximum ${policy.maximumDiscount}%`
    );
  }

  // Check for margin violations
  const marginViolations = recentPromotions
    .filter(p => p.contributionMarginPercent < policy.minimumMargin);
  if (marginViolations.length > 0) {
    warnings.push(
      `Margin violation detected: ${marginViolations.length} promotion(s) ` +
      `below minimum ${policy.minimumMargin}% margin`
    );
  }

  // Check for inventory anomalies
  const surplus = ctx.surplusStockItems || [];
  if (surplus.length > 5) {
    warnings.push(
      `Inventory anomaly: ${surplus.length} items in surplus state`
    );
  }

  // Check for pricing inconsistency
  const products = ctx.products || [];
  const inconsistentPricing = products.filter(
    (p: any) => p.price && p.averageCost && p.averageCost > p.price * 1.5
  );
  if (inconsistentPricing.length > 0) {
    warnings.push(
      `Pricing inconsistency: ${inconsistentPricing.length} products ` +
      `have cost > 150% of price`
    );
  }

  // Check for duplicate campaigns
  const campaignTypes = recentPromotions.map(p => p.strategyKey);
  const duplicateCount = campaignTypes.filter(
    (c, i) => campaignTypes.indexOf(c) !== i
  ).length;
  if (duplicateCount > 0) {
    warnings.push(
      `Duplicate campaigns detected: ${duplicateCount} repeated strategy types`
    );
  }

  // Check for excessive redemption (if we had redemption data)
  // Placeholder for future implementation

  // Determine safety status
  if (warnings.length === 0) {
    return {
      safeToProceed: true,
      recommendedAction: 'continue',
    };
  }

  // If multiple warning categories, pause all automation
  const warningCategories = new Set(warnings.map(w => {
    if (w.includes('discount')) return 'discount';
    if (w.includes('margin')) return 'margin';
    if (w.includes('inventory')) return 'inventory';
    if (w.includes('pricing')) return 'pricing';
    if (w.includes('duplicate')) return 'duplicate';
    return 'other';
  }));

  let recommendedAction: 'continue' | 'pause_all' | 'review_policy' = 'continue';

  if (warningCategories.has('discount') && warningCategories.has('margin')) {
    // Both discount and margin issues - critical
    recommendedAction = 'pause_all';
  } else if (warningCategories.has('inventory') && warningCategories.has('pricing')) {
    // Inventory and pricing anomalies - serious
    recommendedAction = 'pause_all';
  } else if (warnings.length >= 3) {
    // Multiple warnings
    recommendedAction = 'review_policy';
  } else {
    // Single warning - still safe to proceed but with review
    recommendedAction = 'continue';
  }

  return {
    safeToProceed: recommendedAction === 'continue',
    stopReason: warnings.join('; '),
    recommendedAction,
  };
}

/**
 * Pause all automated promotions
 */
export function pauseAllAutomatedPromotions(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.allAutomatedPromotions = 'paused';
  updated.campaign = 'paused';

  // Pause all strategy types
  for (const key of Object.keys(updated.strategyTypes) as StrategyKey[]) {
    updated.strategyTypes[key] = 'paused';
  }

  // Pause all channels
  for (const key of Object.keys(updated.channels) as (keyof KillSwitches['channels'])[]) {
    updated.channels[key] = 'paused';
  }

  updated.aiRecommendations = 'paused';
  updated.automatedActions = 'paused';

  return updated;
}

/**
 * Resume all automated promotions
 */
export function resumeAllAutomatedPromotions(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.allAutomatedPromotions = 'active';
  updated.campaign = 'active';

  // Resume all strategy types
  for (const key of Object.keys(updated.strategyTypes) as StrategyKey[]) {
    updated.strategyTypes[key] = 'active';
  }

  // Resume all channels
  for (const key of Object.keys(updated.channels) as (keyof KillSwitches['channels'])[]) {
    updated.channels[key] = 'active';
  }

  updated.aiRecommendations = 'active';
  updated.automatedActions = 'active';

  return updated;
}

/**
 * Disable specific strategy
 */
export function disableStrategy(
  switches: KillSwitches,
  strategyKey: StrategyKey
): KillSwitches {
  const updated = { ...switches };
  if (updated.strategyTypes[strategyKey]) {
    updated.strategyTypes[strategyKey] = 'disabled';
  }
  return updated;
}

/**
 * Enable specific strategy
 */
export function enableStrategy(
  switches: KillSwitches,
  strategyKey: StrategyKey
): KillSwitches {
  const updated = { ...switches };
  if (updated.strategyTypes[strategyKey]) {
    updated.strategyTypes[strategyKey] = 'active';
  }
  return updated;
}

/**
 * Disable communication channel
 */
export function disableChannel(
  switches: KillSwitches,
  channel: keyof KillSwitches['channels']
): KillSwitches {
  const updated = { ...switches };
  if (updated.channels[channel]) {
    updated.channels[channel] = 'disabled';
  }
  return updated;
}

/**
 * Enable communication channel
 */
export function enableChannel(
  switches: KillSwitches,
  channel: keyof KillSwitches['channels']
): KillSwitches {
  const updated = { ...switches };
  if (updated.channels[channel]) {
    updated.channels[channel] = 'active';
  }
  return updated;
}

/**
 * Disable AI recommendations
 */
export function disableAirRecommendations(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.aiRecommendations = 'disabled';
  return updated;
}

/**
 * Enable AI recommendations
 */
export function enableAirRecommendations(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.aiRecommendations = 'active';
  return updated;
}

/**
 * Disable automated actions
 */
export function disableAutomatedActions(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.automatedActions = 'disabled';
  return updated;
}

/**
 * Enable automated actions
 */
export function enableAutomatedActions(switches: KillSwitches): KillSwitches {
  const updated = { ...switches };
  updated.automatedActions = 'active';
  return updated;
}