/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * situationModel.ts — turn accumulated domain findings into the structured
 * Situation Model (task §9).
 *
 * Rules encoded here:
 *   - Every fact references evidence; a fact with no evidence ref is dropped.
 *   - Only IMPLEMENTED domains that returned evidence contribute facts.
 *   - A domain that returned nothing is listed as unavailable / missing
 *     evidence — never silently omitted.
 *   - Contradictions between domains are SURFACED, not resolved.
 *   - Nothing here is hidden reasoning: the model holds claims + evidence.
 */

import type { BusinessSignal } from '../intelligence/businessSignalTypes';
import { isUsableFreshness } from '../intelligence/businessSignalTypes';
import type {
  CandidateDirection,
  DomainInvestigation,
  IntelligenceDomain,
  SituationFact,
  SituationModel,
} from './contracts';

/** Canonical codes that represent something the owner can ACT on. */
const OPPORTUNITY_CODES = new Set([
  'product_slow_moving',
  'product_low_margin',
  'product_high_margin',
  'product_declining',
  'product_growing',
  'product_high_demand',
  'product_high_demand_forecast',
  'customer_inactive_high',
  'customer_high_value_present',
  'customer_segment_present',
  'offer_underperforming',
  'campaign_underperforming',
  'campaign_effective',
  'inventory_overstock',
  'inventory_expiring',
  'sales_weekday_trough',
  'sales_hour_trough',
  'sales_category_weak',
  'sales_category_strong',
  'basket_pair_strength',
  'festival_upcoming',
  'sports_event_relevant',
  'weather_shift',
  'competition_density',
]);

/** Canonical codes that represent an EXPOSURE. */
const RISK_CODES = new Set(['inventory_low', 'inventory_stockout_risk', 'inventory_expiring', 'inventory_overstock']);

/** Direction templates — deterministic mapping from a signal code. */
const DIRECTION_TEMPLATES: Record<string, { direction: string; objective: string; mechanism: string }> = {
  product_slow_moving: {
    direction: 'activate_slow_item',
    objective: 'Increase movement of a slow-selling item',
    mechanism: 'pair or bundle it with a stronger seller instead of discounting it in isolation',
  },
  product_low_margin: {
    direction: 'protect_margin',
    objective: 'Protect contribution on a high-demand low-margin item',
    mechanism: 'review the price/recipe or shift mix with a bundle, rather than deepen the discount',
  },
  product_high_margin: {
    direction: 'amplify_high_margin',
    objective: 'Shift demand toward a high-contribution item',
    mechanism: 'feature/pair the item; no discount needed where demand already exists',
  },
  product_high_demand: {
    direction: 'meet_demand',
    objective: 'Capture an existing demand opportunity',
    mechanism: 'feature the item and protect its stock rather than discounting it',
  },
  product_high_demand_forecast: {
    direction: 'meet_demand',
    objective: 'Capture forecast demand',
    mechanism: 'prepare stock and feature the item; do not discount items already in demand',
  },
  customer_inactive_high: {
    direction: 'win_back',
    objective: 'Reactivate guests who have stopped returning',
    mechanism: 'a targeted win-back campaign for that group only',
  },
  customer_high_value_present: {
    direction: 'retain_high_value',
    objective: 'Retain high-value guests',
    mechanism: 'recognition or reward for that group; avoid blanket discounting',
  },
  offer_underperforming: {
    direction: 'replace_underperforming_offer',
    objective: 'Replace an underperforming promotion',
    mechanism: 'a different offer structure for the same target',
  },
  campaign_underperforming: {
    direction: 'replace_underperforming_campaign',
    objective: 'Replace an underperforming campaign',
    mechanism: 'a different campaign structure for the same target',
  },
  inventory_overstock: {
    direction: 'move_overstock',
    objective: 'Reduce overstock exposure',
    mechanism: 'an inventory-aware offer on the affected items',
  },
  inventory_expiring: {
    direction: 'reduce_wastage',
    objective: 'Reduce expiry waste',
    mechanism: 'a time-boxed offer on the expiring items',
  },
  inventory_stockout_risk: {
    direction: 'protect_stock',
    objective: 'Avoid promoting an item at stockout risk',
    mechanism: 'treat it as a CONSTRAINT on any offer that targets it, not as an offer',
  },
  sales_weekday_trough: {
    direction: 'fill_weak_slots',
    objective: 'Fill the weakest trading slot',
    mechanism: 'a time-targeted offer limited to that day',
  },
  sales_hour_trough: {
    direction: 'fill_weak_slots',
    objective: 'Fill the weakest trading hours',
    mechanism: 'a time-targeted offer limited to those hours',
  },
  sales_category_weak: {
    direction: 'lift_weak_category',
    objective: 'Lift the weakest category',
    mechanism: 'pair it with a strong category rather than discounting the strong one',
  },
  basket_pair_strength: {
    direction: 'build_combo',
    objective: 'Convert a strong existing pairing into a combo',
    mechanism: 'a combo offer on the paired items',
  },
  festival_upcoming: {
    direction: 'align_with_festival',
    objective: 'Align the offer with the upcoming festival demand',
    mechanism: 'time the offer to the festival window',
  },
  sports_event_relevant: {
    direction: 'align_with_event',
    objective: 'Align the offer with the relevant fixture',
    mechanism: 'time the offer to the fixture',
  },
  weather_shift: {
    direction: 'align_with_weather',
    objective: 'Align the offer with the weather shift',
    mechanism: 'favour the items the shift favours',
  },
};

