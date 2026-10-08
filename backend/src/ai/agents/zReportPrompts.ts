/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportPrompts.ts — PHASE 4 synthesis layer for the Daily Summary /
 * Z-Report Intelligence pipeline.
 *
 * RESPONSIBILITIES
 *   1. Project the EvidencePack into an LLM-facing fact sheet that contains NO
 *      tenant/security metadata (no restaurantId, no branchId, no internals) —
 *      only the evidence the model may speak about, each row carrying a stable
 *      `E<n>` handle so a claim can be traced back to evidence.
 *   2. Ask the ONE shared LLM client for a structured owner-facing report.
 *   3. Enforce grounding SERVER-SIDE (prompt wording is never trusted):
 *      every numeric token must exist in the fact sheet or it is stripped;
 *      malformed/gapped text and unsupported causal claims are rejected.
 *   4. Always have a DETERMINISTIC narrative built from the same evidence, so
 *      the caller always receives a usable report.
 */

import { z } from 'zod';
import { generateJsonWithMeta, LlmError, type LlmUsage } from '../shared/llmClient';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';
import {
  hasUnsupportedCausalLanguage,
  malformedReason,
  stripUngroundedNumbers,
} from '../intelligence/recommendationExplanation';
import type { EvidencePack } from './evidenceMerger';
import type { ZReportContext } from './zReportContext';

// ─────────────────────────────────────────────────────────────────────────────
// Output contract
// ─────────────────────────────────────────────────────────────────────────────

/** Owner-facing daily summary. No reasoning field: no chain-of-thought. */
export const zReportNarrativeSchema = z
  .object({
    headline: z.string().min(8).max(240),
    whatHappened: z.array(z.string().min(4).max(300)).min(1).max(5),
    whatMattered: z.array(z.string().min(4).max(300)).min(1).max(5),
    needsAttention: z.array(z.string().min(4).max(300)).min(1).max(5),
    focusNext: z.array(z.string().min(4).max(240)).min(1).max(4),
    caveats: z.array(z.string().min(4).max(300)).max(6),
  })
  .strict();

export type ZReportNarrative = z.infer<typeof zReportNarrativeSchema>;

export interface ZReportGenerationResult {
  narrative: ZReportNarrative;
  source: 'llm' | 'deterministic';
  /** Why the fallback was used (never a raw provider error message). */
  degradedReason?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  usage?: LlmUsage;
  /** TRUE when an LLM call was actually attempted (observability). */
  llmAttempted: boolean;
  /** How many fabricated numeric tokens the server removed. */
  strippedNumbers: number;
  /** Server-side validation issues (empty on a clean accept). */
  validationIssues: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt projection (no tenant metadata, no internals)
// ─────────────────────────────────────────────────────────────────────────────

export const Z_REPORT_EVIDENCE_PROMPT_LIMIT = 40;

const FRESHNESS_WEIGHT: Record<BusinessSignal['freshness'], number> = {
  fresh: 1,
  aging: 0.8,
  unknown: 0.6,
  stale: 0.2,
  expired: 0,
};

/** Deterministic evidence ordering: confidence first, then freshness. */
function orderEvidence(signals: BusinessSignal[]): BusinessSignal[] {
  return [...signals].sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    const f = FRESHNESS_WEIGHT[b.freshness] - FRESHNESS_WEIGHT[a.freshness];
    if (f !== 0) return f;
    return a.signalId.localeCompare(b.signalId);
  });
}

export interface ZReportPromptEvidence {
  /** Stable handle the model must use when it refers to evidence (E1, E2, …). */
  id: string;
  statement: string;
  code: string;
  source: string;
  freshness: string;
  confidence: number;
  value?: number;
  unit?: string;
  baseline?: number;
  changePercent?: number;
  direction: string;
  sampleSize?: number;
  subject?: string;
  caveats?: string[];
}

export interface ZReportPromptFacts {
  businessDate: string;
  previousDate: string;
  /** Predictive/context evidence lines (ML degradations included honestly). */
  predictiveEvidence: string[];
  evidence: ZReportPromptEvidence[];
  conflicts: string[];
  unavailable: string[];
  failedReads: Array<{ tool: string; code: string }>;
  disclosures: string[];
  memory: string[];
  priorityStatement: string;
}

