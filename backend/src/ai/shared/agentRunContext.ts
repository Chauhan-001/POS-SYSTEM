/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentRunContext.ts — TYPED working memory for a single bounded agent run
 * (Phase 1 foundation).
 *
 * Working memory is per-execution ONLY: it is created from the authenticated
 * request context, accumulated during the loop, returned to the caller, and
 * persisted only as observability metadata (AIUsageLog + audit trail). It
 * NEVER becomes long-term memory automatically — consolidation is a separate,
 * evidence-gated phase (Phase 2/8).
 *
 * HARD RULE (spec §33): tenant identity comes from the authenticated server
 * context only. `createAgentRun` accepts an AiTenantContext (JWT-derived) and
 * there is no code path that lets an LLM response set restaurantId — LLM tool
 * arguments are additionally stripped of tenant keys via `sanitizeToolArgs`.
 */

import { randomUUID } from 'crypto';
import type { AiTenantContext } from './tenantContext';
import type { AgentMemoryContext } from '../memory/memoryTypes';

/** Terminal states of a bounded run. Non-error states are normal outcomes. */
export type AgentRunStatus =
  | 'created'
  | 'running'
  /** LLM decided it has enough evidence and stopped. */
  | 'completed_sufficient'
  /** Hit maxSteps while still wanting evidence. */
  | 'stopped_max_steps'
  /** Tool-call budget exhausted. */
  | 'stopped_max_tool_calls'
  /** Wall-clock / token / cost budget exhausted. */
  | 'stopped_budget'
  /** LLM missing or provider unsupported — deterministic path takes over. */
  | 'llm_unavailable'
  /** LLM failed (timeout/http/invalid output) — deterministic path takes over. */
  | 'failed';

/** Budget limits for one run (loop-enforced). */
export interface AgentBudgetLimits {
  /** Max LLM reasoning iterations. */
  maxSteps: number;
  /** Max tool executions across the whole run. */
  maxToolCalls: number;
  /** Wall-clock budget in ms (from run start). */
  durationMs: number;
  /** Max cumulative LLM tokens (input+output) across the run. */
  maxTokens: number;
  /** Max cumulative estimated LLM cost in USD across the run. */
  maxCostUsd: number;
}

/** Live budget state (limits + consumption + absolute deadline). */
export interface AgentBudgetState {
  limits: AgentBudgetLimits;
  /** Absolute epoch-ms deadline derived from durationMs. */
  deadlineAt: number;
  stepsUsed: number;
  toolCallsUsed: number;
  tokensUsed: number;
  costUsd: number;
}

/** One executed (or attempted) tool call — inputs recorded AFTER sanitization. */
export interface AgentToolCallRecord {
  step: number;
  tool: string;
  /** Sanitized args (tenant keys are never present). */
  args: Record<string, unknown>;
  ok: boolean;
  code?: string;
  message?: string;
  durationMs: number;
}

/** Compact tool output fed back into the loop (never the raw dataset). */
export interface AgentObservation {
  step: number;
  tool: string;
  ok: boolean;
  /** Truncated, structured summary — safe to place in a prompt. */
  summary: string;
}

/** Something the run could not establish (surfaced, never papered over). */
export interface AgentUncertainty {
  step: number;
  reason: string;
}

/** A request the loop refused to execute, with the stage that blocked it. */
export interface AgentRejection {
  ref: string;
  reason: string;
  stage: 'policy' | 'budget' | 'validation';
}

/**
 * Working memory for exactly one run. All fields are per-execution; nothing
 * here is automatically persisted as restaurant knowledge.
 */
export interface AgentRunMemory {
  runId: string;
  /** Correlation id for the HTTP request that started the run. */
  requestId: string;
  /** Server-derived tenant scope — never LLM-derived. */
  tenant: {
    restaurantId: string;
    branchId?: string;
    actorId?: string;
  };
  objective: string;
  /** Latest plan the LLM produced (each step overwrites). */
  plan: string[];
  toolCalls: AgentToolCallRecord[];
  observations: AgentObservation[];
  /**
   * Canonical business signals — Phase 1 keeps this as an empty typed slot;
   * the canonical signal layer lands in Phase 3.
   */
  signals: unknown[];
  /** Offer candidates — Phase 4 fills this from the existing candidate engine. */
  candidates: unknown[];
  rejections: AgentRejection[];
  uncertainties: AgentUncertainty[];
  /**
   * Phase 2 — memory snapshot loaded at run start (recent episodic + relevant
   * long-term memories, tenant/branch scoped, expired excluded). Run-LOCAL:
   * it is a read-only view; the loop never writes memory back automatically
   * (consolidation is a separate, evidence-gated phase).
   * `undefined` until the loop loads it; an empty-but-present context means
   * loading completed with no rows (or degraded — see `degraded`).
   */
  memory?: AgentMemoryContext;
  budget: AgentBudgetState;
  status: AgentRunStatus;
  error?: { code: string; message: string };
  llm: {
    configured: boolean;
    provider: string;
    model: string;
    /** Number of LLM calls made (bounded by maxSteps). */
    calls: number;
  };
  startedAt: string;
  endedAt?: string;
}

export const DEFAULT_AGENT_BUDGET: AgentBudgetLimits = {
  maxSteps: 3,
  maxToolCalls: 6,
  durationMs: 8_000,
  maxTokens: 16_000,
  maxCostUsd: 0.05,
};

/** Tenant/LLM-provided keys that are stripped from every tool argument set. */
export const FORBIDDEN_LLM_ARG_KEYS = ['restaurantId', 'tenantId', 'restaurant', 'tenant', 'tenantContext'] as const;

/**
 * Create working memory from the AUTHENTICATED tenant context only.
 * There is intentionally no parameter that accepts a tenant id as a string
 * from any other source.
 */
export function createAgentRun(input: {
  tenant: AiTenantContext;
  objective: string;
  requestId?: string;
  budget?: Partial<AgentBudgetLimits>;
}): AgentRunMemory {
  const limits: AgentBudgetLimits = { ...DEFAULT_AGENT_BUDGET, ...input.budget };
  const now = Date.now();
  const runId = randomUUID();
  return {
    runId,
    requestId: input.requestId ?? runId,
    tenant: {
      restaurantId: String(input.tenant.restaurantId),
      branchId: input.tenant.branchId,
      actorId: input.tenant.actorId,
    },
    objective: input.objective,
    plan: [],
    toolCalls: [],
    observations: [],
    signals: [],
    candidates: [],
    rejections: [],
    uncertainties: [],
    budget: {
      limits,
      deadlineAt: now + limits.durationMs,
      stepsUsed: 0,
      toolCallsUsed: 0,
      tokensUsed: 0,
      costUsd: 0,
    },
    status: 'created',
    llm: { configured: false, provider: '', model: '', calls: 0 },
    startedAt: new Date(now).toISOString(),
  };
}

/**
 * Strip tenant-identifying keys from LLM-supplied tool arguments (defense in
 * depth — tools already read tenant from ToolContext, and their zod schemas
 * are `.strict()`, which would reject these keys anyway).
 */
export function sanitizeToolArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if ((FORBIDDEN_LLM_ARG_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Whether a run reached a normal (non-failure) terminal state. */
export function isRunSettled(status: AgentRunStatus): boolean {
  return status !== 'created' && status !== 'running';
}
