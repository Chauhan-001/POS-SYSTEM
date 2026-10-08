/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketIndiaSeries.ts — Team India fixture discovery through the provider's
 * SERIES endpoints (`/series` + `/series_info`).
 *
 * Why this exists (live finding, 2026-10-07): `/v1/matches` slices 15,824 rows
 * by row offset, so a refresh spends a request per 25 rows and still has no
 * guarantee of reaching the fixtures near "now" — a real scan of the first 300
 * rows (12 requests) found the ongoing "West Indies tour of India, 2026" and
 * its four upcoming internationals NOWHERE, while the in-window rows it did
 * find were India A / India Women / India U19. The same tour is one request
 * (`/series?offset=25`) plus one more (`/series_info?id=…`) to enumerate in
 * full — cheaper AND complete, because a series lists every match it contains,
 * past and future.
 *
 * Contract:
 *   - SENIOR India men's side only. `isTeamIndiaMatch` excludes India A/B,
 *     India Women, India U19 and the domestic composite "Rest of India"; a
 *     series is only enumerated when its name is a senior India series.
 *   - Availability is explicit and never throws: provider failures degrade to
 *     a `provider_error` reason, and the cached payload survives as a clearly
 *     labelled `stale` fallback.
 *   - Cost guards: bounded series pages, bounded series enumerated per run, and
 *     a quota-aware skip while every key is blocked (a request against a
 *     blocked pool cannot succeed and only extends the provider's block).
 *   - Only `cricketProvider` talks to CricAPI; this module orchestrates it.
 *
 * Env (all optional):
 *   CRICKET_SERIES_PAGES   — /series pages per discovery (default 3 = 75 series)
 *   CRICKET_SERIES_MAX     — senior India series enumerated per run (default 4)
 */

import { config } from '../../../config';
import { getCache, setCache } from '../../../services/cacheService';
import {
  CricketProviderError,
  createCricketKeyCursor,
  getCricketKeyQuotaState,
  getCricketProviderConfig,
  getSeries,
  getSeriesInfo,
  withCricketKeyPool,
  type CricketKeyCursor,
  type CricketProviderConfig,
  type CricApiMatchRaw,
  type CricApiSeriesRaw,
} from './cricketProvider';
import { isTeamIndiaMatch, isTeamIndiaSeries, normalizeMatch } from './cricketNormalizer';
import type { CricketMatchContext } from './cricketTypes';

const CACHE_KEY = 'cricket_india_fixtures_cache';

/** Grace for live/ongoing matches — identical to the cricket service window. */
const LIVE_GRACE_MS = 6 * 3600_000;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Provider pages spent on the series list per discovery. */
function maxSeriesPages(): number {
  return intEnv('CRICKET_SERIES_PAGES', 3, 1, 20);
}

/** Senior India series enumerated per discovery (1 request each). */
function maxSeries(): number {
  return intEnv('CRICKET_SERIES_MAX', 4, 1, 10);
}

function ttlSeconds(): number {
  const hours = Number.isFinite(config.cricket.refreshHours) && config.cricket.refreshHours > 0
    ? config.cricket.refreshHours
    : 12;
  return hours * 3600;
}

interface IndiaFixturesCache {
  matches: CricketMatchContext[];
  fetchedAt: string;
  horizonDays: number;
}

export interface IndiaSeriesDiagnostics {
  /** /series pages spent. */
  seriesPages: number;
  /** Senior India series seen inside the look-ahead window. */
  seriesInWindow: number;
  /** /series_info requests spent. */
  seriesFetched: number;
  /** Normalized matches collected from those series (before windowing). */
  matchesCollected: number;
  /** True when the key pool rotated mid-discovery. */
  keyRotated: boolean;
}

export interface TeamIndiaFixturesOutput {
  available: boolean;
  reason: 'ok' | 'no_api_key' | 'disabled' | 'provider_error' | 'provider_unavailable';
  /** Senior India fixtures inside the requested window, soonest first. */
  matches: CricketMatchContext[];
  dataStatus: 'fresh' | 'stale';
  lastFetchedAt?: string;
  quotaState?: ReturnType<typeof getCricketKeyQuotaState>;
  diagnostics?: IndiaSeriesDiagnostics;
}

function unavailable(
  reason: TeamIndiaFixturesOutput['reason'],
  extra: Partial<TeamIndiaFixturesOutput> = {},
): TeamIndiaFixturesOutput {
  return { available: false, reason, matches: [], dataStatus: 'stale', ...extra };
}

/** Wrapped tours (a December series ending in January) are only ever a few
 *  months across the year boundary — anything older than this is genuinely a
 *  past date, not a wrap-around. */
const YEAR_WRAP_TOLERANCE_MS = 180 * 86_400_000;

const YEAR_IN_STRING = /\b(?:19|20)\d{2}\b/;

/**
 * Series dates are unreliable by design (see CricApiSeriesRaw): ISO on the list
 * endpoint, short form without a year elsewhere ("/series_info" really returns
 * `"enddate":"Oct 17"`).
 *
 * Never trust a year-less string to `Date.parse`: V8's fallback parser silently
 * resolves `'Oct 17'` to **2001-10-17**, which reads as a tour finished 25 years
 * ago and silently drops a live series — measured in the acceptance test for
 * this module before the guard existed. A year-less date is therefore resolved
 * against the reference year, falling back to the next year only for the
 * wrap-around case.
 *
 * An unparseable date is "unknown" rather than "outside": the matches inside
 * the series are filtered by their own (ISO) dates anyway, so a wasted request
 * is cheaper than a missed tour.
 */
export function parseSeriesDate(value: string | undefined, reference: Date): number | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (YEAR_IN_STRING.test(v)) {
    const direct = Date.parse(v);
    return Number.isNaN(direct) ? null : direct;
  }
  const year = reference.getUTCFullYear();
  const currentYear = Date.parse(`${v} ${year}`);
  const nextYear = Date.parse(`${v} ${year + 1}`);
  if (!Number.isNaN(currentYear) && currentYear >= reference.getTime() - YEAR_WRAP_TOLERANCE_MS) {
    return currentYear;
  }
  if (!Number.isNaN(nextYear)) return nextYear;
  return Number.isNaN(currentYear) ? null : currentYear;
}

