/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketProvider.ts — the ONLY file that talks to CricAPI (spec §3/§22).
 * Responsibilities: build the authenticated URL (key from server env, never
 * logged), fetch with timeout, parse JSON defensively. No marketing logic.
 *
 * Endpoint (Phase 1): GET {baseUrl}/matches?apikey=<key>&offset=<n>
 * The key lives in config.cricket.apiKey and is NEVER included in any error,
 * log, or return value — errors reference the endpoint path only.
 */

import { config } from '../../../config';

export interface CricApiMatchRaw {
  id?: string;
  name?: string;
  matchType?: string;
  status?: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  /** Provider lifecycle booleans — authoritative when status is empty. */
  matchStarted?: boolean;
  matchEnded?: boolean;
}

export interface CricApiMatchesResponse {
  apikey?: unknown; // echoed by the API — must never be surfaced
  data?: CricApiMatchRaw[];
  info?: { hitsToday?: number; totalMatches?: number; [k: string]: unknown };
  reason?: unknown;
}

export interface CricketProviderConfig {
  baseUrl: string;
  apiKey: string;
  /** Fallback keys rotated in when the primary is quota-blocked (same provider). */
  fallbackApiKeys: string[];
  timeoutMs: number;
}

/**
 * Quota cooldowns: keys that returned a quota-block get a cool-down so the
 * pool does not hammer exhausted keys on every refresh. Process-lifetime —
 * quotas reset daily, so a short cooldown plus key re-check is sufficient.
 */
const KEY_COOLDOWN_MS = 60 * 60 * 1000; // 1h
const keyCooldownUntil = new Map<string, number>();

function keyUsable(key: string, now = Date.now()): boolean {
  const until = keyCooldownUntil.get(key);
  return until === undefined || until <= now;
}

/** Mark a key quota-blocked — cool it down so the pool skips it. */
export function markCricketKeyQuotaBlocked(key: string): void {
  keyCooldownUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
}

export interface CricketKeyQuotaState {
  /** Keys configured in the pool (never the key values themselves). */
  totalKeys: number;
  /** Keys currently under quota cooldown. */
  blockedKeys: number;
  /** True when EVERY configured key is quota-blocked — the pool cannot serve
   *  a refresh until the daily quota resets; callers must not spend requests. */
  allBlocked: boolean;
  /** Earliest time a blocked key becomes usable again (ms epoch), or null. */
  nextRetryAt: number | null;
  /** Minutes until the next key cooldown expires (rounded), or null. */
  cooldownMinutesRemaining: number | null;
}

/** Quota state of the key pool — safe to surface (no key material). */
export function getCricketKeyQuotaState(now = Date.now()): CricketKeyQuotaState {
  const pool = keyPool();
  const blocked = pool.filter((k) => !keyUsable(k, now));
  const nextRetryAt = blocked.length > 0
    ? Math.min(...blocked.map((k) => keyCooldownUntil.get(k) ?? now))
    : null;
  return {
    totalKeys: pool.length,
    blockedKeys: blocked.length,
    allBlocked: pool.length > 0 && blocked.length === pool.length,
    nextRetryAt,
    cooldownMinutesRemaining: nextRetryAt !== null ? Math.max(0, Math.ceil((nextRetryAt - now) / 60_000)) : null,
  };
}

/** Test hook — clear all cooldowns. */
export function clearCricketKeyCooldowns(): void {
  keyCooldownUntil.clear();
}

/** All configured keys in rotation order: primary first, then fallbacks. */
function keyPool(): string[] {
  const { apiKey, fallbackApiKeys } = config.cricket;
  return [apiKey, ...fallbackApiKeys].filter((k, i, arr) => k && arr.indexOf(k) === i);
}

export function getCricketProviderConfig(): CricketProviderConfig | null {
  const { enabled, apiKey, baseUrl, timeoutMs, fallbackApiKeys } = config.cricket;
  if (!enabled || !apiKey) return null;
  // Prefer the first usable key; fall back to a cooled-down key only if the
  // whole pool is exhausted (better to try than to report no data at all).
  const pool = keyPool();
  const usable = pool.find((k) => keyUsable(k)) ?? pool[0];
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey: usable, fallbackApiKeys, timeoutMs };
}

export class CricketProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'http_error' | 'invalid_json' | 'timeout' | 'rate_limited',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CricketProviderError';
  }
}

/** Fetch one page of matches. Offset follows CricAPI's ?offset= semantics.
 *  On a quota-block (HTTP 200 + reason), the caller rotates to the next key
 *  in the pool via the retry wrapper in cricketService. */
export async function getMatches(cfg: CricketProviderConfig, offset = 0): Promise<CricApiMatchesResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    // Key goes in the query string per CricAPI's contract; the full
    // authenticated URL is never logged (observability rule, spec §20).
    const res = await fetch(`${cfg.baseUrl}/matches?apikey=${encodeURIComponent(cfg.apiKey)}&offset=${offset}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.status === 429) {
      throw new CricketProviderError('CricAPI rate limit reached', 'rate_limited', 429);
    }
    if (!res.ok) {
      throw new CricketProviderError(`CricAPI /matches failed (HTTP ${res.status})`, 'http_error', res.status);
    }
    try {
      const body = (await res.json()) as CricApiMatchesResponse;
      // CricAPI signals quota exhaustion/blocking with HTTP 200 + a `reason`
      // and an empty data list — surface that as rate_limited instead of
      // silently reporting "no matches" (spec §19 honest availability).
      if (body.reason && (!Array.isArray(body.data) || body.data.length === 0)) {
        throw new CricketProviderError(`CricAPI blocked the request: ${String(body.reason)}`, 'rate_limited');
      }
      return body;
    } catch (err) {
      if (err instanceof CricketProviderError) throw err;
      throw new CricketProviderError('CricAPI returned invalid JSON', 'invalid_json');
    }
  } catch (err) {
    if (err instanceof CricketProviderError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CricketProviderError('CricAPI request timed out', 'timeout');
    }
    throw new CricketProviderError(
      `CricAPI unavailable: ${err instanceof Error ? err.message : String(err)}`,
      'http_error',
    );
  } finally {
    clearTimeout(timer);
  }
}
