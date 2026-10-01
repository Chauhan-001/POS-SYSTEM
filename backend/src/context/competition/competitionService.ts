/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionService.ts — the Competition Context pipeline (Phase 2, spec §31):
 *
 *   Restaurant (authoritative coordinates) → Google Places provider →
 *   normalizer (haversine, dedup, self-exclusion) → intelligence
 *   (summary + signals) → per-restaurant cache → canonical output.
 *
 * Availability is ALWAYS explicit: missing coordinates, disabled config and
 * provider failure are distinct states (spec §26), and stale fallback is
 * labeled 'stale' — never presented as fresh (spec §13). Tenant identity
 * comes only from callers holding the authenticated restaurantId; coordinates
 * come only from the authoritative Restaurant record (spec §27).
 *
 * Determinism (spec §25): no LLM anywhere in this pipeline.
 */

import { config } from '../../config';
import {
  findNearbyRestaurants,
  getCompetitionProviderConfig,
  CompetitionProviderError,
} from './competitionProvider';
import { normalizeCompetitors, parseCoordinates, locationKeyOf } from './competitionNormalizer';
import { readCompetitionCache, writeCompetitionCache } from './competitionCache';
import { buildSummary, buildSignals } from './competitionIntelligence';
import type { CompetitionContextCache, NearbyCompetitionOutput } from './competitionTypes';

export type RefreshMode = 'auto' | 'force';

function unavailable(
  reason: NonNullable<NearbyCompetitionOutput['reason']>,
  generatedAt: string,
): NearbyCompetitionOutput {
  return {
    available: false,
    reason,
    dataStatus: 'unavailable',
    providerAvailable: reason === 'provider_unavailable' || reason === 'provider_error' ? false : undefined,
    searchRadiusMeters: config.competition.searchRadiusMeters,
    competitors: [],
    generatedAt,
  };
}

/**
 * Canonical service entry: getNearbyCompetition().
 * `now` injectable for tests. `force` bypasses a fresh cache (admin refresh,
 * spec §14) but still respects provider limits via the normal single fetch.
 */
