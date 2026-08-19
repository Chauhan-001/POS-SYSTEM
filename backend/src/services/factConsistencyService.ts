/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * factConsistencyService.ts — Deterministic LLM fact-consistency validation (Phase 7).
 *
 * Compares AI-generated text against the deterministic fact bundle that was
 * SUPPLIED to the AI. It is NOT another LLM call and it never computes
 * financial truth — it only checks that the AI did not contradict the facts
 * it was given.
 *
 * Severity model (Phase 7.7):
 *   VALID    — claims agree with (or are a harmless rounding of) the facts.
 *   WARNING  — ambiguous qualitative statement that cannot be conclusively
 *              verified against the bundle.
 *   INVALID  — direct contradiction of a deterministic fact, or a claim that
 *              requires comparison/inventory/entity data the bundle does not
 *              contain.
 *
 * Normalization rules (Phase 7.3): currency symbols (₹, Rs, INR), thousand
 * separators and spaces are stripped; "lakh" (×100 000), "crore" (×10 000 000)
 * and "k"/"thousand" (×1000) suffixes are expanded. A claim within ±1% (or ±1
 * unit for values < 100) of a fact is treated as the same value. A number that
 * is 2%–100% off a fact of the same order of magnitude is treated as a
 * contradiction; anything further away is not attributable to that fact.
 */

// ─── Types ────────────────────────────────────────────────────────────

export type FactSeverity = 'WARNING' | 'INVALID';
export type FactStatus = 'VALID' | 'WARNING' | 'INVALID';

export interface FactViolation {
  /** Stable machine-readable code. */
  code: string;
  severity: FactSeverity;
  /** The AI claim that triggered the violation. */
  claim: string;
  /** The deterministic fact it contradicts (when known). */
  fact?: string;
  message: string;
}

export interface FactBundle {
  /** Numeric facts — name → value (e.g. revenue: 125000). Only facts the
   *  deterministic layer actually has. */
  amounts?: Record<string, number>;
  /** Previous-period values. ONLY present when the deterministic layer truly
   *  has them — without this, any % change claim is unsupported. */
  previousPeriod?: { revenue?: number; orders?: number; aov?: number };
  /** Lowercased known entity names. */
  products?: string[];
  categories?: string[];
  segments?: string[];
  offers?: string[];
  branches?: string[];
  /** Deterministic surplus inventory (names). Empty array = nothing is surplus. */
  surplusStockItems?: string[];
  /** Deterministic low-stock inventory (names). */
  lowStockItems?: string[];
  /** Deterministic wastage items (names). Empty array = no wastage data. */
  wastageItems?: string[];
  /** Products with deteriorating deterministic margins (names). */
  deterioratingItems?: string[];
}

export interface FactValidationResult {
  status: FactStatus;
  violations: FactViolation[];
}

// ─── Normalization ────────────────────────────────────────────────────

const CURRENCY_RE = /(?:₹|Rs\.?|INR)\s?\d[\d,.]*(?:\s?(?:lakh|crore|thousand|k))?/gi;

export function normalizeNumber(raw: string): number | null {
  // Strip currency prefix/symbol, thousand separators and spaces — but keep
  // the decimal point (so "1.25" survives "Rs. 1.25 lakh").
  let s = String(raw)
    .replace(/INR/gi, '')
    .replace(/[₹]/g, '')
    .replace(/\bRs\.?/gi, '')
    .replace(/[,\s]/g, '');
  if (!s || !/^\d/.test(s)) return null;
  let multiplier = 1;
  if (/lakh/i.test(raw)) multiplier = 100_000;
  else if (/crore/i.test(raw)) multiplier = 10_000_000;
  else if (/\bk\b|thousand/i.test(raw)) multiplier = 1000;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n * multiplier;
}

/** Extract currency-denominated amount claims from AI text. */
export function extractAmountClaims(text: string): Array<{ claim: string; value: number }> {
  const out: Array<{ claim: string; value: number }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CURRENCY_RE)) {
    const claim = m[0];
    const value = normalizeNumber(claim);
    if (value !== null && !seen.has(claim.toLowerCase())) {
      seen.add(claim.toLowerCase());
      out.push({ claim, value });
    }
  }
  return out;
}

