/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * policy.ts — the Marketing Manager's permission boundary + run budgets
 * (task §5/§6/§21).
 *
 * The allow-list is the DOMAIN catalog, not database tools: the manager may
 * ask for a DOMAIN to be investigated, and the domain decides which read-only
 * sources to read. Resolution goes through the shared registry (fail-closed).
 */

import { resolveAllowedTools } from '../tools/registry/toolResolver';
import type { ToolDefinition } from '../tools/registry/toolTypes';
import type { AgentBudgetLimits } from '../shared/agentRunContext';
import { MARKETING_DOMAIN_TOOLS } from './domains';

export const MARKETING_MANAGER_ALLOWED_TOOLS: readonly string[] = MARKETING_DOMAIN_TOOLS;

export const marketingManagerPolicy = {
  agent: 'marketing_manager',
  allowedTools: MARKETING_MANAGER_ALLOWED_TOOLS,
} as const;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

/**
 * Run budgets. These are CEILINGS: the manager stops as soon as the situation
 * is answerable. Domain investigations are heavier than raw tool calls (one
 * domain = several bounded reads), so the tool-call ceiling is deliberately
 * equal to the domain count — one investigation per domain per run.
 *
 * Every limit is env-overridable for ops tuning without a deploy.
 */
export const MARKETING_MANAGER_BUDGET: Partial<AgentBudgetLimits> = {
  maxSteps: envInt('MARKETING_MANAGER_MAX_STEPS', 8, 2, 16),
  maxToolCalls: envInt('MARKETING_MANAGER_MAX_DOMAINS', 9, 1, 12),
  durationMs: envInt('MARKETING_MANAGER_TIMEOUT_MS', 120_000, 15_000, 300_000),
  maxTokens: envInt('MARKETING_MANAGER_MAX_TOKENS', 120_000, 8_000, 400_000),
  maxCostUsd: envFloat('MARKETING_MANAGER_MAX_COST_USD', 0.5, 0.01, 5),
};

/** Prompt version recorded on every usage row for the manager loop. */
export const MARKETING_MANAGER_PROMPT_VERSION = 'marketing-manager-v1';

/** Observation rendering limit for the manager's loop (still bounded). */
export const MARKETING_MANAGER_OBSERVATION_CHARS = 2_400;

/**
 * Role prompt for the shared bounded loop. It states identity and the hard
 * epistemic rules only: the loop already supplies the catalog, the no-write
 * rule, the stop semantics and the evidence priority ladder.
 */
export const MARKETING_MANAGER_ROLE_PROMPT = [
  'You are the Marketing Manager of the ChitKuber Marketing Agent for ONE restaurant.',
  'Your job: INVESTIGATE the business sequentially, ONE domain at a time, and stop as soon as the situation is clear enough to act on.',
  'Each tool in the catalog is a DOMAIN of the business, not a database table. Choose the domain whose QUESTION you most need answered next, read its result, then let THAT result decide the next domain.',
  'SEQUENTIAL RULE: request ONE domain per step. Never batch unrelated domains in the same step — the whole point is that the next domain is chosen from what the previous one revealed.',
  'You are an investigator, not a decider: you never price, never compute discounts, margins, contribution or break-even, never create or send an offer or campaign, and never approve anything. Deterministic services own economics; the owner owns approval.',
  'START from the pre-scan digest in your objective: it is orientation, not proof. Verify anything load-bearing with a domain investigation.',
  'A domain that reports unavailable or not-implemented means ONLY that this domain told you nothing. It is never evidence that the business is healthy, and it is never a reason to stop while another domain is still unread.',
  'Before concluding a restaurant-wide judgement, investigate at least THREE independent domains, and always include current sales AND at least one of context, customers or marketing history — an offer decided without the calendar, the customers or past campaign results is a bad offer.',
  'Treat every finding as a LEAD. When a finding points at a product, category, customer group, offer, campaign or stock exposure, investigate the domain that would confirm, weaken or redirect it.',
  'Disclose disagreement: if two domains point in different directions, say so instead of silently picking one.',
  'Never invent numbers, sales, margins, uplift, ratings or competitor facts. Only what a domain result contains may be stated.',
].join('\n');

/** Resolve the manager's domain tools against the shared registry (fail-closed). */
export function resolveMarketingManagerTools(): ToolDefinition<unknown, unknown>[] {
  return resolveAllowedTools(MARKETING_MANAGER_ALLOWED_TOOLS);
}
