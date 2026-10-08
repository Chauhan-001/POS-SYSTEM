/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportAgent.ts — PHASE 5 orchestrator for the Daily Summary / Z-Report
 * Intelligence pipeline.
 *
 * ORDER OF OPERATIONS (progressive evidence collection — never an LLM tool
 * loop):
 *
 *   context builder            (tenant + branch validated, business date fixed)
 *        ↓
 *   deterministic closing pull (closingReportService.zReport — the EXISTING
 *                               Z-report, unchanged; used as an input, never
 *                               replaced)
 *        ↓
 *   Batch 1 core facts         (parallel, shared registry)
 *   Batch 2 derived signals    (deterministic services)
 *   Batch 3 ML/context         (conditional)
 *        ↓
 *   Evidence merge + conflict detection
 *        ↓
 *   Targeted follow-up         (bounded, only when the pack is unclear)
 *        ↓
 *   Evidence merge (complete pack)
 *        ↓
 *   LLM synthesis → FINAL CRITIC → deterministic fallback if rejected
 *        ↓
 *   Persist + observability
 *
 * GUARANTEES
 *   - restaurantId comes ONLY from the authenticated tenant; a requested
 *     branch is validated against that tenant before any read.
 *   - The LLM never receives tenant/security metadata and cannot invent a
 *     number or a causal claim (enforced server-side by the grounding layer
 *     and re-checked by the critic).
 *   - Degraded reads are disclosed, never hidden.
 *   - Persistence and observability NEVER break the response.
 */

import crypto from 'node:crypto';
import { buildZReportContext } from './zReportContext';
import {
  collectZReportEvidence,
  Z_REPORT_BATCH1_TOOLS,
  Z_REPORT_BATCH3_TOOLS,
  type ZReportEvidence,
} from './zReportSignals';
import { mergeEvidence, type EvidencePack } from './evidenceMerger';
import { followUpAsBatch, runZReportFollowUp, type ZReportFollowUpResult } from './zReportFollowUp';
import {
  allowedNumbersFor,
  computeReportConfidence,
  deterministicZReportNarrative,
  generateZReportNarrative,
  type ZReportNarrative,
} from './zReportPrompts';
import { criticizeZReport, staleOnlyNumbers, type ZReportCriticVerdict } from './zReportCritic';
import {
  Z_REPORT_AGENT_PROMPT_VERSION,
  Z_REPORT_BATCH1_BUDGET_MS,
  Z_REPORT_BATCH3_BUDGET_MS,
  Z_REPORT_FOLLOWUP_MAX_ROUNDS,
} from './policies/zReportAgentPolicy';
import { closingReportService } from '../../modules/reports/services/closingReportService';
import { recordLlmUsage } from '../observability/agentUsage';
import DailySummaryEvidenceModel from '../../models/finance/DailySummaryEvidence';
import { calculateCost } from '../../services/aiCostConfig';
import type { AiTenantContext } from '../shared/tenantContext';
import type { CashClosingLike } from '../intelligence/businessSignalNormalizers';

export interface GenerateDailySummaryOptions {
  /** Authenticated tenant (server-derived; never client input). */
  tenant: AiTenantContext;
  /** Business date 'YYYY-MM-DD' (default: yesterday, local calendar). */
  date?: string;
  /** Requested branch — validated against the tenant before any query. */
  branchId?: string | null;
  /** Batch 3 policy: true = always, false = never, 'auto' (default) = conditional. */
  includeBatch3?: boolean | 'auto';
  /** Correlation id; also the persisted runId (default: generated). */
  executionId?: string;
  /** Injectable clock (tests). */
  now?: number;
  /** Test seam / offline mode: force the deterministic narrative. */
  disableLlm?: boolean;
  /** Whether to persist the run (default true; tests may disable). */
  persist?: boolean;
}

