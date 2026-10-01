/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketPhase3.test.ts — Cricket Phase 3 acceptance tests:
 *   §3  MATCH_TOMORROW + MATCH_PREPARATION_WINDOW signals (evidence-gated)
 *   §2  canonical contextSignals (same shape family as getFestivalContext)
 *   §10 Marketing Agent consumes cricket as context (never a trigger)
 *   §18 Shared Tool Registry resolves getSportsContext for agent policies
 *   §23 Tenant isolation + no key/URL leakage
 * All fetch calls stubbed — no network, no real API key.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../../config';
import { enrichMatch } from '../cricketRelevance';
import { normalizeMatch } from '../cricketNormalizer';
import { executeGetSportsContext, getSportsContextToolDefinition } from '../../../../ai/tools/context/getSportsContextTool';
import { runMarketingAgent } from '../../../../ai/agents/marketingAgent';
import { toolRegistry } from '../../../../ai/tools/registry/toolRegistry';
import { resolveAllowedTools } from '../../../../ai/tools/registry/toolResolver';
import { ai } from '../../../../ai';

let mongod: MongoMemoryServer;

const NOW = new Date('2026-10-05T12:00:00Z');
const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';

function match(partial: Record<string, unknown>) {
  const base = {
    id: 'p3-1',
    name: 'India vs Australia, 2nd T20I, Australia tour of India 2026',
    matchType: 't20',
    status: 'Match not started',
    date: '2026-10-06',
    dateTimeGMT: '2026-10-06T14:30:00',
    teams: ['India', 'Australia'],
  };
  const raw = { ...base, ...partial };
  const m = normalizeMatch(raw, NOW.toISOString());
  if (!m) throw new Error('normalizeMatch returned null');
  return m;
}

function apiResponse(matches: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ data: matches, info: { totalMatches: matches.length } }),
  };
}

const INDIA_TODAY_DINNER = {
  id: 'p3-today',
  name: 'India vs Australia, 2nd T20I, Australia tour of India 2026',
  matchType: 't20', status: 'Match not started',
  date: '2026-10-06', dateTimeGMT: '2026-10-06T14:30:00', // 20:00 IST → dinner
  teams: ['India', 'Australia'],
};
const INDIA_TOMORROW = {
  id: 'p3-tomorrow',
  name: 'India vs England, 3rd T20I',
  matchType: 't20', status: 'Match not started',
  date: '2026-10-06', dateTimeGMT: '2026-10-06T10:00:00', // +22h from NOW — 'tomorrow' under UTC and IST clocks alike
  teams: ['India', 'England'],
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
  const Restaurant = mongoose.model('Restaurant');
  await Restaurant.syncIndexes().catch(() => undefined);
  await Restaurant.findByIdAndUpdate(R1, { $set: { timezone: 'Asia/Kolkata' } }, { upsert: true }).catch(() => undefined);
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

// ─── §3 New lifecycle signals ─────────────────────────────────────

describe('Phase 3 signals', () => {
  it('tomorrow match → upcoming_tomorrow window + MATCH_TOMORROW signal', () => {
    const enriched = enrichMatch(match(INDIA_TOMORROW), { timezone: 'Asia/Kolkata' }, NOW);
    expect(enriched.timeWindow).toBe('upcoming_tomorrow');
    const types = enriched.signals.map((s) => s.signalType);
    expect(types).toContain('MATCH_TOMORROW');
    expect(types).toContain('INDIA_MATCH');
  });

  it('match within the preparation window → MATCH_PREPARATION_WINDOW with evidence', () => {
    // +22h ahead → inside the 36h default preparation window
    const enriched = enrichMatch(match(INDIA_TOMORROW), { timezone: 'Asia/Kolkata' }, NOW);
    const prep = enriched.signals.find((s) => s.signalType === 'MATCH_PREPARATION_WINDOW');
    expect(prep).toBeDefined();
    expect(prep!.evidence.join(' ')).toMatch(/preparation window/i);
  });

  it('no MATCH_PREPARATION_WINDOW for live or completed matches', () => {
    const live = enrichMatch(
      match({ id: 'p3-live', name: 'India vs South Africa, 2nd T20I', status: '1st innings', date: '2026-10-05', dateTimeGMT: '2026-10-05T11:00:00' }),
      { timezone: 'Asia/Kolkata' }, NOW,
    );
    expect(live.signals.map((s) => s.signalType)).not.toContain('MATCH_PREPARATION_WINDOW');

    const done = enrichMatch(
      match({ id: 'p3-done', name: 'India vs Sri Lanka, 1st ODI', matchType: 'odi', status: 'India won by 5 wickets', date: '2026-10-05', dateTimeGMT: '2026-10-05T09:30:00' }),
      { timezone: 'Asia/Kolkata' }, NOW,
    );
    expect(done.signals).toHaveLength(0);
  });

  it('preparation window is config-driven', () => {
    const prev = config.cricket.preparationWindowHours;
    try {
      config.cricket.preparationWindowHours = 30; // match at +22h still inside
      const inWindow = enrichMatch(match(INDIA_TOMORROW), { timezone: 'Asia/Kolkata' }, NOW);
      expect(inWindow.signals.map((s) => s.signalType)).toContain('MATCH_PREPARATION_WINDOW');
      config.cricket.preparationWindowHours = 12; // +22h now outside
      const outWindow = enrichMatch(match(INDIA_TOMORROW), { timezone: 'Asia/Kolkata' }, NOW);
      expect(outWindow.signals.map((s) => s.signalType)).not.toContain('MATCH_PREPARATION_WINDOW');
    } finally {
      config.cricket.preparationWindowHours = prev;
    }
  });

  it('MATCH_DURING_DINNER is NOT generated without hours evidence (§3 evidence-gated)', () => {
    // Unknown hours → dinner signal may fire (dinner window is deterministic
    // clock-time), but MATCH_DURING_OPERATING_HOURS must NOT.
    const enriched = enrichMatch(match(INDIA_TODAY_DINNER), { timezone: 'Asia/Kolkata' }, NOW);
    const types = enriched.signals.map((s) => s.signalType);
    expect(types).not.toContain('MATCH_DURING_OPERATING_HOURS');
    expect(enriched.operatingHoursOverlap).toBe('unknown');
  });
});

// ─── §2 Canonical cross-source signals via the tool ───────────────

describe('getSportsContext canonical contextSignals', () => {
  it('emits source=cricket signals with event + evidence, same convention as festival signals', async () => {
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_TODAY_DINNER, INDIA_TOMORROW])) as unknown as typeof fetch);

    const out = await executeGetSportsContext({}, { tenant: { restaurantId: R1 } });
    expect(out.available).toBe(true);
    expect(out.contextSignals).toBeDefined();
    expect(out.contextSignals!.length).toBeGreaterThan(0);

    for (const sig of out.contextSignals!) {
      expect(sig.source).toBe('cricket');
      expect(sig.eventId).toBeTruthy();
      expect(sig.eventName).toBeTruthy();
      expect(Array.isArray(sig.evidence)).toBe(true);
      expect(sig.evidence.length).toBeGreaterThan(0);
      expect(sig.generatedAt).toBeTruthy();
    }
    const today = out.contextSignals!.find((s) => s.signalType === 'INDIA_MATCH' && s.eventId === INDIA_TODAY_DINNER.id);
    expect(today).toBeDefined();
    expect(today!.startAt).toBe('2026-10-06T20:00'); // restaurant-local (Asia/Kolkata)
    expect(today!.relevance).toBe('high');
    // Dinner evidence present; operating-hours evidence absent (no hours data)
    expect(today!.evidence.join(' ')).toMatch(/dinner/i);
    expect(today!.evidence.join(' ')).not.toMatch(/operating hours/);
  });

  it('no API key or provider URL anywhere in the tool output', async () => {
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_TODAY_DINNER])) as unknown as typeof fetch);
    const out = await executeGetSportsContext({}, { tenant: { restaurantId: R1 } });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('test-cricket-key');
    expect(serialized).not.toContain('cricapi.com');
  });
});

