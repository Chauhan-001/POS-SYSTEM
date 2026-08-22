/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationCandidateService — Unified recommendation lifecycle management.
 * Handles deduplication, cooldown, status transitions, and outcome tracking.
 */

import mongoose from 'mongoose';
import PromotionCandidateModel, { IPromotionCandidate } from '../models/PromotionCandidate';
import IntelligenceSignalModel from '../models/IntelligenceSignal';
import { generatePromotionCandidates, PromotionCandidate, deduplicateCandidates, PromotionCandidateOptions } from './promotionCandidateService';

export type RecommendationStatus =
  | 'NEW'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SNOOZED'
  | 'IMPLEMENTED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'COOLDOWN';

export interface RecommendationCandidate extends PromotionCandidate {
  status: RecommendationStatus;
  viewedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  snoozedAt?: Date;
  snoozedUntil?: Date;
  implementedAt?: Date;
  expiredAt?: Date;
  convertedAt?: Date;
  cooldownUntil?: Date;
  offerId?: string;
  campaignId?: string;
  actionTaken?: string;
  outcome?: string;
  instanceCount: number;
  fingerprint: string;
}

export interface RecommendationOptions extends PromotionCandidateOptions {
  cooldownDays?: number; // Default 30
  snoozeDays?: number; // Default 7
}

const DEFAULT_COOLDOWN_DAYS = 30;
const DEFAULT_SNOOZE_DAYS = 7;

/**
 * Generate fingerprint for deduplication
 */
export function generateRecommendationFingerprint(candidate: PromotionCandidate): string {
  const targetKey = [
    ...candidate.target.productIds,
    ...candidate.target.categoryIds,
    ...candidate.target.segmentIds,
  ].sort().join('|');
  return `${candidate.type}:${targetKey}`.toLowerCase();
}

/**
 * Generate and persist new recommendations
 */
export async function generateAndPersistRecommendations(opts: RecommendationOptions): Promise<RecommendationCandidate[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    constraints,
    minScore = 40,
    minConfidence = 0.4,
    cooldownDays = DEFAULT_COOLDOWN_DAYS,
  } = opts;

  // Generate raw candidates
  const candidates = await generatePromotionCandidates({
    restaurantId,
    branchId,
    lookbackDays,
    constraints,
    minScore,
    minConfidence,
  });

  // Deduplicate
  const uniqueCandidates = deduplicateCandidates(candidates);

  // Check for existing active/cooldown recommendations with same fingerprint
  const finalCandidates: RecommendationCandidate[] = [];

  for (const candidate of uniqueCandidates) {
    const fingerprint = generateRecommendationFingerprint(candidate);

    // Check if fingerprint is active or in cooldown
    const existing = await PromotionCandidateModel.findOne({
      restaurantId: objectId(restaurantId),
      fingerprint,
      status: { $in: ['ACCEPTED', 'IMPLEMENTED', 'CONVERTED', 'COOLDOWN'] },
    }).lean().exec();

    if (existing) {
      // Skip - already active or cooling down
      continue;
    }

    // Check for recently rejected/dismissed (don't re-recommend too quickly)
    const recentRejection = await PromotionCandidateModel.findOne({
      restaurantId: objectId(restaurantId),
      fingerprint,
      status: { $in: ['REJECTED', 'DISMISSED'] },
      updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 days
    }).lean().exec();

    if (recentRejection) {
      continue; // Respect recent rejection
    }

    const reco: RecommendationCandidate = {
      ...candidate,
      status: 'NEW',
      instanceCount: 1,
      fingerprint,
      createdAt: new Date(),
      expiresAt: candidate.expiresAt,
    };

    finalCandidates.push(reco);
  }

  // Persist
  if (finalCandidates.length > 0) {
    const docs = finalCandidates.map(c => ({
      restaurantId: objectId(restaurantId),
      branchId: branchId ? objectId(branchId) : undefined,
      type: c.type,
      priority: c.priority,
      score: c.score,
      confidence: c.confidence,
      title: c.title,
      description: c.description,
      target: c.target,
      evidence: c.evidence,
      financialModel: c.financialModel,
      cannibalization: c.cannibalization,
      risks: c.risks,
      prerequisites: c.prerequisites,
      constraints: c.constraints,
      status: c.status,
      recommendedAction: c.recommendedAction,
      sourceSignals: c.sourceSignals,
      fingerprint: c.fingerprint,
      instanceCount: c.instanceCount,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
    }));

    await PromotionCandidateModel.insertMany(docs, { ordered: false });
  }

  return finalCandidates;
}

/**
 * Get recommendations for a restaurant with filtering
 */
