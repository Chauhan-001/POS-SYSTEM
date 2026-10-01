/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * contextTools.ts — Context tools (spec §6). Festivals come from the real
 * festival calendar service. Weather is NOT fabricated: without a real
 * provider integration the tool reports unavailable — the agent reasons over
 * "unknown context", never invented context (spec §19/§34).
 */

import { z } from 'zod';
import { getUpcomingFestivals, getNearestFestival } from '../../../services/festivalService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

// ─── getFestivalContext ─────────────────────────────────────────────

export const getFestivalContextInputSchema = z
  .object({
    /** Look-ahead window in days (1–120). */
    maxDays: z.number().int().min(1).max(120).optional(),
  })
  .strict();

export type GetFestivalContextInput = z.infer<typeof getFestivalContextInputSchema>;

export interface FestivalContextOutput {
  available: boolean;
  reason?: 'NO_UPCOMING_FESTIVALS';
  nearest?: {
    name: string;
    date: string;
    daysAway: number;
    significance?: string;
  };
  upcoming?: Array<{
    name: string;
    date: string;
    daysAway: number;
  }>;
  /** Canonical Calendar events relevant to the tenant (Phase 2/3). */
  calendarEvents?: Array<{
    eventId: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
    scope: string;
    marketingRelevance: 'low' | 'medium' | 'high';
    preparationWindowDays: number;
    preparationStartsOn: string;
    daysUntil: number;
    source: 'admin' | 'gemini' | 'external';
    signal: 'festival_upcoming' | 'festival_active' | 'event_preparation_window';
    phase: 'not_started' | 'preparation' | 'active' | 'ended';
    relevance: 'high' | 'medium' | 'low';
    reasons: string[];
    historicalEvidence: {
      previousEvents: number;
      previousCampaigns: number;
      successfulCampaigns?: number;
      previousOfferTypes: string[];
    } | null;
  }>;
  /** Normalized context signals for the Marketing Agent (spec §16). */
  signals?: Array<{
    signal: string;
    event: string;
    daysUntil: number;
    marketingRelevance: 'low' | 'medium' | 'high';
    scope: string;
  }>;
  /** Phase 3 buckets — normalized intelligence (spec §9). */
  buckets?: {
    upcoming: unknown[];
    active: unknown[];
    preparationWindows: unknown[];
    regionalEvents: unknown[];
    signals: unknown[];
  };
  generatedAt: string;
}

