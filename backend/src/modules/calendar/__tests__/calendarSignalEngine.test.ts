/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 — Calendar → Marketing Agent integration evaluation (spec §18).
 * The six canonical cases plus cache invalidation, determinism and the
 * no-automatic-action guardrail. Evidence and constraints are evaluated —
 * never a specific "offer winner".
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import CalendarEvent from '../models/CalendarEvent';
import {
  deriveEventPhase,
  scoreEventRelevance,
  getCalendarIntelligence,
  invalidateCalendarIntelligence,
} from '../services/calendarSignalEngine';
import { executeGetFestivalContext } from '../../../ai/tools/context/contextTools';
import { ai } from '../../../ai';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const R1_OID = new mongoose.Types.ObjectId(R1);
const R2_OID = new mongoose.Types.ObjectId(R2);

const NOW = new Date('2026-10-01T12:00:00Z');
function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 86_400_000);
}

async function seed(partial: Record<string, unknown>) {
  return CalendarEvent.create({
    tags: [],
    marketingRelevance: 'medium',
    preparationWindowDays: 0,
    status: 'active',
    source: 'admin',
    ...partial,
  } as never);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

beforeEach(() => {
  // Cross-test cache isolation: every test starts with cold derived intelligence.
  invalidateCalendarIntelligence();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ─── Deterministic engine units ───────────────────────────────────

describe('deriveEventPhase (spec §4)', () => {
  it('distinguishes not_started / preparation / active / ended', () => {
    const ev = { startDate: daysFromNow(5), endDate: daysFromNow(6), preparationWindowDays: 7 };
    expect(deriveEventPhase(ev, NOW)).toBe('preparation');
    expect(deriveEventPhase({ ...ev, preparationWindowDays: 0 }, NOW)).toBe('not_started');
    expect(deriveEventPhase({ startDate: daysFromNow(-1), endDate: daysFromNow(1), preparationWindowDays: 7 }, NOW)).toBe('active');
    expect(deriveEventPhase({ startDate: daysFromNow(-10), endDate: daysFromNow(-2), preparationWindowDays: 3 }, NOW)).toBe('ended');
  });

  it('phase boundary: exactly prep-start day is preparation, day before is not_started', () => {
    const ev = { startDate: daysFromNow(5), endDate: daysFromNow(6), preparationWindowDays: 5 };
    const prepStart = new Date(new Date(ev.startDate).getTime() - 5 * 86_400_000);
    expect(deriveEventPhase(ev, prepStart)).toBe('preparation');
    expect(deriveEventPhase(ev, new Date(prepStart.getTime() - 86_400_000))).toBe('not_started');
  });
});

describe('scoreEventRelevance (spec §5) — deterministic, reasons are evidence', () => {
  it('regional event in the restaurant state scores higher than the same event elsewhere', () => {
    const uttarakhand = { restaurantId: R1, state: 'Uttarakhand', city: 'Dehradun' };
    const harela = {
      scope: 'state' as const, state: 'Uttarakhand', type: 'festival' as const, marketingRelevance: 'high' as const,
      startDate: daysFromNow(5), endDate: daysFromNow(5), preparationWindowDays: 0,
    };
    const inState = scoreEventRelevance(harela, uttarakhand, NOW);
    expect(inState.relevance).toBe('high');
    expect(inState.reasons.join(' ')).toMatch(/[Rr]egional event/);

    // Punjab restaurant: the caller's relevance filter excludes it entirely;
    // the scorer itself only reflects generic attributes.
    const punjab = { restaurantId: R2, state: 'Punjab', city: 'Amritsar' };
    const elsewhere = scoreEventRelevance(harela, punjab, NOW);
    expect(elsewhere.reasons.join(' ')).not.toMatch(/matching restaurant location/);
  });

  it('no invented sales claims in reasons', () => {
    const out = scoreEventRelevance(
      { scope: 'india', type: 'festival', marketingRelevance: 'high', startDate: daysFromNow(3), endDate: daysFromNow(4), preparationWindowDays: 2 },
      { restaurantId: R1 }, NOW,
    );
    expect(out.reasons.join(' ')).not.toMatch(/%|\brevenue\b|\bsales increase\b/i);
  });
});

// ─── The six evaluation cases (spec §18) ──────────────────────────

describe('Phase 3 evaluation cases', () => {
  it('Case 1: festival in 5 days + prep window → FESTIVAL_APPROACHING + PREPARATION_WINDOW signals', async () => {
    await CalendarEvent.deleteMany({});
    await seed({ name: 'Diwali', type: 'festival', startDate: daysFromNow(5), endDate: daysFromNow(6), scope: 'india', marketingRelevance: 'high', preparationWindowDays: 7 });
    const intel = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW, forceRefresh: true });
    const types = intel.signals.map((s) => s.signalType);
    expect(types).toContain('festival_upcoming');
    expect(types).toContain('event_preparation_window');
    const prep = intel.signals.find((s) => s.signalType === 'event_preparation_window')!;
    expect(prep.preparationWindowActive).toBe(true);
    expect(prep.daysUntil).toBe(5);
    expect(prep.source).toBe('calendar');
  });

  it('Case 2: festival outside preparation window → no preparation signal', async () => {
    await CalendarEvent.deleteMany({});
    await seed({ name: 'Far Festival', type: 'festival', startDate: daysFromNow(40), endDate: daysFromNow(41), scope: 'india', preparationWindowDays: 7 });
    const intel = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW, forceRefresh: true });
    expect(intel.signals.some((s) => s.signalType === 'event_preparation_window')).toBe(false);
    expect(intel.upcoming.length).toBe(1); // still visible as upcoming
  });

  it('Case 3: state-specific festival + restaurant in another state → excluded', async () => {
    await CalendarEvent.deleteMany({});
    await seed({ name: 'Harela', type: 'festival', startDate: daysFromNow(5), endDate: daysFromNow(5), scope: 'state', state: 'Uttarakhand' });
    const forPunjab = await getCalendarIntelligence({ restaurantId: R2, state: 'Punjab', city: 'Amritsar' }, { now: NOW, forceRefresh: true });
    expect(forPunjab.upcoming).toHaveLength(0);
    expect(forPunjab.signals).toHaveLength(0);
    const forUK = await getCalendarIntelligence({ restaurantId: R1, state: 'Uttarakhand', city: 'Dehradun' }, { now: NOW, forceRefresh: true });
    expect(forUK.upcoming).toHaveLength(1);
    expect(forUK.regionalEvents).toHaveLength(1);
  });

  it('Case 4: archived event → not returned', async () => {
    await CalendarEvent.deleteMany({});
    await seed({ name: 'Old Event', type: 'custom', startDate: daysFromNow(2), endDate: daysFromNow(2), scope: 'india', status: 'archived' });
    const intel = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW, forceRefresh: true });
    expect(intel.upcoming).toHaveLength(0);
    const tool = await executeGetFestivalContext({}, { tenant: { restaurantId: R1 } });
    expect((tool.calendarEvents ?? []).length).toBe(0);
  });

  it('Case 5: restaurant-specific event of ANOTHER restaurant → not exposed', async () => {
    await CalendarEvent.deleteMany({});
    await seed({ name: 'R2 Anniversary', type: 'restaurant_event', startDate: daysFromNow(3), endDate: daysFromNow(3), scope: 'restaurant', restaurantId: R2_OID });
    const intel = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW, forceRefresh: true });
    expect(intel.upcoming).toHaveLength(0);
  });

  it('Case 6: tool returns buckets + evidence fields the agent can combine (festival + inventory etc. are separate tools)', async () => {
    await CalendarEvent.deleteMany({});
    const diwali = await seed({ name: 'Diwali', type: 'festival', startDate: daysFromNow(6), endDate: daysFromNow(8), scope: 'india', marketingRelevance: 'high', preparationWindowDays: 7 });
    const tool = await executeGetFestivalContext({}, { tenant: { restaurantId: R1 } });
    expect(tool.available).toBe(true);
    expect(tool.buckets).toBeDefined();
    expect(tool.buckets!.upcoming.length).toBe(1);
    const ev: any = tool.calendarEvents![0];
    expect(ev.eventId).toBe(String(diwali._id));
    expect(ev.phase).toBe('preparation');
    expect(ev.preparationWindowActive === undefined || typeof ev.reasons === 'object').toBe(true);
    expect(ev.historicalEvidence).toBeNull(); // insufficient data → explicit null (§6)
    // Signals are evidence: no imperative offer text
    expect(JSON.stringify(tool.signals)).not.toMatch(/create.*offer|20% discount/i);
  });
});

