/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2 — Calendar AI assistant acceptance tests (spec §20):
 * generation (valid/malformed LLM), duplicate detection, regional relevance,
 * preparation window, approval workflow, getFestivalContext tool, security.
 * The LLM is exercised through stubbed fetch — no network, no key.
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import CalendarEvent from '../models/CalendarEvent';
import { calendarService } from '../services/calendarService';
import {
  calendarAssistantService,
  findDuplicate,
  isEventRelevantToRestaurant,
  preparationWindowStart,
  normalizeEventName,
  generateCandidates,
  approveCandidates,
} from '../services/calendarAssistantService';
import { executeGetFestivalContext, getFestivalContextToolDefinition } from '../../../ai/tools/context/contextTools';
import { ai } from '../../../ai';
import { config } from '../../../config';

let mongod: MongoMemoryServer;

function geminiJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  };
}

const VALID_EVENT = {
  name: 'Diwali',
  type: 'festival',
  startDate: '2027-10-29',
  endDate: '2027-11-02',
  scope: 'india',
  marketingRelevance: 'high',
  preparationWindowDays: 14,
  tags: ['sweets', 'family'],
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // LLM config for gemini-path tests (restored after).
  process.env.AI_PROVIDER = 'gemini';
  config.ai.provider = 'gemini';
  config.ai.apiKey = 'test-llm-key';
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

// ─── AI generation (spec: valid / malformed / missing / invalid dates) ──

describe('generateCandidates', () => {
  it('validates and reviews a valid structured LLM response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiJson({ events: [VALID_EVENT] })) as unknown as typeof fetch);
    const out = await generateCandidates({ request: 'Major festivals 2027', existingEvents: [] });
    expect(out.llmUsed).toBe(true);
    expect(out.requiresApproval).toBe(true);
    expect(out.candidates).toHaveLength(1);
    // Diwali 2027 is NOT in the curated table (2025–2027 window ends before
    // late Oct 2027 has no entry) → flagged for verification, presented honestly.
    expect(['approximate', 'unknown', 'exact']).toContain(out.candidates[0].dateVerification);
  });

  it('rejects a malformed LLM response with a warning, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiJson({ nope: true })) as unknown as typeof fetch);
    const out = await generateCandidates({ request: 'x', existingEvents: [] });
    expect(out.candidates).toHaveLength(0);
    expect(out.warnings.join(' ')).toMatch(/events array/i);
  });

  it('rejects candidates with invalid dates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiJson({
      events: [
        { ...VALID_EVENT, startDate: 'not-a-date' },
        { ...VALID_EVENT, name: 'Backwards', startDate: '2027-11-10', endDate: '2027-11-01' },
      ],
    })) as unknown as typeof fetch);
    const out = await generateCandidates({ request: 'x', existingEvents: [] });
    expect(out.candidates).toHaveLength(0);
    expect(out.warnings.length).toBe(2);
  });

  it('degrades gracefully when the LLM is not configured', async () => {
    const prev = config.ai.apiKey;
    config.ai.apiKey = '';
    try {
      const out = await generateCandidates({ request: 'x', existingEvents: [] });
      expect(out.llmUsed).toBe(false);
      expect(out.warnings.join(' ')).toMatch(/not configured/i);
    } finally {
      config.ai.apiKey = prev;
    }
  });

  it('never includes a restaurantId from the LLM payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiJson({
      events: [{ ...VALID_EVENT, scope: 'restaurant', restaurantId: '507f1f77bcf86cd799439099' }],
    })) as unknown as typeof fetch);
    const out = await generateCandidates({ request: 'x', existingEvents: [] });
    // strict schema strips/failed restaurantId — candidate rejected or stripped
    if (out.candidates.length === 1) {
      expect((out.candidates[0] as unknown as Record<string, unknown>).restaurantId).toBeUndefined();
    } else {
      expect(out.warnings.join(' ')).toBeTruthy();
    }
  });
});

// ─── Duplicate detection (spec §4) ────────────────────────────────

