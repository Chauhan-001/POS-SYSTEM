/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DemandForecastingService — Statistical demand forecasting for restaurant
 * entities (restaurant, category, product, variant, time-slot).
 *
 * Uses only deterministic, statistically defensible methods:
 * - Historical comparable periods (same day-of-week, same time-slot)
 * - Trend analysis (linear regression on recent periods)
 * - Day-of-week and time-of-day patterns
 * - Seasonality where sufficient data exists (12+ months)
 * - Festival/holiday effects
 *
 * No ML models. All calculations are deterministic and auditable.
 */

import mongoose from 'mongoose';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import { getUpcomingFestivals } from './festivalService';
import { assessDataSufficiency, DataConfidenceLevel } from './dataSufficiencyService';
import { getUpcomingFestivals as getFestivals } from './festivalService';

export interface ForecastEntity {
  type: 'restaurant' | 'category' | 'product' | 'variant' | 'time_slot';
  id: string;
  name: string;
}

export interface ForecastPeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface ForecastResult {
  entity: ForecastEntity;
  period: ForecastPeriod;
  predictedDemand: {
    units: { min: number; expected: number; max: number };
    revenue: { min: number; expected: number; max: number };
  };
  baseline: {
    units: number;
    revenue: number;
  };
  trend: {
    direction: 'increasing' | 'decreasing' | 'stable';
    percentage: number;
    confidence: number;
  };
  seasonality?: {
    detected: boolean;
    pattern: string;
    strength: number;
  };
  festivalEffect?: {
    festival: string;
    expectedLift: number;
    confidence: number;
  };
  confidence: DataConfidenceLevel;
  confidenceScore: number; // 0-100
  dataSufficiency: {
    daysOfHistory: number;
    totalObservations: number;
    comparablePeriods: number;
  };
  factors: string[];
  explainability: {
    primaryDriver: string;
    supportingFactors: string[];
    caveats: string[];
  };
}

export interface ForecastOptions {
  restaurantId: string;
  branchId?: string;
  entity: ForecastEntity;
  period: ForecastPeriod;
  lookbackDays?: number; // default 365
  includeSeasonality?: boolean; // default true if 12+ months data
  includeFestivalEffects?: boolean; // default true
  confidenceLevel?: number; // default 0.8 for prediction interval
}

interface HistoricalObservation {
  date: Date;
  dayOfWeek: number;
  hour?: number;
  units: number;
  revenue: number;
}

interface ComparablePeriod {
  date: Date;
  units: number;
  revenue: number;
}

