/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionCache.ts — provider-specific cache over the EXISTING
 * services/cacheService (spec §1/§13/§14: reuse infrastructure). One key per
 * restaurant — tenant isolation by construction — pinned to the coordinates
 * it was fetched for, so a location change cannot serve old-neighborhood
 * data (spec §12).
 *
 * Stores normalized competitors only — never the API key, never a raw Google
 * response archive (spec §15).
 */

import { getCache, setCache, deleteCache } from '../../services/cacheService';
import { config } from '../../config';
import type { CompetitionContextCache } from './competitionTypes';
import { locationKeyOf } from './competitionNormalizer';

function cacheKey(restaurantId: string): string {
  return `competition_context_cache:${restaurantId}`;
}

function ttlSeconds(): number {
  const days = Number.isFinite(config.competition.refreshDays) && config.competition.refreshDays > 0
    ? config.competition.refreshDays
    : 30;
  return days * 86_400;
}

/** Fresh cache for this restaurant whose locationKey matches the current coordinates. */
export async function readCompetitionCache(
  restaurantId: string,
  locationKey: string,
): Promise<CompetitionContextCache | null> {
  const entry = await getCache<CompetitionContextCache>(cacheKey(restaurantId));
  if (!entry || !Array.isArray(entry.competitors)) return null;
  if (entry.locationKey !== locationKey) return null; // location changed → treated as absent
  return entry;
}

export async function writeCompetitionCache(payload: CompetitionContextCache): Promise<void> {
  await setCache(cacheKey(payload.restaurantId), payload, ttlSeconds());
}

/** Explicit invalidation (location change handler / admin force-refresh). */
export async function deleteCompetitionCache(restaurantId: string): Promise<void> {
  await deleteCache(cacheKey(restaurantId));
}

export { locationKeyOf };