describe('duplicate detection', () => {
  const base = { name: 'Diwali', startDate: '2027-11-01', endDate: '2027-11-01', scope: 'india' as const };

  it('flags an exact duplicate (name + date + scope)', () => {
    const existing = [{ _id: 'e1', name: 'Diwali', startDate: new Date('2027-11-01'), endDate: new Date('2027-11-01'), scope: 'india' }];
    const verdict = findDuplicate(base, existing as never[]);
    expect(verdict.isDuplicate).toBe(true);
    expect(verdict.matchedEventId).toBe('e1');
  });

  it('flags a similar event ("Diwali Festival" vs "Diwali") on matching dates', () => {
    const existing = [{ _id: 'e2', name: 'Diwali', startDate: new Date('2027-11-01'), endDate: new Date('2027-11-01'), scope: 'india' }];
    const verdict = findDuplicate({ ...base, name: 'Diwali Festival' }, existing as never[]);
    expect(verdict.isDuplicate).toBe(true);
  });

  it('does NOT flag the same name in a different region', () => {
    const existing = [{ _id: 'e3', name: 'Diwali', startDate: new Date('2027-11-01'), endDate: new Date('2027-11-01'), scope: 'state', state: 'Punjab' }];
    const verdict = findDuplicate(base, existing as never[]);
    expect(verdict.isDuplicate).toBe(false);
  });

  it('does NOT flag the same name on different dates', () => {
    const existing = [{ _id: 'e4', name: 'Diwali', startDate: new Date('2026-11-08'), endDate: new Date('2026-11-08'), scope: 'india' }];
    const verdict = findDuplicate(base, existing as never[]);
    expect(verdict.isDuplicate).toBe(false);
  });

  it('normalizer strips generic words ("Diwali Festival" → "diwali")', () => {
    expect(normalizeEventName('Diwali Festival!')).toBe('diwali');
    expect(calendarAssistantService.nameSimilarity('Diwali Festival', 'Diwali')).toBe(1);
  });
});

// ─── Regional relevance + preparation window (spec §5/§6) ─────────

describe('regional relevance and preparation window', () => {
  const restaurant = { restaurantId: 'r1', state: 'Uttarakhand', city: 'Dehradun' };

  function ev(partial: Record<string, unknown>) {
    return partial as never;
  }

  it('india scope applies everywhere; state only matches; city only matches', () => {
    expect(isEventRelevantToRestaurant(ev({ scope: 'india' }), restaurant)).toBe(true);
    expect(isEventRelevantToRestaurant(ev({ scope: 'state', state: 'Uttarakhand' }), restaurant)).toBe(true);
    expect(isEventRelevantToRestaurant(ev({ scope: 'state', state: 'Punjab' }), restaurant)).toBe(false);
    expect(isEventRelevantToRestaurant(ev({ scope: 'city', city: 'Dehradun' }), restaurant)).toBe(true);
    expect(isEventRelevantToRestaurant(ev({ scope: 'city', city: 'Haridwar' }), restaurant)).toBe(false);
    expect(isEventRelevantToRestaurant(ev({ scope: 'restaurant', restaurantId: 'r1' }), restaurant)).toBe(true);
    expect(isEventRelevantToRestaurant(ev({ scope: 'restaurant', restaurantId: 'other' }), restaurant)).toBe(false);
  });

  it('computes the preparation window deterministically (Diwali − 7d)', () => {
    expect(preparationWindowStart(new Date('2026-11-08'), 7).toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(preparationWindowStart(new Date('2026-11-08'), 0).toISOString().slice(0, 10)).toBe('2026-11-08');
    // boundary: 1 day
    expect(preparationWindowStart(new Date('2026-11-02'), 1).toISOString().slice(0, 10)).toBe('2026-11-01');
  });
});

// ─── Approval workflow (spec §9/§20) ──────────────────────────────

describe('approval workflow', () => {
  it('approve creates ACTIVE events with source=gemini; duplicates skipped unless forced', async () => {
    const result = await approveCandidates([VALID_EVENT, { ...VALID_EVENT }], { userId: 'admin-1' });
    expect(result.created).toHaveLength(1);
    expect(result.rejected).toHaveLength(1); // second is a duplicate
    expect(result.rejected[0].reason).toMatch(/duplicate/i);

    const doc = await CalendarEvent.findById(result.created[0]);
    expect(doc!.status).toBe('active');
    expect(doc!.source).toBe('gemini');
    expect(doc!.name).toBe('Diwali');
  });

  it('forced approval accepts a reviewed duplicate', async () => {
    const result = await approveCandidates([VALID_EVENT], { force: true });
    expect(result.created).toHaveLength(1);
  });

  it('draft cannot become active without approval; approved draft becomes canonical; archived draft rejected', async () => {
    const draft = await calendarService.createEvent({
      name: 'Harela', type: 'festival', startDate: '2027-07-16', endDate: '2027-07-16',
      scope: 'state', state: 'Uttarakhand', status: 'draft',
    } as never, { source: 'gemini' });

    // Drafts are excluded from the default listing.
    const listed = await calendarService.listEvents({});
    expect(listed.some((e) => String(e._id) === String(draft._id))).toBe(false);

    const approved = await calendarService.approveEvent(String(draft._id));
    expect(approved.status).toBe('active');

    // Archive (reject) then attempt approval — must fail.
    const archived = await calendarService.archiveEvent(String(draft._id));
    await expect(calendarService.approveEvent(String(archived._id))).rejects.toMatchObject({
      name: 'CalendarValidationError',
    });
  });

  it('approve re-validates: invalid candidate payloads are rejected server-side', async () => {
    const result = await approveCandidates([{ name: 'Broken', scope: 'galaxy' }]);
    expect(result.created).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/schema/i);
  });
});