export async function getNearbyCompetition(
  options: { restaurantId: string; refresh?: RefreshMode; now?: Date } ,
): Promise<NearbyCompetitionOutput> {
  const generatedAt = new Date().toISOString();
  const refresh = options.refresh ?? 'auto';

  // 1. Configuration gates — honest unavailability (spec §26).
  if (!config.competition.enabled) return unavailable('disabled', generatedAt);
  const cfg = getCompetitionProviderConfig();
  if (!cfg) return unavailable('no_api_key', generatedAt);
  if (!options.restaurantId) return unavailable('location_unavailable', generatedAt);

  // 2. Authoritative coordinates from the Restaurant record only (spec §27).
  const { default: Restaurant } = await import('../../models/core/Restaurant');
  const doc = await Restaurant.findOne({ restaurantId: options.restaurantId })
    .select('latitude longitude cuisineType name')
    .lean()
    .exec();
  if (!doc) return unavailable('location_unavailable', generatedAt);
  const center = parseCoordinates(doc.latitude, doc.longitude);
  if (!center) return unavailable('location_unavailable', generatedAt);

  const locationKey = locationKeyOf(center.latitude, center.longitude);
  const radius = config.competition.searchRadiusMeters;

  const finalize = (
    competitors: ReturnType<typeof normalizeCompetitors>,
    fetchedAt: string,
    dataStatus: 'fresh' | 'stale',
    cacheHit: boolean,
    providerAvailable: boolean,
    previous: { competitorCount: number; fetchedAt: string } | null = null,
  ): NearbyCompetitionOutput => {
    const summary = buildSummary(competitors, radius, doc.cuisineType);
    const freshness = {
      status: dataStatus,
      fetchedAt,
      ageSeconds: Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(fetchedAt)) / 1000)),
    };
    return {
      available: true,
      reason: competitors.length === 0 ? 'no_competitors' : 'ok',
      restaurantId: options.restaurantId,
      searchRadiusMeters: radius,
      lastRefreshedAt: fetchedAt,
      cacheHit,
      competitors,
      summary:
        competitors.length === 0
          ? 'No nearby restaurants were identified by Google Places within the configured radius.'
          : `${competitors.length} nearby restaurants identified within ${Math.round((radius / 1000) * 10) / 10} km; nearest approximately ${summary.nearestDistanceMeters ?? 'unknown'}m away. Proximity only — no claim about competitor performance.`,
      dataStatus,
      providerAvailable,
      intelligence: { summary, signals: buildSignals(summary, radius, { freshness, previous }) },
      generatedAt,
    };
  };

  // 3. Cache-first (spec §13/§14) — location-keyed, so a moved restaurant
  // never reads its old neighborhood (spec §12). Enrichment is per-request.
  if (refresh !== 'force') {
    const cached = await readCompetitionCache(options.restaurantId, locationKey);
    if (cached) {
      return finalize(cached.competitors, cached.lastFetchedAt, 'fresh', true, true);
    }
  }

  // 4. Refresh: fetch → normalize → analyze → cache. Failure falls back to a
  // location-matched lastGood, marked STALE — never silently fresh (§13).
  try {
    const res = await findNearbyRestaurants(cfg, {
      latitude: center.latitude,
      longitude: center.longitude,
      radiusMeters: radius,
      maxResults: config.competition.maxResults,
    });
    const fetchedAt = new Date().toISOString();
    const competitors = normalizeCompetitors(res.places, center, fetchedAt, {
      restaurantName: doc.name,
    });
    const payload: CompetitionContextCache = {
      restaurantId: options.restaurantId,
      lastFetchedAt: fetchedAt,
      provider: 'google_places',
      searchRadiusMeters: radius,
      resultCount: competitors.length,
      locationKey,
      competitors,
    };
    await writeCompetitionCache(payload);
    lastGood.set(options.restaurantId, payload);

    // Phase 3: snapshot history — read the PREVIOUS persisted count before
    // writing the new one (via the canonical IntelligenceSignal store; no new
    // model). Compare only same-location snapshots (spec §23: derived context
    // changes, never competitor performance).
    let previous: { competitorCount: number; fetchedAt: string } | null = null;
    try {
      const { getLatestCompetitionSnapshot } = await import('./competitionSignalStore');
      previous = await getLatestCompetitionSnapshot(options.restaurantId, locationKey);
    } catch {
      // History is additive — a DB hiccup must not break the context pipeline.
    }
    const output = finalize(competitors, fetchedAt, 'fresh', false, true, previous);

    // Persist the current snapshot + evidence-based signals into the canonical
    // IntelligenceSignal store (Phase 3 §2), tagged for opportunity detection.
    try {
      const { persistCompetitionSignals } = await import('./competitionSignalStore');
      await persistCompetitionSignals(options.restaurantId, output.intelligence!, fetchedAt, locationKey);
    } catch (err) {
      console.warn(`[competition] signal persistence skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    return output;
  } catch (err) {
    const kind = err instanceof CompetitionProviderError ? err.kind : 'http_error';
    console.warn(
      `[competition] refresh failed kind=${kind}${err instanceof CompetitionProviderError && err.httpStatus ? ` httpStatus=${err.httpStatus}` : ''} — ${lastGood.has(options.restaurantId) ? 'serving stale in-memory fallback' : 'no cached fallback'}`,
    );
    const stale = lastGood.get(options.restaurantId);
    if (stale && stale.locationKey === locationKey) {
      return finalize(stale.competitors, stale.lastFetchedAt, 'stale', true, false);
    }
    return unavailable(kind === 'quota' ? 'provider_error' : 'provider_unavailable', generatedAt);
  }
}

/** Per-process last-good payloads for stale fallback (mirrors cricketService). */
const lastGood = new Map<string, CompetitionContextCache>();

/** Explicit admin-triggered refresh (spec §14) — same pipeline, force mode. */
export async function refreshNearbyCompetition(restaurantId: string): Promise<NearbyCompetitionOutput> {
  return getNearbyCompetition({ restaurantId, refresh: 'force' });
}

export const competitionService = {
  getNearbyCompetition,
  refreshNearbyCompetition,
};
