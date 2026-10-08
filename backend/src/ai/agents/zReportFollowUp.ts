/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportFollowUp.ts — PHASE 4 targeted follow-up investigation for the Daily
 * Summary / Z-Report Intelligence pipeline.
 *
 * WHY IT EXISTS: Batch 1/2/3 answer "what is the evidence"; the follow-up
 * answers the narrower question "what did the pack leave unresolved" — a
 * same-metric CONFLICT between sources, or a manifest movement that needs
 * predictive/segment context. It is NOT a free-form LLM tool loop.
 *
 * HARD BOUNDS (policy-enforced, not prompt-enforced):
 *   - ONE round (`Z_REPORT_FOLLOWUP_MAX_ROUNDS`).
 *   - At most `Z_REPORT_FOLLOWUP_MAX_TOOLS` tool calls, chosen by a FIXED
 *     deterministic rule table evaluated in order.
 *   - Every tool must resolve through `resolveZReportAgentTools()` — the same
 *     fail-closed policy boundary as the batches. An unregistered/forbidden
 *     name is an explicit error, never a silent skip.
 *   - NO duplicate reads: a tool already fetched by an earlier batch is never
 *     re-executed (`alreadyFetched`).
 *
 * Deterministic tools are normalized through the EXISTING canonical
 * normalizers (reusing the `defaultDimensionPlan` step); the pure-ML tools have
 * no canonical normalizer, so they are classified by the EXISTING
 * `mlSemantics` builders — predictive evidence, never fact and never causal
 * unless the upstream experiment gate passed.
 */

import { executeTool } from '../tools/registry/toolExecutor';
import type { ToolContext, ToolDefinition } from '../tools/registry/toolTypes';
import {
  Z_REPORT_FOLLOWUP_MAX_TOOLS,
  resolveZReportAgentTools,
} from './policies/zReportAgentPolicy';
import {
  defaultDimensionPlan,
  type BusinessInvestigationOptions,
} from '../intelligence/businessIntelligenceService';
import { normalizeWastage, type NormalizerInput } from '../intelligence/businessSignalNormalizers';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';
import {
  mlDegradationLines,
  responseEvidence,
  segmentEvidence,
  summarizeMlEvidence,
  upliftEvidence,
  type MlEvidence,
  type MlSignalSummary,
} from '../intelligence/mlSemantics';
import type { AiTenantContext } from '../shared/tenantContext';
import type { ZReportContext } from './zReportContext';
import type { EvidencePack } from './evidenceMerger';
import type { ZReportBatchResult } from './zReportSignals';

/** Canonical plan step (structural view — the interface itself is private). */
type PlanStep = NonNullable<BusinessInvestigationOptions['plan']>[number];

export const Z_REPORT_FOLLOWUP_BUDGET_MS = 10_000;

/**
 * ML tools the follow-up may fetch. These are the 3 predictive tools the
 * canonical Batch 1/3 plans deliberately do NOT call, so the follow-up is the
 * only stage that can add them — and it adds them only when a rule fires.
 * Each is classified by `mlSemantics` (never normalized into a fact signal).
 */
const FOLLOW_UP_ML_TOOLS = [
  'getMLCustomerSegments',
  'getUpliftSignals',
  'getOfferResponseBatchScores',
] as const;

const ML_EVIDENCE_BUILDER: Record<string, (raw: unknown) => MlEvidence> = {
  getMLCustomerSegments: (raw) => segmentEvidence(raw as never),
  getUpliftSignals: (raw) => upliftEvidence(raw as never),
  getOfferResponseBatchScores: (raw) => responseEvidence(raw as never),
};

interface FollowUpRule {
  id: string;
  /** Deterministic trigger over the ALREADY-MERGED pack. */
  when: (pack: EvidencePack) => boolean;
  /** Deterministic tools this trigger may use (allow-list members). */
  tools: string[];
  reason: string;
}

