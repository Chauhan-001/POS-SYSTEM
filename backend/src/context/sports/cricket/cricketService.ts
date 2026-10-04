/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketService.ts — the Cricket Context pipeline (spec §10):
 *
 *   CricAPI → provider (paginated, capped) → normalizer → validation
 *           → dedup by externalId → relevance tier → cache → canonical data
 *
 * Availability is ALWAYS explicit: 'provider unavailable' is distinct from
 * 'no matches' (spec §19). Provider failure never throws to callers and never
 * destroys the last good cache (stale fallback).
 *
 * Observability (spec §20): logs provider, duration, counts, cache hit —
 * never the API key or the authenticated URL.
 */

import { config } from '../../../config';
import {
  getMatches,
  getCricketProviderConfig,
  markCricketKeyQuotaBlocked,
  markCricketKeyInvalid,
  getCricketKeyQuotaState,
  isCricketKeyUsable,
  CricketProviderError,
  type CricApiMatchRaw,
  type CricApiMatchesResponse,
} from './cricketProvider';
import { normalizeMatch, withRelevance, type RelevantCricketEvent } from './cricketNormalizer';
import { readCricketCache, writeCricketCache } from './cricketCache';
import type { CricketMatchContext, CricketContextCache, SportsContextOutput } from './cricketTypes';

/** Pagination guard: at most this many matches collected per refresh. */
function maxMatches(): number {
  return Number.isFinite(config.cricket.maxMatches) && config.cricket.maxMatches > 0
    ? config.cricket.maxMatches
    : 50;
}

interface FetchOutcome {
  matches: CricketMatchContext[];
  fetchedAt: string;
  pages: number;
}

/**
 * Fetch up to maxMatches, page by page. CricAPI /v1/matches returns the
 * full list sliced by offset; we stop when a page returns no NEW matches
 * (safe regardless of whether pagination metadata exists, spec §5).
 *
 * Key pool: when the current key is quota-blocked (HTTP 200 + a `reason`,
 * surfaced as rate_limited), the fetch retries with the next key in the pool
 * (primary → fallbacks). Exhausted keys get a cooldown so the pool skips
 * them until the daily quota reset.
 */
export async function fetchAllMatches(): Promise<FetchOutcome> {
  const cfg = getCricketProviderConfig();
  if (!cfg) throw new CricketProviderError('cricket provider not configured', 'http_error');

  const fetchedAt = new Date().toISOString();
  const seen = new Set<string>();
  const collected: CricketMatchContext[] = [];
  const cap = maxMatches();
  const startedAt = Date.now();

  const keysToTry = [cfg.apiKey, ...cfg.fallbackApiKeys].filter(
    (k, i, arr) => k && arr.indexOf(k) === i,
  );
  let activeKeyIndex = 0;
  let rotated = false;

  const fetchWithKeyPool = async (offset: number): Promise<CricApiMatchesResponse> => {
    let lastError: CricketProviderError | null = null;
    for (let i = activeKeyIndex; i < keysToTry.length; i++) {
      // Quota-aware: never spend a request on a key we KNOW is in cooldown —
      // requests to blocked keys extend the provider's block window without
      // producing data. The lastError keeps rotating for the usable ones.
      if (!isCricketKeyUsable(keysToTry[i])) continue;
      try {
        const res = await getMatches({ ...cfg, apiKey: keysToTry[i] }, offset);
        activeKeyIndex = i; // this key works — pin it for subsequent pages
        return res;
      } catch (err) {
        if (err instanceof CricketProviderError && (err.kind === 'rate_limited' || err.kind === 'invalid_key')) {
          // A rejected key is dead for the day; a quota block cools for the
          // provider's own window. Either way the pool rotates to the next key
          // so one bad key never stalls the refresh.
          if (err.kind === 'invalid_key') markCricketKeyInvalid(keysToTry[i]);
          else markCricketKeyQuotaBlocked(keysToTry[i]);
          lastError = err;
          rotated = true;
          continue; // next key in the pool
        }
        throw err; // non-quota failures are not fixable by rotating keys
      }
    }
    throw lastError ?? new CricketProviderError('all cricket API keys exhausted', 'rate_limited');
  };

  // Offset pages: CricAPI slices by offset (each page advances by page size);
  // defensive loop stops on empty/no-new page or cap.
  let pages = 0;
  for (let offset = 0; collected.length < cap && offset <= 20; offset++) {
    pages = offset + 1;
    const res = await fetchWithKeyPool(offset);
    const raw: CricApiMatchRaw[] = Array.isArray(res.data) ? res.data : [];
    if (raw.length === 0) break;

    let added = 0;
    for (const r of raw) {
      if (collected.length >= cap) break;
      const m = normalizeMatch(r, fetchedAt);
      if (!m || seen.has(m.externalId)) continue;
      seen.add(m.externalId);
      collected.push(m);
      added++;
    }
    if (added === 0) break; // page fully duplicate/unusable → no more usable data
  }

  // Observability: counts + duration only. No key, no full URL.
  console.log(
    `[cricket] provider=cricapi durationMs=${Date.now() - startedAt} pages=${pages} normalized=${collected.length}/${maxMatches()}${rotated ? ' keyRotated=true' : ''}`,
  );

  return { matches: collected, fetchedAt, pages };
}

