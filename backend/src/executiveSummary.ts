/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExecutiveRestaurantSummary — Simple overview understandable within seconds.
 *
 * Format:
 *   Today's Sales      ₹42,300
 *   AOV               ₹387
 *   Contribution      ₹18,200
 *   Forecast          +7%
 *   Top Opportunity   Burger Combo
 *   Top Risk          Paneer Stock
 *   Customer Opportunity  214 inactive customers
 */

import mongoose from 'mongoose';
import RestaurantIntelligenceOrchestrator from '../services/restaurantIntelligenceOrchestrator';
import type { AutomationPolicy, AutomationLevel, BusinessObjective } from '../services/restaurantIntelligenceOrchestrator';
import type { RecommendationContext } from './recommendationContext';
import type { HealthDimension } from './healthScore';

/**
 * Generate the executive restaurant summary
 */
export function generateExecutiveSummary(
  restaurantId: string,
  policy: AutomationPolicy,
  objective: BusinessObjective,
  automationLevel: AutomationLevel,
  ctx?: RecommendationContext
): string {
  // Get health dimensions
  const dimensions: HealthDimension[] = ctx
    ? calculateHealthDimensions(restaurantId, ctx)
    : [];

  // Find specific dimensions by name
  const salesHealth = dimensions.find(d => d.name === 'Sales Health');
  const marginHealth = dimensions.find(d => d.name === 'Margin Health');
  const inventoryHealth = dimensions.find(d => d.name === 'Inventory Health');
  const customerHealth = dimensions.find(d => d.name === 'Customer Health');
  const promotionHealth = dimensions.find(d => d.name === 'Promotion Health');
  const dataHealth = dimensions.find(d => d.name === 'Data Health');

  // Get ranked recommendations
  const orchestrator = new RestaurantIntelligenceOrchestrator(policy, objective, automationLevel);
  const ranked = orchestrator.rankRecommendations(restaurantId);

  // Get top opportunity from recommendations
  const topOpportunity = ranked.length > 0 ? ranked[0].title : 'None';

  // Get top risk
  const topRisk = inventoryHealth?.status === 'Poor' ||
    (inventoryHealth?.metrics?.some((m: any) => String(m.value).includes('Low stock')))
    ? 'Inventory at risk'
    : ranked.length > 0 && ranked[0].title.toLowerCase().includes('margin')
      ? 'Margin risk'
      : '';

  // Get customer opportunity
  const customerOpportunity = customerHealth?.metrics?.find(
    (m: any) => m.label === 'Dormant (30+ days)'
  )?.value || '0';

  // Sales figures
  const sales = ctx?.sales;
  const dailyRevenue = sales?.dailyRevenue || 0;
  const aov = sales?.averageOrderValue || 0;
  const monthlyRevenue = sales?.monthlyRevenue || 0;

  // Contribution
  const margins = ctx?.margin?.productMargins || [];
  const contribution = margins.reduce((sum: number, m: any) => sum + (m.totalContribution || 0), 0) || 0;

  // Forecast change (placeholder - would come from forecast service)
  const forecastChange = 5; // +5% as default

  // Format numbers using Indian locale
  const formatINR = (n: number): string =>
    `₹${Math.round(n).toLocaleString('en-IN')}`;

  const forecastSign = forecastChange >= 0 ? '+' : '';
  const forecastStr = `${forecastSign}${forecastChange}%`;

  return `${formatINR(dailyRevenue)}
AOV
${formatINR(aov)}
Contribution
${formatINR(contribution)}
Forecast
${forecastStr}

Top Opportunity
${topOpportunity}

Top Risk
${topRisk || 'None'}

Customer Opportunity
${customerOpportunity} inactive customers`;
}

/**
 * Generate a concise "at-a-glance" summary for UI tiles
 */
export function generateSummaryTiles(
  restaurantId: string,
  policy: AutomationPolicy,
  objective: BusinessObjective,
  automationLevel: AutomationLevel,
  ctx?: RecommendationContext
): Array<{ label: string; value: string; status?: HealthStatus; trend?: 'up' | 'down' | 'stable' }> {
  const dimensions: HealthDimension[] = ctx
    ? calculateHealthDimensions(restaurantId, ctx)
    : [];

  const tiles: Array<{ label: string; value: string; status?: HealthStatus; trend?: 'up' | 'down' | 'stable' }> = [];

  // Find dimensions
  const salesHealth = dimensions.find(d => d.name === 'Sales Health');
  const marginHealth = dimensions.find(d => d.name === 'Margin Health');
  const inventoryHealth = dimensions.find(d => d.name === 'Inventory Health');
  const customerHealth = dimensions.find(d => d.name === 'Customer Health');

  // Sales tile
  const sales = ctx?.sales;
  tiles.push({
    label: 'Today Sales',
    value: sales ? `₹${sales.dailyRevenue.toLocaleString('en-IN')}` : 'N/A',
    status: salesHealth?.status,
    trend: salesHealth?.trend,
  });

  // AOV tile
  tiles.push({
    label: 'AOV',
    value: sales ? `₹${sales.averageOrderValue.toLocaleString('en-IN')}` : 'N/A',
  });

  // Contribution tile
  const margins = ctx?.margin?.productMargins || [];
  const contribution = margins.reduce((sum: number, m: any) => sum + (m.totalContribution || 0), 0) || 0;
  tiles.push({
    label: 'Contribution',
    value: contribution > 0 ? `₹${contribution.toLocaleString('en-IN')}` : 'N/A',
  });

  // Forecast tile
  const forecastChange = 5;
  tiles.push({
    label: 'Forecast',
    value: `+${forecastChange}%`,
  });

  // Top opportunity
  const ranked = orchestrator.rankRecommendations(restaurantId);
  tiles.push({
    label: 'Top Opportunity',
    value: ranked.length > 0 ? ranked[0].title : '—',
  });

  // Top risk
  tiles.push({
    label: 'Top Risk',
    value: inventoryHealth?.status === 'Poor' ? 'Inventory' :
      marginHealth?.status === 'Poor' ? 'Margin' :
      customerHealth?.status === 'Poor' ? 'Customers' :
      '',
  });

  // Customer opportunity
  const dormant = customerHealth?.metrics?.find((m: any) => m.label === 'Dormant (30+ days)');
  tiles.push({
    label: 'Inactive Customers',
    value: dormant?.value || '0',
  });

  return tiles;
}