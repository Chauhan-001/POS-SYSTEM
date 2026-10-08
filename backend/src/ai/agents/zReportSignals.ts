/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportSignals.ts — PHASE 3 evidence collection for the Daily Summary /
 * Z-Report Intelligence pipeline.
 *
 * Progressive evidence collection (NO LLM here):
 *   Batch 1 — CORE FACTS: parallel existing tool reads through the SHARED
 *             plan/registry path (investigateBusiness). Reuses the canonical
 *             defaultDimensionPlan entries verbatim — reordered/filtered, not
 *             re-wired — plus the one dimension the canonical plan lacks:
 *             kitchen wastage (getWastage → normalizeWastage).
 *   Batch 2 — BUSINESS INTELLIGENCE: DETERMINISTIC derived signals from the
 *             existing salesReportService.summary() (previous-period deltas)
 *             and demandAnomalyService, plus a WEEKDAY-AWARE ROLLING BASELINE
 *             from salesReportService.trend() (trailing 7 days + up to 4 prior
 *             same weekdays — extends the P1 v1 previous-day-only decision).
 *   Batch 3 — CONTEXT / ML: conditional cross-check fan-out (ML + calendar/
 *             weather/competition context), same shared plan path.
 *
 * Facts stay owned by deterministic systems; this module only normalizes,
 * derives and records provenance. Never throws for data conditions — every
 * tool failure becomes an explicit, visible error entry.
 */

import {
  defaultDimensionPlan,
  investigateBusiness,
  type BusinessInvestigation,
  type BusinessInvestigationOptions,
} from '../intelligence/businessIntelligenceService';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';
import {
  normalizeCashClosing,
  normalizeWastage,
  type CashClosingLike,
  type NormalizerInput,
} from '../intelligence/businessSignalNormalizers';
import { makeSignalId } from '../intelligence/businessSignalTypes';
import { salesReportService } from '../../modules/reports/services/salesReportService';
import { detectAllDemandAnomalies } from '../../services/demandAnomalyService';
import type { AiTenantContext } from '../shared/tenantContext';
import type { ZReportContext } from './zReportContext';

/** Canonical plan steps (structural view — the interface itself is module-private). */
type PlanStep = NonNullable<BusinessInvestigationOptions['plan']>[number];

// ─────────────────────────────────────────────────────────────────────────────
// Batch composition (from the canonical defaultDimensionPlan entries)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch 1 order — core facts, deterministic sequence regardless of completion
 * timing. Every entry is a CANONICAL defaultDimensionPlan tool (reordered, not
 * re-wired). The marketing entries are included because "which promo was
 * running" is a fact about the closing day and is required to interpret
 * discount pressure / sales movement — dropping them would leave the LLM
 * unable to connect those two facts.
 */
const BATCH1_TOOL_ORDER = [
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getInventoryStatus',
  'getExpiryRisk',
  'getStockoutRisk',
  'getCustomerSegments',
  'getRetentionSignals',
  'getActiveOffers',
  'getOfferPerformance',
  'getCampaignPerformance',
] as const;

/**
 * Batch 3 order — predictive/context cross-checks. Only canonical plan
 * dimensions appear here: the demand forecast and market-basket tools are the
 * canonical ML-evidence carriers with EXISTING normalizers. The pure-ML tools
 * (getMLCustomerSegments / getUpliftSignals / getOfferResponseBatchScores)
 * stay follow-up-eligible through the existing mlSemantics evidence builders
 * — no second ML path is created in v1.
 */
const BATCH3_TOOL_ORDER = [
  'getDemandForecast',
  'getMarketBasketSignals',
  'getFestivalContext',
  'getSportsContext',
  'getNearbyCompetition',
  'getWeatherContext',
] as const;

/**
 * Tool names Batch 1 actually executes (canonical entries + the wastage step).
 * Exported so the follow-up stage never re-reads a tool the run already used.
 */
export const Z_REPORT_BATCH1_TOOLS: readonly string[] = [...BATCH1_TOOL_ORDER, 'getWastage'];

/** Tool names Batch 3 executes when it is triggered. */
export const Z_REPORT_BATCH3_TOOLS: readonly string[] = [...BATCH3_TOOL_ORDER];

