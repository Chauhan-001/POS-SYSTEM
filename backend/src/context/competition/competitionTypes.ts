/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionTypes.ts — canonical internal competition model (Phase 1).
 * Google Places' raw response shape must never spread beyond
 * competitionProvider → competitionNormalizer.
 *
 * Google data policy (spec §14): placeId is a stable identifier we may keep;
 * other provider content is transient (fetched/cached with a freshness window)
 * and is NEVER persisted as a permanent ChitKuber-owned Places database.
 */

export interface NearbyCompetitor {
  /** Google Place ID — stable identifier (spec §13). */
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  primaryType?: string;
  types?: string[];
  /** Google Maps deep link (attribution-friendly, spec §19). */
  googleMapsUri?: string;
  /** ChitKuber-derived signal (deterministic haversine) — not provider data. */
  distanceMeters?: number;
  source: 'google_places';
  fetchedAt: string;
}/**
 * Transient cache envelope — in-memory only (never a Mongo Places table).
 * `locationKey` pins the cache to the coordinates it was fetched for: a
 * restaurant location change produces a different key → old context is
 * invalidated by construction (spec §12), never shown as current.
 */
export interface CompetitionContextCache {
  restaurantId: string;
  lastFetchedAt: string;
  provider: 'google_places';
  searchRadiusMeters: number;
  resultCount: number;
  /** 'lat,lng' (6dp) of the search center — location-change guard. */
  locationKey: string;
  competitors: NearbyCompetitor[];
}

// ─── Phase 2: deterministic competition intelligence (spec §2–§10) ────

/** Distance buckets — the top bucket is the CONFIGURED radius, not 2km hardcoded. */
export interface DistanceBuckets {
  within500m: number;
  within1km: number;
  within2km: number;
  /** At/inside the configured search radius (equals total when radius ≤ 2km). */
  withinSearchRadius: number;
}

/**
 * Density = competitorCount / (π × radiusKm²). Calculation documented in
 * competitionIntelligence.ts; thresholds explicit + env-configurable.
 */
export type CompetitionDensity = 'low' | 'medium' | 'high';

export interface CategoryCount {
  type: string;
  count: number;
}

/**
 * Cuisine overlap uses ONLY the owner-declared cuisineType matched against
 * Google's own primaryType taxonomy (spec §8 — no name inference, no LLM).
 * Unknown restaurant cuisine → overlap stays 'unknown' (never guessed).
 */
export interface CuisineOverlap {
  status: 'match' | 'unknown';
  /** Owner-declared cuisineType (normalized), when known. */
  restaurantCuisine?: string;
  /** Matched Google primaryType, when a mapping exists. */
  matchedType?: string;
  overlappingCompetitors: number;
  /** Share of competitors in the overlapping category (0–1). */
  overlapShare?: number;
}

export interface CompetitionSummary {
  totalCompetitors: number;
  within500m: number;
  within1km: number;
  within2km: number;
  withinSearchRadius: number;
  averageDistanceMeters?: number;
  nearestDistanceMeters?: number;
  /** competitors / π·r² (km²) — see competitionIntelligence.ts. */
  densityPerKm2?: number;
  density: CompetitionDensity | 'unknown';
  primaryTypeDistribution: CategoryCount[];
  cuisineOverlap: CuisineOverlap;
}

/**
 * Canonical competition signal — mirrors the cricket/festival signal family
 * (source + signalType + relevance + value + evidence + generatedAt), plus
 * Phase 3 freshness metadata (spec §4) so downstream consumers can always
 * tell how current the underlying data is. Evidence-only: distance never
 * implies quality, popularity, or switching.
 */
export interface SignalFreshness {
  /** 'fresh' (from a current provider/cache payload) or 'stale' (fallback). */
  status: 'fresh' | 'stale';
  /** When the underlying provider data was fetched. */
  fetchedAt: string;
  /** Seconds between fetchedAt and signal generation. */
  ageSeconds: number;
}

export interface CompetitionSignal {
  source: 'competition';
  signalType:
    | 'COMPETITION_DENSITY_LOW'
    | 'COMPETITION_DENSITY_MEDIUM'
    | 'COMPETITION_DENSITY_HIGH'
    | 'NEAREST_COMPETITOR'
    | 'NEAREST_COMPETITOR_CLOSE'
    | 'HIGH_CUISINE_OVERLAP'
    | 'LOW_CUISINE_OVERLAP'
    | 'CLOSE_CATEGORY_COMPETITION'
    | 'LOCAL_COMPETITION_CONCENTRATION'
    | 'COMPETITION_COUNT_CHANGED';
  relevance: 'high' | 'medium' | 'low';
  value?: unknown;
  evidence: string[];
  freshness: SignalFreshness;
  generatedAt: string;
}

export interface NearbyCompetitionOutput {
  available: boolean;
  reason?:
    | 'ok'
    | 'disabled'
    | 'no_api_key'
    | 'location_unavailable'
    | 'provider_unavailable'
    | 'provider_error'
    | 'no_competitors';
  restaurantId?: string;
  searchRadiusMeters: number;
  lastRefreshedAt?: string;
  cacheHit?: boolean;
  competitors: NearbyCompetitor[];
  /** Honest evidence statement for the agent — never a performance claim. */
  summary?: string;
  /**
   * 'fresh' | 'stale' (served after provider failure) | 'unavailable'
   * (no coordinates / disabled / no key). Stale is never silent (spec §13).
   */
  dataStatus?: 'fresh' | 'stale' | 'unavailable';
  providerAvailable?: boolean;
  /** Phase 2 deterministic intelligence (spec §3–§10). */
  intelligence?: {
    summary: CompetitionSummary;
    signals: CompetitionSignal[];
  };
  generatedAt: string;
}
