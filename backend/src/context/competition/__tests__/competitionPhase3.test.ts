/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionPhase3.test.ts — Competition Phase 3 acceptance tests:
 *   §2  integration with the canonical IntelligenceSignal architecture
 *   §3  LOCAL_COMPETITION_CONCENTRATION + COMPETITION_COUNT_CHANGED
 *   §4  freshness metadata on every signal (status/fetchedAt/ageSeconds)
 *   §11 overclaim guard on the new signals' evidence
 * All provider fetches stubbed — no network.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../config';
import { buildSummary, buildSignals } from '../competitionIntelligence';
import { normalizeCompetitors } from '../competitionNormalizer';
import { getNearbyCompetition } from '../competitionService';
import { deleteCompetitionCache } from '../competitionCache';
import { getLatestCompetitionSnapshot, persistCompetitionSignals } from '../competitionSignalStore';
import { executeGetNearbyCompetition } from '../../../ai/tools/context/getNearbyCompetitionTool';
import { runMarketingAgent } from '../../../ai/agents/marketingAgent';
import { ai } from '../../../ai';

let mongod: MongoMemoryServer;

const R1 = '507F1F77BCF86CD799439011';
const CENTER = { latitude: 19.076, longitude: 72.8777 };
const NOW = new Date('2026-10-05T12:00:00Z');

function place(partial: Record<string, unknown>) {
  return {
    id: partial.id ?? 'place-x',
    displayName: { text: partial.name ?? 'Generic Eatery' },
    location: partial.location ?? { latitude: CENTER.latitude + 0.002, longitude: CENTER.longitude },
    primaryType: partial.primaryType ?? 'restaurant',
    types: ['restaurant'],
    ...partial,
  };
}

function apiResponse(places: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ places }) };
}

/** 8 Indian-typed + 6 others within ~1.7km → dense, overlapping neighborhood. */
const DENSE_PLACES = [
  place({ id: 'd1', name: 'Spice Route', primaryType: 'indian_restaurant' }),
  place({ id: 'd2', name: 'Punjab Grill Co', primaryType: 'indian_restaurant' }),
  place({ id: 'd3', name: 'Dhaba Town', primaryType: 'indian_restaurant' }),
  place({ id: 'd4', name: 'Tandoor Nights', primaryType: 'indian_restaurant' }),
  place({ id: 'd5', name: 'Curry Leaf', primaryType: 'indian_restaurant' }),
  place({ id: 'd6', name: 'Masala Express', primaryType: 'indian_restaurant' }),
  place({ id: 'd7', name: 'Rasoi', primaryType: 'indian_restaurant' }),
  place({ id: 'd8', name: 'Naamkin', primaryType: 'indian_restaurant' }),
  place({ id: 'd9', name: 'Wok City', primaryType: 'chinese_restaurant' }),
  place({ id: 'd10', name: 'Pizza Plaza', primaryType: 'pizza_restaurant' }),
  place({ id: 'd11', name: 'Burger Barn', primaryType: 'hamburger_restaurant' }),
  place({ id: 'd12', name: 'Sushi Stop', primaryType: 'japanese_restaurant' }),
  place({ id: 'd13', name: 'Cafe Daily', primaryType: 'cafe' }),
  place({ id: 'd14', name: 'Bake House', primaryType: 'bakery' }),
];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.AI_PROVIDER = 'gemini';
  config.ai.provider = 'gemini';
  config.ai.apiKey = 'test-key';
  config.competition.apiKey = 'test-google-key';
  config.competition.enabled = true;
  ai.bootstrap();

  const Restaurant = mongoose.model('Restaurant');
  await Restaurant.syncIndexes().catch(() => undefined);
  await Restaurant.create({
    restaurantId: R1,
    name: 'Marine Kitchen',
    phone: '9999999999',
    latitude: String(CENTER.latitude),
    longitude: String(CENTER.longitude),
    cuisineType: 'Indian',
  });
});

afterAll(async () => {
  config.ai.apiKey = '';
  config.competition.apiKey = '';
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── §4 Freshness metadata ───────────────────────────────────────

describe('signal freshness (§4)', () => {
  it('every signal carries status/fetchedAt/ageSeconds consistent with the payload', () => {
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, '2026-10-05T11:00:00Z', {});
    const summary = buildSummary(competitors, 2000, 'Indian');
    const signals = buildSignals(summary, 2000, {
      freshness: { status: 'fresh', fetchedAt: '2026-10-05T11:00:00Z', ageSeconds: 3600 },
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.freshness.status).toBe('fresh');
      expect(s.freshness.fetchedAt).toBe('2026-10-05T11:00:00Z');
      expect(s.freshness.ageSeconds).toBe(3600);
      // generatedAt is real wall-clock; fixture dates are 2026 — just require
      // a parseable timestamp (ordering is untestable against future fixtures).
      expect(Number.isNaN(Date.parse(s.generatedAt))).toBe(false);
    }
  });

  it('stale-fallback signals carry freshness.status = stale (never silent)', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(DENSE_PLACES)) as unknown as typeof fetch);
    await getNearbyCompetition({ restaurantId: R1, now: NOW });
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    const stale = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(stale.dataStatus).toBe('stale');
    expect(stale.intelligence?.signals.every((s) => s.freshness.status === 'stale')).toBe(true);
  });
});

