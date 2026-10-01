/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketRelevance.ts — Cricket Phase 2: the deterministic Relevance Engine.
 *
 *   Matches → competition classification → India detection (Phase 1) →
 *   restaurant-local time → operating-hours overlap → time windows →
 *   relevance tier (high/medium/low/irrelevant) → canonical signals.
 *
 * Everything here is deterministic (spec §20): no LLM touches classification,
 * timing or scoring. Rules are centralized (spec §12) and deliberately avoid
 * over-filtering (spec §13): an IPL match stays relevant with unknown
 * operating hours; only old completed matches and out-of-window matches are
 * excluded. No sales predictions are made anywhere.
 */

import { config } from '../../../config';
import type { CricketMatchContext } from './cricketTypes';

// ─── Competition classification (spec §4) ────────────────────────

export type CricketCompetition =
  | 'ipl'
  | 'world_cup'
  | 'champions_trophy'
  | 'asia_cup'
  | 'international'
  | 'domestic'
  | 'other'
  | 'unknown';

const COMPETITION_PATTERNS: Array<{ competition: CricketCompetition; pattern: RegExp }> = [
  { competition: 'ipl', pattern: /indian premier league|\bipl\b/i },
  { competition: 'world_cup', pattern: /world cup|world test championship/i },
  { competition: 'champions_trophy', pattern: /champions trophy/i },
  { competition: 'asia_cup', pattern: /asia cup/i },
  // Popular non-Indian T20 leagues — 'other' (not Indian domestic, not international)
  { competition: 'other', pattern: /super league|\bpsl\b|\bbbl\b|the hundred|big bash|premier league/i },
  // Indian domestic competitions
  { competition: 'domestic', pattern: /ranji|syed mushtaq|vijay hazare|deodhar|irani|duleep/i },
];

/** National sides (deterministic international detection when teams are known). */
const INTERNATIONAL_TEAMS: ReadonlySet<string> = new Set([
  'india', 'australia', 'england', 'pakistan', 'south africa', 'new zealand',
  'sri lanka', 'bangladesh', 'west indies', 'afghanistan', 'ireland',
  'zimbabwe', 'netherlands', 'scotland', 'nepal', 'oman', 'namibia', 'uae',
]);

/**
 * Classify the competition from provider-supplied series/tournament/name
 * data only (spec §4: "do not assume IPL merely because teams are Indian").
 * The classifier is table-driven so new competitions can evolve without
 * touching business logic.
 */
export function classifyCompetition(m: Pick<CricketMatchContext, 'name' | 'tournament' | 'matchType' | 'teams'>): CricketCompetition {
  const haystack = [m.tournament ?? '', m.name ?? ''].join(' ');
  for (const { competition, pattern } of COMPETITION_PATTERNS) {
    if (pattern.test(haystack)) return competition;
  }
  // Not a named competition: national teams playing test/odi/t20 → international.
  const teams = (m.teams ?? []).map((t) => t.toLowerCase());
  const bothInternational = teams.length >= 2 && teams.every((t) => INTERNATIONAL_TEAMS.has(t));
  if ((m.matchType === 'test' || m.matchType === 'odi' || m.matchType === 't20') && bothInternational) {
    return 'international';
  }
  return 'unknown';
}

// ─── Restaurant-local time (spec §7) ─────────────────────────────

export interface LocalMatchTime {
  localDateTime?: string; // 'YYYY-MM-DDTHH:mm' in the restaurant zone
  timezone: string;       // the zone actually used (explicit fallback, never silent)
  fallbackUsed: boolean;
}

/**
 * Convert dateTimeGMT → restaurant-local wall time via Intl (no manual offset
 * guessing). Fallback chain: restaurant timezone → 'UTC', always labeled.
 */
