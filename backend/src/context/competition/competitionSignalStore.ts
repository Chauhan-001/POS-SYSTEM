/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionSignalStore.ts — Competition Phase 3 (spec §2/§23): bridges the
 * deterministic competition signals into the EXISTING canonical signal
 * architecture — models/intelligence/IntelligenceSignal — the same store used
 * by sales, inventory, margin, basket, combo, menu and customer signal
 * services. No separate competition-only signal framework is created.
 *
 * SignalType extension: COMPETITION_DENSITY_HIGH/MEDIUM/LOW,
 * NEAREST_COMPETITOR_CLOSE, HIGH_CUISINE_OVERLAP and
 * CLOSE_CATEGORY_COMPETITION are added to the canonical SignalType union.
 * Stale-fallback signals are NOT persisted (they would age the canonical
 * store with data the provider may have replaced); freshness metadata is
 * carried on the transient signal objects instead (spec §4).
 *
 * The same collection doubles as the snapshot history (spec §23): each
 * refresh stores its competitor count with the locationKey in tags, so
 * count changes are computed against same-location history only.
 *
 * OVERCLAIM GUARD (spec §11): persisted evidence describes proximity and
 * derived counts only — never competitor quality, popularity, switching or
 * revenue impact.
 */

import mongoose from 'mongoose';
import IntelligenceSignalModel, { type SignalType } from '../../models/intelligence/IntelligenceSignal';
import { config } from '../../config';
import type { CompetitionSignal } from './competitionTypes';

/** Canonical SignalType members contributed by the Competition module. */
export const COMPETITION_SIGNAL_TYPES = [
  'COMPETITION_DENSITY_HIGH',
  'COMPETITION_DENSITY_MEDIUM',
  'COMPETITION_DENSITY_LOW',
  'NEAREST_COMPETITOR_CLOSE',
  'HIGH_CUISINE_OVERLAP',
  'CLOSE_CATEGORY_COMPETITION',
] as const satisfies readonly SignalType[];

/** Signals worth persisting for opportunity detection (highest-evidence only). */
const PERSISTED_SIGNAL_TYPES = new Set<string>(COMPETITION_SIGNAL_TYPES);

/** Canonical store tag marking competition snapshot history rows. */
const SNAPSHOT_TAG = 'competition_snapshot';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Latest persisted snapshot for this restaurant at this location (same
 * locationKey tag → a moved restaurant never compares against its old
 * neighborhood, spec §12/§23).
 */
export async function getLatestCompetitionSnapshot(
  restaurantId: string,
  locationKey: string,
): Promise<{ competitorCount: number; fetchedAt: string } | null> {
  const doc = await IntelligenceSignalModel.findOne({
    restaurantId: objectId(restaurantId),
    tags: { $all: [SNAPSHOT_TAG, `location:${locationKey}`] },
  })
    .sort({ detectedAt: -1 })
    .lean()
    .exec();
  if (!doc) return null;
  const count = doc.value;
  return Number.isFinite(count)
    ? { competitorCount: count, fetchedAt: new Date(doc.detectedAt).toISOString() }
    : null;
}

/**
 * Persist the current refresh's snapshot row + the persisted-worthy signals.
 * Snapshot row: one per refresh (value = competitor count), tagged with the
 * locationKey. Signals: inserts only — consumers own expiry/dedup semantics.
 */
export async function persistCompetitionSignals(
  restaurantId: string,
  intelligence: { summary: { totalCompetitors: number }; signals: CompetitionSignal[] },
  fetchedAt: string,
  locationKey: string,
): Promise<void> {
  const rid = objectId(restaurantId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.competition.refreshDays * 86_400_000);
  const locationTag = `location:${locationKey}`;

  const docs: Array<Record<string, unknown>> = [
    // Snapshot history row (spec §23) — ChitKuber's derived context only.
    {
      restaurantId: rid,
      type: 'COMPETITION_DENSITY_HIGH', // sentinel type carrying the count; excluded from signal consumers by tags
      entityType: 'restaurant',
      value: intelligence.summary.totalCompetitors,
      confidence: 1,
      minSampleSize: 1,
      sampleSize: 1,
      evidence: [
        {
          description: `Snapshot: ${intelligence.summary.totalCompetitors} identified restaurants within the configured radius (Google Places refresh).`,
          value: intelligence.summary.totalCompetitors,
        },
      ],
      detectedAt: now,
      expiresAt: new Date(now.getTime() + 365 * 86_400_000), // history outlives signal TTL
      consumed: false,
      tags: [SNAPSHOT_TAG, locationTag, `fetched:${fetchedAt}`],
    },
  ];

  for (const signal of intelligence.signals) {
    if (!PERSISTED_SIGNAL_TYPES.has(signal.signalType)) continue;
    docs.push({
      restaurantId: rid,
      type: signal.signalType as SignalType,
      entityType: 'restaurant',
      value: typeof signal.value === 'object' && signal.value !== null && 'competitorCount' in (signal.value as Record<string, unknown>)
        ? Number((signal.value as Record<string, unknown>).competitorCount)
        : Number(signal.value) || 0,
      confidence: 0.9,
      minSampleSize: 1,
      sampleSize: 1,
      evidence: signal.evidence.map((description) => ({ description, value: Number(signal.value) || 0 })),
      detectedAt: now,
      expiresAt,
      consumed: false,
      tags: ['competition_signal', signal.signalType.toLowerCase(), locationTag, `freshness:${signal.freshness.status}`],
    });
  }

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}
