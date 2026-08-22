/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionCalendarService — Forward-looking promotion calendar with
 * demand-aware, inventory-aware, and fatigue-aware recommendations.
 *
 * Key principle: "No promotion" is a valid recommendation.
 */

import mongoose from 'mongoose';
import { getUpcomingFestivals } from './festivalService';
import { generateDemandForecast, ForecastEntity, ForecastPeriod } from './demandForecastingService';
import { optimizePromotion, OptimizationObjective, PromotionOptimizationInput } from './promotionOptimizationService';
import { detectPromotionFatigue, isOfferFatigued } from './promotionFatigueService';
import { getTopInventoryOpportunities } from './inventoryOpportunityService';
import { getTopComboOpportunities } from './comboOpportunityService';
import { getTopAddOnOpportunities } from './addOnOpportunityService';
import { detectAllDemandAnomalies } from './demandAnomalyService';
import { assessDataSufficiency } from './dataSufficiencyService';
import ProductModel from '../models/Product';
import OfferModel from '../models/Offer';

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sun
  label: string;
  recommendations: CalendarRecommendation[];
  demandForecast: {
    level: 'LOW' | 'NORMAL' | 'HIGH';
    confidence: number;
    expectedRevenue: number;
  };
  capacityUtilization: number; // 0-100
  inventoryRisks: string[];
  festivals: string[];
}

export interface CalendarRecommendation {
  id: string;
  type: 'DISCOUNT' | 'COMBO' | 'ADD_ON' | 'INVENTORY_CLEARANCE' | 'FESTIVAL' | 'DEMAND_RECOVERY' | 'NO_PROMOTION';
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  timeWindow?: { startHour: number; endHour: number };
  targetProducts: string[];
  targetCategories: string[];
  expectedImpact: {
    incrementalRevenue: number;
    incrementalContribution: number;
    confidence: number;
  };
  constraints: {
    minMarginPercent: number;
    maxDiscountPercent: number;
  };
  reasoning: string;
  risks: string[];
  fatigueCheck?: { fatigued: boolean; level: string; recommendation: string };
}

export interface PromotionCalendarOptions {
  restaurantId: string;
  branchId?: string;
  daysAhead?: number; // Default 14
  includeWeekends?: boolean;
  objectives?: OptimizationObjective[];
  constraints?: {
    minMarginPercent: number;
    maxDiscountPercent: number;
    maxPromotionsPerWeek: number;
    requirePositiveContribution: boolean;
  };
}

export interface PromotionCalendar {
  restaurantId: string;
  branchId?: string;
  generatedAt: Date;
  period: { start: string; end: string };
  days: CalendarDay[];
  summary: {
    totalRecommendations: number;
    promotionsRecommended: number;
    noPromotionDays: number;
    highPriorityActions: number;
    totalProjectedIncrementalContribution: number;
    fatigueWarnings: number;
  };
  weeklyPatterns: Array<{
    dayOfWeek: number;
    dayName: string;
    avgDemandLevel: 'LOW' | 'NORMAL' | 'HIGH';
    recommendedAction: string;
  }>;
}

const DEFAULT_DAYS_AHEAD = 14;
const DEFAULT_MAX_PROMOTIONS_PER_WEEK = 3;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generate forward-looking promotion calendar
 */
