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
import AuditLog from '../../models/admin/AuditLog';
import type { AgentRunMemory, AgentReplayEpisode } from '../shared/agentRunContext';

/** Privacy-safe prompt hash — hash only, never the prompt itself. */
export function promptHashOf(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export interface LlmUsageRecord {
  restaurantId: string;
  requestId: string;
  /**
   * Which agent spent the tokens. Defaults to 'marketing_agent' so existing
   * callers and their tests are unchanged; the shared loop passes its
   * policy's agent name (e.g. 'inventory_agent').
   */
  feature?: string;
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
      feature: rec.feature ?? 'marketing_agent',
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
export async function recordAgentRun(
  memory: AgentRunMemory,
  opts: { durationMs: number; agent?: string },
): Promise<void> {
  try {
    const agent = opts.agent ?? 'marketing_agent';
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
      comments: `${agent} bounded run — counts and tool names only.`,
      details: {
        agent,
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
        // Replayable decision chain (opt-in via `replayEpisode`): per step, the
        // evidence seen → the decision made → the calls that executed. Contains
        // only bounded observation summaries — never raw tool payloads, never
        // prompts. Absent for agents that did not opt in.
        ...(memory.replay ? { replay: memory.replay } : {}),
      },
    });
  } catch {
    // Observability must never break the agent.
  }
}

// ─── Replayable investigation episodes (read model) ────────────────────

/** One step of a replay episode, as returned to readers. */
export interface ReplayStepView {
  step: number;
  seen: Array<{ tool: string; ok: boolean; summary: string }>;
  requested: string[];
  reason?: string;
  needMoreEvidence: boolean;
  stopObjection?: string;
  executed: Array<{ tool: string; ok: boolean; code?: string; deduped?: boolean }>;
}

export interface ReplayEpisodeView {
  runId: string;
  agent: string;
  objective: string;
  status: string;
  promptVersion: string;
  stepsUsed: number;
  toolCallsUsed: number;
  llmCalls: number;
  tokensUsed: number;
  costUsd: number;
  degraded: boolean;
  errorCode: string | null;
  startedAt: string | null;
  durationMs: number | null;
  steps: ReplayStepView[];
}

/**
 * Authoritative spend for one run, aggregated from AIUsageLog (the same rows
 * the Admin Dashboard's AI Usage page reads). Needed because the audit row's
 * own `tokensUsed` detail passes through the shared write-time secret masking
 * (`/token/i` → `[REDACTED]`), so the audit copy can never carry the number.
 * Returns null when the model has no rows (e.g. LLM never configured).
 */
async function usageTotalsFor(restaurantId: string, runId: string): Promise<{ tokens: number; costUsd: number } | null> {
  try {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    const rows = await AIUsageLog.find({ restaurantId: new mongoose.Types.ObjectId(restaurantId), requestId: runId })
      .select('totalTokens cost -_id')
      .lean();
    if (!rows.length) return null;
    let tokens = 0;
    let costUsd = 0;
    for (const r of rows) {
      tokens += typeof r.totalTokens === 'number' ? r.totalTokens : 0;
      costUsd += typeof r.cost === 'number' ? r.cost : 0;
    }
    return { tokens, costUsd: Number(costUsd.toFixed(6)) };
  } catch {
    return null;
  }
}

/** List recent replayable investigations for ONE restaurant (bounded). */
export async function listReplayEpisodes(
  restaurantId: string,
  opts: { agent?: string; limit?: number } = {},
): Promise<Array<Omit<ReplayEpisodeView, 'steps'>>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];
    const rows = await AuditLog.find({
      entityType: 'agent_run',
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      'details.replay': { $exists: true },
      ...(opts.agent ? { 'details.agent': opts.agent } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(opts.limit ?? 20, 50)))
      .select(
        'entityId entityLabel success status createdAt details.agent details.status details.stepsUsed details.toolCallsUsed details.llmCalls details.tokensUsed details.costUsd details.errorCode details.replay.promptVersion correlationId durationMs',
      )
      .lean();
    const views: Array<Omit<ReplayEpisodeView, 'steps'>> = [];
    for (const r of rows) {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const replay = (d.replay ?? undefined) as AgentReplayEpisode | undefined;
      const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
      const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback);
      const runId = str(r.entityId, '');
      // tokens/cost: AIUsageLog is authoritative (the audit copy of tokensUsed
      // is write-time masked as a secret-bearing key).
      const spend = await usageTotalsFor(restaurantId, runId);
      views.push({
        runId,
        agent: str(d.agent, 'unknown_agent'),
        objective: str(r.entityLabel, ''),
        status: str(d.status, 'unknown'),
        promptVersion: str(replay?.promptVersion, ''),
        stepsUsed: num(d.stepsUsed),
        toolCallsUsed: num(d.toolCallsUsed),
        llmCalls: num(d.llmCalls),
        tokensUsed: spend?.tokens ?? num(d.tokensUsed),
        costUsd: spend?.costUsd ?? num(d.costUsd),
        degraded: r.success === false,
        errorCode: typeof d.errorCode === 'string' && d.errorCode.length > 0 ? d.errorCode : null,
        startedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        durationMs: num(r.durationMs, 0),
      });
    }
    return views;
  } catch {
    return []; // Read model must never break a caller.
  }
}

/** One full replay episode by run id, tenant-scoped (null when absent). */
export async function getReplayEpisode(
  restaurantId: string,
  runId: string,
): Promise<ReplayEpisodeView | null> {
  try {
    if (!mongoose.Types.ObjectId.isValid(restaurantId) || !runId || runId.length > 128) return null;
    const row = await AuditLog.findOne({
      entityType: 'agent_run',
      entityId: runId,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
    })
      .select('entityId entityLabel success status createdAt details durationMs')
      .lean();
    if (!row) return null;
    const d = (row.details ?? {}) as Record<string, unknown>;
    const replay = (d.replay ?? undefined) as AgentReplayEpisode | undefined;
    if (!replay) return null; // A run without a recorded episode is not replayable.
    const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback);
    const restaurantIdStr = restaurantId;
    const spend = await usageTotalsFor(restaurantIdStr, str(row.entityId, runId));
    return {
      runId: str(row.entityId, runId),
      agent: str(d.agent, 'unknown_agent'),
      objective: str(row.entityLabel, ''),
      status: str(d.status, 'unknown'),
      promptVersion: str(replay.promptVersion, ''),
      stepsUsed: num(d.stepsUsed, replay.steps.length),
      toolCallsUsed: num(d.toolCallsUsed),
      llmCalls: num(d.llmCalls),
      tokensUsed: spend?.tokens ?? num(d.tokensUsed),
      costUsd: spend?.costUsd ?? num(d.costUsd),
      degraded: row.success === false,
      errorCode: typeof d.errorCode === 'string' && d.errorCode.length > 0 ? d.errorCode : null,
      startedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      durationMs: num(row.durationMs, 0),
      steps: replay.steps,
    };
  } catch {
    return null;
  }
}
