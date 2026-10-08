/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationRanking.ts — PHASE 6 ranking and strategic diversity.
 *
 * WHAT IT IS: a DETERMINISTIC, reproducible selector that takes the EXISTING
 * engine's candidates (promotionCandidateService output, already scored and
 * financially validated) plus optional ML evidence and memory, and produces a
 * final, strategy-diverse shortlist of ~7–10 recommendations.
 *
 * DESIGN RULES:
 *   - No arbitrary weights: every component is a documented, bounded factor
 *     with an explicit rationale. The engine's own `score` (0–100, already a
 *     deterministic financial+signal score) is the dominant term; the other
 *     factors only break ties and enforce diversity.
 *   - Reproducible: same inputs → same order (stable sort + explicit
 *     tie-breakers on id). No randomness, no Date.now in the scoring.
 *   - Economic safety dominates: candidates whose deterministic economics
 *     violate their own constraints (or whose payback is unrecoverable) are
 *     demoted below safe ones, never promoted by narrative.
 *   - Diversity: at most `maxPerStrategy` items of the same strategy, and the
 *     shortlist is filled by round-robin across strategies so it never becomes
 *     "10 variations of the same discount".
 */

import type { PromotionCandidate } from '../../services/promotionCandidateService';
import type { BusinessSignal } from './businessSignalTypes';
import type { MlSignalSummary } from './mlTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Strategy classification (from the engine's own PromotionType vocabulary)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy buckets used for diversity. These map 1:1 onto the engine's own
 * PromotionType values — no new strategy vocabulary is invented.
 */
export const STRATEGY_LABELS: Record<string, string> = {
  CREATE_COMBO: 'product combo',
  CREATE_ADDON: 'add-on strategy',
  CREATE_PROMOTION: 'targeted promotion',
  RUN_REACTIVATION: 'win-back campaign',
  PROMOTE_SLOW_ITEM: 'slow-item activation',
  PROTECT_HIGH_DEMAND_STOCK: 'protect high-demand stock',
  REDUCE_WASTAGE: 'inventory-aware offer',
  REVIEW_PRICE: 'price review',
  REVIEW_RECIPE_COST: 'recipe-cost review',
};

export function strategyOf(candidate: Pick<PromotionCandidate, 'type'>): string {
  return candidate.type;
}

