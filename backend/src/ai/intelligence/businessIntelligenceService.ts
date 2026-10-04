/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * businessIntelligenceService.ts — PHASE 3 canonical business-intelligence
 * layer for the Marketing Agent.
 *
 * WHAT IT IS: a thin, tenant-scoped aggregator that
 *   1. fetches business data ONLY through the ONE shared tool registry
 *      (`toolRegistry` + `executeTool` — no direct service calls, no new
 *      read paths, no duplicated queries),
 *   2. normalizes each tool output into canonical `BusinessSignal`s
 *      (pure functions in businessSignalNormalizers.ts), and
 *   3. returns a prioritized, evidence-carrying investigation view.
 *
 * WHAT IT IS NOT: not a signal store, not a recommendation engine, not a
 * replacement for the authoritative services. It never writes anything.
 * Persisted IntelligenceSignal rows keep being produced by the existing
 * scheduler/services — this layer reads live data through the same tools the
 * agent is allowed to call.
 *
 * Tenant identity: only from `ToolContext.tenant` (authenticated). The
 * LLM never supplies restaurantId/branchId; a caller-supplied branchId is
 * validated by each tool against the tenant (TOOL_TENANT_MISMATCH).
 */

import { toolRegistry } from '../tools/registry/toolRegistry';
import { executeTool } from '../tools/registry/toolExecutor';
import type { ToolContext, ToolDefinition } from '../tools/registry/toolTypes';
import type { AiTenantContext } from '../shared/tenantContext';
import { AiError } from '../shared/aiErrors';
import {
  type BusinessSignal,
  type BusinessSignalSource,
  type SignalNormalizationResult,
  isUsableFreshness,
} from './businessSignalTypes';
import {
  type NormalizerInput,
  normalizeActiveOffers,
  normalizeCampaignPerformance,
  normalizeCompetitionContext,
  normalizeCustomerSegments,
  normalizeDemandForecast,
  normalizeExpiryRisk,
  normalizeFestivalContext,
  normalizeInventoryStatus,
  normalizeMarketBasket,
  normalizeMenuPerformance,
  normalizeOfferPerformance,
  normalizeProductMargins,
  normalizeRetentionSignals,
  normalizeSalesTrends,
  normalizeSportsContext,
  normalizeStockoutRisk,
  normalizeWeatherContext,
} from './businessSignalNormalizers';

// ─────────────────────────────────────────────────────────────────────────────
// Dimension plan: which existing tool feeds which normalizer
// ─────────────────────────────────────────────────────────────────────────────

/** Dimensions the agent can investigate. */
export const BUSINESS_DIMENSIONS = [
  'sales',
  'menu',
  'margin',
  'inventory',
  'customer',
  'marketing',
  'demand',
  'basket',
  'context',
] as const;

export type BusinessDimension = (typeof BUSINESS_DIMENSIONS)[number];

interface DimensionStep {
  dimension: BusinessDimension;
  toolName: string;
  /** Explicit normalizer identity (function `.name` is unreliable for inline arrows). */
  normalizer: BusinessSignalSource;
  /** Tool input (never contains tenant identity). */
  input: Record<string, unknown>;
  /** Adapter from raw tool output → normalized signals. */
  normalize: (raw: unknown, input: NormalizerInput) => SignalNormalizationResult;
  /** Upper bound on this tool's own timeout (executor clamps further). */
  timeoutMs: number;
}

/**
 * Default investigation plan — a spread of dimensions that fits the agent's
 * bounded tool budget. Each entry references an EXISTING registry tool by
 * name (resolution is fail-closed: a missing tool becomes an explicit error
 * result, never a silent skip).
 */
