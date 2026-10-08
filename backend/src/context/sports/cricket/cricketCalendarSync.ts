/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketCalendarSync.ts — persists upcoming cricket fixtures into the admin
 * Context Calendar as `sports` events, so downstream consumers (offer engine,
 * festival context, calendar intelligence) read MongoDB instead of calling
 * CricAPI per request.
 *
 * Calendar scope: ONLY Indian Premier League matches and SENIOR Team India
 * matches (the "original" national side) are written to the Context Calendar.
 * India A / India Women / India U19 and the domestic composite "Rest of India"
 * are Indian cricket but not Team India, so they are excluded — see
 * `isTeamIndiaMatch`. Other international/domestic series remain available
 * through the Cricket Context service but do not clutter the admin planning
 * surface. Fixtures that fall outside this scope (including ones synced before
 * the scope narrowed) are archived, never deleted.
 *
 * Sources (merged, deduped by provider match id):
 *   - the general Cricket Context list (`/matches`, paginated), and
 *   - Team India tour discovery (`/series` + `/series_info`), which is what
 *     actually reaches a live India tour: `/matches` slices 15k+ rows by row
 *     offset and a real 300-row scan found no senior India fixture, while the
 *     series endpoints return a whole tour in one request.
 *
 * Cost model:
 *   - CricAPI is hit ONLY by the interval refresh (or an explicit sync);
 *     per-request reads (offer engine, agent tools) touch MongoDB only.
 *   - The quota-aware service further skips refreshes while every key is
 *     quota-blocked, so no requests are spent on a pool that cannot answer.
 *
 * Dedup contract: one CalendarEvent per match, identified by
 * tags containing `cricapi:<externalId>`. Re-runs upsert (dates/status)
 * instead of duplicating; matches older than the cutoff are archived,
 * never deleted (the calendar is recoverable by design).
 */

import CalendarEvent from '../../../modules/calendar/models/CalendarEvent';
import { invalidateCalendarIntelligence } from '../../../modules/calendar/services/calendarSignalEngine';
import { getUpcomingCricketContext } from './cricketService';
import { fetchTeamIndiaFixtures, type IndiaSeriesDiagnostics } from './cricketIndiaSeries';
import { classifyCompetition } from './cricketRelevance';
import { isTeamIndiaMatch } from './cricketNormalizer';
import type { CricketMatchContext } from './cricketTypes';

const SYNC_TAG_PREFIX = 'cricapi:';
const SYNC_SOURCE_TAG = 'cricket-sync';
const GRACE_MS = 86_400_000;

/**
 * Context Calendar scope: only fixtures a restaurant can realistically plan
 * around — Indian Premier League matches and SENIOR Team India matches.
 * India A / Women / U19 fixtures are India context but not Team India, so they
 * are excluded (they would otherwise enter as high-relevance "India" events and
 * drive India-Match-Special offers for a side Team India is not playing).
 * Everything else (other international/domestic series) stays in the Cricket
 * Context service but is not written into the admin calendar.
 */
export function isCalendarScopeFixture(
  m: Pick<CricketMatchContext, 'name' | 'tournament' | 'matchType' | 'teams' | 'isTeamIndiaMatch'>,
): boolean {
  if (m.isTeamIndiaMatch) return true;
  return classifyCompetition(m) === 'ipl';
}

/**
 * Name-based equivalent for events already persisted by earlier syncs: a
 * CalendarEvent stores the full match name (which carries the series tail),
 * so the same IPL/Team-India rule can be re-applied without the raw context.
 */
export function isCalendarScopeEventName(name: string): boolean {
  if (isTeamIndiaMatch(name, undefined)) return true;
  return classifyCompetition({ name, tournament: undefined, matchType: 'unknown', teams: undefined }) === 'ipl';
}

function matchStart(m: CricketMatchContext): Date {
  const instant = m.dateTimeGMT ? Date.parse(`${m.dateTimeGMT}Z`) : Date.parse(m.date);
  return new Date(Number.isNaN(instant) ? Date.parse(`${m.date}T00:00:00Z`) : instant);
}

/** Marketing relevance mirrors the deterministic cricket relevance tier. */
function relevanceFor(m: CricketMatchContext): 'low' | 'medium' | 'high' {
  if (m.isIndiaMatch) return 'high';
  if (m.matchType !== 'unknown') return 'medium';
  return 'low';
}

/** A stable event name — match name already includes the series tail. */
function eventName(m: CricketMatchContext): string {
  return m.name.slice(0, 200);
}

export interface CricketCalendarSyncResult {
  /** In-scope fixtures (IPL/Team India) considered for the Context Calendar. */
  considered: number;
  /** Upcoming fixtures dropped because they are outside the calendar scope. */
  skipped: number;
  created: number;
  updated: number;
  archived: number;
  /** 'fresh' when the provider served current data; 'stale' from cache fallback. */
  dataStatus: 'fresh' | 'stale' | 'unavailable';
  /** Quota state surfaced by the cricket service when it affected the sync. */
  quotaState?: {
    totalKeys: number;
    blockedKeys: number;
    allBlocked: boolean;
    cooldownMinutesRemaining: number | null;
  };
  /** Senior Team India fixtures found through the series endpoints. */
  teamIndia?: {
    available: boolean;
    reason: string;
    dataStatus: 'fresh' | 'stale';
    /** Senior India fixtures inside the window (before scope filtering). */
    fixtures: number;
    diagnostics?: IndiaSeriesDiagnostics;
  };
  ranAt: string;
}

/** One fixture per provider match id — the series path and the list path see
 *  the same match, and the calendar must hold it once. */
