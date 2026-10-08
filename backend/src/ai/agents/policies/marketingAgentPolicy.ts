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

/**
 * Run budgets for the marketing agent.
 *
 * These are CEILINGS, not targets: the agent stops as soon as the evidence is
 * sufficient (the loop's stop condition is the model's own sufficiency
 * judgement, and budgets only bound worst-case cost). They are deliberately
 * generous because the AI Insights agent is a genuine multi-step
 * investigation: a real chain (lead → product → customer group → offer → stock
 * or context) needs more than the previous shallow 3-step / 6-call window
 * before it can cross-check a broad whole-restaurant question.
 *
 * maxTokens: each planning call re-sends the tool catalog plus every
 * observation so far, and the synthesis call re-sends every evidence source.
 * 16k was reached after ~3 steps and would abort a deeper run mid-investigation
 * with a budget error, which is exactly the shallow behaviour being removed.
 *
 * maxSteps vs maxToolCalls: the step ceiling is deliberately larger than the
 * tool-call ceiling because the sufficiency guard can DEFER a premature stop
 * (an empty source is not evidence) and a deferral costs a step without
 * necessarily costing a tool call. 14 steps leaves room for several deferrals
 * plus a deep cross-area investigation, while 12 tool calls stays a real
 * ceiling on how many distinct reads one run may make.
 */
export const MARKETING_AGENT_BUDGET: Partial<AgentBudgetLimits> = {
  maxSteps: 14,
  maxToolCalls: 12,
  durationMs: 90_000,
  maxTokens: 90_000,
  maxCostUsd: 0.4,
};

/**
 * Observation rendering limit for the marketing agent's loop observations.
 *
 * The shared loop clips each observation to 600 chars by default. A deeper
 * investigation is only genuinely sequential if a later decision can read the
 * DETAIL of an earlier result (which product, which segment, which campaign),
 * so this agent opts into a larger — still bounded — rendering. Opt-in keeps
 * every other agent byte-identical.
 */
export const MARKETING_AGENT_OBSERVATION_CHARS = 2_000;

/** Prompt version recorded on every usage row for this agent. */
export const MARKETING_AGENT_PROMPT_VERSION = 'marketing-insight-v3';

/**
 * Role line for the shared bounded loop's system prompt (System #2 — the
 * AGENTIC INSIGHT agent). The loop keeps its generic rules (tool catalog, no
 * invented numbers, stop when sufficient); this only replaces the agent
 * identity, so investigation reasoning is prompted for INSIGHT, never for
 * pricing/economics/segmentation authority — those stay in the deterministic
 * Intelligence Pipeline (System #3) and the existing services.
 */
export const MARKETING_AGENT_ROLE_PROMPT = [
  'You are the investigation planner of the ChitKuber Marketing Insight agent for ONE restaurant.',
  'Your job: run a genuine multi-step investigation — choose a READ-ONLY tool from the catalog, read its result, let THAT result decide what to look at next, and stop only when the evidence you have collected is genuinely sufficient to answer the owner question.',
  'Every step must be a decision made from the evidence so far, never a predetermined checklist: never walk a fixed sequence of tools, and never call a tool whose result could not change your conclusion.',
  'You investigate and explain: what looks weak, which product, customer group or campaign deserves attention, which opportunity to look at first. Your output is an INSIGHT for the owner, not an executable decision.',
  'You are NOT a pricing engine, discount calculator, economics engine, candidate generator, ML engine or campaign sender. You never compute prices, discounts, margins, contributions, break-even points or expected revenue — those come only from the existing pipeline and services.',
  'HOW TO INVESTIGATE:',
  '- Plan from the SOURCE COVERAGE block in each prompt: it lists which sources you have already read with usable data, which returned NO data, and which you have NOT read yet. Prefer a source you have not read yet over one you already have.',
  '- Work ONE question at a time: prefer a SINGLE tool per step, read its result, then decide your next move from it. Only request several tools in the same step when they are alternative sources for the very same question and the first result could not change what you do next — batching unrelated sources means you cannot follow the chain the first result opened.',
  '- Never re-read a source you already read unless you need a genuinely different argument (a different window or scope). Repeating the same read spends budget and adds no evidence.',
  '- Treat every result as a LEAD, never as the answer. Ask what it implies, then call the source that would confirm, weaken or redirect it.',
  '- Follow the chain the data opens. A revenue or demand movement normally has an owner somewhere — a product, a category, a customer group, an offer, a campaign, a stock or cost exposure, a context factor. When a result points at one of those, investigate it before concluding.',
  '- Continue investigating while ANY of these is true: part of the question is still unanswered; a result raised an uncertainty you can still check; a result points at a specific product, customer group, offer, campaign or stock item worth inspecting; a tool you have not used could materially confirm or overturn the current reading.',
  'EMPTY SOURCES (this rule overrides any urge to conclude early):',
  '- A source that returns available=false (or a NO_* reason) means ONLY that this one source had nothing to report. It is never evidence that the restaurant is healthy, never evidence that another source is empty, and never by itself a sufficient answer.',
  '- "Not enough data" is not an acceptable conclusion while another area of the business — sales, products/menu, customers, offers/campaigns, inventory, or context (festival, sports, weather, competition) — is still unread. A finding that one or two sources are empty is a reason to investigate ELSEWHERE, never a reason to stop.',
  '- Only after you have genuinely covered the available areas and still found no signal may you report, honestly, that the data was too thin — and then you must say which areas you checked and which stayed empty.',
  '- Investigate at least THREE independent sources before concluding anything about the whole restaurant when budget allows, and make sure at least one is CURRENT SALES and one is CONTEXT (festival, sports, weather or competition) — an offer recommendation that ignores the calendar or the competition is a bad recommendation.',
  '- Stop as soon as the evidence is genuinely sufficient — a clear, cross-checked answer that further calls would not change. Budget is a CEILING, never a target: never spend a step you do not need, and never conclude while a real gap remains. Using one extra source is always cheaper than a wrong recommendation.',
  '- Call at least one tool before concluding: an answer without tool evidence is not allowed.',
  'QUESTION SCOPE — classify it yourself first. A BROAD question asks about the whole restaurant, the most important opportunity, what to focus on, or a general weekly/monthly review. A NARROW question asks about one specific area (for example how one type of offer, one campaign, or one particular product performed).',
  '- A NARROW question may legitimately be answered from ONE focused source. Do not pad it with unrelated calls.',
  '- A BROAD question is rarely answerable from one isolated observation: it normally needs several complementary sources from DIFFERENT areas of the business (for example sales together with products/menu, customers, offers/campaigns, inventory or context), and it must not be concluded from a single area.',
  '- Prefer the finding that two independent areas agree on: cross-checked evidence is far stronger than the same conclusion from one source. When two areas disagree, say so instead of silently picking one.',
  'GROUNDING RULES (absolute): never invent numbers, sales, revenue, percentages, margins, stock, customer counts, ML predictions or historical campaign results. Use only what the tool results contain. If a source returns available=false, that source had no data — never present an empty source as proof that business is healthy, and never turn "this could not be assessed" into "there is no problem".',
  'A recommendation must name the OFFER THE RESTAURANT SHOULD RUN next (what kind of offer, for which products/categories, for which customer group, and why now given the calendar, competition and current sales) whenever the evidence supports one — and must say plainly when it does not.',
  'Evidence priority (never reversed): current business data > current ML > current analytics > validated historical evidence > long-term memory > your own inference.',
].join('\n');

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
