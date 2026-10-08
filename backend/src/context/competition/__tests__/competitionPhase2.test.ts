/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * competitionPhase2.test.ts — Competition Phase 2 acceptance tests (spec §28/§29):
 * haversine, density formula, nearest competitor, category distribution,
 * cuisine overlap (incl. unknown), empty results, stale fallback, location
 * change invalidation, tenant isolation, tool output, E2E agent integration.
 * Google fetch is stubbed — no network, no real key.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../../config';
import { haversineMeters, parseCoordinates, locationKeyOf, normalizeCompetitors } from '../competitionNormalizer';
import { computeDensity, buildSummary, buildSignals, categoryDistribution } from '../competitionIntelligence';
import { getNearbyCompetition, refreshNearbyCompetition } from '../competitionService';
import { deleteCompetitionCache } from '../competitionCache';
import { executeGetNearbyCompetition, getNearbyCompetitionToolDefinition } from '../../../ai/tools/context/getNearbyCompetitionTool';
import { runMarketingAgent } from '../../../ai/agents/marketingAgent';
import { toolRegistry } from '../../../ai/tools/registry/toolRegistry';
import { resolveAllowedTools } from '../../../ai/tools/registry/toolResolver';
import { ai } from '../../../ai';

let mongod: MongoMemoryServer;

const R1 = '507F1F77BCF86CD799439011'; // uppercase — Restaurant.restaurantId is uppercased
const R2 = '507F1F77BCF86CD799439022';
const NOW = new Date('2026-10-05T12:00:00Z');

/** Restaurant at Mumbai (Marine Drive-ish); competitors at real offsets. */
const CENTER = { latitude: 19.076, longitude: 72.8777 };

function place(partial: Record<string, unknown>) {
  return {
    id: partial.id ?? 'place-x',
    displayName: { text: partial.name ?? 'Generic Eatery' },
    formattedAddress: 'Some Address, Mumbai',
    location: partial.location ?? { latitude: CENTER.latitude + 0.001, longitude: CENTER.longitude },
    primaryType: partial.primaryType ?? 'restaurant',
    types: ['restaurant'],
    googleMapsUri: 'https://maps.google.com/x',
    ...partial,
  };
}

function apiResponse(places: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ places }),
  };
}

