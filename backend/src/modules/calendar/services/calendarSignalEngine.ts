/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * calendarSignalEngine.ts — Calendar Phase 3: converts APPROVED calendar
 * events into normalized, evidence-based signals for the Marketing Agent.
 *
 * Hard rules (spec §2/§5/§6/§12/§15):
 *   - Everything here is DETERMINISTIC. The LLM never computes dates, phases,
 *     relevance or evidence.
 *   - Signals are EVIDENCE, not instructions: nothing here creates offers or
 *     campaigns. The existing Offer Engine and campaign validators remain
 *     authoritative (§7/§15).
 *   - Historical evidence is derived ONLY from ChitKuber's own authoritative
 *     Campaign/Offer records — `null` when insufficient (§6).
 *   - Independent from Cricket/Competition modules (§11): each context module
 *     produces its own canonical signals; the agent combines them.
 *
 * Caching (§14): derived intelligence is cached in-memory per restaurant and
 * invalidated by calendar mutations (create/update/approve/archive/restore)
 * via invalidateCalendarIntelligence() — no second scheduler needed.
 */

import mongoose from 'mongoose';
import CalendarEvent, { type ICalendarEvent } from '../models/CalendarEvent';
import { isEventRelevantToRestaurant, type RestaurantLocation } from './calendarAssistantService';

// ─── Types ───────────────────────────────────────────────────────

export type EventPhase = 'not_started' | 'preparation' | 'active' | 'ended';

export type CalendarSignalType =
  | 'festival_upcoming'
  | 'festival_active'
  | 'festival_ending'
  | 'regional_festival'
  | 'national_event_upcoming'
  | 'seasonal_event'
  | 'event_preparation_window'
  | 'restaurant_event';

export interface CalendarSignal {
  signalType: CalendarSignalType;
  eventId: string;
  eventName: string;
  daysUntil: number;
  scope: string;
  marketingRelevance: 'low' | 'medium' | 'high';
  relevance: 'high' | 'medium' | 'low';
  phase: EventPhase;
  preparationWindowActive: boolean;
  evidence: string[];
  source: 'calendar';
}

export interface HistoricalEvidence {
  previousEvents: number;
  previousCampaigns: number;
  successfulCampaigns?: number;
  previousOfferTypes: string[];
}

export interface ScoredEvent {
  eventId: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  daysUntil: number;
  scope: string;
  marketingRelevance: 'low' | 'medium' | 'high';
  phase: EventPhase;
  preparationWindowDays: number;
  preparationStartsOn: string;
  source: 'admin' | 'gemini' | 'external';
  preparationWindowActive: boolean;
  relevance: 'high' | 'medium' | 'low';
  reasons: string[];
  historicalEvidence: HistoricalEvidence | null;
}

export interface CalendarIntelligence {
  restaurantId: string;
  upcoming: ScoredEvent[];
  active: ScoredEvent[];
  preparationWindows: ScoredEvent[];
  regionalEvents: ScoredEvent[];
  signals: CalendarSignal[];
  generatedAt: string;
}

// ─── Deterministic phase + relevance (spec §4/§5) ────────────────

export function deriveEventPhase(event: Pick<ICalendarEvent, 'startDate' | 'endDate' | 'preparationWindowDays'>, now: Date): EventPhase {
  const start = new Date(event.startDate).getTime();
  const end = new Date(event.endDate).getTime();
  const t = now.getTime();
  if (t > end) return 'ended';
  if (t >= start) return 'active';
  const prepStart = start - (event.preparationWindowDays > 0 ? event.preparationWindowDays : 0) * 86_400_000;
  if (t >= prepStart) return 'preparation';
  return 'not_started';
}

/**
 * Deterministic relevance scoring (spec §5): scope match, event type,
 * marketing relevance, temporal proximity, preparation window. Reasons are
 * human-readable evidence — never a sales forecast.
 */
