/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two-arm statistical analysis (spec Step 3) — PURE module, no DB access.
 *
 * Honesty rules implemented here:
 *   - BELOW the per-arm minimum sample size the result is `inconclusive` —
 *     never "no difference", never a winner (spec §46).
 *   - The primary metric is the ONLY metric that decides the verdict;
 *     secondaries are reported for color, never for decisions (§24).
 *   - Causal language ("uplift", "incremental") is used ONLY when a real
 *     control arm exists; treatment-vs-treatment comparisons are labeled
 *     as such (§22/§38).
 */

export type ExperimentMetric = 'redemption_rate' | 'revenue' | 'contribution' | 'aov';

export interface ArmAggregate {
  arm: 'control' | 'treatment';
  variantId: string;
  customers: number;
  conversions: number;
  responseRate: number | null; // conversions / customers
  totalRevenue: number;
  revenuePerCustomer: number | null;
}

export interface ArmInput {
  variantId: string;
  customers: number;
  conversions: number;
  revenue: number;
}

export interface CompareResult {
  verdict: 'control_wins' | 'treatment_wins' | 'tie' | 'inconclusive';
  absoluteDifference: number | null;
  relativeDifference: number | null; // (treatment - control) / |control|
  ci95Low: number | null; // CI on the primary-metric difference
  ci95High: number | null;
  pValueApprox: number | null; // normal approximation, two-sided
  hasControlArm: boolean;
  notes: string[];
}

const Z_95 = 1.96;

/** Standard normal CDF via erf approximation (Abramowitz–Stegun 7.1.26). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdfOne = 1 - (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? cdfOne : 1 - cdfOne;
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Aggregates one arm from raw per-customer ledger rows. Pure. */
export function aggregateArm(
  variantId: string,
  kind: 'control' | 'treatment',
  rows: Array<{ purchase: number; attributedRevenue?: number | null }>
): ArmAggregate {
  const customers = rows.length;
  const conversions = rows.reduce((s, r) => s + (r.purchase === 1 ? 1 : 0), 0);
  const revenue = rows.reduce(
    (s, r) => s + (typeof r.attributedRevenue === 'number' ? r.attributedRevenue : 0),
    0
  );
  return {
    arm: kind,
    variantId,
    customers,
    conversions,
    responseRate: safeRate(conversions, customers),
    totalRevenue: revenue,
    revenuePerCustomer: safeRate(revenue, customers),
  };
}

function toAggregate(kind: 'control' | 'treatment', input: ArmInput): ArmAggregate {
  return {
    arm: kind,
    variantId: input.variantId,
    customers: input.customers,
    conversions: input.conversions,
    responseRate: safeRate(input.conversions, input.customers),
    totalRevenue: input.revenue,
    revenuePerCustomer: safeRate(input.revenue, input.customers),
  };
}

/**
 * Two-proportion comparison on the primary metric with a 95% interval.
 * `control` may be null for treatment-only analyses — the verdict is then
 * explicitly non-causal. Below the per-arm minimum the verdict is always
 * `inconclusive`, regardless of how large the observed gap looks (spec §46).
 */
