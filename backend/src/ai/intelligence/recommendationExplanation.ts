/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationExplanation.ts — PHASE 7 grounded explanations.
 *
 * WHAT IT IS: a speech layer over the DETERMINISTIC ranking already computed
 * by Phase 6. It uses the ONE shared LLM client (`generateJsonWithMeta`) to
 * turn structured evidence into owner-readable language:
 *   - why this recommendation,
 *   - the evidence summary,
 *   - why they fit THIS restaurant,
 *   - why alternatives were not selected,
 *   - a human-readable offer description and campaign copy.
 *
 * HARD RULES (enforced in code, not just prompts):
 *   1. Grounded only: the model receives a closed set of FACTS and may only
 *      reference them. Every numeric token in the output is checked against
 *      the supplied numbers — unlisted numbers are stripped by the validator.
 *   2. No fabrication: missing evidence is stated as unavailable.
 *   3. No chain-of-thought: the schema has no "reasoning" field; only
 *      decision evidence that an owner can read.
 *   4. Graceful degradation: LLM failure/timeout/malformed JSON → the
 *      deterministic fallback template built from the same facts. The caller
 *      ALWAYS receives a usable result.
 */

import { z } from 'zod';
import { generateJsonWithMeta, LlmError } from '../shared/llmClient';
import type { RankedRecommendation, RankingResult } from './recommendationRanking';

// ─────────────────────────────────────────────────────────────────────────────
// Grounding facts (the ONLY numbers/labels the model may use)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExplanationFacts {
  restaurantName?: string;
  currency: string;
  /** Facts for the ranked recommendations (numbers are the grounding set). */
  recommendations: Array<{
    rank: number;
    title: string;
    strategyLabel: string;
    description: string;
    action: string;
    engineScore: number;
    confidencePct: number;
    discountPct: number;
    marginPct: number;
    incrementalRevenue: number;
    breakEvenUnits: number;
    paybackDays: number;
    economicallySafe: boolean;
    /** FALSE when no authoritative economics exist (numbers are placeholders). */
    economicsAvailable: boolean;
    risks: string[];
    prerequisites: string[];
    signalCodes: string[];
    /** Dimension-level signal themes present in the data (NOT product-specific). */
    signalThemes: string[];
    mlKinds: string[];
    memoryStatements: string[];
    evidenceDescriptions: string[];
  }>;
  /** Signals that exist but did NOT feed any recommendation. */
  unusedSignals: string[];
  /** ML services that are degraded/unavailable, with plain reasons. */
  mlDegradations: string[];
  /** Candidate types the engine produced but ranking dropped. */
  droppedStrategies: string[];
  /** TRUE only when gated causal (experiment) evidence exists. */
  hasCausalEvidence?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output schema (validated)
// ─────────────────────────────────────────────────────────────────────────────

export const explanationSchema = z
  .object({
    recommendation: z.string().min(1).max(400),
    evidenceSummary: z.array(z.string().min(1).max(300)).max(6),
    whyItFits: z.string().min(1).max(400),
    whyAlternatives: z.string().min(1).max(400),
    offerDescription: z.string().min(1).max(400),
    campaignCopy: z.string().min(1).max(300),
  })
  .strict();

export type RecommendationExplanation = z.infer<typeof explanationSchema>;