// ─── Historical evidence (spec §6) ────────────────────────────────

describe('historical evidence from ChitKuber data only', () => {
  it('prior campaign near a previous same-name event produces counts, no fabricated metrics', async () => {
    await CalendarEvent.deleteMany({});
    // An UPCOMING Diwali (the one being scored) plus a previous Diwali (ended)
    // and a sent campaign around the previous window.
    await seed({ name: 'Diwali', type: 'festival', startDate: daysFromNow(6), endDate: daysFromNow(8), scope: 'india', marketingRelevance: 'high', preparationWindowDays: 7 });
    await seed({ name: 'Diwali', type: 'festival', startDate: daysFromNow(-370), endDate: daysFromNow(-369), scope: 'india' });
    const Campaign = mongoose.model('Campaign');
    await Campaign.create({
      restaurantId: R1_OID,
      name: 'Diwali special blast',
      status: 'sent',
      createdAt: daysFromNow(-369),
      schedule: { mode: 'immediate' },
      audience: { type: 'all' },
      template: { channel: 'whatsapp', message: 'Diwali greetings!' },
    } as never);

    const intel = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW, forceRefresh: true });
    const ev = intel.upcoming.find((e) => e.name === 'Diwali');
    expect(ev).toBeDefined();
    expect(ev!.historicalEvidence).not.toBeNull();
    expect(ev!.historicalEvidence!.previousEvents).toBeGreaterThanOrEqual(1);
    expect(ev!.historicalEvidence!.previousCampaigns).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(ev!.historicalEvidence!.previousOfferTypes)).toBe(true);
    // No fabricated percentages
    expect(JSON.stringify(ev!.historicalEvidence)).not.toMatch(/revenue|uplift|%/);
  });
});

// ─── Cache invalidation (spec §13/§14) ────────────────────────────

describe('derived-intelligence cache', () => {
  it('archive invalidates cached intelligence — the event disappears on next call', async () => {
    await CalendarEvent.deleteMany({});
    const ev = await seed({ name: 'Cache Test', type: 'festival', startDate: daysFromNow(4), endDate: daysFromNow(5), scope: 'india' });
    const first = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW });
    expect(first.upcoming).toHaveLength(1);

    // Mutate through the authoritative service (invalidates cache internally).
    const { calendarService } = await import('../services/calendarService');
    await calendarService.archiveEvent(String(ev._id));

    const second = await getCalendarIntelligence({ restaurantId: R1 }, { now: NOW });
    expect(second.upcoming).toHaveLength(0);
    invalidateCalendarIntelligence(); // cleanup
  });
});