export function scoreEventRelevance(
  event: Pick<ICalendarEvent, 'scope' | 'type' | 'marketingRelevance' | 'startDate' | 'endDate' | 'preparationWindowDays' | 'state' | 'city' | 'region'>,
  restaurant: RestaurantLocation,
  now: Date,
): { relevance: 'high' | 'medium' | 'low'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Regional applicability (state/region/city match — india/restaurant handled by the caller's filter).
  if (event.scope === 'india') {
    score += 2;
    reasons.push('National event (applies to all restaurants)');
  } else if (event.scope === 'restaurant') {
    score += 2;
    reasons.push('Restaurant-specific event');
  } else {
    const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    const matches =
      (event.scope === 'state' && eq(event.state, restaurant.state)) ||
      (event.scope === 'region' && (eq(event.region, (restaurant as { region?: string }).region) || eq(event.state, restaurant.state))) ||
      (event.scope === 'city' && eq(event.city, restaurant.city));
    if (matches) {
      score += 3;
      const where = [event.state, event.region, event.city].filter(Boolean).join(', ');
      reasons.push(`Regional event matching restaurant location${where ? `: ${where}` : ''}`);
    } else {
      reasons.push('Regional event outside restaurant location');
    }
  }

  if (event.marketingRelevance === 'high') {
    score += 2;
    reasons.push('Marked high marketing relevance');
  } else if (event.marketingRelevance === 'medium') {
    score += 1;
  }

  const daysUntil = Math.ceil((new Date(event.startDate).getTime() - now.getTime()) / 86_400_000);
  if (daysUntil >= 0 && daysUntil <= 14) {
    score += 2;
    reasons.push(`Event is within ${daysUntil <= 0 ? '0' : daysUntil} day(s)`);
  } else if (daysUntil > 14 && daysUntil <= 45) {
    score += 1;
  }

  const phase = deriveEventPhase(event, now);
  if (phase === 'preparation') {
    score += 1;
    reasons.push('Preparation window is active');
  } else if (phase === 'active') {
    score += 2;
    reasons.push('Event is currently active');
  }

  const relevance = score >= 6 ? 'high' : score >= 4 ? 'medium' : 'low';
  return { relevance, reasons };
}

// ─── Historical evidence (spec §6) — ChitKuber data only ─────────

/**
 * Look for PRIOR occurrences of the same normalized event (past years) and
 * the restaurant's campaigns/offers around those windows. Counts only —
 * no fabricated revenue/percentages. Returns null on insufficient data.
 */
export async function getHistoricalEvidence(
  event: Pick<ICalendarEvent, '_id' | 'name' | 'startDate' | 'endDate' | 'scope' | 'state' | 'city' | 'region'>,
  restaurantId: string,
  normalizeEventName: (n: string) => string,
): Promise<HistoricalEvidence | null> {
  const normalizedName = normalizeEventName(event.name);
  if (!normalizedName) return null;
  const now = Date.now();

  // Prior occurrences of this event in the calendar (ended, before now).
  const priorEvents = await CalendarEvent.find({
    _id: { $ne: event._id },
    status: { $ne: 'draft' },
    startDate: { $lt: new Date(now) },
  })
    .select('name startDate endDate')
    .limit(200)
    .lean()
    .exec();

  const windows = priorEvents
    .filter((ev) => normalizeEventName(ev.name) === normalizedName)
    .map((ev) => ({ start: new Date(ev.startDate).getTime() - 3 * 86_400_000, end: new Date(ev.endDate).getTime() + 3 * 86_400_000 }));
  if (windows.length === 0) return null; // insufficient_data

  // Campaigns around those windows (authoritative Campaign records).
  const Campaign = mongoose.model('Campaign');
  const campaigns = (await Campaign.find({
    restaurantId,
    status: { $in: ['sent', 'partial'] },
    createdAt: { $lt: new Date(now) },
  })
    .select('name createdAt offerId')
    .limit(500)
    .lean()
    .exec()) as unknown as Array<{ name: string; createdAt: Date; offerId?: mongoose.Types.ObjectId }>;

  const relevantCampaigns = campaigns.filter((c) => {
    const t = new Date(c.createdAt).getTime();
    return windows.some((w) => t >= w.start && t <= w.end) || windows.some((w) => normalizeEventName(c.name).includes(normalizedName));
  });

  // Offer types referenced by those campaigns (authoritative Offer records).
  let previousOfferTypes: string[] = [];
  if (relevantCampaigns.length > 0) {
    const offerIds = relevantCampaigns.map((c) => c.offerId).filter(Boolean) as mongoose.Types.ObjectId[];
    if (offerIds.length > 0) {
      const Offer = mongoose.model('Offer');
      const offers = (await Offer.find({ _id: { $in: offerIds } }).select('type').lean().exec()) as Array<{ type?: string }>;
      previousOfferTypes = [...new Set(offers.map((o) => o.type).filter(Boolean))] as string[];
    }
  }

  return {
    previousEvents: windows.length,
    previousCampaigns: relevantCampaigns.length,
    previousOfferTypes,
  };
}

// ─── Signal derivation (spec §2/§10) ─────────────────────────────

function signalsForEvent(ev: ScoredEvent, event: ICalendarEvent, now: Date): CalendarSignal[] {
  const signals: CalendarSignal[] = [];
  const base = {
    eventId: ev.eventId,
    eventName: ev.name,
    daysUntil: ev.daysUntil,
    scope: ev.scope,
    marketingRelevance: ev.marketingRelevance,
    relevance: ev.relevance,
    phase: ev.phase,
    preparationWindowActive: ev.preparationWindowActive,
    source: 'calendar' as const,
  };

  const push = (signalType: CalendarSignalType, extraEvidence: string[] = []) => {
    signals.push({ signalType, ...base, evidence: [...ev.reasons, ...extraEvidence] });
  };

  if (ev.phase === 'active') {
    const endInDays = Math.ceil((new Date(event.endDate).getTime() - now.getTime()) / 86_400_000);
    if (endInDays <= 2) push('festival_ending', [`Event ends in ${Math.max(endInDays, 0)} day(s)`]);
    else push('festival_active', ['Event is currently running']);
    if (event.scope === 'state' || event.scope === 'region' || event.scope === 'city') push('regional_festival');
  } else if (ev.phase === 'preparation' || ev.phase === 'not_started') {
    if (event.type === 'national_event') push('national_event_upcoming');
    else if (event.type === 'seasonal') push('seasonal_event');
    else if (event.scope === 'restaurant') push('restaurant_event');
    else if (event.scope === 'state' || event.scope === 'region' || event.scope === 'city') push('regional_festival');
    else push('festival_upcoming');
    if (ev.preparationWindowActive) push('event_preparation_window', ['Marketing preparation window is active']);
  }
  return signals;
}

// ─── Derived-intelligence cache (spec §14) ───────────────────────

interface CacheEntry {
  intelligence: CalendarIntelligence;
  expiresAt: number;
}
const CACHE_TTL_MS = 15 * 60_000; // short TTL + mutation invalidation covers date boundaries
const cache = new Map<string, CacheEntry>();

/** Called by calendar mutations so derived intelligence never goes stale. */
export function invalidateCalendarIntelligence(restaurantId?: string): void {
  if (restaurantId) cache.delete(restaurantId);
  else cache.clear();
}

// ─── Main entry (spec §9) ────────────────────────────────────────

export async function getCalendarIntelligence(
  restaurant: RestaurantLocation,
  options: { daysAhead?: number; now?: Date; forceRefresh?: boolean } = {},
): Promise<CalendarIntelligence> {
  const generatedAt = new Date().toISOString();
  const now = options.now ?? new Date();
  const daysAhead = options.daysAhead ?? 30;
  const horizon = now.getTime() + daysAhead * 86_400_000;

  if (!options.forceRefresh) {
    const hit = cache.get(restaurant.restaurantId);
    if (hit && hit.expiresAt > Date.now()) return hit.intelligence;
  }

  const startedAt = Date.now();
  const events = await CalendarEvent.find({ status: 'active' })
    .select('name type startDate endDate scope state city region restaurantId tags marketingRelevance preparationWindowDays source')
    .sort({ startDate: 1 })
    .limit(200)
    .lean()
    .exec();

  const relevant = events.filter((ev) => isEventRelevantToRestaurant(ev, restaurant));
  const inWindow = relevant.filter((ev) => new Date(ev.startDate).getTime() <= horizon || new Date(ev.endDate).getTime() >= now.getTime());

  // Historical evidence: capped to the first 5 events to stay lightweight (§19).
  const { normalizeEventName } = await import('./calendarAssistantService');
  const evidenceByEvent = new Map<string, HistoricalEvidence | null>();
  for (const ev of inWindow.slice(0, 5)) {
    evidenceByEvent.set(String(ev._id), await getHistoricalEvidence(ev, restaurant.restaurantId, normalizeEventName));
  }

  const scored: ScoredEvent[] = inWindow.map((ev) => {
    const { relevance, reasons } = scoreEventRelevance(ev, restaurant, now);
    const phase = deriveEventPhase(ev, now);
    const prepStart = new Date(new Date(ev.startDate).getTime() - ev.preparationWindowDays * 86_400_000);
    return {
      eventId: String(ev._id),
      name: ev.name,
      type: ev.type,
      startDate: new Date(ev.startDate).toISOString().slice(0, 10),
      endDate: new Date(ev.endDate).toISOString().slice(0, 10),
      daysUntil: Math.ceil((new Date(ev.startDate).getTime() - now.getTime()) / 86_400_000),
      scope: ev.scope,
      marketingRelevance: ev.marketingRelevance,
      phase,
      preparationWindowDays: ev.preparationWindowDays,
      preparationStartsOn: prepStart.toISOString().slice(0, 10),
      source: ev.source,
      preparationWindowActive: phase === 'preparation',
      relevance,
      reasons,
      historicalEvidence: evidenceByEvent.get(String(ev._id)) ?? null,
    };
  });

  const intelligence: CalendarIntelligence = {
    restaurantId: restaurant.restaurantId,
    upcoming: scored.filter((e) => e.phase === 'not_started' || e.phase === 'preparation'),
    active: scored.filter((e) => e.phase === 'active'),
    preparationWindows: scored.filter((e) => e.preparationWindowActive),
    regionalEvents: scored.filter((e) => e.scope === 'state' || e.scope === 'region' || e.scope === 'city'),
    signals: scored.flatMap((e) => {
      const ev = relevant.find((r) => String(r._id) === e.eventId) as ICalendarEvent;
      return signalsForEvent(e, ev, now);
    }),
    generatedAt,
  };

  cache.set(restaurant.restaurantId, { intelligence, expiresAt: Date.now() + CACHE_TTL_MS });
  // Observability (§17): counts + duration, no PII.
  console.log(
    `[calendar-signals] restaurantId=${restaurant.restaurantId} events=${scored.length} signals=${intelligence.signals.length} durationMs=${Date.now() - startedAt} cached=false`,
  );
  return intelligence;
}
