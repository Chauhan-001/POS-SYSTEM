/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Consistency Checks — Periodic validation of offer/combo/recipe/inventory
 * consistency to detect operational warnings.
 *
 * Detects:
 *   - Offer price ≠ Expected pricing
 *   - Recipe cost ≠ Calculated product cost
 *   - Combo component ≠ Available product
 *   - Inventory ≠ Expected stock
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { Product } from '../models/Product';
import type { Offer } from '../models/Offer';
import type { InventoryCheckResult } from './types';

/**
 * Consistency check result
 */
export interface ConsistencyCheckResult {
  /** Check name */
  name: string;
  /** Overall status */
  status: 'Pass' | 'Warning' | 'Fail';
  /** Detailed findings */
  findings: ConsistencyFinding[];
  /** Overall score impact (-5 to +5) */
  scoreImpact: number;
  /** Recommended action */
  action: 'none' | 'warn' | 'block' | 'investigate';
}

/**
 * Consistency finding
 */
export interface ConsistencyFinding {
  /** Category of finding */
  category: 'pricing' | 'recipe' | 'combo' | 'inventory';
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Description */
  description: string;
  /** Affected item/product */
  affectedId: string;
  /** Expected vs actual */
  expected: any;
  actual: any;
}

/**
 * Run all consistency checks for a restaurant
 */
export function runConsistencyChecks(
  restaurantId: string,
  ctx: RecommendationContext,
  activeOffers: Offer[] = []
): ConsistencyCheckResult[] {
  const results: ConsistencyCheckResult[] = [];

  // 1. Offer price consistency
  results.push(checkOfferPriceConsistency(ctx, activeOffers));

  // 2. Recipe cost consistency
  results.push(checkRecipeCostConsistency(ctx));

  // 3. Combo component availability
  results.push(checkComboComponentAvailability(ctx));

  // 4. Inventory vs expected stock
  results.checkInventoryConsistency = checkInventoryConsistency(ctx);

  // 5. Offer-combo-inventory consistency
  results.push(checkOfferComboInventoryConsistency(ctx, activeOffers));

  return results;
}

/**
 * Check offer price vs expected pricing
 */
function checkOfferPriceConsistency(
  ctx: RecommendationContext,
  activeOffers: Offer[]
): ConsistencyCheckResult {
  const findings: ConsistencyFinding[] = [];
  let scoreImpact = 0;

  const offers = ctx.offerPerformance || [];

  for (const offer of offers.slice(0, 5)) { // Check top 5 offers
    if (!offer.discountGiven || !offer.revenueGenerated) continue;

    // Find matching active offer
    const activeOffer = activeOffers.find(
      ao => String(ao._id || oo) === String(offer.offerId)
    );

    if (activeOffer) {
      // Check if current discount matches the offer's typical discount
      const expectedDiscount = activeOffer.value;
      const actualDiscount = offer.discountGiven;

      if (expectedDiscount && actualDiscount) {
        const diff = Math.abs(expectedDiscount - actualDiscount);
        if (diff > 5) { // More than 5% difference
          findings.push({
            category: 'pricing',
            severity: diff > 15 ? 'high' : 'medium',
            description: `Offer discount mismatch: expected ${expectedDiscount}%, got ${actualDiscount}%`,
            affectedId: String(offer.offerId),
            expected: `${expectedDiscount}%`,
            actual: `${actualDiscount}%`,
          });
          scoreImpact -= 2;
        }
      }
    }
  }

  const status = findings.length > 0 ? 'Fail' : 'Pass';
  if (status === 'Fail') scoreImpact -= 3;

  return {
    name: 'Offer price consistency',
    status,
    findings,
    scoreImpact,
    action: findings.length > 2 ? 'investigate' : 'none',
  };
}

/**
 * Check recipe cost vs calculated product cost
 */