const MIN_OBSERVATIONS_FOR_TREND = 10;
const MIN_COMPARABLE_PERIODS = 3;
const MIN_DAYS_FOR_SEASONALITY = 365;
const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_CONFIDENCE_LEVEL = 0.8;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getComparablePeriods(
  targetDate: Date,
  observations: HistoricalObservation[],
  lookbackDays: number,
  maxPeriods: number = 8
): ComparablePeriod[] {
  const targetDayOfWeek = targetDate.getDay();
  const targetHour = targetDate.getHours();
  const isTimeSlot = typeof targetDate.getHours === 'function' && targetDate.getHours() !== 0;

  // Filter observations for comparable periods
  const comparable = observations.filter(obs => {
    const daysDiff = Math.floor((targetDate.getTime() - obs.date.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff <= 0 || daysDiff > lookbackDays) return false;
    if (obs.dayOfWeek !== targetDayOfWeek) return false;
    if (isTimeSlot && obs.hour !== undefined && obs.hour !== targetHour) return false;
    return true;
  });

  // Sort by date (most recent first) and take top N
  comparable.sort((a, b) => b.date.getTime() - a.date.getTime());
  return comparable.slice(0, maxPeriods).map(obs => ({
    date: obs.date,
    units: obs.units,
    revenue: obs.revenue,
  }));
}

function calculateTrend(observations: HistoricalObservation[], minPeriods: number = MIN_OBSERVATIONS_FOR_TREND): {
  direction: 'increasing' | 'decreasing' | 'stable';
  percentage: number;
  confidence: number;
} {
  if (observations.length < minPeriods) {
    return { direction: 'stable', percentage: 0, confidence: 0 };
  }

  // Sort by date
  const sorted = [...observations].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Simple linear regression on units
  const n = sorted.length;
  const x = sorted.map((_, i) => i);
  const y = sorted.map(o => o.units);

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const yMean = sumY / n;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce((sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2), 0);
  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  const firstValue = sorted[0].units;
  const lastValue = sorted[sorted.length - 1].units;
  const percentage = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

  let direction: 'increasing' | 'decreasing' | 'stable';
  if (Math.abs(percentage) < 5) direction = 'stable';
  else direction = percentage > 0 ? 'increasing' : 'decreasing';

  return {
    direction,
    percentage: Math.round(Math.abs(percentage) * 10) / 10,
    confidence: Math.round(Math.min(rSquared * 100, 100)),
  };
}

function calculateSeasonality(observations: HistoricalObservation[], minDays: number = MIN_DAYS_FOR_SEASONALITY): {
  detected: boolean;
  pattern: string;
  strength: number;
} | undefined {
  if (observations.length < minDays / 7) return undefined; // Need at least ~52 weeks

  // Group by week of year
  const weekData = new Map<number, { units: number; count: number }>();
  for (const obs of observations) {
    const week = getWeekOfYear(obs.date);
    const existing = weekData.get(week) || { units: 0, count: 0 };
    existing.units += obs.units;
    existing.count += 1;
    weekData.set(week, existing);
  }

  if (weekData.size < 26) return undefined; // Need at least 26 weeks

  // Calculate average for each week across years
  const weeklyAverages = new Map<number, number>();
  for (const [week, data] of weekData) {
    weeklyAverages.set(week, data.units / data.count);
  }

  // Detect pattern (simple: peak weeks)
  const avgOverall = Array.from(weeklyAverages.values()).reduce((a, b) => a + b, 0) / weeklyAverages.size;
  const peakWeeks = Array.from(weeklyAverages.entries())
    .filter(([, v]) => v > avgOverall * 1.2)
    .map(([w]) => w);

  const strength = avgOverall > 0 ? Math.min((Math.max(...weeklyAverages.values()) - avgOverall) / avgOverall, 1) : 0;

  return {
    detected: peakWeeks.length > 0,
    pattern: peakWeeks.length > 0
      ? `Peak demand in weeks: ${peakWeeks.slice(0, 5).join(', ')}${peakWeeks.length > 5 ? '...' : ''}`
      : 'No strong seasonal pattern detected',
    strength: Math.round(strength * 100),
  };
}

function getWeekOfYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function fetchHistoricalObservations(
  restaurantId: string,
  branchId: string | undefined,
  entity: { type: string; id: string },
  lookbackDays: number
): Promise<HistoricalObservation[]> {
  const oid = objectId(restaurantId);
  const { start, end } = getDateRange(lookbackDays);

  const billFilter: any = {
    restaurantId: oid,
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  };
  if (branchId) billFilter.branchId = objectId(branchId);

  const bills = await BillModel.find(billFilter)
    .select('_id createdAt')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);
  const billDateMap = new Map(bills.map(b => [String(b._id), b.createdAt]));

  let itemFilter: any = { billId: { $in: billIds }, isVoided: { $ne: true } };

  if (entity.type === 'product' || entity.type === 'variant') {
    itemFilter.itemId = objectId(entity.id);
  } else if (entity.type === 'category') {
    // Get products in category
    const products = await ProductModel.find({
      restaurantId: oid,
      category: entity.name,
      isDeleted: { $ne: true },
    }).select('_id').lean().exec();
    const productIds = products.map(p => p._id);
    itemFilter.itemId = { $in: productIds };
  }

  const items = await BillItemModel.find(itemFilter)
    .select('billId quantity priceAtSale')
    .lean()
    .exec();

  // Aggregate by bill date
  const dailyAggregates = new Map<string, { units: number; revenue: number; date: Date }>();

  for (const item of items) {
    const billDate = billDateMap.get(String(item.billId));
    if (!billDate) continue;

    const dateKey = billDate.toISOString().split('T')[0];
    const existing = dailyAggregates.get(dateKey) || { units: 0, revenue: 0, date: billDate };
    existing.units += item.quantity || 0;
    existing.revenue += (item.priceAtSale || 0) * (item.quantity || 0);
    dailyAggregates.set(dateKey, existing);
  }

  return Array.from(dailyAggregates.values()).map(d => ({
    date: d.date,
    dayOfWeek: d.date.getDay(),
    hour: d.date.getHours(),
    units: d.units,
    revenue: d.revenue,
  }));
}

function calculatePredictionInterval(
  comparable: ComparablePeriod[],
  confidenceLevel: number = DEFAULT_CONFIDENCE_LEVEL
): { min: number; expected: number; max: number } {
  if (comparable.length === 0) {
    return { min: 0, expected: 0, max: 0 };
  }

  const units = comparable.map(c => c.units).sort((a, b) => a - b);
  const revenue = comparable.map(c => c.revenue).sort((a, b) => a - b);

  const expectedUnits = units.reduce((a, b) => a + b, 0) / units.length;
  const expectedRevenue = revenue.reduce((a, b) => a + b, 0) / revenue.length;

  // Use percentile-based interval
  const alpha = (1 - confidenceLevel) / 2;
  const lowerIdx = Math.floor(alpha * units.length);
  const upperIdx = Math.ceil((1 - alpha) * units.length) - 1;

  return {
    min: Math.max(0, units[Math.max(0, lowerIdx)]),
    expected: Math.round(expectedUnits),
    max: units[Math.min(units.length - 1, upperIdx)],
  };
}

