/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentUsage.ts — observability writer for agent runs (Phase 1).
 *
 * REUSES the two existing observability systems; it introduces none of its
 * own:
 *   - AIUsageLog  (models/core/AIUsageLog.ts) — one row per LLM call with
 *     tokens/cost/model/provider/latency, the data source the Admin Dashboard
 *     "AI Usage" page already aggregates (this is its first writer).
 *   - auditService (modules/audit/auditService.ts) — one row per agent run
 *     (entityType 'agent_run') with status, budgets, tool names and rejection
 *     metadata. It never throws into the caller's path.
 *
 * Privacy: only counts, tool names, statuses and hashes are recorded — never
 * prompts, never tool payloads, never customer data. The tenant id is the
 * server-derived restaurantId; logs are tenant-scoped by construction.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import AIUsageLog from '../../models/core/AIUsageLog';
import { calculateCost } from '../../services/aiCostConfig';
import { auditService } from '../../modules/audit/auditService';
import type { AgentRunMemory } from '../shared/agentRunContext';

/** Privacy-safe prompt hash — hash only, never the prompt itself. */
export function promptHashOf(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export interface LlmUsageRecord {
  restaurantId: string;
  requestId: string;
  promptVersion: string;
  promptText: string;
  model: string;
  provider: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  success: boolean;
  errorType?: string | null;
  fallbackReason?: string | null;
}

/**
 * Append one AIUsageLog row for an LLM call. Never throws — observability
 * must not break the agent path.
 */
export async function recordLlmUsage(rec: LlmUsageRecord): Promise<void> {
  try {
    const restaurantId = mongoose.Types.ObjectId.isValid(rec.restaurantId)
      ? new mongoose.Types.ObjectId(rec.restaurantId)
      : null;
    const cost = rec.success
      ? calculateCost(rec.inputTokens, rec.outputTokens, rec.model, rec.provider)
      : 0;
    await AIUsageLog.create({
      restaurantId,
      ownerId: null,
      feature: 'marketing_agent',
      success: rec.success,
      fallback: !rec.success,
      cached: false,
      latencyMs: rec.latencyMs,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      totalTokens: rec.totalTokens,
      cost,
      model: rec.model,
      provider: rec.provider,
      errorType: rec.errorType ?? null,
      retried: false,
      cancelled: false,
      timeout: rec.errorType === 'timeout',
      promptVersion: rec.promptVersion,
      cacheBust: false,
      validationPassed: null,
      validationFailed: null,
      fallbackReason: rec.fallbackReason ?? null,
      promptHash: promptHashOf(rec.promptText),
      requestId: rec.requestId,
    });
  } catch {
    // Observability must never break the agent.
  }
}

/**
 * Append one audit-trail row summarizing a finished agent run (no payloads).
 */
export async function recordAgentRun(memory: AgentRunMemory, opts: { durationMs: number }): Promise<void> {
  try {
    const failure = memory.status === 'failed' || memory.status === 'llm_unavailable';
    await auditService.log({
      action: 'agent_run_completed',
      entityType: 'agent_run',
      entityId: memory.runId,
      entityLabel: memory.objective.slice(0, 120),
      restaurantId: memory.tenant.restaurantId,
      branchId: memory.tenant.branchId,
      requestId: memory.requestId,
      correlationId: memory.runId,
      durationMs: opts.durationMs,
      executionTimeMs: opts.durationMs,
      success: !failure,
      status: failure ? 'failure' : 'success',
      comments: 'Marketing agent bounded run (Phase 1) — counts and tool names only.',
      details: {
        agent: 'marketing_agent',
        runId: memory.runId,
        status: memory.status,
        stepsUsed: memory.budget.stepsUsed,
        maxSteps: memory.budget.limits.maxSteps,
        toolCallsUsed: memory.budget.toolCallsUsed,
        maxToolCalls: memory.budget.limits.maxToolCalls,
        toolNames: memory.toolCalls.map((t) => t.tool),
        rejected: memory.rejections.map((r) => ({ ref: r.ref, stage: r.stage })),
        uncertaintyCount: memory.uncertainties.length,
        observationCount: memory.observations.length,
        memoryEpisodes: memory.memory?.episodes.length ?? 0,
        memoryLongTerm: memory.memory?.longTerm.length ?? 0,
        memoryDegraded: memory.memory?.degraded ?? false,
        llmConfigured: memory.llm.configured,
        llmCalls: memory.llm.calls,
        tokensUsed: memory.budget.tokensUsed,
        costUsd: Number(memory.budget.costUsd.toFixed(6)),
        errorCode: memory.error?.code ?? null,
      },
    });
  } catch {
    // Observability must never break the agent.
  }
}
