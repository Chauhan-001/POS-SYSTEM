/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * calendarAssistantService.ts — Calendar Phase 2: AI-assisted generation with
 * deterministic validation, duplicate detection and admin approval.
 *
 * Hard rules implemented here (spec §3/§4/§9/§14):
 *   - The LLM only ever produces CANDIDATES. It never writes to the database,
 *     never sets tenant identity, and never approves anything.
 *   - Every candidate independently passes: schema validation → date-range
 *     validation → scope validation → duplicate detection.
 *   - Lunar dates are cross-checked against the curated authoritative table
 *     (festivalService.verifyFestivalDate); anything not 'exact' is flagged
 *     `requiresDateVerification` rather than presented as fact.
 *   - Approval is an explicit admin action; drafts can only become active via
 *     approveEvent (rejected/archived drafts must be restored first).
 */

import { z } from 'zod';
import CalendarEvent, {
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_SCOPES,
  CALENDAR_RELEVANCE,
  type ICalendarEvent,
} from '../models/CalendarEvent';
import { createEvent, approveEvent as approveDraft } from './calendarService';
import { generateJson, isLlmConfigured, LlmError } from '../../../ai/shared/llmClient';
import { verifyFestivalDate } from '../../../services/festivalService';

// ─── Candidate schema (mirrors the calendar model, spec §2) ───────

export const calendarEventCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(CALENDAR_EVENT_TYPES),
    startDate: z.string().min(4),
    endDate: z.string().min(4).optional(),
    scope: z.enum(CALENDAR_EVENT_SCOPES),
    state: z.string().trim().max(80).optional(),
    region: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    marketingRelevance: z.enum(CALENDAR_RELEVANCE).default('medium'),
    preparationWindowDays: z.number().int().min(0).max(365).default(0),
    sourceReason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CalendarEventCandidate = z.infer<typeof calendarEventCandidateSchema>;

export interface CandidateReview extends CalendarEventCandidate {
  /** Deterministic date verification verdict (spec §3). */
  dateVerification: 'exact' | 'approximate' | 'unknown';
  requiresDateVerification: boolean;
  duplicate: { isDuplicate: boolean; matchedEventId?: string; reason?: string };
  warnings: string[];
}

export interface GenerateResult {
  candidates: CandidateReview[];
  warnings: string[];
  requiresApproval: true;
  llmUsed: boolean;
}

// ─── Deterministic helpers ────────────────────────────────────────

/** Lowercase, strip punctuation and generic festival words for matching. */
export function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(festival|celebration|day|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(Boolean));
}