/**
 * The complete rule table, evaluated in this order and capped by
 * Z_REPORT_FOLLOWUP_MAX_TOOLS. Adding a rule is the ONLY way the follow-up can
 * reach a new tool — the LLM never selects one.
 */
const FOLLOW_UP_RULES: FollowUpRule[] = [
  {
    id: 'movement_targeting_context',
    when: (pack) =>
      pack.signals.some(
        (s) => s.code === 'sales_decline' || s.code === 'volume_aov_divergence' || s.code === 'discount_pressure',
      ),
    tools: ['getMLCustomerSegments', 'getUpliftSignals'],
    reason:
      'net revenue/volume moved with discount pressure — segment and (gated) uplift evidence locate who is driving it without re-reading the same facts',
  },
  {
    id: 'conflict_cross_check',
    when: (pack) => pack.conflicts.conflicts.length > 0,
    tools: ['getOfferResponseBatchScores'],
    reason: 'two sources disagreed on the same metric — non-causal response-model evidence helps interpret promotional effects',
  },
  {
    id: 'wastage_basket_context',
    when: (pack) => pack.signals.some((s) => s.code === 'inventory_wastage_spike' || s.code === 'inventory_wastage'),
    tools: ['getMarketBasketSignals'],
    reason: 'wastage rose — which items sell together is corroborating context for prep planning',
  },
];

export interface ZReportFollowUpResult {
  /** Normalized signals fetched by the follow-up (same canonical contract). */
  signals: BusinessSignal[];
  /** ML evidence classified by `mlSemantics` (predictive, non-causal by default). */
  mlEvidence: MlEvidence[];
  /** Owner-safe ML degradation lines. */
  mlLines: string[];
  /** Mature ML summary for the evidence pack (absent when no ML was fetched). */
  mlSummary?: MlSignalSummary;
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  unavailable: string[];
  /** Which rules fired and why (audit trail). */
  reasons: string[];
  /** Tools actually executed (deterministic order). */
  toolNames: string[];
  /** True when at least one rule fired but its tools were unavailable. */
  degraded: boolean;
  durationMs: number;
}

export interface RunFollowUpOptions {
  tenant: AiTenantContext;
  context: ZReportContext;
  pack: EvidencePack;
  /** Tool names already executed by Batch 1/2/3 — never re-read. */
  alreadyFetched?: Iterable<string>;
  executionId?: string;
  budgetMs?: number;
  /** Test seam: force the deterministic no-op (used when nothing is unclear). */
  disable?: boolean;
}

/** Plan steps available here: the canonical plan plus the wastage step. */
function followUpPlan(input: NormalizerInput, budgetMs: number): PlanStep[] {
  const canonical = defaultDimensionPlan(input, budgetMs);
  const branch = input.branchId ?? undefined;
  return [
    ...canonical,
    {
      dimension: 'inventory',
      toolName: 'getWastage',
      normalizer: 'inventory_context',
      input: { ...(branch ? { branchId: branch } : {}), lookbackDays: input.lookbackDays ?? 60 },
      timeoutMs: 4_000,
      normalize: (raw, i) => normalizeWastage(raw as never, i),
    },
  ];
}

/**
 * Decide and run the bounded follow-up. NEVER throws for data conditions: a
 * failing or unavailable tool is an explicit entry in the result.
 */
