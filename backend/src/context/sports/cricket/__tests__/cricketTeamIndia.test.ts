/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketTeamIndia.test.ts — acceptance tests for Team India fixture discovery
 * and the admin Context Calendar scope.
 *
 *  1. Classification: only the SENIOR India men's side qualifies. India A/B,
 *     India Women, India U19 and the domestic composite "Rest of India" do not
 *     (live evidence: those were the only "India" rows the /matches list had
 *     near "now", while the actual India tour was invisible to it).
 *  2. Discovery: a whole tour is enumerated through `/series` + `/series_info`
 *     in a few requests, with no /matches walk at all, and only fixtures inside
 *     the look-ahead window are returned.
 *  3. Calendar: Team India fixtures reach the Context Calendar with the right
 *     start instant even when the /matches walk finds nothing — the regression
 *     that left the calendar with zero India matches — and non-senior India
 *     fixtures never do.
 *  4. Cost: while every key is quota-blocked no provider request is spent.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../../config';
import { clearCricketKeyCooldowns, markCricketKeyQuotaBlocked } from '../cricketProvider';
import { isTeamIndiaMatch, isTeamIndiaSeries } from '../cricketNormalizer';
import { fetchTeamIndiaFixtures } from '../cricketIndiaSeries';
import { syncCricketEventsToCalendar } from '../cricketCalendarSync';
import CalendarEvent from '../../../../modules/calendar/models/CalendarEvent';
import { deleteCache } from '../../../../services/cacheService';

let mongod: MongoMemoryServer;

const TEST: { prevKey?: string; prevEnabled?: boolean; prevFallbacks?: string[] } = {};

const BASE = 'https://api.cricapi.com/v1';
const WI_SERIES_ID = '702ce6cb-a551-4aab-961e-0ed1548a3c74';
const A_SERIES_ID = '1db21cd4-5fe2-4a93-a67f-d6d4e65b2ca3';
const NZ_SERIES_ID = '9f0a2527-1508-42b3-9945-4ade13fd4b5a';

/** ISO date N days from now, at a fixed GMT time. */
function isoIn(days: number, time = '13:30:00'): string {
  return `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T${time}`;
}

/** Real provider shape for `/series` rows: camelCase dates, short end form. */
const SERIES_ROWS = [
  {
    id: WI_SERIES_ID,
    name: 'West Indies tour of India, 2026',
    startDate: '2026-09-27',
    endDate: 'Oct 17',
    odi: 3,
    t20: 5,
    test: 0,
    matches: 8,
  },
  // A-side tour of India: Indian cricket, but NOT Team India.
  { id: A_SERIES_ID, name: 'Australia A tour of India 2026', startDate: '2026-09-22', endDate: 'Oct 11', matches: 6 },
  // Women's tour: also not Team India.
  { id: 'womens-series', name: 'India Women tour of South Africa, 2026', startDate: '2026-12-09', endDate: 'Dec 30', matches: 7 },
  // Senior India tour that starts AFTER the window — must not be enumerated.
  { id: NZ_SERIES_ID, name: 'India tour of New Zealand 2026', startDate: '2099-10-22', endDate: '2099-12-01', matches: 9 },
] as const;

function matchRow(id: string, name: string, days: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    matchType: 't20',
    status: 'Match starts soon',
    venue: 'Wankhede Stadium, Mumbai',
    date: isoIn(days).slice(0, 10),
    dateTimeGMT: isoIn(days),
    teams: ['India', 'West Indies'],
    matchStarted: false,
    matchEnded: false,
    ...extra,
  };
}