export interface ExplanationResult {
  explanation: RecommendationExplanation;
  /** deterministic = template fallback; llm = validated model output. */
  source: 'llm' | 'deterministic';
  /** Why the fallback was used (never a raw provider error message). */
  degradedReason?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  /** Token usage where the provider reported it (0 when unavailable). */
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** TRUE when an LLM call was actually attempted (for observability). */
  llmAttempted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Number grounding
// ─────────────────────────────────────────────────────────────────────────────

/** Every number the model is allowed to state, as canonical strings. */
function allowedNumbers(facts: ExplanationFacts, rec: ExplanationFacts['recommendations'][number]): Set<string> {
  const set = new Set<string>();
  const add = (n: number | undefined) => {
    if (n === undefined || !Number.isFinite(n)) return;
    set.add(String(n));
    set.add(String(Math.round(n)));
    set.add(String(Math.round(n * 10) / 10));
  };
  add(rec.rank);
  add(rec.engineScore);
  add(rec.confidencePct);
  // Placeholder economics must never be quotable as real money: when the
  // engine had no price/cost data, "0"/"0%" are NOT allowed numbers — the
  // model is not told them and cannot state a fake ₹0.
  if (rec.economicsAvailable !== false) {
    add(rec.discountPct);
    add(rec.marginPct);
    add(rec.incrementalRevenue);
    add(rec.breakEvenUnits);
    add(rec.paybackDays);
  }
  // Other recommendations' ranks are legitimate context.
  for (const r of facts.recommendations) add(r.rank);
  // Numbers the ENGINE itself wrote (candidate description, engine evidence)
  // and validated memory statements are server-side facts, not model
  // inventions. Allowing them keeps the model from quoting a real number that
  // then gets stripped into broken copy ("dropped from to baseline").
  addNumbersFromText(set, rec.description);
  for (const e of rec.evidenceDescriptions) addNumbersFromText(set, e);
  for (const m of rec.memoryStatements) addNumbersFromText(set, m);
  return set;
}

const NUMBER_TOKEN_RE = /\d[\d,]*(?:\.\d+)?/g;

/** Add every numeric token in engine-authored text to the allowed set. */
function addNumbersFromText(set: Set<string>, text: string | undefined): void {
  if (!text) return;
  const matches = text.match(NUMBER_TOKEN_RE);
  if (!matches) return;
  for (const raw of matches) {
    const clean = raw.replace(/,/g, '');
    set.add(raw);
    set.add(clean);
    const n = Number(clean);
    if (Number.isFinite(n)) {
      set.add(String(n));
      set.add(String(Math.round(n)));
      set.add(String(Math.round(n * 10) / 10));
    }
  }
}

/** A number plus its optional currency prefix, unit suffix and AM/PM marker,
 * so removing an invented value removes the WHOLE token - never a dangling
 * symbol or a fragment like "PM to PM". Written as regex literals so there is
 * no string-escaping ambiguity. */
// NOTE: the leading whitespace before a bare number is intentionally NOT part
// of the match (only currency+space is), so removing a stripped number cannot
// glue the surrounding words together ("from 2 campaigns" -> "from campaigns",
// never "fromcampaigns").
const NUMBER_WITH_UNIT_RE = /(?:(?:₹|Rs\.?|INR|[$]|€|£)\s?)?\d+(?:[.,]\d+)?(?:\s?(?:%|percent|percentage points?|pp|days?|customers?|orders?|times?))?(?:\s?(?:am|pm))?/gi;

/** A lone currency symbol left behind by a stripped amount. */
const DANGLING_CURRENCY_RE = /(?:₹|Rs\.?|INR|[$]|€|£)(?=\s|$|[.,;:!?])/g;
// Non-global twin for stateless .test() - a global regex is stateful and would
// make isMalformedGroundedText depend on call order.
const DANGLING_CURRENCY_TEST_RE = /(?:₹|Rs\.?|INR|[$]|€|£)(?=\s|$|[.,;:!?])/;

const DANGLING_CONNECTOR_RE = /\b(of|from|to|at|about|around|approximately|near)\s*([.,;:!?]|$)/gi;

/**
 * Strip any number NOT present in the grounding set (keeps the sentence
 * readable by removing just the fabricated token). This is the hard guard
 * against invented percentages/amounts.
 */
export function stripUngroundedNumbers(text: string, allowed: Set<string>): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  const out = text.replace(NUMBER_WITH_UNIT_RE, (m) => {
    const numeric = m.match(/\d+(?:[.,]\d+)?/);
    if (!numeric) return m;
    const digits = numeric[0];
    const normalized = digits.replace(/,/g, '');
    if (allowed.has(digits) || allowed.has(normalized) || allowed.has(String(Number(normalized)))) return m;
    stripped.push(digits);
    return '';
  });
  // Tidy the gaps a removed token can leave (double spaces, space-before-
  // punctuation, orphaned currency/connectors) without touching survivors.
  const tidied = out
    .replace(/\s{2,}/g, ' ')
    .replace(DANGLING_CURRENCY_RE, '')
    .replace(DANGLING_CONNECTOR_RE, '$2')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\b(is|are|was|were)\s*([.,;])/gi, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: tidied, stripped };
}

