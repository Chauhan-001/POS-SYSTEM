/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgent.ts — System #2: the AGENTIC MARKETING INSIGHT agent.
 *
 * Architecture (deliberate change): the old DETERMINISTIC targeting ladder
 * (uplift → response model → segments → NONE) has been REMOVED. There are now
 * exactly two marketing intelligence brains:
 *
 *   1. THIS agent — dynamic investigation + reasoning + INSIGHT
 *        LLM → tool → result → LLM → tool → result → LLM → STOP
 *        It explains what deserves attention and why, using only real tool
 *        evidence. It never computes prices, discounts, margins, contribution
 *        or expected revenue — that stays in the deterministic Intelligence
 *        Pipeline (System #3) and the existing services.
 *
 *   2. The Intelligence Pipeline (`ai/intelligence/marketingIntelligencePipeline.ts`)
 *        canonical signals → candidate engine → economics → ML → ranking →
 *        grounded explanation → ranked, ACTIONABLE recommendations.
 *
 * This module owns #1 only. It reuses the ONE shared bounded loop, the ONE
 * shared tool registry/executor and the marketing agent policy — no second
 * loop, no second registry, no fixed tool ladder, no duplicate economics.
 *
 * Honesty rules enforced here (not just prompted):
 *   - every returned insight carries the exact tool names that ran;
 *   - narrative numbers that do not exist in captured tool evidence are
 *     stripped server-side (a claim the evidence cannot support is removed);
 *   - an LLM failure produces an explicitly DEGRADED insight (or a safe
 *     evidence-labelled fallback). It NEVER revives the removed deterministic
 *     ladder.
 */

import { z } from 'zod';
import {
  isRetryableJsonFailure,
  isUsableToolData,
  runBoundedAgentLoop,
  summarizeToolOutput,
  type LoopLlmFn,
  type LoopMemoryFn,
} from './loop/agentLoop';
import {
  marketingAgentPolicy,
  resolveMarketingAgentTools,
  MARKETING_AGENT_ALLOWED_TOOLS,
  MARKETING_AGENT_BUDGET,
  MARKETING_AGENT_OBSERVATION_CHARS,
  MARKETING_AGENT_PROMPT_VERSION,
  MARKETING_AGENT_ROLE_PROMPT,
} from './policies/marketingAgentPolicy';
import { generateJsonWithMeta, LlmError, type LlmJsonRequest, type LlmJsonResult } from '../shared/llmClient';
import { malformedReason, stripUngroundedNumbers } from '../intelligence/recommendationExplanation';
import { recordLlmUsage } from '../observability/agentUsage';
import type { AgentBudgetLimits, AgentRunMemory } from '../shared/agentRunContext';
import type { ToolContext } from '../tools/registry/toolTypes';

export type MarketingInsightPriority = 'high' | 'medium' | 'low' | 'normal';

/** Concise investigation metadata — never hidden reasoning. */
export interface MarketingInsightStep {
  step: number;
  tool: string;
  /** What this source is for (from the shared tool catalog), not the model's thoughts. */
  purpose: string;
  ok: boolean;
}

/** One evidence source behind the insight. `ref` is an exact tool name. */
export interface MarketingInsightEvidenceSource {
  ref: string;
  label: string;
}

/**
 * The agentic insight card. Deliberately NOT the removed deterministic
 * targeting result: no targets, no offer draft, no economics.
 */
export interface MarketingInsight {
  id: string;
  type: 'agentic_insight';
  title: string;
  summary: string;
  priority: MarketingInsightPriority;
  /** Advisory next step for the owner only — never executed by this agent. */
  recommendation: string | null;
  evidence: MarketingInsightEvidenceSource[];
  confidence: number;
  /** Exact tool names that actually executed (server-side truth). */
  toolsUsed: string[];
  steps: MarketingInsightStep[];
  degraded: boolean;
  degradedReason?: string;
  /**
   * Whether the owner-facing WRITTEN summary could be produced. Independent of
   * the investigation itself: `unavailable` means the evidence was gathered
   * and is still reported, but no AI explanation was generated.
   */
  summaryStatus: MarketingSummaryStatus;
  /**
   * Machine-readable failure code (diagnostic ONLY — never rendered to the
   * owner, never phrased as prose). The owner sees `summary`/`title`.
   */
  reasonCode?: MarketingReasonCode;
  generatedAt: string;
}

/** Can the written summary be trusted/shown, or is only the evidence available? */
export type MarketingSummaryStatus = 'ok' | 'partial' | 'unavailable';

/**
 * Stable machine codes for a degraded insight. Internal diagnostics: they are
 * recorded for observability and returned for support tooling, but they are
 * NEVER interpolated into owner-facing prose (which is the only thing the
 * Marketing page renders).
 */
export type MarketingReasonCode =
  | 'LLM_RATE_LIMITED'
  | 'LLM_TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'LLM_INVALID_RESPONSE'
  | 'LLM_HTTP_ERROR'
  | 'LLM_DISABLED'
  | 'INVESTIGATION_FAILED'
  | 'NO_TOOL_EVIDENCE'
  | 'SUMMARY_UNGROUNDED'
  | 'SUMMARY_PARTIALLY_REJECTED';

/** Map a provider failure to a stable, non-technical machine code. */
export function reasonCodeForLlmError(err: unknown): MarketingReasonCode {
  if (!(err instanceof LlmError)) return 'INVESTIGATION_FAILED';
  switch (err.kind) {
    case 'rate_limited':
      return 'LLM_RATE_LIMITED';
    case 'timeout':
      return 'LLM_TIMEOUT';
    case 'not_configured':
    case 'unsupported_provider':
      return 'LLM_UNAVAILABLE';
    case 'invalid_json':
      return 'LLM_INVALID_RESPONSE';
    default:
      return err.httpStatus === 429 ? 'LLM_RATE_LIMITED' : 'LLM_HTTP_ERROR';
  }
}

/** Map an already-recorded terminal loop error code to the same code space. */
export function reasonCodeForLoopError(code: string | undefined): MarketingReasonCode {
  switch (code) {
    case 'rate_limited':
      return 'LLM_RATE_LIMITED';
    case 'timeout':
      return 'LLM_TIMEOUT';
    case 'not_configured':
    case 'unsupported_provider':
      return 'LLM_UNAVAILABLE';
    case 'invalid_json':
    case 'invalid_plan':
      return 'LLM_INVALID_RESPONSE';
    case 'http_error':
      return 'LLM_HTTP_ERROR';
    default:
      return 'INVESTIGATION_FAILED';
  }
}

export interface MarketingInsightInvestigation {
  runId: string;
  requestId: string;
  status: string;
  stepsUsed: number;
  toolCallsUsed: number;
  llmCalls: number;
  toolNames: string[];
  /**
   * Repeated identical reads that were served from the already-captured
   * observation instead of re-executing (they still consumed tool budget).
   * Observability only — the model is told nothing about this.
   */
  dedupedCalls: number;
  rejections: Array<{ ref: string; stage: string }>;
  /** Terminal error code when the run failed (never the raw message). */
  errorCode?: string;
  memory?: { episodes: number; longTerm: number; degraded: boolean };
  degraded: boolean;
  /** Synthesis outcome of this run (evidence is reported regardless). */
  summaryStatus: MarketingSummaryStatus;
  /** Diagnostic machine code for a degraded summary/run — never owner prose. */
  reasonCode?: MarketingReasonCode;
}  /** The /recommend payload: one insight per investigation run. */
export interface MarketingInsightRun {
  mode: 'agentic_insight';
  insights: MarketingInsight[];
  investigation: MarketingInsightInvestigation;
  degraded: boolean;
  degradedReason?: string;
  /** Machine code for a degraded run — diagnostic only, never owner prose. */
  reasonCode?: MarketingReasonCode;
  generatedAt: string;
}

export interface MarketingAgentOptions {
  /** Owner question the agent investigates. */
  task?: string;
  /** Correlation id from the HTTP request (observability). */
  requestId?: string;
  /** Test seam: inject the loop's LLM (defaults to the shared llmClient). */
  llm?: LoopLlmFn;
  /** Test seam for the insight synthesis call. */
  synthesisLlm?: (req: LlmJsonRequest) => Promise<LlmJsonResult<unknown>>;
  /** Skip every LLM call (always a degraded insight). */
  disableLlm?: boolean;
  /** Override the policy budgets (tests / tighter routes). */
  loopBudget?: Partial<AgentBudgetLimits>;
  /** Test seam: memory loader (defaults to the shared memoryManager). */
  loadMemory?: LoopMemoryFn;
}

const DEFAULT_TASK = 'What marketing issue should I pay attention to this week?';
const MAX_TASK_CHARS = 300;

const PRIORITIES: MarketingInsightPriority[] = ['high', 'medium', 'low', 'normal'];

function normalizePriority(value: string | undefined): MarketingInsightPriority {
  const s = (value ?? '').trim().toLowerCase();
  return (PRIORITIES as string[]).includes(s) ? (s as MarketingInsightPriority) : 'normal';
}

/**
 * Insight synthesis contract — narrative + priority + evidence refs only.
 * Deliberately has NO price/discount/margin/revenue fields, so the model
 * structurally cannot present its own economics as authoritative.
 */
const insightSynthesisSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(600),
  priority: z.string().max(20).optional(),
  recommendation: z.string().min(3).max(300).optional(),
  evidenceRefs: z.array(z.string().max(80)).max(8).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const SYNTHESIS_SCHEMA_HINT = `{
  "title": string (short owner-facing headline),
  "summary": string (what the evidence shows and why it matters),
  "priority": "high" | "medium" | "low" | "normal",
  "recommendation": string (ONE advisory next step for the owner — never an executed action),
  "evidenceRefs": string[] (exact tool names that produced the evidence),
  "confidence": number (0..1)
}`;

/** Owner-facing label for a source, derived from the shared tool catalog. */
let PURPOSE_BY_TOOL: Record<string, string> | null = null;

function toolPurpose(tool: string): string {
  if (!PURPOSE_BY_TOOL) {
    const map: Record<string, string> = {};
    try {
      for (const def of resolveMarketingAgentTools()) map[def.name] = def.meta.description;
    } catch {
      // Fail closed: an unresolved catalog must not break the run.
    }
    PURPOSE_BY_TOOL = map;
  }
  const raw = PURPOSE_BY_TOOL[tool];
  if (!raw) return 'Read-only marketing evidence source';
  const firstSentence = raw.split('. ')[0] ?? raw;
  return firstSentence.length > 96 ? `${firstSentence.slice(0, 93)}…` : firstSentence;
}

/**
 * Which AREA of the business a tool reads (registry category). Used only to
 * judge whether a broad conclusion rests on more than one independent area —
 * never to pick or order tools.
 */
let AREA_BY_TOOL: Record<string, string> | null = null;

function toolArea(tool: string): string {
  if (!AREA_BY_TOOL) {
    const map: Record<string, string> = {};
    try {
      for (const def of resolveMarketingAgentTools()) map[def.name] = def.category;
    } catch {
      // Fail closed: an unresolved catalog must not break the run.
    }
    AREA_BY_TOOL = map;
  }
  // An unknown tool is treated as its own area (conservative: never merges two
  // genuinely different sources into one).
  return AREA_BY_TOOL[tool] ?? tool;
}

/**
 * Stop guard for the shared loop. It never picks a tool: it only objects when
 * the model asks to stop with ZERO usable tool evidence, so an insight can
 * never be concluded without a real source. Bounded by the loop's maxSteps.
 */
export function marketingEvidenceStopGuard(
  memory: Pick<AgentRunMemory, 'toolCalls' | 'toolData'>,
): string | null {
  if (memory.toolData.some((t) => t.ok)) return null;
  if (memory.toolCalls.length === 0) {
    return 'no read-only tool has been called yet — gather at least one piece of real evidence before concluding.';
  }
  return 'no read-only source has returned usable data yet — try another evidence source before concluding.';
}

/**
 * Question scope. Used ONLY to decide whether an early stop is acceptable — it
 * never selects a tool, never orders tools and never adds a tool the model did
 * not ask for. The model remains the only decision maker.
 */
export type MarketingTaskScope = 'broad' | 'narrow';

/** Words that name ONE area of the business. */
const SINGLE_AREA_TOPIC =
  /\b(offers?|campaigns?|promotions?|menus?|products?|dishes?|combos?|customers?|segments?|inventory|stock|weather|festivals?|competition|branches?)\b/gi;

/** Words that ask about the whole restaurant rather than a single area. */
const WHOLE_RESTAURANT_SCOPE =
  /\b(restaurant|business|overall|everything|most important|biggest|top priority|opportunit(?:y|ies)|general|what should i|pay attention|focus)\b/i;

/**
 * Classify a marketing question as broad (whole restaurant) or narrow (one
 * area). Deliberately conservative: anything that is not clearly a single-area
 * question is treated as broad, because the cost of one extra evidence source
 * is far lower than concluding a whole-restaurant question from one number.
 */
export function classifyMarketingTask(task: unknown): MarketingTaskScope {
  const text = typeof task === 'string' ? task.trim() : '';
  if (!text) return 'broad'; // the default owner question is a general review
  const topics = new Set((text.toLowerCase().match(SINGLE_AREA_TOPIC) ?? []).map((t) => t.replace(/s$/, '')));
  if (topics.size >= 2) return 'broad';
  if (topics.size === 1 && !WHOLE_RESTAURANT_SCOPE.test(text)) return 'narrow';
  return 'broad';
}

/**
 * How many times a broad-question stop may be deferred before it is accepted.
 *
 * The guard must push back more than once — a single empty source is the exact
 * failure this rule exists to remove — but it must also be BOUNDED, so a model
 * that simply refuses to investigate cannot burn the whole step budget. Every
 * deferral is also bounded by the loop's maxSteps / wall-clock budget.
 */
export const MAX_BROAD_STOP_DEFERRALS = 3;

/**
 * The sources a run has ACTUALLY obtained usable data from.
 *
 * `toolData` (captured outputs) is authoritative when present; `observations`
 * carry the same judgement as a fallback for callers that did not capture
 * full outputs. A source that executed fine but returned `available:false` /
 * `NO_*DATA` is NOT counted: that is the whole point of this rule.
 */
function usableSources(
  memory: Pick<AgentRunMemory, 'toolData' | 'observations'>,
): Array<{ tool: string }> {
  if (memory.toolData && memory.toolData.length > 0) {
    return memory.toolData.filter((t) => t.ok && isUsableToolData(t.data));
  }
  return (memory.observations ?? []).filter((o) => o.ok && o.usable !== false);
}

/**
 * Names the AREAS (never the tools) that still hold a source this run has not
 * read. Prompt-only guidance: the guard never picks the tool itself.
 */
function unreadAreasText(memory: Pick<AgentRunMemory, 'toolCalls'>): string {
  const read = new Set(memory.toolCalls.map((t) => t.tool));
  const areas = new Set<string>();
  for (const name of MARKETING_AGENT_ALLOWED_TOOLS) {
    if (!read.has(name)) areas.add(toolArea(name));
  }
  const list = [...areas].filter(Boolean).sort();
  return list.length > 0 ? ` (areas you have NOT read yet: ${list.join(', ')})` : '';
}

/**
 * Scope-aware stop guard used by the marketing insight run.
 *
 * It composes the existing zero-evidence guard with the rule that actually
 * matters for a whole-restaurant question: an EMPTY SOURCE IS NOT EVIDENCE.
 *
 * Two distinct failures are rejected for a broad question:
 *   1. every source read so far returned no usable data. One empty source says
 *      nothing about the others, so "not enough data" is not a conclusion — it
 *      is a reason to read a different area;
 *   2. usable data exists, but all of it reads the SAME area of the business.
 *      Two product-level sources are one area of evidence, not two independent
 *      confirmations, and the role prompt's own rule is that a broad finding
 *      must be cross-checked across areas.
 *
 * Both are deferred up to MAX_BROAD_STOP_DEFERRALS times, and the objection
 * names the areas that are still unread so the next step is a real choice.
 * The guard never chooses or orders a tool and never executes one: the model
 * decides what (if anything) to call next. Narrow questions are untouched — a
 * focused question may legitimately be answered from one specialized source.
 */
export function marketingEvidenceSufficiencyGuard(
  task: unknown,
): (
  memory: Pick<AgentRunMemory, 'toolCalls' | 'toolData' | 'observations' | 'uncertainties'>,
) => string | null {
  const scope = classifyMarketingTask(task);
  return (memory) => {
    const base = marketingEvidenceStopGuard(memory);
    if (base) return base;
    if (scope !== 'broad') return null;
    const deferrals = (memory.uncertainties ?? []).filter((u) => u.reason.startsWith('stop_deferred:')).length;
    if (deferrals >= MAX_BROAD_STOP_DEFERRALS) return null;
    const usable = usableSources(memory);
    const unread = unreadAreasText(memory);
    if (usable.length === 0) {
      return `this is a broad question about the whole restaurant, but EVERY source checked so far returned no usable data. One empty source does NOT mean the others are empty — it only removes that one source. Do not answer "not enough data": read a source from an area you have not checked yet${unread} before deciding again.`;
    }
    const areas = new Set(usable.map((u) => toolArea(u.tool)));
    if (areas.size < 2) {
      return `this is a broad question about the whole restaurant, and every usable source so far reads the SAME area of the business. One area alone is normally not enough to conclude a whole-restaurant question: choose one more complementary source from a DIFFERENT area${unread} so the reading can be confirmed, weakened or redirected, then decide again. If an area turns out to have no data, that is still not the others.`;
    }
    return null;
  };
}

/** Numbers the model may state: everything that appears in captured tool data. */
function collectNumbers(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    into.add(String(value));
    into.add(String(Math.round(value)));
    into.add(String(Math.round(value * 100) / 100));
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 400) return;
    for (const token of value.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      into.add(token);
      into.add(token.replace(/,/g, ''));
      const n = Number(token.replace(/,/g, ''));
      if (Number.isFinite(n)) {
        into.add(String(n));
        into.add(String(Math.round(n)));
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectNumbers(item, into, depth + 1);
  }
}

interface CapturedEvidence {
  sources: MarketingInsightEvidenceSource[];
  toolsUsed: string[];
  allowedNumbers: Set<string>;
  /** Compact per-source rendering passed to the synthesis call. */
  facts: Array<{ ref: string; label: string; data: string }>;
}

/** Build evidence from the EXACT outputs the loop already executed (no re-run). */
export function evidenceFromToolData(
  toolData: Array<{ step: number; tool: string; ok: boolean; data: unknown }>,
): CapturedEvidence {
  const sources: MarketingInsightEvidenceSource[] = [];
  const seen = new Set<string>();
  const allowedNumbers = new Set<string>();
  const facts: Array<{ ref: string; label: string; data: string }> = [];
  for (const entry of toolData) {
    collectNumbers(entry.data, allowedNumbers);
    if (seen.has(entry.tool)) continue;
    seen.add(entry.tool);
    const label = toolPurpose(entry.tool);
    sources.push({ ref: entry.tool, label });
    facts.push({ ref: entry.tool, label, data: summarizeToolOutput(entry.data) });
  }
  return { sources, toolsUsed: [...seen], allowedNumbers, facts };
}

/** Ground a narrative line against real evidence numbers. */
function groundText(text: string, allowed: Set<string>, fallback: string | null): string | null {
  const { text: stripped } = stripUngroundedNumbers(text, allowed);
  const candidate = stripped.trim();
  if (candidate.length < 3 || malformedReason(candidate)) return fallback;
  return candidate;
}

function toUnitConfidence(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeTask(task: unknown): string {
  if (typeof task !== 'string') return DEFAULT_TASK;
  const trimmed = task.trim();
  if (!trimmed) return DEFAULT_TASK;
  return trimmed.slice(0, MAX_TASK_CHARS);
}

function insightSteps(run: AgentRunMemory): MarketingInsightStep[] {
  return run.toolCalls.map((call) => ({
    step: call.step,
    tool: call.tool,
    purpose: toolPurpose(call.tool),
    ok: call.ok,
  }));
}

function toInvestigation(
  run: AgentRunMemory,
  degraded = false,
  summary: { summaryStatus: MarketingSummaryStatus; reasonCode?: MarketingReasonCode } = { summaryStatus: 'ok' },
): MarketingInsightInvestigation {
  return {
    summaryStatus: summary.summaryStatus,
    reasonCode: summary.reasonCode,
    runId: run.runId,
    requestId: run.requestId,
    status: run.status,
    stepsUsed: run.budget.stepsUsed,
    toolCallsUsed: run.budget.toolCallsUsed,
    llmCalls: run.llm.calls,
    toolNames: run.toolCalls.map((t) => t.tool),
    dedupedCalls: run.toolCalls.filter((t) => t.deduped).length,
    rejections: run.rejections.map((r) => ({ ref: r.ref, stage: r.stage })),
    errorCode: run.error?.code,
    memory: run.memory
      ? {
          episodes: run.memory.episodes.length,
          longTerm: run.memory.longTerm.length,
          degraded: run.memory.degraded ?? false,
        }
      : undefined,
    degraded,
  };
}

/**
 * Honest reason text for a degraded insight (never a fabricated result, and
 * never a provider error string: the owner does not know what "429" is).
 */
function degradedSummary(reason: string, run: AgentRunMemory): string {
  switch (reason) {
    case 'llm_disabled':
      return 'The AI investigation is switched off for this request, so no insight was generated. The recommended actions below come from the deterministic intelligence pipeline.';
    case 'llm_unavailable':
      return 'The AI investigation could not run because the language model is not configured on this deployment. The recommended actions below still work.';
    case 'llm_failed':
      if (reasonCodeForLoopError(run.error?.code) === 'LLM_RATE_LIMITED') {
        return 'AI summary is temporarily unavailable. The AI investigation could not finish right now, and no numbers were guessed.';
      }
      return 'The AI investigation could not complete right now. No insight was generated, and no numbers were guessed.';
    default:
      return 'The AI investigation finished without any usable source data for this restaurant, so no insight could be grounded in evidence.';
  }
}

/** Initials of the summary/r-code pair for a run that produced NO insight. */
function unavailableReasonCode(reason: string, run: AgentRunMemory): MarketingReasonCode {
  switch (reason) {
    case 'llm_disabled':
      return 'LLM_DISABLED';
    case 'llm_unavailable':
      return 'LLM_UNAVAILABLE';
    case 'llm_failed':
      return reasonCodeForLoopError(run.error?.code);
    default:
      return 'NO_TOOL_EVIDENCE';
  }
}

/** Insight used when the run captured no usable tool evidence at all. */
function unavailableInsight(reason: string, run: AgentRunMemory): MarketingInsight {
  return {
    id: `insight_${run.runId}`,
    type: 'agentic_insight',
    title: 'AI insight unavailable',
    summary: degradedSummary(reason, run),
    priority: 'normal',
    recommendation: null,
    evidence: [],
    confidence: 0,
    toolsUsed: [],
    steps: insightSteps(run),
    degraded: true,
    degradedReason: reason,
    summaryStatus: 'unavailable',
    reasonCode: unavailableReasonCode(reason, run),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Safe fallback when synthesis failed but real evidence WAS collected.
 *
 * The investigation is NOT thrown away: the exact sources that ran stay on the
 * insight (the UI renders them as "What the AI checked"). The reason is a
 * machine code on `reasonCode` only — the owner-facing text says the summary is
 * temporarily unavailable and that nothing was invented. No generic AI summary
 * is fabricated here (there is no second summary engine in this codebase).
 */
function evidenceFallbackInsight(
  reasonCode: MarketingReasonCode,
  evidence: CapturedEvidence,
  run: AgentRunMemory,
): MarketingInsight {
  return {
    id: `insight_${run.runId}`,
    type: 'agentic_insight',
    title: 'AI summary is temporarily unavailable',
    summary: [
      'We collected evidence from your restaurant data, but the AI explanation could not be generated right now.',
      'No information was invented.',
      `Evidence was reviewed from ${evidence.toolsUsed.length} read-only source${evidence.toolsUsed.length === 1 ? '' : 's'} — see "What the AI checked" below.`,
      'The recommended actions further down come from the deterministic intelligence pipeline and still work.',
    ].join(' '),
    priority: 'normal',
    recommendation: null,
    evidence: evidence.sources,
    confidence: 0.3,
    toolsUsed: evidence.toolsUsed,
    steps: insightSteps(run),
    degraded: true,
    degradedReason: reasonCode,
    summaryStatus: 'unavailable',
    reasonCode,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Run one agentic marketing investigation and return its grounded insight.
 * NEVER throws: it always returns an insight, explicitly marked degraded when
 * the LLM could not produce one — it never falls back to the removed
 * deterministic targeting ladder.
 */
export async function runMarketingAgent(
  ctx: ToolContext,
  options: MarketingAgentOptions = {},
): Promise<MarketingInsightRun> {
  const task = normalizeTask(options.task);

  if (options.disableLlm) {
    // No loop at all: nothing was investigated, and we say exactly that.
    const run = {
      runId: 'llm_disabled',
      requestId: options.requestId ?? 'llm_disabled',
      status: 'llm_unavailable',
      budget: { stepsUsed: 0, toolCallsUsed: 0 },
      llm: { calls: 0 },
      toolCalls: [],
      rejections: [],
    } as unknown as AgentRunMemory;
    const insight = unavailableInsight('llm_disabled', run);
    return {
      mode: 'agentic_insight',
      insights: [insight],
      investigation: toInvestigation(run, true, { summaryStatus: insight.summaryStatus, reasonCode: insight.reasonCode }),
      degraded: true,
      degradedReason: 'llm_disabled',
      reasonCode: insight.reasonCode,
      generatedAt: insight.generatedAt,
    };
  }

  const run = await runBoundedAgentLoop({
    policy: marketingAgentPolicy,
    rolePrompt: MARKETING_AGENT_ROLE_PROMPT,
    promptVersion: MARKETING_AGENT_PROMPT_VERSION,
    objective: task,
    tenant: ctx.tenant,
    budget: { ...MARKETING_AGENT_BUDGET, ...options.loopBudget },
    requestId: options.requestId,
    llm: options.llm,
    loadMemory: options.loadMemory,
    captureToolData: true,
    // Deeper chains need the DETAIL of earlier results in the next prompt, not
    // just their headline: opt into a larger (still bounded) observation clip.
    observationChars: MARKETING_AGENT_OBSERVATION_CHARS,
    // A long investigation must not waste its tool-call budget re-reading the
    // identical (tool, args) pair: the loop serves the already-captured
    // observation instead. It still consumes budget, so repetition can never
    // loop, and only SUCCESSFUL outputs are replayed. Opt-in: other agents are
    // unchanged.
    dedupeIdenticalTools: true,
    // Record a replayable decision chain (per step: evidence seen → decision
    // made → calls executed) so a past AI Insights investigation can be
    // inspected and compared. Observability-only; no behaviour change.
    replayEpisode: true,
    // Show the model its own source coverage every step: an empty source is
    // not evidence, and a whole-restaurant question must not be concluded from
    // the first area that happens to answer. Prompt-only — the model still
    // chooses every tool.
    coverageGuidance: true,
    // Scope-aware: a broad question cannot be concluded from empty sources or
    // from a single area of the business, a narrow one can. The guard never
    // chooses a tool.
    stopGuard: marketingEvidenceSufficiencyGuard(task),
  });

  const evidence = evidenceFromToolData(run.toolData);

  // No usable evidence → explicit degraded insight, never a fabricated one.
  if (evidence.toolsUsed.length === 0) {
    const reason =
      run.status === 'llm_unavailable' ? 'llm_unavailable' : run.status === 'failed' ? 'llm_failed' : 'no_tool_evidence';
    const insight = unavailableInsight(reason, run);
    const investigation = toInvestigation(run, true, { summaryStatus: insight.summaryStatus, reasonCode: insight.reasonCode });
    return {
      mode: 'agentic_insight',
      insights: [insight],
      investigation,
      degraded: true,
      degradedReason: reason,
      reasonCode: insight.reasonCode,
      generatedAt: insight.generatedAt,
    };
  }

  // ── One synthesis call turns the captured evidence into the insight card ──
  const generatedAt = new Date().toISOString();
  let insight: MarketingInsight | null = null;
  let degradedReason: string | undefined;
  /** Whether the written summary exists (evidence is reported either way). */
  let summaryStatus: MarketingSummaryStatus = 'unavailable';
  let summaryReasonCode: MarketingReasonCode | undefined;
  const synthesis = options.synthesisLlm ?? ((req: LlmJsonRequest) => generateJsonWithMeta(req));
  const synthesisRequest: LlmJsonRequest = {
    system: [
      'You explain a marketing situation to a restaurant owner who does not know AI or technical terms.',
      'Hard rules:',
      '1. Use ONLY the facts in the input JSON. Never invent or estimate sales, revenue, percentages, margins, prices, discounts, costs or trends.',
      '2. You are advisory only: recommend what the owner should review or consider. Never claim an action was performed, and never propose a specific discount or price.',
      '3. "evidenceRefs" MUST list only the exact tool names present in the input — a source name that is not in the input cannot be cited.',
      '4. An unavailable source (available=false) means that source had no data — it is NOT evidence that the business is healthy, and it is NOT the answer while other sources report data.',
      '5. When the evidence supports it, make "recommendation" name the offer the restaurant should run next (what kind of offer, what it applies to, which customer group) and why now — referencing the calendar, competition or current sales the evidence actually contains. If no offer is supported, say what still needs to be checked.',
      '6. Be concise: one headline, two to four sentences, one next step.',
      '7. Answer ONLY with the JSON object matching the schema.',
    ].join('\n'),
    prompt: `Owner question: ${task}\n\nEVIDENCE (the only allowed source of facts and numbers):\n${JSON.stringify(
      {
        sources: evidence.facts,
        note: 'available=false means that ONE source returned no data — it is never evidence that the business is healthy or that the other sources are empty.',
      },
    )}`,
    schemaHint: SYNTHESIS_SCHEMA_HINT,
    timeoutMs: 12_000,
    // A transient provider 429 must not discard a completed investigation: the
    // shared client retries ONCE after a short backoff (never an unbounded
    // loop). If it is still limited, the evidence-only degraded insight below
    // is returned.
    retryOnRateLimit: true,
  };
  const synthesisStartedAt = Date.now();

  try {
    let result: LlmJsonResult<unknown>;
    try {
      result = await synthesis(synthesisRequest);
    } catch (firstErr) {
      // Same bounded contract as the loop: one retry for a transient
      // provider JSON-validation failure, never an unbounded retry.
      if (!isRetryableJsonFailure(firstErr)) throw firstErr;
      result = await synthesis(synthesisRequest);
    }
    await recordLlmUsage({
      restaurantId: ctx.tenant.restaurantId,
      requestId: run.runId,
      promptVersion: `${MARKETING_AGENT_PROMPT_VERSION}-synthesis`,
      feature: marketingAgentPolicy.agent,
      promptText: `${synthesisRequest.system}\n${synthesisRequest.prompt}`,
      model: result.model ?? '',
      provider: result.provider ?? '',
      latencyMs: result.latencyMs ?? 0,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      success: true,
    });

    const parsed = insightSynthesisSchema.safeParse(result.value);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.join('.') || 'root';
      degradedReason = `synthesis_invalid_schema:${where}:${first?.code ?? 'invalid'}`;
      summaryReasonCode = 'LLM_INVALID_RESPONSE';
    } else {
      const notes: string[] = [];
      const toolSet = new Set(evidence.toolsUsed);
      const rawRefs = parsed.data.evidenceRefs ?? [];
      const validRefs = rawRefs.filter((r) => toolSet.has(r));
      if (rawRefs.length === 0) {
        notes.push('evidenceRefs:missing');
      } else if (validRefs.length !== rawRefs.length) {
        notes.push(`evidenceRefs:repaired:${rawRefs.filter((r) => !toolSet.has(r)).join('|')}`);
      }
      const refs = validRefs.length > 0 ? validRefs : evidence.toolsUsed;
      const evidenceSources = refs
        .map((ref) => evidence.sources.find((s) => s.ref === ref))
        .filter((s): s is MarketingInsightEvidenceSource => Boolean(s));

      const title = groundText(parsed.data.title, evidence.allowedNumbers, 'Marketing insight');
      const summary = groundText(parsed.data.summary, evidence.allowedNumbers, null);
      const recommendation = parsed.data.recommendation
        ? groundText(parsed.data.recommendation, evidence.allowedNumbers, null)
        : null;
      if (!summary) notes.push('summary:ungrounded');

      insight = {
        id: `insight_${run.runId}`,
        type: 'agentic_insight',
        title: title ?? 'Marketing insight',
        summary:
          summary ??
          `Evidence was collected from ${evidenceSources.map((s) => s.label).join('; ')}; the written summary could not be grounded against it and was removed.`,
        priority: normalizePriority(parsed.data.priority),
        recommendation,
        evidence: evidenceSources.length > 0 ? evidenceSources : evidence.sources,
        confidence: toUnitConfidence(parsed.data.confidence, 0.5),
        toolsUsed: evidence.toolsUsed,
        steps: insightSteps(run),
        degraded: false,
        summaryStatus: notes.length > 0 ? 'partial' : 'ok',
        generatedAt,
      };
      summaryStatus = insight.summaryStatus;
      if (notes.length > 0) {
        degradedReason = `synthesis_partially_rejected:${notes.join(',')}`;
        summaryReasonCode = notes.some((n) => n.startsWith('summary:')) ? 'SUMMARY_UNGROUNDED' : 'SUMMARY_PARTIALLY_REJECTED';
        insight.degradedReason = degradedReason;
        insight.reasonCode = summaryReasonCode;
      }
    }
  } catch (err) {
    // The provider failure is mapped to a stable machine code for diagnostics;
    // the owner-facing text is the evidence-fallback copy (no provider detail).
    summaryReasonCode = reasonCodeForLlmError(err);
    degradedReason = summaryReasonCode;
    summaryStatus = 'unavailable';
    await recordLlmUsage({
      restaurantId: ctx.tenant.restaurantId,
      requestId: run.runId,
      promptVersion: `${MARKETING_AGENT_PROMPT_VERSION}-synthesis`,
      feature: marketingAgentPolicy.agent,
      promptText: `${synthesisRequest.system}\n${synthesisRequest.prompt}`,
      model: '',
      provider: '',
      latencyMs: Date.now() - synthesisStartedAt,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      success: false,
      errorType: err instanceof LlmError ? err.kind : 'synthesis_failed',
      fallbackReason: `evidence-only insight (no AI summary, ${summaryReasonCode ?? 'LLM_FAILED'})`,
    });
  }

  const investigation = toInvestigation(run, insight === null, {
    summaryStatus,
    reasonCode: summaryReasonCode,
  });

  if (!insight) {
    const fallback = evidenceFallbackInsight(summaryReasonCode ?? 'INVESTIGATION_FAILED', evidence, run);
    return {
      mode: 'agentic_insight',
      insights: [fallback],
      investigation,
      degraded: true,
      degradedReason: fallback.degradedReason,
      reasonCode: fallback.reasonCode,
      generatedAt: fallback.generatedAt,
    };
  }

  return {
    mode: 'agentic_insight',
    insights: [insight],
    investigation,
    degraded: false,
    degradedReason,
    reasonCode: summaryReasonCode,
    generatedAt,
  };
}
