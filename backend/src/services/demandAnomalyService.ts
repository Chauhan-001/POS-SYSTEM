/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DemandAnomalyService — Detects statistically meaningful changes in demand.
 * Uses proper baselines and confidence/sample-size safeguards.
 *
 * Key principles:
 * - Compare like-for-like (Tuesday 4 PM vs historical Tuesday 4 PM)
 * - Minimum sample size requirements
 * - Confidence thresholds based on observation count
 * - No fabricated anomalies from insufficient data
 */

import mongoose from 'mongoose';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { computeDailyRevenueBaseline, computeWeekdayRevenueBaseline, computeHourlyRevenueBaseline, computeCategoryBaselines, computeProductBaselines, SalesBaseline, TimeSlotBaseline, CategoryBaseline, ProductBaseline } from './salesBaselineService';

export type AnomalyType =
  | 'REVENUE_DROP'
  | 'REVENUE_SURGE'
  | 'ORDERS_DROP'
  | 'ORDERS_SURGE'
  | 'CATEGORY_UNDERPERFORMING'
  | 'CATEGORY_OVERPERFORMING'
  | 'PRODUCT_DEMAND_DECLINED'
  | 'PRODUCT_DEMAND_INCREASED'
  | 'TIME_SLOT_UNDERPERFORMING'
  | 'TIME_SLOT_OVERPERFORMING';

export interface DemandAnomaly {
  restaurantId: string;
  branchId?: string;
  type: AnomalyType;
  entityType: 'restaurant' | 'category' | 'product' | 'time_slot';
  entityId?: string;
  entityName?: string;
  currentValue: number;
  baselineValue: number;
  percentageChange: number;
  confidence: number;
  sampleSize: number;
  severity: 'low' | 'medium' | 'high';
  evidence: ISignalEvidence[];
  detectedAt: Date;
  period: 'daily' | 'weekly' | 'monthly' | 'hourly' | 'weekday';
}

interface AnomalyOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minSampleSize?: number;
  minConfidence?: number;
  minPercentageChange?: number;
}

const DEFAULT_MIN_SAMPLE_SIZE = 3;
const DEFAULT_MIN_CONFIDENCE = 0.4;
const DEFAULT_MIN_PERCENTAGE_CHANGE = 25; // 25% change threshold

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Compute z-score for anomaly detection
 * Using median absolute deviation (MAD) for robustness
 */
function computeZScore(value: number, baseline: number, historicalValues: number[]): number {
  if (historicalValues.length < 3) return 0;

  const median = historicalValues.sort((a, b) => a - b)[Math.floor(historicalValues.length / 2)];
  const deviations = historicalValues.map(v => Math.abs(v - median));
  const mad = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)];

  if (mad === 0) return 0;
  // 1.4826 is the scale factor for MAD to approximate standard deviation
  return Math.abs((value - baseline) / (mad * 1.4826));
}

/**
 * Get historical daily values for z-score computation
 */
async function getHistoricalDailyValues(
  restaurantId: string,
  branchId: string | undefined,
  lookbackDays: number
): Promise<number[]> {
  const { start, end } = getDateRange(lookbackDays);
  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  })
    .select('grandTotal createdAt')
    .lean()
    .exec();

  const dailyRevenue = new Map<string, number>();
  for (const bill of bills) {
    const dayKey = bill.createdAt.toISOString().split('T')[0];
    dailyRevenue.set(dayKey, (dailyRevenue.get(dayKey) || 0) + (bill.grandTotal || 0));
  }

  return Array.from(dailyRevenue.values());
}

/**
 * Get historical values for a specific weekday
 */
