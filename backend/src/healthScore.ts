/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RestaurantHealthScore — Transparent health dimensions (NOT a single black-box number).
 *
 * Six independent dimensions, each with visible supporting metrics:
 *   - Sales Health
 *   - Margin Health
 *   - Inventory Health
 *   - Customer Health
 *   - Promotion Health
 *   - Data Health
 *
 * Each dimension has a status (Strong/Needs attention/Poor) and supporting metrics.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';

/**
 * Health status levels
 */
export type HealthStatus = 'Strong' | 'Needs attention' | 'Poor';

/**
 * Supporting metric for a health dimension
 */
export interface HealthMetric {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
}

/**
 * Health dimension result
 */
export interface HealthDimension {
  name: string;
  status: HealthStatus;
  score: number; // 0-100, visible to owner
  metrics: HealthMetric[];
  trend?: HealthStatus; // direction from previous period
}

/**
 * Calculate all health dimensions for a restaurant
 */
export function calculateHealthDimensions(
  restaurantId: string,
  ctx: RecommendationContext
): HealthDimension[] {
  const dimensions: HealthDimension[] = [];

  // 1. Sales Health
  dimensions.push(calculateSalesHealth(ctx));

  // 2. Margin Health
  dimensions.push(calculateMarginHealth(ctx));

  // 3. Inventory Health
  dimensions.push(calculateInventoryHealth(ctx));

  // 4. Customer Health
  dimensions.push(calculateCustomerHealth(ctx));

  // 5. Promotion Health
  dimensions.push(calculatePromotionHealth(ctx));

  // 6. Data Health
  dimensions.push(calculateDataHealth(ctx));

  return dimensions;
}

/**
 * 1. Sales Health - based on revenue trends, order volume
 */
function calculateSalesHealth(ctx: RecommendationContext): HealthDimension {
  const sales = ctx.sales;
  const revenue = sales?.monthlyRevenue || 0;
  const orderCount = sales?.orderCount || 0;
  const aov = sales?.averageOrderValue || 0;

  let status: HealthStatus = 'Strong';
  let score = 100;
  const metrics: HealthMetric[] = [];

  // Check revenue trend (compare recent vs previous period)
  const weeklyRevenue = sales?.weeklyRevenue || 0;
  const dailyRevenue = sales?.dailyRevenue || 0;

  metrics.push({
    label: 'Monthly revenue',
    value: `₹${revenue.toLocaleString('en-IN')}`,
    unit: '₹',
    trend: weeklyRevenue > 0 ? 'stable' : 'unknown',
  });

  metrics.push({
    label: 'Order count (30 days)',
    value: orderCount.toLocaleString('en-IN'),
    unit: 'orders',
    trend: orderCount > 0 ? 'stable' : 'unknown',
  });

  metrics.push({
    label: 'Average order value',
    value: `₹${aov.toLocaleString('en-IN')}`,
    unit: '₹',
    trend: aov > 0 ? 'stable' : 'unknown',
  });

  // Determine status based on metrics
  if (revenue < 10000 || orderCount < 20) {
    status = 'Poor';
    score = 30;
  } else if (revenue < 25000 || orderCount < 50) {
    status = 'Needs attention';
    score = 60;
  }

  return {
    name: 'Sales Health',
    status,
    score,
    metrics,
  };
}

/**
 * 2. Margin Health - based on contribution margins, cost risks
 */
function calculateMarginHealth(ctx: RecommendationContext): HealthDimension {
  const margins = ctx.margin?.productMargins || [];
  const costRisers = ctx.margin?.costRisers || [];

  let status: HealthStatus = 'Strong';
  let score = 100;
  const metrics: HealthMetric[] = [];

  // Average contribution margin across products
  if (margins.length > 0) {
    const avgMargin = margins.reduce((sum: number, m: any) => sum + (m.contributionMarginPercent || 0), 0) / margins.length;
    metrics.push({
      label: 'Average contribution margin',
      value: `${Math.round(avgMargin)}%`,
      unit: '%',
      trend: avgMargin >= 30 ? 'up' : avgMargin >= 25 ? 'stable' : 'down',
    });

    if (avgMargin < 20) {
      status = 'Poor';
      score = 35;
    } else if (avgMargin < 25) {
      status = 'Needs attention';
      score = 60;
    }
  } else {
    // No margin data available
    status = 'Poor';
    score = 40;
    metrics.push({
      label: 'Average contribution margin',
      value: 'N/A',
      unit: '%',
      trend: 'unknown',
    });
  }

  // Cost risers impact
  if (costRisers.length > 0) {
    const criticalRisers = costRisers.filter((c: any) => c.pctChange && c.pctChange >= 15);
    metrics.push({
      label: 'Cost risers (≥15% increase)',
      value: criticalRisers.length.toString(),
      unit: 'ingredients',
      trend: criticalRisers.length > 0 ? 'down' : 'stable',
    });

    if (criticalRisers.length > 0) {
      status = status === 'Strong' ? 'Needs attention' : status;
      score = Math.max(0, score - 15);
    }
  }

  // deteriorating products
  const deteriorating = ctx.margin?.deterioratingProducts || [];
  if (deteriorating.length > 0) {
    const severe = deteriorating.filter((d: any) => d.marginDeltaPp && d.marginDeltaPp >= 5);
    metrics.push({
      label: 'Products with margin deterioration',
      value: `${deteriorating.length} products`,
      unit: 'products',
      trend: severe.length > 0 ? 'down' : 'stable',
    });

    if (severe.length > 0) {
      status = status === 'Strong' ? 'Needs attention' : status;
      score = Math.max(0, score - 10);
    }
  }

  return {
    name: 'Margin Health',
    status,
    score,
    metrics,
  };
}

