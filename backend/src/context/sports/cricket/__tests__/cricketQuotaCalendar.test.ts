/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketQuotaCalendar.test.ts — cost-guard acceptance tests:
 *
 *  1. Quota-aware caching: while EVERY CricAPI key is quota-blocked the
 *     service does not spend a single provider request; it serves stale
 *     cache (or honest unavailability) and surfaces the quota state.
 *  2. getSportsContext output exposes quotaState (counts + cooldown only —
 *     never key material).
 *  3. Calendar sync persists fixtures as deduped Context Calendar events
 *     and is idempotent across runs.
 *  4. The sports offer provider reads ctx.sportsEvents (Mongo-loaded)
 *     and never calls the sports provider — zero marginal API cost.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../../config';
import {
  getCricketKeyQuotaState,
  markCricketKeyQuotaBlocked,
  markCricketKeyInvalid,
  clearCricketKeyCooldowns,
  getMatches,
} from '../cricketProvider';
import { getUpcomingCricketContext } from '../cricketService';
import { syncCricketEventsToCalendar } from '../cricketCalendarSync';
import { executeGetSportsContext } from '../../../../ai/tools/context/getSportsContextTool';
import { SportsCalendarRecommendationProvider } from '../../../../services/offerEngine';
import type { RecommendationContext } from '../../../../services/offerEngine';
import CalendarEvent from '../../../../modules/calendar/models/CalendarEvent';

let mongod: MongoMemoryServer;

const TEST: { prevKey?: string; prevEnabled?: boolean; prevFallbacks?: string[] } = {};

function apiResponse(matches: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, json: async () => ({ data: matches, info: { totalMatches: matches.length } }) };
}

const RAW_INDIA: Record<string, unknown> = {
  id: 'quota-cal-001',
  name: 'India vs Australia, 1st T20I, Australia tour of India 2026',
  matchType: 't20',
  status: 'Match not started',
  venue: 'Wankhede Stadium, Mumbai',
  // Relative dates so the fixture stays "upcoming" whenever the suite runs.
  date: '',
  dateTimeGMT: '',
  teams: ['India', 'Australia'],
};

function setRelativeDate(daysAhead = 7): void {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const iso = d.toISOString();
  RAW_INDIA.date = iso.slice(0, 10);
  RAW_INDIA.dateTimeGMT = `${iso.slice(0, 10)}T14:00:00`;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  TEST.prevKey = config.cricket.apiKey;
  TEST.prevEnabled = config.cricket.enabled;
  TEST.prevFallbacks = [...config.cricket.fallbackApiKeys];
  config.cricket.apiKey = 'test-key-a';
  config.cricket.fallbackApiKeys = ['test-key-b', 'test-key-c'];
  config.cricket.enabled = true;
  clearCricketKeyCooldowns();
  setRelativeDate();
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
  setRelativeDate();
  const { deleteCache } = await import('../../../../services/cacheService');
  await deleteCache('cricket_context_cache');
  await CalendarEvent.deleteMany({});
});

// ─── 1. Quota state (provider) ───────────────────────────────────

describe('cricket quota state', () => {
  it('reports pool counts, allBlocked, and cooldown without leaking key material', () => {
    const fresh = getCricketKeyQuotaState();
    expect(fresh).toMatchObject({ totalKeys: 3, blockedKeys: 0, allBlocked: false, nextRetryAt: null });

    markCricketKeyQuotaBlocked('test-key-a');
    const partial = getCricketKeyQuotaState();
    expect(partial).toMatchObject({ blockedKeys: 1, allBlocked: false });
    expect(partial.cooldownMinutesRemaining).toBeGreaterThan(0);

    markCricketKeyQuotaBlocked('test-key-b');
    markCricketKeyQuotaBlocked('test-key-c');
    const all = getCricketKeyQuotaState();
    expect(all).toMatchObject({ blockedKeys: 3, allBlocked: true });
    expect(JSON.stringify(all)).not.toContain('test-key');
  });

  it('gives rejected (invalid) keys a long cooldown — rotation stops probing dead keys', () => {
    markCricketKeyInvalid('test-key-b');
    const s = getCricketKeyQuotaState();
    expect(s.blockedKeys).toBe(1);
    expect(s.allBlocked).toBe(false);
    // 24h dead-key block vs the ~16m quota cooldown
    expect(s.cooldownMinutesRemaining).toBeGreaterThan(60 * 12);
  });

  it('classifies "Invalid API Key" as invalid_key (distinct from quota block)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'failure', reason: 'Invalid API Key' }),
    })) as unknown as typeof fetch);
    await expect(
      getMatches({ baseUrl: 'https://api.cricapi.com/v1', apiKey: 'x', fallbackApiKeys: [], timeoutMs: 1000 }, 0),
    ).rejects.toMatchObject({ kind: 'invalid_key' });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'failure', reason: 'Blocked for 15 minutes' }),
    })) as unknown as typeof fetch);
    await expect(
      getMatches({ baseUrl: 'https://api.cricapi.com/v1', apiKey: 'x', fallbackApiKeys: [], timeoutMs: 1000 }, 0),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});

// ─── 2. Quota-aware refresh throttling (service) ─────────────────