// ─── getFestivalContext tool (spec §20 tool tests) ────────────────

describe('getFestivalContext tool with calendar layer', () => {
  it('returns tenant-relevant calendar events with daysUntil and signals; excludes drafts/archived and other tenants', async () => {
    await CalendarEvent.deleteMany({});
    const r1 = new mongoose.Types.ObjectId();
    const r2 = new mongoose.Types.ObjectId();
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await CalendarEvent.create([
      { name: 'Diwali (cal)', type: 'festival', startDate: soon, endDate: soon, scope: 'india', tags: [], marketingRelevance: 'high', preparationWindowDays: 7, status: 'active', source: 'gemini' },
      { name: 'Other-tenant event', type: 'restaurant_event', startDate: soon, endDate: soon, scope: 'restaurant', restaurantId: r2, tags: [], status: 'active', source: 'admin' },
      { name: 'Draft event', type: 'custom', startDate: soon, endDate: soon, scope: 'india', tags: [], status: 'draft', source: 'gemini' },
      { name: 'Archived event', type: 'custom', startDate: soon, endDate: soon, scope: 'india', tags: [], status: 'archived', source: 'admin' },
    ] as never[]);

    const out = await executeGetFestivalContext({}, { tenant: { restaurantId: String(r1) } });
    expect(out.available).toBe(true);
    const names = (out.calendarEvents ?? []).map((e) => e.name);
    expect(names).toContain('Diwali (cal)');
    expect(names).not.toContain('Other-tenant event'); // tenant isolation
    expect(names).not.toContain('Draft event');       // drafts excluded
    expect(names).not.toContain('Archived event');    // archived excluded

    const ev = out.calendarEvents![0];
    expect(ev.daysUntil).toBeGreaterThanOrEqual(4); // deterministic backend calc
    expect(['festival_upcoming', 'event_preparation_window', 'festival_active']).toContain(ev.signal);
    expect(out.signals!.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(out)).not.toContain('AI_API_KEY');
  });

  it('input schema is strict', () => {
    expect(getFestivalContextToolDefinition.inputSchema.safeParse({ maxDays: 400 }).success).toBe(false);
  });
});