function actionableCodes(s: { code: string }): boolean {
  return OPPORTUNITY_CODES.has(s.code) || RISK_CODES.has(s.code);
}

function directionFor(s: BusinessSignal): CandidateDirection | null {
  const template = DIRECTION_TEMPLATES[s.code];
  if (!template) return null;
  const subject = s.subject;
  return {
    direction: template.direction,
    domain: 'sales',
    objective: template.objective,
    mechanism: template.mechanism,
    target: {
      productIds: subject?.type === 'product' ? [subject.id] : [],
      productNames: subject?.type === 'product' && subject.label ? [subject.label] : [],
      categoryIds: subject?.type === 'category' ? [subject.id] : [],
      segmentIds: subject?.type === 'segment' ? [subject.id] : [],
    },
    evidenceRefs: [`signal:${s.signalId}`],
  };
}

/** Codes whose direction is "moving up" vs "moving down", for contradiction checks. */
const UP_CODES = new Set(['product_growing', 'product_high_demand', 'sales_category_strong', 'campaign_effective']);
const DOWN_CODES = new Set(['product_declining', 'product_slow_moving', 'sales_category_weak', 'offer_underperforming']);

/**
 * Build the Situation Model from the domain investigations.
 * Pure + deterministic: same investigations → same model.
 */
