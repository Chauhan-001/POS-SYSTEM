/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketCache.ts — provider-specific cache over the EXISTING
 * services/cacheService (spec §11: reuse infrastructure). Stores normalized
 * matches only — never the API key.
 *
 * Stale-fallback: if the provider fails during refresh, the previous cached
 * payload is returned (flagged hit=true) rather than destroyed — a restaurant
 * losing network should keep yesterday's match list, not lose context.
 */

import { getCache, setCache } from '../../../services/cacheService';
import { config } from '../../../config';
import type { CricketContextCache } from './cricketTypes';

const CACHE_KEY = 'cricket_context_cache';

function ttlSeconds(): number {
  const hours = Number.isFinite(config.cricket.refreshHours) && config.cricket.refreshHours > 0
    ? config.cricket.refreshHours
    : 12;
  return hours * 3600;
}

export async function readCricketCache(): Promise<CricketContextCache | null> {
  const entry = await getCache<CricketContextCache>(CACHE_KEY);
  if (!entry || !Array.isArray(entry.matches)) return null;
  return entry;
}

export async function writeCricketCache(payload: CricketContextCache): Promise<void> {
  await setCache(CACHE_KEY, payload, ttlSeconds());
}

/** Read the possibly-expired entry directly (stale fallback path). */
export async function peekCricketCache(): Promise<CricketContextCache | null> {
  // cacheService deletes on read when expired, so peek is not possible
  // through it — the service keeps its own lastGood copy instead (see
  // cricketService). This helper exists for symmetry/tests.
  return readCricketCache();
}