function checkRecipeCostConsistency(ctx: RecommendationContext): ConsistencyCheckResult {
  const findings: ConsistencyFinding[] = [];
  let scoreImpact = 0;

  const margins = ctx.margin?.productMargins || [];
  const products = ctx.products || [];

  for (const product of products.slice(0, 10)) { // Check top 10 products
    const margin = margins.find((m: any) => m.productId === String(product._id));

    if (margin) {
      // Compare recipe cost from margin data vs product price data
      const recipeCost = margin.recipeCost;
      const productCost = product.averageCost;

      if (recipeCost > 0 && productCost > 0) {
        const costDiff = Math.abs(recipeCost - productCost);
        const costPct = (costDiff / Math.max(recipeCost, productCost)) * 100;

        if (costPct > 15) { // More than 15% difference
          findings.push({
            category: 'recipe',
            severity: costPct > 30 ? 'high' : 'medium',
            description: `${product.name || 'Product'}: recipe cost ₹${recipeCost} vs product cost ₹${productCost} (${Math.round(costPct)}% diff)`,
            affectedId: String(product._id),
            expected: `₹${recipeCost.toFixed(0)}`,
            actual: `₹${productCost.toFixed(0)}`,
          });
          scoreImpact -= 2;
        }
      }
    }
  }

  const status = findings.length > 0 ? 'Fail' : 'Pass';
  if (status === 'Fail') scoreImpact -= 3;

  return {
    name: 'Recipe cost consistency',
    status,
    findings,
    scoreImpact,
    action: findings.length > 3 ? 'investigate' : 'none',
  };
}

/**
 * Check combo component availability
 */
function checkComboComponentAvailability(ctx: RecommendationContext): ConsistencyCheckResult {
  const findings: ConsistencyFinding[] = [];
  let scoreImpact = 0;

  const surplus = ctx.surplusStockItems || [];

  // Check if combo components from recommendations are in surplus
  // This is a preventive check - if we recommend a combo but components are in surplus,
  // we should alert the owner

  for (const item of surplus.slice(0, 3)) {
    // Check if this item is commonly used in combos
    // We look at product category and name
    const matchingCombos = (ctx.offerPerformance || [])
      .filter((o: any) => o.type === 'combo')
      .filter((o: any) => {
        const comboIds = o.comboProductIds || [];
        return comboIds.includes(item.productId);
      });

    if (matchingCombos.length > 0) {
      findings.push({
        category: 'combo',
        severity: 'medium',
        description: `${item.productName} is in surplus (${item.surplusQuantity} above ceiling) but may be used in ${matchingCombos.length} active combo(s)`,
        affectedId: String(item.productId),
        expected: 'Available for combos',
        actual: `Surplus ${item.surplusQuantity}${item.unit || ''}`,
      });
      scoreImpact -= 1;
    }
  }

  const status = findings.length > 0 ? 'Warning' : 'Pass';

  return {
    name: 'Combo component availability',
    status,
    findings,
    scoreImpact,
    action: findings.length > 0 ? 'warn' : 'none',
  };
}

/**
 * Check inventory consistency (actual vs expected stock)
 */
function checkInventoryConsistency(ctx: RecommendationContext): ConsistencyCheckResult {
  const findings: ConsistencyFinding[] = [];
  let scoreImpact = 0;

  const inventory = ctx.inventory || [];

  for (const item of inventory.slice(0, 5)) {
    // Check if current stock is reasonable
    if (typeof item.currentStock === 'number' && typeof item.maxStock === 'number') {
      const stockRatio = item.currentStock / Math.max(item.maxStock, 1);

      if (stockRatio > 1.5) {
        // Over stocked - 50%+ above max
        findings.push({
          category: 'inventory',
          severity: 'high',
          description: `${item.name || 'Item'}: stock ${item.currentStock} is ${Math.round((stockRatio - 1) * 100)}% above max ${item.maxStock}`,
          affectedId: String(item.id || item._id),
          expected: `${item.maxStock} (max)`,
          actual: `${item.currentStock} (current)`,
        });
        scoreImpact -= 3;
      } else if (stockRatio > 1.2) {
        // Slightly over stocked
        findings.push({
          category: 'inventory',
          severity: 'low',
          description: `${item.name || 'Item'}: stock ${item.currentStock} is ${Math.round((stockRatio - 1) * 100)}% above max ${item.maxStock}`,
          affectedId: String(item.id || item._id),
          expected: `${item.maxStock} (max)`,
          actual: `${item.currentStock} (current)`,
        });
        scoreImpact -= 1;
      }

      // Check below minimum
      if (item.minStock > 0 && stockRatio < 0.5) {
        findings.push({
          category: 'inventory',
          severity: 'high',
          description: `${item.name || 'Item'}: stock ${item.currentStock} is below minimum ${item.minStock} (50%+ gap)`,
          affectedId: String(item.id || item._id),
          expected: `${item.minStock} (min)`,
          actual: `${item.currentStock} (current)`,
        });
        scoreImpact -= 3;
      }
    }
  }

  const status = findings.length > 0 ? 'Warning' : 'Pass';

  return {
    name: 'Inventory consistency',
    status,
    findings,
    scoreImpact,
    action: findings.length > 0 ? 'investigate' : 'none',
  };
}

