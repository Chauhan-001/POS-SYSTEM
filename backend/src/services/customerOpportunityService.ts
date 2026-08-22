/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerOpportunityService — Detects customer lifecycle opportunities
 * using existing customer data and segments.
 */

import mongoose from 'mongoose';
import CustomerModel from '../models/Customer';
import CustomerSegmentModel from '../models/CustomerSegment';
import BillModel from '../models/Bill';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';

export interface CustomerSegmentOpportunity {
  segmentId: string;
  segmentName: string;
  customerCount: number;
  opportunityType: 'NEW_CUSTOMER' | 'RETURNING' | 'INACTIVE' | 'HIGH_VALUE' | 'FREQUENT' | 'AT_RISK';
  severity: 'low' | 'medium' | 'high';
  avgOrderValue: number;
  avgVisits: number;
  avgPoints: number;
  daysSinceLastVisit: number;
  evidence: ISignalEvidence[];
  recommendedActions: string[];
}

export interface CustomerOpportunityOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  inactiveThresholdDays?: number; // Default 30
  highValueThresholdVisits?: number; // Default 20
  highValueThresholdPoints?: number; // Default 500
  atRiskThresholdDays?: number; // Default 60
}

const DEFAULT_INACTIVE_DAYS = 30;
const DEFAULT_HIGH_VALUE_VISITS = 20;
const DEFAULT_HIGH_VALUE_POINTS = 500;
const DEFAULT_AT_RISK_DAYS = 60;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Get customer metrics for a segment
 */
async function getSegmentMetrics(
  restaurantId: string,
  segmentId: string,
  opts: CustomerOpportunityOptions
): Promise<{
  count: number;
  avgOrderValue: number;
  avgVisits: number;
  avgPoints: number;
  avgDaysSinceLastVisit: number;
  newCustomers: number;
  returningCustomers: number;
  inactiveCustomers: number;
  highValueCustomers: number;
  atRiskCustomers: number;
}> {
  const { inactiveThresholdDays = DEFAULT_INACTIVE_DAYS, atRiskThresholdDays = DEFAULT_AT_RISK_DAYS } = opts;

  const customers = await CustomerModel.find({
    restaurantId: objectId(restaurantId),
    segments: objectId(segmentId),
    isDeleted: { $ne: true },
  })
    .select('visits points lastVisit totalSpend createdAt')
    .lean()
    .exec();

  if (customers.length === 0) {
    return { count: 0, avgOrderValue: 0, avgVisits: 0, avgPoints: 0, avgDaysSinceLastVisit: 0, newCustomers: 0, returningCustomers: 0, inactiveCustomers: 0, highValueCustomers: 0, atRiskCustomers: 0 };
  }

  const now = new Date();
  let totalVisits = 0, totalPoints = 0, totalSpend = 0, totalDaysSinceVisit = 0;
  let newCustomers = 0, returningCustomers = 0, inactiveCustomers = 0, highValueCustomers = 0, atRiskCustomers = 0;

  for (const c of customers) {
    totalVisits += c.visits || 0;
    totalPoints += c.points || 0;
    totalSpend += c.totalSpend || 0;

    const lastVisit = c.lastVisit ? new Date(c.lastVisit) : null;
    const daysSinceVisit = lastVisit ? Math.ceil((now.getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000)) : 999;
    totalDaysSinceVisit += daysSinceVisit;

    const createdAt = new Date(c.createdAt);
    const daysSinceCreated = Math.ceil((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));

    if (daysSinceCreated <= 30) newCustomers++;
    else if ((c.visits || 0) >= 2) returningCustomers++;

    if (daysSinceVisit > inactiveThresholdDays) inactiveCustomers++;
    if ((c.visits || 0) >= opts.highValueThresholdVisits! && (c.points || 0) >= opts.highValueThresholdPoints!) highValueCustomers++;
    if (daysSinceVisit > atRiskThresholdDays && daysSinceVisit <= inactiveThresholdDays) atRiskCustomers++;
  }

  const count = customers.length;
  const avgOrderValue = totalVisits > 0 ? totalSpend / totalVisits : 0;

  return {
    count,
    avgOrderValue: Math.round(avgOrderValue),
    avgVisits: Math.round(totalVisits / count),
    avgPoints: Math.round(totalPoints / count),
    avgDaysSinceLastVisit: Math.round(totalDaysSinceVisit / count),
    newCustomers,
    returningCustomers,
    inactiveCustomers,
    highValueCustomers,
    atRiskCustomers,
  };
}

