/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getNearbyCompetitionTool.ts — Competition context tool (Phase 2, spec §18/§19).
 * The Marketing Agent sees ONLY normalized, intelligence-ready context —
 * never the Google API key, never a raw Places response (spec §15/§27).
 * Tenant identity comes from ctx; the model cannot pass a restaurantId.
 *
 * Unavailable-vs-empty is explicit (spec §26): missing coordinates, disabled
 * config, provider failure and a genuinely empty radius are distinct states.
 */

import { z } from 'zod';
import { getNearbyCompetition } from '../../../context/competition/competitionService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getNearbyCompetitionInputSchema = z
  .object({
    /** Force a provider refresh instead of using a fresh cache (default false). */
    refresh: z.boolean().optional(),
  })
  .strict();

export type GetNearbyCompetitionInput = z.infer<typeof getNearbyCompetitionInputSchema>;

/** Flat competitor DTO — Places fields the app actually uses, nothing more. */
export interface CompetitorDTO {
  placeId: string;
  name: string;
  distanceMeters?: number;
  primaryType?: string;
}

export interface NearbyCompetitionToolOutput {
  available: boolean;
  /** 'ok' | 'no_competitors' | 'disabled' | 'no_api_key' | 'location_unavailable' | 'provider_unavailable' | 'provider_error' */
  reason?: string;
  /** 'fresh' | 'stale' | 'unavailable' — staleness is labeled, never silent. */
  dataStatus?: 'fresh' | 'stale' | 'unavailable';
  providerAvailable?: boolean;
  lastRefreshedAt?: string;
  searchRadiusMeters: number;
  summary?: {
    totalCompetitors: number;
    within500m: number;
    within1km: number;
    within2km: number;
    nearestDistanceMeters?: number;
    densityPerKm2?: number;
    density: string;
  };
  categoryDistribution?: Array<{ type: string; count: number }>;
  cuisineOverlap?: {
    status: 'match' | 'unknown';
    overlappingCompetitors: number;
  };
  signals?: Array<{
    signalType: string;
    relevance: 'high' | 'medium' | 'low';
    evidence: string[];
    /** Phase 3 §4: how current the underlying provider data is. */
    freshness: {
      status: 'fresh' | 'stale';
      fetchedAt: string;
      ageSeconds: number;
    };
  }>;
  /** Plain-language, overclaim-safe evidence line (proximity only). */
  summaryText?: string;
  generatedAt: string;
}

export async function executeGetNearbyCompetition(
  input: GetNearbyCompetitionInput,
  ctx: ToolContext,
): Promise<NearbyCompetitionToolOutput> {
  // Tenant identity injected server-side from ctx (never from the model) —
  // the agent can only ever see its own restaurant's competition context.
  const result = await getNearbyCompetition({
    restaurantId: ctx.tenant.restaurantId,
    refresh: input.refresh ? 'force' : 'auto',
  });

  return {
    available: result.available,
    reason: result.reason,
    dataStatus: result.dataStatus,
    providerAvailable: result.providerAvailable,
    lastRefreshedAt: result.lastRefreshedAt,
    searchRadiusMeters: result.searchRadiusMeters,
    summary: result.intelligence
      ? {
          totalCompetitors: result.intelligence.summary.totalCompetitors,
          within500m: result.intelligence.summary.within500m,
          within1km: result.intelligence.summary.within1km,
          within2km: result.intelligence.summary.within2km,
          nearestDistanceMeters: result.intelligence.summary.nearestDistanceMeters,
          densityPerKm2: result.intelligence.summary.densityPerKm2,
          density: result.intelligence.summary.density,
        }
      : undefined,
    categoryDistribution: result.intelligence?.summary.primaryTypeDistribution,
    cuisineOverlap: result.intelligence
      ? {
          status: result.intelligence.summary.cuisineOverlap.status,
          overlappingCompetitors: result.intelligence.summary.cuisineOverlap.overlappingCompetitors,
        }
      : undefined,
    signals: result.intelligence?.signals.map((s) => ({
      signalType: s.signalType,
      relevance: s.relevance,
      evidence: s.evidence,
      freshness: s.freshness,
    })),
    summaryText: result.summary,
    generatedAt: result.generatedAt,
  };
}

export const getNearbyCompetitionToolDefinition: ToolDefinition<
  GetNearbyCompetitionInput,
  NearbyCompetitionToolOutput
> = {
  name: 'getNearbyCompetition',
  category: 'context',
  access: 'read',
  meta: {
    description:
      'Nearby restaurant competition context for this restaurant (normalized from Google Places): distance buckets, density, category distribution, cuisine overlap and evidence-based signals. Proximity context only — contains no claims about competitor performance and never triggers campaigns by itself. Stale provider data is labeled; unavailable is never reported as empty.',
    source: 'context/competition (Google Places Nearby Search, cached)',
  },
  inputSchema: getNearbyCompetitionInputSchema,
  execute: executeGetNearbyCompetition,
};