/** Project the evidence pack into the model-facing fact sheet. */
export function buildZReportPromptFacts(
  context: ZReportContext,
  pack: EvidencePack,
  mlLines: string[] = [],
): { facts: ZReportPromptFacts; evidenceIds: Map<string, BusinessSignal> } {
  const ordered = orderEvidence(pack.signals).slice(0, Z_REPORT_EVIDENCE_PROMPT_LIMIT);
  const evidenceIds = new Map<string, BusinessSignal>();
  const evidence: ZReportPromptEvidence[] = ordered.map((s, i) => {
    const id = `E${i + 1}`;
    evidenceIds.set(id, s);
    return {
      id,
      statement: s.statement,
      code: s.code,
      source: s.source,
      freshness: s.freshness,
      confidence: Math.round(s.confidence * 100) / 100,
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.unit ? { unit: s.unit } : {}),
      ...(s.baseline !== undefined ? { baseline: s.baseline } : {}),
      ...(s.changePct !== undefined ? { changePercent: Math.round(s.changePct * 1000) / 10 } : {}),
      direction: s.direction,
      ...(s.sampleSize !== undefined ? { sampleSize: s.sampleSize } : {}),
      ...(s.subject?.label || s.subject?.id ? { subject: s.subject.label ?? s.subject.id } : {}),
      ...(s.caveats?.length ? { caveats: s.caveats.slice(0, 3) } : {}),
    };
  });

  return {
    evidenceIds,
    facts: {
      businessDate: context.businessDate,
      previousDate: context.comparison.previousDate,
      predictiveEvidence: mlLines.slice(0, 6),
      evidence,
      conflicts: pack.conflicts.conflicts.map(
        (c) => `${c.code} for "${c.subjectId}" disagreed between ${c.left.source} and ${c.right.source}`,
      ),
      unavailable: pack.unavailable.slice(0, 12),
      failedReads: pack.toolErrors.slice(0, 12).map((e) => ({ tool: e.tool, code: e.code })),
      disclosures: pack.caveats.slice(0, 12),
      memory: context.memory.longTerm
        .slice(0, 4)
        .map((m) => `${m.memoryType}${m.entityRef ? ` (${m.entityRef})` : ''}`),
      priorityStatement: context.memory.priorityStatement,
    },
  };
}

const NUMBER_TOKEN_RE = /\d[\d,]*(?:\.\d+)?/g;

function addNumberVariants(set: Set<string>, raw: string): void {
  const clean = raw.replace(/,/g, '');
  set.add(raw);
  set.add(clean);
  const n = Number(clean);
  if (!Number.isFinite(n)) return;
  set.add(String(n));
  set.add(String(Math.round(n)));
  set.add(String(Math.round(n * 10) / 10));
}

/**
 * Every number the model is ALLOWED to state: the pack's own measurements, the
 * numbers inside evidence statements, and the dates it is summarizing.
 * Anything else is treated as fabricated and stripped.
 */
export function allowedNumbersFor(context: ZReportContext, pack: EvidencePack, mlLines: string[] = []): Set<string> {
  const set = new Set<string>();
  const add = (n: number | undefined) => {
    if (n === undefined || !Number.isFinite(n)) return;
    set.add(String(n));
    set.add(String(Math.round(n)));
    set.add(String(Math.round(n * 10) / 10));
  };
  for (const s of pack.signals) {
    add(s.value);
    add(s.baseline);
    add(s.changePct !== undefined ? Math.round(s.changePct * 1000) / 10 : undefined);
    add(s.sampleSize);
    add(Math.round(s.confidence * 100));
    const matches = s.statement.match(NUMBER_TOKEN_RE);
    if (matches) for (const m of matches) addNumberVariants(set, m);
    for (const c of s.caveats ?? []) {
      const cm = c.match(NUMBER_TOKEN_RE);
      if (cm) for (const m of cm) addNumberVariants(set, m);
    }
  }
  for (const line of mlLines) {
    const matches = line.match(NUMBER_TOKEN_RE);
    if (matches) for (const m of matches) addNumberVariants(set, m);
  }
  for (const c of pack.caveats) {
    const matches = c.match(NUMBER_TOKEN_RE);
    if (matches) for (const m of matches) addNumberVariants(set, m);
  }
  // The dates being summarized are legitimately quotable.
  for (const d of [context.businessDate, context.comparison.previousDate]) {
    const matches = d.match(NUMBER_TOKEN_RE);
    if (matches) for (const m of matches) addNumberVariants(set, m);
  }
  // Counts the report may state about its own evidence.
  add(pack.signals.length);
  add(pack.staleSignals.length);
  add(pack.unavailable.length);
  return set;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You write a SHORT daily business summary for a restaurant owner who does not know AI, ML or analytics.',
  'Hard rules:',
  '1. Use ONLY the evidence in the input JSON. Never invent numbers, money, percentages, customers or events.',
  '2. Every number you write MUST already appear in the evidence rows (a value, a baseline, a change, a date or a count).',
  '3. Evidence marked stale or expired must NEVER be described as current fact.',
  '4. Never claim causation. Do not use words like caused, drove, because of, resulted in, will increase, proven, guaranteed. Describe what was observed and what is unknown.',
  '5. If a read failed or a source is unavailable, say so plainly instead of filling the gap or guessing.',
  '6. If two sources disagreed on the same metric, say that they disagreed; do not pick a winner.',
  '7. No technical jargon: no model names, embeddings, agents, pipelines, tool calls, IDs or code names.',
  '8. Answer ONLY with the JSON object matching the shape.',
].join('\n');