/**
 * 3. Inventory Health - based on stock levels, surplus, expiry
 */
function calculateInventoryHealth(ctx: RecommendationContext): HealthDimension {
  const inventory = ctx.inventory || [];
  const surplus = ctx.surplusStockItems || [];

  let status: HealthStatus = 'Strong';
  let score = 100;
  const metrics: HealthMetric[] = [];

  // Surplus items count
  metrics.push({
    label: 'Surplus items (above 80% stock)',
    value: surplus.length.toString(),
    unit: 'items',
    trend: surplus.length > 0 ? 'down' : 'stable',
  });

  // Low stock items
  const lowStockCount = inventory.filter((i: any) => i.currentStock <= i.minStock && i.minStock > 0).length;
  metrics.push({
    label: 'Low stock items',
    value: lowStockCount.toString(),
    unit: 'items',
    trend: lowStockCount > 0 ? 'down' : 'stable',
  });

  // Stock coverage ratio
  if (inventory.length > 0) {
    const avgCoverage = inventory.reduce((sum: number, i: any) => {
      if (i.maxStock > 0) return sum + (i.currentStock / i.maxStock);
      return sum;
    }, 0) / inventory.length;

    metrics.push({
      label: 'Average stock coverage',
      value: `${Math.round(avgCoverage * 100)}%`,
      unit: '%',
      trend: avgCoverage >= 0.8 ? 'stable' : avgCoverage >= 0.5 ? 'caution' : 'low',
    });

    if (avgCoverage > 1.2) {
      // Overstocked
      status = 'Needs attention';
      score = 70;
    } else if (avgCoverage < 0.3) {
      // Understocked
      status = 'Needs attention';
      score = 65;
    }
  }

  if (surplus.length > 3) {
    status = 'Needs attention';
    score = Math.max(0, score - 20);
    metrics.push({
      label: 'Warning: Many surplus items',
      value: `${surplus.length} items need promotion`,
      unit: 'items',
      trend: 'down',
    });
  }

  return {
    name: 'Inventory Health',
    status,
    score,
    metrics,
  };
}

/**
 * 4. Customer Health - based on active customers, repeat rate, dormancy
 */
function calculateCustomerHealth(ctx: RecommendationContext): HealthDimension {
  const customerCount = ctx.customerCount || 0;
  const activeCustomers = ctx.activeCustomers || 0;
  const dormant30d = ctx.dormant30d || 0;
  const vipCount = ctx.vipCount || 0;

  let status: HealthStatus = 'Strong';
  let score = 100;
  const metrics: HealthMetric[] = [];

  // Customer growth/activity metrics
  metrics.push({
    label: 'Total customers',
    value: customerCount.toLocaleString('en-IN'),
    unit: 'customers',
    trend: customerCount > 0 ? 'stable' : 'unknown',
  });

  // Active customer rate
  if (customerCount > 0) {
    const activeRate = (activeCustomers / customerCount) * 100;
    metrics.push({
      label: 'Active customer rate',
      value: `${Math.round(activeRate)}%`,
      unit: '%',
      trend: activeRate >= 40 ? 'up' : activeRate >= 25 ? 'stable' : 'down',
    });

    if (activeRate < 20) {
      status = 'Needs attention';
      score = 60;
    }
  }

  // Dormant customers
  metrics.push({
    label: 'Dormant (30+ days)',
    value: dormant30d.toLocaleString('en-IN'),
    unit: 'customers',
    trend: dormant30d > 0 ? 'down' : 'stable',
  });

  if (dormant30d > customerCount * 0.3) {
    // More than 30% dormant
    status = status === 'Strong' ? 'Needs attention' : status;
    score = Math.max(0, score - 15);
  }

  // VIP customers (positive signal)
  metrics.push({
    label: 'VIP customers',
    value: vipCount.toString(),
    unit: 'customers',
    trend: vipCount > 0 ? 'up' : 'stable',
  });

  if (vipCount > 0 && vipCount / customerCount > 0.1) {
    // More than 10% VIP - healthy loyalty
    if (status === 'Strong') {
      score = Math.min(100, score + 5);
    }
  }

  return {
    name: 'Customer Health',
    status,
    score,
    metrics,
  };
}

/**
 * 5. Promotion Health - based on promotion effectiveness, frequency, success
 */