export function strategyLabel(type: string): string {
  return STRATEGY_LABELS[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface RankedRecommendation {
  rank: number;
  id: string;
  type: string;
  strategy: string;
  strategyLabel: string;
  title: string;
  description: string;
  recommendedAction: string;
  /** The engine's own score — carried through unchanged. */
  engineScore: number;
  /** Final deterministic rank score (documented components below). */
  rankScore: number;
  confidence: number;
  priority: string;
  economics: {
    discountPercent: number;
    projectedContributionMargin: number;
    incrementalRevenue: number;
    incrementalUnits: number;
    breakEvenIncrementalUnits: number;
    paybackPeriodDays: number;
    economicallySafe: boolean;
    /** FALSE when the engine had no authoritative price/cost data. */
    available: boolean;
  };
  cannibalization: { rate: number; incrementalVsCannibalized: number };
  target: PromotionCandidate['target'];
  risks: string[];
  prerequisites: string[];
  evidence: PromotionCandidate['evidence'];
  /** Which canonical signals/ML kinds/memory supported this pick. */
  provenance: {
    sourceSignals: string[];
    /**
     * Signal codes whose evidence is CORRELATED to this candidate's products /
     * categories (D-19). Only these count as product-specific evidence.
     */
    signalCodes: string[];
    /**
     * Signal codes present in the restaurant's data whose subject could NOT be
     * tied to this candidate's products/categories. These are dimension-level
     * THEMES that were consulted — never product-specific evidence (D-19).
     */
    signalThemes: string[];
    mlKinds: string[];
    memoryRefs: string[];
  };
  /** Human-readable, evidence-grounded reasons (never fabricated numbers). */
  why: string[];
}

export interface RankingInput {
  candidates: PromotionCandidate[];
  /** Optional canonical signals to correlate with candidates. */
  signals?: BusinessSignal[];
  /** Optional ML summary (causal flag respected, never upgraded). */
  ml?: MlSignalSummary;
  /** Optional memory-derived hints (validated long-term knowledge refs). */
  memoryHints?: Array<{ ref: string; statement: string; confidence: number; memoryType: string }>;
  /** Final shortlist size (default 8, clamped 1..12). */
  limit?: number;
  /** Max items per strategy in the shortlist (default 2). */
  maxPerStrategy?: number;
}

export interface RankingResult {
  recommendations: RankedRecommendation[];
  /** Strategies represented in the final shortlist. */
  strategies: string[];
  /** Candidates considered (post-dedup input size). */
  considered: number;
  /** True when the shortlist had to include repeats to reach a useful size. */
  diversityRelaxed: boolean;
  notes: string[];
  generatedAt: string;
}

/**
 * Economic safety from the candidate's OWN deterministic constraints:
 *   safe ⇔ discount within the max-discount constraint
 *        ∧ projected margin within the min-margin constraint
 *        ∧ break-even units are finite
 *        ∧ payback is finite (or not applicable)
 * This re-uses the engine's numbers verbatim; it never recomputes economics.
 *
 * D-14 — DEFENSE-IN-DEPTH, not the primary gate: `validateFinancialModel` in
 * the engine already drops economically invalid candidates before ranking, so
 * the "unsafe" branch here is normally unreachable. It is kept deliberately so
 * that a future/alternate candidate source (a tool, a fixture, a new builder)
 * still cannot rank a bad-money candidate above a safe one, and it is the only
 * path that also demotes `economicsUnavailable` placeholders. No code change
 * was required for D-14; the observation is documented here instead.
 */
export function isEconomicallySafe(c: PromotionCandidate): boolean {
  const f = c.financialModel;
  // A candidate with no authoritative economics is NEVER "safe".
  if (f.economicsUnavailable) return false;
  if (!Number.isFinite(f.projectedContributionMargin)) return false;
  if (!Number.isFinite(f.discountPercent) || f.discountPercent > f.maxDiscountConstraint) return false;
  if (f.projectedContributionMargin < f.minMarginConstraint) return false;
  if (!Number.isFinite(f.breakEvenIncrementalUnits)) return false;
  if (!Number.isFinite(f.paybackPeriodDays)) return false;
  return true;
}

/**
 * Deterministic rank score.
 *
 * Components (all bounded, documented):
 *   + engineScore                     (0–100) — the engine's financial+signal score, weight 1.0
 *   + confidence * 15                 (0–15)  — evidence confidence from the engine
 *   + economicSafetyBonus             (0/8)   — safe candidates rank above unsafe ones
 *   + incrementalContributionSign      (±6)   — positive projected contribution is preferred
 *   + mlAlignment                     (0–6)   — candidate type supported by available ML kind
 *   + memoryAlignment                 (0–4)   — validated long-term memory supports the type
 *   − cannibalizationPenalty          (0–6)   — high cannibalization rate is demoted
 *
 * The engine score dominates (max 100 vs ≤39 total adjustment), so ranking
 * never overrides the existing deterministic economics with narrative.
 */
/**
 * ML alignment for ONE candidate: the bonus AND the exact evidence kinds that
 * produced it. This is the single source of truth for both scoring and
 * provenance — a recommendation records only the ML it actually used, never
 * the whole pipeline's available set. `availableKinds` already excludes any
 * ungated `causal_uplift` (mlSemantics sets `available` only when the
 * randomization gate passed), so causal evidence cannot leak as a generic
 * label.
 */
export function mlAlignment(
  c: Pick<PromotionCandidate, 'type'>,
  availableKinds: Set<string>,
): { bonus: number; kinds: string[] } {
  const kinds: string[] = [];
  let bonus = 0;
  switch (c.type) {
    case 'CREATE_COMBO':
      if (availableKinds.has('basket')) { bonus += 6; kinds.push('basket'); }
      break;
    case 'RUN_REACTIVATION':
      if (availableKinds.has('response_model')) { bonus += 6; kinds.push('response_model'); }
      if (availableKinds.has('causal_uplift')) { bonus += 6; kinds.push('causal_uplift'); }
      break;
    case 'CREATE_PROMOTION':
    case 'PROMOTE_SLOW_ITEM':
      if (availableKinds.has('segment')) { bonus += 4; kinds.push('segment'); }
      break;
    case 'PROTECT_HIGH_DEMAND_STOCK':
      if (availableKinds.has('forecast')) { bonus += 6; kinds.push('forecast'); }
      break;
  }
  return { bonus, kinds };
}

export function rankScore(
  c: PromotionCandidate,
  ctx: { mlKinds: Set<string>; memoryTypes: Set<string> },
): number {
  let s = c.score;
  s += c.confidence * 15;
  if (isEconomicallySafe(c)) s += 8;
  if (c.financialModel.incrementalContribution > 0) s += 6;
  else if (c.financialModel.incrementalContribution < 0) s -= 6;
  s += mlAlignment(c, ctx.mlKinds).bonus;
  // Canonical mapping: memoryTypes are snake_case long-term types while c.type
  // is a UPPER_SNAKE PromotionType — comparing them directly was always false.
  if (memoryTypesFor(c).some((t) => ctx.memoryTypes.has(t))) s += 4;
  s -= Math.min(c.cannibalization.estimatedCannibalizationRate, 1) * 6;
  return Math.round(s * 1000) / 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking + diversity selection
// ─────────────────────────────────────────────────────────────────────────────

/** The products/categories a candidate actually targets (for correlation). */
function candidateSubjectKeys(c: PromotionCandidate): Set<string> {
  const keys = new Set<string>();
  for (const id of c.target.productIds ?? []) keys.add(String(id).toLowerCase());
  for (const name of c.target.productNames ?? []) keys.add(String(name).toLowerCase());
  for (const id of c.target.categoryIds ?? []) keys.add(String(id).toLowerCase());
  keys.delete('');
  return keys;
}

/**
 * TRUE only when the signal is about one of the candidate's own products or
 * categories — either via its typed `subject`, or via a product/category ref
 * embedded in its evidence (e.g. `metric:product:<id>:marginPct`).
 * A dimension-level signal (no subject) is NEVER product-correlated (D-19).
 */
function signalMatchesCandidate(s: BusinessSignal, keys: Set<string>): boolean {
  if (keys.size === 0) return false;
  const subject = s.subject;
  if (subject) {
    if (keys.has(subject.id.toLowerCase())) return true;
    if (subject.label && keys.has(subject.label.toLowerCase())) return true;
  }
  return s.evidence.some((e) => {
    if (typeof e.ref !== 'string') return false;
    const ref = e.ref.toLowerCase();
    for (const key of keys) if (ref.includes(key)) return true;
    return false;
  });
}

/**
 * Signal provenance for a candidate, split into product-correlated evidence
 * (`correlated`) and dimension-level themes that merely exist and were
 * consulted (`themes`). Never conflates the two (D-19).
 */
function signalCodesFor(
  c: PromotionCandidate,
  signals: BusinessSignal[],
): { correlated: string[]; themes: string[] } {
  const wanted: string[] = [];
  switch (c.type) {
    case 'CREATE_COMBO':
      wanted.push('basket_pair_strength', 'product_high_demand', 'sales_category_strong');
      break;
    case 'CREATE_ADDON':
      wanted.push('product_high_demand', 'sales_category_strong');
      break;
    case 'PROMOTE_SLOW_ITEM':
      wanted.push('product_slow_moving', 'product_declining', 'sales_category_weak');
      break;
    case 'RUN_REACTIVATION':
      wanted.push('customer_inactive_high', 'customer_segment_present');
      break;
    case 'REDUCE_WASTAGE':
      wanted.push('inventory_expiring', 'inventory_overstock');
      break;
    case 'PROTECT_HIGH_DEMAND_STOCK':
      wanted.push('inventory_stockout_risk', 'inventory_low', 'product_high_demand_forecast');
      break;
    case 'REVIEW_PRICE':
    case 'REVIEW_RECIPE_COST':
      wanted.push('product_low_margin', 'product_high_margin');
      break;
    default:
      wanted.push('sales_revenue_level', 'sales_aov_level');
  }
  const byCode = new Map<string, BusinessSignal[]>();
  for (const s of signals) {
    const list = byCode.get(s.code);
    if (list) list.push(s);
    else byCode.set(s.code, [s]);
  }
  const keys = candidateSubjectKeys(c);
  const correlated: string[] = [];
  const themes: string[] = [];
  for (const w of wanted) {
    const matches = byCode.get(w);
    if (!matches) continue;
    if (matches.some((s) => signalMatchesCandidate(s, keys))) correlated.push(w);
    else themes.push(w);
  }
  return { correlated, themes };
}

/**
 * Canonical PromotionType → relevant long-term memory types (snake_case).
 * Exported so the pipeline can apply the SAME relevance filter when it
 * attaches memory statements to a recommendation (no blanket attachment).
 */
export function memoryTypesForType(type: string): string[] {
  switch (type) {
    case 'CREATE_COMBO':
      return ['customer_behavior_pattern', 'audience_response_pattern'];
    case 'RUN_REACTIVATION':
      return ['audience_response_pattern', 'customer_behavior_pattern'];
    case 'REDUCE_WASTAGE':
      return ['campaign_performance_pattern'];
    case 'CREATE_PROMOTION':
      return ['promotion_fatigue_pattern', 'channel_preference_pattern', 'campaign_performance_pattern'];
    default:
      return ['campaign_performance_pattern'];
  }
}

/** Memory types relevant to a candidate (provenance + ranking gate). */
function memoryTypesFor(c: PromotionCandidate): string[] {
  return memoryTypesForType(c.type);
}

/**
 * Build the deterministic, strategy-diverse shortlist.
 * NEVER throws for empty/odd input — returns an empty shortlist with notes.
 */
export function rankAndDiversify(input: RankingInput): RankingResult {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 12));
  const maxPerStrategy = Math.max(1, input.maxPerStrategy ?? 2);
  const signals = input.signals ?? [];
  const notes: string[] = [];

  if (!input.candidates.length) {
    return { recommendations: [], strategies: [], considered: 0, diversityRelaxed: false, notes: ['No candidates were produced by the engine.'], generatedAt: new Date().toISOString() };
  }

  const mlKinds = new Set((input.ml ?? { availableKinds: [] as string[] }).availableKinds as string[]);
  const memoryTypes = new Set((input.memoryHints ?? []).map((m) => m.memoryType));

  // 1. Score every candidate (deterministic).
  const scored = input.candidates.map((c) => ({
    c,
    score: rankScore(c, { mlKinds, memoryTypes }),
    safe: isEconomicallySafe(c),
  }));

  // 2. Stable sort: score desc, then safe first, then engine score, then id.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.safe !== b.safe) return a.safe ? -1 : 1;
    if (b.c.score !== a.c.score) return b.c.score - a.c.score;
    return a.c.id.localeCompare(b.c.id);
  });

  // 3. Group by strategy, preserving the sorted order inside each group.
  const byStrategy = new Map<string, typeof scored>();
  for (const item of scored) {
    const key = strategyOf(item.c);
    const arr = byStrategy.get(key) ?? [];
    arr.push(item);
    byStrategy.set(key, arr);
  }

  // 4. Round-robin across strategies (best-first within each) for diversity.
  const strategyKeys = [...byStrategy.keys()].sort((a, b) => {
    // Strategy order follows the best item's rank so the strongest lead goes first.
    const bestA = byStrategy.get(a)![0].score;
    const bestB = byStrategy.get(b)![0].score;
    if (bestB !== bestA) return bestB - bestA;
    return a.localeCompare(b);
  });

  const picked: Array<(typeof scored)[number] & { rank: number }> = [];
  const perStrategyCount = new Map<string, number>();
  const cursors = new Map<string, number>();

  let diversityRelaxed = false;
  let progress = true;
  while (picked.length < limit && progress) {
    progress = false;
    for (const key of strategyKeys) {
      if (picked.length >= limit) break;
      const arr = byStrategy.get(key)!;
      const used = perStrategyCount.get(key) ?? 0;
      if (used >= maxPerStrategy) continue;
      let cursor = cursors.get(key) ?? 0;
      // Skip items already picked (can happen if a strategy repeats ids).
      while (cursor < arr.length && picked.some((p) => p.c.id === arr[cursor].c.id)) cursor += 1;
      if (cursor >= arr.length) continue;
      const item = arr[cursor];
      cursors.set(key, cursor + 1);
      perStrategyCount.set(key, used + 1);
      picked.push({ ...item, rank: picked.length + 1 });
      progress = true;
    }
  }

  // 5. If the per-strategy caps left the shortlist short, relax them — but
  // keep the round-robin order so one strategy still cannot dominate: each
  // relax pass hands one extra slot to every strategy in turn.
  if (picked.length < Math.min(limit, input.candidates.length)) {
    const pickedIds = new Set(picked.map((p) => p.c.id));
    let relaxProgress = true;
    while (picked.length < Math.min(limit, input.candidates.length) && relaxProgress) {
      relaxProgress = false;
      for (const key of strategyKeys) {
        if (picked.length >= Math.min(limit, input.candidates.length)) break;
        const arr = byStrategy.get(key)!;
        let cursor = cursors.get(key) ?? 0;
        while (cursor < arr.length && pickedIds.has(arr[cursor].c.id)) cursor += 1;
        if (cursor >= arr.length) continue;
        const item = arr[cursor];
        cursors.set(key, cursor + 1);
        pickedIds.add(item.c.id);
        picked.push({ ...item, rank: picked.length + 1 });
        relaxProgress = true;
      }
    }
    diversityRelaxed = true;
    notes.push('Strategy caps were relaxed to fill the shortlist because too few distinct strategies had candidates.');
  }

  const recommendations: RankedRecommendation[] = picked.map((item) => {
    const c = item.c;
    const relevantMemory = (input.memoryHints ?? []).filter((m) => memoryTypesFor(c).includes(m.memoryType));
    const why: string[] = [];
    why.push(`Scored ${c.score}/100 by the existing candidate engine (confidence ${(c.confidence * 100).toFixed(0)}%).`);
    if (c.financialModel.economicsUnavailable) {
      why.push('No verified economics are available for this candidate yet — treat it as an opportunity, not a validated money-making action.');
    } else if (item.safe) {
      why.push(
        `Passes its own economics: ${c.financialModel.discountPercent}% discount within the ${c.financialModel.maxDiscountConstraint}% limit and a projected ${c.financialModel.projectedContributionMargin}% margin above the ${c.financialModel.minMarginConstraint}% floor.`,
      );
    } else {
      why.push('Its deterministic economics do NOT satisfy the configured margin/discount constraints — shown for transparency, not as a safe action.');
    }
    if (c.cannibalization.estimatedCannibalizationRate > 0.4) {
      why.push(`High estimated cannibalization (${(c.cannibalization.estimatedCannibalizationRate * 100).toFixed(0)}%).`);
    }
    const { correlated: correlatedCodes, themes: signalThemes } = signalCodesFor(c, signals);
    if (correlatedCodes.length) {
      why.push(`Supported by product-correlated business signals: ${correlatedCodes.join(', ')}.`);
    }
    if (signalThemes.length) {
      why.push(`Signal themes present in your data (not specific to these products): ${signalThemes.join(', ')}.`);
    }
    if (relevantMemory.length) {
      why.push(`Consistent with validated past learning: ${relevantMemory.map((m) => m.statement).join(' ')}`);
    }
    if (c.risks.length) why.push(`Risks: ${c.risks.join('; ')}.`);

    return {
      rank: item.rank,
      id: c.id,
      type: c.type,
      strategy: strategyOf(c),
      strategyLabel: strategyLabel(strategyOf(c)),
      title: c.title,
      description: c.description,
      recommendedAction: c.recommendedAction,
      engineScore: c.score,
      rankScore: item.score,
      confidence: c.confidence,
      priority: c.priority,
      economics: {
        discountPercent: c.financialModel.discountPercent,
        projectedContributionMargin: c.financialModel.projectedContributionMargin,
        incrementalRevenue: c.financialModel.incrementalRevenue,
        incrementalUnits: c.financialModel.incrementalUnits,
        breakEvenIncrementalUnits: Number.isFinite(c.financialModel.breakEvenIncrementalUnits) ? c.financialModel.breakEvenIncrementalUnits : -1,
        paybackPeriodDays: Number.isFinite(c.financialModel.paybackPeriodDays) ? c.financialModel.paybackPeriodDays : -1,
        economicallySafe: item.safe,
        available: !c.financialModel.economicsUnavailable,
      },
      cannibalization: {
        rate: c.cannibalization.estimatedCannibalizationRate,
        incrementalVsCannibalized: c.cannibalization.incrementalVsCannibalized,
      },
      target: c.target,
      risks: c.risks,
      prerequisites: c.prerequisites,
      evidence: c.evidence,
      provenance: {
        sourceSignals: c.sourceSignals,
        signalCodes: correlatedCodes,
        signalThemes,
        // Per-recommendation ML provenance: only the kinds that actually
        // influenced THIS candidate's rank (never the whole pipeline set).
        mlKinds: mlAlignment(c, mlKinds).kinds,
        memoryRefs: relevantMemory.map((m) => m.ref),
      },
      why,
    };
  });

  const unavailableEconomics = recommendations.filter((r) => !r.economics.available).length;
  if (unavailableEconomics > 0) {
    notes.push(`${unavailableEconomics} recommendation(s) have no verified economics — shown as opportunities, never as validated profit.`);
  }

  const strategies = [...new Set(recommendations.map((r) => r.strategy))];
  if (recommendations.length > 1 && strategies.length === 1) {
    notes.push(`Only one strategy (${strategyLabel(strategies[0])}) had candidates — diversity was not possible.`);
  }

  return {
    recommendations,
    strategies,
    considered: input.candidates.length,
    diversityRelaxed,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

/** Compact lines for prompts/UI: strategy + title + why. */
export function rankedRecommendationLines(result: RankingResult, limit = 10): string[] {
  return result.recommendations.slice(0, limit).map(
    (r) => `#${r.rank} [${r.strategyLabel}] ${r.title} — score ${r.engineScore}/100, confidence ${(r.confidence * 100).toFixed(0)}%${r.economics.economicallySafe ? '' : ' (constraint warning)'}`,
  );
}