function dedupeById(matches: CricketMatchContext[]): CricketMatchContext[] {
  const seen = new Set<string>();
  const out: CricketMatchContext[] = [];
  for (const m of matches) {
    if (seen.has(m.externalId)) continue;
    seen.add(m.externalId);
    out.push(m);
  }
  return out;
}

/**
 * Sync upcoming fixtures into the Context Calendar. Idempotent — safe to run
 * on every scheduler tick. Events are scope 'india' (cricket is nationwide
 * for this product), type 'sports', status 'active', source 'external'.
 */
export async function syncCricketEventsToCalendar(options: { daysAhead?: number } = {}): Promise<CricketCalendarSyncResult> {
  const ranAt = new Date().toISOString();

  const daysAhead = options.daysAhead ?? 14;
  // Two sources, merged: the general cricket context list, plus Team India tour
  // discovery through the series endpoints (the only one that reliably reaches
  // a live India tour — see the module header).
  const ctx = await getUpcomingCricketContext({ daysAhead });
  const teamIndia = await fetchTeamIndiaFixtures({ daysAhead });

  const sourceMatches = dedupeById([
    ...(ctx.available ? ctx.events : []),
    ...teamIndia.matches,
  ]);

  const quota = ctx.quotaState ?? teamIndia.quotaState;
  const quotaSummary = quota
    ? {
        totalKeys: quota.totalKeys,
        blockedKeys: quota.blockedKeys,
        allBlocked: quota.allBlocked,
        cooldownMinutesRemaining: quota.cooldownMinutesRemaining,
      }
    : undefined;
  const teamIndiaSummary: NonNullable<CricketCalendarSyncResult['teamIndia']> = {
    available: teamIndia.available,
    reason: teamIndia.reason,
    dataStatus: teamIndia.dataStatus,
    fixtures: teamIndia.matches.length,
    diagnostics: teamIndia.diagnostics,
  };

  // Neither source could answer: nothing to sync, and nothing to archive from.
  if (!ctx.available && !teamIndia.available) {
    return {
      considered: 0,
      skipped: 0,
      created: 0,
      updated: 0,
      archived: 0,
      dataStatus: 'unavailable',
      quotaState: quotaSummary,
      teamIndia: teamIndiaSummary,
      ranAt,
    };
  }

  const now = new Date();
  // Only IPL fixtures and SENIOR Team India matches enter the Context Calendar.
  const considered = sourceMatches.filter(isCalendarScopeFixture);
  const skipped = sourceMatches.length - considered.length;

  // Housekeeping on our own events only (tags `cricapi:*`, source external):
  //   - end has passed (1-day grace for live/ongoing matches), or
  //   - the fixture is outside the IPL/Team-India calendar scope (archives
  //     events an earlier, broader sync had written).
  // Archived, never deleted — the calendar stays recoverable by design.
  const ourTagged = { $regex: `^${SYNC_TAG_PREFIX}` };
  const ours = await CalendarEvent.find({
    type: 'sports',
    source: 'external',
    tags: ourTagged,
    status: 'active',
  })
    .limit(500)
    .exec();
  let archived = 0;
  for (const ev of ours) {
    const ended = ev.endDate.getTime() < now.getTime() - GRACE_MS;
    if (ended || !isCalendarScopeEventName(ev.name)) {
      ev.status = 'archived';
      await ev.save();
      archived++;
    }
  }

  let created = 0;
  let updated = 0;
  for (const m of considered) {
    const tag = `${SYNC_TAG_PREFIX}${m.externalId}`;
    const start = matchStart(m);
    // Matches are single-day events for marketing purposes (start day),
    // padded to the next midnight so 'active' phase covers the match day.
    const end = new Date(start.getTime() + 86_400_000);

    const existing = await CalendarEvent.findOne({ tags: tag }).exec();
    if (existing) {
      const changed =
        existing.startDate.getTime() !== start.getTime() ||
        existing.name !== eventName(m) ||
        existing.status !== 'active';
      if (changed) {
        existing.name = eventName(m);
        existing.startDate = start;
        existing.endDate = end;
        existing.status = 'active';
        existing.marketingRelevance = relevanceFor(m);
        existing.description = `Cricket fixture synced from CricAPI. Status: ${m.status || 'unknown'}. Venue: ${m.venue || 'unknown'}.`;
        await existing.save();
        updated++;
      }
      continue;
    }

    await CalendarEvent.create({
      name: eventName(m),
      type: 'sports',
      startDate: start,
      endDate: end,
      scope: 'india',
      description: `Cricket fixture synced from CricAPI. Status: ${m.status || 'unknown'}. Venue: ${m.venue || 'unknown'}.`,
      tags: [SYNC_SOURCE_TAG, tag],
      marketingRelevance: relevanceFor(m),
      preparationWindowDays: 1,
      status: 'active',
      source: 'external',
    });
    created++;
  }

  if (created > 0 || updated > 0 || archived > 0) {
    invalidateCalendarIntelligence();
  }

  // 'fresh' when either source served current data; 'stale' only when the data
  // that produced this sync came from cache fallback.
  const dataStatus: CricketCalendarSyncResult['dataStatus'] =
    ctx.dataStatus === 'fresh' || teamIndia.dataStatus === 'fresh' ? 'fresh' : 'stale';

  console.log(
    `[cricket-calendar] sync scope=ipl+team-india considered=${considered.length} skipped=${skipped} created=${created} updated=${updated} archived=${archived} teamIndia=${teamIndiaSummary.fixtures} dataStatus=${dataStatus}${quota?.allBlocked ? ' quota=allBlocked' : ''}`,
  );

  return {
    considered: considered.length,
    skipped,
    created,
    updated,
    archived,
    dataStatus,
    quotaState: quotaSummary,
    teamIndia: teamIndiaSummary,
    ranAt,
  };
}

export const cricketCalendarSync = { syncCricketEventsToCalendar };