let lastGood: CricketContextCache | null = null;

/**
 * Canonical service entry: getUpcomingCricketContext().
 * `now` injectable for tests. When `restaurantId` is supplied, matches are
 * enriched with the restaurant's own timezone + relevance/signals (Phase 2).
 */
export async function getUpcomingCricketContext(
  options: { daysAhead?: number; now?: Date; restaurantId?: string } = {},
): Promise<SportsContextOutput> {
  const generatedAt = new Date().toISOString();
  const daysAhead = options.daysAhead ?? 14;
  const now = options.now ?? new Date();
  const horizon = now.getTime() + daysAhead * 86_400_000;

  // 1. Configuration gates — honest unavailability (spec §19).
  if (!config.cricket.enabled) {
    return { sport: 'cricket', available: false, reason: 'disabled', events: [], generatedAt };
  }
  const cfg = getCricketProviderConfig();
  if (!cfg) {
    return { sport: 'cricket', available: false, reason: 'no_api_key', events: [], generatedAt };
  }

  // 2. Cache-first (spec §12/§16/§17) — enrichment is per-request, post-cache,
  // so the cached payload stays restaurant-agnostic. Quota state rides along
  // on every response so callers can always see the pool's health.
  const quota = getCricketKeyQuotaState(now.getTime());
  const cached = await readCricketCache();
  if (cached) {
    lastGood = cached;
    return finalizeOutput(cached, 'fresh', true, true, { daysAhead, now, horizon, restaurantId: options.restaurantId, generatedAt, quotaState: quota });
  }

  // 2b. Quota-aware throttle: when every key in the pool is quota-blocked, a
  // provider call cannot succeed — skip the refresh entirely (serves stale if
  // available) so blocked-key requests are not wasted (cost guard).
  if (quota.allBlocked) {
    if (lastGood) {
      console.warn(
        `[cricket] all ${quota.totalKeys} API keys quota-blocked — skipping refresh (retry in ~${quota.cooldownMinutesRemaining}m), serving stale cache`,
      );
      return finalizeOutput(lastGood, 'stale', false, false, { daysAhead, now, horizon, restaurantId: options.restaurantId, generatedAt, quotaState: quota });
    }
    return {
      sport: 'cricket',
      available: false,
      reason: 'provider_error',
      events: [],
      dataStatus: 'stale',
      providerAvailable: false,
      quotaState: quota,
      generatedAt,
    };
  }

  // 3. Refresh: fetch → normalize → dedup → cache. Failure falls back to the
  // last good payload, marked STALE — never silently presented as fresh (§16).
  try {
    const outcome = await fetchAllMatches();
    const payload: CricketContextCache = { matches: outcome.matches, fetchedAt: outcome.fetchedAt };
    await writeCricketCache(payload);
    lastGood = payload;
    return finalizeOutput(payload, 'fresh', true, false, { daysAhead, now, horizon, restaurantId: options.restaurantId, generatedAt, quotaState: quota });
  } catch (err) {
    const kind = err instanceof CricketProviderError ? err.kind : 'provider_unavailable';
    console.warn(
      `[cricket] refresh failed kind=${kind}${err instanceof CricketProviderError && err.httpStatus ? ` httpStatus=${err.httpStatus}` : ''} — ${lastGood ? 'serving stale cache' : 'no cached fallback'}`,
    );
    // Recompute AFTER the failed refresh — the keys just got marked blocked
    // during rotation, so reporting the pre-fetch snapshot would lie.
    const quotaAfter = getCricketKeyQuotaState(now.getTime());
    if (lastGood) {
      return finalizeOutput(lastGood, 'stale', false, true, { daysAhead, now, horizon, restaurantId: options.restaurantId, generatedAt, quotaState: quotaAfter });
    }
    return {
      sport: 'cricket',
      available: false,
      reason: kind === 'rate_limited' || kind === 'invalid_key' ? 'provider_error' : 'provider_unavailable',
      events: [],
      dataStatus: 'stale',
      providerAvailable: false,
      quotaState: quotaAfter,
      generatedAt,
    };
  }
}