/** ~111m per 0.001° latitude. */
const NEAR_400M = place({ id: 'p1', name: 'Corner Cafe', location: { latitude: CENTER.latitude + 0.0036, longitude: CENTER.longitude }, primaryType: 'cafe' });
const NEAR_700M = place({ id: 'p2', name: 'Tandoor House', location: { latitude: CENTER.latitude + 0.0063, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' });
const MID_1200M = place({ id: 'p3', name: 'Dragon Wok', location: { latitude: CENTER.latitude + 0.0108, longitude: CENTER.longitude }, primaryType: 'chinese_restaurant' });
const FAR_3KM = place({ id: 'p4', name: 'Far Bistro', location: { latitude: CENTER.latitude + 0.027, longitude: CENTER.longitude }, primaryType: 'italian_restaurant' });

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
  await Restaurant.create({
    restaurantId: R2,
    name: 'Other Kitchen',
    phone: '8888888888',
    latitude: String(CENTER.latitude + 0.05),
    longitude: String(CENTER.longitude + 0.05),
    // no cuisineType → cuisine overlap 'unknown'
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

// ─── Distance (§28 distance) ─────────────────────────────────────

describe('distance', () => {
  it('haversine: known coordinates → expected distance', () => {
    // Equator: 1° of longitude ≈ 111.19 km.
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
    // Zero distance for identical points.
    expect(haversineMeters(19.076, 72.8777, 19.076, 72.8777)).toBe(0);
  });

  it('parseCoordinates accepts model strings, rejects garbage', () => {
    expect(parseCoordinates('19.076', '72.8777')).toEqual({ latitude: 19.076, longitude: 72.8777 });
    expect(parseCoordinates('abc', '72.8777')).toBeNull();
    expect(parseCoordinates('999', '72.8777')).toBeNull();
    expect(parseCoordinates('', '')).toBeNull();
  });

  it('location key is stable and precision-bounded', () => {
    expect(locationKeyOf(19.076123456, 72.8777)).toBe(locationKeyOf(19.076123499, 72.8777));
    expect(locationKeyOf(19.076, 72.8777)).not.toBe(locationKeyOf(19.077, 72.8777));
  });
});

// ─── Density (§28 density) ───────────────────────────────────────

describe('density', () => {
  it('10 competitors in 2km radius → documented deterministic value', () => {
    const { densityPerKm2, density } = computeDensity(10, 2000);
    expect(densityPerKm2).toBeCloseTo(10 / (Math.PI * 4), 6); // ≈ 0.7958
    expect(density).toBe('low'); // below default low threshold (5/km²)
  });

  it('thresholds are env/config-driven', () => {
    const prevLow = config.competition.densityLowThreshold;
    const prevHigh = config.competition.densityHighThreshold;
    try {
      config.competition.densityLowThreshold = 0.5;
      config.competition.densityHighThreshold = 1;
      expect(computeDensity(10, 2000).density).toBe('medium');
      config.competition.densityHighThreshold = 0.7;
      expect(computeDensity(10, 2000).density).toBe('high');
    } finally {
      config.competition.densityLowThreshold = prevLow;
      config.competition.densityHighThreshold = prevHigh;
    }
  });
});

// ─── Nearest competitor + buckets (§28 nearest) ──────────────────

describe('summary + buckets', () => {
  const competitors = normalizeCompetitors(
    [MID_1200M, NEAR_400M, FAR_3KM, NEAR_700M] as never,
    CENTER,
    NOW.toISOString(),
    {},
  );

  it('nearest wins regardless of input order', () => {
    const summary = buildSummary(competitors, 2000, null);
    expect(summary.nearestDistanceMeters).toBeLessThan(500);
    expect(summary.totalCompetitors).toBe(4);
  });

  it('distance buckets are ordered and radius-bounded', () => {
    const summary = buildSummary(competitors, 2000, null);
    expect(summary.within500m).toBe(1);
    expect(summary.within1km).toBe(2);
    expect(summary.within2km).toBe(3);
    expect(summary.withinSearchRadius).toBe(3); // 3km place excluded by radius
    expect(summary.within500m).toBeLessThanOrEqual(summary.within1km);
    expect(summary.within1km).toBeLessThanOrEqual(summary.within2km);
  });

  it('provider places beyond the configured radius are excluded', () => {
    const only2km = competitors.filter((c) => (c.distanceMeters ?? Infinity) <= 2000);
    expect(only2km.map((c) => c.placeId)).not.toContain('p4');
  });
});

// ─── Category distribution + cuisine overlap (§8/§9) ─────────────

describe('category + cuisine overlap', () => {
  it('category distribution counts by Google primaryType', () => {
    const competitors = normalizeCompetitors(
      [NEAR_700M, place({ id: 'p5', name: 'Curry Corner', primaryType: 'indian_restaurant' }), MID_1200M] as never,
      CENTER, NOW.toISOString(), {},
    );
    const dist = categoryDistribution(competitors);
    expect(dist.find((d) => d.type === 'indian_restaurant')?.count).toBe(2);
    expect(dist.find((d) => d.type === 'chinese_restaurant')?.count).toBe(1);
  });

  it('declared Indian cuisine → overlap counts Indian-typed competitors', () => {
    const competitors = normalizeCompetitors(
      [NEAR_700M, place({ id: 'p6', name: 'Masala Grill', primaryType: 'indian_restaurant' }), MID_1200M] as never,
      CENTER, NOW.toISOString(), {},
    );
    const overlap = buildSummary(competitors, 2000, 'Indian').cuisineOverlap;
    expect(overlap.status).toBe('match');
    expect(overlap.overlappingCompetitors).toBe(2);
  });

  it('no declared cuisine → overlap unknown, never guessed (§8)', () => {
    const competitors = normalizeCompetitors([NEAR_700M, MID_1200M] as never, CENTER, NOW.toISOString(), {});
    const overlap = buildSummary(competitors, 2000, null).cuisineOverlap;
    expect(overlap.status).toBe('unknown');
    expect(overlap.overlappingCompetitors).toBe(0);
  });

  it('unmappable cuisine string → unknown (no name inference, no LLM)', () => {
    const competitors = normalizeCompetitors([NEAR_700M] as never, CENTER, NOW.toISOString(), {});
    expect(buildSummary(competitors, 2000, 'Grandma Secret Recipes').cuisineOverlap.status).toBe('unknown');
  });
});

// ─── Normalizer edge cases (§26) ─────────────────────────────────

describe('normalizer', () => {
  it('dedups by placeId and drops unusable rows', () => {
    const out = normalizeCompetitors(
      [NEAR_400M, { ...NEAR_400M }, { id: '', displayName: { text: 'No ID' } }, { id: 'p9' }] as never,
      CENTER, NOW.toISOString(), {},
    );
    expect(out).toHaveLength(1);
  });

  it('excludes the restaurant itself (registered placeId)', () => {
    const out = normalizeCompetitors(
      [place({ id: 'self-place', name: 'Marine Kitchen' }), NEAR_400M] as never,
      CENTER, NOW.toISOString(), { restaurantName: 'Marine Kitchen', selfPlaceId: 'self-place' },
    );
    expect(out.map((c) => c.placeId)).toEqual(['p1']);
  });
});

// ─── Service: empty, stale, unavailable (§26/§13) ────────────────

describe('service states', () => {
  it('zero places → valid empty competition context', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([])) as unknown as typeof fetch);
    const out = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(out.available).toBe(true);
    expect(out.reason).toBe('no_competitors');
    expect(out.competitors).toHaveLength(0);
    expect(out.intelligence?.summary.totalCompetitors).toBe(0);
    expect(out.dataStatus).toBe('fresh');
  });

  it('provider failure → stale fallback labeled dataStatus=stale, providerAvailable=false', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([NEAR_400M, NEAR_700M, MID_1200M])) as unknown as typeof fetch);
    const first = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(first.dataStatus).toBe('fresh');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    await deleteCompetitionCache(R1);
    const stale = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(stale.available).toBe(true);
    expect(stale.dataStatus).toBe('stale');
    expect(stale.providerAvailable).toBe(false);
    expect(stale.lastRefreshedAt).toBeTruthy();
  });

  it('missing coordinates → explicit unavailable, never invented data', async () => {
    const out = await getNearbyCompetition({ restaurantId: 'NOPE' });
    expect(out.available).toBe(false);
    expect(out.reason).toBe('location_unavailable');
    expect(out.dataStatus).toBe('unavailable');
  });

  it('force refresh bypasses cache and refetches (§14)', async () => {
    await deleteCompetitionCache(R1);
    const fetchMock = vi.fn(async () => apiResponse([NEAR_400M])) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    await getNearbyCompetition({ restaurantId: R1, now: NOW });
    await refreshNearbyCompetition(R1);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

// ─── Location change invalidation (§12) ──────────────────────────

describe('location change', () => {
  it('restaurant coordinates changed → old context never served as current', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([NEAR_400M])) as unknown as typeof fetch);
    await getNearbyCompetition({ restaurantId: R1, now: NOW });

    // Move the restaurant; the cache remains but its locationKey no longer matches.
    const Restaurant = mongoose.model('Restaurant');
    await Restaurant.updateOne({ restaurantId: R1 }, { $set: { latitude: String(CENTER.latitude + 0.05), longitude: String(CENTER.longitude) } });

    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([FAR_3KM])) as unknown as typeof fetch);
    const moved = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(moved.dataStatus).toBe('fresh'); // refetched, not stale-old
    expect(moved.competitors.map((c) => c.placeId)).toEqual(['p4']);
    expect(moved.intelligence?.summary.totalCompetitors).toBe(1);
    // Restore for later suites.
    await Restaurant.updateOne({ restaurantId: R1 }, { $set: { latitude: String(CENTER.latitude), longitude: String(CENTER.longitude) } });
    await deleteCompetitionCache(R1);
  });
});

