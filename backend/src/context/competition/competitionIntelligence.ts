/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionIntelligence.ts — Competition Phase 2: the deterministic
 * intelligence layer (spec §3–§11, §25).
 *
 *   Competitors → distance buckets → density (documented formula, env
 *   thresholds) → category distribution → cuisine overlap (owner-declared
 *   cuisineType × Google primaryType) → evidence-based signals.
 *
 * OVERCLAIM GUARD (spec §11): distance establishes PROXIMITY ONLY. No
 * evidence statement here may imply quality, popularity, customer switching,
 * or revenue impact. No LLM is involved anywhere (spec §25).
 */

import { config } from '../../config';
import type {
  CategoryCount,
  CompetitionDensity,
  CompetitionSignal,
  CompetitionSummary,
  CuisineOverlap,
  NearbyCompetitor,
  SignalFreshness,
} from './competitionTypes';

// ─── Distance buckets (spec §4) ──────────────────────────────────

export interface DistanceBuckets {
  within500m: number;
  within1km: number;
  within2km: number;
  withinSearchRadius: number;
}

export function classifyDistanceBuckets(
  competitors: NearbyCompetitor[],
  searchRadiusMeters: number,
): DistanceBuckets {
  const inBucket = (limit: number) =>
    competitors.filter((c) => c.distanceMeters !== undefined && c.distanceMeters <= limit).length;
  return {
    within500m: inBucket(500),
    within1km: inBucket(1_000),
    within2km: inBucket(2_000),
    withinSearchRadius: inBucket(searchRadiusMeters),
  };
}

// ─── Density (spec §5) — documented formula, explicit thresholds ──

/**
 * Density = competitorCount / area, where area = π × radiusKm² (circular
 * search area). Example: 14 competitors in a 2km radius →
 * 14 / (π × 2²) ≈ 1.11 competitors/km².
 *
 * Classification is env-configurable (no unexplained magic numbers):
 *   COMPETITION_DENSITY_LOW_THRESHOLD  (default 5 /km²)
 *   COMPETITION_DENSITY_HIGH_THRESHOLD (default 15 /km²)
 */
export function computeDensity(
  competitorCount: number,
  radiusMeters: number,
): { densityPerKm2: number; density: CompetitionDensity } {
  const radiusKm = radiusMeters / 1000;
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  const densityPerKm2 = areaKm2 > 0 ? competitorCount / areaKm2 : 0;
  const density: CompetitionDensity =
    densityPerKm2 >= config.competition.densityHighThreshold
      ? 'high'
      : densityPerKm2 < config.competition.densityLowThreshold
        ? 'low'
        : 'medium';
  return { densityPerKm2, density };
}

// ─── Category distribution (spec §9) ─────────────────────────────