export function defaultDimensionPlan(input: NormalizerInput, budgetMs = 8_000): DimensionStep[] {
  const branch = input.branchId ?? undefined;
  const toolInput = (extra: Record<string, unknown> = {}) => (branch ? { branchId: branch, ...extra } : { ...extra });
  // Dimensions run in PARALLEL (independent read-only calls), so each tool may
  // use a healthy slice of the budget instead of a tiny serial share.
  const perTool = Math.max(2_000, Math.min(8_000, Math.floor(budgetMs / 2)));

  return [
    {
      dimension: 'sales',
      toolName: 'getSalesTrends',
      normalizer: 'sales_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeSalesTrends(raw as never, i),
    },
    {
      dimension: 'menu',
      toolName: 'getMenuPerformance',
      normalizer: 'menu_engineering',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeMenuPerformance(raw as never, i),
    },
    {
      dimension: 'margin',
      toolName: 'getProductMargins',
      normalizer: 'cost_intelligence',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeProductMargins(raw as never, i),
    },
    {
      dimension: 'inventory',
      toolName: 'getInventoryStatus',
      normalizer: 'inventory_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeInventoryStatus(raw as never, i),
    },
    {
      dimension: 'inventory',
      toolName: 'getExpiryRisk',
      normalizer: 'inventory_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeExpiryRisk(raw as never, i),
    },
    {
      dimension: 'inventory',
      toolName: 'getStockoutRisk',
      normalizer: 'inventory_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeStockoutRisk(raw as never, i),
    },
    {
      dimension: 'customer',
      toolName: 'getCustomerSegments',
      normalizer: 'customer_segments',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeCustomerSegments(raw as never, i),
    },
    {
      dimension: 'customer',
      toolName: 'getRetentionSignals',
      normalizer: 'retention_signals',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeRetentionSignals(raw as never, i),
    },
    {
      dimension: 'marketing',
      toolName: 'getActiveOffers',
      normalizer: 'offer_performance',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeActiveOffers(raw as never, i),
    },
    {
      dimension: 'marketing',
      toolName: 'getOfferPerformance',
      normalizer: 'offer_performance',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeOfferPerformance(raw as never, i),
    },
    {
      dimension: 'marketing',
      toolName: 'getCampaignPerformance',
      normalizer: 'campaign_performance',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeCampaignPerformance(raw as never, i),
    },
    {
      dimension: 'demand',
      toolName: 'getDemandForecast',
      normalizer: 'demand_forecast',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeDemandForecast(raw as never, i),
    },
    {
      dimension: 'basket',
      toolName: 'getMarketBasketSignals',
      normalizer: 'market_basket',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeMarketBasket(raw as never, i),
    },
    {
      dimension: 'context',
      toolName: 'getFestivalContext',
      normalizer: 'festival_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeFestivalContext(raw as never, i),
    },
    {
      dimension: 'context',
      toolName: 'getSportsContext',
      normalizer: 'sports_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeSportsContext(raw as never, i),
    },
    {
      dimension: 'context',
      toolName: 'getNearbyCompetition',
      normalizer: 'competition_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeCompetitionContext(raw as never, i),
    },
    {
      dimension: 'context',
      toolName: 'getWeatherContext',
      normalizer: 'weather_context',
      input: toolInput(),
      timeoutMs: perTool,
      normalize: (raw, i) => normalizeWeatherContext(raw as never, i),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Investigation result
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessInvestigation {
  /** Normalized signals from every dimension that produced evidence. */
  signals: BusinessSignal[];
  /** Per-dimension outcome (status/reason/caveats) — honest about gaps. */
  dimensions: Array<{
    dimension: BusinessDimension;
    normalizer: BusinessSignalSource;
    status: SignalNormalizationResult['status'];
    signalCount: number;
    reason?: string;
    caveats: string[];
  }>;
  /** Dimensions with NO usable evidence (agent must not invent them). */
  unavailableDimensions: string[];
  /** Tool failures (code + message) — never hidden, never fatal. */
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  /** Fresh vs stale split (stale signals must never be presented as current). */
  freshness: Record<BusinessSignal['freshness'], number>;
  /** Most important signals first (deterministic ordering). */
  topSignals: BusinessSignal[];
  generatedAt: string;
  /** True when at least one dimension returned usable evidence. */
  usable: boolean;
}

export interface BusinessInvestigationOptions {
  tenant: AiTenantContext;
  branchId?: string;
  /** Restrict the investigation to a subset of dimensions. */
  dimensions?: BusinessDimension[];
  /** Wall-clock budget for the whole fan-out. */
  budgetMs?: number;
  /** Override the plan (tests / targeted investigation). */
  plan?: DimensionStep[];
  /** Optional correlation id (forwarded to ToolContext). */
  executionId?: string;
}

/** Deterministic ordering weight: fresher + higher confidence first. */
const FRESHNESS_WEIGHT: Record<BusinessSignal['freshness'], number> = {
  fresh: 1,
  aging: 0.8,
  unknown: 0.6,
  stale: 0.2,
  expired: 0,
};

function signalPriority(s: BusinessSignal): number {
  return FRESHNESS_WEIGHT[s.freshness] * 100 + s.confidence * 50 + Math.min(s.sampleSize ?? 0, 100) / 10;
}

/**
 * Run the canonical business investigation.
 *
 * NEVER throws for data problems: a failing tool becomes a `toolErrors` entry
 * and its dimension is reported unavailable. Throws only on invalid tenant
 * identity (programming/security error, not a data condition).
 */
export async function investigateBusiness(
  options: BusinessInvestigationOptions,
): Promise<BusinessInvestigation> {
  const startedAt = Date.now();
  const restaurantId = options.tenant?.restaurantId;
  if (!restaurantId || !/^[a-fA-F0-9]{24}$/.test(restaurantId)) {
    throw new AiError('TOOL_TENANT_MISMATCH', 'investigateBusiness requires an authenticated tenant with a valid restaurantId');
  }

  const budgetMs = options.budgetMs ?? 12_000;
  const deadlineAt = startedAt + budgetMs;
  const input: NormalizerInput = {
    restaurantId,
    branchId: options.branchId ?? options.tenant.branchId ?? null,
    lookbackDays: 90,
  };

  const fullPlan = options.plan ?? defaultDimensionPlan(input, budgetMs);
  const plan = options.dimensions
    ? fullPlan.filter((step) => options.dimensions!.includes(step.dimension))
    : fullPlan;

  const ctx: ToolContext = {
    tenant: options.tenant,
    executionId: options.executionId,
    deadlineAt,
  };

  const signals: BusinessSignal[] = [];
  const dimensions: BusinessInvestigation['dimensions'] = [];
  const toolErrors: BusinessInvestigation['toolErrors'] = [];
  const freshness: Record<BusinessSignal['freshness'], number> = { fresh: 0, aging: 0, stale: 0, unknown: 0, expired: 0 };

  // ── Parallel fan-out ──────────────────────────────────────────────────────
  // Each dimension is an independent read-only call; running them in parallel
  // keeps the whole investigation inside the budget (a serial pass starves
  // the later tools). Results are re-ordered to the plan's order below so the
  // output stays deterministic regardless of completion timing.
  const settled = await Promise.all(
    plan.map(async (step) => {
      if (Date.now() >= deadlineAt) {
        return {
          step,
          entry: {
            dimension: step.dimension,
            normalizer: step.normalizer,
            status: 'error' as const,
            signalCount: 0,
            reason: 'BUDGET_EXHAUSTED',
            caveats: [],
          },
          error: { tool: step.toolName, code: 'BUDGET_EXHAUSTED', message: 'Investigation budget exhausted before this dimension ran' },
          normalized: null,
        };
      }

      // Fail-closed resolution: a missing tool is an explicit error, never a skip.
      // NOTE: the shared registry returns undefined for unknown names (it does
      // not throw) — check explicitly instead of relying on a thrown error.
      const resolved = toolRegistry.get(step.toolName) as ToolDefinition<unknown, unknown> | undefined;
      if (!resolved) {
        return {
          step,
          entry: {
            dimension: step.dimension,
            normalizer: step.normalizer,
            status: 'error' as const,
            signalCount: 0,
            reason: 'TOOL_NOT_FOUND',
            caveats: [],
          },
          error: { tool: step.toolName, code: 'TOOL_NOT_FOUND', message: `Tool '${step.toolName}' is not registered` },
          normalized: null,
        };
      }

      const exec = await executeTool(resolved, step.input, { ...ctx, timeoutMs: step.timeoutMs });
      if (!exec.ok) {
        return {
          step,
          entry: {
            dimension: step.dimension,
            normalizer: step.normalizer,
            status: 'error' as const,
            signalCount: 0,
            reason: exec.code,
            caveats: [],
          },
          error: { tool: step.toolName, code: exec.code, message: exec.message },
          normalized: null,
        };
      }

      const normalized = step.normalize(exec.data, input);
      return {
        step,
        entry: {
          dimension: step.dimension,
          normalizer: normalized.normalizer,
          status: normalized.status,
          signalCount: normalized.signals.length,
          reason: normalized.reason,
          caveats: normalized.caveats,
        },
        error: null,
        normalized,
      };
    }),
  );

  // Assemble in plan order — deterministic output independent of timing.
  for (const s of settled) {
    dimensions.push(s.entry);
    if (s.error) toolErrors.push(s.error);
    if (s.normalized) {
      for (const sig of s.normalized.signals) {
        signals.push(sig);
        freshness[sig.freshness] += 1;
      }
    }
  }

  const ordered = [...signals].sort((a, b) => {
    const d = signalPriority(b) - signalPriority(a);
    if (d !== 0) return d;
    return a.signalId.localeCompare(b.signalId); // stable, deterministic tiebreak
  });

  const unavailableDimensions = [
    ...new Set(dimensions.filter((d) => d.signalCount === 0).map((d) => d.dimension)),
  ];

  return {
    signals,
    dimensions,
    unavailableDimensions,
    toolErrors,
    freshness,
    topSignals: ordered.slice(0, 30),
    generatedAt: new Date().toISOString(),
    usable: signals.some((s) => isUsableFreshness(s.freshness)),
  };
}

/**
 * Compact evidence lines for the agent prompt / owner UI. Stale signals are
 * explicitly labelled so they are never presented as current.
 */
export function businessInvestigationLines(investigation: BusinessInvestigation, limit = 12): string[] {
  return investigation.topSignals.slice(0, limit).map((s) => {
    const staleNote = s.freshness === 'stale' ? ' [STALE — do not treat as current]' : '';
    const conf = `(confidence ${(s.confidence * 100).toFixed(0)}%${s.sampleSize !== undefined ? `, n=${s.sampleSize}` : ''})`;
    return `${s.statement} ${conf}${staleNote}`;
  });
}

/** Summary counts for observability (never raw business data). */
export function businessInvestigationSummary(investigation: BusinessInvestigation) {
  return {
    signals: investigation.signals.length,
    usable: investigation.usable,
    unavailableDimensions: investigation.unavailableDimensions,
    toolErrors: investigation.toolErrors.length,
    freshness: investigation.freshness,
  };
}