async function getHistoricalWeekdayValues(
  restaurantId: string,
  branchId: string | undefined,
  dayOfWeek: number,
  lookbackDays: number
): Promise<number[]> {
  const { start, end } = getDateRange(lookbackDays);
  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  })
    .select('grandTotal createdAt')
    .lean()
    .exec();

  const weekdayRevenue = new Map<string, number>();
  for (const bill of bills) {
    const date = new Date(bill.createdAt);
    if (date.getDay() !== dayOfWeek) continue;
    const dayKey = date.toISOString().split('T')[0];
    weekdayRevenue.set(dayKey, (weekdayRevenue.get(dayKey) || 0) + (bill.grandTotal || 0));
  }

  return Array.from(weekdayRevenue.values());
}

/**
 * Get historical values for a specific hour on a specific weekday
 */
async function getHistoricalTimeSlotValues(
  restaurantId: string,
  branchId: string | undefined,
  dayOfWeek: number,
  hour: number,
  lookbackDays: number
): Promise<number[]> {
  const { start, end } = getDateRange(lookbackDays);
  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  })
    .select('grandTotal createdAt')
    .lean()
    .exec();

  const timeSlotRevenue = new Map<string, number>();
  for (const bill of bills) {
    const date = new Date(bill.createdAt);
    if (date.getDay() !== dayOfWeek) continue;
    if (date.getHours() !== hour) continue;
    const dayKey = date.toISOString().split('T')[0];
    timeSlotRevenue.set(dayKey, (timeSlotRevenue.get(dayKey) || 0) + (bill.grandTotal || 0));
  }

  return Array.from(timeSlotRevenue.values());
}

/**
 * Detect daily revenue anomalies
 */
export async function detectDailyRevenueAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const { restaurantId, branchId, lookbackDays = 90, minSampleSize = DEFAULT_MIN_SAMPLE_SIZE, minConfidence = DEFAULT_MIN_CONFIDENCE, minPercentageChange = DEFAULT_MIN_PERCENTAGE_CHANGE } = opts;

  const baseline = await computeDailyRevenueBaseline({ restaurantId, branchId, lookbackDays, minSampleSize });
  if (baseline.sampleSize < minSampleSize || baseline.confidence < minConfidence || baseline.value === 0) {
    return [];
  }

  // Get today's revenue
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const todayBills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: today, $lt: tomorrow },
  })
    .select('grandTotal')
    .lean()
    .exec();

  const todayRevenue = todayBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);

  if (todayRevenue === 0 && baseline.value > 0) {
    // Complete drop - significant anomaly
    const percentageChange = -100;
    if (Math.abs(percentageChange) >= minPercentageChange) {
      return [{
        restaurantId,
        branchId,
        type: 'REVENUE_DROP',
        entityType: 'restaurant',
        entityName: 'Daily Revenue',
        currentValue: todayRevenue,
        baselineValue: baseline.value,
        percentageChange,
        confidence: baseline.confidence,
        sampleSize: baseline.sampleSize,
        severity: 'high',
        evidence: [{
          description: `Daily revenue dropped to ₹${todayRevenue} from baseline of ₹${baseline.value}`,
          value: todayRevenue,
          baseline: baseline.value,
          percentageChange,
          sampleSize: baseline.sampleSize,
          confidence: baseline.confidence,
        }],
        detectedAt: new Date(),
        period: 'daily',
      }];
    }
  }

  const percentageChange = baseline.value > 0 ? ((todayRevenue - baseline.value) / baseline.value) * 100 : 0;

  if (Math.abs(percentageChange) < minPercentageChange) return [];

  const historicalValues = await getHistoricalDailyValues(restaurantId, branchId, lookbackDays);
  const zScore = computeZScore(todayRevenue, baseline.value, historicalValues);

  // Adjust confidence based on z-score
  const adjustedConfidence = Math.min(baseline.confidence * (1 + Math.min(zScore / 3, 0.5)), 0.95);

  if (adjustedConfidence < minConfidence) return [];

  return [{
    restaurantId,
    branchId,
    type: percentageChange > 0 ? 'REVENUE_SURGE' : 'REVENUE_DROP',
    entityType: 'restaurant',
    entityName: 'Daily Revenue',
    currentValue: todayRevenue,
    baselineValue: baseline.value,
    percentageChange: Math.round(percentageChange * 10) / 10,
    confidence: Math.round(adjustedConfidence * 100) / 100,
    sampleSize: baseline.sampleSize,
    severity: Math.abs(percentageChange) > 50 ? 'high' : Math.abs(percentageChange) > 35 ? 'medium' : 'low',
    evidence: [{
      description: `Daily revenue ${percentageChange > 0 ? 'surged' : 'dropped'} ${Math.abs(Math.round(percentageChange))}% (₹${todayRevenue} vs baseline ₹${baseline.value})`,
      value: todayRevenue,
      baseline: baseline.value,
      percentageChange: Math.round(percentageChange * 10) / 10,
      sampleSize: baseline.sampleSize,
      confidence: adjustedConfidence,
      metadata: { zScore: Math.round(zScore * 10) / 10 },
    }],
    detectedAt: new Date(),
    period: 'daily',
  }];
}

