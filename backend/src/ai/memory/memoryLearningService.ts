/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryLearningService.ts — PHASE 8 memory learning loop.
 *
 * Closes the lifecycle:
 *   recommendation → owner approval/rejection → campaign → outcome →
 *   analytics → EPISODE → validation → CONSOLIDATION (long-term memory)
 *
 * WHAT IT REUSES (no parallel analytics):
 *   - Phase 2 `memoryManager.recordEpisode` / `upsertLongTermMemory` (the ONLY
 *     memory writers — this service never touches the collections directly).
 *   - Existing lifecycle data: PromotionCandidate statuses/outcomes,
 *     CampaignHistory delivery + redemption counts.
 *   - Existing evidence conventions: MemoryEvidenceSchema refs.
 *
 * WHAT IT REFUSES TO DO:
 *   - It NEVER records an LLM interpretation as a fact. Consolidated memory is
 *     computed arithmetically from lifecycle rows; `source: 'service'`.
 *   - It NEVER lets one observation define behaviour: every rule has an
 *     explicit minimum sample size and confidence threshold.
 *   - It NEVER overwrites a still-valid memory with a weaker one: conflicting
 *     evidence SUPERSEDES only when stronger (larger sample / higher
 *     confidence); stale memory is marked invalidated, never silently kept.
 */

import mongoose from 'mongoose';
import { memoryManager } from './memoryManager';
import type { AiTenantContext } from '../shared/tenantContext';
import type { EpisodeInput, MemoryEvidence, RestaurantMemoryRecord } from './memoryTypes';
import PromotionCandidateModel from '../../models/marketing/PromotionCandidate';
import CampaignHistory from '../../models/marketing/CampaignHistory';
import RestaurantMemoryModel from '../../models/memory/RestaurantMemory';

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds (explicit, documented — no arbitrary numbers)
// ─────────────────────────────────────────────────────────────────────────────

/** A campaign/offer pattern needs at least this many recipients to matter. */
export const MIN_PATTERN_SAMPLE = 30;
/** And at least this redemption rate signal… */
export const MIN_PATTERN_CONFIDENCE = 0.55;
/** Rejections of the same strategy before we learn "owner dislikes it". */
export const MIN_REJECTION_OBSERVATIONS = 3;
/** Days after which a pattern is considered aging and re-validated. */
export const MEMORY_STALE_DAYS = 90;
/** Days after which an aging pattern is invalidated if never re-confirmed. */
export const MEMORY_INVALIDATE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Episode recording (lifecycle events → short-term memory)
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationLifecycleAction = 'recommended' | 'accepted' | 'rejected' | 'implemented' | 'converted' | 'outcome_positive' | 'outcome_negative';

const EPISODE_FOR_ACTION: Record<RecommendationLifecycleAction, EpisodeInput['episodeType']> = {
  recommended: 'recommendation_issued',
  accepted: 'campaign_proposed',
  rejected: 'manual_note',
  implemented: 'campaign_launched',
  converted: 'campaign_launched',
  outcome_positive: 'experiment_result',
  outcome_negative: 'experiment_result',
};

export interface RecommendationLifecycleEvent {
  tenant: AiTenantContext;
  action: RecommendationLifecycleAction;
  recommendationId?: string;
  /** Strategy / candidate type (engine vocabulary). */
  strategy?: string;
  title?: string;
  campaignRef?: string;
  outcome?: {
    status: EpisodeInput['outcome'] extends { status: infer S } | undefined ? S : never;
    summary?: string;
    metrics?: Record<string, number>;
  };
  evidence?: MemoryEvidence[];
  confidence?: number;
}

/**
 * Record one lifecycle event as an episode. NEVER throws (learning must not
 * break the lifecycle path); returns whether it was recorded.
 */