function calculateConfidenceScore(
  dataSufficiency: DataConfidenceLevel,
  comparablePeriods: number,
  trendConfidence: number,
  comparableThreshold: number = MIN_COMPARABLE_PERIODS
): { level: DataConfidenceLevel; score: number } {
  // Base score from data sufficiency
  const baseScores: Record<DataConfidenceLevel, number> = {
    INSUFFICIENT_DATA: 10,
    LOW_CONFIDENCE: 35,
    MODERATE_CONFIDENCE: 65,
    HIGH_CONFIDENCE: 90,
  };

  let score = baseScores[dataSufficiency];

  // Adjust for comparable periods
  if (comparablePeriods >= comparableThreshold * 2) score += 10;
  else if (comparablePeriods >= comparableThreshold) score += 5;
  else if (comparablePeriods > 0) score -= 10;
  else score -= 20;

  // Adjust for trend confidence
  score += Math.round(trendConfidence * 0.1);

  // Cap
  score = Math.max(0, Math.min(100, score));

  let level: DataConfidenceLevel;
  if (score >= 80) level = 'HIGH_CONFIDENCE';
  else if (score >= 55) level = 'MODERATE_CONFIDENCE';
  else if (score >= 30) level = 'LOW_CONFIDENCE';
  else level = 'INSUFFICIENT_DATA';

  return { level, score };
}

export async function generateDemandForecast(options: ForecastOptions): Promise<ForecastResult> {
  const {
    restaurantId,
    branchId,
    entity,
    period,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    includeSeasonality = true,
    includeFestivalEffects = true,
    confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  } = options;

  // 1. Check data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });

  if (sufficiency.overall === 'INSUFFICIENT_DATA') {
    return {
      entity,
      period,
      predictedDemand: { units: { min: 0, expected: 0, max: 0 }, revenue: { min: 0, expected: 0, max: 0 } },
      baseline: { units: 0, revenue: 0 },
      trend: { direction: 'stable', percentage: 0, confidence: 0 },
      confidence: 'INSUFFICIENT_DATA',
      confidenceScore: 10,
      dataSufficiency: { daysOfHistory: 0, totalObservations: 0, comparablePeriods: 0 },
      factors: ['Insufficient historical data'],
      explainability: {
        primaryDriver: 'Insufficient data',
        supportingFactors: [],
        caveats: ['Minimum 14 days and 50 bills required for basic forecasting'],
      },
    };
  }

  // 2. Fetch historical observations
  const observations = await fetchHistoricalObservations(restaurantId, branchId, entity, lookbackDays);

  if (observations.length === 0) {
    return {
      entity,
      period,
      predictedDemand: { units: { min: 0, expected: 0, max: 0 }, revenue: { min: 0, expected: 0, max: 0 } },
      baseline: { units: 0, revenue: 0 },
      trend: { direction: 'stable', percentage: 0, confidence: 0 },
      confidence: 'INSUFFICIENT_DATA',
      confidenceScore: 10,
      dataSufficiency: { daysOfHistory: 0, totalObservations: 0, comparablePeriods: 0 },
      factors: ['No historical sales data for this entity'],
      explainability: {
        primaryDriver: 'No historical data',
        supportingFactors: [],
        caveats: ['Entity has no sales in the lookback period'],
      },
    };
  }

  // 3. Get comparable periods for the target period
  const targetDate = period.start;
  const comparable = getComparablePeriods(targetDate, observations, lookbackDays);
  const comparablePeriods = comparable.length;

  // 4. Calculate baseline (median of comparable periods)
  const unitsSorted = comparable.map(c => c.units).sort((a, b) => a - b);
  const revenueSorted = comparable.map(c => c.revenue).sort((a, b) => a - b);

  const baselineUnits = comparable.length > 0
    ? unitsSorted[Math.floor(unitsSorted.length / 2)]
    : 0;
  const baselineRevenue = comparable.length > 0
    ? revenueSorted[Math.floor(revenueSorted.length / 2)]
    : 0;

  // 5. Calculate trend
  const trend = calculateTrend(observations);

  // 6. Calculate prediction interval
  const interval = calculatePredictionInterval(comparable, 0.8);

  // 7. Seasonality
  let seasonality;
  if (includeSeasonality) {
    seasonality = calculateSeasonality(observations);
  }

  // 8. Festival effects
  let festivalEffect;
  if (includeFestivalEffects) {
    const upcomingFestivals = getFestivals(30);
    const periodFestival = upcomingFestivals.find(f => {
      const festDate = new Date(f.date);
      return festDate >= period.start && festDate <= period.end;
    });
    if (periodFestival) {
      // Estimate lift from historical festival data (simplified: 15-25% lift)
      festivalEffect = {
        festival: periodFestival.name,
        expectedLift: 20, // Conservative estimate
        confidence: 0.6,
      };
    }
  }

  // 8. Calculate confidence
  const { level, score } = calculateConfidenceScore(
    sufficiency.overall,
    comparable.length,
    trend.confidence
  );

  // 9. Build factors and explainability
  const factors: string[] = [];
  const supportingFactors: string[] = [];
  const caveats: string[] = [];

  if (trend.direction !== 'stable') {
    factors.push(`${trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1)} trend (${trend.percentage}%)`);
    supportingFactors.push(`Trend: ${trend.direction} ${trend.percentage}% (${trend.confidence}% confidence)`);
  }

  if (comparable.length > 0) {
    factors.push(`${comparable.length} comparable historical periods`);
    supportingFactors.push(`${comparable.length} comparable ${targetDate.toLocaleDateString('en-US', { weekday: 'long' })} periods in last ${lookbackDays} days`);
  } else {
    caveats.push('No directly comparable historical periods found');
  }

  if (seasonality?.detected) {
    factors.push('Seasonal pattern detected');
    supportingFactors.push(`Seasonality: ${seasonality.pattern} (strength: ${seasonality.strength}%)`);
  }

  if (festivalEffect) {
    factors.push(`Festival effect: ${festivalEffect.festival}`);
    supportingFactors.push(`Expected ${festivalEffect.expectedLift}% lift during ${festivalEffect.festival}`);
  }

  if (sufficiency.overall === 'LOW_CONFIDENCE') {
    caveats.push('Limited historical data reduces forecast reliability');
  } else if (sufficiency.overall === 'MODERATE_CONFIDENCE') {
    caveats.push('Moderate data availability; forecasts may improve with more history');
  }

  if (comparable.length < MIN_COMPARABLE_PERIODS) {
    caveats.push(`Only ${comparable.length} comparable periods found (minimum ${MIN_COMPARABLE_PERIODS} recommended)`);
  }

  const primaryDriver = factors.length > 0 ? factors[0] : 'Historical baseline';

  return {
    entity,
    period,
    predictedDemand: {
      units: { min: interval.min, expected: interval.expected, max: interval.max },
      revenue: { min: Math.round(interval.min * (baselineRevenue / Math.max(baselineUnits, 1))), expected: Math.round(baselineRevenue), max: Math.round(interval.max * (baselineRevenue / Math.max(baselineUnits, 1))) },
    },
    baseline: { units: baselineUnits, revenue: baselineRevenue },
    trend,
    seasonality,
    festivalEffect,
    confidence: level,
    confidenceScore: score,
    dataSufficiency: {
      daysOfHistory: sufficiency.dataSummary.daysOfSalesHistory,
      totalObservations: observations.length,
      comparablePeriods: comparable.length,
    },
    factors,
    explainability: {
      primaryDriver,
      supportingFactors,
      caveats,
    },
  };
}

