/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentCopy.ts — plain-language rendering of the Intelligence Pipeline
 * (System #3) outputs: canonical signal codes, ML evidence kinds and the
 * engine's own economics.
 *
 * The technical strings stay stored on every proposal as audit evidence; this
 * module only EXPLAINS them for the owner. Rules:
 *   - never hide information: an unrecognized string passes through readably;
 *   - never invent: a friendly line rephrases what the engine said, it does
 *     not add claims (confidence caveats are kept, not dropped);
 *   - deterministic — covered by __tests__/agentCopy.test.ts.
 *
 * NOTE: the targeting-ladder vocabulary (rungs, targeting reasons/scopes,
 * per-customer score hints) was removed together with the deterministic
 * marketing agent. Agentic insights render their own plain-language copy.
 */

/** Canonical business-signal codes → owner language. */
export const SIGNAL_LABELS: Record<string, string> = {
  sales_revenue_level: 'recent sales',
  sales_aov_level: 'average bill size',
  sales_weekday_peak: 'your strongest day',
  sales_weekday_trough: 'your weakest day',
  sales_hour_peak: 'your busiest hour',
  sales_hour_trough: 'your quietest hour',
  sales_category_strong: 'a strong menu section',
  sales_category_weak: 'a weak menu section',
  product_high_margin: 'a high-profit dish',
  product_low_margin: 'a low-profit dish',
  product_high_demand: 'a popular dish',
  product_slow_moving: 'a slow-selling dish',
  product_declining: 'a dish losing popularity',
  product_growing: 'a dish gaining popularity',
  inventory_low: 'low stock',
  inventory_overstock: 'extra stock',
  inventory_expiring: 'stock about to expire',
  inventory_stockout_risk: 'stock about to run out',
  customer_segment_present: 'customer groups you have',
  customer_inactive_high: 'customers who stopped coming',
  customer_high_value_present: 'your best customers',
  offer_underperforming: 'an offer that did not work',
  offer_active: 'an offer running now',
  campaign_underperforming: 'a campaign that did not work',
  campaign_effective: 'a campaign that worked',
  product_high_demand_forecast: 'expected demand',
  basket_pair_strength: 'dishes bought together',
  festival_upcoming: 'an upcoming festival',
  sports_event_relevant: 'a nearby match',
  competition_density: 'nearby competition',
  weather_shift: 'notable weather',
};

/** ML evidence kinds → what they honestly mean (never "proven"). */
export const ML_KIND_LABELS: Record<string, string> = {
  causal_uplift: 'proven extra sales (from a real experiment)',
  response_model: 'likely to use an offer (a prediction)',
  segment: 'your saved customer groups',
  forecast: 'expected demand',
  basket: 'dishes usually bought together',
  descriptive: 'summary of your data',
};

/** Friendly list of signal codes ("a popular dish, dishes bought together"). */
export function friendlySignals(codes: string[] | undefined): string {
  if (!codes || codes.length === 0) return '';
  return codes.map((c) => SIGNAL_LABELS[c] ?? c.replace(/_/g, ' ')).join(', ');
}

/** Friendly list of ML evidence kinds. */
export function friendlyMlKinds(kinds: string[] | undefined): string {
  if (!kinds || kinds.length === 0) return '';
  return kinds.map((k) => ML_KIND_LABELS[k] ?? k.replace(/_/g, ' ')).join(', ');
}

/** Money formatting without inventing values. */
export function friendlyMoney(amount: number, symbol = '₹'): string {
  if (!Number.isFinite(amount)) return 'not available';
  return `${symbol}${Math.round(amount).toLocaleString('en-IN')}`;
}

/** "Breaks even after N extra sales" — honest economics phrasing. */
export function friendlyBreakEven(units: number, available = true): string {
  // Placeholder economics (no price/cost data) must never read as a real
  // break-even; "0 extra sales" would falsely imply the offer is free money.
  if (!available) return 'profit impact not available yet';
  if (!Number.isFinite(units) || units < 0) return 'break-even point not available';
  if (units === 0) return 'no extra sales needed to cover the discount';
  return `needs about ${units} extra sale${units === 1 ? '' : 's'} to cover the discount`;
}

/** Margin/discount safety phrasing from the engine's own constraints. */
export function friendlyEconomics(discountPct: number, marginPct: number, safe: boolean, available = true): string {
  if (!available) return 'Profit impact not available yet — no cost and price data for this option.';
  if (safe) return `Keeps ${Math.round(marginPct)}% profit per plate even after the ${Math.round(discountPct)}% discount.`;
  return `Careful: the ${Math.round(discountPct)}% discount leaves only ${Math.round(marginPct)}% profit — below your usual safety limit.`;
}

// ─── Agentic insight copy (System #2) ─────────────────────────────────────

/**
 * Internal agent tool ids → owner-friendly chip labels. The owner must never
 * see `getSalesTrends`; they see "Sales". Unknown ids resolve to NOTHING
 * (we never leak an internal name), and duplicates collapse to one chip.
 */
export const TOOL_LABELS: Record<string, string> = {
  // Sales / products / economics
  getSalesTrends: 'Sales',
  getMenuPerformance: 'Menu performance',
  getProductMargins: 'Product margins',
  getProductCombinations: 'Dishes sold together',
  // Inventory exposure
  getInventoryStatus: 'Inventory',
  getStockoutRisk: 'Stockout risk',
  getExpiryRisk: 'Expiry risk',
  // Customers / targeting
  getCustomerSegments: 'Customers',
  getRetentionSignals: 'Retention signals',
  // Marketing history
  getOfferPerformance: 'Offer performance',
  getCampaignPerformance: 'Campaign performance',
  getActiveOffers: 'Active offers',
  getPromotionCandidates: 'Promotion opportunities',
  // ML signals (honest labels — prediction, never "proven")
  getOfferResponseBatchScores: 'Offer response predictions',
  getOfferResponsePrediction: 'Offer response prediction',
  getUpliftSignals: 'Uplift signals',
  getDemandForecast: 'Demand forecast',
  // Context
  getFestivalContext: 'Festivals',
  getSportsContext: 'Sports events',
  getWeatherContext: 'Weather',
  getNearbyCompetition: 'Nearby competition',
  getBranches: 'Your branches',
};

/**
 * Deduped, owner-friendly labels for the sources an insight actually used.
 * Order is preserved (it reflects what the investigation consulted), unknown
 * ids are skipped so an internal tool name can never reach the UI.
 */
export function friendlyToolLabels(tools: string[] | undefined): string[] {
  if (!tools || tools.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of tools) {
    const label = TOOL_LABELS[id];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * Card category badge from real recommendation data ("PROMOTION",
 * "WEEKDAY", …). Prefers the engine's own strategy label; falls back to the
 * recommendation type. Never invented.
 */
export function friendlyCategory(rec: { type?: string; strategyLabel?: string } | null | undefined): string {
  const strategy = (rec?.strategyLabel || '').trim();
  if (strategy) return strategy;
  const derived = (rec?.type || '')
    .trim()
    .replace(/^CREATE_/i, '')
    .replace(/_/g, ' ')
    .trim();
  return derived || 'RECOMMENDATION';
}

// ─── Deep analysis copy (canonical /analyze path) ─────────────────────────

/**
 * Domain → what it actually covers. These are short, faithful paraphrases of
 * the backend's own domain questions (`ai/marketing/domains.ts`), not new
 * claims: the owner sees "Sales" and what it looked at instead of a machine
 * code.
 */
export const DOMAIN_LABELS: Record<string, string> = {
  sales: 'Sales',
  products: 'Menu items',
  inventory: 'Stock',
  customers: 'Customers',
  marketing_history: 'Past offers & campaigns',
  context: 'Festivals, sports & weather',
  ml: 'Predictions',
  feedback: 'Guest feedback',
  competition: 'Nearby competition',
};

/** What each domain answers — the backend's own wording, shortened. */
export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  sales: 'how revenue, average bill size and demand shape are moving',
  products: 'which dishes are high-demand, low-margin, declining or slow',
  inventory: 'what is exposed to waste, expiry or running out',
  customers: 'which customer groups exist and who has stopped coming',
  marketing_history: 'how past offers and campaigns actually performed',
  context: 'which festivals, matches or weather change demand right now',
  ml: 'what the prediction models currently say',
  feedback: 'what guest ratings and comments say',
  competition: 'what nearby competitors are doing',
};

/** Unknown domains stay readable instead of disappearing. */
export function friendlyDomain(domain: string | undefined): string {
  if (!domain) return 'Unknown area';
  return DOMAIN_LABELS[domain] ?? domain.replace(/_/g, ' ');
}

/**
 * Domain status → owner language. `unavailable` is a REAL result and must
 * never read as "all good" or as an error the owner caused.
 */
export const DOMAIN_STATUS_LABELS: Record<string, string> = {
  ok: 'Checked',
  partial: 'Partly checked',
  unavailable: 'No data',
};

/** Validation check name → owner language (the 7 deterministic checks). */
export const VALIDATION_CHECK_LABELS: Record<string, string> = {
  economic_safety: 'Profit safety',
  business_constraints: 'Your business rules',
  promotion_fatigue: 'Too many offers lately',
  inventory_feasibility: 'Stock feasibility',
  marketing_conflict: 'Overlap with a live offer',
  customer_eligibility: 'Who can receive it',
  safety: 'Safety',
};

/** Check status → owner language. `skipped` is NOT a pass and says so. */
export const VALIDATION_STATUS_LABELS: Record<string, string> = {
  pass: 'Passed',
  fail: 'Failed',
  skipped: 'Not checked',
  not_implemented: 'Not available yet',
};

/** Machine rejection codes → why the engine put a candidate aside. */
export const REJECTION_CODE_LABELS: Record<string, string> = {
  ECONOMICS_UNSAFE: 'the discount would eat too much profit',
  VIOLATES_BUSINESS_CONSTRAINTS: 'it breaks one of your business rules',
  PROMOTION_FATIGUE_HIGH: 'you have run too many offers recently',
  STOCKOUT_RISK_ON_TARGET: 'a targeted item may run out',
  DUPLICATE_ACTIVE_OFFER: 'an offer covering the same items is already running',
  NO_TARGET_SEGMENT: 'no eligible customers were found for it',
};

/** Rejection codes → readable list; an unknown code stays visible, never dropped. */
export function friendlyRejectionCodes(codes: string[] | undefined): string[] {
  if (!codes || codes.length === 0) return [];
  return codes.map((c) => REJECTION_CODE_LABELS[c] ?? c.replace(/_/g, ' ').toLowerCase());
}

/** Critic verdict → owner language ("PASS" is an internal token). */
export function friendlyCriticVerdict(verdict: string | undefined): { label: string; tone: 'good' | 'warn' | 'bad' } {
  switch (verdict) {
    case 'PASS':
      return { label: 'Looks sound', tone: 'good' };
    case 'DOWNGRADE':
      return { label: 'Treat with caution', tone: 'warn' };
    case 'REJECT':
      return { label: 'Not recommended', tone: 'bad' };
    default:
      return { label: 'Not reviewed', tone: 'warn' };
  }
}

/** Run status → owner language. Degraded runs must say so plainly. */
export function friendlyAnalyzeStatus(status: string | undefined): {
  label: string;
  description: string;
  degraded: boolean;
} {
  switch (status) {
    case 'completed':
      return { label: 'Analysis complete', description: 'Every area answered with usable data.', degraded: false };
    case 'completed_degraded':
      return {
        label: 'Analysis complete, with gaps',
        description: 'Some areas had no data or were unavailable — the gaps are listed below.',
        degraded: true,
      };
    case 'degraded_no_llm':
      return {
        label: 'Analysis limited',
        description: 'The AI assistant was unavailable, so only the deterministic checks ran.',
        degraded: true,
      };
    case 'failed':
      return { label: 'Analysis failed', description: 'Nothing usable could be produced.', degraded: true };
    default:
      return { label: 'Analysis', description: '', degraded: true };
  }
}

/** Risk level → owner language. */
export const RISK_LABELS: Record<string, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

/** "72% confidence" — omitted entirely when the number is absent. */
export function friendlyConfidence(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}% confidence`;
}

/**
 * Evidence refs → owner-readable labels.
 *
 * A raw ref looks like `signal:sales_revenue_level:80022f:restaurant` — it
 * carries internal ids, so it is NEVER rendered. Only the recognisable prefix
 * is translated, deduped; anything unrecognisable is dropped and the caller
 * falls back to the (real) count of supporting evidence instead of inventing a
 * label.
 */
export function friendlyEvidenceRefs(refs: string[] | undefined): string[] {
  if (!refs || refs.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref) continue;
    const [prefix, key] = ref.split(':');
    let label: string | undefined;
    if (prefix === 'signal' && key) label = SIGNAL_LABELS[key] ?? key.replace(/_/g, ' ');
    else if (prefix === 'ml' && key) label = ML_KIND_LABELS[key];
    else if (prefix === 'declared' && key) label = `${friendlyDomain(key)} — not available yet`;
    else if (prefix === 'memory') label = 'something learned from earlier runs';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * A measured signal value + unit, or an empty string when the source had no
 * number (the caller then shows "No measured value" rather than a fake 0).
 * Units come from the existing normalizers: `currency`, `currency/day`,
 * `currency/order`, `%`, `units`, `units/day`, `customers`, `days`, `rate`,
 * `°C`, … — the currency family keeps its `/day` style suffix instead of being
 * flattened to a bare amount.
 */
export function friendlySignalValue(
  signal: { value?: number; unit?: string; changePct?: number } | null | undefined,
  symbol = '₹',
): string {
  const parts: string[] = [];
  const value = signal?.value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const unit = (signal?.unit || '').trim();
    const rounded = Math.round(value * 100) / 100;
    if (unit.toLowerCase().startsWith('currency')) {
      parts.push(`${friendlyMoney(value, symbol)}${unit.slice('currency'.length)}`);
    } else if (unit === '%') {
      parts.push(`${rounded}%`);
    } else {
      parts.push(unit ? `${rounded} ${unit}` : `${rounded}`);
    }
  }
  if (typeof signal?.changePct === 'number' && Number.isFinite(signal.changePct) && signal.changePct !== 0) {
    const pct = Math.round(signal.changePct * 100);
    parts.push(`${pct > 0 ? '+' : ''}${pct}% vs usual`);
  }
  return parts.join(' · ');
}

// ─── AI request failures → owner language ─────────────────────────

/**
 * Why an owner-invoked AI endpoint (AI Insights, Recommendations, deep
 * analysis, AI Inventory Insights) returned no result. Mirrors
 * `AiFailureKind` in src/api/client.ts — duplicated as a raw string type so
 * this module stays free of api-layer imports.
 */
export type AiFailureReason =
  | 'offline'
  | 'timeout'
  | 'network_error'
  | 'rate_limited'
  | 'auth_required'
  | 'server_error'
  | 'http_error';

/**
 * A null result from an AI endpoint used to show one generic "couldn't be
 * completed" line for four very different causes (device offline, client
 * abort, rate limit, expired session, server trouble). The catch-block
 * regexes that were meant to tell them apart were unreachable — the request
 * layer returns null instead of throwing — so the owner never knew which
 * remediation applied: wait, re-login, or reconnect Wi-Fi.
 *
 * `aiFailureCopy` turns the recorded reason (read with
 * `getLastAiFailureReason` right after the null) into one extra detail
 * sentence. The screens keep their own base line ("Recommendations couldn't
 * be loaded right now.") so unknown reasons degrade to exactly the same
 * copy as before; recognized reasons ADD an honest explanation and the
 * matching remediation. Deterministic — covered in agentCopy.test.ts.
 */
export function aiFailureCopy(
  reason: string | undefined,
): string {
  switch (reason) {
    case 'offline':
      return 'This device is offline. Reconnect to the internet and try again.';
    case 'timeout':
      return 'The analysis took longer than the app allows this time, so it was stopped mid-way. Nothing was lost — please run it again; a retry usually finishes within a minute.';
    case 'network_error':
      return 'The connection to the server dropped during the analysis. Please try again.';
    case 'rate_limited':
      return 'Another analysis is already running for your restaurant, or several ran just now. Please wait a few seconds and try again.';
    case 'auth_required':
      return 'Your session has expired. Please sign in again to run the analysis.';
    case 'server_error':
      return 'The server is having trouble right now. Please try again in a little while — nothing was changed.';
    default:
      return '';
  }
}
