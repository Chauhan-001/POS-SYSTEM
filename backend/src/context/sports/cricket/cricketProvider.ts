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
  timeoutMs: number;
}

export function getCricketProviderConfig(): CricketProviderConfig | null {
  const { enabled, apiKey, baseUrl, timeoutMs } = config.cricket;
  if (!enabled || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, timeoutMs };
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

/** Fetch one page of matches. Offset follows CricAPI's ?offset= semantics. */
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
      return (await res.json()) as CricApiMatchesResponse;
    } catch {
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