export function toRestaurantLocalTime(dateTimeGMT: string | undefined, restaurantTimezone?: string | null): LocalMatchTime {
  const requested = (restaurantTimezone ?? '').trim();
  let timezone = requested || 'UTC';
  let fallbackUsed = false;
  if (!dateTimeGMT) return { timezone, fallbackUsed: true };
  if (!isValidTimeZone(timezone)) {
    timezone = 'UTC';
    fallbackUsed = true;
  }
  const instant = Date.parse(`${dateTimeGMT}Z`.replace(/Z$/, dateTimeGMT.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(instant)) return { timezone, fallbackUsed };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const localDateTime = `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
  return { localDateTime, timezone, fallbackUsed };
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Operating-hours overlap (spec §8) ───────────────────────────

export interface OperatingHours {
  /** Local 'HH:mm' opening time, e.g. '18:00'. */
  openTime: string;
  /** Local 'HH:mm' closing time, e.g. '23:00'. May cross midnight. */
  closeTime: string;
}

export type HoursOverlap = 'match_during_operating_hours' | 'match_outside_operating_hours' | 'unknown';

const DINNER_START = 18 * 60; // minutes-of-day (deterministic constants; documented)
const DINNER_END = 23 * 60;
const LUNCH_START = 11 * 60;
const LUNCH_END = 15 * 60;

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Deterministic overlap of the LOCAL match start with meal windows and
 * operating hours. Unknown/invalid hours → 'unknown' (never guessed, §8/§13).
 */
export function classifyHoursOverlap(
  localTime: LocalMatchTime,
  hours?: OperatingHours | null,
): { overlap: HoursOverlap; duringDinner: boolean; duringLunch: boolean } {
  const hhmm = localTime.localDateTime?.slice(11, 16);
  if (!hhmm) return { overlap: 'unknown', duringDinner: false, duringLunch: false };
  const mins = minutesOfDay(hhmm);
  if (mins === null) return { overlap: 'unknown', duringDinner: false, duringLunch: false };

  const duringDinner = mins >= DINNER_START && mins < DINNER_END;
  const duringLunch = mins >= LUNCH_START && mins < LUNCH_END;

  if (!hours) return { overlap: 'unknown', duringDinner, duringLunch };
  const open = minutesOfDay(hours.openTime);
  const close = minutesOfDay(hours.closeTime);
  if (open === null || close === null) return { overlap: 'unknown', duringDinner, duringLunch };

  // Support windows crossing midnight (e.g. 18:00–02:00).
  const inside = open <= close ? mins >= open && mins < close : mins >= open || mins < close;
  return { overlap: inside ? 'match_during_operating_hours' : 'match_outside_operating_hours', duringDinner, duringLunch };
}

// ─── Time windows (spec §9) — configurable, never hardcoded ──────

export type TimeWindow =
  | 'currently_live'
  | 'today'
  | 'upcoming_tomorrow'
  | 'upcoming_24_hours'
  | 'upcoming_7_days'
  | 'recently_completed'
  | 'outside_window';

function windowBounds(now: Date): { liveWindowMs: number; dayMs: number } {
  return { liveWindowMs: 6 * 3600_000, dayMs: 86_400_000 };
}

/**
 * Provider status/flags → completed? (deterministic, shared by window +
 * signals). Live-data finding: some completed matches ship an EMPTY status
 * string, so the authoritative provider flags are honored when present —
 * status regex is the fallback, never the sole source.
 */
export function isCompletedStatus(
  status: string,
  matchEnded?: boolean,
): boolean {
  if (matchEnded === true) return true;
  if (matchEnded === false) return false;
  return /won|drawn|abandon|no result|tied|stumps|innings break|rain/.test((status || '').toLowerCase());
}

/** Authoritative match instant: dateTimeGMT (UTC, no Z suffix) else date. NaN if unusable. */
export function matchInstant(m: Pick<CricketMatchContext, 'dateTimeGMT' | 'date'>): number {
  const raw = m.dateTimeGMT
    ? Date.parse(`${m.dateTimeGMT}Z`.replace(/Z$/, m.dateTimeGMT.endsWith('Z') ? '' : 'Z'))
    : Date.parse(m.date);
  return Number.isNaN(raw) ? NaN : raw;
}

export function classifyTimeWindow(
  m: Pick<CricketMatchContext, 'status' | 'dateTimeGMT' | 'date'> & Partial<Pick<CricketMatchContext, 'matchEnded' | 'matchStarted'>>,
  now: Date,
  daysAhead = config.cricket.contextDaysAhead,
  marketingWindowHours = config.cricket.marketingWindowHours,
): TimeWindow {
  const isCompleted = isCompletedStatus(m.status, m.matchEnded);
  const instant = matchInstant(m);
  if (Number.isNaN(instant)) return 'outside_window';

  const { liveWindowMs, dayMs } = windowBounds(now);
  const t = now.getTime();

  // Live = provider says not completed AND the match has started (with a
  // buffer for match duration). A match hours in the FUTURE is not live.
  if (!isCompleted && instant <= t && t <= instant + liveWindowMs) return 'currently_live';

  // Well-past matches with empty status/flags (provider data gaps) are
  // completed in reality — never classified as future/live (live-data fix).
  if (!isCompleted && instant < t - liveWindowMs) return 'outside_window';
  if (isCompleted) {
    return t - instant <= dayMs ? 'recently_completed' : 'outside_window';
  }
  const localMidnight = new Date(t); localMidnight.setHours(0, 0, 0, 0);
  const tonightEnd = localMidnight.getTime() + dayMs;
  if (instant <= tonightEnd) return 'today';
  // Phase 3: 'tomorrow' is distinct from the generic 24h hot-window — a match
  // late today (23:00) vs early tomorrow (00:30) are different preparation
  // realities for a restaurant.
  if (instant <= tonightEnd + dayMs) return 'upcoming_tomorrow';
  if (instant <= t + marketingWindowHours * 3600_000) return 'upcoming_24_hours';
  if (instant <= t + daysAhead * dayMs) return 'upcoming_7_days';
  return 'outside_window';
}

// ─── Relevance + signals (spec §10/§12/§13) ──────────────────────

export type CricketRelevanceTier = 'high' | 'medium' | 'low' | 'irrelevant';

export type CricketSignalType =
  | 'INDIA_MATCH'
  | 'IPL_MATCH'
  | 'MAJOR_TOURNAMENT'
  | 'MATCH_TODAY'
  | 'MATCH_TOMORROW'
  | 'MATCH_PREPARATION_WINDOW'
  | 'MATCH_DURING_OPERATING_HOURS'
  | 'MATCH_DURING_DINNER'
  | 'MATCH_DURING_LUNCH'
  | 'MATCH_LIVE';

export interface CricketContextSignal {
  matchId: string;
  signalType: CricketSignalType;
  relevance: Exclude<CricketRelevanceTier, 'irrelevant'>;
  evidence: string[];
  generatedAt: string;
}

export interface RestaurantCricketContext {
  timezone?: string | null;
  operatingHours?: OperatingHours | null;
}

export interface EnrichedCricketMatch extends CricketMatchContext {
  competition: CricketCompetition;
  localDateTime?: string;
  timezone?: string;
  timeWindow: TimeWindow;
  operatingHoursOverlap: HoursOverlap;
  duringDinner: boolean;
  duringLunch: boolean;
  relevance: CricketRelevanceTier;
  signals: CricketContextSignal[];
}

const MAJOR_COMPETITIONS: ReadonlySet<CricketCompetition> = new Set(['world_cup', 'champions_trophy', 'asia_cup']);

/** Centralized deterministic scoring (spec §12). */
export function enrichMatch(
  m: CricketMatchContext,
  restaurant: RestaurantCricketContext | null,
  now: Date,
): EnrichedCricketMatch {
  const generatedAt = now.toISOString();
  const competition = classifyCompetition(m);
  const localTime = toRestaurantLocalTime(m.dateTimeGMT ?? undefined, restaurant?.timezone);
  const hours = classifyHoursOverlap(localTime, restaurant?.operatingHours ?? null);
  const timeWindow = classifyTimeWindow(m, now);
  const instant = matchInstant(m);
  const t = now.getTime();
  const isCompleted = isCompletedStatus(m.status, m.matchEnded);

  let score = 0;
  const evidence: string[] = [];

  if (m.isIndiaMatch) { score += 3; evidence.push('India is a participating team'); }
  if (competition === 'ipl') { score += 3; evidence.push('IPL match'); }
  else if (MAJOR_COMPETITIONS.has(competition)) { score += 3; evidence.push('Major international tournament'); }
  else if (competition === 'international') { score += 1; evidence.push('International fixture'); }
  if (m.matchType === 't20') { score += 1; evidence.push('T20 format (short, high-engagement)'); }

  if (timeWindow === 'currently_live') { score += 3; evidence.push('Match is live now'); }
  else if (timeWindow === 'today') { score += 2; evidence.push('Match is today'); }
  else if (timeWindow === 'upcoming_tomorrow') { score += 1; evidence.push('Match is tomorrow'); }
  else if (timeWindow === 'upcoming_24_hours') { score += 2; evidence.push('Match within 24 hours'); }
  else if (timeWindow === 'upcoming_7_days') { score += 1; }

  if (hours.overlap === 'match_during_operating_hours') { score += 2; evidence.push('Match falls within restaurant operating hours'); }
  else if (hours.overlap === 'match_outside_operating_hours') { score -= 2; evidence.push('Match falls outside restaurant operating hours'); }
  if (hours.duringDinner) { score += 2; evidence.push('Match starts during dinner hours'); }
  else if (hours.duringLunch) { score += 1; evidence.push('Match starts during lunch hours'); }
  if (localTime.fallbackUsed && restaurant?.timezone) {
    evidence.push(`Restaurant timezone '${restaurant.timezone}' unavailable — UTC used`);
  }

  // Guardrails (§13): in-window India/IPL matches never drop below 'low'.
  let relevance: CricketRelevanceTier;
  if (timeWindow === 'outside_window' || timeWindow === 'recently_completed') {
    relevance = 'irrelevant';
  } else if (score >= 7) relevance = 'high';
  else if (score >= 4) relevance = 'medium';
  else if (score >= 2) relevance = 'low';
  else if (m.isIndiaMatch || competition === 'ipl') relevance = 'low'; // anti-over-filtering floor
  else relevance = 'irrelevant';

  // Signals (§10) — evidence-based.
  const signals: CricketContextSignal[] = [];
  const push = (signalType: CricketSignalType, extra: string[] = []) => {
    signals.push({ matchId: m.externalId, signalType, relevance: relevance === 'irrelevant' ? 'low' : relevance, evidence: [...evidence, ...extra], generatedAt });
  };
  if (relevance !== 'irrelevant') {
    if (m.isIndiaMatch) push('INDIA_MATCH');
    if (competition === 'ipl') push('IPL_MATCH');
    if (MAJOR_COMPETITIONS.has(competition)) push('MAJOR_TOURNAMENT');
    if (timeWindow === 'currently_live') push('MATCH_LIVE');
    if (timeWindow === 'today') push('MATCH_TODAY');
    if (timeWindow === 'upcoming_tomorrow') push('MATCH_TOMORROW');
    // Preparation window (Phase 3 §3): fires inside the configurable prep
    // look-ahead (default 36h) for non-live, non-completed matches — the
    // period a restaurant can actually act on (stock, staffing, promos).
    if (
      timeWindow !== 'currently_live' &&
      !isCompleted &&
      instant > t &&
      instant - t <= config.cricket.preparationWindowHours * 3600_000
    ) {
      push('MATCH_PREPARATION_WINDOW', [`Preparation window open (match starts within ${config.cricket.preparationWindowHours}h)`]);
    }
    if (hours.overlap === 'match_during_operating_hours') push('MATCH_DURING_OPERATING_HOURS');
    if (hours.duringDinner) push('MATCH_DURING_DINNER');
    if (hours.duringLunch) push('MATCH_DURING_LUNCH');
  }

  return {
    ...m,
    competition,
    localDateTime: localTime.localDateTime,
    timezone: localTime.timezone,
    timeWindow,
    operatingHoursOverlap: hours.overlap,
    duringDinner: hours.duringDinner,
    duringLunch: hours.duringLunch,
    relevance,
    signals,
  };
}