/**
 * The canonical plan has no wastage dimension; the Z-report pipeline adds it.
 * This is the SAME shape as a canonical step (same registry tool + the shared
 * normalizer) — no parallel tool path, no duplicated read.
 */
function wastagePlanStep(input: NormalizerInput, timeoutMs: number): PlanStep {
  const branch = input.branchId ?? undefined;
  return {
    dimension: 'inventory',
    toolName: 'getWastage',
    normalizer: 'inventory_context',
    input: { ...(branch ? { branchId: branch } : {}), lookbackDays: input.lookbackDays ?? 60 },
    timeoutMs,
    normalize: (raw, i) => normalizeWastage(raw as never, i),
  };
}

function reorder(plan: PlanStep[], order: readonly string[]): PlanStep[] {
  const byTool = new Map(plan.map((s) => [s.toolName, s]));
  return order.map((t) => byTool.get(t)).filter((s): s is PlanStep => Boolean(s));
}

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ZReportBatchResult {
  /** Numbered evidence batch, or the targeted follow-up stage. */
  batch: 1 | 2 | 3 | 'followup';
  signals: BusinessSignal[];
  /** Tool-level failures (never hidden; mirrors investigation.toolErrors). */
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  /** Normalizer identities with no usable evidence. */
  unavailable: string[];
  /** Batch-specific disclosures (e.g. baseline semantics, unmapped anomalies). */
  caveats: string[];
  durationMs: number;
}

export interface ZReportEvidence {
  restaurantId: string;
  branchId?: string;
  businessDate: string;
  batch1: ZReportBatchResult;
  batch2: ZReportBatchResult;
  /** Null when Batch 3 was skipped (conditional) — the skip itself is visible. */
  batch3: ZReportBatchResult | null;
  /**
   * Targeted follow-up evidence (Phase 4), attached after Batch 1/2/3 ran.
   * null/absent = no follow-up was triggered; its own reason is disclosed in
   * the follow-up result rather than in `batch3Reason`.
   */
  followUp?: ZReportBatchResult | null;
  /** Why Batch 3 ran or was skipped (audit trail). */
  batch3Reason: string;
  caveats: string[];
  generatedAt: string;
}