/**
 * Detect weekday-specific anomalies (compares same day of week)
 */
export async function detectWeekdayAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const { restaurantId, branchId, lookbackDays = 90, minSampleSize = DEFAULT_MIN_SAMPLE_SIZE, minConfidence = DEFAULT_MIN_CONFIDENCE, minPercentageChange = DEFAULT_MIN_PERCENTAGE_CHANGE } = opts;

  const today = new Date();
  const dayOfWeek = today.getDay();

  const baselines = await computeWeekdayRevenueBaseline({ restaurantId, branchId, lookbackDays, minSampleSize });
  const baseline = baselines[dayOfWeek];

  if (baseline.sampleSize < minSampleSize || baseline.confidence < minConfidence || baseline.value === 0) {
    return [];
  }

  // Get today's revenue
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const todayBills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: startOfDay, $lt: endOfDay },
  })
    .select('grandTotal')
    .lean()
    .exec();

  const todayRevenue = todayBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);

  const percentageChange = baseline.value > 0 ? ((todayRevenue - baseline.value) / baseline.value) * 100 : 0;

  if (Math.abs(percentageChange) < minPercentageChange) return [];

  const historicalValues = await getHistoricalWeekdayValues(restaurantId, branchId, dayOfWeek, lookbackDays);
  const zScore = computeZScore(todayRevenue, baseline.value, historicalValues);
  const adjustedConfidence = Math.min(baseline.confidence * (1 + Math.min(zScore / 3, 0.5)), 0.95);

  if (adjustedConfidence < minConfidence) return [];

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return [{
    restaurantId,
    branchId,
    type: percentageChange > 0 ? 'REVENUE_SURGE' : 'REVENUE_DROP',
    entityType: 'time_slot',
    entityId: `weekday-${dayOfWeek}`,
    entityName: `${dayNames[dayOfWeek]} Revenue`,
    currentValue: todayRevenue,
    baselineValue: baseline.value,
    percentageChange: Math.round(percentageChange * 10) / 10,
    confidence: Math.round(adjustedConfidence * 100) / 100,
    sampleSize: baseline.sampleSize,
    severity: Math.abs(percentageChange) > 50 ? 'high' : Math.abs(percentageChange) > 35 ? 'medium' : 'low',
    evidence: [{
      description: `${dayNames[dayOfWeek]} revenue ${percentageChange > 0 ? 'surged' : 'dropped'} ${Math.abs(Math.round(percentageChange))}% vs historical ${dayNames[dayOfWeek]} baseline`,
      value: todayRevenue,
      baseline: baseline.value,
      percentageChange: Math.round(percentageChange * 10) / 10,
      sampleSize: baseline.sampleSize,
      confidence: adjustedConfidence,
      metadata: { zScore: Math.round(zScore * 10) / 10, dayOfWeek },
    }],
    detectedAt: new Date(),
    period: 'weekday',
  }];
}

/**
 * Detect hourly time-slot anomalies
 */
