/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketTypes.ts — canonical internal cricket model (Phase 1, spec §6).
 * CricAPI's raw response shape must never spread beyond cricketProvider →
 * cricketNormalizer; everything downstream (service, cache, AI tool,
 * Marketing Agent) sees ONLY these types.
 *
 * Only fields actually available from CricAPI /v1/matches are modelled.
 * Optional = the provider may omit it; nothing is invented.
 */

export type CricketMatchType = 'test' | 'odi' | 't20' | 'unknown';

export type CricketRelevance = 'high' | 'medium' | 'low';

export interface CricketMatchContext {
  /** CricAPI match id (GUID) — dedup key and calendar sourceReference. */
  externalId: string;
  name: string;
  matchType: CricketMatchType;
  /** Raw provider status string (e.g. "Match not started", "England won by 8 wks"). */
  status: string;
  /** Provider lifecycle flags — authoritative when status is empty (live data). */
  matchStarted?: boolean;
  matchEnded?: boolean;
  venue?: string;
  /** Provider local-date string (YYYY-MM-DD) as given by CricAPI. */
  date: string;
  /** GMT datetime when available — the authoritative instant for timing. */
  dateTimeGMT?: string;
  teams?: string[];
  /** Deterministic classification (spec §7) — name/teams contain India. */
  isIndiaMatch: boolean;
  /**
   * The senior ("original") India men's side ONLY — excludes India A/B, India
   * Women, India U19 and the domestic composite "Rest of India".
   *
   * `isIndiaMatch` stays the broad "involves an Indian side" signal used for
   * relevance tiers; THIS is the flag the admin Context Calendar scopes on.
   * An India A fixture is India context, but it is not Team India, and an
   * offer built on it under the wrong name is a wrong offer.
   */
  isTeamIndiaMatch: boolean;
  /** Derived from the match name suffix (", <series>" tail) when present. */
  tournament?: string;
  source: 'cricapi';
  fetchedAt: string;
}

/** Cache envelope — what cricketCache stores (normalized data only, no keys). */
export interface CricketContextCache {
  matches: CricketMatchContext[];
  fetchedAt: string;
  /**
   * Look-ahead (days) this payload was collected for. A payload collected for
   * a narrower window cannot answer a wider request, so the service refreshes
   * instead of silently under-reporting. Absent on payloads written before
   * this field existed (treated as usable, matching the legacy behaviour).
   */
  horizonDays?: number;
}

/** Service-level output (spec §14/§16): availability is always explicit. */
export interface SportsContextOutput {
  sport: 'cricket';
  available: boolean;
  /** 'no_api_key' | 'disabled' | 'provider_unavailable' | 'provider_error' | 'ok' */
  reason?: 'no_api_key' | 'disabled' | 'provider_unavailable' | 'provider_error' | 'ok';
  /** Phase-1 compat: upcoming matches (base relevance), no restaurant context. */
  events: Array<CricketMatchContext & { relevance: CricketRelevance }>;
  /** Phase 2: relevant enriched matches with signals + local time (§14/§19). */
  relevantMatches?: import('./cricketRelevance').EnrichedCricketMatch[];
  /** 'fresh' from provider/cache; 'stale' when serving fallback after failure (§16). */
  dataStatus?: 'fresh' | 'stale';
  lastFetchedAt?: string;
  providerAvailable?: boolean;
  /**
   * API key-pool quota state (counts + cooldown only — NEVER key values).
   * Present when quota affected this response so callers can see why data
   * may be stale and when the pool recovers.
   */
  quotaState?: {
    totalKeys: number;
    blockedKeys: number;
    allBlocked: boolean;
    nextRetryAt: number | null;
    cooldownMinutesRemaining: number | null;
  };
  /** Cache metadata for observability (never contains secrets). */
  cacheInfo?: { hit: boolean; fetchedAt: string };
  generatedAt: string;
}