/**
 * Check offer-combo-inventory consistency
 */
function checkOfferComboInventoryConsistency(
  ctx: RecommendationContext,
  activeOffers: Offer[]
): ConsistencyCheckResult {
  const findings: ConsistencyFinding[] = [];
  let scoreImpact = 0;

  const surplus = ctx.surplusStockItems || [];

  // Check if active offers target surplus items
  for (const item of surplus.slice(0, 3)) {
    // Check active offers
    for (const offer of activeOffers.slice(0, 5)) {
      // Check if offer applies to this product
      const applicableProducts = offer.applicableProductIds || [];
      const applicableCategories = offer.applicableCategories || [];

      const productInApplicable = applicableProducts.includes(item.productId);
      const categoryInApplicable = applicableCategories.includes(item.category || '');

      if (productInApplicable || categoryInApplicable) {
        // Offer targets a product that's in surplus - this could be good (clearance)
        // or problematic (promoting something already overstocked)
        findings.push({
          category: 'inventory',
          severity: 'medium',
          description: `Active offer targets ${item.productName} which is in surplus (${item.surplusQuantity} above ceiling)`,
          affectedId: String(item.productId),
          expected: 'Clear stock reduction',
          actual: `Offer active with ${offer.type}: ${offer.value}${offer.type === 'percentage' ? '%' : ' flat'}`,
        });
        scoreImpact -= 1;
        break; // Only one finding per surplus item
      }
    }
  }

  // Check if combo recommendations use components that are in surplus
  const offerPerformance = ctx.offerPerformance || [];
  for (const offer of offerPerformance.slice(0, 3)) {
    if (offer.type !== 'combo') continue;

    const comboIds = offer.comboProductIds || [];
    for (const item of surplus.slice(0, 3)) {
      if (comboIds.includes(item.productId)) {
        findings.push({
          category: 'combo',
          severity: 'high',
          description: `Combo offer recommends ${item.productName} which is in surplus - may not move excess stock`,
          affectedId: String(item.productId),
          expected: 'Clear excess inventory',
          actual: `Combo active: ${offer.title || 'unnamed combo'}`,
        });
        scoreImpact -= 2;
        break;
      }
    }
  }

  const status = findings.length > 0 ? 'Warning' : 'Pass';

  return {
    name: 'Offer-combo-inventory consistency',
    status,
    findings,
    scoreImpact,
    action: findings.length > 0 ? 'warn' : 'none',
  };
}

/**
 * Get consistency summary for display
 */
export function getConsistencySummary(results: ConsistencyCheckResult[]): {
  totalChecks: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  overallStatus: 'Excellent' | 'Good' | 'Needs attention' | 'Poor';
  message: string;
} {
  const passCount = results.filter(r => r.status === 'Pass').length;
  const warningCount = results.filter(r => r.status === 'Warning').length;
  const failCount = results.filter(r => r.status === 'Fail').length;
  const totalChecks = results.length;

  let overallStatus: 'Excellent' | 'Good' | 'Needs attention' | 'Poor';
  let message: string;

  if (failCount === 0 && warningCount === 0) {
    overallStatus = 'Excellent';
    message = 'All consistency checks pass - operations are stable';
  } else if (failCount === 0 && warningCount <= 2) {
    overallStatus = 'Good';
    message = 'Minor warnings - monitor but no action required';
  } else if (failCount <= 2 && warningCount <= 4) {
    overallStatus = 'Needs attention';
    message = 'Several warnings - review recommended before auto-execution';
  } else {
    overallStatus = 'Poor';
    message = 'Multiple failures - investigate before automated actions';
  }

  return {
    totalChecks,
    passCount,
    warningCount,
    failCount,
    overallStatus,
    message,
  };
}