export async function executeGetFestivalContext(
  input: GetFestivalContextInput,
  ctx: ToolContext,
): Promise<FestivalContextOutput> {
  const generatedAt = new Date().toISOString();
  const now = new Date();
  const maxDays = input.maxDays ?? 30;

  // Deterministic base layer (festivalService curated table).
  const upcoming = getUpcomingFestivals(maxDays);
  const nearest = getNearestFestival();

  // Canonical Calendar layer (Phase 3): the signal engine converts approved
  // events into normalized, cached, evidence-based intelligence — the agent
  // never queries MongoDB or the LLM for this (spec §8/§12/§19).
  let calendarEvents: FestivalContextOutput['calendarEvents'] = [];
  let signals: FestivalContextOutput['signals'] = [];
  let buckets: FestivalContextOutput['buckets'] | undefined;
  try {
    const Restaurant = (await import('../../../models/core/Restaurant')).default;
    const restaurant = await Restaurant.findById(ctx.tenant.restaurantId)
      .select('state city')
      .lean()
      .exec();
    const { getCalendarIntelligence } = await import(
      '../../../modules/calendar/services/calendarSignalEngine'
    );
    // Phase 3: the signal engine does the deterministic work (phase, relevance
    // scoring, historical evidence, signals) — cached, no LLM, single query.
    const intelligence = await getCalendarIntelligence(
      {
        restaurantId: ctx.tenant.restaurantId,
        state: restaurant?.state,
        city: restaurant?.city,
      },
      { daysAhead: maxDays, now },
    );

    const allScored = [...intelligence.upcoming, ...intelligence.active];

    calendarEvents = allScored.slice(0, 20).map((ev) => ({
      eventId: ev.eventId,
      name: ev.name,
      type: ev.type,
      startDate: ev.startDate,
      endDate: ev.endDate,
      scope: ev.scope,
      marketingRelevance: ev.marketingRelevance,
      preparationWindowDays: ev.preparationWindowDays,
      preparationStartsOn: ev.preparationStartsOn,
      daysUntil: ev.daysUntil,
      source: ev.source,
      signal: (ev.phase === 'active'
        ? 'festival_active'
        : ev.preparationWindowActive
          ? 'event_preparation_window'
          : 'festival_upcoming') as 'festival_active' | 'event_preparation_window' | 'festival_upcoming',
      phase: ev.phase,
      relevance: ev.relevance,
      reasons: ev.reasons,
      historicalEvidence: ev.historicalEvidence,
    }));

    signals = intelligence.signals.map((s) => ({
      signal: s.signalType,
      event: s.eventName,
      daysUntil: s.daysUntil,
      marketingRelevance: s.marketingRelevance,
      scope: s.scope,
    }));

    buckets = {
      upcoming: intelligence.upcoming,
      active: intelligence.active,
      preparationWindows: intelligence.preparationWindows,
      regionalEvents: intelligence.regionalEvents,
      signals: intelligence.signals,
    };
  } catch {
    // Calendar layer is additive — a failure must never break the base tool.
  }

  if (upcoming.length === 0 && calendarEvents.length === 0) {
    return { available: false, reason: 'NO_UPCOMING_FESTIVALS', generatedAt };
  }
  return {
    available: true,
    nearest: nearest
      ? {
          name: nearest.name,
          date: new Date(nearest.date).toISOString().slice(0, 10),
          daysAway: Math.ceil((new Date(nearest.date).getTime() - now.getTime()) / 86_400_000),
          significance: (nearest as any).significance,
        }
      : undefined,
    upcoming: upcoming.slice(0, 10).map((f) => ({
      name: f.name,
      date: new Date(f.date).toISOString().slice(0, 10),
      daysAway: Math.ceil((new Date(f.date).getTime() - now.getTime()) / 86_400_000),
    })),
    calendarEvents,
    signals,
    buckets,
    generatedAt,
  };
}

export const getFestivalContextToolDefinition: ToolDefinition<GetFestivalContextInput, FestivalContextOutput> = {
  name: 'getFestivalContext',
  category: 'context',
  access: 'read',
  meta: {
    description:
      'Upcoming festivals and calendar events relevant to this restaurant (default 30 days): names, dates, days remaining, marketing relevance and preparation windows — from the deterministic festival table plus the approved Context Calendar. Contains no AI-invented data.',
    source: 'services/festivalService.ts + modules/calendar (approved events only)',
  },
  inputSchema: getFestivalContextInputSchema,
  execute: executeGetFestivalContext,
};

// ─── getWeatherContext ──────────────────────────────────────────────

export const getWeatherContextInputSchema = z.object({}).strict();
export type GetWeatherContextInput = z.infer<typeof getWeatherContextInputSchema>;

export interface WeatherContextOutput {
  available: false;
  reason: 'NO_WEATHER_PROVIDER';
  generatedAt: string;
}

/**
 * Deliberately returns the unavailable state: the platform has weather
 * intelligence consumers (weatherIntelligenceService) but no live provider
 * wired into the AI layer. When a real provider lands, this tool adapts it —
 * it must never return invented conditions.
 */
export async function executeGetWeatherContext(
  _input: GetWeatherContextInput,
  _ctx: ToolContext,
): Promise<WeatherContextOutput> {
  return { available: false, reason: 'NO_WEATHER_PROVIDER', generatedAt: new Date().toISOString() };
}

export const getWeatherContextToolDefinition: ToolDefinition<GetWeatherContextInput, WeatherContextOutput> = {
  name: 'getWeatherContext',
  category: 'context',
  access: 'read',
  meta: {
    description:
      'Current weather context for the restaurant area. Currently unavailable (no provider connected) — callers must proceed without weather assumptions.',
    source: 'none yet — reserved for a real provider integration',
  },
  inputSchema: getWeatherContextInputSchema,
  execute: executeGetWeatherContext,
};