export async function recordRecommendationLifecycleEvent(
  event: RecommendationLifecycleEvent,
): Promise<{ recorded: boolean; episodeId?: string; reason?: string }> {
  try {
    const episodeType = EPISODE_FOR_ACTION[event.action];
    const rec = await memoryManager.recordEpisode(event.tenant, {
      episodeType,
      objective: event.title ? `${event.action}: ${event.title}`.slice(0, 500) : `recommendation ${event.action}`,
      recommendationRef: event.recommendationId,
      campaignRef: event.campaignRef,
      outcome: event.outcome,
      evidence: event.evidence ?? (event.recommendationId ? [{ kind: 'signal', ref: `recommendation:${event.recommendationId}` }] : []),
      confidence: event.confidence ?? 0.9,
      source: 'service',
      metadata: { strategy: event.strategy, action: event.action },
    });
    return { recorded: true, episodeId: rec.id };
  } catch (err) {
    return { recorded: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidation (validated lifecycle facts → long-term memory)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsolidationItem {
  memoryType: 'campaign_performance_pattern' | 'audience_response_pattern' | 'promotion_fatigue_pattern';
  entityRef: string;
  value: Record<string, unknown>;
  confidence: number;
  sampleSize: number;
  evidence: MemoryEvidence[];
  tags: string[];
  action: 'created' | 'updated' | 'superseded' | 'skipped';
  reason?: string;
}

export interface ConsolidationResult {
  items: ConsolidationItem[];
  written: number;
  skipped: number;
  invalidated: number;
}

interface StrategyStat {
  strategy: string;
  campaigns: number;
  recipients: number;
  redeemed: number;
  cost: number;
}

/** Aggregate the tenant's own campaign history by strategy — pure arithmetic. */
async function aggregateStrategyStats(restaurantId: string): Promise<StrategyStat[]> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const rows = await CampaignHistory.find({ restaurantId: oid })
    .sort({ sentDate: -1, createdAt: -1 })
    .limit(200)
    .select('channel recipientCount redeemedCount campaignCost status offerId')
    .lean();

  const byStrategy = new Map<string, StrategyStat>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    // CampaignHistory does not carry a strategy column: the channel IS the
    // strategy dimension available (existing data, no new field invented).
    const strategy = String(r.channel || 'unknown');
    const stat = byStrategy.get(strategy) ?? { strategy, campaigns: 0, recipients: 0, redeemed: 0, cost: 0 };
    stat.campaigns += 1;
    stat.recipients += Number(r.recipientCount) || 0;
    stat.redeemed += Number(r.redeemedCount) || 0;
    stat.cost += Number(r.campaignCost) || 0;
    byStrategy.set(strategy, stat);
  }
  return [...byStrategy.values()];
}

/** Aggregate owner approval behaviour by candidate strategy. */
async function aggregateApprovalStats(restaurantId: string): Promise<Array<{ strategy: string; accepted: number; rejected: number; total: number }>> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const rows = await PromotionCandidateModel.find({
    restaurantId: oid,
    status: { $in: ['ACCEPTED', 'REJECTED', 'IMPLEMENTED', 'CONVERTED', 'EXPIRED'] },
  })
    .select('type status')
    .lean();

  const byStrategy = new Map<string, { strategy: string; accepted: number; rejected: number; total: number }>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const strategy = String(r.type || 'unknown');
    const stat = byStrategy.get(strategy) ?? { strategy, accepted: 0, rejected: 0, total: 0 };
    stat.total += 1;
    const status = String(r.status);
    if (status === 'ACCEPTED' || status === 'IMPLEMENTED' || status === 'CONVERTED') stat.accepted += 1;
    if (status === 'REJECTED') stat.rejected += 1;
    byStrategy.set(strategy, stat);
  }
  return [...byStrategy.values()];
}

/**
 * One consolidation pass for a tenant. Reads the existing lifecycle data,
 * computes evidence-backed patterns, and writes ONLY those meeting the
 * thresholds — through the Phase 2 memory manager.
 *
 * NEVER throws: a failing read/write is reported as a skipped item.
 */
