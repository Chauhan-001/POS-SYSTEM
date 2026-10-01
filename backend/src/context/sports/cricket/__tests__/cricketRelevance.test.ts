/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cricket Phase 2 — Relevance Engine acceptance tests (spec §23):
 * India detection, competition classification, time conversion, operating
 * hours, relevance tiers, anti-over-filtering, stale marking, tenant
 * isolation, tool output. LLM-free by construction.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../../config';
import {
  classifyCompetition, toRestaurantLocalTime, classifyHoursOverlap,
  classifyTimeWindow, enrichMatch,
} from '../cricketRelevance';
import { normalizeMatch } from '../cricketNormalizer';
import { getUpcomingCricketContext } from '../cricketService';
import { executeGetSportsContext } from '../../../../ai/tools/context/getSportsContextTool';
import { ai } from '../../../../ai';

let mongod: MongoMemoryServer;

const NOW = new Date('2026-10-05T12:00:00Z');
function fetched(): string { return NOW.toISOString(); }

function match(partial: Record<string, unknown>) {
  const base = {
    id: 'm1',
    name: 'India vs Australia, 2nd T20I, Australia tour of India 2026',
    matchType: 't20',
    status: 'Match not started',
    date: NOW.toISOString().slice(0, 10),
    dateTimeGMT: '2026-10-05T14:30:00',
    teams: ['India', 'Australia'],
  };
  const raw = { ...base, ...partial };
  const m = normalizeMatch(raw, fetched());
  if (!m) throw new Error('normalizeMatch returned null');
  return m;
}

function apiResponse(matches: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ data: matches, info: { totalMatches: matches.length } }),
  };
}

const INDIA_T20 = {
  id: 'm-ind',
  name: 'India vs Australia, 2nd T20I, Australia tour of India 2026',
  matchType: 't20', status: 'Match not started',
  date: '2026-10-06', dateTimeGMT: '2026-10-06T14:30:00', // 20:00 IST
  teams: ['India', 'Australia'],
};
const IPL_MATCH = {
  id: 'm-ipl',
  name: 'Mumbai Indians vs Chennai Super Kings, 32rd Match, Indian Premier League 2026',
  matchType: 't20', status: 'Match not started',
  date: '2026-10-07', dateTimeGMT: '2026-10-07T14:00:00', // 19:30 IST
  teams: ['Mumbai Indians', 'Chennai Super Kings'],
};
const OLD_COMPLETED = {
  id: 'm-old',
  name: 'England vs Pakistan, 3rd Test, Pakistan tour of England 2026',
  matchType: 'test', status: 'England won by 8 wickets',
  date: '2026-09-09', dateTimeGMT: '2026-09-09T10:00:00',
  teams: ['England', 'Pakistan'],
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.AI_PROVIDER = 'gemini';
  config.ai.provider = 'gemini';
  config.ai.apiKey = 'test-key';
  config.cricket.apiKey = 'test-cricket-key';
  config.cricket.enabled = true;
  ai.bootstrap();
});

