/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OwnerActionCenter — Single place for important restaurant actions.
 *
 * Categories:
 *   🔥 Act now
 *   💰 Revenue opportunity
 *   📈 Growth opportunity
 *   📦 Inventory risk
 *   👥 Customer opportunity
 *   ⚠️ Margin risk
 *   🤖 Automated actions
 */

import mongoose from 'mongoose';
import RestaurantIntelligenceOrchestrator from '../services/restaurantIntelligenceOrchestrator';
import type { AutomationPolicy, AutomationLevel, BusinessObjective } from '../services/restaurantIntelligenceOrchestrator';

/**
 * Action item for the owner action center
 */
export interface OwnerActionItem {
  id: string;
  title: string;
  type: 'offer' | 'combo' | 'campaign' | 'inventory' | 'pricing' | 'review';
  priority: 'high' | 'medium' | 'low';
  category:
    | '🔥 Act now'
    | '💰 Revenue opportunity'
    | '📈 Growth opportunity'
    | '📦 Inventory risk'
    | '👥 Customer opportunity'
    | '⚠️ Margin risk'
    | '🤖 Automated actions';
  description: string;
  estimatedImpact: string;
  actionRequired: string;
  automatable: boolean;
  automationLevel?: AutomationLevel;
  policyViolations?: string[];
}

/**
 * Get owner action center categories with items for a restaurant
 */
export async function getOwnerActionCenter(
  restaurantId: string,
  policy: AutomationPolicy,
  objective: BusinessObjective,
  automationLevel: AutomationLevel
): Promise<{
  categories: Record<string, OwnerActionItem[]>;
  rankedTotal: OwnerActionItem[];
}> {
  const orchestrator = new RestaurantIntelligenceOrchestrator(policy, objective, automationLevel);
  const ranked = orchestrator.rankRecommendations(restaurantId);

  // Categorize each recommendation
  const categories: Record<string, OwnerActionItem[]> = {
    '🔥 Act now': [],
    '💰 Revenue opportunity': [],
    '📈 Growth opportunity': [],
    '📦 Inventory risk': [],
    '👥 Customer opportunity': [],
    '⚠️ Margin risk': [],
    '🤖 Automated actions': [],
  };

  const allItems: OwnerActionItem[] = [];

  for (const rec of ranked) {
    const item: OwnerActionItem = {
      id: `${rec.type}_${Math.random().toString(36).slice(2, 9)}`,
      title: rec.title,
      type: rec.type as any,
      priority: rec.confidence === 'High' ? 'high' : rec.confidence === 'Medium' ? 'medium' : 'low',
      category: '📈 Growth opportunity', // default
      description: rec.why || 'No description available',
      estimatedImpact: rec.expectedImpact || 'No impact estimate',
      actionRequired: rec.action || 'review',
      automatable: rec.action === 'create_offer' || rec.action === 'create_combo',
      automationLevel: automationLevel,
    };

    allItems.push(item);

    // Categorize based on content
    const titleLower = rec.title.toLowerCase();
    const typeLower = rec.type.toLowerCase();

    if (titleLower.includes('margin') || typeLower === 'margin_protection' || typeLower === 'margin_promotion') {
      item.category = '⚠️ Margin risk';
      categories['⚠️ Margin risk'].push(item);
    } else if (
      titleLower.includes('inventory') ||
      titleLower.includes('stock') ||
      titleLower.includes('clearance') ||
      typeLower === 'clearance' ||
      typeLower === 'inventory_review'
    ) {
      item.category = '📦 Inventory risk';
      categories['📦 Inventory risk'].push(item);
    } else if (
      titleLower.includes('inactiv') ||
      titleLower.includes('lapsed') ||
      titleLower.includes('win_back') ||
      typeLower === 'win_back'
    ) {
      item.category = '👥 Customer opportunity';
      categories['👥 Customer opportunity'].push(item);
    } else if (
      rec.action === 'create_combo' ||
      rec.action === 'create_offer' ||
      rec.action === 'create_campaign' ||
      typeLower === 'combo' ||
      typeLower === 'upsell' ||
      typeLower === 'add_on'
    ) {
      item.category = '💰 Revenue opportunity';
      categories['💰 Revenue opportunity'].push(item);
    } else if (
      titleLower.includes('slow') ||
      titleLower.includes('hour') ||
      titleLower.includes('afternoon') ||
      titleLower.includes('lunch') ||
      typeLower === 'time_based'
    ) {
      item.category = '🔥 Act now';
      categories['🔥 Act now'].push(item);
    } else {
      item.category = '📈 Growth opportunity';
      categories['📈 Growth opportunity'].push(item);
    }
  }

  // Limit to top 3 per category
  for (const key of Object.keys(categories)) {
    categories[key] = categories[key].slice(0, 3);
  }

  return {
    categories,
    rankedTotal: allItems,
  };
}

/**
 * Get prioritized actions (top 3-5 across all categories)
 */
export async function getPrioritizedActions(
  restaurantId: string,
  policy: AutomationPolicy,
  objective: BusinessObjective,
  automationLevel: AutomationLevel
): Promise<OwnerActionItem[]> {
  const { rankedTotal } = await getOwnerActionCenter(restaurantId, policy, objective, automationLevel);

  // Sort by priority (high first), then by score (the orchestrator's score)
  const sorted = rankedTotal.sort((a, b) => {
    const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    }
    return 0;
  });

  // Return top 5
  return sorted.slice(0, 5);
}

/**
 * Check if an action can be auto-executed based on automation level and policy
 */
export function canAutoExecute(
  action: OwnerActionItem,
  automationLevel: AutomationLevel,
  policy: AutomationPolicy
): boolean {
  switch (automationLevel.level) {
    case 0: // Advisory only - never auto-execute
      return false;

    case 1: // Assisted - system prepares, owner approves
      return action.automatable && !action.policyViolations?.length;

    case 2: // Controlled automation - owner creates rules
      return (
        action.automatable &&
        !action.policyViolations?.length &&
        automationLevel.fromLibraryOnly
      );

    case 3: // Restricted optimization - from owner-approved library only
      return (
        action.automatable &&
        !action.policyViolations?.length &&
        automationLevel.fromLibraryOnly
      );

    default:
      return false;
  }
}

/**
 * Check policy violations for an action
 */
export function checkPolicyViolations(
  action: OwnerActionItem,
  policy: AutomationPolicy
): string[] {
    const violations: string[] = [];

    // Check maximum discount
    // (Would need to extract discount from action details)

    // Check minimum margin
    // (Would need to extract margin from action details)

    // Check frequency limits
    // (Would track per-day counts)

    // Check allowed products/channels
    // (Would validate against policy constraints)

    return violations;
}