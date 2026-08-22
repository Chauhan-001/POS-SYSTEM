/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DataSufficiencyService — Determines whether a restaurant has enough
 * historical data to support various levels of predictive intelligence.
 *
 * This is the gatekeeper for all predictive features. No prediction
 * should be generated without first checking data sufficiency.
 */

import mongoose from 'mongoose';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import CustomerModel from '../models/Customer';
import OfferModel from '../models/Offer';
import PromotionCandidateModel from '../models/PromotionCandidate';

export type DataConfidenceLevel =
  | 'INSUFFICIENT_DATA'
  | 'LOW_CONFIDENCE'
  | 'MODERATE_CONFIDENCE'
  | 'HIGH_CONFIDENCE';

export interface DataSufficiencyReport {
  restaurantId: string;
  branchId?: string;
  overall: DataConfidenceLevel;
  checks: DataSufficiencyCheck[];
  dataSummary: DataSummary;
  recommendedCapabilities: string[];
  limitations: string[];
}

export interface DataSufficiencyCheck {
  name: string;
  description: string;
  status: DataConfidenceLevel;
  value: number;
  threshold: number;
  unit: string;
  weight: number;
}

export interface DataSummary {
  daysOfSalesHistory: number;
  totalBills: number;
  totalOrderItems: number;
  uniqueProducts: number;
  uniqueCustomers: number;
  totalPromotionsRun: number;
  earliestBillDate: Date | null;
  latestBillDate: Date | null;
  promotionHistoryDays: number;
}

export interface DataSufficiencyOptions {
  restaurantId: string;
  branchId?: string;
}

const MIN_BILLS_FOR_LOW = 50;
const MIN_BILLS_FOR_MODERATE = 200;
const MIN_BILLS_FOR_HIGH = 1000;

const MIN_DAYS_FOR_LOW = 14;
const MIN_DAYS_FOR_MODERATE = 60;
const MIN_DAYS_FOR_HIGH = 180;

const MIN_PROMOS_FOR_LOW = 3;
const MIN_PROMOS_FOR_MODERATE = 10;
const MIN_PROMOS_FOR_HIGH = 30;

const MIN_CUSTOMERS_FOR_LOW = 20;
const MIN_CUSTOMERS_FOR_MODERATE = 100;
const MIN_CUSTOMERS_FOR_HIGH = 500;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function calculateConfidenceLevel(
  value: number,
  thresholds: { low: number; moderate: number; high: number }
): DataConfidenceLevel {
  if (value >= thresholds.high) return 'HIGH_CONFIDENCE';
  if (value >= thresholds.moderate) return 'MODERATE_CONFIDENCE';
  if (value >= thresholds.low) return 'LOW_CONFIDENCE';
  return 'INSUFFICIENT_DATA';
}

function calculateWeightedConfidence(checks: DataSufficiencyCheck[]): DataConfidenceLevel {
  let totalWeight = 0;
  let weightedSum = 0;

  const confidenceValues: Record<DataConfidenceLevel, number> = {
    INSUFFICIENT_DATA: 0,
    LOW_CONFIDENCE: 1,
    MODERATE_CONFIDENCE: 2,
    HIGH_CONFIDENCE: 3,
  };

  for (const check of checks) {
    const value = confidenceValues[check.status];
    weightedSum += value * check.weight;
    totalWeight += check.weight;
  }

  if (totalWeight === 0) return 'INSUFFICIENT_DATA';

  const avg = weightedSum / totalWeight;
  if (avg >= 2.5) return 'HIGH_CONFIDENCE';
  if (avg >= 1.5) return 'MODERATE_CONFIDENCE';
  if (avg >= 0.5) return 'LOW_CONFIDENCE';
  return 'INSUFFICIENT_DATA';
}

function getThresholdsForCheck(name: string): { low: number; moderate: number; high: number } {
  switch (name) {
    case 'salesHistoryDays':
      return { low: MIN_DAYS_FOR_LOW, moderate: MIN_DAYS_FOR_MODERATE, high: MIN_DAYS_FOR_HIGH };
    case 'totalBills':
      return { low: MIN_BILLS_FOR_LOW, moderate: MIN_BILLS_FOR_MODERATE, high: MIN_BILLS_FOR_HIGH };
    case 'promotionHistory':
      return { low: MIN_PROMOS_FOR_LOW, moderate: MIN_PROMOS_FOR_MODERATE, high: MIN_PROMOS_FOR_HIGH };
    case 'customerBase':
      return { low: MIN_CUSTOMERS_FOR_LOW, moderate: MIN_CUSTOMERS_FOR_MODERATE, high: MIN_CUSTOMERS_FOR_HIGH };
    default:
      return { low: 1, moderate: 5, high: 20 };
  }
}