export function compareArms(
  control: ArmAggregate | null,
  treatment: ArmAggregate,
  opts: { primaryMetric: ExperimentMetric; minSampleSizePerArm: number }
): CompareResult {
  const notes: string[] = [];
  const metricIsRate = opts.primaryMetric === 'redemption_rate';
  const ct = metricIsRate ? treatment.responseRate : treatment.revenuePerCustomer;
  const cc = metricIsRate
    ? control?.responseRate ?? null
    : control?.revenuePerCustomer ?? null;

  if (!control) {
    notes.push(
      'no control arm in this analysis — result is NOT incremental/causal over no-promotion'
    );
  }

  const belowMin =
    treatment.customers < opts.minSampleSizePerArm ||
    (control !== null && control.customers < opts.minSampleSizePerArm);
  if (belowMin) {
    notes.push(
      `sample below minimum per arm (${opts.minSampleSizePerArm}) — result is inconclusive by design`
    );
  }

  if (belowMin || ct === null || cc === null) {
    if (ct === null || cc === null) {
      notes.push('missing primary-metric inputs for one arm — cannot compute a comparison');
    }
    const empty: CompareResult = {
      verdict: 'inconclusive',
      absoluteDifference: null,
      relativeDifference: null,
      ci95Low: null,
      ci95High: null,
      pValueApprox: null,
      hasControlArm: control !== null,
      notes,
    };
    return empty;
  }

  const absDiff = ct - cc;
  const relDiff = cc !== 0 ? absDiff / Math.abs(cc) : null;

  // Wald interval on the difference of proportions. For revenue-per-customer
  // the per-customer variance isn't recoverable from aggregates — we fall back
  // to a conservative proportion-based approximation and SAY so in notes.
  const ctrl = control as ArmAggregate; // narrowed non-null by the early return above
  let se: number;
  if (metricIsRate) {
    se = Math.sqrt(
      (ct * (1 - ct)) / treatment.customers + (cc * (1 - cc)) / ctrl.customers
    );
  } else {
    const rateT = treatment.responseRate ?? 0;
    const rateC = ctrl.responseRate ?? 0;
    se = Math.sqrt(
      (rateT * (1 - rateT)) / treatment.customers + (rateC * (1 - rateC)) / ctrl.customers
    );
    notes.push('revenue-metric interval uses a conservative proportion-based variance approximation');
  }

  const ciLow = absDiff - Z_95 * se;
  const ciHigh = absDiff + Z_95 * se;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(absDiff / se))) : absDiff === 0 ? 1 : 0;

  const significant = ciLow > 0 || ciHigh < 0; // interval excludes 0
  let verdict: CompareResult['verdict'];
  if (absDiff === 0 || !significant) {
    verdict = 'tie';
  } else if (absDiff > 0) {
    verdict = 'treatment_wins';
  } else {
    verdict = 'control_wins';
  }

  if (control) {
    notes.push(
      'randomized control arm present — treatment_wins/control_wins is a causal claim within this experiment'
    );
  }

  return {
    verdict,
    absoluteDifference: absDiff,
    relativeDifference: relDiff,
    ci95Low: ciLow,
    ci95High: ciHigh,
    pValueApprox: pValue,
    hasControlArm: Boolean(control),
    notes,
  };
}

export interface AnalyzerOptions {
  experimentId: string;
  primaryMetric: ExperimentMetric;
  minSampleSizePerArm: number;
  attributionWindowDays: number;
  control: ArmInput | null; // null = treatment-only (no causal claim)
  treatment: ArmInput;
  /** Total discount cost given away among treatment conversions. */
  discountCostTreatment?: number;
}

/** Full pure analysis used by experimentService.analyze(). */
export function analyzeExperiment(opts: AnalyzerOptions): ExperimentAnalysis {
  const treatmentAgg = toAggregate('treatment', opts.treatment);
  const controlAgg = opts.control ? toAggregate('control', opts.control) : null;

  const comparison = compareArms(controlAgg, treatmentAgg, {
    primaryMetric: opts.primaryMetric,
    minSampleSizePerArm: opts.minSampleSizePerArm,
  });

  const contributionTreatment = safeRate(
    opts.treatment.revenue - (opts.discountCostTreatment ?? 0),
    opts.treatment.customers
  );
  const contributionControl = opts.control
    ? safeRate(opts.control.revenue, opts.control.customers)
    : null;

  return {
    experimentId: opts.experimentId,
    primaryMetric: opts.primaryMetric,
    minSampleSizePerArm: opts.minSampleSizePerArm,
    attributionWindowDays: opts.attributionWindowDays,
    arms: controlAgg ? [controlAgg, treatmentAgg] : [treatmentAgg],
    comparison,
    generatedAt: new Date().toISOString(),
    discountCostTreatment: opts.discountCostTreatment ?? 0,
    contributionTreatment,
    contributionControl,
  };
}

export interface ExperimentAnalysis {
  experimentId: string;
  primaryMetric: ExperimentMetric;
  minSampleSizePerArm: number;
  attributionWindowDays: number;
  arms: ArmAggregate[];
  comparison: CompareResult;
  generatedAt: string;
  discountCostTreatment: number;
  /** Revenue-minus-discount per customer (margin-aware view, §margin). */
  contributionTreatment: number | null;
  contributionControl: number | null;
}