afterAll(async () => {
  config.ai.apiKey = '';
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── India detection (§5) ─────────────────────────────────────────

describe('India detection', () => {
  it('India vs Australia → isIndiaMatch = true (from teams)', () => {
    expect(match({}).isIndiaMatch).toBe(true);
  });
  it('Australia vs England → isIndiaMatch = false', () => {
    expect(match({ id: 'm2', name: 'Australia vs England, 1st ODI', matchType: 'odi', teams: ['Australia', 'England'] }).isIndiaMatch).toBe(false);
  });
  it('venue in India does NOT imply India match', () => {
    const m = match({ id: 'm3', name: 'England vs Pakistan, 3rd T20I', venue: 'Wankhede Stadium, Mumbai', teams: ['England', 'Pakistan'] });
    expect(m.isIndiaMatch).toBe(false);
  });
});

// ─── Competition classification (§4) ──────────────────────────────

describe('competition classification', () => {
  it('IPL by series name → ipl (not because teams are Indian)', () => {
    expect(classifyCompetition(match(IPL_MATCH))).toBe('ipl');
    // Indian teams but NOT IPL → international
    expect(classifyCompetition(match({}))).toBe('international');
  });
  it('World Cup / Champions Trophy / Asia Cup classify', () => {
    expect(classifyCompetition(match({ id: 'w1', name: 'India vs Pakistan, Final, ICC Mens T20 World Cup 2026' }))).toBe('world_cup');
    expect(classifyCompetition(match({ id: 'w2', name: 'India vs SL, 3rd ODI, ICC Champions Trophy 2026' }))).toBe('champions_trophy');
    expect(classifyCompetition(match({ id: 'w3', name: 'India vs Pak, Super 4, Asia Cup 2026' }))).toBe('asia_cup');
  });
  it('domestic + unknown classify without crashing', () => {
    expect(classifyCompetition(match({ id: 'd1', name: 'Mumbai vs Delhi, Ranji Trophy 2026', matchType: 'unknown', teams: ['Mumbai', 'Delhi'] }))).toBe('domestic');
    expect(classifyCompetition(match({ id: 'u1', name: 'Mystery XI vs Unknown XI', matchType: 'unknown', teams: ['Mystery XI', 'Unknown XI'] }))).toBe('unknown');
  });
});

// ─── Time conversion (§7) ─────────────────────────────────────────

describe('restaurant-local time', () => {
  it('dateTimeGMT → Asia/Kolkata local time', () => {
    const out = toRestaurantLocalTime('2026-10-06T14:30:00', 'Asia/Kolkata');
    expect(out.localDateTime).toBe('2026-10-06T20:00'); // 20:00 IST
    expect(out.timezone).toBe('Asia/Kolkata');
    expect(out.fallbackUsed).toBe(false);
  });
  it('invalid/missing timezone → explicit UTC fallback, never silent', () => {
    const out = toRestaurantLocalTime('2026-10-06T14:30:00', 'Mars/Olympus');
    expect(out.timezone).toBe('UTC');
    expect(out.fallbackUsed).toBe(true);
    expect(out.localDateTime).toBe('2026-10-06T14:30');
  });
});

// ─── Operating hours (§8) ─────────────────────────────────────────

describe('operating-hours overlap', () => {
  const dinner = toRestaurantLocalTime('2026-10-06T14:30:00', 'Asia/Kolkata'); // 20:00
  const lunch = toRestaurantLocalTime('2026-10-06T06:30:00', 'Asia/Kolkata');  // 12:00
  const late = toRestaurantLocalTime('2026-10-06T21:30:00', 'Asia/Kolkata');   // 03:00 IST

  it('match during dinner hours', () => {
    const out = classifyHoursOverlap(dinner, { openTime: '11:00', closeTime: '23:00' });
    expect(out.overlap).toBe('match_during_operating_hours');
    expect(out.duringDinner).toBe(true);
    expect(out.duringLunch).toBe(false);
  });
  it('match during lunch hours', () => {
    const out = classifyHoursOverlap(lunch, { openTime: '11:00', closeTime: '23:00' });
    expect(out.duringLunch).toBe(true);
    expect(out.duringDinner).toBe(false);
  });
  it('match outside operating hours', () => {
    const out = classifyHoursOverlap(late, { openTime: '11:00', closeTime: '23:00' });
    expect(out.overlap).toBe('match_outside_operating_hours');
  });
  it('unknown hours → unknown, never guessed', () => {
    expect(classifyHoursOverlap(dinner, null).overlap).toBe('unknown');
    expect(classifyHoursOverlap(dinner, { openTime: 'bad', closeTime: '23:00' }).overlap).toBe('unknown');
  });
});

// ─── Relevance (§12/§13) + windows (§9) ───────────────────────────

describe('relevance engine', () => {
  it('India + dinner → high with INDIA_MATCH + MATCH_DURING_DINNER signals', () => {
    const enriched = enrichMatch(match(INDIA_T20), { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.relevance).toBe('high');
    expect(enriched.localDateTime).toBe('2026-10-06T20:00');
    const types = enriched.signals.map((s) => s.signalType);
    expect(types).toContain('INDIA_MATCH');
    expect(types).toContain('MATCH_DURING_DINNER');
    expect(enriched.signals.every((s) => s.evidence.length > 0)).toBe(true);
  });

  it('same-day match → MATCH_TODAY signal', () => {
    const today = match({ id: 'm-today', name: 'India vs England, 3rd T20I', date: '2026-10-05', dateTimeGMT: '2026-10-05T15:00:00' });
    const enriched = enrichMatch(today, { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.timeWindow).toBe('today');
    expect(enriched.signals.map((s) => s.signalType)).toContain('MATCH_TODAY');
  });

  it('IPL match with NO India team and NO hours data stays relevant (§13 anti-over-filtering)', () => {
    const enriched = enrichMatch(match(IPL_MATCH), { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.competition).toBe('ipl');
    expect(enriched.relevance).not.toBe('irrelevant');
    expect(enriched.signals.map((s) => s.signalType)).toContain('IPL_MATCH');
    expect(enriched.operatingHoursOverlap).toBe('unknown'); // explicit, not guessed
  });

  it('India match at 3 AM local (outside hours) → lower relevance but still visible', () => {
    const lateNight = match({
      id: 'm-late', name: 'India vs England, 1st T20I', date: '2026-10-07', dateTimeGMT: '2026-10-07T21:30:00', teams: ['India', 'England'],
    });
    const enriched = enrichMatch(lateNight, { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.relevance).not.toBe('high');
    expect(enriched.relevance).not.toBe('irrelevant'); // India floor
  });

  it('old completed match → irrelevant / excluded', () => {
    const enriched = enrichMatch(match(OLD_COMPLETED), { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.relevance).toBe('irrelevant');
    expect(enriched.signals).toHaveLength(0);
  });

  it('far-future match → outside_window → irrelevant', () => {
    const far = match({ id: 'm-far', name: 'India vs Sri Lanka, 1st ODI', matchType: 'odi', date: '2026-12-20', dateTimeGMT: '2026-12-20T09:30:00' });
    expect(classifyTimeWindow(far, NOW)).toBe('outside_window');
    expect(enrichMatch(far, null, NOW).relevance).toBe('irrelevant');
  });

  it('live match gets MATCH_LIVE signal', () => {
    const live = match({ id: 'm-live', name: 'India vs South Africa, 2nd T20I', date: '2026-10-05', dateTimeGMT: '2026-10-05T11:00:00', status: '1st innings' });
    const enriched = enrichMatch(live, { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.timeWindow).toBe('currently_live');
    expect(enriched.signals.map((s) => s.signalType)).toContain('MATCH_LIVE');
  });

  it('time windows are config-driven (§9)', () => {
    const prevDays = config.cricket.contextDaysAhead;
    const prevHours = config.cricket.marketingWindowHours;
    try {
      config.cricket.contextDaysAhead = 2;
      config.cricket.marketingWindowHours = 6;
      const in3Days = match({ id: 'm-3d', name: 'India vs Zimbabwe, 1st T20I', date: '2026-10-08', dateTimeGMT: '2026-10-08T09:30:00' });
      expect(classifyTimeWindow(in3Days, NOW)).toBe('outside_window');
      config.cricket.contextDaysAhead = 7;
      expect(classifyTimeWindow(in3Days, NOW)).toBe('upcoming_7_days');
    } finally {
      config.cricket.contextDaysAhead = prevDays;
      config.cricket.marketingWindowHours = prevHours;
    }
  });
});

// ─── Service: stale marking + tenant timezone (§16) ───────────────

describe('service staleness + tenant isolation', () => {
  it('provider failure serves stale cache labeled dataStatus=stale, providerAvailable=false', async () => {
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');

    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_T20, IPL_MATCH, OLD_COMPLETED])) as unknown as typeof fetch);
    const first = await getUpcomingCricketContext({ now: NOW, restaurantId: R1 });
    expect(first.dataStatus).toBe('fresh');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    const { deleteCache: del } = await import('../../../../services/cacheService');
    await del('cricket_context_cache');
    const stale = await getUpcomingCricketContext({ now: NOW, restaurantId: R1 });
    expect(stale.available).toBe(true);
    expect(stale.dataStatus).toBe('stale');
    expect(stale.providerAvailable).toBe(false);
    expect(stale.lastFetchedAt).toBeTruthy();
  });
});

const R1 = '507f1f77bcf86cd799439011';
const R2_OID = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');

// ─── Tool (§23 tool tests) ────────────────────────────────────────

describe('getSportsContext tool (Phase 2)', () => {
  it('returns relevantMatches with local time from the restaurant record; key never leaks', async () => {
    const Restaurant = mongoose.model('Restaurant');
    await Restaurant.syncIndexes().catch(() => undefined);
    await Restaurant.findByIdAndUpdate(
      R1,
      { $set: { timezone: 'Asia/Kolkata' } },
      { upsert: true, new: true },
    ).catch(() => undefined);

    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_T20, IPL_MATCH, OLD_COMPLETED])) as unknown as typeof fetch);

    const out = await executeGetSportsContext({}, { tenant: { restaurantId: R1 } });
    expect(out.available).toBe(true);
    expect(out.relevantMatches).toBeDefined();

    const india = out.relevantMatches!.find((m) => m.isIndiaMatch);
    expect(india).toBeDefined();
    expect(india!.competition).toBe('international');
    expect(india!.localDateTime).toBe('2026-10-06T20:00'); // restaurant record timezone
    expect(india!.signals).toContain('INDIA_MATCH');
    expect(india!.signals).toContain('MATCH_DURING_DINNER');
    expect(out.relevantMatches!.some((m) => m.competition === 'ipl')).toBe(true);
    expect(out.relevantMatches!.every((m) => m.name !== OLD_COMPLETED.name)).toBe(true); // old match excluded
    expect(JSON.stringify(out)).not.toContain('test-cricket-key');
    expect(JSON.stringify(out)).not.toContain('cricapi.com');
  });
});