const SCHEMA_HINT = `{
  "headline": string (one clear sentence about the day),
  "whatHappened": string[] (1-5 plain statements of what the evidence shows),
  "whatMattered": string[] (1-5 statements on what is most meaningful and why, evidence-only),
  "needsAttention": string[] (1-5 things the owner should look at; state "unclear" where evidence is missing),
  "focusNext": string[] (1-4 concrete suggested focuses for tomorrow — advice grounded in the evidence, no promises),
  "caveats": string[] (data limits the owner must know: unavailable reads, stale evidence, baseline used)
}`;

const FIELD_NAMES: Array<keyof ZReportNarrative> = [
  'headline',
  'whatHappened',
  'whatMattered',
  'needsAttention',
  'focusNext',
  'caveats',
];

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic narrative (always available)
// ─────────────────────────────────────────────────────────────────────────────

/** Evidence codes that MUST be addressed in the report when present. */
export const Z_REPORT_MUST_ADDRESS: Array<{ code: BusinessSignal['code']; label: string; pattern: RegExp }> = [
  { code: 'cash_over_short', label: 'drawer variance', pattern: /cash|drawer|till|variance|over|short/i },
  { code: 'refund_spike', label: 'refunds', pattern: /refund/i },
  { code: 'inventory_wastage_spike', label: 'wastage', pattern: /wast|spoil|thrown/i },
  { code: 'sales_decline', label: 'revenue decline', pattern: /revenue|sales|orders/i },
  { code: 'discount_pressure', label: 'discounting', pattern: /discount|offer|promo/i },
];

function bullet(lines: string[], limit: number): string[] {
  return [...new Set(lines.filter((l) => l.trim().length >= 4))].slice(0, limit);
}

/**
 * Deterministic narrative built ONLY from normalized evidence statements, so it
 * is grounded by construction (no currency is invented, no value is recomputed).
 */