function seriesStart(raw: CricApiSeriesRaw): string | undefined {
  return raw.startDate ?? raw.startdate;
}

function seriesEnd(raw: CricApiSeriesRaw): string | undefined {
  return raw.endDate ?? raw.enddate;
}

/**
 * Does this senior India series overlap the look-ahead window? Unknown dates
 * pass (the series is then cheaply validated by its own match list).
 */
function seriesInWindow(raw: CricApiSeriesRaw, now: Date, horizonMs: number): boolean {
  const start = parseSeriesDate(seriesStart(raw), now);
  const end = parseSeriesDate(seriesEnd(raw), now);
  if (start === null && end === null) return true;
  if (end !== null && end < now.getTime() - LIVE_GRACE_MS) return false; // tour already over
  if (start !== null && start > horizonMs) return false; // tour not started within the window
  return true;
}

function matchInstantMs(m: Pick<CricketMatchContext, 'dateTimeGMT' | 'date'>): number {
  return Date.parse(m.dateTimeGMT ? `${m.dateTimeGMT}Z` : m.date);
}

/** One /series page, rotated through the key pool. */
async function seriesPage(
  cfg: CricketProviderConfig,
  cursor: CricketKeyCursor,
  offset: number,
): Promise<CricApiSeriesRaw[]> {
  const res = await withCricketKeyPool(cfg, cursor, (keyCfg) => getSeries(keyCfg, offset));
  return Array.isArray(res.data) ? res.data : [];
}

/** The whole match list of one series, rotated through the key pool. */
async function seriesMatches(
  cfg: CricketProviderConfig,
  cursor: CricketKeyCursor,
  seriesId: string,
): Promise<CricApiMatchRaw[]> {
  const res = await withCricketKeyPool(cfg, cursor, (keyCfg) => getSeriesInfo(keyCfg, seriesId));
  return Array.isArray(res.data?.matchList) ? res.data.matchList : [];
}

/**
 * Discover and normalize the senior Team India fixtures inside the window.
 * Fresh on success, cached fallback on failure — never throws.
 */