/**
 * True when a grounded sentence still reads as broken — a dangling currency,
 * a unit/qualifier with no number, or a time expression with no hour. Such
 * text must never reach the owner; the caller falls back to the deterministic
 * template instead.
 */
export function malformedReason(text: string): string | null {
  if (!text) return null; // empty is handled separately (min-length checks)
  if (DANGLING_CURRENCY_TEST_RE.test(text)) return 'dangling_currency';
  if (/\b(?:am|pm)\b/i.test(text) && !/\d/.test(text)) return 'bare_ampm';
  if (/(?:%|percent|percentage points?|\bpp\b)\s*([.,;:!?]|$)/i.test(text)) return 'dangling_percent';
  if (/\b(of|from|to|at|about|around|approximately)\s*([.,;:!?]|$)/i.test(text)) return 'dangling_connector';
  // A stripped value leaves adjacent DIRECTIONAL connectors with no value
  // between them ("dropped to from baseline", "increase of from …").
  // Only the directional set is checked: "from about 5pm", "with around 20%"
  // and "at about 3pm" are valid English and must not be rejected.
  if (/\b(?:to|from|of)\s+(?:to|from|of)\b/i.test(text)) return 'double_connector';
  // An open paren/space followed by a lowercase word is a stripped parenthetical
  // ("( campaigns, recipients)").
  if (/\(\s+[a-z]/i.test(text)) return 'stripped_parenthetical';
  // An empty numeric container left by a removed value.
  if (/\d+\s*\(\s*\)/.test(text)) return 'empty_numeric_container';
  return null;
}

/**
 * Same verdict as before, but auditable: the caller records WHICH field and
 * WHICH rule rejected the text, so a fallback is diagnosable instead of a
 * blanket "malformed" (spec §observability).
 */
export function isMalformedGroundedText(text: string): boolean {
  return malformedReason(text) !== null;
}

/**
 * PHASE F: causal-language guard. LLM copy may not assert causation unless
 * gated experiment evidence exists. This runs on the FINAL text server-side —
 * prompt wording is never trusted. If the model claims causation without
 * evidence, the caller falls back to the deterministic template.
 */
const CAUSAL_PATTERNS: RegExp[] = [
  /\bcaused?\b/i,
  /\bdriven by\b/i,
  /\bdrove\b/i,
  /\bresulted in\b/i,
  /\bleads? to\b/i,
  /\bbecause of (this|the)\b/i,
  /\bwill (increase|raise|boost|grow|lift)\b/i,
  /\b(incremental )?lift(ed)?\b/i,
  /\bproven\b/i,
  /\bguaranteed?\b/i,
];

export function hasUnsupportedCausalLanguage(text: string): boolean {
  return CAUSAL_PATTERNS.some((re) => re.test(text));
}

function groundExplanation(explanation: RecommendationExplanation, allowed: Set<string>): RecommendationExplanation {
  const clean = (s: string) => stripUngroundedNumbers(s, allowed).text;
  return {
    recommendation: clean(explanation.recommendation),
    evidenceSummary: explanation.evidenceSummary.map(clean).filter((s) => s.length > 0),
    whyItFits: clean(explanation.whyItFits),
    whyAlternatives: clean(explanation.whyAlternatives),
    offerDescription: clean(explanation.offerDescription),
    campaignCopy: clean(explanation.campaignCopy),
  };
}

/** Symbols/forms are fine to differ (₹/Rs/INR) — only digits are checked. */
function promptFacts(facts: ExplanationFacts, rec: ExplanationFacts['recommendations'][number]): string {
  return JSON.stringify(
    {
      restaurant: facts.restaurantName ?? 'this restaurant',
      currency: facts.currency,
      recommendation: {
        rank: rec.rank,
        title: rec.title,
        strategy: rec.strategyLabel,
        description: rec.description,
        action: rec.action,
        engineScore: rec.engineScore,
        confidencePercent: rec.confidencePct,
        discountPercent: rec.discountPct,
        projectedMarginPercent: rec.marginPct,
        incrementalRevenue: rec.incrementalRevenue,
        breakEvenUnits: rec.breakEvenUnits,
        paybackDays: rec.paybackDays,
        passesEconomicConstraints: rec.economicallySafe,
        economicsAvailable: rec.economicsAvailable,
        risks: rec.risks,
        prerequisites: rec.prerequisites,
        businessSignals: rec.signalCodes,
        signalThemesPresentButNotSpecificToTheseProducts: rec.signalThemes,
        mlEvidenceKinds: rec.mlKinds,
        validatedMemory: rec.memoryStatements,
        engineEvidence: rec.evidenceDescriptions,
      },
      otherRecommendations: facts.recommendations
        .filter((r) => r.rank !== rec.rank)
        .map((r) => ({ rank: r.rank, title: r.title, strategy: r.strategyLabel, notSelectedReasonCandidate: r.economicallySafe ? 'lower ranked' : 'failed economic constraints' })),
      signalsNotUsed: facts.unusedSignals,
      unavailableMlEvidence: facts.mlDegradations,
      strategiesDroppedByRanking: facts.droppedStrategies,
    },
    null,
    1,
  );
}

const SYSTEM_PROMPT = [
  'You explain a marketing recommendation to a restaurant owner who does NOT know AI, ML or technical terms.',
  'Hard rules:',
  '1. Use ONLY the facts in the input JSON. Never invent numbers, percentages, money, customers, conversion rates or history.',
  '2. If a fact is missing, say it is not available — never guess.',
  '3. No technical jargon (no model names, embeddings, agents, tool calls, chain-of-thought).',
  '4. Be concise, warm and concrete. Currency is given; write amounts like "₹1,200" or per the given currency code.',
  '5. Answer ONLY with the JSON object matching the schema.',
].join('\n');

const SCHEMA_HINT = `{
  "recommendation": string (one sentence: what to do),
  "evidenceSummary": string[] (1-4 short bullet lines, each grounded in the facts),
  "whyItFits": string (why it suits THIS restaurant, grounded),
  "whyAlternatives": string (why other options were not picked first, or state that none were available),
  "offerDescription": string (plain-language offer the owner can put in a promotion),
  "campaignCopy": string (one short message to send to customers)
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallback (always available)
// ─────────────────────────────────────────────────────────────────────────────

export function deterministicExplanation(
  facts: ExplanationFacts,
  rec: ExplanationFacts['recommendations'][number],
): RecommendationExplanation {
  const money = (n: number) => `${facts.currency}${Math.round(n).toLocaleString('en-IN')}`;
  const evidence: string[] = [];
  if (rec.signalCodes.length) evidence.push(`Current business evidence (about these products): ${rec.signalCodes.join(', ')}.`);
  if (rec.signalThemes.length) evidence.push(`Signal themes present in your restaurant data (not specific to these products): ${rec.signalThemes.join(', ')}.`);
  if (rec.mlKinds.length) evidence.push(`Supporting predictions available: ${rec.mlKinds.join(', ')}.`);
  if (rec.memoryStatements.length) evidence.push(`What worked before: ${rec.memoryStatements.join(' ')}`);
  if (rec.evidenceDescriptions.length) evidence.push(rec.evidenceDescriptions.slice(0, 2).join(' '));
  if (!evidence.length) evidence.push('No supporting evidence is available yet for this recommendation.');

  const alternatives =
    facts.recommendations.length > 1
      ? `Other options ranked lower because they had less supporting evidence or weaker economics. The next best was #${rec.rank === 1 ? 2 : 1}.`
      : 'No other options were available to compare against.';

  // `!== false` (not `!x`): the field is optional, so legacy callers that
  // omit it must keep the previous behaviour, while an explicit "unavailable"
  // from the engine suppresses the profit claims.
  const fit = rec.economicsAvailable === false
    ? 'No verified cost and price data is available for this option yet, so its profit impact could not be calculated. Review it as an idea, not as a confirmed profit.'
    : rec.economicallySafe
      ? `This fits your restaurant because it stays within your margin floor (${rec.marginPct}% projected) and your discount limit (${rec.discountPct}% discount).`
      : `Careful: this option does NOT meet your usual margin or discount limits — review it before acting.`;

  // Never print placeholder economics as if they were real money.
  const offerDescription = rec.economicsAvailable === false
    ? `${rec.title}. ${rec.action.replace(/_/g, ' ')}. Profit impact is not available yet — no cost and price data to calculate it.`.slice(0, 400)
    : `${rec.title}. ${rec.action.replace(/_/g, ' ')}. Expected extra revenue about ${money(rec.incrementalRevenue)}; needs about ${rec.breakEvenUnits} extra sale(s) to break even.`.slice(0, 400);

  return {
    recommendation: `${rec.title} — ${rec.description}`.slice(0, 400),
    evidenceSummary: evidence,
    whyItFits: fit.slice(0, 400),
    whyAlternatives: alternatives.slice(0, 400),
    offerDescription,
    campaignCopy: `Try our ${rec.strategyLabel}: ${rec.title}. Limited time!`.slice(0, 300),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ExplainOptions {
  facts: ExplanationFacts;
  /** Which ranked recommendation to explain (default: rank 1). */
  rank?: number;
  timeoutMs?: number;
  /** Test seam / offline mode: force the deterministic path. */
  disableLlm?: boolean;
}

/**
 * Produce a grounded explanation for ONE ranked recommendation.
 * NEVER throws: any LLM problem returns the deterministic template.
 */
export async function explainRecommendation(options: ExplainOptions): Promise<ExplanationResult> {
  const { facts } = options;
  const target = facts.recommendations.find((r) => r.rank === (options.rank ?? 1));
  if (!target) {
    return {
      explanation: {
        recommendation: 'No recommendation is available to explain.',
        evidenceSummary: [],
        whyItFits: 'No recommendation is available.',
        whyAlternatives: 'No recommendation is available.',
        offerDescription: 'No recommendation is available.',
        campaignCopy: '',
      },
      source: 'deterministic',
      degradedReason: 'no_recommendation',
    };
  }

  const fallback = (reason: string): ExplanationResult => ({
    explanation: deterministicExplanation(facts, target),
    source: 'deterministic',
    degradedReason: reason,
  });

  if (options.disableLlm) return fallback('llm_disabled');

  try {
    const result = await generateJsonWithMeta<unknown>({
      system: SYSTEM_PROMPT,
      prompt: `Explain this recommendation for the owner.\n\nFACTS:\n${promptFacts(facts, target)}`,
      schemaHint: SCHEMA_HINT,
      timeoutMs: options.timeoutMs ?? 12_000,
    });

    const parsed = explanationSchema.safeParse(result.value);
    if (!parsed.success) return { ...fallback('invalid_schema'), llmAttempted: true };

    const allowed = allowedNumbers(facts, target);
    const grounded = groundExplanation(parsed.data, allowed);
    // If grounding removed so much that key fields became empty/malformed, the
    // model was inventing — prefer the deterministic version. Broken owner
    // copy ("₹", "from PM to PM", "festive lift of") must never ship.
    const fields = [
      grounded.recommendation,
      grounded.whyItFits,
      grounded.whyAlternatives,
      grounded.offerDescription,
      grounded.campaignCopy,
      ...grounded.evidenceSummary,
    ];
    if (grounded.recommendation.length < 8 || grounded.whyItFits.length < 8) return { ...fallback('ungrounded_output'), llmAttempted: true };
    // Auditable rejection: record the field + rule that failed (never the text).
    const FIELD_NAMES = ['recommendation', 'whyItFits', 'whyAlternatives', 'offerDescription', 'campaignCopy', 'evidenceSummary'];
    for (let i = 0; i < fields.length; i += 1) {
      const reason = malformedReason(fields[i]);
      if (reason) {
        const field = i < FIELD_NAMES.length ? FIELD_NAMES[i] : `evidenceSummary[${i - FIELD_NAMES.length}]`;
        return { ...fallback(`malformed_grounded_output:${field}:${reason}`), llmAttempted: true };
      }
    }
    // Causal safety: block unsupported causal claims unless gated evidence exists.
    if (!facts.hasCausalEvidence && fields.some(hasUnsupportedCausalLanguage)) {
      return { ...fallback('unsupported_causal_language'), llmAttempted: true };
    }

    return {
      explanation: grounded,
      source: 'llm',
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
      usage: result.usage,
      llmAttempted: true,
    };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'unknown';
    return { ...fallback(`llm_${kind}`), llmAttempted: true };
  }
}

/** Build explanation facts from a ranking result + supporting context. */
export function buildExplanationFacts(input: {
  ranking: RankingResult;
  restaurantName?: string;
  currency: string;
  unusedSignals?: string[];
  mlDegradations?: string[];
  hasCausalEvidence?: boolean;
}): ExplanationFacts {
  return {
    restaurantName: input.restaurantName,
    currency: input.currency,
    hasCausalEvidence: input.hasCausalEvidence ?? false,
    recommendations: input.ranking.recommendations.map((r: RankedRecommendation) => ({
      rank: r.rank,
      title: r.title,
      strategyLabel: r.strategyLabel,
      description: r.description.slice(0, 200),
      action: r.recommendedAction,
      engineScore: Math.round(r.engineScore),
      confidencePct: Math.round(r.confidence * 100),
      // When economics are unavailable the numeric fields are sent as NaN →
      // serialized as null in the prompt and excluded from the allowed set, so
      // the model cannot present placeholder zeros as measurements.
      discountPct: r.economics.available ? Math.round(r.economics.discountPercent) : NaN,
      marginPct: r.economics.available ? Math.round(r.economics.projectedContributionMargin) : NaN,
      incrementalRevenue: r.economics.available ? r.economics.incrementalRevenue : NaN,
      breakEvenUnits: r.economics.available ? (r.economics.breakEvenIncrementalUnits < 0 ? 0 : r.economics.breakEvenIncrementalUnits) : NaN,
      paybackDays: r.economics.available ? (r.economics.paybackPeriodDays < 0 ? 0 : r.economics.paybackPeriodDays) : NaN,
      economicallySafe: r.economics.economicallySafe,
      economicsAvailable: r.economics.available,
      risks: r.risks.slice(0, 4),
      prerequisites: r.prerequisites.slice(0, 4),
      signalCodes: r.provenance.signalCodes,
      signalThemes: r.provenance.signalThemes ?? [],
      mlKinds: r.provenance.mlKinds,
      memoryStatements: [],
      evidenceDescriptions: r.evidence.slice(0, 3).map((e) => e.description).filter(Boolean),
    })),
    unusedSignals: input.unusedSignals ?? [],
    mlDegradations: input.mlDegradations ?? [],
    droppedStrategies: input.ranking.notes,
  };
}