const INCR_VERBS = 'increased|rose|grew|jumped|climbed|surged';
const DECR_VERBS = 'decreased|dropped|fell|declined|plunged|dipped';
const CHANGE_RE = new RegExp(
  `(?:${INCR_VERBS})\\s+by\\s+(\\d+(?:\\.\\d+)?)\\s*%|` +
  `(?:${INCR_VERBS})\\s+(\\d+(?:\\.\\d+)?)\\s*%|` +
  `(\\d+(?:\\.\\d+)?)\\s*%\\s+(?:increase|growth|jump|rise|surge)|` +
  `(?:${DECR_VERBS})\\s+by\\s+(\\d+(?:\\.\\d+)?)\\s*%|` +
  `(?:${DECR_VERBS})\\s+(\\d+(?:\\.\\d+)?)\\s*%|` +
  `(\\d+(?:\\.\\d+)?)\\s*%\\s+(?:decrease|drop|fall|decline)`,
  'gi');

/** Extract percentage-change claims ("revenue increased 18%", "dropped 20%"). */
export function extractPercentChangeClaims(text: string): Array<{ claim: string; pct: number; metric?: string }> {
  const out: Array<{ claim: string; pct: number; metric?: string }> = [];
  const metricHint = (before: string): string | undefined => {
    const m = before.match(/(revenue|sales|orders?|aov|traffic|customers?)\b/i);
    return m ? m[1].toLowerCase() : undefined;
  };
  for (const m of text.matchAll(CHANGE_RE)) {
    const pct = Number.parseFloat(m[1] || m[2] || m[3] || m[4] || m[5] || m[6]);
    if (!Number.isFinite(pct)) continue;
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 60), idx);
    out.push({ claim: m[0], pct, metric: metricHint(before) });
  }
  return out;
}

const QUAL_TREND_RE = /\b(revenue|sales|orders?)\b.{0,40}\b(increased|decreased|dropped|rose|fell|grew|growing|falling|rising|strong|weak|slowing|booming|declined)\b/gi;

/** Qualitative trend statements WITHOUT a number ("revenue is growing"). */
export function extractQualitativeTrends(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUAL_TREND_RE)) out.push(m[0]);
  return out;
}

// Case-sensitive on purpose: entity names are proper nouns, so only
// Capitalized word runs are captured — a lowercase interior word terminates
// the entity (this is what stops prose like "revenue is growing" from being
// read as an entity claim).
const ENTITY_NAME = '[A-Z][a-zA-Z0-9&\']+(?: [A-Z][a-zA-Z0-9&\']+){0,3}';
const ENTITY_VERB_FIRST_RE = new RegExp(`(?:sales of|sales for|demand for|orders of|popularity of|performance of|underperform|top-selling|best-selling|slow-moving|weak|strong)\\s+(?:the\\s+)?(${ENTITY_NAME})`, 'g');
const ENTITY_SALES_TREND_RE = new RegExp(`(${ENTITY_NAME})\\s+sales\\s+(?:are|is|have been)?\\s*(?:falling|declining|rising|growing|dropping|slowing|weak|strong)\\b`, 'g');
const ENTITY_IS_ADJ_RE = new RegExp(`(${ENTITY_NAME})\\s+(?:is|are)\\s+(?:a|an|the)?\\s*(?:top-selling|best-selling|strong|weak|underperforming|slow-moving)\\s+\\w+`, 'g');

/** Extract entity names from claim-like contexts. */
export function extractClaimedEntities(text: string): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    const n = name.trim();
    if (n.length >= 2 && !out.includes(n)) out.push(n);
  };
  for (const m of text.matchAll(ENTITY_VERB_FIRST_RE)) add(m[1]);
  for (const m of text.matchAll(ENTITY_SALES_TREND_RE)) add(m[1]);
  for (const m of text.matchAll(ENTITY_IS_ADJ_RE)) add(m[1]);
  return out;
}

const OVERSTOCK_RE = /(overstocked|excess stock|surplus stock|excess inventory|too much stock|overstock)\b/gi;
const LOWSTOCK_RE = /(running low|low stock|low on|out of stock|stockout|stock out|running out)\b/gi;
const WASTAGE_RE = /(wastage|wasted|thrown away|discarded|expiring|expiry waste|usage variance)\b/gi;
const SEG_HINT_RE = /\b(VIP|dormant|new customers?|high-?value|high-?frequency|loyal|at-?risk|regular)\b/gi;
const SEG_AUDIENCE_RE = /([A-Z][A-Za-z ]{1,30})\s+(members|customers|audience|segment)\b/g;

