/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentPolicy.ts — the permission boundary for the Marketing Agent
 * (spec §5/§16). Tools are NEVER imported or registered here: the policy only
 * lists exact names of tools that already exist in the ONE shared registry,
 * and resolution goes through `resolveAllowedTools` (fail-closed — an unknown
 * name throws instead of silently shrinking the allow-list).
 *
 * Budgets bound every run (steps, tool calls, wall-clock, tokens, cost).
 * The policy never grants write access: every listed tool must be `access:'read'`.
 */

import { resolveAllowedTools, describeAllowedTools } from '../../tools/registry/toolResolver';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import type { AgentBudgetLimits } from '../../shared/agentRunContext';

/**
 * Exact existing tool names the Marketing Agent may select from.
 * Names come from the shared registry (see ai/tools/registerAllTools.ts);
 * nothing here is a tool definition and nothing here is registered again.
 */
export const MARKETING_AGENT_ALLOWED_TOOLS = [
  // Sales / products / economics
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getProductCombinations',
  // Inventory exposure
  'getInventoryStatus',
  'getStockoutRisk',
  'getExpiryRisk',
  // Customers / targeting
  'getCustomerSegments',
  'getRetentionSignals',
  // Marketing history
  'getOfferPerformance',
  'getCampaignPerformance',
  'getActiveOffers',
  // Phase 4 — existing promotion-candidate engine (read-only bridge)
  'getPromotionCandidates',
  // ML signals (response ≠ uplift; both stay gated upstream)
  'getOfferResponseBatchScores',
  'getOfferResponsePrediction',
  'getUpliftSignals',
  'getDemandForecast',
  // Context
  'getFestivalContext',
  'getSportsContext',
  'getWeatherContext',
  'getNearbyCompetition',
  'getBranches',
] as const;

export interface AgentPolicy {
  agent: string;
  allowedTools: readonly string[];
}

export const marketingAgentPolicy: AgentPolicy = {
  agent: 'marketing_agent',
  allowedTools: MARKETING_AGENT_ALLOWED_TOOLS,
};

/** Run budgets for the marketing agent (bounded, conservative defaults). */
export const MARKETING_AGENT_BUDGET: Partial<AgentBudgetLimits> = {
  maxSteps: 3,
  maxToolCalls: 6,
  durationMs: 8_000,
  maxTokens: 16_000,
  maxCostUsd: 0.05,
};

/**
 * Resolve the policy against the shared registry. FAIL CLOSED: an unknown or
 * unregistered name throws `AiError('TOOL_NOT_FOUND')` — the run never starts
 * with a silently smaller tool set.
 */
export function resolveMarketingAgentTools(): ToolDefinition<unknown, unknown>[] {
  return resolveAllowedTools(MARKETING_AGENT_ALLOWED_TOOLS);
}

/** Read-only tool catalog for prompt construction (name/description/access/category). */
export function marketingAgentToolCatalog() {
  return describeAllowedTools(MARKETING_AGENT_ALLOWED_TOOLS);
}
