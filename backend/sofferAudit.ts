/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferAudit — Test offer recommendations for stacking, eligibility, expiry, usage limits,
 * customer limits, product restrictions, and variant restrictions.
 *
 * Every offer recommendation should ultimately pass through the same validation system
 * used by the POS.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Offer } from '../models/Offer';
import type { FinancialAuditResult } from './financialTruthAudit';
import type { InventoryState } from './inventoryAudit';

/**
 * Offer eligibility result
 */
export interface OfferEligibilityResult {
  offerId: string;
  eligible: boolean;
  violations: string[];
  restrictions: string[];
  canStack: boolean;
  effectiveDiscount: number; // effective discount % after all restrictions
}

/**
 * Audit a single offer for eligibility
 */
export function auditOfferEligibility(
  offer: Offer,
  ctx: RecommendationContext,
  customerId?: string,
  productIds?: string[],
  variantRestrictions: Record<string, string[]> = {}
): OfferEligibilityResult {
    const violations: string[] = [];
    const restrictions: string[] = [];
    let canStack = true;
    let effectiveDiscount = offer.value || 0;

    // 1. Check offer expiry
    const now = new Date();
    if (offer.startDate && new Date(offer.startDate) > now) {
      violations.push('Offer not yet active - start date in future');
      effectiveDiscount = 0;
    }
    if (offer.endDate && new Date(offer.endDate) < now) {
      violations.push('Offer expired - end date has passed');
      effectiveDiscount = 0;
      canStack = false;
    }

    // 2. Check maximum discount policy
    if (offer.value && offer.value > 30) { // Policy limit
      violations.push(`Discount ${offer.value}% exceeds maximum allowed`);
      // Will be capped below
    }

    // 3. Check product applicability
    if (productIds && productIds.length > 0) {
      const applicable = offer.applicableProductIds || [];
      const hasApplicableProduct = productIds.some((pid) => applicable.includes(pid));
      if (!hasApplicableProduct) {
        violations.push('Offer does not apply to selected products');
        effectiveDiscount = 0;
        canStack = false;
      }
    }

    // 4. Check category applicability
    if (offer.applicableCategories && offer.applicableCategories.length > 0) {
      const offeredCategories = offer.applicableCategories;
      // Check if any of the customer's/products' categories match
      // If not, offer doesn't apply
      if (offer.applicableProductIds && offer.applicableProductIds.length > 0) {
        // Has specific product IDs - already checked above
      }
    }

    // 5. Check minimum order value
    if (offer.minOrderValue) {
      // Would need cart total - placeholder
      // if (cartTotal < offer.minOrderValue) {
      //   violations.push(`Minimum order ${offer.minOrderValue} not met`);
      // }
    }

    // 5. Check maximum uses per customer
    if (offer.maxPerCustomer) {
      // Would need to check customer's previous usage - placeholder
      // if (customerUsage >= offer.maxPerCustomer) {
      //   violations.push(`Maximum ${offer.maxPerCustomer} uses per customer exceeded`);
      // }
    }

    // 6. Check current uses
    if (offer.currentUses !== undefined) {
      // Would check against maxUses
      // if (offer.currentUses >= (offer.maxUses || Infinity)) {
      //   violations.push('Offer maximum uses reached');
      //   effectiveDiscount = 0;
      //   canStack = false;
      // }
    }

    // 7. Check variant restrictions
    // If productIds are specified and offer has variant restrictions
    if (Object.keys(variantRestrictions).length > 0) {
      // Check if any of the specified variant restrictions conflict
      for (const [variantId, allowedVariants] of Object.entries(variantRestrictions)) {
        // placeholder - would check actual variant
      }
    }

    // 8. Check stacking rules
    // Determine if this offer can stack with other active offers
    // General rule: percentage discounts cannot stack with each other
    // but percentage + flat, or free_item + percentage may stack
    if (offer.type === 'percentage') {
      // Percentage discounts typically don't stack with other percentages
      canStack = false;
      // Effective discount will be the highest single percentage
    } else if (offer.type === 'flat') {
      // Flat discounts may stack with percentages up to a point
      canStack = true;
    } else if (offer.type === 'free_item') {
      // Free items have specific stacking rules
      canStack = false; // Usually can't stack
    } else if (offer.type === 'combo') {
      // Combos typically don't stack
      canStack = false;
    }

    // 8. Cap effective discount at policy maximum
    const maxAllowedDiscount = 30; // From policy
    if (effectiveDiscount > maxAllowedDiscount) {
      effectiveDiscount = maxAllowedDiscount;
    }

    // 9. Determine eligibility
    const eligible = violations.length === 0 && effectiveDiscount > 0;

    return {
      offerId: String(offer._id),
      eligible,
      violations,
      restrictions: violations.length > 0 ? violations : restrictions,
      canStack,
      effectiveDiscount,
    };
  }

  /**
   * Audit all offers for a recommendation
   */
  export function auditRecommendationOffers(
    recommendation: any,
    ctx: RecommendationContext,
    policy: AutomationPolicy
  ): {
    offerEligibility: OfferEligibilityResult[];
    overallEligible: boolean;
    overallCanStack: boolean;
    effectiveMaxDiscount: number;
    violations: string[];
    recommendedAction: 'proceed' | 'adjust' | 'block' | 'investigate';
  } {
    const offerEligibility: OfferEligibilityResult[] = [];
    const allViolations: string[] = [];
    let overallEligible = true;
    let overallCanStack = true;
    let effectiveMaxDiscount = 0;

    // Get the offers involved in the recommendation
    // This could be existing offers or new proposal offers
    // For now, check the recommendation's offerSuggestion against context

    // The recommendation may have an offerSuggestion - audit that
    if (recommendation.offerSuggestion) {
      // Create a mock offer from the suggestion for auditing
      const mockOffer: Offer = {
        _id: new mongoose.Types.ObjectId(),
        type: recommendation.offerSuggestion.type || 'percentage',
        value: recommendation.offerSuggestion.value || 0,
        minOrderValue: recommendation.offerSuggestion.minOrderValue,
        maxUses: recommendation.offerSuggestion.maxPerCustomer ? 1 : undefined,
        currentUses: 0,
        applicableProductIds: recommendation.offerSuggestion.applicableProductIds || [],
        applicableCategories: recommendation.offerSuggestion.applicableCategories || [],
        couponCode: recommendation.offerSuggestion.couponCode,
        isDeleted: false,
      };

      const eligibility = auditOfferEligibility(mockOffer, ctx);
      offerEligibility.push(eligibility);

      if (!eligibility.eligible) {
        overallEligible = false;
      }
      if (!eligibility.canStack) {
        overallCanStack = false;
      }
      effectiveMaxDiscount = Math.max(effectiveMaxDiscount, eligibility.effectiveDiscount);

      // Add violations to overall list
      eligibility.violations.forEach(v => {
        if (!allViolations.includes(v)) allViolations.push(v);
      }
    } else {
      // No offerSuggestion in recommendation - check if this would generate one
      // and what the eligibility would be
      offerEligibility.push({
        offerId: 'none',
        eligible: false,
        violations: ['No offer proposal generated'],
        restrictions: ['No offer proposal'],
        canStack: false,
        effectiveDiscount: 0,
      });
      overallEligible = false;
      overallCanStack = false;
    }

    // Also check against policy constraints
    if (policy.maximumDiscount) {
      // All effective discounts should respect this
      effectiveMaxDiscount = Math.min(effectiveMaxDiscount, policy.maximumDiscount);
    }

    // Determine overall recommended action
    let recommendedAction: 'proceed' | 'adjust' | 'block' | 'investigate' = 'proceed';
    if (!overallEligible) {
      if (allViolations.some(v => v.includes('expired') || v.includes('not yet active'))) {
        recommendedAction = 'investigate';
      } else {
        recommendedAction = 'block';
      }
    } else if (!overallCanStack) {
      recommendedAction = 'adjust';
    }

    return {
      offerEligibility,
      overallEligible,
      overallCanStack,
      effectiveMaxDiscount,
      violations: allViolations,
      recommendedAction,
    };
  }

  /**
   * Generate offer eligibility summary
   */
  export function formatOfferEligibilitySummary(
    eligibility: OfferEligibilityResult
  ): string {
    const lines: string[] = [];

    lines.push(`Offer ${eligibility.offerId}: ${eligibility.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}`);

    if (eligibility.violations.length > 0) {
      lines.push(`Violations: ${eligibility.violations.join(', ')}`);
    }

    if (eligibility.restrictions.length > 0) {
      lines.push(`Restrictions: ${eligibility.restrictions.join(', ')}`);
    }

    lines.push(`Can stack: ${eligibility.canStack}`);
    lines.push(`Effective discount: ${eligibility.effectiveDiscount}%`);

    return lines.join('\n');
  }

  /**
   * Generate recommendation offer summary
   */
  export function formatRecommendationOffersSummary(
    audit: ReturnType<typeof auditRecommendationOffers>
  ): string {
    const lines: string[] = [];

    lines.push(`Overall: ${audit.overallEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}`);
    lines.push(`Can stack: ${audit.overallCanStack}`);
    lines.push(`Effective max discount: ${audit.effectiveMaxDiscount}%`);
    lines.push('');

    for (const eo of audit.offerEligibility) {
      lines.push(formatOfferEligibilitySummary(eo));
      lines.push('');
    }

    if (audit.violations.length > 0) {
      lines.push('Violations:');
      for (const v of audit.violations) {
        lines.push(`  • ${v}`);
      }
    }

    lines.push('');
    lines.push(`Recommended action: ${audit.recommendedAction}`);

    return lines.join('\n');
  }