function knownEntity(name: string, lists: Array<string[] | undefined>): boolean {
  const n = name.toLowerCase().trim();
  return lists.some((list) => (list || []).some((e) => String(e).toLowerCase().trim() === n));
}

/** Best-effort entity phrase around an inventory-claim keyword. */
function entityNear(text: string, idx: number): string | undefined {
  const slice = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + 40));
  const m = slice.match(new RegExp(`\\b(${ENTITY_NAME})\\b`));
  return m ? m[1].trim() : undefined;
}

// ─── Core validation ──────────────────────────────────────────────────

export function validateFactConsistency(aiOutput: unknown, factBundle: FactBundle): FactValidationResult {
  const violations: FactViolation[] = [];
  const push = (v: FactViolation) => violations.push(v);

  if (typeof aiOutput !== 'string' || aiOutput.trim().length === 0) {
    return {
      status: 'INVALID',
      violations: [{
        code: 'malformed_output',
        severity: 'INVALID',
        claim: String(aiOutput),
        message: 'AI output is empty or malformed — cannot be presented as fact.',
      }],
    };
  }
  const text = aiOutput;
  const hasAnyFacts =
    (factBundle.amounts && Object.keys(factBundle.amounts).length > 0) ||
    (factBundle.products?.length) || (factBundle.categories?.length) ||
    (factBundle.segments?.length) || (factBundle.surplusStockItems?.length) ||
    (factBundle.lowStockItems?.length) || !!factBundle.previousPeriod;

  // 7.3 — numeric claims vs deterministic amounts.
  // Key-aware matching: an amount claim about a specific metric (AOV, orders,
  // …) is first checked against THAT metric's fact, so restating a supplied
  // figure (e.g. the AOV the prompt explicitly gave) validates instead of
  // being misread as a wrong revenue citation. A value that is 2%–100% off a
  // same-order-of-magnitude fact still looks like a wrong citation and is
  // rejected; anything further away is not attributable and passes (e.g. an
  // explicit forward-looking projection like "₹80,000 by end of day").
  const amountEntries = Object.entries(factBundle.amounts || {}).filter(([, v]) => Number.isFinite(v));
  // Forward-looking projections ("projected ₹80,000 by end of day", "expected
  // ₹70k–₹80k by close") are predictions, not citations of a supplied fact —
  // they must not be rejected as wrong citations of today's actuals.
  const FORWARD_RE = /(project(?:ed|ion)?|expected|forecast|by (?:end of day|eod|close|tonight|tomorrow)|could|may|might|likely|pace|will|at this (?:rate|pace))/gi;
  // If the overall text is explicitly forward-looking (a projection sentence),
  // its rupee figures are predictions, not citations — skip numeric mismatch
  // checks for the whole text so a range like "₹70k–₹80k by close" validates.
  const isProjectionText = FORWARD_RE.test(text);
  for (const { claim, value } of extractAmountClaims(text)) {
    if (amountEntries.length === 0) continue; // nothing to contradict
    if (isProjectionText) continue;
    let matched = false;
    // 1) Same-key match — a bare figure that (near-)exactly equals a
    //    non-revenue supplied fact (AOV, orders, …) is a citation of THAT
    //    metric, not a wrong revenue citation: e.g. "₹2,309.58" restating the
    //    AOV the prompt supplied must validate.
    for (const [key, fv] of amountEntries) {
      if (fv <= 0 || key === 'revenue') continue;
      const ratio = Math.abs(value - fv) / fv;
      const tolerance = fv < 100 ? 1 / fv : 0.01;
      if (ratio <= tolerance) { matched = true; break; }
    }
    if (matched) continue;
    // 2) General match against any supplied fact (revenue citations first).
    let contradicted: number | undefined;
    for (const [key, fv] of amountEntries) {
      if (fv <= 0) continue;
      const ratio = Math.abs(value - fv) / fv;
      const tolerance = fv < 100 ? 1 / fv : 0.01;
      if (ratio <= tolerance) { matched = true; break; }
      // 2%–100% off the same order of magnitude → looks like a wrong citation.
      if (ratio > 0.02 && ratio <= 1 && contradicted === undefined) contradicted = fv;
    }
    if (!matched && contradicted !== undefined) {
      push({
        code: 'numeric_mismatch',
        severity: 'INVALID',
        claim,
        fact: `₹${Math.round(contradicted)}`,
        message: `AI claims ${claim} but the deterministic figure is ₹${Math.round(contradicted)} — the AI contradicts supplied data.`,
      });
    }
  }

  // 7.4 — percentage-change claims require previous-period facts.
  for (const { claim, pct, metric } of extractPercentChangeClaims(text)) {
    const key = (metric === 'sales' || metric === 'aov' || metric === 'traffic' || metric === 'customers')
      ? (metric === 'sales' ? 'revenue' : metric)
      : metric;
    const prev = factBundle.previousPeriod;
    const hasPrev = prev && (key === 'revenue' ? prev.revenue !== undefined : key === 'orders' ? prev.orders !== undefined : key === 'aov' ? prev.aov !== undefined : false);
    if (!prev || !hasPrev) {
      push({
        code: 'unsupported_comparison',
        severity: 'INVALID',
        claim,
        message: `AI claims "${claim}" but no previous-period data was supplied — the comparison cannot be supported.`,
      });
      continue;
    }
    const base = key === 'revenue' ? prev.revenue! : key === 'orders' ? prev.orders! : prev.aov!;
    const current = factBundle.amounts && (
      key === 'revenue' ? factBundle.amounts.revenue : key === 'orders' ? factBundle.amounts.orders : factBundle.amounts.aov
    );
    if (current === undefined || base <= 0) {
      push({
        code: 'unsupported_comparison',
        severity: 'WARNING',
        claim,
        message: 'Previous-period data exists but the current value is unavailable — cannot verify.',
      });
      continue;
    }
    const actual = ((current - base) / base) * 100;
    if (Math.abs(actual - pct) > Math.max(2, Math.abs(pct) * 0.15)) {
      push({
        code: 'numeric_mismatch',
        severity: 'INVALID',
        claim,
        fact: `${Math.round(actual)}%`,
        message: `AI claims a ${pct}% change but the deterministic data shows ${Math.round(actual)}%.`,
      });
    }
  }

  // 7.4 — qualitative trends WITHOUT a number are ambiguous. Skipped when a
  // numeric % change was already verified above (the number is authoritative).
  if (extractPercentChangeClaims(text).length === 0) {
    for (const claim of extractQualitativeTrends(text)) {
      push({
        code: 'ambiguous_qualitative',
        severity: 'WARNING',
        claim,
        message: `Qualitative claim "${claim}" cannot be conclusively verified against the supplied facts.`,
      });
    }
  }

  // 7.5 — entities: a claim about an entity not present in the bundle.
  const entityLists: Array<string[] | undefined> = [
    factBundle.products, factBundle.categories, factBundle.segments,
    factBundle.offers, factBundle.branches,
    factBundle.wastageItems, factBundle.deterioratingItems,
  ];
  for (const entity of extractClaimedEntities(text)) {
    if (!knownEntity(entity, entityLists)) {
      push({
        code: 'unknown_entity',
        severity: 'INVALID',
        claim: entity,
        message: `AI makes a claim about "${entity}" but it is not a known entity in the supplied context.`,
      });
    }
  }

  // 7.6 — inventory claims: overstock requires deterministic surplus; low stock
  // requires deterministic low-stock; an item can never be both (low wins).
  const surplusNames = (factBundle.surplusStockItems || []).map((n) => n.toLowerCase());
  const lowNames = (factBundle.lowStockItems || []).map((n) => n.toLowerCase());
  for (const m of text.matchAll(OVERSTOCK_RE)) {
    const idx = m.index ?? 0;
    const entity = entityNear(text, idx);
    if (!entity) continue;
    if (surplusNames.length === 0) {
      push({
        code: 'unsupported_inventory_claim',
        severity: 'INVALID',
        claim: m[0],
        message: 'AI claims surplus/overstock, but the deterministic inventory system identified no surplus items.',
      });
      continue;
    }
    const n = entity.toLowerCase();
    // Low stock is authoritative — claiming a low-stock item is overstocked is
    // the clearest contradiction, report it before the generic surplus check.
    if (lowNames.includes(n)) {
      push({
        code: 'inventory_conflict',
        severity: 'INVALID',
        claim: m[0],
        fact: entity,
        message: `AI claims "${entity}" is overstocked while the deterministic layer marks it low stock — low stock is authoritative.`,
      });
      continue;
    }
    if (!surplusNames.includes(n)) {
      push({
        code: 'unsupported_inventory_claim',
        severity: 'INVALID',
        claim: m[0],
        fact: entity,
        message: `AI claims "${entity}" is overstocked but it is not in the deterministic surplus list.`,
      });
    }
  }
  for (const m of text.matchAll(LOWSTOCK_RE)) {
    const idx = m.index ?? 0;
    const entity = entityNear(text, idx);
    if (!entity) continue;
    const n = entity.toLowerCase();
    if (lowNames.length > 0 && !lowNames.includes(n) && surplusNames.includes(n)) {
      push({
        code: 'inventory_conflict',
        severity: 'INVALID',
        claim: m[0],
        fact: entity,
        message: `AI claims "${entity}" is low stock while the deterministic layer marks it surplus.`,
      });
    }
  }

  // 7.6b — wastage claims must reference a deterministic wastage item; with no
  // wastage data supplied at all, any wastage claim is unsupported.
  const wastageNames = (factBundle.wastageItems || []).map((n) => n.toLowerCase());
  for (const m of text.matchAll(WASTAGE_RE)) {
    const idx = m.index ?? 0;
    const entity = entityNear(text, idx);
    if (!entity) continue;
    const n = entity.toLowerCase();
    if (wastageNames.length === 0) {
      push({
        code: 'unsupported_wastage_claim',
        severity: 'INVALID',
        claim: m[0],
        message: `AI claims wastage for "${entity}" but no deterministic wastage data was supplied.`,
      });
    } else if (!wastageNames.includes(n)) {
      push({
        code: 'unsupported_wastage_claim',
        severity: 'WARNING',
        claim: m[0],
        fact: entity,
        message: `AI claims wastage for "${entity}" but it is not a deterministic wastage item.`,
      });
    }
  }

  // 7.5 — segments: AI must not invent segments that do not exist.
  if (factBundle.segments?.length) {
    const segNames = factBundle.segments.map((s) => s.toLowerCase());
    for (const m of text.matchAll(SEG_HINT_RE)) {
      const claimed = m[0].toLowerCase().replace(/[^a-z]/g, '');
      const known = segNames.some((s) => s.replace(/[^a-z]/g, '').includes(claimed) || claimed.includes(s.replace(/[^a-z]/g, '')));
      if (!known) {
        push({
          code: 'unknown_segment',
          severity: 'WARNING',
          claim: m[0],
          message: `AI references segment "${m[0]}" which is not among the deterministic segments — treat as non-authoritative.`,
        });
      }
    }
    // "Platinum members/customers" style references — capitalized audience
    // names that are not among the known segments.
    for (const m of text.matchAll(SEG_AUDIENCE_RE)) {
      const name = m[1].trim();
      if (!knownEntity(name, [factBundle.segments])) {
        push({
          code: 'unknown_segment',
          severity: 'WARNING',
          claim: name,
          message: `AI targets segment "${name}" which is not among the deterministic segments — treat as non-authoritative.`,
        });
      }
    }
  }

  if (violations.some((v) => v.severity === 'INVALID')) {
    return { status: 'INVALID', violations };
  }
  if (violations.length > 0) {
    return { status: 'WARNING', violations };
  }
  void hasAnyFacts; // informational — no facts means nothing to contradict → VALID
  return { status: 'VALID', violations: [] };
}

/**
 * Phase 7.8 — safe application helper: if the AI result contradicts the fact
 * bundle, substitute the deterministic fallback so invalid factual claims are
 * never displayed. Returns the (possibly replaced) payload + validation meta.
 */
export function applyFactValidation(
  aiText: string,
  factBundle: FactBundle,
  fallbackData: any,
): { data: any; fallback: boolean; validation: FactValidationResult } {
  const validation = validateFactConsistency(aiText, factBundle);
  if (validation.status === 'INVALID') {
    return { data: fallbackData, fallback: true, validation };
  }
  return { data: undefined, fallback: false, validation };
}