export async function getRecommendations(
  restaurantId: string,
  options: {
    branchId?: string;
    status?: RecommendationStatus[];
    type?: string[];
    priority?: string[];
    limit?: number;
    offset?: number;
  } = {}
): Promise<RecommendationCandidate[]> {
  const { branchId, status, type, priority, limit = 50, offset = 0 } = options;

  const filter: any = { restaurantId: objectId(restaurantId) };
  if (branchId) filter.branchId = objectId(branchId);
  if (status && status.length > 0) filter.status = { $in: status };
  if (type && type.length > 0) filter.type = { $in: type };
  if (priority && priority.length > 0) filter.priority = { $in: priority };

  const docs = await PromotionCandidateModel.find(filter)
    .sort({ score: -1, createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean()
    .exec();

  return docs.map(doc => ({
    ...doc,
    id: String(doc._id),
    restaurantId: String(doc.restaurantId),
    branchId: doc.branchId ? String(doc.branchId) : undefined,
    offerId: doc.offerId ? String(doc.offerId) : undefined,
    campaignId: doc.campaignId ? String(doc.campaignId) : undefined,
  }));
}

/**
 * Get single recommendation by ID
 */
export async function getRecommendationById(
  restaurantId: string,
  recommendationId: string
): Promise<RecommendationCandidate | null> {
  const doc = await PromotionCandidateModel.findOne({
    _id: objectId(recommendationId),
    restaurantId: objectId(restaurantId),
  }).lean().exec();

  if (!doc) return null;

  return {
    ...doc,
    id: String(doc._id),
    restaurantId: String(doc.restaurantId),
    branchId: doc.branchId ? String(doc.branchId) : undefined,
    offerId: doc.offerId ? String(doc.offerId) : undefined,
    campaignId: doc.campaignId ? String(doc.campaignId) : undefined,
  };
}

/**
 * Record owner action on recommendation
 */
export async function recordRecommendationAction(
  restaurantId: string,
  recommendationId: string,
  action: 'accept' | 'reject' | 'snooze' | 'dismiss' | 'implement',
  options: {
    snoozeDays?: number;
    actionTaken?: string;
  } = {}
): Promise<RecommendationCandidate | null> {
  const { snoozeDays = DEFAULT_SNOOZE_DAYS, actionTaken } = options;

  const update: any = {
    updatedAt: new Date(),
  };

  const now = new Date();

  switch (action) {
    case 'accept':
      update.status = 'ACCEPTED';
      update.acceptedAt = now;
      update.actionTaken = actionTaken || 'accepted';
      break;
    case 'reject':
      update.status = 'REJECTED';
      update.rejectedAt = now;
      update.actionTaken = actionTaken || 'rejected';
      break;
    case 'dismiss':
      update.status = 'EXPIRED';
      update.expiredAt = now;
      update.actionTaken = actionTaken || 'dismissed';
      break;
    case 'snooze':
      update.status = 'SNOOZED';
      update.snoozedAt = now;
      update.snoozedUntil = new Date(now.getTime() + snoozeDays * 24 * 60 * 60 * 1000);
      update.actionTaken = actionTaken || 'snoozed';
      break;
    case 'implement':
      update.status = 'IMPLEMENTED';
      update.implementedAt = now;
      update.actionTaken = actionTaken || 'implemented';
      break;
  }

  const doc = await PromotionCandidateModel.findOneAndUpdate(
    { _id: objectId(recommendationId), restaurantId: objectId(restaurantId) },
    { $set: update },
    { new: true, lean: true }
  ).exec();

  if (!doc) return null;

  return {
    ...doc,
    id: String(doc._id),
    restaurantId: String(doc.restaurantId),
    branchId: doc.branchId ? String(doc.branchId) : undefined,
    offerId: doc.offerId ? String(doc.offerId) : undefined,
    campaignId: doc.campaignId ? String(doc.campaignId) : undefined,
  };
}

/**
 * Mark recommendation as converted (offer created)
 */
export async function markRecommendationConverted(
  restaurantId: string,
  recommendationId: string,
  offerId: string,
  campaignId?: string
): Promise<RecommendationCandidate | null> {
  const update: any = {
    status: 'CONVERTED',
    convertedAt: new Date(),
    offerId: objectId(offerId),
    actionTaken: 'offer_created',
  };

  if (campaignId) {
    update.campaignId = objectId(campaignId);
  }

  const doc = await PromotionCandidateModel.findOneAndUpdate(
    { _id: objectId(recommendationId), restaurantId: objectId(restaurantId) },
    { $set: update },
    { new: true, lean: true }
  ).exec();

  if (!doc) return null;

  // Start cooldown
  await startCooldown(restaurantId, recommendationId, DEFAULT_COOLDOWN_DAYS);

  return {
    ...doc,
    id: String(doc._id),
    restaurantId: String(doc.restaurantId),
    branchId: doc.branchId ? String(doc.branchId) : undefined,
    offerId: doc.offerId ? String(doc.offerId) : undefined,
    campaignId: doc.campaignId ? String(doc.campaignId) : undefined,
  };
}

/**
 * Record measurable outcome
 */
export async function recordRecommendationOutcome(
  restaurantId: string,
  recommendationId: string,
  outcome: string
): Promise<RecommendationCandidate | null> {
  const doc = await PromotionCandidateModel.findOneAndUpdate(
    { _id: objectId(recommendationId), restaurantId: objectId(restaurantId) },
    {
      $set: {
        outcome,
        updatedAt: new Date(),
      },
    },
    { new: true, lean: true }
  ).exec();

  if (!doc) return null;

  return {
    ...doc,
    id: String(doc._id),
    restaurantId: String(doc.restaurantId),
    branchId: doc.branchId ? String(doc.branchId) : undefined,
    offerId: doc.offerId ? String(doc.offerId) : undefined,
    campaignId: doc.campaignId ? String(doc.campaignId) : undefined,
  };
}

/**
 * Start cooldown period
 */
async function startCooldown(
  restaurantId: string,
  recommendationId: string,
  cooldownDays: number
): Promise<void> {
  const cooldownUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);

  await PromotionCandidateModel.findOneAndUpdate(
    { _id: objectId(recommendationId), restaurantId: objectId(restaurantId) },
    {
      $set: {
        status: 'COOLDOWN',
        cooldownUntil,
        updatedAt: new Date(),
      },
    }
  ).exec();
}

/**
 * Re-evaluate expired cooldowns
 */
export async function reEvaluateCooldowns(restaurantId: string): Promise<number> {
  const now = new Date();

  const result = await PromotionCandidateModel.updateMany(
    {
      restaurantId: objectId(restaurantId),
      status: 'COOLDOWN',
      cooldownUntil: { $lte: now },
    },
    {
      $set: {
        status: 'NEW',
        cooldownUntil: null,
        updatedAt: now,
      },
      $inc: { instanceCount: 1 },
    }
  ).exec();

  return result.modifiedCount;
}

/**
 * Expire old recommendations
 */
export async function expireOldRecommendations(restaurantId: string): Promise<number> {
  const now = new Date();

  const result = await PromotionCandidateModel.updateMany(
    {
      restaurantId: objectId(restaurantId),
      status: { $in: ['NEW', 'VIEWED', 'SNOOZED'] },
      $or: [
        { expiresAt: { $lte: now } },
        { snoozedUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'EXPIRED',
        expiredAt: now,
        updatedAt: now,
      },
    }
  ).exec();

  return result.modifiedCount;
}

/**
 * Get recommendation statistics
 */
export async function getRecommendationStats(restaurantId: string, branchId?: string): Promise<{
  total: number;
  byStatus: Record<RecommendationStatus, number>;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  avgScore: number;
  conversionRate: number;
}> {
  const filter: any = { restaurantId: objectId(restaurantId) };
  if (branchId) filter.branchId = objectId(branchId);

  const stats = await PromotionCandidateModel.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        avgScore: { $avg: '$score' },
        byStatus: { $push: '$status' },
        byType: { $push: '$type' },
        byPriority: { $push: '$priority' },
        converted: { $sum: { $cond: [{ $in: ['$status', ['CONVERTED', 'IMPLEMENTED']] }, 1, 0] } },
        accepted: { $sum: { $cond: [{ $in: ['$status', ['ACCEPTED', 'CONVERTED', 'IMPLEMENTED']] }, 1, 0] } },
      },
    },
  ]).exec();

  if (stats.length === 0) {
    return {
      total: 0,
      byStatus: {} as Record<RecommendationStatus, number>,
      byType: {},
      byPriority: {},
      avgScore: 0,
      conversionRate: 0,
    };
  }

  const s = stats[0];

  // Count by status
  const byStatus: Record<RecommendationStatus, number> = {
    NEW: 0, VIEWED: 0, ACCEPTED: 0, REJECTED: 0,
    SNOOZED: 0, IMPLEMENTED: 0, EXPIRED: 0, CONVERTED: 0, COOLDOWN: 0,
  };
  for (const status of s.byStatus) {
    if (byStatus[status as RecommendationStatus] !== undefined) {
      byStatus[status as RecommendationStatus]++;
    }
  }

  // Count by type
  const byType: Record<string, number> = {};
  for (const type of s.byType) {
    byType[type] = (byType[type] || 0) + 1;
  }

  // Count by priority
  const byPriority: Record<string, number> = {};
  for (const priority of s.byPriority) {
    byPriority[priority] = (byPriority[priority] || 0) + 1;
  }

  return {
    total: s.total,
    byStatus,
    byType,
    byPriority,
    avgScore: Math.round(s.avgScore * 10) / 10,
    conversionRate: s.accepted > 0 ? Math.round((s.converted / s.accepted) * 100) : 0,
  };
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}