export interface CollectEvidenceOptions {
  context: ZReportContext;
  tenant: AiTenantContext;
  /** Deterministic closing figures from closingReportService.zReport (Phase 5 fetches once and passes in). */
  closing?: (CashClosingLike & { requiresManagerApproval?: boolean }) | null;
  /** true = always run; false = never; 'auto' = run when Batch 1/2 found notable movement. */
  includeBatch3?: boolean | 'auto';
  /** Wall-clock budgets (Batch 3 shares what remains after Batch 1). */
  batch1BudgetMs?: number;
  batch3BudgetMs?: number;
  executionId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch 2 — deterministic derived signals
// ─────────────────────────────────────────────────────────────────────────────

/** Δ thresholds (documented, deterministic — no ML, no LLM). */
const GROWTH_MOVE_PCT = 10; // ±10% day-over-day counts as a notable move
const VOLUME_AOV_MOVE_PCT = 10;
const DISCOUNT_PRESSURE_RATIO = 0.15; // discounts ≥ 15% of gross sales
const REFUND_SPIKE_RATIO = 0.05; // refunds ≥ 5% of net sales
const LOW_SAMPLE_ORDERS = 10;
const WEEKDAY_MOVE_PCT = 10; // ±10% vs the same-weekday baseline counts as notable
const MIN_SAME_WEEKDAY_DAYS = 2; // fewer prior same-weekdays → disclosed, never compared
const SAME_WEEKDAY_LOOKBACK_WEEKS = 4;

function pct(n: number): number {
  return Math.round(n * 10) / 10;
}

type SummaryShape = Awaited<ReturnType<typeof salesReportService.summary>>;

function scopeOfContext(context: ZReportContext) {
  return {
    restaurantId: context.restaurantId,
    // null (not undefined) — the canonical scope contract uses null for a
    // tenant-wide signal, and the strict signal schema enforces it.
    branchId: context.branchId ?? null,
    scope: context.branchId ? ('branch' as const) : ('tenant' as const),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekday-aware rolling baseline (pure — unit-testable without Mongo/clock)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-day row from the EXISTING salesReportService.trend() series. */
export interface ZReportTrendDayRow {
  date: string;
  revenue: number;
  orders: number;
}

export interface ZReportWeekdayBaseline {
  /** Weekday name of the business date (UTC calendar). */
  weekday: string;
  /** Trailing 7 CALENDAR days ending the day BEFORE the business date. */
  trailing7: { avgRevenue: number; avgOrders: number; daysFound: number };
  /** Same weekday over prior weeks — up to 4 most recent, business date excluded. */
  sameWeekday: { avgRevenue: number; avgOrders: number; days: number; dates: string[] };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rolling weekday-aware baseline computed from the existing per-day trend
 * series. Pure: no clock, no DB. The business date's own row is excluded
 * defensively (the trend window ends the day before, so it should never
 * appear). Days without bills are simply absent from the series — they are
 * counted as missing coverage (`daysFound`), not as zero-revenue days, and
 * that coverage is disclosed in the batch caveat.
 */
export function weekdayBaseline(series: ZReportTrendDayRow[], businessDate: string): ZReportWeekdayBaseline {
  const bd = new Date(`${businessDate}T00:00:00Z`);
  const weekday = WEEKDAY_NAMES[bd.getUTCDay()];
  const byDate = new Map(series.map((r) => [r.date, r]));
  const mean = (rows: ZReportTrendDayRow[], key: 'revenue' | 'orders'): number =>
    rows.length ? round2(rows.reduce((s, r) => s + (Number.isFinite(r[key]) ? r[key] : 0), 0) / rows.length) : 0;

  const trailing: ZReportTrendDayRow[] = [];
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(bd.getTime() - i * 86400000).toISOString().slice(0, 10);
    const row = byDate.get(d);
    if (row) trailing.push(row);
  }
  const sameDays = series
    .filter((r) => r.date !== businessDate && new Date(`${r.date}T00:00:00Z`).getUTCDay() === bd.getUTCDay())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SAME_WEEKDAY_LOOKBACK_WEEKS);
  return {
    weekday,
    trailing7: { avgRevenue: mean(trailing, 'revenue'), avgOrders: mean(trailing, 'orders'), daysFound: trailing.length },
    sameWeekday: {
      avgRevenue: mean(sameDays, 'revenue'),
      avgOrders: mean(sameDays, 'orders'),
      days: sameDays.length,
      dates: sameDays.map((r) => r.date),
    },
  };
}

/** Day-over-day deltas from the EXISTING summary service (previous-period baseline). */
function signalsFromSummary(summary: SummaryShape, context: ZReportContext): BusinessSignal[] {
  const signals: BusinessSignal[] = [];
  const s = scopeOfContext(context);
  const date = context.businessDate;
  const gen = new Date().toISOString();
  const sampleConfidence = summary.summary.orders >= LOW_SAMPLE_ORDERS ? 0.85 : 0.6;

  const revenueGrowth = summary.comparison.revenueGrowthPct; // percent points
  if (Math.abs(revenueGrowth) >= GROWTH_MOVE_PCT && summary.comparison.previousNetRevenue > 0) {
    const up = revenueGrowth > 0;
    signals.push({
      signalId: makeSignalId(up ? 'sales_growth' : 'sales_decline', context.restaurantId, date),
      code: up ? 'sales_growth' : 'sales_decline',
      category: 'sales',
      source: 'sales_context',
      statement: `Net revenue on ${date} was ${pct(Math.abs(revenueGrowth))}% ${up ? 'higher' : 'lower'} than the previous day (${summary.comparison.previousNetRevenue} → ${summary.summary.netSales}).`,
      value: summary.summary.netSales,
      baseline: summary.comparison.previousNetRevenue,
      changePct: revenueGrowth / 100,
      direction: up ? 'up' : 'down',
      confidence: sampleConfidence,
      sampleSize: summary.summary.orders,
      scope: s,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        { kind: 'metric', ref: 'salesReport.summary.netSales', value: summary.summary.netSales, observedAt: gen },
        { kind: 'metric', ref: 'salesReport.summary.previousNetRevenue', value: summary.comparison.previousNetRevenue, observedAt: gen },
        { kind: 'ratio', ref: 'salesReport.summary.revenueGrowthPct', value: revenueGrowth, observedAt: gen },
      ],
      caveats: ['Baseline is the previous calendar day only (v1).'],
    });
  }

  const orderGrowth = summary.comparison.orderGrowthPct;
  const aovGrowth = summary.comparison.aovGrowthPct;
  if (
    Math.abs(orderGrowth) >= VOLUME_AOV_MOVE_PCT &&
    Math.abs(aovGrowth) >= VOLUME_AOV_MOVE_PCT &&
    Math.sign(orderGrowth) !== Math.sign(aovGrowth) &&
    summary.comparison.previousOrders > 0
  ) {
    signals.push({
      signalId: makeSignalId('volume_aov_divergence', context.restaurantId, date),
      code: 'volume_aov_divergence',
      category: 'sales',
      source: 'sales_context',
      statement: `Orders moved ${pct(orderGrowth)}% while average order value moved ${pct(aovGrowth)}% on ${date} — volume and ticket size diverged.`,
      value: summary.summary.orders,
      baseline: summary.comparison.previousOrders,
      changePct: orderGrowth / 100,
      direction: orderGrowth > 0 ? 'up' : 'down',
      confidence: sampleConfidence,
      sampleSize: summary.summary.orders,
      scope: s,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        { kind: 'ratio', ref: 'salesReport.summary.orderGrowthPct', value: orderGrowth, observedAt: gen },
        { kind: 'ratio', ref: 'salesReport.summary.aovGrowthPct', value: aovGrowth, observedAt: gen },
      ],
      caveats: ['Baseline is the previous calendar day only (v1).'],
    });
  }

