/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketCalendarSync.ts — persists upcoming cricket fixtures (IPL, India
 * matches, international series) into the admin Context Calendar as
 * `sports` events, so downstream consumers (offer engine, festival context,
 * calendar intelligence) read MongoDB instead of calling CricAPI per request.
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
import type { CricketMatchContext } from './cricketTypes';

const SYNC_TAG_PREFIX = 'cricapi:';
const SYNC_SOURCE_TAG = 'cricket-sync';

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
  /** Fixtures considered from the cricket service output. */
  considered: number;
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
  ranAt: string;
}

/**
 * Sync upcoming fixtures into the Context Calendar. Idempotent — safe to run
 * on every scheduler tick. Events are scope 'india' (cricket is nationwide
 * for this product), type 'sports', status 'active', source 'external'.
 */
export async function syncCricketEventsToCalendar(options: { daysAhead?: number } = {}): Promise<CricketCalendarSyncResult> {
  const ranAt = new Date().toISOString();

  const ctx = await getUpcomingCricketContext({ daysAhead: options.daysAhead ?? 14 });
  if (!ctx.available) {
    return {
      considered: 0,
      created: 0,
      updated: 0,
      archived: 0,
      dataStatus: 'unavailable',
      quotaState: ctx.quotaState
        ? {
            totalKeys: ctx.quotaState.totalKeys,
            blockedKeys: ctx.quotaState.blockedKeys,
            allBlocked: ctx.quotaState.allBlocked,
            cooldownMinutesRemaining: ctx.quotaState.cooldownMinutesRemaining,
          }
        : undefined,
      ranAt,
    };
  }

  const now = new Date();
  const considered = ctx.events;

  // Archive our own sync events whose start has passed (grace of 1 day for
  // live/ongoing matches). Only events this sync created are touched.
  const ourTagged = { $regex: `^${SYNC_TAG_PREFIX}` };
  const expired = await CalendarEvent.find({
    type: 'sports',
    source: 'external',
    tags: ourTagged,
    endDate: { $lt: new Date(now.getTime() - 86_400_000) },
    status: 'active',
  })
    .limit(200)
    .exec();
  let archived = 0;
  for (const ev of expired) {
    ev.status = 'archived';
    await ev.save();
    archived++;
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
        existing.name !== eventName(m);
      if (changed) {
        existing.name = eventName(m);
        existing.startDate = start;
        existing.endDate = end;
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

  console.log(
    `[cricket-calendar] sync considered=${considered.length} created=${created} updated=${updated} archived=${archived} dataStatus=${ctx.dataStatus ?? 'fresh'}${ctx.quotaState?.allBlocked ? ' quota=allBlocked' : ''}`,
  );

  return {
    considered: considered.length,
    created,
    updated,
    archived,
    dataStatus: ctx.dataStatus ?? 'fresh',
    ranAt,
  };
}

export const cricketCalendarSync = { syncCricketEventsToCalendar };