export function buildSituationModel(input: {
  objective: string;
  investigations: DomainInvestigation[];
  scanSignals?: BusinessSignal[];
  memoryDegraded?: boolean;
  extraUncertainties?: string[];
}): SituationModel {
  const investigations = input.investigations;
  const implemented = investigations.filter((i) => i.implemented);
  const usable = implemented.filter((i) => i.status !== 'unavailable');

  const allSignals: BusinessSignal[] = [
    ...investigations.flatMap((i) => i.signals),
    ...(input.scanSignals ?? []),
  ];
  // De-duplicate signals by id (a domain may re-derive one already scanned).
  const signalById = new Map<string, BusinessSignal>();
  for (const s of allSignals) if (!signalById.has(s.signalId)) signalById.set(s.signalId, s);
  const signals = [...signalById.values()];

  const confirmedFacts: SituationFact[] = [];
  const opportunities: SituationFact[] = [];
  const risks: SituationFact[] = [];

  for (const investigation of investigations) {
    for (const f of investigation.findings) {
      const refs = f.evidenceRefs.filter(Boolean);
      if (!refs.length) continue; // a fact without evidence is not a fact
      const fact: SituationFact = {
        statement: f.statement,
        domain: investigation.domain,
        confidence: f.confidence,
        evidenceRefs: refs,
      };
      if (RISK_CODES.has(f.code)) risks.push(fact);
      else if (actionableCodes(f)) opportunities.push(fact);
      else confirmedFacts.push(fact);
    }
  }

  // ── Contradictions: same subject trending up AND down across domains ─────
  const bySubject = new Map<string, { up: string[]; down: string[] }>();
  for (const s of signals) {
    if (!s.subject) continue;
    const key = `${s.subject.type}:${s.subject.id}`;
    const entry = bySubject.get(key) ?? { up: [], down: [] };
    if (UP_CODES.has(s.code)) entry.up.push(s.code);
    else if (DOWN_CODES.has(s.code)) entry.down.push(s.code);
    bySubject.set(key, entry);
  }
  const contradictions: string[] = [];
  for (const [key, entry] of bySubject) {
    if (entry.up.length && entry.down.length) {
      contradictions.push(
        `${key} appears as both rising (${[...new Set(entry.up)].join(', ')}) and falling (${[...new Set(entry.down)].join(', ')}) — the two readings disagree and were not resolved automatically.`,
      );
    }
  }

  const unavailableDomains = investigations
    .filter((i) => i.implemented && i.status === 'unavailable')
    .map((i) => i.domain);

  const declaredOnly = investigations.filter((i) => !i.implemented).map((i) => i.domain as IntelligenceDomain);

  const uncertainties: string[] = [
    ...(input.extraUncertainties ?? []),
    ...investigations
      .filter((i) => i.status === 'partial' || (i.implemented && i.status === 'unavailable'))
      .map((i) => `${i.domain}: ${i.degradedReason ?? i.reasonCode ?? 'no usable evidence'}`),
  ];
  if (input.memoryDegraded) uncertainties.push('historical memory could not be loaded for this run');

  const missingEvidence: string[] = [
    ...unavailableDomains.map((d) => `${d}: no usable evidence in the analysed window`),
    ...declaredOnly.map((d) => `${d}: capability declared but not implemented`),
  ];

  // ── Directions: bounded, de-duplicated, evidence-backed ──────────────────
  const directions: CandidateDirection[] = [];
  const seenDirections = new Set<string>();
  for (const s of signals) {
    if (!actionableCodes(s)) continue;
    const direction = directionFor(s);
    if (!direction) continue;
    const key = `${direction.direction}:${direction.target.productIds[0] ?? direction.target.categoryIds[0] ?? direction.target.segmentIds[0] ?? 'any'}`;
    if (seenDirections.has(key)) continue;
    seenDirections.add(key);
    direction.domain = investigationDomainOf(investigations, s);
    directions.push(direction);
    if (directions.length >= 12) break;
  }

  // ── Confidence: coverage-weighted, degraded by contradictions ────────────
  const implementedCount = implemented.length || 1;
  const coverage = usable.length / implementedCount;
  const freshRatio = signals.length
    ? signals.filter((s) => isUsableFreshness(s.freshness)).length / signals.length
    : 0;
  const contradictionPenalty = Math.min(0.2, contradictions.length * 0.05);
  const declaredPenalty = Math.min(0.15, declaredOnly.length * 0.05);
  const confidence = Math.max(
    0,
    Math.min(1, 0.5 * coverage + 0.5 * freshRatio - contradictionPenalty - declaredPenalty),
  );

  const topSignals = [...signals]
    .filter((s) => isUsableFreshness(s.freshness))
    .sort((a, b) => b.confidence - a.confidence || a.signalId.localeCompare(b.signalId))
    .slice(0, 20);

  return {
    objective: input.objective,
    investigatedDomains: investigations.map((i) => ({
      domain: i.domain,
      status: i.status,
      findingCount: i.findings.length,
      signalCount: i.signals.length,
      reasonCode: i.reasonCode,
      degradedReason: i.degradedReason,
      implemented: i.implemented,
    })),
    unavailableDomains: [...new Set(unavailableDomains)],
    confirmedFacts: confirmedFacts.slice(0, 24),
    opportunities: opportunities.slice(0, 24),
    risks: risks.slice(0, 12),
    contradictions,
    uncertainties: [...new Set(uncertainties)].slice(0, 20),
    missingEvidence,
    topSignals,
    candidateDirections: directions,
    confidence: Number(confidence.toFixed(3)),
    generatedAt: new Date().toISOString(),
  };
}

/** Which domain produced a given signal (first match wins). */
function investigationDomainOf(investigations: DomainInvestigation[], signal: BusinessSignal): IntelligenceDomain {
  for (const i of investigations) {
    if (i.signals.some((s) => s.signalId === signal.signalId)) return i.domain;
  }
  return 'sales';
}

/** Owner-readable lines for the situation (no ids, no internals). */
export function situationLines(model: SituationModel, limit = 10): string[] {
  const lines: string[] = [];
  for (const s of model.opportunities.slice(0, limit)) lines.push(`Opportunity: ${s.statement}`);
  for (const r of model.risks.slice(0, Math.max(0, limit - lines.length))) lines.push(`Risk: ${r.statement}`);
  return lines;
}
