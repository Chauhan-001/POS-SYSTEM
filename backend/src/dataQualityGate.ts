/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DataQualityGate — Quality checks before using intelligence.
 *
 * Ensures data freshness and validity before recommendations,
 * forecasts, and automated actions are generated.
 *
 * If data quality is poor: "Limited intelligence" rather than
 * pretending everything is accurate.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { AutomationPolicy } from '../services/restaurantIntelligenceOrchestrator';
import type { HealthDimension } from './healthScore';

/**
 * Data quality gate result
 */
export interface DataQualityGateResult {
  /** Overall data quality status */
  status: 'Excellent' | 'Good' | 'Limited' | 'Poor';

  /** Score 0-100 */
  score: number;

  /** Checks performed */
  checks: DataCheckResult[];

  /** Recommendation */
  message: string;

  /** Affected operations */
  affectedOperations: string[];

  /** Suggested actions */
  suggestedActions: string[];
}

/**
 * Individual data check result
 */
export interface DataCheckResult {
  name: string;
  status: 'Pass' | 'Warning' | 'Fail';
  detail: string;
  scoreImpact: number; // positive or negative impact on overall score
}

/**
 * Run data quality gate for a restaurant
 */
export function runDataQualityGate(
  restaurantId: string,
  ctx: RecommendationContext,
  policy: AutomationPolicy
): DataQualityGateResult {
  const checks: DataCheckResult[] = [];
  let totalScore = 100;
  let passed = 0;
  let warnings = 0;
  let failures = 0;

  // 1. Sales data freshness
  const salesCheck = checkSalesDataFreshness(ctx.sales);
  checks.push(salesCheck);
  totalScore += salesCheck.scoreImpact;
  if (salesCheck.status === 'Pass') passed++;
  else if (salesCheck.status === 'Warning') warnings++;
  else failures++;

  // 2. Inventory data freshness
  const inventoryCheck = checkInventoryDataFreshness(ctx.inventory);
  checks.push(inventoryCheck);
  totalScore += inventoryCheck.scoreImpact;
  if (inventoryCheck.status === 'Pass') passed++;
  else if (inventoryCheck.status === 'Warning') warnings++;
  else failures++;

  // 3. Recipe completeness
  const recipeCheck = checkRecipeCompleteness(ctx.products || []);
  checks.push(recipeCheck);
  totalScore += recipeCheck.scoreImpact;
  if (recipeCheck.status === 'Pass') passed++;
  else if (recipeCheck.status === 'Warning') warnings++;
  else failures++;

  // 4. Pricing validity
  const pricingCheck = checkPricingValidity(ctx.products || []);
  checks.push(pricingCheck);
  totalScore += pricingCheck.scoreImpact;
  if (pricingCheck.status === 'Pass') passed++;
  else if (pricingCheck.status === 'Warning') warnings++;
  else failures++;

  // 5. Customer data quality
  const customerCheck = checkCustomerDataQuality(ctx.customerCount, ctx.dormant30d || 0);
  checks.push(customerCheck);
  totalScore += customerCheck.scoreImpact;
  if (customerCheck.status === 'Pass') passed++;
  else if (customerCheck.status === 'Warning') warnings++;
  else failures++;

  // 6. Offer consistency
  const offerCheck = checkOfferConsistency(ctx.offerPerformance || []);
  checks.push(offerCheck);
  totalScore += offerCheck.scoreImpact;
  if (offerCheck.status === 'Pass') passed++;
  else if (offerCheck.status === 'Warning') warnings++;
  else failures++;

  // 7. Margin data validity
  const marginCheck = checkMarginDataValidity(ctx.margin);
  checks.push(marginCheck);
  totalScore += marginCheck.scoreImpact;
  if (marginCheck.status === 'Pass') passed++;
  else if (marginCheck.status === 'Warning') warnings++;
  else failures++;

  // Clamp score to 0-100
  totalScore = Math.max(0, Math.min(100, totalScore));

  // Determine overall status
  let status: 'Excellent' | 'Good' | 'Limited' | 'Poor';
  let message: string;
  let affectedOperations: string[] = [];
  let suggestedActions: string[] = [];

  switch (true) {
    case totalScore >= 80 && failures === 0:
      status = 'Excellent';
      message = 'Data quality is excellent. Full intelligence available.';
      affectedOperations = [
        'recommendations',
        'forecasts',
        'automated promotions',
        'health scores',
        'advisor chat',
      ];
      suggestedActions = [];
      break;

    case totalScore >= 60 && failures <= 1:
      status = 'Good';
      message = 'Data quality is good. Most intelligence operations available.';
      affectedOperations = [
        'recommendations',
        'forecasts',
        'health scores',
        'advisor chat',
      ];
      suggestedActions = [
        'Monitor for data quality changes',
      ];
      break;

    case totalScore >= 40:
      status = 'Limited';
      message = 'Data quality is limited. Intelligence available with reduced confidence.';
      affectedOperations = [
        'automated promotions',
        'some recommendations',
        'health score accuracy',
      ];
      suggestedActions = [
        'Update missing recipe costs',
        'Refresh inventory records',
        'Add recent bill data',
      ];
      break;

    default:
      status = 'Poor';
      message = 'Data quality is poor. Limited intelligence only. Verify data sources.';
      affectedOperations = [
        'all automated actions',
        'recommendations',
        'forecasts',
        'health scores',
      ];
      suggestedActions = [
        'Rebuild data from source systems',
        'Contact system administrator',
        'Manual review required for all decisions',
      ];
      break;
  }

  return {
    status,
    score: totalScore,
    checks,
    message,
    affectedOperations,
    suggestedActions,
  };
}