export function deterministicZReportNarrative(
  context: ZReportContext,
  pack: EvidencePack,
  mlLines: string[] = [],
): ZReportNarrative {
  const ordered = orderEvidence(pack.signals).filter((s) => s.freshness !== 'expired');
  const usable = ordered.filter((s) => s.freshness === 'fresh' || s.freshness === 'aging');
  const top = usable.length ? usable : ordered;

  const caveats = bullet(
    [
      ...pack.caveats,
      ...(pack.unavailable.length ? [`Not available for this run: ${pack.unavailable.join(', ')}.`] : []),
      ...(pack.toolErrors.length ? [`${pack.toolErrors.length} data read(s) failed and are excluded from this summary.`] : []),
      ...(pack.conflicts.conflicts.length
        ? [`${pack.conflicts.conflicts.length} metric(s) were reported inconsistently by different sources; both readings are shown rather than a single winner.`]
        : []),
      ...(pack.staleSignals.length ? [`${pack.staleSignals.length} older reading(s) were excluded because they are no longer current.`] : []),
      ...mlLines,
    ],
    6,
  );

  if (!top.length) {
    return {
      headline: `No usable evidence was available for ${context.businessDate}.`,
      whatHappened: ['No current business data could be read for this date.'],
      whatMattered: ['Nothing can be concluded from this run.'],
      needsAttention: ['Check that today’s sales, closing and inventory data were recorded.'],
      focusNext: ['Record and close the day so tomorrow’s summary has evidence.'],
      caveats: caveats.length ? caveats : ['This summary is empty because no evidence was available.'],
    };
  }

  const attentionCodes = new Set(Z_REPORT_MUST_ADDRESS.map((m) => m.code));
  const attention = bullet(
    top.filter((s) => attentionCodes.has(s.code)).map((s) => s.statement),
    5,
  );
  const focus = bullet(
    top
      .filter((s) => s.code !== 'sales_day_close' && s.code !== 'sales_revenue_level')
      .map((s) => statementToFocus(s)),
    4,
  );

  return {
    headline: headlineFor(context, top, pack),
    whatHappened: bullet(top.map((s) => s.statement), 5),
    whatMattered: bullet(top.slice(0, 3).map((s) => s.statement), 5),
    needsAttention: attention.length ? attention : ['Nothing unusual stands out in the evidence for this date.'],
    focusNext: focus.length ? focus : ['Keep the day closed and recorded so tomorrow’s summary is complete.'],
    caveats,
  };
}

function statementToFocus(s: BusinessSignal): string {
  switch (s.code) {
    case 'cash_over_short':
      return 'Recheck the cash drawer count against the closing report before the next shift.';
    case 'refund_spike':
      return 'Review the refunded orders and confirm the reasons with the counter staff.';
    case 'inventory_wastage_spike':
    case 'inventory_wastage':
      return `Check prep quantities for ${s.subject?.label ?? 'the affected ingredients'} to reduce wastage.`;
    case 'discount_pressure':
      return 'Review which discounts ran and whether they earned their cost.';
    case 'sales_decline':
    case 'volume_aov_divergence':
      return 'Look at the products and time slots that moved and decide what to adjust tomorrow.';
    case 'inventory_low':
    case 'inventory_stockout_risk':
      return `Restock ${s.subject?.label ?? 'the low items'} before the next service.`;
    default:
      return `Keep watching: ${s.statement}`.slice(0, 240);
  }
}

function headlineFor(context: ZReportContext, top: BusinessSignal[], pack: EvidencePack): string {
  const lead = top.find((s) => s.category === 'sales') ?? top[0];
  const prefix = pack.usable ? '' : 'Limited evidence — ';
  return `${prefix}${context.businessDate}: ${lead.statement}`.slice(0, 240);
}