export async function detectTimeSlotAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const { restaurantId, branchId, lookbackDays = 90, minSampleSize = DEFAULT_MIN_SAMPLE_SIZE, minConfidence = DEFAULT_MIN_CONFIDENCE, minPercentageChange = DEFAULT_MIN_PERCENTAGE_CHANGE } = opts;

  const today = new Date();
  const dayOfWeek = today.getDay();
  const currentHour = today.getHours();

  // Check current hour and adjacent hours (±1)
  const hoursToCheck = [currentHour - 1, currentHour, currentHour + 1].filter(h => h >= 0 && h <= 23);

  const anomalies: DemandAnomaly[] = [];

  for (const hour of hoursToCheck) {
    const baselines = await computeHourlyRevenueBaseline({ restaurantId, branchId, dayOfWeek, lookbackDays, minSampleSize });
    const baseline = baselines[hour];

    if (baseline.sampleSize < minSampleSize || baseline.confidence < minConfidence || baseline.value === 0) {
      continue;
    }

    // Get current hour's revenue
    const hourStart = new Date(today);
    hourStart.setHours(hour, 0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    const hourBills = await BillModel.find({
      restaurantId: objectId(restaurantId),
      ...(branchId ? { branchId: objectId(branchId) } : {}),
      isVoided: { $ne: true },
      isDeleted: { $ne: true },
      createdAt: { $gte: hourStart, $lt: hourEnd },
    })
      .select('grandTotal')
      .lean()
      .exec();

    const hourRevenue = hourBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);

    const percentageChange = baseline.value > 0 ? ((hourRevenue - baseline.value) / baseline.value) * 100 : 0;

    if (Math.abs(percentageChange) < minPercentageChange) continue;

    const historicalValues = await getHistoricalTimeSlotValues(restaurantId, branchId, dayOfWeek, hour, lookbackDays);
    const zScore = computeZScore(hourRevenue, baseline.value, historicalValues);
    const adjustedConfidence = Math.min(baseline.confidence * (1 + Math.min(zScore / 3, 0.5)), 0.95);

    if (adjustedConfidence < minConfidence) continue;

    anomalies.push({
      restaurantId,
      branchId,
      type: percentageChange > 0 ? 'TIME_SLOT_OVERPERFORMING' : 'TIME_SLOT_UNDERPERFORMING',
      entityType: 'time_slot',
      entityId: `hour-${hour}-dow-${dayOfWeek}`,
      entityName: `${hour}:00-${hour + 1}:00`,
      currentValue: hourRevenue,
      baselineValue: baseline.value,
      percentageChange: Math.round(percentageChange * 10) / 10,
      confidence: Math.round(adjustedConfidence * 100) / 100,
      sampleSize: baseline.sampleSize,
      severity: Math.abs(percentageChange) > 50 ? 'high' : Math.abs(percentageChange) > 35 ? 'medium' : 'low',
      evidence: [{
        description: `${hour}:00-${hour + 1}:00 revenue ${percentageChange > 0 ? 'surged' : 'dropped'} ${Math.abs(Math.round(percentageChange))}% vs historical baseline`,
        value: hourRevenue,
        baseline: baseline.value,
        percentageChange: Math.round(percentageChange * 10) / 10,
        sampleSize: baseline.sampleSize,
        confidence: adjustedConfidence,
        metadata: { zScore: Math.round(zScore * 10) / 10, hour, dayOfWeek },
      }],
      detectedAt: new Date(),
      period: 'hourly',
    });
  }

  return anomalies;
}

/**
 * Detect category performance anomalies
 */
