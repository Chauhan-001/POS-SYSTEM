/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentCopy.ts — plain-language rendering of the marketing agent's
 * deterministic outputs.
 *
 * The technical strings stay stored on every proposal as audit evidence
 * (risks.notes / description); this module only EXPLAINS them for the owner.
 * Rules:
 *   - never hide information: an unrecognized string passes through as-is;
 *   - never invent: the friendly line rephrases what the evidence said, it
 *     does not add claims (confidence caveats are kept, not dropped);
 *   - deterministic — covered by __tests__/agentCopy.test.ts.
 */

export const OBJECTIVE_LABELS: Record<string, string> = {
  REACTIVATE_CUSTOMERS: 'Bring customers back',
  WINBACK: 'Win back lost customers',
  RETENTION: 'Keep regulars coming',
  ACQUISITION: 'Attract new customers',
  REWARD_LOYALTY: 'Reward loyal customers',
  BOOST_SALES: 'Boost sales',
  CLEAR_INVENTORY: 'Clear stock',
  INCREASE_ORDERS: 'Boost sales',
  PROMOTE_NEW_ITEM: 'Promote a new item',
};

const AGENT_SOURCES = new Set(['CAUSAL_UPLIFT', 'RESPONSE_MODEL', 'ML_SEGMENTS', 'NONE']);

/** Friendly rung names — "how the audience was picked". */
export const RUNG_LABELS: Record<string, string> = {
  CAUSAL_UPLIFT: 'a proven experiment',
  RESPONSE_MODEL: 'the customer response model',
  ML_SEGMENTS: 'your saved customer groups',
  NONE: 'no signal yet',
};

/** What a customer-level target list means, per rung (segment-style phrasing). */
export function customerGroupPhrase(targetingSource?: string): string {
  switch (targetingSource) {
    case 'CAUSAL_UPLIFT':
      return 'most likely to bring extra sales';
    case 'RESPONSE_MODEL':
      return 'most likely to use an offer';
    default:
      return 'picked from your customer list';
  }
}

/**
 * Proposal cards show a friendly title; the raw machine name
 * (`OBJECTIVE • SOURCE • YYYY-MM-DD`) stays as a small receipt line for
 * search/support.
 */
export function friendlyProposalTitle(name: string, source?: string): { title: string; raw: string } {
  const raw = name || '';
  const parts = raw.split(' • ');
  const objectiveLabel = OBJECTIVE_LABELS[parts[0]];
  const parsedSource = parts.length >= 2 ? parts[1] : '';
  const isAgent = source === 'agent' || AGENT_SOURCES.has(parsedSource);
  if (!objectiveLabel) return { title: raw, raw };
  return { title: `${objectiveLabel} — ${isAgent ? 'AI suggestion' : 'Your draft'}`, raw };
}

/** The rung encoded in a proposal name (`OBJECTIVE • RESPONSE_MODEL • date`). */
export function sourceFromProposalName(name: string): string | undefined {
  const parts = (name || '').split(' • ');
  return parts.length >= 2 && AGENT_SOURCES.has(parts[1]) ? parts[1] : undefined;
}

/** Gate reasons like "treated rows 30 < 100 minimum" → owner language. */
function friendlyGateReason(reason: string): string {
  let m = reason.match(/treated rows (\d+) < (\d+) minimum/);
  if (m) return `only ${m[1]} offers tracked (${m[2]} needed)`;
  m = reason.match(/conversions (\d+) < (\d+) minimum/);
  if (m) return `only ${m[1]} redemptions recorded (${m[2]} needed)`;
  m = reason.match(/non-converters (\d+) < (\d+) minimum/);
  if (m) return `only ${m[1]} non-redeemers in the test group (${m[2]} needed)`;
  m = reason.match(/experiment too small: (\d+) treatment assignments < (\d+) minimum/);
  if (m) return `experiment too small: only ${m[1]} offers assigned (${m[2]} needed)`;
  if (reason === 'no assignment events recorded') return 'no offers have been tracked yet';
  if (reason.startsWith('no control arm:')) return 'no control group yet — offers go to everyone, so extra sales cannot be proven';
  if (reason === 'no evaluable experiment') return 'no usable experiment yet';
  if (reason === 'model not trained for this tenant') return 'the response model has no training data yet';
  return reason;
}

function friendlyGateReasons(list: string): string {
  return list
    .split('; ')
    .map(friendlyGateReason)
    .join('; ');
}

/** Why the response-model rung was skipped → owner language. */
function friendlyUnavailableWhy(why: string): string {
  if (/not configured/i.test(why)) return "the customer-response service isn't switched on";
  if (/unreachable|failed/i.test(why)) return "the customer-response service can't be reached";
  if (/No trained offer-response model/i.test(why)) return "the response model hasn't trained yet (needs more offer + redemption history)";
  if (/No recent customers/i.test(why)) return 'there are no recent customers to score';
  if (/lack pre-treatment feature snapshots/i.test(why)) return 'customer profiles are missing visit history';
  if (/not trained at score time/i.test(why)) return 'the response model lost its training data';
  if (/<\s*\d+\s*minimum/.test(why)) return friendlyGateReasons(why);
  return why;
}