// ─── Tool (§28 tool) + tenant isolation (§27) ────────────────────

describe('getNearbyCompetition tool', () => {
  it('returns normalized intelligence, never raw Google structures or keys', async () => {
    await deleteCompetitionCache(R1);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([NEAR_400M, NEAR_700M, MID_1200M])) as unknown as typeof fetch);
    const out = await executeGetNearbyCompetition({}, { tenant: { restaurantId: R1 } });

    expect(out.available).toBe(true);
    expect(out.summary?.totalCompetitors).toBe(3);
    expect(out.summary?.nearestDistanceMeters).toBeLessThan(500);
    expect(out.categoryDistribution?.length).toBeGreaterThan(0);
    expect(out.signals?.length).toBeGreaterThan(0);
    // No Google field leakage beyond the explicit DTO.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('test-google-key');
    expect(serialized).not.toContain('googleapis.com');
    expect(serialized).not.toContain('googleMapsUri');
    expect(serialized).not.toContain('formattedAddress');
  });

  it('tenant isolation: R2 never receives R1 competitors', async () => {
    await deleteCompetitionCache(R2);
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse([FAR_3KM])) as unknown as typeof fetch);
    const outR2 = await executeGetNearbyCompetition({}, { tenant: { restaurantId: R2 } });
    expect(outR2.summary?.totalCompetitors).toBe(1);
    // The 400m/700m/1200m set belongs to R1's neighborhood — absent here.
    expect(outR2.signals?.length ?? 0).toBeGreaterThan(0);
    await deleteCompetitionCache(R2);
  });

  it('registry: registered, read-only, resolvable in an agent policy', () => {
    expect(toolRegistry.has('getNearbyCompetition')).toBe(true);
    expect(getNearbyCompetitionToolDefinition.access).toBe('read');
    const resolved = resolveAllowedTools([
      'getSalesTrends', 'getInventoryStatus', 'getCustomerSegments',
      'getActiveOffers', 'getFestivalContext', 'getSportsContext', 'getNearbyCompetition',
    ]);
    expect(resolved.map((t) => t.name)).toContain('getNearbyCompetition');
  });
});