  const gross = summary.summary.grossSales;
  if (gross > 0 && summary.summary.discounts / gross >= DISCOUNT_PRESSURE_RATIO) {
    const ratio = Math.round((summary.summary.discounts / gross) * 1000) / 10;
    signals.push({
      signalId: makeSignalId('discount_pressure', context.restaurantId, date),
      code: 'discount_pressure',
      category: 'sales',
      source: 'sales_context',
      statement: `Discounts were ${ratio}% of gross sales on ${date} (${summary.summary.discounts} of ${gross}).`,
      value: summary.summary.discounts,
      unit: 'currency',
      direction: 'up',
      confidence: sampleConfidence,
      sampleSize: summary.summary.orders,
      scope: s,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        { kind: 'metric', ref: 'salesReport.summary.discounts', value: summary.summary.discounts, observedAt: gen },
        { kind: 'metric', ref: 'salesReport.summary.grossSales', value: gross, observedAt: gen },
      ],
    });
  }

  const net = summary.summary.netSales;
  if (net > 0 && summary.status.refundAmount / net >= REFUND_SPIKE_RATIO) {
    const ratio = Math.round((summary.status.refundAmount / net) * 1000) / 10;
    signals.push({
      signalId: makeSignalId('refund_spike', context.restaurantId, date),
      code: 'refund_spike',
      category: 'sales',
      source: 'sales_context',
      statement: `Refunds on ${date} were ${ratio}% of net sales (${summary.status.refundAmount} across ${summary.status.refunded} refund(s)).`,
      value: summary.status.refundAmount,
      unit: 'currency',
      direction: 'up',
      confidence: sampleConfidence,
      sampleSize: summary.summary.orders,
      scope: s,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        { kind: 'metric', ref: 'salesReport.summary.refundAmount', value: summary.status.refundAmount, observedAt: gen },
        { kind: 'count', ref: 'salesReport.summary.refunded', value: summary.status.refunded, observedAt: gen },
      ],
    });
  }

  return signals;
}

/**
 * Weekday-aware baseline signal (deterministic, additive to the previous-day
 * growth signal). Fires only when there is a comparable same-weekday history
 * (≥ 2 prior same weekdays, non-zero baseline, non-zero day) AND the movement
 * clears the threshold — otherwise the batch caveat discloses what the
 * baseline could not be computed from. Exported as a pure mapper so the
 * gating and wording are unit-testable without Mongo or the real clock.
 */