/**
 * Check sales data freshness
 */
function checkSalesDataFreshness(sales: any): DataCheckResult {
  if (!sales) {
    return {
      name: 'Sales data freshness',
      status: 'Fail',
      detail: 'No sales data available - no bills found in system',
      scoreImpact: -30,
    };
  }

  const orderCount = sales.orderCount || 0;
  if (orderCount < 5) {
    return {
      name: 'Sales data freshness',
      status: 'Fail',
      detail: `Insufficient sales data: ${orderCount} orders (minimum 5 required)`,
      scoreImpact: -30,
    };
  }

  if (orderCount < 20) {
    return {
      name: 'Sales data freshness',
      status: 'Warning',
      detail: `Limited sales data: ${orderCount} orders (recommended: 50+ bills)`,
      scoreImpact: -10,
    };
  }

  // Check if we have multi-day data (not just today)
  const hasWeeklyData = sales.weeklyRevenue > 0;
  const hasHourlyData = sales.hourlyPerformance && sales.hourlyPerformance.length === 24;

  if (hasWeeklyData && hasHourlyData) {
    return {
      name: 'Sales data freshness',
      status: 'Pass',
      detail: `${orderCount} orders, full weekly and hourly performance available`,
      scoreImpact: 5,
    };
  }

  return {
    name: 'Sales data freshness',
    status: 'Pass',
    detail: `${orderCount} orders available`,
    scoreImpact: 2,
  };
}

/**
 * Check inventory data freshness
 */
function checkInventoryDataFreshness(inventory: any): DataCheckResult {
  if (!inventory) {
    return {
      name: 'Inventory data freshness',
      status: 'Warning',
      detail: 'No inventory data tracked - reorder-level data missing',
      scoreImpact: -15,
    };
  }

  const itemsWithStock = inventory.filter((i: any) => typeof i.currentStock === 'number');
  const itemsWithLimits = inventory.filter((i: any) => i.maxStock > 0 || i.minStock > 0);

  if (itemsWithStock.length === 0) {
    return {
      name: 'Inventory data freshness',
      status: 'Fail',
      detail: 'No stock level data found',
      scoreImpact: -20,
    };
  }

  if (itemsWithLimits.length / inventory.length < 0.5) {
    return {
      name: 'Inventory data freshness',
      status: 'Warning',
      detail: `${itemsWithLimits.length}/${inventory.length} items have stock limits configured`,
      scoreImpact: -10,
    };
  }

  const hasRecentUpdates = inventory.some((i: any) => i.currentStock > 0);
  if (!hasRecentUpdates) {
    return {
      name: 'Inventory data freshness',
      status: 'Warning',
      detail: 'Inventory data exists but no recent stock updates detected',
      scoreImpact: -5,
    };
  }

  return {
    name: 'Inventory data freshness',
    status: 'Pass',
    detail: `${itemsWithStock.length} items with stock levels tracked`,
    scoreImpact: 5,
  };
}

/**
 * Check recipe completeness
 */