// ─── §3 LOCAL_COMPETITION_CONCENTRATION ──────────────────────────

describe('LOCAL_COMPETITION_CONCENTRATION (§3)', () => {
  it('emits with documented share evidence and explicit thresholds', () => {
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, NOW.toISOString(), {});
    const summary = buildSummary(competitors, 2000, 'Indian');
    const signals = buildSignals(summary, 2000, {
      freshness: { status: 'fresh', fetchedAt: NOW.toISOString(), ageSeconds: 0 },
    });
    const conc = signals.find((s) => s.signalType === 'LOCAL_COMPETITION_CONCENTRATION');
    expect(conc).toBeDefined();
    expect(conc!.evidence.join(' ')).toMatch(/within 500m of the restaurant/);
    expect(conc!.evidence.join(' ')).toMatch(/thresholds:/);
    expect((conc!.value as { share: number }).share).toBeCloseTo(
      (conc!.value as { within500m: number }).within500m / (conc!.value as { totalCompetitors: number }).totalCompetitors,
      6,
    );
  });

  it('classification is env-configurable', () => {
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, NOW.toISOString(), {});
    const summary = buildSummary(competitors, 2000, null);
    const prevLow = config.competition.concentrationLowThreshold;
    const prevHigh = config.competition.concentrationHighThreshold;
    try {
      // All 14 fixture places sit within 500m → share = 1.0. Push both
      // thresholds above it to force the 'low' classification.
      config.competition.concentrationLowThreshold = 1.5;
      config.competition.concentrationHighThreshold = 1.2;
      const signals = buildSignals(summary, 2000, {
        freshness: { status: 'fresh', fetchedAt: NOW.toISOString(), ageSeconds: 0 },
      });
      expect(signals.find((s) => s.signalType === 'LOCAL_COMPETITION_CONCENTRATION')?.relevance).toBe('low');
    } finally {
      config.competition.concentrationLowThreshold = prevLow;
      config.competition.concentrationHighThreshold = prevHigh;
    }
  });

  it('not emitted when there are no competitors (evidence-gated, §3)', () => {
    const summary = buildSummary([], 2000, null);
    const signals = buildSignals(summary, 2000, {
      freshness: { status: 'fresh', fetchedAt: NOW.toISOString(), ageSeconds: 0 },
    });
    expect(signals.find((s) => s.signalType === 'LOCAL_COMPETITION_CONCENTRATION')).toBeUndefined();
  });
});

// ─── §3 COMPETITION_COUNT_CHANGED (snapshot history) ─────────────

describe('COMPETITION_COUNT_CHANGED (§3/§23)', () => {
  it('emits when the current count differs from the previous same-location snapshot', () => {
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, NOW.toISOString(), {});
    const summary = buildSummary(competitors, 2000, 'Indian');
    const signals = buildSignals(summary, 2000, {
      freshness: { status: 'fresh', fetchedAt: NOW.toISOString(), ageSeconds: 0 },
      previous: { competitorCount: 12, fetchedAt: '2026-09-05T00:00:00Z' },
    });
    const changed = signals.find((s) => s.signalType === 'COMPETITION_COUNT_CHANGED');
    expect(changed).toBeDefined();
    expect((changed!.value as { previousCount: number; currentCount: number; delta: number })).toEqual({
      previousCount: 12, currentCount: 14, delta: 2,
    });
    // §23 overclaim guard: no prediction of sales impact.
    expect(changed!.evidence.join(' ')).toMatch(/no claim about competitor performance or sales impact/);
  });

  it('not emitted when counts match or no previous exists (evidence-gated)', () => {
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, NOW.toISOString(), {});
    const summary = buildSummary(competitors, 2000, null);
    const opts = { freshness: { status: 'fresh' as const, fetchedAt: NOW.toISOString(), ageSeconds: 0 } };
    expect(buildSignals(summary, 2000, opts).find((s) => s.signalType === 'COMPETITION_COUNT_CHANGED')).toBeUndefined();
    expect(
      buildSignals(summary, 2000, { ...opts, previous: { competitorCount: 14, fetchedAt: NOW.toISOString() } })
        .find((s) => s.signalType === 'COMPETITION_COUNT_CHANGED'),
    ).toBeUndefined();
  });

  it('end-to-end: second refresh with a different count emits the change signal from persisted history', async () => {
    // Clear snapshot history so earlier suites' refreshes cannot contaminate.
    const IntelligenceSignal = (await import('../../../models/intelligence/IntelligenceSignal')).default;
    await IntelligenceSignal.deleteMany({ tags: 'competition_snapshot' });
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(DENSE_PLACES.slice(0, 10))) as unknown as typeof fetch);
    const first = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(first.intelligence?.signals.find((s) => s.signalType === 'COMPETITION_COUNT_CHANGED')).toBeUndefined();
    const snap1 = await getLatestCompetitionSnapshot(R1, '19.076000,72.877700');
    expect(snap1?.competitorCount).toBe(10);

    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(DENSE_PLACES)) as unknown as typeof fetch);
    await deleteCompetitionCache(R1);
    const second = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    const changed = second.intelligence?.signals.find((s) => s.signalType === 'COMPETITION_COUNT_CHANGED');
    expect(changed).toBeDefined();
    expect((changed!.value as { previousCount: number }).previousCount).toBe(10);
    expect((changed!.value as { currentCount: number }).currentCount).toBe(14);
  });
});

