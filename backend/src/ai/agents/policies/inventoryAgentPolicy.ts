/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgentPolicy.ts — permission boundary for the Inventory Agent.
 * Mirrors agents/policies/marketingAgentPolicy.ts exactly:
 *   - tools are NEVER imported or registered here — only exact NAMES that
 *     already exist in the ONE shared registry,
 *   - resolution goes through `resolveAllowedTools` (FAIL CLOSED: an unknown
 *     name throws instead of silently shrinking the allow-list),
 *   - every listed tool is `access: 'read'`; no write tool exists in this phase.
 *
 * Budgets bound every run (steps, tool calls, wall clock, tokens, cost) using
 * the EXISTING shared budget mechanism (shared/agentRunContext.ts) — no second
 * budget framework.
 */

import { resolveAllowedTools, describeAllowedTools } from '../../tools/registry/toolResolver';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import type { AgentBudgetLimits } from '../../shared/agentRunContext';

/**
 * Exact existing READ-ONLY tools the agent may select from.
 *
 * Core four inventory sources are the authoritative baseline (stock, stockout
 * forecast, expiry, wastage). The extended set lets the model widen an
 * investigation when the owner's question needs it — all are real, registered,
 * tenant-scoped, read-only tools in the ONE shared registry:
 *   - getDemandForecast: stored ML demand predictions (per-product, with an
 *     explicit available/unavailable model-status contract — absence is
 *     reported honestly, never treated as zero demand);
 *   - getSalesTrends / getMenuPerformance / getProductMargins /
 *     getProductCombinations: sales + menu-engineering context that explains
 *     WHY demand pressure exists;
 *   - getFestivalContext / getSportsContext: demand-side context signals
 *     (both report unavailable-vs-empty explicitly).
 *
 * `getDemandForecast` does NOT replace `getStockoutRisk`: the stockout tool
 * stays the authoritative reorder/depletion source; the ML forecast is an
 * independent per-product demand surface the model may consult. Every tool
 * here distinguishes "no data" from "healthy" — an empty source can never be
 * read as an all-clear (D1).
 */
export const INVENTORY_AGENT_ALLOWED_TOOLS = [
  // Core authoritative inventory sources (always available to the model)
  'getInventoryStatus',
  'getStockoutRisk',
  'getExpiryRisk',
  'getWastage',
  // Extended investigation surface — ML prediction + demand/sales context
  'getDemandForecast',
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getProductCombinations',
  'getFestivalContext',
  'getSportsContext',
] as const;

export interface AgentPolicy {
  agent: string;
  allowedTools: readonly string[];
}

export const inventoryAgentPolicy: AgentPolicy = {
  agent: 'inventory_agent',
  allowedTools: INVENTORY_AGENT_ALLOWED_TOOLS,
};

/**
 * Run budgets for the inventory agent (bounded, still conservative).
 * maxSteps 8 / maxToolCalls 14 allow the model to investigate ACROSS the
 * extended surface — e.g. status → stockout → demand forecast → sales/margins
 * on the affected items → festival context → stop — while every dimension
 * (steps, calls, wall clock, tokens, cost) stays hard-capped.
 */
export const INVENTORY_AGENT_BUDGET: Partial<AgentBudgetLimits> = {
  maxSteps: 8,
  maxToolCalls: 14,
  durationMs: 30_000,
  maxTokens: 32_000,
  maxCostUsd: 0.08,
};

/** Prompt version recorded on every usage row for this agent. */
export const INVENTORY_AGENT_PROMPT_VERSION = 'inventory-agent-v2';

/**
 * Role line for the shared bounded loop's system prompt. The loop keeps its
 * generic rules (tool catalog, no invented numbers, stop when sufficient);
 * this only replaces the agent identity, so inventory reasoning is not
 * prompted as if it were marketing.
 */
export const INVENTORY_AGENT_ROLE_PROMPT = [
  'You are the investigation planner of the ChitKuber Inventory Agent for ONE restaurant.',
  'Your job: decide which READ-ONLY tools to call to answer the owner\'s inventory question, then stop when the evidence is sufficient.',
  'getInventoryStatus is the authoritative CURRENT baseline (stock vs minimum levels). Call it for questions about what needs action now, and also whenever a specialist tool returns available=false — an empty source is NOT evidence that stock is healthy.',
  'getStockoutRisk is the authoritative reorder/depletion source; getDemandForecast adds stored per-product ML demand predictions (it may be unavailable — that is not zero demand).',
  'getSalesTrends, getMenuPerformance, getProductMargins and getProductCombinations explain WHY demand pressure exists (revenue trend, menu classes, per-item margins, bought-together items). getFestivalContext and getSportsContext are demand-side context signals.',
  'An empty tool result (available=false + reason) means only that ONE source had no data for the window. Never answer "no inventory risk" from an empty specialist tool while getInventoryStatus has not been inspected.',
  'You may keep investigating across steps while the budget allows; stop only when the question is answered or no allowed tool can add evidence. A narrow question can need one focused source; a broad inventory review normally needs several complementary sources.',
  'Evidence priority (never reversed): current authoritative stock/expiry facts > derived predictions (depletion days, reorder quantity, ML demand forecast) > historical observations (wastage, sales/margin history) > your own inference.',
  'You never calculate or invent stock, expiry dates, days of supply, reorder quantities, demand or cost — those come only from tool results.',
].join('\n');

/**
 * Resolve the policy against the shared registry. FAIL CLOSED: an unknown or
 * unregistered name throws `AiError('TOOL_NOT_FOUND')` — the run never starts
 * with a silently different tool set.
 */
export function resolveInventoryAgentTools(): ToolDefinition<unknown, unknown>[] {
  return resolveAllowedTools(INVENTORY_AGENT_ALLOWED_TOOLS);
}

/** Read-only tool catalog for prompt construction (name/description/access/category). */
export function inventoryAgentToolCatalog() {
  return describeAllowedTools(INVENTORY_AGENT_ALLOWED_TOOLS);
}