/** Counts by Google primaryType (provider taxonomy stays provider-shaped here). */
export function categoryDistribution(competitors: NearbyCompetitor[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const c of competitors) {
    const type = c.primaryType?.trim();
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// ─── Cuisine overlap (spec §8) — deterministic mapping only ──────

/**
 * Owner-declared cuisineType → Google primaryType. Deliberately conservative:
 * an unmapped/missing cuisine yields status 'unknown' rather than a guess.
 * Extending this table is a data change, not a logic change.
 */
const CUISINE_TO_PLACE_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  indian: new Set(['indian_restaurant', 'north_indian_restaurant', 'south_indian_restaurant']),
  chinese: new Set(['chinese_restaurant']),
  italian: new Set(['italian_restaurant', 'pizza_restaurant']),
  mexican: new Set(['mexican_restaurant']),
  thai: new Set(['thai_restaurant']),
  japanese: new Set(['japanese_restaurant', 'sushi_restaurant']),
  american: new Set(['american_restaurant', 'hamburger_restaurant']),
  continental: new Set(['european_restaurant', 'french_restaurant']),
  mughlai: new Set(['indian_restaurant', 'north_indian_restaurant']),
  seafood: new Set(['seafood_restaurant']),
};

export function cuisineOverlapOf(
  restaurantCuisine: string | null | undefined,
  competitors: NearbyCompetitor[],
): CuisineOverlap {
  const declared = (restaurantCuisine ?? '').trim().toLowerCase();
  const matchedTypes = CUISINE_TO_PLACE_TYPES[declared];
  if (!declared || !matchedTypes) {
    return { status: 'unknown', overlappingCompetitors: 0 };
  }
  const overlapping = competitors.filter((c) => c.primaryType && matchedTypes.has(c.primaryType)).length;
  return {
    status: 'match',
    restaurantCuisine: declared,
    matchedType: [...matchedTypes][0],
    overlappingCompetitors: overlapping,
    overlapShare: competitors.length > 0 ? overlapping / competitors.length : 0,
  };
}

// ─── Summary (spec §3) ───────────────────────────────────────────

export function buildSummary(
  competitors: NearbyCompetitor[],
  searchRadiusMeters: number,
  restaurantCuisine?: string | null,
): CompetitionSummary {
  const buckets = classifyDistanceBuckets(competitors, searchRadiusMeters);
  const distances = competitors
    .map((c) => c.distanceMeters)
    .filter((d): d is number => typeof d === 'number');
  const { densityPerKm2, density } = computeDensity(competitors.length, searchRadiusMeters);

  return {
    totalCompetitors: competitors.length,
    within500m: buckets.within500m,
    within1km: buckets.within1km,
    within2km: buckets.within2km,
    withinSearchRadius: buckets.withinSearchRadius,
    averageDistanceMeters:
      distances.length > 0
        ? Math.round(distances.reduce((s, d) => s + d, 0) / distances.length)
        : undefined,
    nearestDistanceMeters: distances.length > 0 ? Math.min(...distances) : undefined,
    densityPerKm2,
    density,
    primaryTypeDistribution: categoryDistribution(competitors),
    cuisineOverlap: cuisineOverlapOf(restaurantCuisine, competitors),
  };
}

// ─── Signals (spec §6/§7/§10/§16, Phase 3 §3/§4) — evidence-based ──

export interface BuildSignalsOptions {
  /** Freshness of the underlying payload, threaded onto every signal (Phase 3 §4). */
  freshness: SignalFreshness;
  /** Previous refresh snapshot for COMPETITION_COUNT_CHANGED (Phase 3 §3). */
  previous?: { competitorCount: number; fetchedAt: string } | null;
  /**
   * Configured radius for LOCAL_COMPETITION_CONCENTRATION (km). Defaults to the
   * search radius; Phase 2 thresholds apply (explicit, env-configurable).
   */
  concentrationRadiusKm?: number;
}

export function buildSignals(
  summary: CompetitionSummary,
  searchRadiusMeters: number,
  options: BuildSignalsOptions,
): CompetitionSignal[] {
  const generatedAt = new Date().toISOString();
  const signals: CompetitionSignal[] = [];
  const push = (
    signalType: CompetitionSignal['signalType'],
    relevance: CompetitionSignal['relevance'],
    value: unknown,
    evidence: string[],
  ) => signals.push({ source: 'competition', signalType, relevance, value, evidence, freshness: options.freshness, generatedAt });

  const total = summary.totalCompetitors;
  const radiusKm = Math.round((searchRadiusMeters / 1000) * 10) / 10;

  // Density signals (§7) — always include count + radius + formula evidence.
  if (summary.density !== 'unknown') {
    const type = (
      { low: 'COMPETITION_DENSITY_LOW', medium: 'COMPETITION_DENSITY_MEDIUM', high: 'COMPETITION_DENSITY_HIGH' } as const
    )[summary.density];
    push(
      type,
      summary.density === 'high' ? 'high' : summary.density === 'medium' ? 'medium' : 'low',
      { competitorCount: total, radiusMeters: searchRadiusMeters, densityPerKm2: summary.densityPerKm2 },
      [
        `${total} identified restaurants within the configured ${radiusKm} km radius.`,
        `Density = ${total} / (π × ${radiusKm}²) ≈ ${summary.densityPerKm2?.toFixed(2)} per km² (${summary.density}).`,
      ],
    );
  }

  // Nearest competitor (§6) — proximity statement only.
  if (summary.nearestDistanceMeters !== undefined) {
    const nearest = summary.nearestDistanceMeters;
    const isClose = nearest <= config.competition.closeProximityMeters;
    push(
      isClose ? 'NEAREST_COMPETITOR_CLOSE' : 'NEAREST_COMPETITOR',
      isClose ? 'high' : 'medium',
      { distanceMeters: nearest },
      [`Nearest identified restaurant is approximately ${nearest}m away.`],
    );
  }

  // Cuisine overlap (§8) — only when the owner declared a mappable cuisine.
  if (summary.cuisineOverlap.status === 'match') {
    const overlap = summary.cuisineOverlap.overlappingCompetitors;
    if (overlap > 0) {
      const share = summary.cuisineOverlap.overlapShare ?? 0;
      const high = share >= 0.4;
      push(
        high ? 'HIGH_CUISINE_OVERLAP' : 'LOW_CUISINE_OVERLAP',
        high ? 'medium' : 'low',
        { overlappingCompetitors: overlap, overlapShare: share, cuisine: summary.cuisineOverlap.restaurantCuisine },
        [
          `${overlap} of ${total} nearby restaurants are classified by Google as ${summary.cuisineOverlap.matchedType} (matches the declared ${summary.cuisineOverlap.restaurantCuisine} cuisine).`,
        ],
      );
    }
  }

  // Close category competition (§10) — distance × category, context only.
  const closeAndOverlapping =
    summary.cuisineOverlap.status === 'match' ? summary.cuisineOverlap.overlappingCompetitors : 0;
  if (closeAndOverlapping > 0 && summary.within500m > 0) {
    push(
      'CLOSE_CATEGORY_COMPETITION',
      'high',
      { overlappingCompetitors: closeAndOverlapping, within500m: summary.within500m },
      [
        `${closeAndOverlapping} restaurants matching the declared cuisine category are within the configured ${radiusKm} km radius, and ${summary.within500m} restaurants of any category are within 500m.`,
      ],
    );
  }

  // LOCAL_COMPETITION_CONCENTRATION (Phase 3 §3): share of identified
  // competitors within 500m — a documented, deterministic spatial-spread
  // measure (nothing about behavior). Thresholds explicit + configurable:
  //   COMPETITION_CONCENTRATION_LOW_THRESHOLD  (share below → 'low')
  //   COMPETITION_CONCENTRATION_HIGH_THRESHOLD (share at/above → 'high')
  if (total > 0) {
    const concentrationRadiusKm = options.concentrationRadiusKm ?? radiusKm;
    const concentrationShare = summary.within500m / total;
    const shareHigh = config.competition.concentrationHighThreshold;
    const shareLow = config.competition.concentrationLowThreshold;
    const concentration =
      concentrationShare >= shareHigh ? 'high' : concentrationShare < shareLow ? 'low' : 'medium';
    push(
      'LOCAL_COMPETITION_CONCENTRATION',
      concentration === 'high' ? 'high' : concentration === 'medium' ? 'medium' : 'low',
      { within500m: summary.within500m, totalCompetitors: total, share: concentrationShare, concentrationRadiusKm },
      [
        `${summary.within500m} of ${total} identified restaurants (${Math.round(concentrationShare * 100)}%) are within 500m of the restaurant.`,
        `Concentration is '${concentration}' (thresholds: low < ${shareLow.toFixed(2)}, high ≥ ${shareHigh.toFixed(2)} share).`,
      ],
    );
  }

  // COMPETITION_COUNT_CHANGED (Phase 3 §3/§23-P2): change in ChitKuber's own
  // derived context between refreshes — NEVER a claim about competitor
  // performance or a prediction of sales impact (spec §11).
  if (options.previous && options.previous.competitorCount !== total) {
    const delta = total - options.previous.competitorCount;
    push(
      'COMPETITION_COUNT_CHANGED',
      Math.abs(delta) > 5 ? 'medium' : 'low',
      { previousCount: options.previous.competitorCount, currentCount: total, delta },
      [
        `Identified restaurant count changed from ${options.previous.competitorCount} to ${total} since the previous refresh (${options.previous.fetchedAt}).`,
        'Count change reflects Google Places data only — no claim about competitor performance or sales impact.',
      ],
    );
  }

  return signals;
}