// ─── §2 Canonical IntelligenceSignal integration ─────────────────

describe('canonical signal store integration (§2)', () => {
  it('persists evidence-based competition signals + snapshot into IntelligenceSignal', async () => {
    const IntelligenceSignal = (await import('../../../models/intelligence/IntelligenceSignal')).default;
    const competitors = normalizeCompetitors(DENSE_PLACES as never, CENTER, NOW.toISOString(), {});
    const summary = buildSummary(competitors, 2000, 'Indian');
    const signals = buildSignals(summary, 2000, {
      freshness: { status: 'fresh', fetchedAt: NOW.toISOString(), ageSeconds: 0 },
    });
    await persistCompetitionSignals(R1, { summary, signals }, NOW.toISOString(), '19.076000,72.877700');

    const docs = await IntelligenceSignal.find({ tags: 'competition_signal' }).lean();
    expect(docs.length).toBeGreaterThan(0);
    const types = docs.map((d: { type: string }) => d.type);
    // Every persisted-worthy signal produced by this summary must appear.
    const { COMPETITION_SIGNAL_TYPES } = await import('../competitionSignalStore');
    const expected = signals
      .map((s) => s.signalType)
      .filter((t) => (COMPETITION_SIGNAL_TYPES as readonly string[]).includes(t));
    expect(expected.length).toBeGreaterThan(0);
    for (const t of expected) expect(types).toContain(t);
    expect(types).toContain('HIGH_CUISINE_OVERLAP');
    expect(types).toContain('CLOSE_CATEGORY_COMPETITION');
    // No stale or non-persisted types leak in.
    expect(types).not.toContain('COMPETITION_COUNT_CHANGED');
    // Overclaim guard on persisted evidence.
    const evidenceText = docs.flatMap((d: { evidence: Array<{ description: string }> }) => d.evidence.map((e) => e.description)).join(' ').toLowerCase();
    expect(evidenceText).not.toMatch(/steal|losing|switch|popular|cheaper|revenue|sales (will|dropped)/);
  });

  it('snapshot lookup is location-scoped: a different locationKey sees no history', async () => {
    expect(await getLatestCompetitionSnapshot(R1, '19.000000,72.000000')).toBeNull();
    expect(await getLatestCompetitionSnapshot(R1, '19.076000,72.877700')).not.toBeNull();
  });
});

// ─── Tool + agent surface (§4/§5 honesty) ────────────────────────

describe('tool + agent stale disclosure', () => {
  it('tool exposes freshness on every signal', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(DENSE_PLACES)) as unknown as typeof fetch);
    const out = await executeGetNearbyCompetition({}, { tenant: { restaurantId: R1 } });
    expect(out.signals?.length).toBeGreaterThan(0);
    expect(out.signals!.every((s) => s.freshness && typeof s.freshness.ageSeconds === 'number')).toBe(true);
  });

  it('agent discloses stale provider data in the competition context line', async () => {
    // Force a stale state, then run the agent.
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    const agent = await runMarketingAgent({ tenant: { restaurantId: R1, actorId: 'a1' } });
    expect(agent.competitionContext).toMatch(/provider data stale/);
    // Fresh path does not carry the stale marker.
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(DENSE_PLACES)) as unknown as typeof fetch);
    await deleteCompetitionCache(R1);
    const agentFresh = await runMarketingAgent({ tenant: { restaurantId: R1, actorId: 'a1' } });
    expect(agentFresh.competitionContext).not.toMatch(/provider data stale/);
    expect(agentFresh.competitionContext).toMatch(/^Competition context: 14 nearby restaurants/);
  });
});
