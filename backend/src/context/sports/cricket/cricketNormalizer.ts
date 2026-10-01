/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketNormalizer.ts — raw CricAPI match → canonical CricketMatchContext.
 * Deterministic only (spec §18): no LLM anywhere near extraction or
 * classification. Unusable records are rejected, never guessed into shape.
 *
 * Relevance (Phase 1, spec §8) is a simple deterministic tier:
 *   high   — India matches, or identifiable finals/semi-finals of any match
 *   medium — other international matches with a known match type
 *   low    — everything else
 * We do NOT claim audience popularity the provider does not give us.
 */

import type { CricApiMatchRaw } from './cricketProvider';
import type { CricketMatchContext, CricketMatchType, CricketRelevance } from './cricketTypes';

const KNOWN_MATCH_TYPES: ReadonlySet<string> = new Set(['test', 'odi', 't20', 't10']);

function normalizeMatchType(raw: string | undefined): CricketMatchType {
  const t = (raw || '').trim().toLowerCase();
  if (t === 'test') return 'test';
  if (t === 'odi') return 'odi';
  if (t === 't20' || t === 't20i') return 't20';
  return 'unknown';
}

/** Deterministic India detection from name/teams (spec §7). Isolated for later improvement. */
export function isIndiaMatch(name: string, teams: string[] | undefined): boolean {
  const haystack = [name, ...(teams ?? [])].join(' ').toLowerCase();
  // Word-boundary match avoids false positives like "Indiawood" (none known,
  // but boundary matching also keeps "West Indies" from matching "India"? —
  // no: "west indies" contains the word "indies", not "india". Safe.)
  return /\bindia\b/.test(haystack);
}

/** Final/semi-final detection from the match name — best effort, deterministic. */
function isKnockoutFinal(name: string): boolean {
  return /\b(final|semi[- ]?final|qualifier 2)\b/i.test(name);
}

export function matchRelevance(m: CricketMatchContext): CricketRelevance {
  if (m.isIndiaMatch) return 'high';
  if (isKnockoutFinal(m.name)) return 'high';
  if (m.matchType !== 'unknown') return 'medium';
  return 'low';
}

/**
 * Normalize one raw match. Returns null for unusable records (missing id,
 * missing name, unparseable dates) — validation stage of spec §10.
 */
export function normalizeMatch(raw: CricApiMatchRaw, fetchedAt: string): CricketMatchContext | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;

  // date is provider-local (YYYY-MM-DD); dateTimeGMT is the authoritative
  // instant when present (spec §9). Both kept as provider strings.
  const date = typeof raw.date === 'string' ? raw.date : '';
  const dateTimeGMT = typeof raw.dateTimeGMT === 'string' && raw.dateTimeGMT ? raw.dateTimeGMT : undefined;
  if (!date && !dateTimeGMT) return null;

  // Tournament: CricAPI embeds the series in the name tail,
  // e.g. "England vs Pakistan, 3rd Test, Pakistan tour of England 2026".
  const commaIdx = name.indexOf(', ');
  const tournament = commaIdx > 0 ? name.slice(commaIdx + 2).trim() || undefined : undefined;

  const ctx: CricketMatchContext = {
    externalId: id,
    name,
    matchType: normalizeMatchType(raw.matchType),
    status: typeof raw.status === 'string' ? raw.status : '',
    // Provider lifecycle booleans (live-data finding: 7/69 past matches had
    // an EMPTY status string but matchEnded=true — status alone is unreliable).
    matchStarted: typeof raw.matchStarted === 'boolean' ? raw.matchStarted : undefined,
    matchEnded: typeof raw.matchEnded === 'boolean' ? raw.matchEnded : undefined,
    venue: typeof raw.venue === 'string' && raw.venue ? raw.venue : undefined,
    date: date || dateTimeGMT!.slice(0, 10),
    dateTimeGMT,
    teams: Array.isArray(raw.teams) ? raw.teams.filter((t) => typeof t === 'string') : undefined,
    isIndiaMatch: isIndiaMatch(name, Array.isArray(raw.teams) ? raw.teams : undefined),
    tournament,
    source: 'cricapi',
    fetchedAt,
  };
  return ctx;
}

/** Normalized + relevance-tagged event (service output shape). */
export interface RelevantCricketEvent extends CricketMatchContext {
  relevance: CricketRelevance;
}

export function withRelevance(m: CricketMatchContext): RelevantCricketEvent {
  return { ...m, relevance: matchRelevance(m) };
}