/**
 * The agent's targetingReason (one sentence built from rung notes) → plain
 * language. Covers every reason string marketingAgent.ts can produce; unknown
 * text passes through unchanged.
 */
export function friendlyTargetingReason(reason: string): string {
  if (!reason) return reason;
  let out = reason;

  // Composition first (these reasons can chain several rung notes).
  out = out.replace(
    /^Uplift gate not passed: ([^.]+)\./,
    (_m, p1: string) => `Not enough experiment data to prove extra sales yet (${friendlyGateReasons(p1)}).`,
  );
  out = out.replace(
    /Offer-response rung unavailable: ([^.]+)\./,
    (_m, p1: string) => `The customer response model isn't ready (${friendlyUnavailableWhy(p1)}).`,
  );
  out = out.replace(
    /Trained offer-response model used: (\d+) of (\d+) recent customers ranked by p\(redeem \| offer\) — non-causal\./,
    (_m, k: string, n: string) =>
      `your customer response model ranked ${k} of ${n} recent customers by how likely they are to use an offer (a predicted response, not proven extra sales).`,
  );
  out = out.replace(
    /Experiment passed the evaluability gate \(([^)]*)\)\./,
    (_m, p1: string) => `Proven by a live experiment with ${p1}.`,
  );
  out = out.replace('Falling back to stored segmentation.', 'Using your saved customer groups instead.');
  out = out.replace(/using stored segmentation/g, 'using your saved customer groups');
  out = out.replace(/Uplift service unavailable/g, 'The experiment tracker is offline');
  out = out.replace(
    /^No evaluable uplift experiment, no response-model batch scoring, and no stored segments\./,
    "No targeting signal yet — there's no experiment data, response model, or saved customer groups to learn from.",
  );
  return out;
}

/** Scope label (the confidence caveat) → owner language. */
export function friendlyScope(scope: string): string {
  if (!scope) return scope;
  if (scope.startsWith('causal uplift')) return 'High confidence — extra sales estimated from a real experiment.';
  if (scope.startsWith('response likelihood')) return 'Moderate confidence — predicts who may use an offer, not who would have bought anyway.';
  if (scope.startsWith('segment membership')) return 'Low confidence — based on customer groups, not individual scores.';
  if (scope.startsWith('no ML signal')) return 'No targeting signal yet.';
  return scope;
}

/** One stored evidence line (risks.notes) → friendly bullet. */
export function friendlyEvidenceLine(line: string): string {
  if (!line) return line;
  if (line.startsWith('Targeting source: ')) {
    const idx = line.indexOf(' — ');
    if (idx >= 0) return friendlyTargetingReason(line.slice(idx + 3));
    return friendlyTargetingReason(line.slice('Targeting source: '.length));
  }
  if (line.startsWith('Scope: ')) return friendlyScope(line.slice('Scope: '.length));
  // Context lines (festival/cricket/competition/basket/demand) are already
  // written for humans — pass them through untouched.
  return line;
}

/** Best-score hint for a grouped customer chip (kept in rung vocabulary). */
export function customerScoreHint(targetingSource: string | undefined, score: number | null): string {
  if (score == null) return '';
  if (targetingSource === 'CAUSAL_UPLIFT') return ` · best +${score.toFixed(1)} pp`;
  if (targetingSource === 'RESPONSE_MODEL') return ` · top ${Math.round(score * 100)}% likely to redeem`;
  return '';
}

// ─── Phase 3–7 intelligence copy (plain language for owners) ───────────────

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
export function friendlyBreakEven(units: number): string {
  if (!Number.isFinite(units) || units < 0) return 'break-even point not available';
  if (units === 0) return 'no extra sales needed to cover the discount';
  return `needs about ${units} extra sale${units === 1 ? '' : 's'} to cover the discount`;
}

/** Margin/discount safety phrasing from the engine's own constraints. */
export function friendlyEconomics(discountPct: number, marginPct: number, safe: boolean): string {
  if (safe) return `Keeps ${Math.round(marginPct)}% profit per plate even after the ${Math.round(discountPct)}% discount.`;
  return `Careful: the ${Math.round(discountPct)}% discount leaves only ${Math.round(marginPct)}% profit — below your usual safety limit.`;
}

export interface OfferLike {
  title?: string;
  type?: string;
  value?: number;
}

/** Deal shorthand for a real attached offer ("20% off", "₹50 off", …). */
export function friendlyDeal(offer: OfferLike | null | undefined): string | null {
  if (!offer) return null;
  if (offer.type === 'percentage') return `${offer.value ?? 10}% off`;
  if (offer.type === 'flat') return `₹${offer.value ?? 50} off`;
  if (offer.type === 'combo') return `Combo at ₹${offer.value ?? 199}`;
  if (offer.type === 'buy_x_get_y') return 'Buy X get Y';
  if (offer.type === 'add_on') return 'Add-on deal';
  if (typeof offer.value === 'number' && offer.value > 0) return `Special at ₹${offer.value}`;
  return null;
}