export async function fetchTeamIndiaFixtures(
  options: { daysAhead?: number; now?: Date } = {},
): Promise<TeamIndiaFixturesOutput> {
  const now = options.now ?? new Date();
  const daysAhead = options.daysAhead ?? 14;
  const horizonMs = now.getTime() + daysAhead * 86_400_000;
  const windowStart = now.getTime() - LIVE_GRACE_MS;

  if (!config.cricket.enabled) return unavailable('disabled');
  const cfg = getCricketProviderConfig();
  if (!cfg) return unavailable('no_api_key');

  const quota = getCricketKeyQuotaState(now.getTime());

  const cached = await getCache<IndiaFixturesCache>(CACHE_KEY);
  const cacheCoversRequest = !!cached && cached.horizonDays >= daysAhead;
  // A cached payload is still data — it is served as `available` with
  // `dataStatus: 'stale'` so callers never mistake its provenance.
  const staleFallback: TeamIndiaFixturesOutput | null = cached
    ? {
        available: true,
        reason: 'ok',
        matches: cached.matches,
        dataStatus: 'stale',
        lastFetchedAt: cached.fetchedAt,
        quotaState: quota,
      }
    : null;
  if (cached && cacheCoversRequest) {
    return {
      available: true,
      reason: 'ok',
      matches: cached.matches,
      dataStatus: 'fresh',
      lastFetchedAt: cached.fetchedAt,
      quotaState: quota,
    };
  }

  // Cost guard: every key is blocked, so a request cannot succeed.
  if (quota.allBlocked) {
    return staleFallback ?? unavailable('provider_error', { quotaState: quota });
  }

  const cursor = createCricketKeyCursor();
  const diagnostics: IndiaSeriesDiagnostics = {
    seriesPages: 0,
    seriesInWindow: 0,
    seriesFetched: 0,
    matchesCollected: 0,
    keyRotated: false,
  };

  try {
    // 1. Series list — bounded pages, stopping when the provider repeats a page.
    const seenSeries = new Set<string>();
    const candidates: CricApiSeriesRaw[] = [];
    for (let page = 0; page < maxSeriesPages(); page++) {
      const rows = await seriesPage(cfg, cursor, page * 25);
      diagnostics.seriesPages++;
      if (rows.length === 0) break;
      let newIds = 0;
      for (const row of rows) {
        const id = typeof row.id === 'string' ? row.id : '';
        if (!id || seenSeries.has(id)) continue;
        seenSeries.add(id);
        newIds++;
        if (isTeamIndiaSeries(row.name) && seriesInWindow(row, now, horizonMs)) candidates.push(row);
      }
      if (newIds === 0) break; // provider repeated a page → end of usable data
    }

    diagnostics.seriesInWindow = candidates.length;

    // 2. Soonest-starting first — a tour already under way (still overlapping
    // the window) is the one a restaurant can plan around, ahead of future ones.
    candidates.sort((a, b) => {
      const ta = parseSeriesDate(seriesStart(a), now) ?? Number.POSITIVE_INFINITY;
      const tb = parseSeriesDate(seriesStart(b), now) ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    const collected: CricketMatchContext[] = [];
    const seenMatches = new Set<string>();
    const fetchedAt = new Date().toISOString();
    for (const series of candidates.slice(0, maxSeries())) {
      const rows = await seriesMatches(cfg, cursor, String(series.id));
      diagnostics.seriesFetched++;
      for (const raw of rows) {
        const m = normalizeMatch(raw, fetchedAt);
        if (!m || seenMatches.has(m.externalId)) continue;
        seenMatches.add(m.externalId);
        if (!m.isTeamIndiaMatch) continue; // India A / Women / U19 never qualify
        collected.push(m);
      }
    }
    diagnostics.matchesCollected = collected.length;
    diagnostics.keyRotated = cursor.rotated;

    const inWindow = collected
      .filter((m) => {
        const instant = matchInstantMs(m);
        return !Number.isNaN(instant) && instant >= windowStart && instant <= horizonMs;
      })
      .sort((a, b) => matchInstantMs(a) - matchInstantMs(b));

    const payload: IndiaFixturesCache = { matches: inWindow, fetchedAt, horizonDays: daysAhead };
    await setCache(CACHE_KEY, payload, ttlSeconds());

    console.log(
      `[cricket-india] seriesPages=${diagnostics.seriesPages} seriesInWindow=${diagnostics.seriesInWindow} seriesFetched=${diagnostics.seriesFetched} matches=${diagnostics.matchesCollected} inWindow=${inWindow.length}${cursor.rotated ? ' keyRotated=true' : ''}`,
    );

    return {
      available: true,
      reason: 'ok',
      matches: inWindow,
      dataStatus: 'fresh',
      lastFetchedAt: fetchedAt,
      quotaState: getCricketKeyQuotaState(now.getTime()),
      diagnostics,
    };
  } catch (err) {
    const kind = err instanceof CricketProviderError ? err.kind : 'provider_unavailable';
    console.warn(
      `[cricket-india] discovery failed kind=${kind}${err instanceof CricketProviderError && err.httpStatus ? ` httpStatus=${err.httpStatus}` : ''} — ${staleFallback ? 'serving stale cache' : 'no cached fallback'}`,
    );
    const quotaAfter = getCricketKeyQuotaState(now.getTime());
    if (staleFallback) return { ...staleFallback, quotaState: quotaAfter, diagnostics };
    return unavailable(
      kind === 'rate_limited' || kind === 'invalid_key' ? 'provider_error' : 'provider_unavailable',
      { quotaState: quotaAfter, diagnostics },
    );
  }
}

export const cricketIndiaSeries = { fetchTeamIndiaFixtures };