/**
 * Detect customer segment opportunities
 */
export async function detectCustomerOpportunities(opts: CustomerOpportunityOptions): Promise<CustomerSegmentOpportunity[]> {
  const { restaurantId, branchId, lookbackDays = 90, inactiveThresholdDays = DEFAULT_INACTIVE_DAYS } = opts;

  // Get all segments for this restaurant
  const segments = await CustomerSegmentModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  })
    .select('_id name customerCount')
    .lean()
    .exec();

  if (segments.length === 0) return [];

  // Get overall customer counts for baseline
  const overallCounts = await CustomerModel.aggregate([
    { $match: { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        new: [{ $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }, { $count: 'count' }],
        inactive: [{ $match: { $or: [{ lastVisit: { $lt: new Date(Date.now() - inactiveThresholdDays * 24 * 60 * 60 * 1000) } }, { lastVisit: null }, { lastVisit: { $exists: false } }] } }, { $count: 'count' }],
        highValue: [{ $match: { visits: { $gte: opts.highValueThresholdVisits! }, points: { $gte: opts.highValueThresholdPoints! } } }, { $count: 'count' }],
      },
    },
  ]).exec();

  const totalCustomers = overallCounts[0]?.total[0]?.count || 0;
  const newCustomerPct = totalCustomers > 0 ? (overallCounts[0]?.new[0]?.count || 0) / totalCustomers : 0;
  const inactivePct = totalCustomers > 0 ? (overallCounts[0]?.inactive[0]?.count || 0) / totalCustomers : 0;
  const highValuePct = totalCustomers > 0 ? (overallCounts[0]?.highValue[0]?.count || 0) / totalCustomers : 0;

  const opportunities: CustomerSegmentOpportunity[] = [];

  for (const segment of segments) {
    const metrics = await getSegmentMetrics(restaurantId, String(segment._id), opts);
    if (metrics.count === 0) continue;

    const evidence: ISignalEvidence[] = [];
    const recommendedActions: string[] = [];
    let opportunityType: CustomerSegmentOpportunity['opportunityType'] | null = null;
    let severity: CustomerSegmentOpportunity['severity'] = 'low';

    // NEW_CUSTOMER opportunity
    if (metrics.newCustomers > 0 && metrics.newCustomers / metrics.count > newCustomerPct * 1.5) {
      opportunityType = 'NEW_CUSTOMER';
      severity = 'medium';
      evidence.push({
        description: `${metrics.newCustomers} new customers (${Math.round(metrics.newCustomers / metrics.count * 100)}% of segment)`,
        value: metrics.newCustomers / metrics.count,
        baseline: newCustomerPct,
        percentageChange: Math.round((metrics.newCustomers / metrics.count - newCustomerPct) / newCustomerPct * 100),
        sampleSize: metrics.count,
        confidence: 0.8,
      });
      recommendedActions.push('Send welcome offer (first-visit discount)');
      recommendedActions.push('Enroll in loyalty program automatically');
      recommendedActions.push('Collect feedback after first visit');
    }

    // RETURNING opportunity
    if (metrics.returningCustomers / metrics.count > 0.5) {
      opportunityType = opportunityType || 'RETURNING';
      severity = 'low';
      evidence.push({
        description: `${metrics.returningCustomers} returning customers (${Math.round(metrics.returningCustomers / metrics.count * 100)}%)`,
        value: metrics.returningCustomers / metrics.count,
        baseline: 0.5,
        sampleSize: metrics.count,
        confidence: 0.7,
      });
      recommendedActions.push('Offer double loyalty points on next visit');
      recommendedActions.push('Send personalized recommendations');
    }

    // INACTIVE opportunity
    if (metrics.inactiveCustomers > 0) {
      opportunityType = opportunityType || 'INACTIVE';
      severity = metrics.inactiveCustomers / metrics.count > 0.3 ? 'high' : 'medium';
      evidence.push({
        description: `${metrics.inactiveCustomers} inactive customers (${Math.round(metrics.inactiveCustomers / metrics.count * 100)}%, avg ${metrics.avgDaysSinceLastVisit} days since visit)`,
        value: metrics.inactiveCustomers / metrics.count,
        baseline: inactivePct,
        percentageChange: Math.round((metrics.inactiveCustomers / metrics.count - inactivePct) / inactivePct * 100),
        sampleSize: metrics.count,
        confidence: 0.8,
      });
      recommendedActions.push('Send win-back offer (minimum order discount)');
      recommendedActions.push('Segment by previous favorites for targeted outreach');
      recommendedActions.push('Limit to 1 use per customer to protect margin');
    }

    // HIGH_VALUE opportunity
    if (metrics.highValueCustomers > 0) {
      opportunityType = opportunityType || 'HIGH_VALUE';
      severity = 'medium';
      evidence.push({
        description: `${metrics.highValueCustomers} high-value customers (${Math.round(metrics.highValueCustomers / metrics.count * 100)}%, avg ₹${metrics.avgOrderValue} AOV)`,
        value: metrics.highValueCustomers / metrics.count,
        baseline: highValuePct,
        percentageChange: Math.round((metrics.highValueCustomers / metrics.count - highValuePct) / highValuePct * 100),
        sampleSize: metrics.count,
        confidence: 0.8,
      });
      recommendedActions.push('VIP reward: exclusive discount or free item');
      recommendedActions.push('Early access to new menu items');
      recommendedActions.push('Priority reservation/waitlist');
    }

    // AT_RISK opportunity
    if (metrics.atRiskCustomers > 0) {
      opportunityType = opportunityType || 'AT_RISK';
      severity = 'high';
      evidence.push({
        description: `${metrics.atRiskCustomers} at-risk customers (${Math.round(metrics.atRiskCustomers / metrics.count * 100)}%, haven't visited in ${opts.atRiskThresholdDays!}-${inactiveThresholdDays} days)`,
        value: metrics.atRiskCustomers / metrics.count,
        baseline: 0,
        sampleSize: metrics.count,
        confidence: 0.8,
      });
      recommendedActions.push('Proactive retention: personal outreach');
      recommendedActions.push('Special "we miss you" offer with deadline');
    }

    if (opportunityType) {
      opportunities.push({
        segmentId: String(segment._id),
        segmentName: segment.name,
        customerCount: metrics.count,
        opportunityType,
        severity,
        avgOrderValue: metrics.avgOrderValue,
        avgVisits: metrics.avgVisits,
        avgPoints: metrics.avgPoints,
        daysSinceLastVisit: metrics.avgDaysSinceLastVisit,
        evidence,
        recommendedActions,
      });
    }
  }

  return opportunities;
}