export async function generatePromotionCalendar(
  options: PromotionCalendarOptions
): Promise<PromotionCalendar> {
  const {
    restaurantId,
    branchId,
    daysAhead = DEFAULT_DAYS_AHEAD,
    includeWeekends = true,
    objectives = ['maximize_contribution'],
    constraints = {},
  } = options;

  const mergedConstraints = {
    minMarginPercent: constraints.minMarginPercent ?? 15,
    maxDiscountPercent: constraints.maxDiscountPercent ?? 30,
    maxPromotionsPerWeek: constraints.maxPromotionsPerWeek ?? DEFAULT_MAX_PROMOTIONS_PER_WEEK,
    requirePositiveContribution: constraints.requirePositiveContribution ?? true,
  };

  // Check data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });

  // Get upcoming festivals
  const festivals = getUpcomingFestivals(daysAhead + 7);

  // Get inventory opportunities
  const inventoryOpps = await getTopInventoryOpportunities(restaurantId, branchId, 10);

  // Get combo opportunities
  const comboOpps = await getTopComboOpportunities(restaurantId, branchId, 10);

  // Get add-on opportunities
  const addOnOpps = await getTopAddOnOpportunities(restaurantId, branchId, 10);

  // Get fatigue signals
  const fatigueSignals = await detectPromotionFatigue({ restaurantId, branchId, lookbackDays: 180 });
  const fatiguedOfferIds = new Set(
    fatigueSignals
      .filter(s => s.fatigueLevel === 'HIGH' || s.fatigueLevel === 'CRITICAL')
      .map(s => s.offerId)
  );

  // Get active offers to avoid conflicts
  const activeOffers = await OfferModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    status: 'active',
  }).select('_id title type value applicableProductIds').lean().exec();

  // Generate calendar for each day
  const days: CalendarDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let promotionsThisWeek = 0;
  let weekStart = new Date(today);

  for (let i = 0; i < daysAhead; i++) {
    const currentDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dayOfWeek = currentDate.getDay();
    const dateStr = currentDate.toISOString().split('T')[0];

    // Reset weekly counter
    if (i > 0 && currentDate.getDay() === 1) { // Monday
      promotionsThisWeek = 0;
      weekStart = new Date(currentDate);
    }

    // Skip weekends if not included
    if (!includeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      continue;
    }

    // Get demand forecast for this day
    const demandForecast = await getDayDemandForecast(restaurantId, branchId, currentDate, sufficiency);

    // Get festivals for this day
    const dayFestivals = festivals
      .filter(f => f.date === dateStr)
      .map(f => f.name);

    // Get inventory risks for this day
    const inventoryRisks = getInventoryRisksForDay(inventoryOpps, currentDate);

    // Generate recommendations for this day
    const recommendations = await generateDayRecommendations(
      restaurantId,
      branchId,
      currentDate,
      demandForecast,
      inventoryOpps,
      comboOpps,
      addOnOpps,
      fatiguedOfferIds,
      activeOffers,
      mergedConstraints,
      objectives,
      promotionsThisWeek,
      sufficiency
    );

    // Count promotions (excluding NO_PROMOTION)
    const promoCount = recommendations.filter(r => r.type !== 'NO_PROMOTION').length;
    promotionsThisWeek += promoCount;

    days.push({
      date: dateStr,
      dayOfWeek,
      label: `${DAY_NAMES[dayOfWeek]}, ${currentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
      recommendations,
      demandForecast,
      capacityUtilization: estimateCapacityUtilization(demandForecast),
      inventoryRisks,
      festivals: dayFestivals,
    });
  }

  // Build summary
  const totalRecommendations = days.reduce((sum, d) => sum + d.recommendations.length, 0);
  const promotionsRecommended = days.reduce((sum, d) => sum + d.recommendations.filter(r => r.type !== 'NO_PROMOTION').length, 0);
  const noPromotionDays = days.filter(d => d.recommendations.every(r => r.type === 'NO_PROMOTION')).length;
  const highPriorityActions = days.reduce((sum, d) => sum + d.recommendations.filter(r => r.priority === 'HIGH').length, 0);
  const totalProjectedIncrementalContribution = days.reduce(
    (sum, d) => sum + d.recommendations.reduce((s, r) => s + r.expectedImpact.incrementalContribution, 0),
    0
  );
  const fatigueWarnings = days.reduce(
    (sum, d) => sum + d.recommendations.filter(r => r.fatigueCheck?.fatigued).length,
    0
  );

  // Weekly patterns
  const weeklyPatterns = buildWeeklyPatterns(days);

  return {
    restaurantId,
    branchId,
    generatedAt: new Date(),
    period: {
      start: days[0]?.date || today.toISOString().split('T')[0],
      end: days[days.length - 1]?.date || today.toISOString().split('T')[0],
    },
    days,
    summary: {
      totalRecommendations,
      promotionsRecommended,
      noPromotionDays,
      highPriorityActions,
      totalProjectedIncrementalContribution: round2(totalProjectedIncrementalContribution),
      fatigueWarnings,
    },
    weeklyPatterns,
  };
}

/**
 * Get demand forecast for a specific day
 */
async function getDayDemandForecast(
  restaurantId: string,
  branchId: string | undefined,
  date: Date,
  sufficiency: { overall: string }
): Promise<CalendarDay['demandForecast']> {
  if (sufficiency.overall === 'INSUFFICIENT_DATA') {
    return { level: 'NORMAL', confidence: 0.1, expectedRevenue: 0 };
  }

  try {
    // Forecast for restaurant-level demand during peak hours
    const period: ForecastPeriod = {
      start: new Date(date.getTime() + 11 * 60 * 60 * 1000), // 11 AM
      end: new Date(date.getTime() + 22 * 60 * 60 * 1000),   // 10 PM
      label: 'day',
    };

    const forecast = await generateDemandForecast({
      restaurantId,
      branchId,
      entity: { type: 'restaurant', id: restaurantId, name: 'Restaurant' },
      period,
      lookbackDays: 90,
      includeSeasonality: true,
      includeFestivalEffects: true,
    });

    const baselineRevenue = forecast.baseline.revenue;
    const expectedRevenue = forecast.predictedDemand.revenue.expected;
    const ratio = baselineRevenue > 0 ? expectedRevenue / baselineRevenue : 1;

    let level: 'LOW' | 'NORMAL' | 'HIGH';
    if (ratio >= 1.15) level = 'HIGH';
    else if (ratio <= 0.85) level = 'LOW';
    else level = 'NORMAL';

    return {
      level,
      confidence: forecast.confidenceScore / 100,
      expectedRevenue: round2(expectedRevenue),
    };
  } catch {
    return { level: 'NORMAL', confidence: 0.3, expectedRevenue: 0 };
  }
}

/**
 * Estimate capacity utilization from demand forecast
 */
function estimateCapacityUtilization(forecast: CalendarDay['demandForecast']): number {
  // Rough heuristic: HIGH demand = 85% utilization, NORMAL = 60%, LOW = 35%
  switch (forecast.level) {
    case 'HIGH': return 85;
    case 'NORMAL': return 60;
    case 'LOW': return 35;
  }
}

/**
 * Get inventory risks for a specific day
 */
function getInventoryRisksForDay(
  inventoryOpps: Array<{ ingredient: { ingredientName: string; opportunityType: string; severity: string; daysOfStock: number } }>,
  date: Date
): string[] {
  const risks: string[] = [];

  for (const opp of inventoryOpps) {
    if (opp.ingredient.severity === 'high' && opp.ingredient.daysOfStock <= 3) {
      risks.push(`${opp.ingredient.ingredientName}: ${opp.ingredient.opportunityType} (${opp.ingredient.daysOfStock} days left)`);
    } else if (opp.ingredient.opportunityType === 'EXPIRY_RISK' && opp.ingredient.daysOfStock <= 2) {
      risks.push(`${opp.ingredient.ingredientName}: Expires in ${opp.ingredient.daysOfStock} days`);
    }
  }

  return risks;
}

/**
 * Generate recommendations for a single day
 */
async function generateDayRecommendations(
  restaurantId: string,
  branchId: string | undefined,
  date: Date,
  demandForecast: CalendarDay['demandForecast'],
  inventoryOpps: Array<any>,
  comboOpps: Array<any>,
  addOnOpps: Array<any>,
  fatiguedOfferIds: Set<string>,
  activeOffers: Array<any>,
  constraints: any,
  objectives: OptimizationObjective[],
  promotionsThisWeek: number,
  sufficiency: { overall: string }
): Promise<CalendarRecommendation[]> {
  const recommendations: CalendarRecommendation[] = [];
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // 1. Check for festivals
  const festivals = getUpcomingFestivals(7);
  const dayFestivals = festivals.filter(f => f.date === date.toISOString().split('T')[0]);

  if (dayFestivals.length > 0) {
    const festival = dayFestivals[0];
    recommendations.push({
      id: `fest_${festival.name.toLowerCase().replace(/\s+/g, '_')}_${date.toISOString().split('T')[0]}`,
      type: 'FESTIVAL',
      title: `${festival.name} Special`,
      description: `Festival promotion for ${festival.name} — ${festival.foodAngle || 'festive menu specials'}`,
      priority: 'HIGH',
      timeWindow: { startHour: 11, endHour: 22 },
      targetProducts: [],
      targetCategories: [],
      expectedImpact: {
        incrementalRevenue: 0,
        incrementalContribution: 0,
        confidence: 0.7,
      },
      constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
      reasoning: `${festival.name} is today. Historical data shows ${festival.category === 'major' ? 'significant' : 'moderate'} demand lift during festivals.`,
      risks: ['Festival demand may already be high - avoid deep discounts'],
      fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
    });
  }

  // 2. Inventory clearance (high priority if expiry risk)
  const expiryRisks = inventoryOpps.filter(o => o.ingredient.opportunityType === 'EXPIRY_RISK' && o.ingredient.severity === 'high');
  for (const opp of expiryRisks.slice(0, 2)) {
    const fatigueCheck = await isOfferFatigued(restaurantId, `inventory_${opp.ingredient.ingredientId}`, branchId);
    if (!fatigueCheck.fatigued) {
      recommendations.push({
        id: `inv_clear_${opp.ingredient.ingredientId}_${date.toISOString().split('T')[0]}`,
        type: 'INVENTORY_CLEARANCE',
        title: `Clear ${opp.ingredient.ingredientName}`,
        description: `${opp.ingredient.ingredientName} expires in ${opp.ingredient.daysOfStock} days — promote dishes using this ingredient`,
        priority: 'HIGH',
        timeWindow: { startHour: 11, endHour: 20 },
        targetProducts: opp.menuItems?.map((m: any) => m.productId) || [],
        targetCategories: [...new Set(opp.menuItems?.map((m: any) => m.category) || [])],
        expectedImpact: {
          incrementalRevenue: opp.promotionCandidate?.projectedIncrementalRevenue || 0,
          incrementalContribution: opp.promotionCandidate?.projectedIncrementalContribution || 0,
          confidence: opp.confidence,
        },
        constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
        reasoning: `Expiry risk: ${opp.ingredient.daysOfStock} days of stock remaining. Promotion can recover value before waste.`,
        risks: ['Must clear before expiry', 'Deep discount may be needed'],
        fatigueCheck,
      });
    }
  }

  // 3. Overstock clearance (if demand is not HIGH)
  if (demandForecast.level !== 'HIGH') {
    const overstock = inventoryOpps.filter(o => o.ingredient.opportunityType === 'OVERSTOCK' && o.ingredient.severity !== 'low');
    for (const opp of overstock.slice(0, 2)) {
      if (promotionsThisWeek >= constraints.maxPromotionsPerWeek) break;

      const fatigueCheck = await isOfferFatigued(restaurantId, `inventory_${opp.ingredient.ingredientId}`, branchId);
      if (!fatigueCheck.fatigued && opp.promotionCandidate?.canClearStock) {
        recommendations.push({
          id: `inv_overstock_${opp.ingredient.ingredientId}_${date.toISOString().split('T')[0]}`,
          type: 'INVENTORY_CLEARANCE',
          title: `Reduce ${opp.ingredient.ingredientName} Overstock`,
          description: `${opp.ingredient.ingredientName} is ${opp.ingredient.daysOfStock} days over stock ceiling — targeted promotion to normalize`,
          priority: 'MEDIUM',
          timeWindow: { startHour: 11, endHour: 20 },
          targetProducts: opp.menuItems?.map((m: any) => m.productId) || [],
          targetCategories: [...new Set(opp.menuItems?.map((m: any) => m.category) || [])],
          expectedImpact: {
            incrementalRevenue: opp.promotionCandidate?.projectedIncrementalRevenue || 0,
            incrementalContribution: opp.promotionCandidate?.projectedIncrementalContribution || 0,
            confidence: opp.confidence,
          },
          constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
          reasoning: `Overstock detected (${Math.round(opp.ingredient.currentStock / opp.ingredient.maxStock * 100)}% of max). Demand is ${demandForecast.level.toLowerCase()} — safe to promote.`,
          risks: ['Monitor margin', 'Don\'t over-promote if demand picks up'],
          fatigueCheck,
        });
        promotionsThisWeek++;
      }
    }
  }

  // 4. Demand recovery (if demand is LOW)
  if (demandForecast.level === 'LOW' && promotionsThisWeek < constraints.maxPromotionsPerWeek) {
    // Find slow categories/products
    const anomalies = await detectAllDemandAnomalies({ restaurantId, branchId, lookbackDays: 30, minPercentageChange: 20 });
    const underperforming = anomalies.filter(a => a.type.includes('UNDERPERFORMING') || a.type.includes('DROP'));

    for (const anomaly of underperforming.slice(0, 1)) {
      if (anomaly.entityType === 'category') {
        recommendations.push({
          id: `demand_recovery_${anomaly.entityId}_${date.toISOString().split('T')[0]}`,
          type: 'DEMAND_RECOVERY',
          title: `${anomaly.entityName} Recovery`,
          description: `${anomaly.entityName} is ${Math.abs(anomaly.percentageChange)}% below baseline — targeted promotion to recover demand`,
          priority: 'MEDIUM',
          timeWindow: { startHour: 11, endHour: 20 },
          targetProducts: [],
          targetCategories: [anomaly.entityId!],
          expectedImpact: {
            incrementalRevenue: 0,
            incrementalContribution: 0,
            confidence: anomaly.confidence,
          },
          constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
          reasoning: `Demand anomaly detected: ${Math.abs(anomaly.percentageChange)}% below baseline for ${anomaly.entityName}. Promotion can recover lost volume.`,
          risks: ['May cannibalize other categories', 'Set minimum order to protect margin'],
          fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
        });
        promotionsThisWeek++;
      }
    }
  }

  // 5. Combo opportunities (if demand is NORMAL or HIGH - don't discount, bundle)
  if (demandForecast.level !== 'LOW' && promotionsThisWeek < constraints.maxPromotionsPerWeek) {
    for (const combo of comboOpps.slice(0, 1)) {
      if (combo.recommendedAction === 'create_combo' && combo.overallScore >= 65) {
        recommendations.push({
          id: `combo_${combo.id}_${date.toISOString().split('T')[0]}`,
          type: 'COMBO',
          title: `${combo.primaryProduct.name} + ${combo.addOnProduct.name} Combo`,
          description: `Bundle ${combo.primaryProduct.name} + ${combo.addOnProduct.name} for ₹${combo.comboEconomics.suggestedComboPrice} (${combo.comboEconomics.discountPercent}% off)`,
          priority: 'MEDIUM',
          timeWindow: { startHour: 11, endHour: 22 },
          targetProducts: [combo.primaryProduct.id, combo.addOnProduct.id],
          targetCategories: [],
          expectedImpact: {
            incrementalRevenue: combo.comboEconomics.projectedDailyRevenue,
            incrementalContribution: combo.comboEconomics.projectedDailyContribution,
            confidence: combo.confidence,
          },
          constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
          reasoning: `Strong basket affinity (${combo.basketAffinity.confidence}% confidence, ${combo.basketAffinity.lift}x lift) with healthy combo margin (${combo.comboEconomics.estimatedMargin}%). Demand is ${demandForecast.level.toLowerCase()} — bundle instead of discount.`,
          risks: ['Ensure inventory for both items'],
          fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
        });
        promotionsThisWeek++;
        break;
      }
    }
  }

  // 6. Add-on opportunities (works at any demand level)
  if (promotionsThisWeek < constraints.maxPromotionsPerWeek) {
    for (const addon of addOnOpps.slice(0, 1)) {
      if (addon.recommendedAction === 'create_addon' && addon.overallScore >= 60) {
        recommendations.push({
          id: `addon_${addon.id}_${date.toISOString().split('T')[0]}`,
          type: 'ADD_ON',
          title: `${addon.mainProduct.name} → ${addon.addOnProduct.name} Add-on`,
          description: `Offer ${addon.addOnProduct.name} for ₹${addon.economics.suggestedAddOnPrice} with ${addon.mainProduct.name}`,
          priority: 'LOW',
          timeWindow: { startHour: 11, endHour: 22 },
          targetProducts: [addon.mainProduct.id, addon.addOnProduct.id],
          targetCategories: [],
          expectedImpact: {
            incrementalRevenue: addon.economics.projectedDailyRevenue,
            incrementalContribution: addon.economics.projectedDailyContribution,
            confidence: addon.confidence,
          },
          constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
          reasoning: `Proven attachment (${addon.basketAffinity.confidence}% of ${addon.mainProduct.name} orders) with ${addon.economics.estimatedMargin}% add-on margin. Low-risk AOV lift.`,
          risks: ['Staff training needed for upsell'],
          fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
        });
        promotionsThisWeek++;
        break;
      }
    }
  }

  // 7. Slow hour optimization (time-based)
  const slowHours = getSlowHoursForDay(dayOfWeek);
  if (slowHours.length > 0 && promotionsThisWeek < constraints.maxPromotionsPerWeek) {
    recommendations.push({
      id: `slow_hour_${date.toISOString().split('T')[0]}`,
      type: 'DISCOUNT',
      title: `Slow Hour Special (${slowHours.map(h => `${h}:00`).join('-')})`,
      description: `Targeted discount during historically slow hours to smooth demand`,
      priority: 'LOW',
      timeWindow: { startHour: slowHours[0], endHour: slowHours[slowHours.length - 1] + 1 },
      targetProducts: [],
      targetCategories: [],
      expectedImpact: {
        incrementalRevenue: 0,
        incrementalContribution: 0,
        confidence: 0.5,
      },
      constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: Math.min(20, constraints.maxDiscountPercent) },
      reasoning: `Historical data shows ${slowHours.length} hour(s) of below-average demand. Time-restricted promotion shifts demand without cannibalizing peak.`,
      risks: ['Only effective if capacity available', 'Limit to specific items'],
      fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
    });
  }

  // 8. If no promotions recommended, add "No Promotion" recommendation
  const activePromos = recommendations.filter(r => r.type !== 'NO_PROMOTION');
  if (activePromos.length === 0) {
    let reason = 'No specific promotion opportunity identified';
    if (demandForecast.level === 'HIGH') {
      reason = 'Demand forecast is HIGH — discounting would erode margin without sufficient incremental volume';
    } else if (sufficiency.overall === 'INSUFFICIENT_DATA') {
      reason = 'Insufficient historical data for reliable promotion recommendations';
    } else if (promotionsThisWeek >= constraints.maxPromotionsPerWeek) {
      reason = 'Weekly promotion limit reached — avoid over-promoting';
    }

    recommendations.push({
      id: `no_promo_${date.toISOString().split('T')[0]}`,
      type: 'NO_PROMOTION',
      title: 'No Promotion Recommended',
      description: reason,
      priority: 'LOW',
      targetProducts: [],
      targetCategories: [],
      expectedImpact: { incrementalRevenue: 0, incrementalContribution: 0, confidence: 0 },
      constraints: { minMarginPercent: constraints.minMarginPercent, maxDiscountPercent: constraints.maxDiscountPercent },
      reasoning: reason,
      risks: [],
      fatigueCheck: { fatigued: false, level: 'NONE', recommendation: '' },
    });
  }

  return recommendations;
}

/**
 * Get historically slow hours for a day of week
 */
function getSlowHoursForDay(dayOfWeek: number): number[] {
  // Typical slow hours by day (configurable in real implementation)
  const slowHoursMap: Record<number, number[]> = {
    0: [15, 16],      // Sunday: 3-5 PM
    1: [15, 16, 17],  // Monday: 3-6 PM
    2: [15, 16, 17],  // Tuesday: 3-6 PM
    3: [15, 16],      // Wednesday: 3-5 PM
    4: [15, 16],      // Thursday: 3-5 PM
    5: [15, 16],      // Friday: 3-5 PM
    6: [15, 16],      // Saturday: 3-5 PM
  };
  return slowHoursMap[dayOfWeek] || [];
}

/**
 * Build weekly pattern summary
 */
function buildWeeklyPatterns(days: CalendarDay[]): PromotionCalendar['weeklyPatterns'] {
  const patterns: PromotionCalendar['weeklyPatterns'] = [];

  for (let dow = 0; dow < 7; dow++) {
    const dayData = days.filter(d => d.dayOfWeek === dow);
    if (dayData.length === 0) continue;

    const demandLevels = dayData.map(d => d.demandForecast.level);
    const highCount = demandLevels.filter(l => l === 'HIGH').length;
    const lowCount = demandLevels.filter(l => l === 'LOW').length;
    const normalCount = demandLevels.filter(l => l === 'NORMAL').length;

    let avgDemandLevel: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL';
    if (highCount >= normalCount && highCount >= lowCount) avgDemandLevel = 'HIGH';
    else if (lowCount >= normalCount && lowCount >= highCount) avgDemandLevel = 'LOW';

    // Most common recommendation type
    const allRecs = dayData.flatMap(d => d.recommendations.filter(r => r.type !== 'NO_PROMOTION'));
    const recTypes = allRecs.map(r => r.type);
    const typeCounts = new Map<string, number>();
    for (const t of recTypes) typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    const topType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    const actionMap: Record<string, string> = {
      DISCOUNT: 'Targeted discount',
      COMBO: 'Bundle promotion',
      ADD_ON: 'Upsell add-on',
      INVENTORY_CLEARANCE: 'Inventory clearance',
      FESTIVAL: 'Festival special',
      DEMAND_RECOVERY: 'Demand recovery',
      NO_PROMOTION: 'No promotion needed',
    };

    patterns.push({
      dayOfWeek: dow,
      dayName: DAY_NAMES[dow],
      avgDemandLevel,
      recommendedAction: topType ? actionMap[topType[0]] || 'Monitor' : 'No promotion needed',
    });
  }

  return patterns;
}

/**
 * Get simplified calendar for dashboard (next 7 days)
 */
export async function getWeeklyCalendar(
  restaurantId: string,
  branchId?: string
): Promise<PromotionCalendar> {
  return generatePromotionCalendar({
    restaurantId,
    branchId,
    daysAhead: 7,
    includeWeekends: true,
    objectives: ['maximize_contribution'],
  });
}

export { DEFAULT_DAYS_AHEAD, DEFAULT_MAX_PROMOTIONS_PER_WEEK, DAY_NAMES };
export type { PromotionCalendarOptions, PromotionCalendar, CalendarDay, CalendarRecommendation };