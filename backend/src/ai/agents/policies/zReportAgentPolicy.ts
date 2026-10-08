/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportAgentPolicy.ts — the permission boundary for the Daily Summary
 * (Z-Report Intelligence) pipeline.
 *
 * The Z-report pipeline does NOT use the free-form bounded agent loop: it uses
 * PROGRESSIVE EVIDENCE COLLECTION (context builder → Batch 1 deterministic
 * facts → Batch 2 derived intelligence → Batch 3 conditional ML/context →
 * single LLM synthesis → deterministic critic). This policy exists to keep the
 * two tool-touching stages strictly bounded:
 *
 *   1. Batch 1/3 evidence gathering resolves its tools through the ONE shared
 *      registry via `resolveAllowedTools` (fail-closed, same as every agent).
 *   2. The targeted FOLLOW-UP stage may only investigate with tools from this
 *      allow-list — never a free-form LLM tool loop.
 *
 * Every listed tool must be `access: 'read'` in the shared registry. Nothing
 * here registers or defines a tool.
 */

import { resolveAllowedTools, describeAllowedTools } from '../../tools/registry/toolResolver';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import type { AgentBudgetLimits } from '../../shared/agentRunContext';
import type { AgentPolicy } from './marketingAgentPolicy';

/**
 * Exact existing tool names the Daily Summary pipeline may execute.
 *
 * All names are verified entries of the shared registry:
 *   - 12 deterministic fact tools (Batch 1 dimensions)
 *   - 9 ML/context tools (Batch 3, availability-gated per run)
 *   - getProductCombinations (follow-up only — explains which products moved together)
 *
 * Deliberately EXCLUDED (not part of a daily summary): getPromotionCandidates
 * and getOfferResponsePrediction (marketing-pipeline specifics), getBranches
 * and getRestaurantProfile (context builder reads services directly).
 */
export const Z_REPORT_AGENT_ALLOWED_TOOLS = [
  // Batch 1 — deterministic core facts
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getInventoryStatus',
  'getExpiryRisk',
  'getStockoutRisk',
  'getWastage',
  'getCustomerSegments',
  'getRetentionSignals',
  'getActiveOffers',
  'getOfferPerformance',
  'getCampaignPerformance',
  // Batch 3 — ML evidence (availability-gated, predictive not factual)
  'getDemandForecast',
  'getMLCustomerSegments',
  'getMarketBasketSignals',
  'getUpliftSignals',
  'getOfferResponseBatchScores',
  // Batch 3 — external context (each may honestly return available:false)
  'getFestivalContext',
  'getSportsContext',
  'getNearbyCompetition',
  'getWeatherContext',
  // Follow-up only
  'getProductCombinations',
] as const;

export const zReportAgentPolicy: AgentPolicy = {
  agent: 'z_report',
  allowedTools: Z_REPORT_AGENT_ALLOWED_TOOLS,
};

/**
 * Budgets for ONE daily-summary run. These are CEILINGS over the whole
 * pipeline (evidence gathering + follow-up + ONE synthesis call), not a loop
 * budget: Batch 1 runs as one parallel fan-out inside `budgetMs`, the
 * follow-up stage adds at most one round of ≤4 tools, and the LLM receives
 * the already-normalized EvidencePack.
 */
export const Z_REPORT_AGENT_BUDGET: Partial<AgentBudgetLimits> = {
  maxSteps: 2, // no agentic loop: evidence pass + (optional) follow-up pass
  maxToolCalls: 8, // hard ceiling on FOLLOW-UP tool calls (spec: maxFollowUpTools=4/round)
  durationMs: 45_000, // whole pipeline worst case
  maxTokens: 24_000, // ONE synthesis call over a compact evidence pack
  maxCostUsd: 0.15,
};

/** Prompt version recorded on every usage row for this agent. */
export const Z_REPORT_AGENT_PROMPT_VERSION = 'z-report-daily-v1';

/**
 * Follow-up guardrails (spec §16): ONE round, at most 4 tools, deterministic
 * triggers only. The trigger → investigation mapping lives in
 * `zReportFollowUp.ts`; this policy is the hard permission boundary both
 * stages are resolved through.
 */
export const Z_REPORT_FOLLOWUP_MAX_ROUNDS = 1;
export const Z_REPORT_FOLLOWUP_MAX_TOOLS = 4;

/** Wall-clock budget for the Batch-1 parallel evidence fan-out. */
export const Z_REPORT_BATCH1_BUDGET_MS = 12_000;

/** Wall-clock budget for the conditional Batch-3 ML/context fan-out. */
export const Z_REPORT_BATCH3_BUDGET_MS = 8_000;

/**
 * Resolve the policy against the shared registry. FAIL CLOSED: an unknown or
 * unregistered name throws `AiError('TOOL_NOT_FOUND')` — the run never starts
 * with a silently smaller tool set.
 */
export function resolveZReportAgentTools(): ToolDefinition<unknown, unknown>[] {
  return resolveAllowedTools(Z_REPORT_AGENT_ALLOWED_TOOLS);
}

/** Read-only tool catalog for prompt construction (name/description/access/category). */
export function zReportAgentToolCatalog() {
  return describeAllowedTools(Z_REPORT_AGENT_ALLOWED_TOOLS);
}