export async function runZReportFollowUp(opts: RunFollowUpOptions): Promise<ZReportFollowUpResult> {
  const startedAt = Date.now();
  const result: ZReportFollowUpResult = {
    signals: [],
    mlEvidence: [],
    mlLines: [],
    toolErrors: [],
    unavailable: [],
    reasons: [],
    toolNames: [],
    degraded: false,
    durationMs: 0,
  };

  const fired = opts.disable ? [] : FOLLOW_UP_RULES.filter((r) => r.when(opts.pack));
  const already = new Set(opts.alreadyFetched ?? []);
  const wanted: Array<{ tool: string; reason: string }> = [];
  for (const rule of fired) {
    for (const tool of rule.tools) {
      if (already.has(tool)) continue;
      if (wanted.some((w) => w.tool === tool)) continue;
      wanted.push({ tool, reason: rule.reason });
    }
  }
  const chosen = wanted.slice(0, Z_REPORT_FOLLOWUP_MAX_TOOLS);
  if (!fired.length) {
    result.durationMs = Date.now() - startedAt;
    return result; // Nothing unclear — no follow-up, no tools, no cost.
  }
  result.reasons = fired.map((r) => `${r.id}: ${r.reason}`);
  if (!chosen.length) {
    result.degraded = true;
    result.unavailable.push('followup');
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // The permission boundary: resolve through the policy (fail-closed). A
  // policy/registry problem is surfaced as an error, never swallowed.
  let byName: Map<string, ToolDefinition<unknown, unknown>>;
  try {
    byName = new Map(resolveZReportAgentTools().map((t) => [t.name, t]));
  } catch (err) {
    result.toolErrors.push({
      tool: 'resolveZReportAgentTools',
      code: 'TOOL_NOT_FOUND',
      message: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    result.degraded = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const input: NormalizerInput = {
    restaurantId: opts.context.restaurantId,
    branchId: opts.context.branchId ?? null,
    lookbackDays: 30,
  };
  const plan = followUpPlan(input, opts.budgetMs ?? Z_REPORT_FOLLOWUP_BUDGET_MS);
  const budgetMs = opts.budgetMs ?? Z_REPORT_FOLLOWUP_BUDGET_MS;
  const deadlineAt = Date.now() + budgetMs;
  const ctx: ToolContext = {
    tenant: opts.tenant,
    ...(opts.executionId ? { executionId: opts.executionId } : {}),
    deadlineAt,
  };

  for (const { tool } of chosen) {
    const def = byName.get(tool);
    if (!def) {
      result.toolErrors.push({ tool, code: 'TOOL_NOT_FOUND', message: `Follow-up tool '${tool}' is not available under the z_report policy` });
      continue;
    }
    // ML tools are classified by mlSemantics; deterministic tools are
    // normalized through their canonical step (no duplicate input logic).
    const step = FOLLOW_UP_ML_TOOLS.includes(tool as (typeof FOLLOW_UP_ML_TOOLS)[number])
      ? undefined
      : plan.find((s) => s.toolName === tool);
    const toolInput = step ? step.input : {};
    const exec = await executeTool(def, toolInput, { ...ctx, timeoutMs: step?.timeoutMs ?? 6_000 });
    result.toolNames.push(tool);
    if (!exec.ok) {
      result.toolErrors.push({ tool, code: exec.code, message: exec.message });
      if (FOLLOW_UP_ML_TOOLS.includes(tool as (typeof FOLLOW_UP_ML_TOOLS)[number])) {
        result.mlEvidence.push(ML_EVIDENCE_BUILDER[tool](null));
      }
      continue;
    }
    if (step) {
      const normalized = step.normalize(exec.data, input);
      result.signals.push(...normalized.signals);
      if (normalized.status !== 'ok') result.unavailable.push(normalized.normalizer);
      continue;
    }
    result.mlEvidence.push(ML_EVIDENCE_BUILDER[tool](exec.data));
  }

  if (result.mlEvidence.length) {
    const summary = summarizeMlEvidence(result.mlEvidence);
    result.mlSummary = summary;
    result.mlLines = mlDegradationLines(summary);
    if (!summary.availableKinds.length) result.unavailable.push('ml_evidence');
  }
  if (!result.signals.length && !result.mlEvidence.some((e) => e.available)) result.degraded = true;

  result.durationMs = Date.now() - startedAt;
  return result;
}

/** Adapt a follow-up result into the shared batch-result shape (provenance). */
export function followUpAsBatch(result: ZReportFollowUpResult, caveats: string[] = []): ZReportBatchResult {
  return {
    batch: 'followup',
    signals: result.signals,
    toolErrors: result.toolErrors,
    unavailable: result.unavailable,
    caveats,
    durationMs: result.durationMs,
  };
}