function getWeightForCheck(name: string): number {
  switch (name) {
    case 'salesHistoryDays': return 3;
    case 'totalBills': return 3;
    case 'promotionHistory': return 2;
    case 'customerBase': return 1;
    case 'productVariety': return 1;
    default: return 1;
  }
}

export async function assessDataSufficiency(options: DataSufficiencyOptions): Promise<DataSufficiencyReport> {
  const { restaurantId, branchId } = options;
  const oid = objectId(restaurantId);

  const billFilter: any = { restaurantId: oid, isVoided: { $ne: true }, isDeleted: { $ne: true } };
  if (branchId) billFilter.branchId = objectId(branchId);

  // Parallel data gathering
  const [
    billsAgg,
    itemsAgg,
    productCount,
    customerCount,
    promoCount,
    earliestBill,
    latestBill,
  ] = await Promise.all([
    BillModel.aggregate([
      { $match: billFilter },
      {
        $group: {
          _id: null,
          totalBills: { $sum: 1 },
          earliestDate: { $min: '$createdAt' },
          latestDate: { $max: '$createdAt' }
        }
      }
    ]).exec(),
    BillItemModel.aggregate([
      {
        $match: {
          restaurantId: oid,
          isVoided: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalItems: { $sum: { $ifNull: ['$quantity', 1] } },
          uniqueProducts: { $addToSet: '$itemId' },
        },
      },
      { $project: { totalItems: 1, uniqueProducts: { $size: '$uniqueProducts' } } },
    ]).exec(),
    ProductModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }).exec(),
    CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }).exec(),
    OfferModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }).exec(),
    BillModel.findOne(billFilter).sort({ createdAt: 1 }).select('createdAt').lean().exec(),
    BillModel.findOne(billFilter).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
  ]);

  const billsData = billsAgg[0] || { totalBills: 0, earliestDate: null, latestDate: null };
  const itemsData = itemsAgg[0] || { totalItems: 0, uniqueProducts: 0 };

  const totalBills = billsData.totalBills || 0;
  const totalItems = itemsData.totalItems || 0;
  const uniqueProductsFromItems = itemsData.uniqueProducts || 0;
  const uniqueProducts = Math.max(uniqueProductsFromItems, productCount || 0);
  const uniqueCustomers = customerCount || 0;
  const totalPromotions = promoCount || 0;

  const earliestBillDate = earliestBill?.createdAt || null;
  const latestBillDate = latestBill?.createdAt || null;

  let daysOfHistory = 0;
  if (earliestBillDate && latestBillDate) {
    daysOfHistory = Math.ceil((latestBillDate.getTime() - earliestBillDate.getTime()) / (24 * 60 * 60 * 1000));
  }

  let promotionHistoryDays = 0;
  if (totalPromotions > 0) {
    // Get earliest promotion date
    const earliestPromo = await OfferModel.findOne({ restaurantId: oid, isDeleted: { $ne: true } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean()
      .exec();
    if (earliestPromo?.createdAt) {
      promotionHistoryDays = Math.ceil((Date.now() - earliestPromo.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    }
  }

  // Run checks
  const checks: DataSufficiencyCheck[] = [
    {
      name: 'salesHistoryDays',
      description: 'Days of continuous sales history available',
      status: calculateConfidenceLevel(daysOfHistory, { low: MIN_DAYS_FOR_LOW, moderate: MIN_DAYS_FOR_MODERATE, high: MIN_DAYS_FOR_HIGH }),
      value: daysOfHistory,
      threshold: MIN_DAYS_FOR_MODERATE,
      unit: 'days',
      weight: getWeightForCheck('salesHistoryDays'),
    },
    {
      name: 'totalBills',
      description: 'Total number of completed bills',
      status: calculateConfidenceLevel(totalBills, { low: MIN_BILLS_FOR_LOW, moderate: MIN_BILLS_FOR_MODERATE, high: MIN_BILLS_FOR_HIGH }),
      value: totalBills,
      threshold: MIN_BILLS_FOR_MODERATE,
      unit: 'bills',
      weight: getWeightForCheck('totalBills'),
    },
    {
      name: 'promotionHistory',
      description: 'Number of historical promotions run',
      status: calculateConfidenceLevel(totalPromotions, { low: MIN_PROMOS_FOR_LOW, moderate: MIN_PROMOS_FOR_MODERATE, high: MIN_PROMOS_FOR_HIGH }),
      value: totalPromotions,
      threshold: MIN_PROMOS_FOR_MODERATE,
      unit: 'promotions',
      weight: getWeightForCheck('promotionHistory'),
    },
    {
      name: 'customerBase',
      description: 'Size of customer base',
      status: calculateConfidenceLevel(uniqueCustomers, { low: MIN_CUSTOMERS_FOR_LOW, moderate: MIN_CUSTOMERS_FOR_MODERATE, high: MIN_CUSTOMERS_FOR_HIGH }),
      value: uniqueCustomers,
      threshold: MIN_CUSTOMERS_FOR_MODERATE,
      unit: 'customers',
      weight: getWeightForCheck('customerBase'),
    },
    {
      name: 'productVariety',
      description: 'Number of unique products with sales history',
      status: calculateConfidenceLevel(uniqueProducts, { low: 5, moderate: 20, high: 50 }),
      value: uniqueProducts,
      threshold: 20,
      unit: 'products',
      weight: getWeightForCheck('productVariety'),
    },
  ];

  const overall = calculateWeightedConfidence(checks);

  // Determine recommended capabilities based on data sufficiency
  const recommendedCapabilities: string[] = [];
  const limitations: string[] = [];

  if (overall === 'HIGH_CONFIDENCE') {
    recommendedCapabilities.push(
      'Full demand forecasting with seasonality',
      'Promotion optimization with elasticity estimation',
      'Capacity-aware recommendations',
      'Festival/seasonal predictions',
      'Inventory-aware promotion optimization',
      'Customer segment targeting',
      'A/B testing framework'
    );
  } else if (overall === 'MODERATE_CONFIDENCE') {
    recommendedCapabilities.push(
      'Demand forecasting with day-of-week patterns',
      'Promotion optimization with bounded search',
      'Basic inventory-aware recommendations',
      'Festival-based recommendations',
      'Customer reactivation campaigns'
    );
    limitations.push('Limited seasonal forecasting accuracy');
    limitations.push('Elasticity estimates may be unreliable');
    limitations.push('Limited A/B testing power');
  } else if (overall === 'LOW_CONFIDENCE') {
    recommendedCapabilities.push(
      'Basic day-of-week demand patterns',
      'Simple promotion suggestions',
      'Inventory clearance recommendations',
      'Customer win-back campaigns'
    );
    limitations.push('Insufficient data for reliable demand forecasting');
    limitations.push('Cannot estimate promotion elasticity');
    limitations.push('Seasonal predictions unavailable');
    limitations.push('A/B testing not recommended');
  } else {
    limitations.push('Insufficient data for any predictive intelligence');
    limitations.push('Minimum 14 days and 50 bills required for basic capabilities');
    recommendedCapabilities.push('Focus on collecting sales data first');
  }

  // Promotion-specific limitations
  if (totalPromotions < MIN_PROMOS_FOR_MODERATE) {
    limitations.push('Insufficient promotion history for reliable optimization');
    if (overall !== 'INSUFFICIENT_DATA') {
      limitations.push('Promotion optimization will use conservative defaults');
    }
  }

  return {
    restaurantId,
    branchId,
    overall,
    checks,
    dataSummary: {
      daysOfSalesHistory: daysOfHistory,
      totalBills,
      totalOrderItems: totalItems,
      uniqueProducts,
      uniqueCustomers,
      totalPromotionsRun: totalPromotions,
      earliestBillDate,
      latestBillDate,
      promotionHistoryDays,
    },
    recommendedCapabilities,
    limitations,
  };
}

export async function getDataSufficiencySummary(restaurantId: string, branchId?: string): Promise<{
  overall: DataConfidenceLevel;
  canForecast: boolean;
  canOptimizePromotions: boolean;
  canRunExperiments: boolean;
  daysOfHistory: number;
  totalBills: number;
  totalPromotions: number;
}> {
  const report = await assessDataSufficiency({ restaurantId, branchId });
  return {
    overall: report.overall,
    canForecast: report.overall !== 'INSUFFICIENT_DATA',
    canOptimizePromotions: report.overall === 'MODERATE_CONFIDENCE' || report.overall === 'HIGH_CONFIDENCE',
    canRunExperiments: report.overall === 'HIGH_CONFIDENCE',
    daysOfHistory: report.dataSummary.daysOfSalesHistory,
    totalBills: report.dataSummary.totalBills,
    totalPromotions: report.dataSummary.totalPromotionsRun,
  };
}