function checkRecipeCompleteness(products: any[]): DataCheckResult {
  if (products.length === 0) {
    return {
      name: 'Recipe completeness',
      status: 'Fail',
      detail: 'No products found in menu',
      scoreImpact: -25,
    };
  }

  const productsWithRecipeCost = products.filter(
    (p: any) => p.recipeCost !== undefined && p.recipeCost > 0
  );

  const completionRate = products.length > 0
    ? (productsWithRecipeCost.length / products.length) * 100
    : 0;

  if (completionRate === 0) {
    return {
      name: 'Recipe completeness',
      status: 'Fail',
      detail: 'No products have recipe costs - all contribution estimates limited',
      scoreImpact: -30,
    };
  }

  if (completionRate < 50) {
    return {
      name: 'Recipe completeness',
      status: 'Warning',
      detail: `${Math.round(completionRate)}% of products have recipe costs (50%+ recommended)`,
      scoreImpact: -15,
    };
  }

  if (completionRate < 80) {
    return {
      name: 'Recipe completeness',
      status: 'Warning',
      detail: `${Math.round(completionRate)}% of products have recipe costs`,
      scoreImpact: -8,
    };
  }

  return {
    name: 'Recipe completeness',
    status: 'Pass',
    detail: `${Math.round(completionRate)}% of products have complete recipes`,
    scoreImpact: 5,
  };
}

/**
 * Check pricing validity
 */
function checkPricingValidity(products: any[]): DataCheckResult {
  if (products.length === 0) {
    return {
      name: 'Pricing validity',
      status: 'Fail',
      detail: 'No products to validate pricing against',
      scoreImpact: -10,
    };
  }

  const invalidPrices = products.filter(
    (p: any) => p.price === undefined || p.price <= 0 || p.averageCost === undefined || p.averageCost < 0
  );

  const missingGST = products.filter((p: any) => p.gstPercent === undefined);

  if (invalidPrices.length > products.length * 0.5) {
    return {
      name: 'Pricing validity',
      status: 'Fail',
      detail: `${invalidPrices.length} products have invalid pricing (price ≤ 0 or cost < 0)`,
      scoreImpact: -25,
    };
  }

  if (invalidPrices.length > 0) {
    return {
      name: 'Pricing validity',
      status: 'Warning',
      detail: `${invalidPrices.length} products have pricing issues`,
      scoreImpact: -5,
    };
  }

  if (missingGST.length > products.length * 0.5) {
    return {
      name: 'Pricing validity',
      status: 'Warning',
      detail: `${missingGST.length} products missing GST percentage`,
      scoreImpact: -5,
    };
  }

  return {
    name: 'Pricing validity',
    status: 'Pass',
    detail: 'All product prices and costs valid',
    scoreImpact: 5,
  };
}

/**
 * Check customer data quality
 */
function checkCustomerDataQuality(customerCount: number, dormant30d: number): DataCheckResult {
  if (customerCount < 10) {
    return {
      name: 'Customer data quality',
      status: 'Fail',
      detail: `Very few customers: ${customerCount} (minimum 10 required for segmentation)`,
      scoreImpact: -20,
    };
  }

  if (customerCount < 50) {
    return {
      name: 'Customer data quality',
      status: 'Warning',
      detail: `Limited customer base: ${customerCount} (recommended: 50+ for meaningful segments)`,
      scoreImpact: -10,
    };
  }

  // Check dormancy rate
  if (dormant30d > 0 && customerCount > 0) {
    const dormancyRate = (dormant30d / customerCount) * 100;
    if (dormancyRate > 60) {
      return {
        name: 'Customer data quality',
        status: 'Warning',
        detail: `${dormancyRate.toFixed(0)}% of customers dormant (30+ days) - high churn risk`,
        scoreImpact: -5,
      };
    }
  }

  return {
    name: 'Customer data quality',
    status: 'Pass',
    detail: `${customerCount} customers, data quality adequate`,
    scoreImpact: 5,
  };
}

/**
 * Check offer consistency
 */