export function signalFromWeekdayBaseline(
  summary: SummaryShape,
  wc: ZReportWeekdayBaseline,
  context: ZReportContext,
): BusinessSignal | null {
  const net = summary.summary.netSales;
  const base = wc.sameWeekday.avgRevenue;
  if (wc.sameWeekday.days < MIN_SAME_WEEKDAY_DAYS || base <= 0 || net <= 0) return null;
  const changePct = Math.round(((net - base) / base) * 1000) / 10;
  if (Math.abs(changePct) < WEEKDAY_MOVE_PCT) return null;
  const up = changePct > 0;
  const gen = new Date().toISOString();
  return {
    signalId: makeSignalId('sales_weekday_baseline', context.restaurantId, context.businessDate),
    code: 'sales_weekday_baseline',
    category: 'sales',
    source: 'sales_context',
    statement: `Net revenue on ${context.businessDate} (${net}) was ${pct(Math.abs(changePct))}% ${up ? 'above' : 'below'} the average of the previous ${wc.sameWeekday.days} ${wc.weekday}s (${base}); the trailing 7-day average was ${wc.trailing7.avgRevenue}.`,
    value: net,
    baseline: base,
    changePct: changePct / 100,
    direction: up ? 'up' : 'down',
    confidence: summary.summary.orders >= LOW_SAMPLE_ORDERS ? 0.85 : 0.6,
    sampleSize: summary.summary.orders,
    scope: scopeOfContext(context),
    freshness: 'fresh',
    generatedAt: gen,
    evidence: [
      { kind: 'metric', ref: 'salesReport.trend.businessDateNet', value: net, observedAt: gen },
      { kind: 'metric', ref: 'salesReport.trend.sameWeekdayAvg', value: base, observedAt: gen },
      { kind: 'metric', ref: 'salesReport.trend.trailing7Avg', value: wc.trailing7.avgRevenue, observedAt: gen },
    ],
    caveats: [`Same-weekday baseline averages ${wc.sameWeekday.days} prior ${wc.weekday}s only; trailing 7-day coverage is ${wc.trailing7.daysFound}/7.`],
  };
}

/**
 * Deterministic anomaly mapping (only into EXISTING canonical codes).
 * Exported as a pure mapper so the mapping table and the unmapped-TIME_SLOT
 * disclosure are unit-testable without depending on the anomaly service's
 * real-clock baseline windows.
 */
export function signalFromAnomaly(a: Awaited<ReturnType<typeof detectAllDemandAnomalies>>[number], context: ZReportContext): BusinessSignal | null {
  const codeMap: Record<string, BusinessSignal['code']> = {
    REVENUE_DROP: 'sales_decline',
    REVENUE_SURGE: 'sales_growth',
    ORDERS_DROP: 'sales_decline',
    ORDERS_SURGE: 'sales_growth',
    PRODUCT_DEMAND_DECLINED: 'product_declining',
    PRODUCT_DEMAND_INCREASED: 'product_growing',
    CATEGORY_UNDERPERFORMING: 'sales_category_weak',
    CATEGORY_OVERPERFORMING: 'sales_category_strong',
    // TIME_SLOT_* intentionally unmapped in v1 (no canonical slot code); disclosed as unmapped.
  };
  const code = codeMap[a.type];
  if (!code) return null;
  const up = a.percentageChange > 0;
  const gen = new Date().toISOString();
  const subjectType = a.entityType === 'restaurant' || a.entityType === 'time_slot' ? undefined : a.entityType;
  return {
    signalId: makeSignalId(code, context.restaurantId, a.entityId ?? a.entityName ?? a.type),
    code,
    category: code.startsWith('product_') ? 'product' : 'sales',
    source: 'sales_context',
    statement: a.evidence[0]?.description ?? `${a.entityName ?? a.type} moved ${pct(a.percentageChange)}% vs baseline (${a.baselineValue} → ${a.currentValue}).`,
    value: a.currentValue,
    baseline: a.baselineValue,
    changePct: a.percentageChange / 100,
    direction: up ? 'up' : 'down',
    confidence: a.confidence,
    sampleSize: a.sampleSize,
    scope: scopeOfContext(context),
    freshness: 'fresh',
    generatedAt: gen,
    ...(subjectType
      ? { subject: { type: subjectType, id: a.entityId ?? a.entityName ?? 'unknown', label: a.entityName } }
      : {}),
    evidence: [
      { kind: 'metric', ref: `demandAnomaly.${a.type}`, value: a.currentValue, observedAt: a.detectedAt.toISOString() },
      { kind: 'metric', ref: `demandAnomaly.${a.type}.baseline`, value: a.baselineValue, observedAt: a.detectedAt.toISOString() },
    ],
    caveats: ['Derived by the deterministic demand-anomaly service (MAD z-score baseline).'],
  };
}