/**
 * Get customer lifecycle summary
 */
export async function getCustomerLifecycleSummary(opts: CustomerOpportunityOptions): Promise<{
  totalCustomers: number;
  newCustomers: number;
  activeCustomers: number;
  inactiveCustomers: number;
  highValueCustomers: number;
  atRiskCustomers: number;
  avgOrderValue: number;
  avgVisitsPerCustomer: number;
  topSegments: CustomerSegmentOpportunity[];
  actionItems: CustomerSegmentOpportunity[];
}> {
  const segments = await detectCustomerOpportunities(opts);

  // Get overall counts
  const { restaurantId, inactiveThresholdDays = DEFAULT_INACTIVE_DAYS } = opts;
  const overall = await CustomerModel.aggregate([
    { $match: { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        new: [{ $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }, { $count: 'count' }],
        active: [{ $match: { visits: { $gte: 1 } } }, { $count: 'count' }],
        inactive: [{ $match: { $or: [{ lastVisit: { $lt: new Date(Date.now() - inactiveThresholdDays * 24 * 60 * 60 * 1000) } }, { lastVisit: null }, { lastVisit: { $exists: false } }] } }, { $count: 'count' }],
        highValue: [{ $match: { visits: { $gte: opts.highValueThresholdVisits! }, points: { $gte: opts.highValueThresholdPoints! } } }, { $count: 'count' }],
        atRisk: [{ $match: { $and: [ { lastVisit: { $lt: new Date(Date.now() - opts.atRiskThresholdDays! * 24 * 60 * 60 * 1000) } }, { $or: [ { lastVisit: { $gte: new Date(Date.now() - inactiveThresholdDays * 24 * 60 * 60 * 1000) } }, { lastVisit: null }, { lastVisit: { $exists: false } } ] } ] } }, { $count: 'count' }],
        avgAOV: [{ $group: { _id: null, avgAOV: { $avg: { $cond: [{ $gt: ['$visits', 0] }, { $divide: ['$totalSpend', '$visits'] }, 0] } } } }],
        avgVisits: [{ $group: { _id: null, avgVisits: { $avg: '$visits' } } }],
      },
    },
  ]).exec();

  const total = overall[0]?.total[0]?.count || 0;
  const newC = overall[0]?.new[0]?.count || 0;
  const active = overall[0]?.active[0]?.count || 0;
  const inactive = overall[0]?.inactive[0]?.count || 0;
  const highValue = overall[0]?.highValue[0]?.count || 0;
  const atRisk = overall[0]?.atRisk[0]?.count || 0;
  const avgAOV = overall[0]?.avgAOV[0]?.avgAOV || 0;
  const avgVisits = overall[0]?.avgVisits[0]?.avgVisits || 0;

  return {
    totalCustomers: total,
    newCustomers: newC,
    activeCustomers: active,
    inactiveCustomers: inactive,
    highValueCustomers: highValue,
    atRiskCustomers: atRisk,
    avgOrderValue: Math.round(avgAOV),
    avgVisitsPerCustomer: Math.round(avgVisits * 10) / 10,
    topSegments: segments.slice(0, 5),
    actionItems: segments.filter(s => s.severity === 'high' || (s.severity === 'medium' && s.opportunityType === 'INACTIVE')).slice(0, 5),
  };
}