function checkOfferConsistency(offerPerformance: any[]): DataCheckResult {
  if (offerPerformance.length === 0) {
    return {
      name: 'Offer consistency',
      status: 'Warning',
      detail: 'No offer performance data - no historical promotions run',
      scoreImpact: -10,
    };
  }

  const validOffers = offerPerformance.filter(
    (o: any) => o.type && o.value !== undefined && o.revenueGenerated >= 0
  );

  if (validOffers.length / offerPerformance.length < 0.5) {
    return {
      name: 'Offer consistency',
      status: 'Warning',
      detail: `Less than half of ${offerPerformance.length} offers have valid performance data`,
      scoreImpact: -15,
    };
  }

  // Check for duplicate/duplicate-like offers
  const discountRates = validOffers.filter((o: any) => o.discountGiven && o.revenueGenerated > 0)
    .map((o: any) => o.discountGiven / Math.max(o.revenueGenerated, 1) * 100);

  if (discountRates.length > 0) {
    const avgDiscount = discountRates.reduce((a: number, b: number) => a + b, 0) / discountRates.length;
    if (avgDiscount > 30) {
      return {
        name: 'Offer consistency',
        status: 'Warning',
        detail: `Average discount rate ${Math.round(avgDiscount)}% is high - may indicate over-promotion`,
        scoreImpact: -5,
      };
    }
  }

  return {
    name: 'Offer consistency',
    status: 'Pass',
    detail: `${validOffers.length}/${offerPerformance.length} offers with valid data`,
    scoreImpact: 5,
  };
}

/**
 * Check margin data validity
 */
function checkMarginDataValidity(margin: any): DataCheckResult {
  if (!margin) {
    return {
      name: 'Margin data validity',
      status: 'Warning',
      detail: 'No margin data available - using average cost estimates',
      scoreImpact: -10,
    };
  }

  const productMargins = margin.productMargins || [];
  if (productMargins.length === 0) {
    return {
      name: 'Margin data validity',
      status: 'Warning',
      detail: 'No product margin data found',
      scoreImpact: -15,
    };
  }

  // Check for implausible margins
  const thinMargins = productMargins.filter(
    (m: any) => m.contributionMarginPercent !== undefined && m.contributionMarginPercent < 10
  );

  const negativeMargins = productMargins.filter(
    (m: any) => m.contributionMarginPercent !== undefined && m.contributionMarginPercent < 0
  );

  if (negativeMargins.length > 0) {
    return {
      name: 'Margin data validity',
      status: 'Fail',
      detail: `${negativeMargins.length} products have negative contribution margin`,
      scoreImpact: -30,
    };
  }

  if (thinMargins.length / productMargins.length > 0.3) {
    return {
      name: 'Margin data validity',
      status: 'Warning',
      detail: `${thinMargins.length}/${productMargins.length} products have thin margins (<10%)`,
      scoreImpact: -10,
    };
  }

  // Check for cost risers
  const costRisers = margin.costRisers || [];
  const criticalRisers = costRisers.filter((c: any) => c.pctChange && c.pctChange >= 15);

  if (criticalRisers.length > 0) {
    return {
      name: 'Margin data validity',
      status: 'Warning',
      detail: `${criticalRisers.length} ingredients with cost increases >= 15%`,
      scoreImpact: -5,
    };
  }

  return {
    name: 'Margin data validity',
    status: 'Pass',
    detail: `${productMargins.length} products with margin data, all valid`,
    scoreImpact: 5,
  };
}

/**
 * Get data quality message for display
 */
export function getDataQualityMessage(gateResult: DataQualityGateResult): string {
  switch (gateResult.status) {
    case 'Excellent':
      return '✅ Full intelligence available - all systems operational';
    case 'Good':
      return '⚡ Most intelligence available - minor data gaps';
    case 'Limited':
      return '⚠️ Limited intelligence - some recommendations may be constrained';
    case 'Poor':
      return '❌ Limited intelligence - verify data before making decisions';
    default:
      return '?';
  }
}

/**
 * Get affected operations summary
 */
export function getAffectedOperationsSummary(gateResult: DataQualityGateResult): string {
  if (gateResult.affectedOperations.length === 0) {
    return 'No operations affected';
  }

  if (gateResult.status === 'Excellent' || gateResult.status === 'Good') {
    return `Full operations available (${gateResult.affectedOperations.join(', ')})`;
  }

  // For Limited/Poor, list what's affected and what's restricted
  const restricted = gateResult.affectedOperations.filter(
    op => op === 'automated promotions' || op === 'all automated actions'
  );
  const available = gateResult.affectedOperations.filter(
    op => !restricted.includes(op)
  );

  let summary = '';
  if (available.length > 0) {
    summary += `Available: ${available.join(', ')}. `;
  }
  if (restricted.length > 0) {
    summary += `Restricted: ${restricted.join(', ')}. `;
  }
  return summary.trim();
}