async function runBatch2(
  context: ZReportContext,
): Promise<{ result: ZReportBatchResult; summaryGrowthPct?: number }> {
  const startedAt = Date.now();
  const signals: BusinessSignal[] = [];
  const toolErrors: ZReportBatchResult['toolErrors'] = [];
  const unavailable: string[] = [];
  let unmappedAnomalies = 0;

  const [summary, anomalies, trend] = await Promise.all([
    salesReportService
      .summary({
        restaurantId: context.restaurantId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        startDate: context.businessDate,
        endDate: context.businessDate,
      })
      .catch((err: unknown): SummaryShape | null => {
        toolErrors.push({ tool: 'salesReportService.summary', code: 'TOOL_FAILED', message: err instanceof Error ? err.message.slice(0, 200) : String(err) });
        return null;
      }),
    detectAllDemandAnomalies({
      restaurantId: context.restaurantId,
      ...(context.branchId ? { branchId: context.branchId } : {}),
      lookbackDays: 30,
    }).catch((err: unknown): Awaited<ReturnType<typeof detectAllDemandAnomalies>> => {
      toolErrors.push({ tool: 'demandAnomalyService.detectAllDemandAnomalies', code: 'TOOL_FAILED', message: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      return [];
    }),
    // Weekday-aware rolling baseline read — ONE existing trend call over the
    // already-computed comparison windows ([monthStartDate, weekEndDate] =
    // businessDate−30 … businessDate−1). No new aggregation path, no new date
    // math; the window is reused from zReportContext.comparisonWindows.
    salesReportService
      .trend({
        restaurantId: context.restaurantId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        startDate: context.comparison.monthStartDate,
        endDate: context.comparison.weekEndDate,
      })
      .catch((err: unknown): Awaited<ReturnType<typeof salesReportService.trend>> => {
        toolErrors.push({ tool: 'salesReportService.trend', code: 'TOOL_FAILED', message: err instanceof Error ? err.message.slice(0, 200) : String(err) });
        return [];
      }),
  ]);

  // The deterministic summary's own growth figure is the Batch-3 trigger
  // input: reading it back out of the signal list would let an anomaly-derived
  // growth signal (a rolling-baseline percentage) decide the gating.
  let summaryGrowthPct: number | undefined;
  if (summary) {
    signals.push(...signalsFromSummary(summary, context));
    if (summary.comparison.previousNetRevenue > 0) summaryGrowthPct = summary.comparison.revenueGrowthPct;
  } else {
    unavailable.push('sales_context');
  }

  // Weekday-aware rolling baseline (additive to the previous-day baseline).
  // Requires BOTH reads: the business-date net comes from the deterministic
  // summary, the series from the trend read — one missing side discloses.
  let weekdayDays = 0;
  let weekdayCoverage = 0;
  if (summary && trend) {
    // trend() is typed as hourly (single-day) OR daily (multi-day) rows; this
    // window is always multi-day. Select the daily rows and normalize them to
    // ZReportTrendDayRow explicitly — no type predicate, since the service's
    // daily rows carry extra fields a predicate type could not be assignable to.
    const series: ZReportTrendDayRow[] = [];
    for (const r of trend) {
      if ('date' in r) series.push({ date: String(r.date), revenue: Number(r.revenue), orders: Number(r.orders) });
    }
    const wc = weekdayBaseline(series, context.businessDate);
    weekdayDays = wc.sameWeekday.days;
    weekdayCoverage = wc.trailing7.daysFound;
    const weekdaySignal = signalFromWeekdayBaseline(summary, wc, context);
    if (weekdaySignal) signals.push(weekdaySignal);
  }
  if (!trend) unavailable.push('weekday_baseline');
  for (const a of anomalies) {
    const sig = signalFromAnomaly(a, context);
    if (sig) signals.push(sig);
    else unmappedAnomalies += 1;
  }
  if (!anomalies.length && !toolErrors.some((e) => e.tool.startsWith('demandAnomaly'))) {
    unavailable.push('demand_anomaly');
  }

  const caveats: string[] = [];
  if (!trend) {
    caveats.push('Baseline is the previous calendar day (previous-period v1); the weekday trend read failed.');
  } else if (weekdayDays >= MIN_SAME_WEEKDAY_DAYS) {
    caveats.push(`Baselines: previous calendar day (previous-period v1) plus same weekday (last ${weekdayDays} week(s)) and the trailing 7-day average (${weekdayCoverage}/7 day coverage).`);
  } else {
    caveats.push(`Baseline is the previous calendar day (previous-period v1); insufficient history for a weekday baseline (${weekdayDays} prior same-weekday day(s), 2+ needed).`);
  }
  if (unmappedAnomalies > 0) {
    caveats.push(`${unmappedAnomalies} time-slot anomaly(ies) had no canonical mapping in v1 and were disclosed, not reshaped.`);
  }

  return {
    result: {
      batch: 2,
      signals,
      toolErrors,
      unavailable,
      caveats,
      durationMs: Date.now() - startedAt,
    },
    ...(summaryGrowthPct !== undefined ? { summaryGrowthPct } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 gating (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

const BATCH3_REVENUE_MOVE_PCT = 25;

function batch3Justification(batch1: ZReportBatchResult, batch2: ZReportBatchResult, summaryGrowth?: number): string[] {
  const reasons: string[] = [];
  if (summaryGrowth !== undefined && Math.abs(summaryGrowth) >= BATCH3_REVENUE_MOVE_PCT) {
    reasons.push(`day-over-day revenue moved ${pct(Math.abs(summaryGrowth))}% (≥ ${BATCH3_REVENUE_MOVE_PCT}%)`);
  }
  if (batch1.signals.some((s) => s.code === 'inventory_wastage_spike' || s.code === 'inventory_wastage')) {
    reasons.push('wastage signals present — forecast/context cross-check may explain demand or prep mismatch');
  }
  if (batch2.signals.some((s) => s.code === 'sales_decline')) reasons.push('sales decline — ML forecast comparison may separate trend from one-off');
  if (batch2.signals.some((s) => s.code === 'sales_weekday_baseline')) reasons.push('revenue moved ≥ 10% vs the same-weekday baseline — forecast/context cross-check may separate weekday rhythm from a real shift');
  if (batch2.signals.some((s) => s.code === 'volume_aov_divergence')) reasons.push('volume/AOV divergence — basket and segment context may locate the shift');
  return reasons;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function fromInvestigation(
  inv: BusinessInvestigation,
  batch: 1 | 3,
  durationMs: number,
  caveats: string[] = [],
): ZReportBatchResult {
  // Normalizer identities (not dimension names) — one dimension can host
  // several normalizers, and the disclosure must name which read produced
  // nothing usable.
  const unavailable = [
    ...new Set(inv.dimensions.filter((d) => d.signalCount === 0).map((d) => d.normalizer)),
  ];
  // Normalizer-supplied caveats (model version, rolling window, …) are
  // disclosures, never dropped: they explain what the evidence does NOT cover.
  const normalizerCaveats = [...new Set(inv.dimensions.flatMap((d) => d.caveats))];
  return {
    batch,
    signals: inv.signals,
    toolErrors: inv.toolErrors.map((e) => ({ tool: e.tool, code: e.code, message: e.message })),
    unavailable,
    caveats: [...caveats, ...normalizerCaveats].slice(0, 12),
    durationMs,
  };
}

/**
 * Collect the full evidence set for one business date. Never throws for data
 * conditions; only invalid tenant identity propagates (programming/security
 * error, consistent with investigateBusiness).
 */
export async function collectZReportEvidence(opts: CollectEvidenceOptions): Promise<ZReportEvidence> {
  const { context, tenant } = opts;
  const startedAt = Date.now();
  const input: NormalizerInput = {
    restaurantId: context.restaurantId,
    branchId: context.branchId ?? null,
    lookbackDays: 30,
  };

  // ── Batch 1: canonical plan entries + the wastage dimension ───────────────
  const canonical = defaultDimensionPlan(input, opts.batch1BudgetMs ?? 12_000);
  const wastage = wastagePlanStep(input, 4_000);
  // Deterministic order (canonical core first, wastage last);
  // investigateBusiness re-orders results to plan order, so this defines output sequence.
  const batch1Plan = [...reorder(canonical, BATCH1_TOOL_ORDER), wastage];
  const t1 = Date.now();
  const inv1 = await investigateBusiness({
    tenant,
    ...(context.branchId ? { branchId: context.branchId } : {}),
    plan: batch1Plan,
    budgetMs: opts.batch1BudgetMs ?? 12_000,
    lookbackDays: 30,
    ...(opts.executionId ? { executionId: opts.executionId } : {}),
  });
  const batch1 = fromInvestigation(inv1, 1, Date.now() - t1);

  // Closing-day facts are normalized here too (deterministic figures the
  // orchestrator fetched via the existing closingReportService). They are
  // folded into Batch 1: they ARE core closing-day facts.
  if (opts.closing) {
    const closingResult = normalizeCashClosing(opts.closing, input);
    batch1.signals.push(...closingResult.signals);
    batch1.caveats.push(...closingResult.caveats);
    if (closingResult.status !== 'ok') {
      batch1.toolErrors.push({
        tool: 'closingReportService.zReport',
        code: 'CLOSING_UNAVAILABLE',
        message: closingResult.reason ?? 'closing normalization unavailable',
      });
    }
  } else {
    // Absent, not failed: the caller did not pass the deterministic closing
    // report. Disclosed explicitly so the report never implies drawer facts.
    batch1.unavailable.push('cash_ledger');
    batch1.toolErrors.push({
      tool: 'closingReportService.zReport',
      code: 'NO_CLOSING_REPORT',
      message: 'no deterministic closing report was supplied for this business date',
    });
  }

  // ── Batch 2: deterministic derived intelligence ───────────────────────────
  const { result: batch2, summaryGrowthPct } = await runBatch2(context);

  // ── Batch 3: conditional ─────────────────────────────────────────────────
  const justifications = batch3Justification(batch1, batch2, summaryGrowthPct);
  const want3 = opts.includeBatch3 === true || (opts.includeBatch3 !== false && justifications.length > 0);
  let batch3: ZReportBatchResult | null = null;
  const batch3Reason = want3
    ? justifications.length > 0
      ? `triggered: ${justifications.join('; ')}`
      : 'forced by caller'
    : opts.includeBatch3 === false
      ? 'skipped by caller'
      : 'not triggered (no notable movement)';
  if (want3) {
    const t3 = Date.now();
    const inv3 = await investigateBusiness({
      tenant,
      ...(context.branchId ? { branchId: context.branchId } : {}),
      plan: reorder(defaultDimensionPlan(input, opts.batch3BudgetMs ?? 8_000), BATCH3_TOOL_ORDER),
      budgetMs: opts.batch3BudgetMs ?? 8_000,
      lookbackDays: 30,
      ...(opts.executionId ? { executionId: opts.executionId } : {}),
    });
    batch3 = fromInvestigation(inv3, 3, Date.now() - t3);
  }

  // Batch-level disclosures stay on their batch (provenance); the evidence-level
  // list carries only run-wide statements. mergeEvidence() surfaces both.
  const caveats = opts.closing ? [] : ['Closing-day cash/sales facts were not available for this run.'];

  return {
    restaurantId: context.restaurantId,
    ...(context.branchId ? { branchId: context.branchId } : {}),
    businessDate: context.businessDate,
    batch1,
    batch2,
    batch3,
    followUp: null,
    batch3Reason,
    caveats,
    generatedAt: new Date(startedAt).toISOString(),
  };
}
