/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getSportsContextTool.ts — Sports context tool (spec §15/§16). Backend calls
 * CricAPI through the cricket service; the LLM sees only normalized context
 * and NEVER receives the API key or provider URL (spec §22). Tenant identity
 * comes from ctx — the model cannot pass a restaurantId (spec §16).
 *
 * Unavailable-vs-empty is explicit (spec §19): the agent can distinguish
 * "provider down" from "no matches in window".
 */

import { z } from 'zod';
import { getSportsContext } from '../../../context/sports/cricket/cricketService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getSportsContextInputSchema = z
  .object({
    /** Look-ahead window in days (1–60). Default 14. */
    daysAhead: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export type GetSportsContextInput = z.infer<typeof getSportsContextInputSchema>;

export interface SportsContextToolOutput {
  available: boolean;
  sport: 'cricket';
  /** 'ok' | 'no_api_key' | 'disabled' | 'provider_unavailable' | 'provider_error' */
  reason?: string;
  /** Phase-1 compat: upcoming matches. */
  events: Array<{
    externalId: string;
    name: string;
    matchType: string;
    status: string;
    venue?: string;
    date: string;
    dateTimeGMT?: string;
    teams?: string[];
    isIndiaMatch: boolean;
    tournament?: string;
    relevance: 'high' | 'medium' | 'low';
    source: 'cricapi';
  }>;
  /** Phase 2: relevant, restaurant-localized matches with deterministic signals. */
  relevantMatches?: Array<{
    matchId: string;
    name: string;
    competition: string;
    matchType: string;
    status: string;
    isIndiaMatch: boolean;
    date: string;
    dateTimeGMT?: string;
    localDateTime?: string;
    timezone?: string;
    venue?: string;
    timeWindow: string;
    operatingHoursOverlap: string;
    relevance: 'high' | 'medium' | 'low';
    signals: string[];
  }>;
  /**
   * Phase 3: canonical cross-source signals — the SAME shape getFestivalContext
   * uses (signal/event/relevance/evidence), so the Marketing Agent combines
   * cricket, calendar and future sources without a per-source format.
   */
  contextSignals?: Array<{
    source: 'cricket';
    signalType: string;
    relevance: 'high' | 'medium' | 'low';
    eventId: string;
    eventName: string;
    /** Restaurant-local start time (or GMT fallback) — RFC-3339-ish string. */
    startAt?: string;
    evidence: string[];
    generatedAt: string;
  }>;
  /** 'fresh' | 'stale' — stale data is labeled, never silent (spec §16). */
  dataStatus?: 'fresh' | 'stale';
  providerAvailable?: boolean;
  /** Cache freshness so the agent knows how recent the data is. */
  fetchedAt?: string;
  generatedAt: string;
}

export async function executeGetSportsContext(
  input: GetSportsContextInput,
  ctx: ToolContext,
): Promise<SportsContextToolOutput> {
  // Tenant identity injected server-side from ctx (never from the model) —
  // used only to load the restaurant's timezone (spec §16/§22 cricket P2).
  const result = await getSportsContext({
    daysAhead: input.daysAhead ?? 14,
    restaurantId: ctx.tenant.restaurantId,
  });
  return {
    available: result.available,
    sport: 'cricket',
    reason: result.reason,
    events: result.events.map((e) => ({
      externalId: e.externalId,
      name: e.name,
      matchType: e.matchType,
      status: e.status,
      venue: e.venue,
      date: e.date,
      dateTimeGMT: e.dateTimeGMT,
      teams: e.teams,
      isIndiaMatch: e.isIndiaMatch,
      tournament: e.tournament,
      relevance: e.relevance,
      source: e.source,
    })),
    relevantMatches: result.relevantMatches?.map((m) => ({
      matchId: m.externalId,
      name: m.name,
      competition: m.competition,
      matchType: m.matchType,
      status: m.status,
      isIndiaMatch: m.isIndiaMatch,
      date: m.date,
      dateTimeGMT: m.dateTimeGMT,
      localDateTime: m.localDateTime,
      timezone: m.timezone,
      venue: m.venue,
      timeWindow: m.timeWindow,
      operatingHoursOverlap: m.operatingHoursOverlap,
      relevance: m.relevance === 'irrelevant' ? ('low' as const) : m.relevance,
      signals: m.signals.map((s) => s.signalType),
    })),
    dataStatus: result.dataStatus,
    providerAvailable: result.providerAvailable,
    fetchedAt: result.cacheInfo?.fetchedAt,
    contextSignals: (result.relevantMatches ?? []).flatMap((m) =>
      m.signals.map((s) => ({
        source: 'cricket' as const,
        signalType: s.signalType,
        relevance: m.relevance === 'irrelevant' ? ('low' as const) : m.relevance,
        eventId: m.externalId,
        eventName: m.name,
        startAt: m.localDateTime ?? m.dateTimeGMT,
        evidence: s.evidence,
        generatedAt: s.generatedAt,
      })),
    ),
    generatedAt: result.generatedAt,
  };
}

export const getSportsContextToolDefinition: ToolDefinition<
  GetSportsContextInput,
  SportsContextToolOutput
> = {
  name: 'getSportsContext',
  category: 'context',
  access: 'read',
  meta: {
    description:
      'Relevant upcoming cricket matches for this restaurant (normalized from CricAPI): competition class, India involvement, restaurant-local start time, deterministic relevance tiers and evidence signals. A context signal for marketing decisions — never a trigger for automatic campaigns. Stale provider data is labeled; unavailable is never reported as no matches.',
    source: 'context/sports/cricket (CricAPI /v1/matches, cached)',
  },
  inputSchema: getSportsContextInputSchema,
  execute: executeGetSportsContext,
};