describe('quota-aware caching', () => {
  it('does NOT call the provider while all keys are blocked and no cache exists', async () => {
    markCricketKeyQuotaBlocked('test-key-a');
    markCricketKeyQuotaBlocked('test-key-b');
    markCricketKeyQuotaBlocked('test-key-c');

    const fetchSpy = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const out = await getUpcomingCricketContext({});
    expect(fetchSpy).not.toHaveBeenCalled(); // cost guard: zero requests spent
    expect(out.available).toBe(false);
    expect(out.reason).toBe('provider_error');
    expect(out.quotaState?.allBlocked).toBe(true);
    expect(out.quotaState?.totalKeys).toBe(3);
  });

  it('reports the POST-refresh quota snapshot after a failed rotation', async () => {
    // Pool healthy at first (fresh cooldowns), but the provider blocks all keys.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'failure', reason: 'Blocked for 15 minutes' }),
    })) as unknown as typeof fetch);

    const out = await getUpcomingCricketContext({});
    expect(out.available).toBe(false);
    // Keys were marked DURING rotation — the snapshot must reflect that,
    // not the pre-fetch state (blockedKeys: 0 would lie).
    expect(out.quotaState?.blockedKeys).toBe(3);
    expect(out.quotaState?.allBlocked).toBe(true);
    expect(out.quotaState?.cooldownMinutesRemaining).toBeGreaterThan(0);
  });

  it('serves stale cache while blocked (dataStatus stale, no provider call)', async () => {
    // Seed a good payload first (pool healthy).
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([RAW_INDIA])) as unknown as typeof fetch);
    const first = await getUpcomingCricketContext({});
    expect(first.available).toBe(true);
    expect(first.events).toHaveLength(1);

    // Expire the cache, block the whole pool, and make fetch explode.
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    markCricketKeyQuotaBlocked('test-key-a');
    markCricketKeyQuotaBlocked('test-key-b');
    markCricketKeyQuotaBlocked('test-key-c');
    const fetchSpy = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const out = await getUpcomingCricketContext({});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.available).toBe(true);        // stale beats empty
    expect(out.dataStatus).toBe('stale');    // ...but never presented as fresh
    expect(out.events).toHaveLength(1);
    expect(out.quotaState?.allBlocked).toBe(true);
    expect(out.quotaState?.cooldownMinutesRemaining).toBeGreaterThan(0);
  });
});

// ─── 3. Tool surface (quota state, no key material) ──────────────

describe('getSportsContext quota surface', () => {
  it('exposes quotaState and never key values', async () => {
    // Blocked pool + no cache → unavailable, quota visible to the agent.
    markCricketKeyQuotaBlocked('test-key-a');
    markCricketKeyQuotaBlocked('test-key-b');
    markCricketKeyQuotaBlocked('test-key-c');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no'); }) as unknown as typeof fetch);

    const out = await executeGetSportsContext({}, { tenant: { restaurantId: 'r1' } });
    expect(out.quotaState).toMatchObject({ totalKeys: 3, blockedKeys: 3, allBlocked: true });
    const json = JSON.stringify(out);
    expect(json).not.toContain('test-key-a');
    expect(json).not.toContain('apikey=');
  });
});

// ─── 4. Calendar sync (Mongo, idempotent) ────────────────────────

describe('cricket → Context Calendar sync', () => {
  it('persists fixtures as sports events and is idempotent across runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([RAW_INDIA])) as unknown as typeof fetch);

    const run1 = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run1.dataStatus).toBe('fresh');
    expect(run1.created).toBe(1);

    const docs = await CalendarEvent.find({ type: 'sports' }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      type: 'sports',
      scope: 'india',
      status: 'active',
      source: 'external',
      marketingRelevance: 'high', // India match
    });
    expect(docs[0].tags).toContain('cricapi:quota-cal-001');

    // Second run: cache hit, no duplicates.
    const run2 = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run2.created).toBe(0);
    expect(run2.updated).toBe(0);
    expect(await CalendarEvent.countDocuments({ type: 'sports' })).toBe(1);
  });

  it('archives sync events whose end has passed', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    await CalendarEvent.create({
      name: 'Old Match',
      type: 'sports',
      startDate: past,
      endDate: new Date(past.getTime() + 86_400_000),
      scope: 'india',
      tags: ['cricket-sync', 'cricapi:old-1'],
      status: 'active',
      source: 'external',
    });

    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([])) as unknown as typeof fetch);
    const run = await syncCricketEventsToCalendar({ daysAhead: 14 });
    expect(run.archived).toBe(1);

    const doc = await CalendarEvent.findOne({ tags: 'cricapi:old-1' }).lean();
    expect(doc?.status).toBe('archived');
  });
});

// ─── 5. Offer provider reads the calendar, never the API ─────────

describe('SportsCalendarRecommendationProvider', () => {
  it('produces match-day suggestions from ctx.sportsEvents with zero provider calls', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('sports API must not be called'); });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const ctx: RecommendationContext = {
      restaurantId: 'r1',
      customerCount: 400,
      activeCustomers: 300,
      newCustomersToday: 5,
      repeatCustomersToday: 40,
      sportsEvents: [
        {
          eventId: 'e1',
          name: 'India vs Australia, 1st T20I',
          startDate: new Date(Date.now() + 86_400_000).toISOString(),
          endDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          venue: 'Wankhede Stadium, Mumbai',
          isIndiaMatch: true,
          relevance: 'high',
        },
      ],
    };

    const suggestions = await new SportsCalendarRecommendationProvider().getSuggestions(ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      recommendationSource: 'sports_event',
      priority: 'high', // India match within 1 day
    });
    expect(suggestions[0].title).toContain('India Match Special');
    expect(suggestions[0].description).toContain('Wankhede');
  });

  it('emits nothing when the calendar holds no synced events', async () => {
    const out = await new SportsCalendarRecommendationProvider().getSuggestions({
      restaurantId: 'r1',
      customerCount: 100,
      activeCustomers: 80,
      newCustomersToday: 1,
      repeatCustomersToday: 10,
      sportsEvents: [],
    });
    expect(out).toEqual([]);
  });
});