// ─── §10/§18 Registry + agent integration ─────────────────────────

describe('shared registry + Marketing Agent', () => {
  it('getSportsContext is registered, read-only, and resolvable for an agent policy', () => {
    expect(toolRegistry.has('getSportsContext')).toBe(true);
    expect(getSportsContextToolDefinition.access).toBe('read');
    const resolved = resolveAllowedTools([
      'getSalesTrends', 'getInventoryStatus', 'getCustomerSegments',
      'getActiveOffers', 'getFestivalContext', 'getSportsContext',
    ]);
    expect(resolved.map((t) => t.name)).toContain('getSportsContext');
  });

  it('agent exposes cricket as neutral context alongside festival, never as a trigger', async () => {
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_TODAY_DINNER])) as unknown as typeof fetch);

    const result = await runMarketingAgent({ tenant: { restaurantId: R1, actorId: 'a1' } });
    expect(result.sportsContext).toMatch(/^Cricket context: /);
    expect(result.sportsContext).toMatch(/India vs Australia/);
    expect(result.sportsSignals).toContain('INDIA_MATCH');
    expect(result.sportsSignals).toContain('MATCH_DURING_DINNER');
    // High-relevance match yields the neutral advisory nextAction — wording
    // must never instruct automatic campaign creation.
    const advisory = result.nextActions.find((a) => /cricket match/i.test(a));
    expect(advisory).toBeDefined();
    expect(advisory).toMatch(/never triggers a campaign by itself/i);
  });

  it('agent handles unavailable cricket provider without breaking the honesty ladder', async () => {
    config.cricket.enabled = false;
    try {
      const { deleteCache } = await import('../../../../services/cacheService');
      await deleteCache('cricket_context_cache');
      const result = await runMarketingAgent({ tenant: { restaurantId: R1, actorId: 'a1' } });
      expect(result.sportsContext).toBeNull();
      expect(result.sportsSignals).toEqual([]);
      // Ladder unaffected: no ML signal for a fresh tenant → NONE
      expect(result.targetingSource).toBe('NONE');
    } finally {
      config.cricket.enabled = true;
    }
  });

  it('tenant isolation: R2 (no restaurant record) gets no R1 localization', async () => {
    const { deleteCache } = await import('../../../../services/cacheService');
    await deleteCache('cricket_context_cache');
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([INDIA_TODAY_DINNER])) as unknown as typeof fetch);

    const outR2 = await executeGetSportsContext({}, { tenant: { restaurantId: R2 } });
    const sigR2 = outR2.contextSignals!.find((s) => s.signalType === 'INDIA_MATCH');
    expect(sigR2).toBeDefined();
    // R2 has no timezone record → UTC fallback, NOT R1's Asia/Kolkata time
    expect(sigR2!.startAt).toBe('2026-10-06T14:30'); // GMT as-is, not 20:00
  });
});