interface FinalizeOptions {
  daysAhead: number;
  now: Date;
  horizon: number;
  restaurantId?: string;
  generatedAt: string;
  /** Quota state surfaced when quota affected this response (no key values). */
  quotaState?: ReturnType<typeof getCricketKeyQuotaState>;
}

/**
 * Phase 2 finalizer: base upcoming list (Phase-1 compat) + restaurant-enriched
 * relevantMatches with deterministic signals (spec §14). Tenant timezone comes
 * ONLY from the authoritative Restaurant record — never from callers/LLM.
 */
async function finalizeOutput(
  payload: CricketContextCache,
  dataStatus: 'fresh' | 'stale',
  providerAvailable: boolean,
  cacheHit: boolean,
  opts: FinalizeOptions,
): Promise<SportsContextOutput> {
  const events = selectUpcoming(payload.matches, opts.now, opts.horizon).map(withRelevance);

  let restaurantTz: string | null = null;
  if (opts.restaurantId) {
    try {
      const Restaurant = (await import('../../../models/core/Restaurant')).default;
      const doc = await Restaurant.findById(opts.restaurantId).select('timezone').lean().exec();
      restaurantTz = doc?.timezone ?? null; // 'UTC' default handled by the engine
    } catch {
      restaurantTz = null; // engine falls back to UTC, explicitly labeled
    }
  }

  const { enrichMatch } = await import('./cricketRelevance');
  const restaurantCtx = restaurantTz ? { timezone: restaurantTz } : null;
  const relevantMatches = payload.matches
    .map((m) => enrichMatch(m, restaurantCtx, opts.now))
    .filter((m) => m.relevance !== 'irrelevant')
    .sort((a, b) => (Date.parse(a.dateTimeGMT ?? a.date) || 0) - (Date.parse(b.dateTimeGMT ?? b.date) || 0))
    .slice(0, 20);

  return {
    sport: 'cricket',
    available: true,
    reason: 'ok',
    events,
    relevantMatches,
    dataStatus,
    lastFetchedAt: payload.fetchedAt,
    providerAvailable,
    quotaState: opts.quotaState,
    cacheInfo: { hit: cacheHit, fetchedAt: payload.fetchedAt },
    generatedAt: opts.generatedAt,
  };
}

/** Upcoming = match instant (dateTimeGMT preferred, else date) within window. */
export function selectUpcoming(
  matches: CricketMatchContext[],
  now: Date,
  horizonMs: number,
): CricketMatchContext[] {
  return matches
    .filter((m) => {
      const instant = m.dateTimeGMT ? Date.parse(`${m.dateTimeGMT}Z`.replace(/Z$/, m.dateTimeGMT.endsWith('Z') ? '' : 'Z')) : Date.parse(m.date);
      if (Number.isNaN(instant)) return false;
      return instant >= now.getTime() - 6 * 3600_000 && instant <= horizonMs; // small grace for live matches
    })
    .sort((a, b) => {
      const ta = Date.parse(a.dateTimeGMT ? `${a.dateTimeGMT}Z` : a.date);
      const tb = Date.parse(b.dateTimeGMT ? `${b.dateTimeGMT}Z` : b.date);
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
}

/** Shared Sports Context surface (spec §14) — cricket is the Phase-1 provider. */
export async function getSportsContext(options: { restaurantId?: string; daysAhead?: number } = {}): Promise<SportsContextOutput> {
  // restaurantId (server-authoritative) drives restaurant-local time +
  // restaurant-specific relevance (Phase 2). It never reaches the provider.
  return getUpcomingCricketContext({ daysAhead: options.daysAhead, restaurantId: options.restaurantId });
}

export const cricketService = {
  getUpcomingCricketContext,
  getSportsContext,
  fetchAllMatches,
  selectUpcoming,
};