export interface DailySummaryEvidenceSummary {
  signals: number;
  freshness: Record<string, number>;
  conflicts: string[];
  unavailable: string[];
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  caveats: string[];
  usable: boolean;
  batch3Reason: string;
  followUpReason: string | null;
  ml: EvidencePack['ml'];
}

export interface DailySummaryGeneration {
  durationMs: number;
  batch1Ms: number;
  batch2Ms: number;
  batch3Ms: number;
  followUpMs: number;
  llmMs: number;
  toolCalls: number;
  toolFailures: number;
  llmTokens: number;
  llmCostUsd: number;
  conflictsDetected: number;
  followUpRounds: number;
  validationStatus: string;
  criticIssues: string[];
}

export interface DailySummaryResult {
  runId: string;
  agent: 'z_report';
  businessDate: string;
  branchId?: string;
  branchName?: string;
  report: ZReportNarrative;
  reportSource: 'llm' | 'deterministic';
  /** Why the deterministic narrative was used, when it was. */
  reportDegradedReason?: string;
  confidence: number;
  degraded: boolean;
  degradations: string[];
  evidence: DailySummaryEvidenceSummary;
  generation: DailySummaryGeneration;
  /** False when persistence failed — the report itself is still valid. */
  persisted: boolean;
  generatedAt: string;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/**
 * Run the Daily Summary intelligence pipeline for ONE business date.
 *
 * Throws only for identity problems (invalid tenant / foreign branch — the
 * shared AiError codes). Every data problem is reported inside the result.
 */
export async function generateDailySummaryIntelligence(
  opts: GenerateDailySummaryOptions,
): Promise<DailySummaryResult> {
  const startedAt = Date.now();
  const tenant = opts.tenant;
  const runId = (opts.executionId && opts.executionId.length <= 128 ? opts.executionId : crypto.randomUUID());

  // ── Context (validates branch ownership; fixes the business date) ─────────
  const context = await buildZReportContext(tenant, {
    ...(opts.date !== undefined ? { date: opts.date } : {}),
    ...(opts.branchId !== undefined ? { branchId: opts.branchId } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  // ── Deterministic closing report (the EXISTING Z-report, as an input) ─────
  // Fetched ONCE here and normalized by Batch 1 — the AI path never
  // re-implements closing arithmetic.
  let closing: (CashClosingLike & { requiresManagerApproval?: boolean }) | null = null;
  try {
    closing = (await closingReportService.zReport(
      { restaurantId: context.restaurantId, ...(context.branchId ? { branchId: context.branchId } : {}) },
      context.businessDate,
    )) as unknown as CashClosingLike & { requiresManagerApproval?: boolean };
  } catch {
    closing = null; // Disclosed by Batch 1 as NO_CLOSING_REPORT, never hidden.
  }

  // ── Batches 1–3 ──────────────────────────────────────────────────────────
  const evidence: ZReportEvidence = await collectZReportEvidence({
    context,
    tenant,
    closing,
    ...(opts.includeBatch3 !== undefined ? { includeBatch3: opts.includeBatch3 } : {}),
    batch1BudgetMs: Z_REPORT_BATCH1_BUDGET_MS,
    batch3BudgetMs: Z_REPORT_BATCH3_BUDGET_MS,
    executionId: runId,
  });

  // ── Merge (pre-follow-up) then targeted follow-up ────────────────────────
  const memoryReason = context.memory.degraded ? (context.memory.reason ?? 'memory unavailable') : undefined;
  const preFollowUpPack = mergeEvidence(evidence, memoryReason);

  let followUp: ZReportFollowUpResult | null = null;
  try {
    followUp = await runZReportFollowUp({
      tenant,
      context,
      pack: preFollowUpPack,
      alreadyFetched: [
        ...Z_REPORT_BATCH1_TOOLS,
        ...(evidence.batch3 ? Z_REPORT_BATCH3_TOOLS : []),
      ],
      executionId: runId,
    });
  } catch {
    // A follow-up failure must never lose the evidence already gathered.
    followUp = null;
  }

  const completeEvidence: ZReportEvidence = {
    ...evidence,
    followUp: followUp && followUp.toolNames.length ? followUpAsBatch(followUp, followUp.reasons) : null,
  };
  const pack = mergeEvidence(completeEvidence, memoryReason, followUp?.mlSummary);

  // ── Synthesis ────────────────────────────────────────────────────────────
  const mlLines = followUp?.mlLines ?? [];
  const generation = await generateZReportNarrative({
    context,
    pack,
    mlLines,
    ...(opts.disableLlm !== undefined ? { disableLlm: opts.disableLlm } : {}),
  });

  // ── Final critic (deterministic; failure => deterministic narrative) ─────
  const verdict: ZReportCriticVerdict = criticizeZReport({
    narrative: generation.narrative,
    pack,
    context,
    allowedNumbers: allowedNumbersFor(context, pack, mlLines),
    staleOnlyNumbers: staleOnlyNumbers(pack),
    source: generation.source,
  });

  let narrative = generation.narrative;
  let reportSource = generation.source;
  let reportDegradedReason = generation.degradedReason;
  if (verdict.verdict === 'repair') {
    const blocking = verdict.issues.filter((i) => i.blocking).map((i) => i.code);
    narrative = deterministicZReportNarrative(context, pack, mlLines);
    reportSource = 'deterministic';
    reportDegradedReason = `critic_repair:${blocking.slice(0, 4).join(',')}`;
  }

  // ── Confidence + disclosure ──────────────────────────────────────────────
  const confidence = computeReportConfidence(pack);
  const degradations = uniq([
    ...pack.unavailable.map((u) => `source unavailable: ${u}`),
    ...pack.toolErrors.map((e) => `read failed: ${e.tool} (${e.code})`),
    ...(memoryReason ? [`memory context degraded: ${memoryReason}`] : []),
    ...mlLines,
    ...(reportDegradedReason ? [`report from deterministic fallback: ${reportDegradedReason}`] : []),
  ]);
  const degraded =
    !pack.usable ||
    reportSource === 'deterministic' ||
    degradations.length > 0;

  const batchMs = (b: { durationMs: number } | null | undefined) => (b ? b.durationMs : 0);
  const toolCalls =
    evidence.batch1.signals.length > 0 || evidence.batch1.toolErrors.length > 0
      ? Z_REPORT_BATCH1_TOOLS.length + (evidence.batch3 ? Z_REPORT_BATCH3_TOOLS.length : 0) + (followUp?.toolNames.length ?? 0)
      : (evidence.batch3 ? Z_REPORT_BATCH3_TOOLS.length : 0) + (followUp?.toolNames.length ?? 0);
  const toolFailures =
    evidence.batch1.toolErrors.length +
    evidence.batch2.toolErrors.length +
    (evidence.batch3?.toolErrors.length ?? 0) +
    (followUp?.toolErrors.length ?? 0);
  const llmTokens = generation.usage?.totalTokens ?? 0;
  const llmCostUsd = generation.usage
    ? Number(calculateCost(generation.usage.inputTokens, generation.usage.outputTokens, generation.model ?? '', generation.provider ?? '').toFixed(6))
    : 0;

  const result: DailySummaryResult = {
    runId,
    agent: 'z_report',
    businessDate: context.businessDate,
    ...(context.branchId ? { branchId: context.branchId } : {}),
    ...(context.branchName ? { branchName: context.branchName } : {}),
    report: narrative,
    reportSource,
    ...(reportDegradedReason ? { reportDegradedReason } : {}),
    confidence,
    degraded,
    degradations,
    evidence: {
      signals: pack.signals.length,
      freshness: pack.freshness,
      conflicts: pack.conflicts.conflicts.map((c) => `${c.code}|${c.subjectId}`),
      unavailable: pack.unavailable,
      toolErrors: pack.toolErrors,
      caveats: pack.caveats,
      usable: pack.usable,
      batch3Reason: evidence.batch3Reason,
      followUpReason: followUp?.reasons.length ? followUp.reasons.join(' | ') : null,
      ml: pack.ml,
    },
    generation: {
      durationMs: Date.now() - startedAt,
      batch1Ms: evidence.batch1.durationMs,
      batch2Ms: evidence.batch2.durationMs,
      batch3Ms: batchMs(evidence.batch3),
      followUpMs: followUp?.durationMs ?? 0,
      llmMs: generation.latencyMs ?? 0,
      toolCalls,
      toolFailures,
      llmTokens,
      llmCostUsd,
      conflictsDetected: pack.conflicts.conflicts.length,
      followUpRounds: followUp?.toolNames.length ? Z_REPORT_FOLLOWUP_MAX_ROUNDS : 0,
      validationStatus: verdict.verdict === 'accept' ? `accepted:${verdict.checks.length}checks` : `repair:${verdict.issues.filter((i) => i.blocking).map((i) => i.code).join(',')}`,
      criticIssues: verdict.issues.map((i) => `${i.code}${i.blocking ? '' : '(advisory)'}`),
    },
    persisted: false,
    generatedAt: new Date().toISOString(),
  };

  // ── Observability + persistence (never break the response) ──────────────
  if (generation.llmAttempted) {
    await recordLlmUsage({
      restaurantId: context.restaurantId,
      requestId: runId,
      feature: 'z_report',
      promptVersion: Z_REPORT_AGENT_PROMPT_VERSION,
      // Privacy: only a SHAPE fingerprint is hashed — the prompt text itself is
      // never persisted, and the descriptor contains no tenant data.
      promptText: `${Z_REPORT_AGENT_PROMPT_VERSION}|${context.businessDate}|${pack.signals.length}signals|${mlLines.length}ml`,
      model: generation.model ?? 'unknown',
      provider: generation.provider ?? 'unknown',
      latencyMs: generation.latencyMs ?? 0,
      inputTokens: generation.usage?.inputTokens ?? 0,
      outputTokens: generation.usage?.outputTokens ?? 0,
      totalTokens: llmTokens,
      success: generation.source === 'llm',
      errorType: generation.source === 'llm' ? null : (reportDegradedReason ?? 'fallback'),
      fallbackReason: generation.source === 'llm' ? null : (reportDegradedReason ?? 'fallback'),
    }).catch(() => undefined);
  }

  if (opts.persist !== false) {
    try {
      await DailySummaryEvidenceModel.create({
        restaurantId: context.restaurantId,
        branchId: context.branchId ?? null,
        businessDate: context.businessDate,
        runId,
        agent: 'z_report',
        promptVersion: context.promptVersion,
        evidencePack: {
          signals: pack.signals,
          conflicts: pack.conflicts,
          dedupCollisions: pack.dedupCollisions,
          staleSignals: pack.staleSignals,
          unavailable: pack.unavailable,
          toolErrors: pack.toolErrors,
          caveats: pack.caveats,
          freshness: pack.freshness,
          sources: pack.sources,
          batch3Reason: pack.batch3Reason,
          ml: pack.ml,
        },
        report: narrative,
        confidence,
        degraded,
        degradations,
        reportSource,
        generationMetadata: {
          durationMs: result.generation.durationMs,
          batch1Ms: result.generation.batch1Ms,
          batch2Ms: result.generation.batch2Ms,
          batch3Ms: result.generation.batch3Ms,
          followUpMs: result.generation.followUpMs,
          llmMs: result.generation.llmMs,
          toolCalls,
          toolFailures,
          llmTokens,
          llmCostUsd,
          conflictsDetected: result.generation.conflictsDetected,
          followUpRounds: result.generation.followUpRounds,
          validationStatus: result.generation.validationStatus,
        },
      });
      result.persisted = true;
    } catch {
      // Persistence is history, not the answer: the caller still gets the report.
      result.persisted = false;
    }
  }

  return result;
}