/** Jaccard token similarity — deterministic, no fuzzy library. */
export function nameSimilarity(a: string, b: string): number {
  const sa = tokenSet(normalizeEventName(a));
  const sb = tokenSet(normalizeEventName(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function sameRegion(
  candidate: Pick<CalendarEventCandidate, 'scope' | 'state' | 'region' | 'city'>,
  existing: Pick<ICalendarEvent, 'scope' | 'state' | 'region' | 'city'>,
): boolean {
  if (candidate.scope !== existing.scope) {
    // A national event and a state event for the same festival are not duplicates.
    return false;
  }
  const eq = (x?: string | null, y?: string | null) => (x ?? '').trim().toLowerCase() === (y ?? '').trim().toLowerCase();
  if (candidate.scope === 'india') return true;
  if (candidate.scope === 'state') return eq(candidate.state, existing.state);
  if (candidate.scope === 'region') return eq(candidate.region, existing.region) || eq(candidate.state, existing.state);
  if (candidate.scope === 'city') return eq(candidate.city, existing.city);
  return true; // restaurant scope — tenant scoping handled by the caller
}

export interface DuplicateVerdict {
  isDuplicate: boolean;
  matchedEventId?: string;
  reason?: string;
}

/**
 * Duplicate detection (spec §4): name similarity + date overlap + scope match.
 * Never deletes or merges — it only reports so the admin can decide.
 */
export function findDuplicate(
  candidate: Pick<CalendarEventCandidate, 'name' | 'startDate' | 'endDate' | 'scope' | 'state' | 'region' | 'city'>,
  existing: Pick<ICalendarEvent, '_id' | 'name' | 'startDate' | 'endDate' | 'scope' | 'state' | 'region' | 'city'>[],
): DuplicateVerdict {
  const cStart = new Date(candidate.startDate);
  const cEnd = candidate.endDate ? new Date(candidate.endDate) : cStart;
  for (const ev of existing) {
    const similarity = nameSimilarity(candidate.name, ev.name);
    const exactName = normalizeEventName(candidate.name) === normalizeEventName(ev.name);
    if ((!exactName && similarity < 0.5) || !sameRegion(candidate, ev)) continue;
    if (!overlaps(cStart, cEnd, ev.startDate, ev.endDate)) continue;
    return {
      isDuplicate: true,
      matchedEventId: String(ev._id),
      reason: exactName
        ? 'An event with the same name already exists for the same date range and region.'
        : 'A similarly named event already exists for the same date range and region.',
    };
  }
  return { isDuplicate: false };
}

/** Deterministic marketing preparation window (spec §6) — never LLM-computed. */
export function preparationWindowStart(startDate: Date, preparationWindowDays: number): Date {
  const days = Number.isFinite(preparationWindowDays) && preparationWindowDays > 0 ? preparationWindowDays : 0;
  return new Date(startDate.getTime() - days * 86_400_000);
}

export interface RestaurantLocation {
  restaurantId: string;
  state?: string;
  city?: string;
  region?: string;
}

/**
 * Regional relevance (spec §5) — deterministic scope matching against the
 * authenticated restaurant's own profile. Never decided by the LLM.
 */
export function isEventRelevantToRestaurant(
  event: Pick<ICalendarEvent, 'scope' | 'state' | 'city' | 'region' | 'restaurantId'>,
  restaurant: RestaurantLocation,
): boolean {
  const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  switch (event.scope) {
    case 'india':
      return true;
    case 'state':
      return eq(event.state, restaurant.state);
    case 'region':
      return eq(event.region, restaurant.region) || eq(event.state, restaurant.state);
    case 'city':
      return eq(event.city, restaurant.city);
    case 'restaurant':
      return String(event.restaurantId ?? '') === restaurant.restaurantId;
    default:
      return false;
  }
}

// ─── Generation (LLM → candidates only) ──────────────────────────

const SYSTEM_PROMPT = [
  'You are the ChitKuber Context Calendar assistant for Indian restaurants.',
  'Produce structured event candidates only. Never invent dates you are unsure of —',
  'if a lunar festival date is uncertain for the requested year, still provide your best',
  'estimate but keep the name canonical (e.g. "Diwali", "Holi", "Janmashtami").',
  'Do not include sales, revenue or uplift predictions of any kind.',
  'Return a JSON object: { "events": [ ... ] } with 1–20 entries.',
].join(' ');

const SCHEMA_HINT = `{
  "events": [
    {
      "name": string,
      "type": "festival" | "national_event" | "seasonal" | "sports" | "local_event" | "restaurant_event" | "custom",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD (optional)",
      "scope": "india" | "state" | "region" | "city" | "restaurant",
      "state": string (optional, required when scope=state/city),
      "region": string (optional),
      "city": string (optional, required when scope=city),
      "description": string (optional),
      "tags": string[] (optional),
      "marketingRelevance": "low" | "medium" | "high",
      "preparationWindowDays": number (0-365),
      "sourceReason": string (optional, why this event matters for restaurants)
    }
  ]
}`;

export interface GenerateOptions {
  request: string;
  startDate?: string;
  endDate?: string;
  /** Existing events to check duplicates against (caller loads them). */
  existingEvents: Pick<ICalendarEvent, '_id' | 'name' | 'startDate' | 'endDate' | 'scope' | 'state' | 'region' | 'city'>[];
  now?: Date;
}

export async function generateCandidates(options: GenerateOptions): Promise<GenerateResult> {
  const warnings: string[] = [];
  if (!isLlmConfigured()) {
    // Graceful degradation (spec §18): the calendar keeps working manually.
    return { candidates: [], warnings: ['LLM not configured (AI_API_KEY unset) — use manual event creation.'], requiresApproval: true, llmUsed: false };
  }

  const rangeLine =
    options.startDate && options.endDate
      ? `The events must fall between ${options.startDate} and ${options.endDate} (inclusive).`
      : 'Infer the year from the request.';

  let raw: unknown;
  try {
    raw = await generateJson<unknown>({
      system: SYSTEM_PROMPT,
      prompt: `${options.request}\n${rangeLine}`,
      schemaHint: SCHEMA_HINT,
    });
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'http_error';
    return {
      candidates: [],
      warnings: [`AI generation unavailable (${kind}). The calendar still works — create events manually.`],
      requiresApproval: true,
      llmUsed: false,
    };
  }

  const list = (raw as { events?: unknown })?.events;
  if (!Array.isArray(list)) {
    return { candidates: [], warnings: ['AI response did not contain an events array — nothing imported.'], requiresApproval: true, llmUsed: true };
  }

  const rangeStart = options.startDate ? new Date(options.startDate) : null;
  const rangeEnd = options.endDate ? new Date(options.endDate) : null;
  const now = options.now ?? new Date();
  const candidates: CandidateReview[] = [];

  list.slice(0, 20).forEach((entry, index) => {
    const parsed = calendarEventCandidateSchema.safeParse(entry);
    if (!parsed.success) {
      warnings.push(`Candidate ${index + 1} rejected: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}.`);
      return;
    }
    const c = parsed.data;
    const start = new Date(c.startDate);
    const end = c.endDate ? new Date(c.endDate) : start;

    // Date validation (spec §3/§10) — invalid or out-of-range candidates are rejected, not guessed.
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      warnings.push(`Candidate "${c.name}" rejected: unparseable date.`);
      return;
    }
    if (end.getTime() < start.getTime()) {
      warnings.push(`Candidate "${c.name}" rejected: end date before start date.`);
      return;
    }
    if (rangeStart && end.getTime() < rangeStart.getTime()) {
      warnings.push(`Candidate "${c.name}" rejected: outside the requested range.`);
      return;
    }
    if (rangeEnd && start.getTime() > rangeEnd.getTime()) {
      warnings.push(`Candidate "${c.name}" rejected: outside the requested range.`);
      return;
    }
    if (start.getTime() < new Date(now.getTime() - 365 * 86_400_000).getTime()) {
      warnings.push(`Candidate "${c.name}" rejected: more than a year in the past.`);
      return;
    }

    const verdict = verifyFestivalDate(c.name, start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
    const duplicate = findDuplicate(c, options.existingEvents);
    const candidateWarnings: string[] = [];
    if (verdict !== 'exact') {
      candidateWarnings.push('Date requires admin verification against an authoritative festival source.');
    }
    if (duplicate.isDuplicate) {
      candidateWarnings.push(duplicate.reason ?? 'Possible duplicate of an existing event.');
    }

    candidates.push({
      ...c,
      dateVerification: verdict,
      requiresDateVerification: verdict !== 'exact',
      duplicate,
      warnings: candidateWarnings,
    });
  });

  return { candidates, warnings, requiresApproval: true, llmUsed: true };
}

// ─── Approval (the ONLY path from candidate → canonical) ──────────

export interface ApproveResult {
  created: string[];
  rejected: Array<{ name: string; reason: string }>;
}

/**
 * Approve reviewed candidates: re-validate each one server-side (never trust
 * the client echo) and insert as ACTIVE events with source='gemini'.
 * Duplicates are skipped unless the admin explicitly forces them.
 */
export async function approveCandidates(
  candidates: unknown[],
  actor: { userId?: string | null; force?: boolean; restaurantId?: string | null } = {},
): Promise<ApproveResult> {
  const created: string[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  const existing = await CalendarEvent.find({}).select('_id name startDate endDate scope state region city').lean().exec();

  for (const entry of candidates.slice(0, 50)) {
    const parsed = calendarEventCandidateSchema.safeParse(entry);
    if (!parsed.success) {
      rejected.push({ name: (entry as { name?: string })?.name ?? 'unknown', reason: 'schema validation failed' });
      continue;
    }
    const c = parsed.data;
    const start = new Date(c.startDate);
    const end = c.endDate ? new Date(c.endDate) : start;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
      rejected.push({ name: c.name, reason: 'invalid date range' });
      continue;
    }

    const duplicate = findDuplicate(c, existing as never[]);
    if (duplicate.isDuplicate && !actor.force) {
      rejected.push({ name: c.name, reason: `Duplicate — ${duplicate.reason ?? 'similar event already exists'}` });
      continue;
    }

    // Restaurant-scoped candidates are stamped with the AUTHENTICATED tenant —
    // never a value from the LLM payload.
    const restaurantId = c.scope === 'restaurant' ? actor.restaurantId ?? undefined : undefined;
    if (c.scope === 'restaurant' && !restaurantId) {
      rejected.push({ name: c.name, reason: 'restaurant scope requires an authenticated restaurant' });
      continue;
    }

    const doc = await createEvent(
      {
        name: c.name,
        type: c.type,
        startDate: c.startDate,
        endDate: c.endDate ?? c.startDate,
        scope: c.scope,
        state: c.state,
        region: c.region,
        city: c.city,
        restaurantId,
        description: c.description,
        tags: c.tags,
        marketingRelevance: c.marketingRelevance,
        preparationWindowDays: c.preparationWindowDays,
        status: 'active',
      } as never,
      { userId: actor.userId ?? null, source: 'gemini' },
    );
    created.push(String(doc._id));
    existing.push({
      _id: doc._id,
      name: doc.name,
      startDate: doc.startDate,
      endDate: doc.endDate,
      scope: doc.scope,
      state: doc.state,
      region: doc.region,
      city: doc.city,
    } as never);
  }

  return { created, rejected };
}

/** Promote a stored draft to active (admin approval, spec §9). */
export async function approveDraftEvent(id: string): Promise<ICalendarEvent> {
  return approveDraft(id);
}

export const calendarAssistantService = {
  generateCandidates,
  approveCandidates,
  approveDraftEvent,
  findDuplicate,
  isEventRelevantToRestaurant,
  preparationWindowStart,
  normalizeEventName,
  nameSimilarity,
};