/** The real tour: 4 finished internationals plus 4 upcoming ones. */
const WI_MATCHES = [
  matchRow('wi-1st-odi', 'India vs West Indies, 1st ODI, West Indies tour of India, 2026', -10),
  matchRow('wi-3rd-odi', 'India vs West Indies, 3rd ODI, West Indies tour of India, 2026', -4),
  matchRow('wi-1st-t20', 'India vs West Indies, 1st T20I, West Indies tour of India, 2026', -1),
  matchRow('wi-2nd-t20', 'India vs West Indies, 2nd T20I, West Indies tour of India, 2026', 2),
  matchRow('wi-3rd-t20', 'India vs West Indies, 3rd T20I, West Indies tour of India, 2026', 4),
  matchRow('wi-4th-t20', 'India vs West Indies, 4th T20I, West Indies tour of India, 2026', 7),
  matchRow('wi-5th-t20', 'India vs West Indies, 5th T20I, West Indies tour of India, 2026', 10),
  // Far outside the window — must not reach the calendar.
  matchRow('wi-far', 'India vs West Indies, Only Test, West Indies tour of India, 2026', 40),
  // A-side fixture mixed into an India series payload: still not Team India.
  matchRow('wi-a-side', 'India A vs Australia A, 2nd unofficial ODI, Australia A tour of India 2026', 3, {
    teams: ['India A', 'Australia A'],
  }),
];

function stubProvider(handlers: {
  matches?: (offset: number) => unknown[];
  series?: (offset: number) => unknown[];
}) {
  const spy = vi.fn(async (url: string) => {
    const u = String(url);
    const offset = parseInt(/offset=(\d+)/.exec(u)?.[1] ?? '0', 10);
    if (u.includes('/series_info')) {
      const id = /id=([^&]+)/.exec(u)?.[1];
      const list = id === WI_SERIES_ID ? WI_MATCHES : [];
      return { ok: true, status: 200, json: async () => ({ data: { info: { id }, matchList: list }, info: { hitsToday: 1 } }) };
    }
    if (u.includes('/series')) {
      return { ok: true, status: 200, json: async () => ({ data: handlers.series ? handlers.series(offset) : [], info: { totalRows: 1194 } }) };
    }
    if (u.includes('/matches')) {
      return { ok: true, status: 200, json: async () => ({ data: handlers.matches ? handlers.matches(offset) : [], info: { totalMatches: 0 } }) };
    }
    throw new Error(`unexpected provider path: ${u}`);
  });
  vi.stubGlobal('fetch', spy as unknown as typeof fetch);
  return spy;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  TEST.prevKey = config.cricket.apiKey;
  TEST.prevEnabled = config.cricket.enabled;
  TEST.prevFallbacks = [...config.cricket.fallbackApiKeys];
  config.cricket.apiKey = 'test-key-a';
  config.cricket.fallbackApiKeys = ['test-key-b'];
  config.cricket.enabled = true;
  clearCricketKeyCooldowns();
});

afterAll(async () => {
  config.cricket.apiKey = TEST.prevKey ?? '';
  config.cricket.enabled = TEST.prevEnabled ?? true;
  config.cricket.fallbackApiKeys = TEST.prevFallbacks ?? [];
  clearCricketKeyCooldowns();
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearCricketKeyCooldowns();
  await deleteCache('cricket_india_fixtures_cache');
  await deleteCache('cricket_context_cache');
  await CalendarEvent.deleteMany({});
});

// ─── 1. Classification ───────────────────────────────────────────

describe('senior Team India classification', () => {
  it('accepts the senior side and rejects every non-senior Indian side', () => {
    expect(isTeamIndiaMatch('India vs West Indies, 2nd T20I, West Indies tour of India, 2026', ['India', 'West Indies'])).toBe(true);
    expect(isTeamIndiaMatch('India vs Australia, 1st T20I', ['India', 'Australia'])).toBe(true);
    // Broad India detection stays true for these — they ARE India context.
    expect(isTeamIndiaMatch('India A vs Australia A, 2nd unofficial ODI, Australia A tour of India 2026', ['India A', 'Australia A'])).toBe(false);
    expect(isTeamIndiaMatch('India Women vs Sri Lanka Women, Final, Womens Asia Cup 2026', ['India Women', 'Sri Lanka Women'])).toBe(false);
    expect(isTeamIndiaMatch('India U19 vs Australia U19, 2nd unofficial Test, Australia U19 tour of India 2026', ['India U19', 'Australia U19'])).toBe(false);
    expect(isTeamIndiaMatch('Jammu and Kashmir vs Rest of India, Irani Cup, Irani Cup 2026', ['Jammu and Kashmir', 'Rest of India'])).toBe(false);
    expect(isTeamIndiaMatch('England vs Pakistan, 3rd Test', ['England', 'Pakistan'])).toBe(false);
  });

  it('accepts senior India series names only', () => {
    expect(isTeamIndiaSeries('West Indies tour of India, 2026')).toBe(true);
    expect(isTeamIndiaSeries('India tour of New Zealand 2026')).toBe(true);
    expect(isTeamIndiaSeries('Australia tour of India, 2027')).toBe(true);
    expect(isTeamIndiaSeries('Australia A tour of India 2026')).toBe(false);
    expect(isTeamIndiaSeries('India A tour of Nepal, 2026')).toBe(false);
    expect(isTeamIndiaSeries('India Women tour of South Africa, 2026')).toBe(false);
    expect(isTeamIndiaSeries('England Women U19 tour of India 2026')).toBe(false);
    expect(isTeamIndiaSeries('The Ashes 2027')).toBe(false);
  });
});