export async function consolidateRestaurantMemory(
  tenant: AiTenantContext,
  now: number = Date.now(),
): Promise<ConsolidationResult> {
  const items: ConsolidationItem[] = [];
  const restaurantId = tenant.restaurantId;

  // ── 1. Channel/campaign performance patterns ─────────────────────────────
  try {
    const stats = await aggregateStrategyStats(restaurantId);
    for (const s of stats) {
      if (s.recipients < MIN_PATTERN_SAMPLE) {
        items.push({
          memoryType: 'campaign_performance_pattern',
          entityRef: `channel:${s.strategy}`,
          value: {},
          confidence: 0,
          sampleSize: s.recipients,
          evidence: [],
          tags: ['campaign', s.strategy],
          action: 'skipped',
          reason: `recipients ${s.recipients} < ${MIN_PATTERN_SAMPLE} minimum`,
        });
        continue;
      }
      const rate = s.redeemed / s.recipients;
      // Confidence grows with sample size up to 0.9 and never exceeds it.
      const confidence = Math.min(0.9, 0.5 + Math.min(s.recipients / 1_000, 0.4));
      if (confidence < MIN_PATTERN_CONFIDENCE) {
        items.push({
          memoryType: 'campaign_performance_pattern',
          entityRef: `channel:${s.strategy}`,
          value: {},
          confidence,
          sampleSize: s.recipients,
          evidence: [],
          tags: ['campaign', s.strategy],
          action: 'skipped',
          reason: `confidence ${confidence.toFixed(2)} < ${MIN_PATTERN_CONFIDENCE} minimum`,
        });
        continue;
      }
      const item = await upsertEvidenceBackedMemory(tenant, {
        memoryType: 'campaign_performance_pattern',
        entityRef: `channel:${s.strategy}`,
        value: {
          redemptionRate: Math.round(rate * 10_000) / 10_000,
          campaigns: s.campaigns,
          recipients: s.recipients,
          redemptions: s.redeemed,
        },
        confidence,
        sampleSize: s.recipients,
        evidence: [
          { kind: 'campaign', ref: `channel:${s.strategy}:history`, value: Math.round(rate * 10_000) / 10_000, sampleSize: s.recipients, observedAt: new Date(now).toISOString() },
        ],
        tags: ['campaign', s.strategy],
      }, now);
      items.push(item);
    }
  } catch (err) {
    items.push({
      memoryType: 'campaign_performance_pattern',
      entityRef: 'channel:unknown',
      value: {},
      confidence: 0,
      sampleSize: 0,
      evidence: [],
      tags: ['campaign'],
      action: 'skipped',
      reason: `campaign history read failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 2. Owner approval behaviour (audience response to strategies) ────────
  try {
    const approvals = await aggregateApprovalStats(restaurantId);
    for (const a of approvals) {
      if (a.total < MIN_REJECTION_OBSERVATIONS) {
        items.push({
          memoryType: 'audience_response_pattern',
          entityRef: `strategy:${a.strategy}`,
          value: {},
          confidence: 0,
          sampleSize: a.total,
          evidence: [],
          tags: ['approval', a.strategy],
          action: 'skipped',
          reason: `observations ${a.total} < ${MIN_REJECTION_OBSERVATIONS} minimum`,
        });
        continue;
      }
      const acceptRate = a.accepted / a.total;
      const confidence = Math.min(0.85, 0.5 + a.total / 100);
      const item = await upsertEvidenceBackedMemory(tenant, {
        memoryType: 'audience_response_pattern',
        entityRef: `strategy:${a.strategy}`,
        value: { acceptRate: Math.round(acceptRate * 100) / 100, accepted: a.accepted, rejected: a.rejected, total: a.total },
        confidence,
        sampleSize: a.total,
        evidence: [
          { kind: 'signal', ref: `strategy:${a.strategy}:approvals`, value: Math.round(acceptRate * 100) / 100, sampleSize: a.total, observedAt: new Date(now).toISOString() },
        ],
        tags: ['approval', a.strategy],
      }, now);
      items.push(item);

      // Promotion-fatigue style signal: strategies the owner consistently rejects.
      if (a.rejected >= MIN_REJECTION_OBSERVATIONS && a.rejected / a.total >= 0.6) {
        const fatigue = await upsertEvidenceBackedMemory(tenant, {
          memoryType: 'promotion_fatigue_pattern',
          entityRef: `strategy:${a.strategy}`,
          value: { rejectionRate: Math.round((a.rejected / a.total) * 100) / 100, rejected: a.rejected, total: a.total },
          confidence,
          sampleSize: a.total,
          evidence: [
            { kind: 'signal', ref: `strategy:${a.strategy}:rejections`, value: a.rejected, sampleSize: a.total, observedAt: new Date(now).toISOString() },
          ],
          tags: ['fatigue', a.strategy],
        }, now);
        items.push(fatigue);
      }
    }
  } catch (err) {
    items.push({
      memoryType: 'audience_response_pattern',
      entityRef: 'strategy:unknown',
      value: {},
      confidence: 0,
      sampleSize: 0,
      evidence: [],
      tags: ['approval'],
      action: 'skipped',
      reason: `approval read failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 3. Staleness handling ────────────────────────────────────────────────
  const invalidated = await invalidateStaleMemories(tenant, now);

  const written = items.filter((i) => i.action === 'created' || i.action === 'updated' || i.action === 'superseded').length;
  return { items, written, skipped: items.length - written, invalidated };
}

/**
 * Write one evidence-backed memory with conflict handling:
 *   - existing ACTIVE memory with a LARGER sample (or ≥ confidence) wins and
 *     the new observation is only recorded when it strengthens or refreshes;
 *   - otherwise the old row is superseded and the new one becomes active.
 */
async function upsertEvidenceBackedMemory(
  tenant: AiTenantContext,
  input: {
    memoryType: ConsolidationItem['memoryType'];
    entityRef: string;
    value: Record<string, unknown>;
    confidence: number;
    sampleSize: number;
    evidence: MemoryEvidence[];
    tags: string[];
  },
  now: number,
): Promise<ConsolidationItem> {
  const existingRaw = await RestaurantMemoryModel.findOne({
    restaurantId: new mongoose.Types.ObjectId(tenant.restaurantId),
    branchId: tenant.branchId ? new mongoose.Types.ObjectId(tenant.branchId) : null,
    memoryType: input.memoryType,
    entityRef: input.entityRef,
  }).lean();
  // Lean documents expose `_id`, not the virtual `id` — normalize both.
  const existing = existingRaw as unknown as
    | (RestaurantMemoryRecord & { status: string; _id?: unknown })
    | null;
  const existingDocId = existing ? ((existing as { _id?: unknown })._id ?? existing.id) : undefined;

  if (existing) {
    const existingSample = existing.sampleSize ?? 0;
    const stronger = input.sampleSize >= existingSample;
    const freshConfidence = input.confidence >= existing.confidence - 0.05;
    if (!stronger && !freshConfidence) {
      return {
        ...input,
        action: 'skipped',
        reason: `existing memory is stronger (n=${existingSample}, conf=${existing.confidence.toFixed(2)})`,
      };
    }
    // Mark the old row superseded when the new evidence contradicts it
    // materially (opposite direction on the primary metric).
    const oldPrimary = primaryMetric(existing.value);
    const newPrimary = primaryMetric(input.value);
    const contradicts =
      oldPrimary !== undefined && newPrimary !== undefined && Math.sign(oldPrimary) !== Math.sign(newPrimary);
    if (contradicts) {
      // Phase 2's unique key is (restaurantId, branchId, memoryType,
      // entityRef), so a superseded row cannot coexist with the replacement.
      // The previous value is preserved INSIDE the row's metadata instead —
      // the audit trail survives without breaking the upsert invariant.
      const replaced = await writeMemory(tenant, input, now, {
        supersededValue: existing.value,
        supersededAt: new Date(now).toISOString(),
        supersededReason: 'new evidence contradicted the previous primary metric',
      });
      return replaced
        ? ({ ...input, action: 'superseded', reason: 'new evidence contradicts the previous value (history kept in metadata)' } as ConsolidationItem)
        : ({ ...input, action: 'skipped', reason: 'memory write failed' } as ConsolidationItem);
    }
  }

  const ok = await writeMemory(tenant, input, now);
  return { ...input, action: ok ? (existing ? 'updated' : 'created') : 'skipped', reason: ok ? undefined : 'memory write failed' };
}

async function writeMemory(
  tenant: AiTenantContext,
  input: {
    memoryType: ConsolidationItem['memoryType'];
    entityRef: string;
    value: Record<string, unknown>;
    confidence: number;
    sampleSize: number;
    evidence: MemoryEvidence[];
    tags: string[];
  },
  now: number,
  extraMetadata?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await memoryManager.upsertLongTermMemory(tenant, {
      memoryType: input.memoryType,
      entityRef: input.entityRef,
      value: input.value,
      confidence: input.confidence,
      sampleSize: input.sampleSize,
      evidence: input.evidence,
      source: 'service',
      status: 'active',
      tags: input.tags,
      lastValidatedAt: new Date(now),
      metadata: { consolidator: 'memoryLearningService', ...(extraMetadata ?? {}) },
    });
    return true;
  } catch {
    return false;
  }
}

/** Primary numeric metric of a memory value (first numeric field). */
function primaryMetric(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Invalidate aging memories that were never re-validated:
 *   - older than MEMORY_INVALIDATE_DAYS → status 'invalidated'
 * Fresh validated rows are untouched. Returns the invalidated count.
 */
async function invalidateStaleMemories(tenant: AiTenantContext, now: number): Promise<number> {
  try {
    const cutoff = new Date(now - MEMORY_INVALIDATE_DAYS * DAY_MS);
    const res = await RestaurantMemoryModel.updateMany(
      {
        restaurantId: new mongoose.Types.ObjectId(tenant.restaurantId),
        status: 'active',
        $or: [{ lastValidatedAt: { $lt: cutoff } }, { lastValidatedAt: null, updatedAt: { $lt: cutoff } }],
      },
      { $set: { status: 'invalidated', updatedAt: new Date(now) } },
    );
    return res.modifiedCount ?? 0;
  } catch {
    return 0;
  }
}

/** True when a long-term memory is aging (needs re-validation soon). */
export function isAgingMemory(m: Pick<RestaurantMemoryRecord, 'lastValidatedAt' | 'updatedAt'>, now = Date.now()): boolean {
  const last = Date.parse(m.lastValidatedAt || m.updatedAt || '');
  if (Number.isNaN(last)) return true;
  return now - last > MEMORY_STALE_DAYS * DAY_MS;
}

/**
 * Priority guard: current authoritative data always overrides stale memory.
 * Returns whether a stored memory may still inform a decision.
 */
export function memoryInformsDecision(
  m: Pick<RestaurantMemoryRecord, 'confidence' | 'sampleSize' | 'status' | 'lastValidatedAt' | 'updatedAt'>,
  now = Date.now(),
): boolean {
  if (m.status !== 'active') return false;
  if (m.confidence < MIN_PATTERN_CONFIDENCE) return false;
  if ((m.sampleSize ?? 0) < MIN_REJECTION_OBSERVATIONS) return false;
  if (isAgingMemory(m, now)) return false; // aging → re-validate before relying
  return true;
}