export async function detectCategoryAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const { restaurantId, branchId, lookbackDays = 90, minSampleSize = DEFAULT_MIN_SAMPLE_SIZE, minConfidence = DEFAULT_MIN_CONFIDENCE, minPercentageChange = DEFAULT_MIN_PERCENTAGE_CHANGE } = opts;

  const baselines = await computeCategoryBaselines({ restaurantId, branchId, lookbackDays, minSampleSize });
  if (baselines.length === 0) return [];

  // Get current period (today) category performance
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: today, $lt: tomorrow },
  })
    .select('_id')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('menuItemId itemName quantity priceAtSale')
    .lean()
    .exec();

  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  })
    .select('_id name category')
    .lean()
    .exec();

  const productMap = new Map(products.map(p => [String(p._id), { name: p.name, category: p.category || 'Other' }]));

  // Group today's sales by category
  const todayCategoryStats = new Map<string, { revenue: number; units: number }>();
  for (const item of items) {
    const productInfo = productMap.get(String(item.menuItemId)) || { category: 'Other' };
    const cat = productInfo.category;
    const revenue = (item.priceAtSale || 0) * (item.quantity || 0);
    const units = item.quantity || 0;
    const stats = todayCategoryStats.get(cat) || { revenue: 0, units: 0 };
    stats.revenue += revenue;
    stats.units += units;
    todayCategoryStats.set(cat, stats);
  }

  const anomalies: DemandAnomaly[] = [];

  for (const baseline of baselines) {
    if (baseline.sampleSize < minSampleSize || baseline.confidence < minConfidence) continue;

    const todayStats = todayCategoryStats.get(baseline.category);
    if (!todayStats) continue;

    const currentValue = baseline.metric === 'revenue' ? todayStats.revenue : todayStats.units;
    const percentageChange = baseline.value > 0 ? ((currentValue - baseline.value) / baseline.value) * 100 : 0;

    if (Math.abs(percentageChange) < minPercentageChange) continue;

    const type = baseline.metric === 'revenue'
      ? (percentageChange > 0 ? 'CATEGORY_OVERPERFORMING' : 'CATEGORY_UNDERPERFORMING')
      : (percentageChange > 0 ? 'CATEGORY_OVERPERFORMING' : 'CATEGORY_UNDERPERFORMING');

    anomalies.push({
      restaurantId,
      branchId,
      type,
      entityType: 'category',
      entityId: baseline.category,
      entityName: baseline.category,
      currentValue,
      baselineValue: baseline.value,
      percentageChange: Math.round(percentageChange * 10) / 10,
      confidence: baseline.confidence,
      sampleSize: baseline.sampleSize,
      severity: Math.abs(percentageChange) > 50 ? 'high' : Math.abs(percentageChange) > 35 ? 'medium' : 'low',
      evidence: [{
        description: `${baseline.category} ${baseline.metric} ${percentageChange > 0 ? 'surged' : 'dropped'} ${Math.abs(Math.round(percentageChange))}% vs baseline`,
        value: currentValue,
        baseline: baseline.value,
        percentageChange: Math.round(percentageChange * 10) / 10,
        sampleSize: baseline.sampleSize,
        confidence: baseline.confidence,
      }],
      detectedAt: new Date(),
      period: 'daily',
    });
  }

  return anomalies;
}

/**
 * Detect product demand anomalies
 */