// ─── 2. Discovery via the series endpoints ───────────────────────

describe('Team India discovery through the series endpoints', () => {
  it('returns only in-window senior India fixtures, spending a handful of requests', async () => {
    const spy = stubProvider({ series: (offset) => (offset === 0 ? [...SERIES_ROWS] : []) });

    const out = await fetchTeamIndiaFixtures({ daysAhead: 14 });
    expect(out.available).toBe(true);
    expect(out.reason).toBe('ok');
    expect(out.dataStatus).toBe('fresh');

    // 3 upcoming-in-window fixtures: +2d, +4d and +7d... (+10d is in window too)
    const names = out.matches.map((m) => m.name);
    expect(names).toEqual([
      expect.stringContaining('2nd T20I'),
      expect.stringContaining('3rd T20I'),
      expect.stringContaining('4th T20I'),
      expect.stringContaining('5th T20I'),
    ]);
    expect(out.matches.every((m) => m.isTeamIndiaMatch)).toBe(true);
    // Finished + far-future + A-side fixtures are all excluded.
    expect(names.join(' ')).not.toContain('Only Test');
    expect(names.join(' ')).not.toContain('India A');
    expect(names.join(' ')).not.toContain('1st T20I');

    // Cost: series pages (2) + one series_info for the India tour. No /matches walk.
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/matches'))).toHaveLength(0);
    expect(urls.filter((u) => u.includes('/series_info'))).toEqual([expect.stringContaining(WI_SERIES_ID)]);
    expect(urls.filter((u) => u.includes('/series?'))).toHaveLength(2);
    expect(out.diagnostics?.seriesFetched).toBe(1);
  });

  it('never enumerates a non-senior or out-of-window series', async () => {
    const spy = stubProvider({ series: (offset) => (offset === 0 ? [...SERIES_ROWS] : []) });
    await fetchTeamIndiaFixtures({ daysAhead: 14 });
    const ids = spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/series_info'));
    expect(ids.join(' ')).not.toContain(A_SERIES_ID);
    expect(ids.join(' ')).not.toContain(NZ_SERIES_ID);
    expect(ids).toHaveLength(1);
  });

  it('serves the cached payload on a second call without spending a request', async () => {
    const spy = stubProvider({ series: (offset) => (offset === 0 ? [...SERIES_ROWS] : []) });
    await fetchTeamIndiaFixtures({ daysAhead: 14 });
    const callsAfterFirst = spy.mock.calls.length;
    const second = await fetchTeamIndiaFixtures({ daysAhead: 14 });
    expect(second.matches.length).toBe(4);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });
});

// ─── 3. Cost guard: a blocked pool costs nothing ─────────────────

describe('quota-aware cost guard', () => {
  it('spends no request while every key is blocked', async () => {
    markCricketKeyQuotaBlocked('test-key-a');
    markCricketKeyQuotaBlocked('test-key-b');
    const spy = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);

    const out = await fetchTeamIndiaFixtures({ daysAhead: 14 });
    expect(spy).not.toHaveBeenCalled();
    expect(out.available).toBe(false);
    expect(out.reason).toBe('provider_error');
    expect(out.quotaState?.allBlocked).toBe(true);
  });
});

// ─── 4. Calendar sync ────────────────────────────────────────────