/** Deterministic, freshness-weighted confidence for the whole report. */
export function computeReportConfidence(pack: EvidencePack): number {
  const usable = pack.signals.filter((s) => s.freshness !== 'stale' && s.freshness !== 'expired');
  if (!usable.length) return 0;
  const top = orderEvidence(usable).slice(0, 8);
  const weighted = top.reduce((sum, s) => sum + s.confidence * FRESHNESS_WEIGHT[s.freshness], 0) / top.length;
  const penalty = (pack.unavailable.length ? 0.05 : 0) + (pack.toolErrors.length ? 0.05 : 0);
  return Math.max(0, Math.min(1, Math.round((weighted - penalty) * 100) / 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateZReportOptions {
  context: ZReportContext;
  pack: EvidencePack;
  mlLines?: string[];
  timeoutMs?: number;
  /** Test seam / offline mode: force the deterministic path. */
  disableLlm?: boolean;
}

/**
 * Pipeline-local refinement of the SHARED malformed-text rule.
 *
 * `malformedReason` intentionally treats a trailing "%"/"percent" as debris
 * left behind by a stripped value (marketing copy never ends a sentence with
 * one). A daily summary legitimately states "revenue fell 18%.", so here a
 * percent DIRECTLY attached to a number is accepted; a percent with no number
 * before it is still rejected as residue. The shared rule is NOT modified —
 * the marketing pipeline's behaviour stays exactly as it was.
 */
export function zReportTextProblem(text: string): string | null {
  const reason = malformedReason(text);
  if (reason === 'dangling_percent' && /\d\s*(?:%|percent|percentage point)/i.test(text)) return null;
  return reason;
}

/**
 * Strip fabricated numbers and report structural/grounding problems.
 * Exported so the enforcement rules are directly unit-testable.
 */
export function groundZReportNarrative(
  narrative: ZReportNarrative,
  allowed: Set<string>,
): { narrative: ZReportNarrative; stripped: number; issues: string[] } {
  const issues: string[] = [];
  let stripped = 0;
  const clean = (text: string): string => {
    const r = stripUngroundedNumbers(text, allowed);
    stripped += r.stripped.length;
    return r.text;
  };
  const grounded = zReportNarrativeSchema.safeParse({
    headline: clean(narrative.headline),
    whatHappened: narrative.whatHappened.map(clean),
    whatMattered: narrative.whatMattered.map(clean),
    needsAttention: narrative.needsAttention.map(clean),
    focusNext: narrative.focusNext.map(clean),
    caveats: narrative.caveats.map(clean),
  });
  if (!grounded.success) {
    return { narrative, stripped, issues: ['schema_invalid_after_grounding'] };
  }
  for (const field of FIELD_NAMES) {
    const value = grounded.data[field];
    const texts = Array.isArray(value) ? value : [value];
    for (const t of texts) {
      const reason = zReportTextProblem(t);
      if (reason) issues.push(`${field}:${reason}`);
      if (hasUnsupportedCausalLanguage(t)) issues.push(`${field}:unsupported_causal_language`);
    }
  }
  return { narrative: grounded.data, stripped, issues: [...new Set(issues)] };
}

/**
 * Produce the daily summary narrative. NEVER throws: any LLM problem, invalid
 * output, or grounding failure returns the deterministic narrative instead.
 */
export async function generateZReportNarrative(opts: GenerateZReportOptions): Promise<ZReportGenerationResult> {
  const { context, pack } = opts;
  const mlLines = opts.mlLines ?? [];
  const allowed = allowedNumbersFor(context, pack, mlLines);
  const fallback = (reason: string, llmAttempted = false, extra?: Partial<ZReportGenerationResult>): ZReportGenerationResult => ({
    narrative: deterministicZReportNarrative(context, pack, mlLines),
    source: 'deterministic',
    degradedReason: reason,
    llmAttempted,
    strippedNumbers: 0,
    validationIssues: [],
    ...extra,
  });

  if (opts.disableLlm) return fallback('llm_disabled');
  // Nothing usable in the pack: a model call would only produce filler.
  if (!pack.signals.length) return fallback('no_evidence');

  const { facts } = buildZReportPromptFacts(context, pack, mlLines);
  const prompt = [
    `Summarize the business day ${context.businessDate} for the owner.`,
    `Currency, when you write money, is the Indian Rupee (₹).`,
    ``,
    `EVIDENCE (the only facts you may use):`,
    JSON.stringify(facts, null, 1),
  ].join('\n');

  try {
    const result = await generateJsonWithMeta<unknown>({
      system: SYSTEM_PROMPT,
      prompt,
      schemaHint: SCHEMA_HINT,
      timeoutMs: opts.timeoutMs ?? 15_000,
    });
    const parsed = zReportNarrativeSchema.safeParse(result.value);
    if (!parsed.success) {
      return fallback('invalid_schema', true, {
        model: result.model,
        provider: result.provider,
        latencyMs: result.latencyMs,
        usage: result.usage,
      });
    }
    const grounded = groundZReportNarrative(parsed.data, allowed);
    const structural = grounded.issues;
    if (grounded.narrative.headline.length < 8 || !grounded.narrative.whatHappened.length) {
      structural.push('empty_after_grounding');
    }
    if (structural.length) {
      return fallback(`rejected:${structural.slice(0, 3).join(',')}`, true, {
        model: result.model,
        provider: result.provider,
        latencyMs: result.latencyMs,
        usage: result.usage,
        strippedNumbers: grounded.stripped,
        validationIssues: structural,
      });
    }
    return {
      narrative: grounded.narrative,
      source: 'llm',
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
      usage: result.usage,
      llmAttempted: true,
      strippedNumbers: grounded.stripped,
      validationIssues: [],
    };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'unknown';
    return fallback(`llm_${kind}`, true);
  }
}