export async function detectProductAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const { restaurantId, branchId, lookbackDays = 90, minSampleSize = DEFAULT_MIN_SAMPLE_SIZE, minConfidence = DEFAULT_MIN_CONFIDENCE, minPercentageChange = DEFAULT_MIN_PERCENTAGE_CHANGE } = opts;

  const baselines = await computeProductBaselines({ restaurantId, branchId, lookbackDays, minSampleSize });
  if (baselines.length === 0) return [];

  // Get current period (today) product performance
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: today, $lt: tomorrow },
  })
    .select('_id')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('menuItemId itemName quantity priceAtSale')
    .lean()
    .exec();

  // Group today's sales by product
  const todayProductStats = new Map<string, { revenue: number; units: number; name: string }>();
  for (const item of items) {
    const pid = String(item.menuItemId);
    const revenue = (item.priceAtSale || 0) * (item.quantity || 0);
    const units = item.quantity || 0;
    const stats = todayProductStats.get(pid) || { revenue: 0, units: 0, name: item.itemName || 'Item' };
    stats.revenue += revenue;
    stats.units += units;
    todayProductStats.set(pid, stats);
  }

  const anomalies: DemandAnomaly[] = [];

  for (const baseline of baselines) {
    if (baseline.sampleSize < minSampleSize || baseline.confidence < minConfidence) continue;

    const todayStats = todayProductStats.get(baseline.productId);
    if (!todayStats) continue;

    const currentValue = baseline.metric === 'revenue' ? todayStats.revenue : todayStats.units;
    const percentageChange = baseline.value > 0 ? ((currentValue - baseline.value) / baseline.value) * 100 : 0;

    if (Math.abs(percentageChange) < minPercentageChange) continue;

    const type = baseline.metric === 'revenue'
      ? (percentageChange > 0 ? 'PRODUCT_DEMAND_INCREASED' : 'PRODUCT_DEMAND_DECLINED')
      : (percentageChange > 0 ? 'PRODUCT_DEMAND_INCREASED' : 'PRODUCT_DEMAND_DECLINED');

    anomalies.push({
      restaurantId,
      branchId,
      type,
      entityType: 'product',
      entityId: baseline.productId,
      entityName: baseline.productName,
      currentValue,
      baselineValue: baseline.value,
      percentageChange: Math.round(percentageChange * 10) / 10,
      confidence: baseline.confidence,
      sampleSize: baseline.sampleSize,
      severity: Math.abs(percentageChange) > 50 ? 'high' : Math.abs(percentageChange) > 35 ? 'medium' : 'low',
      evidence: [{
        description: `${baseline.productName} ${baseline.metric} ${percentageChange > 0 ? 'increased' : 'declined'} ${Math.abs(Math.round(percentageChange))}% vs baseline`,
        value: currentValue,
        baseline: baseline.value,
        percentageChange: Math.round(percentageChange * 10) / 10,
        sampleSize: baseline.sampleSize,
        confidence: baseline.confidence,
      }],
      detectedAt: new Date(),
      period: 'daily',
    });
  }

  // Sort by severity and percentage change
  anomalies.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const aSeverity = severityOrder[a.severity];
    const bSeverity = severityOrder[b.severity];
    if (aSeverity !== bSeverity) return bSeverity - aSeverity;
    return Math.abs(b.percentageChange) - Math.abs(a.percentageChange);
  });

  // Return top anomalies
  return anomalies.slice(0, 10);
}

/**
 * Detect all demand anomalies
 */
export async function detectAllDemandAnomalies(opts: AnomalyOptions): Promise<DemandAnomaly[]> {
  const [
    dailyAnomalies,
    weekdayAnomalies,
    timeSlotAnomalies,
    categoryAnomalies,
    productAnomalies,
  ] = await Promise.all([
    detectDailyRevenueAnomalies(opts),
    detectWeekdayAnomalies(opts),
    detectTimeSlotAnomalies(opts),
    detectCategoryAnomalies(opts),
    detectProductAnomalies(opts),
  ]);

  return [
    ...dailyAnomalies,
    ...weekdayAnomalies,
    ...timeSlotAnomalies,
    ...categoryAnomalies,
    ...productAnomalies,
  ].sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}

/**
 * Persist anomalies as signals
 */
export async function persistAnomaliesAsSignals(anomalies: DemandAnomaly[]): Promise<void> {
  if (anomalies.length === 0) return;

  const docs = anomalies.map(a => ({
    restaurantId: objectId(a.restaurantId),
    branchId: a.branchId ? objectId(a.branchId) : undefined,
    type: a.type as SignalType,
    entityType: a.entityType,
    entityId: a.entityId,
    entityName: a.entityName,
    value: a.currentValue,
    baseline: a.baselineValue,
    percentageChange: a.percentageChange,
    confidence: a.confidence,
    minSampleSize: a.sampleSize,
    sampleSize: a.sampleSize,
    evidence: a.evidence,
    detectedAt: a.detectedAt,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    consumed: false,
    tags: ['demand_anomaly', a.type.toLowerCase(), a.entityType],
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}