describe('Team India fixtures in the admin Context Calendar', () => {
  it('writes the tour to the calendar even when the /matches walk finds nothing', async () => {
    stubProvider({
      matches: () => [], // the regression: the list walk yields no India fixture
      series: (offset) => (offset === 0 ? [...SERIES_ROWS] : []),
    });

    const run = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run.dataStatus).toBe('fresh');
    expect(run.teamIndia?.fixtures).toBe(4);
    expect(run.created).toBe(4);
    expect(run.considered).toBe(4);

    const docs = await CalendarEvent.find({ type: 'sports' }).sort({ startDate: 1 }).lean();
    expect(docs).toHaveLength(4);
    expect(docs[0]).toMatchObject({
      type: 'sports',
      scope: 'india',
      status: 'active',
      source: 'external',
      marketingRelevance: 'high',
    });
    expect(docs[0].name).toContain('India vs West Indies');
    expect(docs[0].tags).toContain('cricapi:wi-2nd-t20');

    // Dates are correct: the event starts at the fixture's GMT instant, and the
    // day the match is played is covered.
    const expectedStart = new Date(`${isoIn(2)}Z`);
    expect(docs[0].startDate.getTime()).toBe(expectedStart.getTime());
    expect(docs[0].endDate.getTime()).toBe(expectedStart.getTime() + 86_400_000);
    expect(docs[0].startDate.toISOString().slice(0, 10)).toBe(isoIn(2).slice(0, 10));
    // Strictly increasing fixture days, nearest first.
    const days = docs.map((d) => d.startDate.toISOString().slice(0, 10));
    expect([...days].sort()).toEqual(days);
    expect(days).toEqual([isoIn(2).slice(0, 10), isoIn(4).slice(0, 10), isoIn(7).slice(0, 10), isoIn(10).slice(0, 10)]);
  });

  it('is idempotent — a second sync updates instead of duplicating', async () => {
    stubProvider({ matches: () => [], series: (offset) => (offset === 0 ? [...SERIES_ROWS] : []) });
    await syncCricketEventsToCalendar({ daysAhead: 14 });
    await deleteCache('cricket_india_fixtures_cache'); // force a fresh provider read
    const run2 = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run2.created).toBe(0);
    expect(await CalendarEvent.countDocuments({ type: 'sports' })).toBe(4);
  });

  it('keeps non-senior India fixtures out of the calendar', async () => {
    stubProvider({
      matches: () => [
        matchRow('senior-1', 'India vs West Indies, 2nd T20I, West Indies tour of India, 2026', 3),
        matchRow('india-a-1', 'India A vs Australia A, 2nd unofficial ODI, Australia A tour of India 2026', 2, {
          teams: ['India A', 'Australia A'],
        }),
        matchRow('women-1', 'India Women vs Sri Lanka Women, Final, Womens Asia Cup 2026', 4, {
          teams: ['India Women', 'Sri Lanka Women'],
        }),
        matchRow('other-1', 'England vs Pakistan, 3rd Test, Pakistan tour of England 2026', 5, {
          teams: ['England', 'Pakistan'],
        }),
      ],
      series: () => [],
    });

    const run = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run.considered).toBe(1);
    expect(run.skipped).toBe(3);
    expect(run.created).toBe(1);

    const docs = await CalendarEvent.find({ type: 'sports' }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toContain('India vs West Indies');
    expect(docs[0].tags).toContain('cricapi:senior-1');
  });

  it('archives a previously synced India A fixture as out of scope', async () => {
    await CalendarEvent.create({
      name: 'India A vs Australia A, 2nd unofficial ODI, Australia A tour of India 2026',
      type: 'sports',
      startDate: new Date(Date.now() + 3 * 86_400_000),
      endDate: new Date(Date.now() + 4 * 86_400_000),
      scope: 'india',
      tags: ['cricket-sync', 'cricapi:legacy-india-a'],
      status: 'active',
      source: 'external',
    });

    stubProvider({ matches: () => [], series: () => [] });
    const run = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run.archived).toBe(1);
    const doc = await CalendarEvent.findOne({ tags: 'cricapi:legacy-india-a' }).lean();
    expect(doc?.status).toBe('archived');
  });
});