/**
 * Generate forecasts for multiple entities (batch)
 */
export async function generateBatchForecasts(
  restaurantId: string,
  branchId: string | undefined,
  entities: ForecastEntity[],
  period: ForecastPeriod,
  options: Partial<ForecastOptions> = {}
): Promise<ForecastResult[]> {
  const forecasts = await Promise.all(
    entities.map(entity => generateDemandForecast({ restaurantId, branchId, entity, period, ...options }))
  );
  return forecasts;
}

/**
 * Generate forecasts for all products in a category
 */
export async function generateCategoryForecasts(
  restaurantId: string,
  branchId: string | undefined,
  category: string,
  period: ForecastPeriod,
  options: Partial<ForecastOptions> = {}
): Promise<ForecastResult[]> {
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    category,
    isDeleted: { $ne: true },
  }).select('_id name').lean().exec();

  const entities: ForecastEntity[] = products.map(p => ({
    type: 'product' as const,
    id: String(p._id),
    name: p.name,
  }));

  return generateBatchForecasts(restaurantId, branchId, entities, period, options);
}

/**
 * Generate forecasts for all categories
 */
export async function generateAllCategoryForecasts(
  restaurantId: string,
  branchId: string | undefined,
  period: ForecastPeriod,
  options: Partial<ForecastOptions> = {}
): Promise<ForecastResult[]> {
  const categories = await ProductModel.aggregate([
    { $match: { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $match: { count: { $gte: 1 } } },
    { $project: { name: '$_id' } },
  ]).exec();

  const entities: ForecastEntity[] = categories.map(c => ({
    type: 'category' as const,
    id: c.name,
    name: c.name,
  }));

  return generateBatchForecasts(restaurantId, branchId, entities, period, options);
}