/**
 * Persist customer opportunities as signals
 */
export async function persistCustomerOpportunitiesAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  opportunities: CustomerSegmentOpportunity[]
): Promise<void> {
  if (opportunities.length === 0) return;

  const docs = opportunities.map(opp => ({
    restaurantId: objectId(restaurantId),
    branchId: branchId ? objectId(branchId) : undefined,
    type: opp.opportunityType === 'NEW_CUSTOMER' ? 'CUSTOMER_NEW_HIGH' :
      opp.opportunityType === 'RETURNING' ? 'CUSTOMER_RETURNING_HIGH' :
      opp.opportunityType === 'INACTIVE' ? 'CUSTOMER_INACTIVE_HIGH' :
      opp.opportunityType === 'HIGH_VALUE' ? 'CUSTOMER_HIGH_VALUE_HIGH' :
      opp.opportunityType === 'FREQUENT' ? 'CUSTOMER_FREQUENT_HIGH' :
      'CUSTOMER_INACTIVE_HIGH', // AT_RISK maps to inactive high
    entityType: 'customer_segment',
    entityId: opp.segmentId,
    entityName: opp.segmentName,
    value: opp.customerCount,
    baseline: 0,
    confidence: 0.7,
    minSampleSize: 1,
    sampleSize: opp.customerCount,
    evidence: opp.evidence,
    detectedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumed: false,
    tags: ['customer_opportunity', opp.opportunityType.toLowerCase(), opp.severity].filter(Boolean),
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get top customer opportunities
 */
export async function getTopCustomerOpportunities(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<CustomerSegmentOpportunity[]> {
  const opps = await detectCustomerOpportunities({ restaurantId, branchId });
  return opps.slice(0, limit);
}