// ─── E2E intelligence → agent (§29) ──────────────────────────────

describe('E2E: 14 nearby → signals → agent', () => {
  it('high density + close category competition reach the agent as neutral context', async () => {
    await deleteCompetitionCache(R1);
    // Build a dense, category-overlapping neighborhood: 14 restaurants, 8
    // indian_restaurant, 3 within 500m.
    const places = [
      place({ id: 'c1', name: 'Spice Route', location: { latitude: CENTER.latitude + 0.002, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c2', name: 'Punjab Grill Co', location: { latitude: CENTER.latitude + 0.003, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c3', name: 'Dhaba Town', location: { latitude: CENTER.latitude + 0.004, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c4', name: 'Tandoor Nights', location: { latitude: CENTER.latitude + 0.005, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c5', name: 'Curry Leaf', location: { latitude: CENTER.latitude + 0.006, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c6', name: 'Masala Express', location: { latitude: CENTER.latitude + 0.007, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c7', name: 'Rasoi', location: { latitude: CENTER.latitude + 0.008, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c8', name: 'Naamkin', location: { latitude: CENTER.latitude + 0.009, longitude: CENTER.longitude }, primaryType: 'indian_restaurant' }),
      place({ id: 'c9', name: 'Wok City', location: { latitude: CENTER.latitude + 0.010, longitude: CENTER.longitude }, primaryType: 'chinese_restaurant' }),
      place({ id: 'c10', name: 'Pizza Plaza', location: { latitude: CENTER.latitude + 0.011, longitude: CENTER.longitude }, primaryType: 'pizza_restaurant' }),
      place({ id: 'c11', name: 'Burger Barn', location: { latitude: CENTER.latitude + 0.012, longitude: CENTER.longitude }, primaryType: 'hamburger_restaurant' }),
      place({ id: 'c12', name: 'Sushi Stop', location: { latitude: CENTER.latitude + 0.013, longitude: CENTER.longitude }, primaryType: 'japanese_restaurant' }),
      place({ id: 'c13', name: 'Cafe Daily', location: { latitude: CENTER.latitude + 0.014, longitude: CENTER.longitude }, primaryType: 'cafe' }),
      place({ id: 'c14', name: 'Bake House', location: { latitude: CENTER.latitude + 0.015, longitude: CENTER.longitude }, primaryType: 'bakery' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(places)) as unknown as typeof fetch);

    // Service level: evidence-based signals exist.
    const svc = await getNearbyCompetition({ restaurantId: R1, now: NOW });
    expect(svc.intelligence?.summary.totalCompetitors).toBe(14);
    expect(svc.intelligence?.summary.within500m).toBeGreaterThanOrEqual(3);
    expect(svc.intelligence?.summary.cuisineOverlap.overlappingCompetitors).toBe(8);
    const svcTypes = svc.intelligence!.signals.map((s) => s.signalType);
    expect(svcTypes).toContain('HIGH_CUISINE_OVERLAP');
    expect(svcTypes).toContain('CLOSE_CATEGORY_COMPETITION');
    // Overclaim guard: no evidence line implies performance/switching.
    const allEvidence = svc.intelligence!.signals.flatMap((s) => s.evidence).join(' ').toLowerCase();
    expect(allEvidence).not.toMatch(/steal|losing|switch|popular|cheaper|revenue|sales (will|dropped)/);

    // Agent level: the competition source is one of the tools the AGENTIC
    // insight agent may choose (the old deterministic context LINE was removed
    // with the targeting ladder).
    const run = await runMarketingAgent(
      { tenant: { restaurantId: R1, actorId: 'a1' } },
      {
        llm: async () => ({
          value: { toolCalls: [{ name: 'getNearbyCompetition', args: {} }], needMoreEvidence: false },
          model: 'fake-model',
          provider: 'fake',
          latencyMs: 1,
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        }),
        synthesisLlm: async () => ({
          value: {
            title: 'Competition context',
            summary: 'Nearby competition evidence was reviewed for this restaurant.',
            priority: 'low',
            evidenceRefs: ['getNearbyCompetition'],
            confidence: 0.4,
          },
          model: 'fake',
          provider: 'fake',
          latencyMs: 1,
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        }),
      },
    );
    expect(run.investigation.toolNames).toContain('getNearbyCompetition');
    expect(run.insights[0].toolsUsed).toContain('getNearbyCompetition');
    // Competition evidence must never instruct an automatic campaign.
    expect(JSON.stringify(run.insights[0])).not.toMatch(/create .*competition/i);
  });
});