function calculatePromotionHealth(ctx: RecommendationContext): HealthDimension {
  const offerPerformance = ctx.offerPerformance || [];

  let status: HealthStatus = 'Strong';
  let score = 100;
  const metrics: HealthMetric[] = [];

  // Effective promotion count (redemptions >= 3)
  const effectivePromos = offerPerformance.filter(
    (o: any) => o.redemptions >= 3 && o.revenueGenerated > 0
  ).length;

  metrics.push({
    label: 'Effective past promotions',
    value: effectivePromos.toString(),
    unit: 'promotions',
    trend: effectivePromos > 0 ? 'stable' : 'unknown',
  });

  // Success rate approximation
  if (offerPerformance.length > 0) {
    const successRate = (effectivePromos / offerPerformance.length) * 100;
    metrics.push({
      label: 'Promotion success rate',
      value: `${Math.round(successRate)}%`,
      unit: '%',
      trend: successRate >= 60 ? 'up' : successRate >= 30 ? 'stable' : 'down',
    });

    if (successRate < 30) {
      status = 'Needs attention';
      score = 60;
    }
  }

  // Average discount from past promos
  const discounts = offerPerformance
    .filter((o: any) => o.discountGiven && o.discountGiven > 0)
    .map((o: any) => o.discountGiven);

  if (discounts.length > 0) {
    const avgDiscount = discounts.reduce((sum: number, d: any) => sum + d, 0) / discounts.length;
    metrics.push({
      label: 'Average discount offered',
      value: `${Math.round(avgDiscount)}%`,
      unit: '%',
      trend: 'stable',
    });

    if (avgDiscount > 25) {
      status = status === 'Strong' ? 'Needs attention' : status;
      score = Math.max(0, score - 10);
    }
  }

  return {
    name: 'Promotion Health',
    status,
    score,
    metrics,
  };
}

/**
 * 6. Data Health - based on data freshness, completeness, quality
 */
function calculateDataHealth(ctx: RecommendationContext): HealthDimension {
  const sales = ctx.sales;
  const inventory = ctx.inventory;
  const margin = ctx.margin;
  const products = ctx.products || [];

  let status: HealthStatus = 'Good';
  let score = 95;
  const metrics: HealthMetric[] = [];

  // Sales data freshness (bills from last 30 days)
  if (sales) {
    const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // We can't easily check exact freshness here, but we can check if data exists
    metrics.push({
      label: 'Sales data freshness',
      value: sales.orderCount > 0 ? 'Current (30d)' : 'Stale',
      unit: '',
      trend: sales.orderCount > 0 ? 'stable' : 'unknown',
    });

    if (sales.orderCount === 0) {
      status = 'Poor';
      score = 40;
    }
  } else {
    status = 'Poor';
    score = 30;
    metrics.push({
      label: 'Sales data freshness',
      value: 'No data',
      unit: '',
      trend: 'unknown',
    });
  }

  // Inventory data completeness
  if (inventory) {
    const hasStockData = inventory.some((i: any) => typeof i.currentStock === 'number');
    const hasStockLimits = inventory.some((i: any) => i.maxStock > 0 || i.minStock > 0);

    metrics.push({
      label: 'Inventory data completeness',
      value: hasStockData && hasStockLimits ? 'Complete' : 'Partial',
      unit: '',
      trend: 'stable',
    });

    if (!hasStockData) {
      status = status === 'Good' ? 'Needs attention' : status;
      score = Math.max(0, score - 20);
    }
  } else {
    metrics.push({
      label: 'Inventory data completeness',
      value: 'Not tracked',
      unit: '',
      trend: 'unknown',
    });
    if (status !== 'Poor') {
      status = 'Needs attention';
      score = 60;
    }
  }

  // Recipe/product completeness
  const productsWithRecipes = products.filter((p: any) => p.recipeCost !== undefined && p.recipeCost > 0).length;
  const recipeCompletionRate = products.length > 0 ? (productsWithRecipes / products.length) * 100 : 0;

  metrics.push({
    label: 'Recipe completeness',
    value: `${Math.round(recipeCompletionRate)}%`,
    unit: '%',
    trend: recipeCompletionRate >= 80 ? 'up' : recipeCompletionRate >= 50 ? 'stable' : 'down',
  });

  if (recipeCompletionRate < 50) {
    status = status === 'Good' ? 'Needs attention' : status;
    score = Math.max(0, score - 15);
  }

  // Offer performance data
  metrics.push({
    label: 'Offer analytics available',
    value: ctx.offerPerformance?.length > 0 ? 'Yes' : 'Limited',
    unit: '',
    trend: 'stable',
  });

  return {
    name: 'Data Health',
    status,
    score,
    metrics,
  };
}

/**
 * Get summary status text for display
 */
export function getStatusText(status: HealthStatus): string {
  switch (status) {
    case 'Strong':
      return 'Strong';
    case 'Needs attention':
      return 'Needs attention';
    case 'Poor':
      return 'Poor';
    default:
      return 'Unknown';
  }
}

/**
 * Get color/emoji for status display
 */
export function getStatusEmoji(status: HealthStatus): string {
  switch (status) {
    case 'Strong':
      return '✅';
    case 'Needs attention':
      return '⚠️';
    case 'Poor':
      return '❌';
    default:
      return '❓';
  }
}