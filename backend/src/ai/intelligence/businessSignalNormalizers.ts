/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * businessSignalNormalizers.ts — PHASE 3 normalization layer.
 *
 * One pure function per business dimension. Each takes ALREADY-FETCHED tool
 * output (the authoritative read path stays `toolExecutor` + the existing
 * services behind each tool) and returns a `SignalNormalizationResult`.
 *
 * Rules:
 *   - No database access, no service calls: normalizers only reshape data the
 *     caller already fetched through the shared tool registry.
 *   - Never invent numbers: a signal is emitted only when the source exposes
 *     the metric; otherwise the result is `unavailable` with a reason.
 *   - `available:false` tool outputs become `unavailable`, never zeroes.
 *   - Confidence comes from the source when present, else from sample size,
 *     and is always clamped to [0,1].
 *   - Every signal carries tenant+branch scope, freshness and evidence refs.
 *   - Field names mirror the EXISTING tool output interfaces exactly
 *     (verified against ai/tools/**).
 */

import {
  type BusinessSignal,
  type BusinessSignalSource,
  type SignalEvidenceRef,
  type SignalFreshness,
  type SignalNormalizationResult,
  type SignalScope,
  classifyFreshness,
  clamp01,
  directionFromChange,
  makeSignalId,
} from './businessSignalTypes';

/** Shared inputs every normalizer receives. */
export interface NormalizerInput {
  restaurantId: string;
  branchId?: string | null;
  /** Period the tool was asked for (used for freshness windows). */
  lookbackDays?: number;
  now?: number;
}

function scopeOf(input: NormalizerInput): SignalScope {
  return {
    restaurantId: input.restaurantId,
    branchId: input.branchId ?? null,
    scope: input.branchId ? 'branch' : 'tenant',
  };
}

function result(
  normalizer: BusinessSignalSource,
  status: SignalNormalizationResult['status'],
  signals: BusinessSignal[],
  extra?: { reason?: string; caveats?: string[]; now?: number },
): SignalNormalizationResult {
  return {
    status,
    normalizer,
    signals,
    reason: extra?.reason,
    caveats: extra?.caveats ?? [],
    generatedAt: new Date(extra?.now ?? Date.now()).toISOString(),
  };
}

const unavailable = (n: BusinessSignalSource, reason: string, now?: number) =>
  result(n, 'unavailable', [], { reason, now });

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Normalize a SOURCE timestamp to a valid ISO string, or '' when the source
 * did not provide one (D-22).
 *
 * A missing/malformed source timestamp MUST stay unknown: substituting `now`
 * would fabricate freshness (an old snapshot would look current) and corrupt
 * the evidence semantics downstream. Empty string keeps the zod contract
 * (`generatedAt: z.string()`) while `classifyFreshness('')` correctly yields
 * `'unknown'`.
 */
function isoOr(raw: unknown, _now: number): string {
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) return raw;
  return '';
}

function ev(
  kind: SignalEvidenceRef['kind'],
  ref: string,
  value?: number,
  extra?: Partial<SignalEvidenceRef>,
): SignalEvidenceRef {
  return { kind, ref, value, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Sales  (tool: getSalesTrends → GetSalesTrendsOutput)
// ─────────────────────────────────────────────────────────────────────────────

export interface SalesTrendsLike {
  available: boolean;
  reason?: string;
  scope?: 'tenant' | 'branch';
  dailyRevenue?: number;
  weeklyRevenue?: number;
  monthlyRevenue?: number;
  orderCount?: number;
  averageOrderValue?: number;
  topCategories?: Array<{ name: string; revenue: number; qty: number }>;
  weakCategories?: Array<{ name: string; revenue: number; qty: number }>;
  weekdayPerformance?: number[];
  hourlyPerformance?: number[];
  generatedAt?: string;
}

/** Expected window for a sales snapshot (a rolling recent period). */
const SALES_WINDOW_DAYS = 7;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function normalizeSalesTrends(
  raw: SalesTrendsLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'sales_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available) return unavailable(N, raw.reason || 'NO_SALES_DATA', now);

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness: SignalFreshness = classifyFreshness(raw.generatedAt ? gen : undefined, SALES_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];
  // Unknown source timestamp → no fabricated period window. (D-22)
  const periodEnd = gen || undefined;
  const periodStart = gen
    ? new Date(Date.parse(gen) - (input.lookbackDays ?? 30) * 86400000).toISOString()
    : undefined;

  const push = (
    s: Omit<BusinessSignal, 'signalId' | 'scope' | 'freshness' | 'generatedAt' | 'periodStart' | 'periodEnd'> & {
      signalId?: string;
    },
  ) => {
    signals.push({
      ...s,
      signalId: s.signalId ?? makeSignalId(s.code, input.restaurantId, s.subject?.id),
      scope,
      freshness,
      generatedAt: gen,
      periodStart,
      periodEnd,
    });
  };

  const aov = num(raw.averageOrderValue);
  const daily = num(raw.dailyRevenue);
  const orders = num(raw.orderCount);
  const genEvidence = ev('tool_output', 'tool:getSalesTrends', daily, { observedAt: gen });

  if (daily !== undefined) {
    push({
      code: 'sales_revenue_level',
      category: 'sales',
      source: N,
      statement: `Recent daily revenue averages ${daily} across ${orders ?? 'an unknown number of'} orders in the tool's lookback window.`,
      value: daily,
      unit: 'currency/day',
      direction: 'unknown',
      confidence: clamp01(orders && orders > 0 ? 0.8 : 0.5),
      sampleSize: orders,
      evidence: [genEvidence],
    });
  }
  if (aov !== undefined) {
    push({
      code: 'sales_aov_level',
      category: 'sales',
      source: N,
      statement: `Average order value is ${aov}.`,
      value: aov,
      unit: 'currency/order',
      direction: 'unknown',
      confidence: clamp01(orders && orders > 0 ? 0.8 : 0.5),
      sampleSize: orders,
      evidence: [ev('metric', 'metric:aov', aov, { observedAt: gen })],
    });
  }

  const weekdays = Array.isArray(raw.weekdayPerformance) ? raw.weekdayPerformance : undefined;
  if (weekdays && weekdays.length === 7 && weekdays.some((v) => Number.isFinite(v) && v > 0)) {
    const max = Math.max(...weekdays);
    const min = Math.min(...weekdays);
    const maxDay = weekdays.indexOf(max);
    const minDay = weekdays.indexOf(min);
    if (max > 0) {
      push({
        code: 'sales_weekday_peak',
        category: 'sales',
        source: N,
        statement: `${DAY_NAMES[maxDay]} is the strongest weekday by revenue (${max}).`,
        value: max,
        direction: 'up',
        confidence: 0.7,
        evidence: [ev('metric', `metric:weekday:${maxDay}`, max, { observedAt: gen })],
        subject: { type: 'time_slot', id: `weekday:${maxDay}`, label: DAY_NAMES[maxDay] },
      });
    }
    if (min >= 0 && min < max) {
      push({
        code: 'sales_weekday_trough',
        category: 'sales',
        source: N,
        statement: `${DAY_NAMES[minDay]} is the weakest weekday by revenue (${min}).`,
        value: min,
        direction: 'down',
        confidence: 0.7,
        evidence: [ev('metric', `metric:weekday:${minDay}`, min, { observedAt: gen })],
        subject: { type: 'time_slot', id: `weekday:${minDay}`, label: DAY_NAMES[minDay] },
      });
    }
  }

  const hourly = Array.isArray(raw.hourlyPerformance) ? raw.hourlyPerformance : undefined;
  if (hourly && hourly.length === 24 && hourly.some((v) => Number.isFinite(v) && v > 0)) {
    const max = Math.max(...hourly);
    const min = Math.min(...hourly);
    const maxHour = hourly.indexOf(max);
    const minHour = hourly.indexOf(min);
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
    push({
      code: 'sales_hour_peak',
      category: 'sales',
      source: N,
      statement: `Peak revenue hour is ${hh(maxHour)} (${max}).`,
      value: max,
      direction: 'up',
      confidence: 0.65,
      evidence: [ev('metric', `metric:hour:${maxHour}`, max, { observedAt: gen })],
      subject: { type: 'time_slot', id: `hour:${maxHour}`, label: hh(maxHour) },
    });
    if (min >= 0 && min < max) {
      push({
        code: 'sales_hour_trough',
        category: 'sales',
        source: N,
        statement: `Weakest revenue hour is ${hh(minHour)} (${min}).`,
        value: min,
        direction: 'down',
        confidence: 0.6,
        evidence: [ev('metric', `metric:hour:${minHour}`, min, { observedAt: gen })],
        subject: { type: 'time_slot', id: `hour:${minHour}`, label: hh(minHour) },
      });
    }
  }

  for (const c of raw.topCategories ?? []) {
    push({
      code: 'sales_category_strong',
      category: 'sales',
      source: N,
      statement: `Category "${c.name}" is a top revenue contributor (${c.revenue} from ${c.qty} units).`,
      value: c.revenue,
      unit: 'currency',
      direction: 'up',
      confidence: 0.7,
      sampleSize: c.qty,
      evidence: [ev('metric', `metric:category:${c.name}:revenue`, c.revenue, { observedAt: gen })],
      subject: { type: 'category', id: c.name, label: c.name },
    });
  }
  for (const c of raw.weakCategories ?? []) {
    push({
      code: 'sales_category_weak',
      category: 'sales',
      source: N,
      statement: `Category "${c.name}" is a weak revenue contributor (${c.revenue} from ${c.qty} units).`,
      value: c.revenue,
      unit: 'currency',
      direction: 'down',
      confidence: 0.65,
      sampleSize: c.qty,
      evidence: [ev('metric', `metric:category:${c.name}:revenue`, c.revenue, { observedAt: gen })],
      subject: { type: 'category', id: c.name, label: c.name },
    });
  }

  return result(N, 'ok', signals, {
    now,
    caveats: [
      'Sales snapshot is aggregated by the existing sales context service; signals describe facts, they never recommend.',
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Menu / product performance  (tool: getMenuPerformance)
// ─────────────────────────────────────────────────────────────────────────────

export interface MenuPerformanceLike {
  available: boolean;
  reason?: string;
  items?: Array<{
    productId: string;
    productName: string;
    category: string;
    classification: string;
    contributionMarginPercent: number;
    dailyUnits: number;
    dailyRevenue: number;
    trend: string;
    recommendedActions: string[];
  }>;
  generatedAt?: string;
}

const MENU_WINDOW_DAYS = 14;

/** Explicit, reproducible thresholds (documented, never arbitrary). */
const HIGH_MARGIN_PCT = 60;
const LOW_MARGIN_PCT = 30;
const HIGH_DEMAND_UNITS_PER_DAY = 20;
const SLOW_MOVING_UNITS_PER_DAY = 3;

/** Map menu-engineering classification → canonical product signals. */
export function normalizeMenuPerformance(
  raw: MenuPerformanceLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'menu_engineering';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.items || raw.items.length === 0) {
    return unavailable(N, raw.reason || 'NO_MENU_PERFORMANCE_DATA', now);
  }

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, MENU_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const item of raw.items) {
    const marginPct = num(item.contributionMarginPercent);
    const units = num(item.dailyUnits);
    const trend = String(item.trend || '').toLowerCase();
    const cls = String(item.classification || '').toLowerCase();
    const subject = { type: 'product' as const, id: item.productId, label: item.productName };
    const base = {
      category: 'product' as const,
      source: N,
      scope,
      freshness,
      generatedAt: gen,
      subject,
    };

    if (marginPct !== undefined && marginPct >= HIGH_MARGIN_PCT) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_high_margin', input.restaurantId, item.productId),
        code: 'product_high_margin',
        statement: `"${item.productName}" has a high contribution margin (${marginPct.toFixed(1)}%).`,
        value: marginPct,
        unit: '%',
        direction: 'up',
        confidence: 0.75,
        sampleSize: units,
        evidence: [ev('metric', `metric:product:${item.productId}:marginPct`, marginPct, { observedAt: gen })],
      });
    } else if (marginPct !== undefined && marginPct < LOW_MARGIN_PCT) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_low_margin', input.restaurantId, item.productId),
        code: 'product_low_margin',
        statement: `"${item.productName}" has a low contribution margin (${marginPct.toFixed(1)}%).`,
        value: marginPct,
        unit: '%',
        direction: 'down',
        confidence: 0.7,
        sampleSize: units,
        evidence: [ev('metric', `metric:product:${item.productId}:marginPct`, marginPct, { observedAt: gen })],
      });
    }

    if (units !== undefined && (cls.includes('star') || units >= HIGH_DEMAND_UNITS_PER_DAY)) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_high_demand', input.restaurantId, item.productId),
        code: 'product_high_demand',
        statement: `"${item.productName}" sells strongly (${units} units/day, classification "${item.classification}").`,
        value: units,
        unit: 'units/day',
        direction: 'up',
        confidence: 0.75,
        sampleSize: units,
        evidence: [ev('metric', `metric:product:${item.productId}:dailyUnits`, units, { observedAt: gen })],
      });
    }
    if (units !== undefined && (cls.includes('dog') || cls.includes('slow') || units < SLOW_MOVING_UNITS_PER_DAY)) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_slow_moving', input.restaurantId, item.productId),
        code: 'product_slow_moving',
        statement: `"${item.productName}" moves slowly (${units} units/day, classification "${item.classification}").`,
        value: units,
        unit: 'units/day',
        direction: 'down',
        confidence: 0.65,
        sampleSize: units,
        evidence: [ev('metric', `metric:product:${item.productId}:dailyUnits`, units, { observedAt: gen })],
      });
    }
    if (trend.includes('declin') || trend.includes('down')) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_declining', input.restaurantId, item.productId),
        code: 'product_declining',
        statement: `"${item.productName}" is trending down ("${item.trend}").`,
        direction: 'down',
        confidence: 0.6,
        sampleSize: units,
        evidence: [ev('tool_output', `tool:getMenuPerformance:${item.productId}:trend`, undefined, { observedAt: gen, label: item.trend })],
      });
    } else if (trend.includes('grow') || trend.includes('up')) {
      signals.push({
        ...base,
        signalId: makeSignalId('product_growing', input.restaurantId, item.productId),
        code: 'product_growing',
        statement: `"${item.productName}" is trending up ("${item.trend}").`,
        direction: 'up',
        confidence: 0.6,
        sampleSize: units,
        evidence: [ev('tool_output', `tool:getMenuPerformance:${item.productId}:trend`, undefined, { observedAt: gen, label: item.trend })],
      });
    }
  }

  if (signals.length === 0) return unavailable(N, 'NO_ACTIONABLE_MENU_ITEMS', now);
  return result(N, 'ok', signals, {
    now,
    caveats: [
      'Product signals reflect menu-engineering output for the requested lookback window; classifications come from the existing service.',
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Margins  (tool: getProductMargins → cost intelligence)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductMarginsLike {
  available: boolean;
  reason?: string;
  products?: Array<{
    productId: string;
    productName: string;
    category?: string;
    sellingPrice: number;
    recipeCost: number;
    foodCostPercent: number;
    contributionMarginPercent: number;
    unitsSold: number;
    totalContribution: number;
  }>;
  generatedAt?: string;
}

const MARGIN_WINDOW_DAYS = 30;

/**
 * Margin normalizer — emits margin-level signals from cost intelligence.
 * IMPORTANT: these are DESCRIPTIVE facts about current margin. The agent must
 * never compute discount safety from them: discount authorization stays with
 * the existing offer engine / business constraints.
 */
export function normalizeProductMargins(
  raw: ProductMarginsLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'cost_intelligence';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.products || raw.products.length === 0) {
    return unavailable(N, raw.reason || 'NO_MARGIN_DATA', now);
  }

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, MARGIN_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const p of raw.products) {
    const marginPct = num(p.contributionMarginPercent);
    const units = num(p.unitsSold);
    const foodCost = num(p.foodCostPercent);
    if (marginPct === undefined) continue;
    const subject = { type: 'product' as const, id: p.productId, label: p.productName };
    const evidence = [
      ev('metric', `metric:product:${p.productId}:contributionMarginPct`, marginPct, { observedAt: gen }),
      ev('metric', `metric:product:${p.productId}:foodCostPct`, foodCost, { observedAt: gen }),
    ];
    if (marginPct >= HIGH_MARGIN_PCT) {
      signals.push({
        signalId: makeSignalId('product_high_margin', input.restaurantId, p.productId),
        code: 'product_high_margin',
        category: 'margin',
        source: N,
        statement: `"${p.productName}" carries a ${marginPct.toFixed(1)}% contribution margin on ${units ?? 'an unknown number of'} units sold.`,
        value: marginPct,
        unit: '%',
        direction: 'up',
        confidence: 0.75,
        sampleSize: units,
        scope,
        freshness,
        generatedAt: gen,
        subject,
        evidence,
      });
    } else if (marginPct < LOW_MARGIN_PCT) {
      signals.push({
        signalId: makeSignalId('product_low_margin', input.restaurantId, p.productId),
        code: 'product_low_margin',
        category: 'margin',
        source: N,
        statement: `"${p.productName}" carries only a ${marginPct.toFixed(1)}% contribution margin (food cost ${foodCost?.toFixed(1) ?? 'unknown'}%).`,
        value: marginPct,
        unit: '%',
        direction: 'down',
        confidence: 0.7,
        sampleSize: units,
        scope,
        freshness,
        generatedAt: gen,
        subject,
        evidence,
      });
    }
  }

  if (signals.length === 0) return unavailable(N, 'NO_MARGIN_EXTREMES', now);
  return result(N, 'ok', signals, {
    now,
    caveats: [
      'Margin figures come from cost intelligence. Discount safety and pricing authorization remain with the offer engine — the agent never computes them.',
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Inventory  (tools: getInventoryStatus / getExpiryRisk / getStockoutRisk)
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryStatusLike {
  available: boolean;
  reason?: string;
  items?: Array<{
    id: string;
    name: string;
    category: string;
    currentStock: number;
    minStock: number;
    maxStock: number;
    unit: string;
    price: number;
    averageCost: number;
  }>;
  generatedAt?: string;
}

const INVENTORY_WINDOW_DAYS = 3;

export function normalizeInventoryStatus(
  raw: InventoryStatusLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'inventory_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.items || raw.items.length === 0) {
    return unavailable(N, raw.reason || 'NO_INVENTORY_DATA', now);
  }

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, INVENTORY_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const item of raw.items) {
    const stock = num(item.currentStock);
    const min = num(item.minStock);
    const max = num(item.maxStock);
    if (stock === undefined) continue;
    const subject = { type: 'ingredient' as const, id: item.id, label: item.name };
    const base = { category: 'inventory' as const, source: N, scope, freshness, generatedAt: gen, subject };

    if (min !== undefined && min > 0 && stock <= min) {
      signals.push({
        ...base,
        signalId: makeSignalId('inventory_low', input.restaurantId, item.id),
        code: 'inventory_low',
        statement: `"${item.name}" stock (${stock} ${item.unit}) is at or below its minimum (${min} ${item.unit}).`,
        value: stock,
        unit: item.unit,
        baseline: min,
        direction: 'down',
        confidence: 0.8,
        evidence: [
          ev('metric', `metric:inventory:${item.id}:stock`, stock, { observedAt: gen }),
          ev('metric', `metric:inventory:${item.id}:min`, min, { observedAt: gen }),
        ],
      });
    }
    if (max !== undefined && max > 0 && stock >= max) {
      signals.push({
        ...base,
        signalId: makeSignalId('inventory_overstock', input.restaurantId, item.id),
        code: 'inventory_overstock',
        statement: `"${item.name}" is overstocked (${stock} ${item.unit} vs max ${max} ${item.unit}).`,
        value: stock,
        unit: item.unit,
        baseline: max,
        direction: 'up',
        confidence: 0.7,
        evidence: [
          ev('metric', `metric:inventory:${item.id}:stock`, stock, { observedAt: gen }),
          ev('metric', `metric:inventory:${item.id}:max`, max, { observedAt: gen }),
        ],
      });
    }
  }

  if (signals.length === 0) return unavailable(N, 'NO_INVENTORY_EXTREMES', now);
  return result(N, 'ok', signals, { now });
}

/** getExpiryRisk → ExpiryRiskOutput.alerts */
export interface ExpiryRiskLike {
  available: boolean;
  reason?: string;
  alerts?: Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    expiryDate?: Date | string;
    daysUntilExpiry: number;
    severity: 'warning' | 'critical';
    canPromote: boolean;
  }>;
  generatedAt?: string;
}

export function normalizeExpiryRisk(
  raw: ExpiryRiskLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'inventory_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.alerts || raw.alerts.length === 0) {
    return unavailable(N, raw.reason || 'NO_EXPIRY_RISK_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, INVENTORY_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = raw.alerts.map((a) => ({
    signalId: makeSignalId('inventory_expiring', input.restaurantId, a.itemId),
    code: 'inventory_expiring' as const,
    category: 'inventory' as const,
    source: N,
    statement: `"${a.itemName}" expires in ${a.daysUntilExpiry} day(s) (${a.currentStock} in stock, ${a.severity} severity).`,
    value: num(a.daysUntilExpiry),
    unit: 'days',
    direction: 'down' as const,
    confidence: a.severity === 'critical' ? 0.85 : 0.75,
    sampleSize: undefined,
    scope,
    freshness,
    generatedAt: gen,
    subject: { type: 'ingredient' as const, id: a.itemId, label: a.itemName },
    evidence: [
      ev('metric', `metric:expiry:${a.itemId}:daysUntilExpiry`, num(a.daysUntilExpiry), { observedAt: gen }),
      ev('count', `metric:expiry:${a.itemId}:currentStock`, num(a.currentStock), { observedAt: gen }),
    ],
    caveats: a.canPromote === false ? ['Promotion of this item is not permitted by inventory rules.'] : undefined,
  }));
  return result(N, 'ok', signals, { now });
}

/** getStockoutRisk → StockoutRiskOutput.alerts */
export interface StockoutRiskLike {
  available: boolean;
  reason?: string;
  alerts?: Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    daysUntilDepletion: number;
    severity: 'warning' | 'critical';
    recommendedReorderQuantity: number;
    contributingMenuItems: string[];
  }>;
  generatedAt?: string;
}

export function normalizeStockoutRisk(
  raw: StockoutRiskLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'inventory_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.alerts || raw.alerts.length === 0) {
    return unavailable(N, raw.reason || 'NO_STOCKOUT_RISK_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, INVENTORY_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = raw.alerts.map((a) => ({
    signalId: makeSignalId('inventory_stockout_risk', input.restaurantId, a.itemId),
    code: 'inventory_stockout_risk' as const,
    category: 'inventory' as const,
    source: N,
    statement: `"${a.itemName}" is predicted to run out in ${a.daysUntilDepletion} day(s) (${a.severity} severity, reorder ~${a.recommendedReorderQuantity}).`,
    value: num(a.daysUntilDepletion),
    unit: 'days',
    direction: 'down' as const,
    confidence: a.severity === 'critical' ? 0.85 : 0.7,
    scope,
    freshness,
    generatedAt: gen,
    subject: { type: 'ingredient' as const, id: a.itemId, label: a.itemName },
    evidence: [ev('metric', `metric:stockout:${a.itemId}:daysUntilDepletion`, num(a.daysUntilDepletion), { observedAt: gen })],
    caveats: ['Demand forecast from the existing inventory demand service.'],
  }));
  return result(N, 'ok', signals, { now });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Customers  (tools: getCustomerSegments / getRetentionSignals)
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerSegmentsLike {
  available: boolean;
  reason?: string;
  segments?: Array<{ id: string; name: string; customerCount: number }>;
  totals?: { overall?: number; active?: number; dormant30Plus?: number; vip?: number };
  generatedAt?: string;
}

const CUSTOMER_WINDOW_DAYS = 30;

export function normalizeCustomerSegments(
  raw: CustomerSegmentsLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'customer_segments';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.segments || raw.segments.length === 0) {
    return unavailable(N, raw.reason || 'NO_CUSTOMER_SEGMENTS', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, CUSTOMER_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = raw.segments.map((s) => ({
    signalId: makeSignalId('customer_segment_present', input.restaurantId, s.id),
    code: 'customer_segment_present' as const,
    category: 'customer' as const,
    source: N,
    statement: `Segment "${s.name}" has ${s.customerCount} customers.`,
    value: undefined,
    direction: 'unknown' as const,
    confidence: clamp01(s.customerCount > 0 ? 0.7 : 0.5),
    sampleSize: num(s.customerCount),
    scope,
    freshness,
    generatedAt: gen,
    subject: { type: 'segment' as const, id: s.id, label: s.name },
    evidence: [ev('count', `count:segment:${s.id}:customers`, num(s.customerCount), { observedAt: gen })],
  }));
  return result(N, 'ok', signals, {
    now,
    caveats: ['Aggregate segment data only — never individual customer records.'],
  });
}

/** getRetentionSignals → RetentionSignalsOutput.summary */
export interface RetentionSignalsLike {
  available: boolean;
  reason?: string;
  summary?: {
    totalCustomers: number;
    newCustomers: number;
    activeCustomers: number;
    inactiveCustomers: number;
    highValueCustomers: number;
    atRiskCustomers: number;
    avgOrderValue: number;
    avgVisitsPerCustomer: number;
  };
  topSegments?: Array<{ segmentId: string; segmentName: string; customerCount: number; opportunityType: string }>;
  generatedAt?: string;
}

export function normalizeRetentionSignals(
  raw: RetentionSignalsLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'retention_signals';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.summary) return unavailable(N, raw.reason || 'NO_RETENTION_DATA', now);

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, CUSTOMER_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];
  const s = raw.summary;

  const inactive = num(s.inactiveCustomers);
  const highValue = num(s.highValueCustomers);
  const atRisk = num(s.atRiskCustomers);
  const total = num(s.totalCustomers);

  if (inactive !== undefined && inactive > 0) {
    signals.push({
      signalId: makeSignalId('customer_inactive_high', input.restaurantId, undefined),
      code: 'customer_inactive_high',
      category: 'customer',
      source: N,
      statement: `${inactive} of ${total ?? 'an unknown number of'} customers are currently inactive.`,
      value: inactive,
      unit: 'customers',
      direction: 'down',
      confidence: 0.75,
      sampleSize: total,
      scope,
      freshness,
      generatedAt: gen,
      evidence: [ev('count', 'count:retention:inactive', inactive, { observedAt: gen })],
    });
  }
  if (highValue !== undefined && highValue > 0) {
    signals.push({
      signalId: makeSignalId('customer_high_value_present', input.restaurantId, undefined),
      code: 'customer_high_value_present',
      category: 'customer',
      source: N,
      statement: `${highValue} high-value customers are tracked.`,
      value: highValue,
      unit: 'customers',
      direction: 'up',
      confidence: 0.75,
      sampleSize: total,
      scope,
      freshness,
      generatedAt: gen,
      evidence: [ev('count', 'count:retention:highValue', highValue, { observedAt: gen })],
    });
  }
  if (atRisk !== undefined && atRisk > 0) {
    signals.push({
      signalId: makeSignalId('customer_inactive_high', input.restaurantId, 'at-risk'),
      code: 'customer_inactive_high',
      category: 'customer',
      source: N,
      statement: `${atRisk} customers are at risk of churn.`,
      value: atRisk,
      unit: 'customers',
      direction: 'down',
      confidence: 0.7,
      sampleSize: total,
      scope,
      freshness,
      generatedAt: gen,
      evidence: [ev('count', 'count:retention:atRisk', atRisk, { observedAt: gen })],
    });
  }
  if (signals.length === 0) return unavailable(N, 'NO_RETENTION_EXTREMES', now);
  return result(N, 'ok', signals, { now });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Marketing history  (tools: getOfferPerformance / getCampaignPerformance / getActiveOffers)
// ─────────────────────────────────────────────────────────────────────────────

/** getOfferPerformance → OfferPerformanceOutput.offers */
export interface OfferPerformanceLike {
  available: boolean;
  reason?: string;
  offers?: Array<{
    offerId: string;
    title?: string;
    type?: string;
    redemptions: number;
    revenueGenerated: number;
    discountGiven: number;
    averageOrderValue: number;
    uniqueCustomers: number;
    repeatCustomers: number;
    contribution?: number | null;
    contributionMargin?: number | null;
  }>;
  generatedAt?: string;
}

const MARKETING_WINDOW_DAYS = 30;
/** Explicit underperformance threshold: below 3% redemption is weak. */
export const OFFER_UNDERPERFORM_REDEMPTION_RATE = 0.03;

export function normalizeOfferPerformance(
  raw: OfferPerformanceLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'offer_performance';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.offers || raw.offers.length === 0) {
    return unavailable(N, raw.reason || 'NO_OFFER_PERFORMANCE_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, MARKETING_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const o of raw.offers) {
    const name = o.title ?? o.offerId;
    const redemptions = num(o.redemptions);
    const unique = num(o.uniqueCustomers);
    // "Sent" is not exposed; uniqueCustomers is the honest exposure base.
    const exposure = unique ?? 0;
    const rate = exposure > 0 && redemptions !== undefined ? redemptions / exposure : undefined;
    const base = {
      category: 'marketing' as const,
      source: N,
      scope,
      freshness,
      generatedAt: gen,
      subject: { type: 'restaurant' as const, id: o.offerId, label: name },
    };

    if (rate !== undefined && exposure > 0 && rate < OFFER_UNDERPERFORM_REDEMPTION_RATE) {
      signals.push({
        ...base,
        signalId: makeSignalId('offer_underperforming', input.restaurantId, o.offerId),
        code: 'offer_underperforming',
        statement: `Offer "${name}" redeemed ${redemptions} time(s) against ${exposure} unique customer(s) — ${(rate * 100).toFixed(1)}%, below the ${(OFFER_UNDERPERFORM_REDEMPTION_RATE * 100).toFixed(0)}% underperformance threshold.`,
        value: rate,
        unit: 'rate',
        direction: 'down',
        confidence: 0.65,
        sampleSize: exposure,
        evidence: [
          ev('count', `metric:offer:${o.offerId}:redemptions`, redemptions, { observedAt: gen }),
          ev('count', `metric:offer:${o.offerId}:uniqueCustomers`, exposure, { observedAt: gen }),
        ],
      });
    }
  }

  if (signals.length === 0) return unavailable(N, 'NO_OFFER_PERFORMANCE_EXTREMES', now);
  return result(N, 'ok', signals, {
    now,
    caveats: ['Redemption rate uses unique customers as the exposure base because send counts are not exposed by this tool.'],
  });
}

/** getCampaignPerformance → CampaignPerformanceOutput.campaigns */
export interface CampaignPerformanceLike {
  available: boolean;
  reason?: string;
  campaigns?: Array<{
    id: string;
    offerId?: string | null;
    channel: string;
    recipientCount: number;
    openedCount: number;
    redeemedCount: number;
    campaignCost: number;
    status: string;
    sentDate?: string;
  }>;
  generatedAt?: string;
}

export function normalizeCampaignPerformance(
  raw: CampaignPerformanceLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'campaign_performance';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.campaigns || raw.campaigns.length === 0) {
    return unavailable(N, raw.reason || 'NO_CAMPAIGN_HISTORY', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, MARKETING_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const c of raw.campaigns) {
    const recipients = num(c.recipientCount) ?? 0;
    const redeemed = num(c.redeemedCount);
    if (recipients <= 0 || redeemed === undefined) continue;
    const rate = redeemed / recipients;
    const name = `${c.channel} campaign ${c.id.slice(-6)}`;
    const base = {
      category: 'marketing' as const,
      source: N,
      scope,
      freshness,
      generatedAt: gen,
      subject: { type: 'restaurant' as const, id: c.id, label: name },
      evidence: [
        ev('ratio', `metric:campaign:${c.id}:redemptionRate`, rate, { observedAt: gen }),
        ev('count', `metric:campaign:${c.id}:recipients`, recipients, { observedAt: gen }),
      ],
    };

    if (rate < OFFER_UNDERPERFORM_REDEMPTION_RATE) {
      signals.push({
        ...base,
        signalId: makeSignalId('campaign_underperforming', input.restaurantId, c.id),
        code: 'campaign_underperforming',
        statement: `${c.channel} campaign converted ${(rate * 100).toFixed(1)}% (${redeemed}/${recipients}) — below the ${(OFFER_UNDERPERFORM_REDEMPTION_RATE * 100).toFixed(0)}% underperformance threshold.`,
        value: rate,
        unit: 'rate',
        direction: 'down',
        confidence: 0.65,
        sampleSize: recipients,
      });
    } else if (rate >= 0.1) {
      signals.push({
        ...base,
        signalId: makeSignalId('campaign_effective', input.restaurantId, c.id),
        code: 'campaign_effective',
        statement: `${c.channel} campaign converted ${(rate * 100).toFixed(1)}% (${redeemed}/${recipients}).`,
        value: rate,
        unit: 'rate',
        direction: 'up',
        confidence: 0.7,
        sampleSize: recipients,
      });
    }
  }

  if (signals.length === 0) return unavailable(N, 'NO_CAMPAIGN_PERFORMANCE_EXTREMES', now);
  return result(N, 'ok', signals, { now });
}

/** getActiveOffers → ActiveOffersOutput.offers */
export interface ActiveOffersLike {
  available: boolean;
  reason?: string;
  offers?: Array<{ id: string; title: string; description: string; type: string; value: number; startDate?: string; endDate?: string }>;
  generatedAt?: string;
}

export function normalizeActiveOffers(
  raw: ActiveOffersLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'offer_performance';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.offers || raw.offers.length === 0) {
    return unavailable(N, raw.reason || 'NO_ACTIVE_OFFERS', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, MARKETING_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = raw.offers.map((o) => ({
    signalId: makeSignalId('offer_active', input.restaurantId, o.id),
    code: 'offer_active' as const,
    category: 'marketing' as const,
    source: N,
    statement: `Offer "${o.title}" (${o.type} ${o.value}) is currently active.`,
    direction: 'unknown' as const,
    confidence: 0.8,
    scope,
    freshness,
    generatedAt: gen,
    subject: { type: 'restaurant' as const, id: o.id, label: o.title },
    evidence: [ev('source', `offer:${o.id}`, undefined, { observedAt: gen, label: o.type })],
  }));
  return result(N, 'ok', signals, { now });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Demand / basket (ML)  (tools: getDemandForecast / getMarketBasketSignals)
// ─────────────────────────────────────────────────────────────────────────────

export interface DemandForecastLike {
  available: boolean;
  modelId?: string;
  modelVersion?: string | null;
  evaluationStatus?: string;
  freshnessAgeDays?: number | null;
  detail?: string;
  predictions?: Array<{
    productId: string;
    predictionFor: string;
    expected: number;
    lower: number | null;
    upper: number | null;
    confidenceLevel: string | null;
    dataMode: string | null;
  }>;
  generatedAt?: string;
}

const DEMAND_WINDOW_DAYS = 2;

export function normalizeDemandForecast(
  raw: DemandForecastLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'demand_forecast';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.predictions || raw.predictions.length === 0) {
    return unavailable(N, raw.detail || 'NO_DEMAND_FORECAST_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  // Freshness comes from the pipeline's own age metric when present.
  const freshness: SignalFreshness =
    typeof raw.freshnessAgeDays === 'number'
      ? raw.freshnessAgeDays <= DEMAND_WINDOW_DAYS
        ? 'fresh'
        : raw.freshnessAgeDays <= DEMAND_WINDOW_DAYS * 2
          ? 'aging'
          : 'stale'
      : classifyFreshness(gen, DEMAND_WINDOW_DAYS, now);

  // One signal per product: peak expected demand across the stored horizon.
  const byProduct = new Map<string, { expected: number; date: string; lower: number | null; upper: number | null }>();
  for (const p of raw.predictions) {
    const id = p.productId;
    const expected = num(p.expected) ?? 0;
    const prev = byProduct.get(id);
    if (!prev || expected > prev.expected) {
      byProduct.set(id, { expected, date: p.predictionFor ?? gen, lower: p.lower ?? null, upper: p.upper ?? null });
    }
  }

  const caveats: string[] = [];
  if (raw.modelVersion) caveats.push(`Model version ${raw.modelVersion}.`);
  if (raw.evaluationStatus && raw.evaluationStatus !== 'ok' && raw.evaluationStatus !== 'evaluated') {
    caveats.push(`Model evaluation status: ${raw.evaluationStatus}.`);
  }

  const signals: BusinessSignal[] = [...byProduct.entries()].map(([id, v]) => ({
    signalId: makeSignalId('product_high_demand_forecast', input.restaurantId, id),
    code: 'product_high_demand_forecast' as const,
    category: 'demand' as const,
    source: N,
    statement: `Forecast expects up to ${v.expected} unit(s) of product ${id} on ${v.date}.`,
    value: v.expected,
    unit: 'units',
    direction: 'unknown' as const,
    confidence: freshness === 'stale' ? 0.4 : 0.7,
    scope,
    freshness,
    generatedAt: gen,
    subject: { type: 'product' as const, id },
    evidence: [ev('model', `model:demand:${id}`, v.expected, { observedAt: gen, label: raw.modelVersion ?? undefined })],
    caveats: caveats.length ? caveats : undefined,
  }));

  if (signals.length === 0) return unavailable(N, 'NO_DEMAND_FORECAST_ROWS', now);
  return result(N, 'ok', signals, { now, caveats });
}

/** getMarketBasketSignals → MarketBasketSignalsOutput.signals (BasketSignalRow) */
export interface MarketBasketLike {
  available: boolean;
  modelId?: string;
  modelVersion?: string | null;
  evaluationStatus?: string;
  freshnessAgeDays?: number | null;
  detail?: string;
  predictionSource?: 'stored_predictions' | 'manager_table';
  recommendationMode?: string | null;
  signals?: Array<{
    productAId: string;
    productBId: string;
    expectedPurchases7d: number | null;
    estimatedFutureProfit: number | null;
    source: 'ml_prediction' | 'manager_table';
    recommendationMode?: string | null;
  }>;
  generatedAt?: string;
}

const BASKET_WINDOW_DAYS = 14;

/**
 * Basket rows do NOT expose a lift/support ratio — they expose expected
 * purchases and estimated future profit. The canonical signal therefore
 * reports those numbers as-is (honest evidence, no invented lift) and ranks
 * pairs by expected purchases.
 */
export function normalizeMarketBasket(
  raw: MarketBasketLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'market_basket';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || !raw.signals || raw.signals.length === 0) {
    return unavailable(N, raw.detail || 'NO_MARKET_BASKET_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness: SignalFreshness =
    typeof raw.freshnessAgeDays === 'number'
      ? raw.freshnessAgeDays <= BASKET_WINDOW_DAYS
        ? 'fresh'
        : raw.freshnessAgeDays <= BASKET_WINDOW_DAYS * 2
          ? 'aging'
          : 'stale'
      : classifyFreshness(gen, BASKET_WINDOW_DAYS, now);

  const caveats: string[] = [];
  if (raw.modelVersion) caveats.push(`Model version ${raw.modelVersion}.`);
  const heuristic = raw.predictionSource === 'manager_table';
  if (heuristic) caveats.push('Rule-based manager-table pairs — not model predictions.');

  const signals: BusinessSignal[] = raw.signals.map((s) => {
    const id = `${s.productAId}+${s.productBId}`;
    const expected = num(s.expectedPurchases7d);
    const profit = num(s.estimatedFutureProfit);
    const isHeuristic = s.source === 'manager_table';
    return {
      signalId: makeSignalId('basket_pair_strength', input.restaurantId, id),
      code: 'basket_pair_strength' as const,
      category: 'basket' as const,
      source: N,
      statement: `Products ${s.productAId} and ${s.productBId} are a combo pair with ${expected ?? 'unknown'} expected purchase(s) in 7 days${profit !== null && profit !== undefined ? ` and ~${profit} estimated future profit` : ''}.`,
      value: expected,
      unit: 'purchases/7d',
      direction: 'up' as const,
      confidence: isHeuristic ? 0.45 : 0.7,
      scope,
      freshness,
      generatedAt: gen,
      subject: { type: 'product' as const, id, label: id },
      evidence: [
        ev('model', `model:basket:${id}:expectedPurchases7d`, expected, { observedAt: gen }),
        ev('model', `model:basket:${id}:estimatedFutureProfit`, profit, { observedAt: gen }),
      ],
      caveats: isHeuristic ? ['Manager-table heuristic pair, not a model prediction.'] : undefined,
    };
  });

  if (signals.length === 0) return unavailable(N, 'NO_BASKET_PAIRS', now);
  return result(N, 'ok', signals, { now, caveats });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Context (festival / sports / competition / weather)
// ─────────────────────────────────────────────────────────────────────────────

export interface FestivalContextLike {
  available: boolean;
  reason?: string;
  nearest?: { name?: string; daysAway?: number; date?: string } | null;
  upcoming?: Array<{ name?: string; daysAway?: number; date?: string }>;
  generatedAt?: string;
}

const CONTEXT_WINDOW_DAYS = 7;

export function normalizeFestivalContext(
  raw: FestivalContextLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'festival_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available) return unavailable(N, raw.reason || 'NO_FESTIVAL_DATA', now);
  const first = raw.nearest ?? raw.upcoming?.[0];
  if (!first?.name) return unavailable(N, 'NO_UPCOMING_FESTIVAL', now);
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const days = num(first.daysAway);
  const freshness: SignalFreshness =
    days !== undefined && days <= CONTEXT_WINDOW_DAYS ? 'fresh' : classifyFreshness(gen, CONTEXT_WINDOW_DAYS, now);
  return result(
    N,
    'ok',
    [
      {
        signalId: makeSignalId('festival_upcoming', input.restaurantId, first.name),
        code: 'festival_upcoming',
        category: 'context',
        source: N,
        statement: `Festival "${first.name}" is ${days !== undefined ? `${days} day(s) away` : 'upcoming'}.`,
        value: days,
        unit: 'days',
        direction: 'up',
        confidence: 0.7,
        scope,
        freshness,
        generatedAt: gen,
        subject: { type: 'restaurant', id: first.name, label: first.name },
        evidence: [ev('source', `festival:${first.name}`, days, { observedAt: gen })],
        caveats: ['Festival context only — demand lift is not guaranteed or measured.'],
      },
    ],
    { now },
  );
}

export interface SportsContextLike {
  available: boolean;
  reason?: string;
  relevantMatches?: Array<{
    name?: string;
    competition?: string;
    date?: string;
    localDateTime?: string;
    relevance?: string;
    timeWindow?: string;
    timezone?: string;
  }>;
  generatedAt?: string;
}

export function normalizeSportsContext(
  raw: SportsContextLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'sports_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  const first = raw.relevantMatches?.[0];
  if (!raw.available || !first?.name) return unavailable(N, raw.reason || 'NO_RELEVANT_SPORTS_EVENT', now);
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const observed = first.localDateTime ?? first.date;
  const freshness: SignalFreshness =
    first.timeWindow === 'currently_live' ? 'fresh' : classifyFreshness(observed, CONTEXT_WINDOW_DAYS, now);
  return result(
    N,
    'ok',
    [
      {
        signalId: makeSignalId('sports_event_relevant', input.restaurantId, first.name),
        code: 'sports_event_relevant',
        category: 'context',
        source: N,
        statement: `Cricket match "${first.name}" (${first.competition ?? 'unknown competition'}) starts ${observed ?? 'at an unknown time'} with ${first.relevance ?? 'unknown'} relevance${first.timeWindow === 'currently_live' ? ' (live now)' : ''}.`,
        direction: 'unknown',
        confidence: 0.6,
        scope,
        freshness,
        generatedAt: gen,
        subject: { type: 'restaurant', id: first.name, label: first.name },
        evidence: [ev('source', `sports:${first.name}`, undefined, { observedAt: observed, label: first.competition })],
        caveats: ['Context only — never a reason to create an offer by itself.'],
      },
    ],
    { now },
  );
}

export interface CompetitionLike {
  available: boolean;
  reason?: string;
  summary?: { totalCompetitors?: number; nearestDistanceMeters?: number | null; density?: string };
  searchRadiusMeters?: number;
  signals?: Array<{ freshness?: { status?: string } }>;
  generatedAt?: string;
}

export function normalizeCompetitionContext(
  raw: CompetitionLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'competition_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  const s = raw.summary;
  if (!raw.available || !s || !s.totalCompetitors) return unavailable(N, raw.reason || 'NO_COMPETITION_DATA', now);
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const providerFreshness = raw.signals?.[0]?.freshness?.status;
  const freshness: SignalFreshness =
    providerFreshness === 'stale'
      ? 'stale'
      : providerFreshness === 'fresh'
        ? 'fresh'
        : classifyFreshness(gen, CONTEXT_WINDOW_DAYS, now);
  const density = String(s.density ?? 'unknown');
  return result(
    N,
    'ok',
    [
      {
        signalId: makeSignalId('competition_density', input.restaurantId, density),
        code: 'competition_density',
        category: 'context',
        source: N,
        statement: `${s.totalCompetitors} nearby restaurants within ${Math.round((raw.searchRadiusMeters ?? 0) / 100) / 10} km (${density} density), nearest ~${s.nearestDistanceMeters ?? 'unknown'}m.`,
        value: s.totalCompetitors,
        unit: 'restaurants',
        direction: 'unknown',
        confidence: 0.6,
        scope,
        freshness,
        generatedAt: gen,
        evidence: [ev('count', 'count:competition:nearby', s.totalCompetitors, { observedAt: gen })],
        caveats: ['Proximity evidence only — never a claim about competitor performance.'],
      },
    ],
    { now },
  );
}

export interface WeatherLike {
  available: boolean;
  reason?: string;
  current?: { condition?: string; temperatureC?: number; precipitationMm?: number } | null;
  forecast?: Array<{ date?: string; condition?: string; temperatureC?: number; precipitationMm?: number }>;
  generatedAt?: string;
}

export function normalizeWeatherContext(
  raw: WeatherLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'weather_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available || (!raw.current && !raw.forecast?.length)) {
    return unavailable(N, raw.reason || 'NO_WEATHER_DATA', now);
  }
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const first = raw.current ?? raw.forecast?.[0];
  if (!first) return unavailable(N, 'NO_WEATHER_DATA', now);
  const temp = num(first.temperatureC);
  const rain = num(first.precipitationMm);
  const notable = (temp !== undefined && (temp >= 38 || temp <= 12)) || (rain !== undefined && rain >= 5);
  if (!notable) return unavailable(N, 'NO_NOTABLE_WEATHER_SHIFT', now);
  return result(
    N,
    'ok',
    [
      {
        signalId: makeSignalId('weather_shift', input.restaurantId, first.condition ?? 'weather'),
        code: 'weather_shift',
        category: 'context',
        source: N,
        statement: `Weather context: ${first.condition ?? 'notable conditions'}${temp !== undefined ? ` at ${temp}°C` : ''}${rain !== undefined ? `, ${rain}mm precipitation` : ''}.`,
        value: temp,
        unit: '°C',
        direction: 'unknown',
        confidence: 0.55,
        scope,
        freshness: classifyFreshness(gen, CONTEXT_WINDOW_DAYS, now),
        generatedAt: gen,
        evidence: [ev('source', 'weather:current', temp, { observedAt: gen, label: first.condition })],
        caveats: ['Context only — no causal demand claim.'],
      },
    ],
    { now },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 18. Kitchen wastage  (tool: getWastage → WastageOutput)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Field names mirror `ai/tools/inventory/getWastageTool.ts → WastageOutput`
 * (backed by the authoritative costIntelligenceCore.metrics wastage block).
 * `items[]` may carry prevQty/prevCost for the previous period; when a same-
 * item previous figure exists, a >40% quantity increase is emitted as the
 * derived `inventory_wastage_spike` code; otherwise each observed item is an
 * `inventory_wastage` level. This window is a rolling operational window
 * (default 60d), NOT the closing business day — the Z-report pipeline states
 * that in its own evidence.
 */
export interface WastageLike {
  available: boolean;
  reason?: string;
  topItems?: Array<{ name: string; qty: number; unit?: string; cost: number }>;
  items?: Array<{
    name: string;
    unit?: string;
    qty: number;
    cost: number;
    prevQty?: number;
    prevCost?: number;
  }>;
  generatedAt?: string;
}

/** Quantity increase (vs the same item's previous figure) treated as a spike. */
export const WASTAGE_SPIKE_INCREASE = 0.4;

/** Freshness window for a rolling wastage analysis (getWastage defaults to 60d). */
const WASTAGE_WINDOW_DAYS = 60;

/** Empty result guard: leads with code so `.some()` reads right-to-left. */
const hasWastageRow = (s: BusinessSignal) => s.code === 'inventory_wastage' || s.code === 'inventory_wastage_spike';

export function normalizeWastage(
  raw: WastageLike | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'inventory_context';
  const now = input.now ?? Date.now();
  if (!raw) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!raw.available) {
    const signals: BusinessSignal[] = [];
    const top = (raw.topItems ?? []).filter((w) => String(w?.name ?? '').length > 0 && num(w.qty) !== undefined);
    const items = (raw.items ?? []).filter((w) => String(w?.name ?? '').length > 0 && num(w.qty) !== undefined);
    for (const w of [...top, ...items]) {
      signals.push({
        signalId: makeSignalId('inventory_wastage', input.restaurantId, w.name),
        code: 'inventory_wastage',
        category: 'inventory',
        source: N,
        statement: `"${w.name}" was wasted (${num(w.qty)}${w.unit ? ` ${w.unit}` : ''}, cost ${num(w.cost)}).`,
        value: num(w.qty),
        unit: w.unit ?? 'units',
        direction: 'up',
        confidence: 0.7,
        scope: scopeOf(input),
        freshness: 'unknown',
        generatedAt: '',
        evidence: [ev('metric', `metric:wastage:${w.name}:qty`, num(w.qty), { label: w.unit }), ev('metric', `metric:wastage:${w.name}:cost`, num(w.cost))],
        caveats: [`Source reported itself unavailable (${raw.reason ?? 'NO_WASTAGE_DATA'}); wastage rows are disclosed with unknown freshness, never presented as current.`],
      });
    }
    return result(N, 'unavailable', signals, { reason: raw.reason || 'NO_WASTAGE_DATA', now });
  }

  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const freshness = classifyFreshness(raw.generatedAt ? gen : undefined, WASTAGE_WINDOW_DAYS, now);
  const signals: BusinessSignal[] = [];

  for (const w of raw.items ?? []) {
    if (typeof w?.name !== 'string' || w.name.length === 0) continue;
    const qty = num(w.qty);
    if (qty === undefined || qty <= 0) continue;
    const prevQty = num(w.prevQty);
    const cost = num(w.cost);
    const prevCost = num(w.prevCost);
    // Spike only over the same item's own previous figure (like-for-like).
    if (prevQty !== undefined && prevQty > 0) {
      const spike = (qty - prevQty) / prevQty;
      if (spike > WASTAGE_SPIKE_INCREASE) {
        signals.push({
          signalId: makeSignalId('inventory_wastage_spike', input.restaurantId, w.name),
          code: 'inventory_wastage_spike',
          category: 'inventory',
          source: N,
          statement: `"${w.name}" wastage rose to ${qty}${w.unit ? ` ${w.unit}` : ''} from ${prevQty}${w.unit ? ` ${w.unit}` : ''} (+${Math.round(spike * 100)}%) vs the previous period.`,
          value: qty,
          unit: w.unit ?? 'units',
          baseline: prevQty,
          changePct: spike,
          direction: 'up',
          confidence: 0.85,
          scope,
          freshness,
          generatedAt: gen,
          subject: { type: 'ingredient', id: w.name, label: w.name },
          evidence: [
            ev('metric', `metric:wastage:${w.name}:qty`, qty, { label: w.unit, observedAt: gen }),
            ev('metric', `metric:wastage:${w.name}:prevQty`, prevQty, { label: w.unit, observedAt: gen }),
            ...(cost !== undefined ? [ev('metric', `metric:wastage:${w.name}:cost`, cost, { observedAt: gen })] : []),
            ...(prevCost !== undefined ? [ev('metric', `metric:wastage:${w.name}:prevCost`, prevCost, { observedAt: gen })] : []),
          ],
        });
        continue;
      }
    }
    signals.push({
      signalId: makeSignalId('inventory_wastage', input.restaurantId, w.name),
      code: 'inventory_wastage',
      category: 'inventory',
      source: N,
      statement: `"${w.name}" wastage: ${qty}${w.unit ? ` ${w.unit}` : ''}${cost !== undefined ? `, cost ${cost}` : ''}.`,
      value: qty,
      unit: w.unit ?? 'units',
      baseline: prevQty,
      changePct: prevQty !== undefined && prevQty > 0 && prevQty !== qty ? (qty - prevQty) / prevQty : undefined,
      direction: prevQty !== undefined && prevQty > 0 ? directionFromChange(prevQty !== qty ? (qty - prevQty) / prevQty : 0) : 'up',
      confidence: 0.7,
      scope,
      freshness,
      generatedAt: gen,
      subject: { type: 'ingredient', id: w.name, label: w.name },
      evidence: [
        ev('metric', `metric:wastage:${w.name}:qty`, qty, { label: w.unit, observedAt: gen }),
        ...(cost !== undefined ? [ev('metric', `metric:wastage:${w.name}:cost`, cost, { observedAt: gen })] : []),
        ...(prevQty !== undefined ? [ev('metric', `metric:wastage:${w.name}:prevQty`, prevQty, { observedAt: gen })] : []),
      ],
    });
  }

  const seen = new Set(signals.map((s) => s.signalId));
  // Same ingredient already reported from `items[]` → do not double-report it
  // from the `topItems[]` view of the same data.
  const itemNames = new Set(signals.map((s) => s.subject?.id ?? ''));
  for (const w of raw.topItems ?? []) {
    if (typeof w?.name !== 'string' || w.name.length === 0) continue;
    if (itemNames.has(w.name)) continue;
    const qty = num(w.qty);
    if (qty === undefined || qty <= 0) continue;
    const sid = makeSignalId('inventory_wastage', input.restaurantId, w.name);
    if (seen.has(sid)) continue;
    const cost = num(w.cost);
    signals.push({
      signalId: sid,
      code: 'inventory_wastage',
      category: 'inventory',
      source: N,
      statement: `"${w.name}" is a top wasted item (${qty}${w.unit ? ` ${w.unit}` : ''}${cost !== undefined ? `, cost ${cost}` : ''}).`,
      value: qty,
      unit: w.unit ?? 'units',
      baseline: undefined,
      changePct: undefined,
      direction: 'up',
      confidence: 0.7,
      scope,
      freshness,
      generatedAt: gen,
      subject: { type: 'ingredient', id: w.name, label: w.name },
      evidence: [
        ev('metric', `metric:wastage:${w.name}:qty`, qty, { label: w.unit, observedAt: gen }),
        ...(cost !== undefined ? [ev('metric', `metric:wastage:${w.name}:cost`, cost, { observedAt: gen })] : []),
      ],
    });
  }

  if (!signals.some(hasWastageRow)) return unavailable(N, 'NO_WASTAGE_DATA', now);
  signals.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return result(N, 'ok', signals, { now, caveats: ['Wastage window is a rolling operational window, not necessarily the closing business day.'] });
}

// ─────────────────────────────────────────────────────────────────────────────
// 19. Cash / closing ledger  (closingReportService.zReport sales+cash subset)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the exact zReport `sales`+`cash` fields (modules/reports/services/
 * closingReportService.ts zReport()); `payments[]` mirrors ReportScope row
 * shape. All values are ROUNDED deterministic figures — never recomputed here.
 */
export interface CashClosingLike {
  sales: {
    date: string;
    grossRevenue: number;
    netRevenue: number;
    orders: number;
    averageOrderValue: number;
    discounts: number;
    taxes: number;
    payments?: Array<{ method: string; amount: number; count: number }>;
  };
  cash: {
    openingCash: number;
    cashSales: number;
    cashIn: number;
    cashOut: number;
    expenses: number;
    adjustments: number;
    expectedCash: number;
    actualCash: number;
    overShort: number;
  };
  generatedAt?: string;
}

export interface CashClosingMeta {
  /** Mirrors zReport.requiresManagerApproval — deterministic, reused verbatim. */
  requiresManagerApproval?: boolean;
}

export function normalizeCashClosing(
  raw: (CashClosingLike & CashClosingMeta) | null | undefined,
  input: NormalizerInput,
): SignalNormalizationResult {
  const N: BusinessSignalSource = 'cash_ledger';
  const now = input.now ?? Date.now();
  if (!raw || !raw.sales || !raw.cash) return unavailable(N, 'NO_TOOL_OUTPUT', now);
  if (!String(raw.sales.date || '').trim()) return unavailable(N, 'NO_CLOSING_DATE', now);
  const scope = scopeOf(input);
  const gen = isoOr(raw.generatedAt, now);
  const date = String(raw.sales.date);
  const signals: BusinessSignal[] = [];
  const overShort = num(raw.cash.overShort);
  if (overShort !== undefined) {
    // Confidence is grounded in the deterministic report's own approval flag
    // (|variance| > ₹0.50 ⇒ requiresManagerApproval) — never an invented
    // numeric threshold inside the normalizer.
    const needsApproval = raw.requiresManagerApproval === true;
    const severity = needsApproval ? 0.9 : 0.75;
    signals.push({
      signalId: makeSignalId('cash_over_short', input.restaurantId, date),
      code: 'cash_over_short',
      category: 'sales',
      source: N,
      statement: `Closing drawer variance on ${date}: ${overShort > 0 ? 'over' : 'short'} by ${Math.abs(overShort)}.`,
      value: overShort,
      unit: 'currency',
      direction: overShort > 0 ? 'up' : overShort < 0 ? 'down' : 'flat',
      confidence: severity,
      scope,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        ev('metric', 'metric:cash:expected', num(raw.cash.expectedCash), { label: String(date) }),
        ev('metric', 'metric:cash:actual', num(raw.cash.actualCash), { label: String(date) }),
        ...([num(raw.cash.cashSales), num(raw.cash.cashIn), num(raw.cash.cashOut), num(raw.cash.expenses), num(raw.cash.adjustments), num(raw.cash.openingCash)] as const).every((v) => v === undefined)
          ? []
          : [ev('ratio', 'ratio:cash:reconciliation', overShort, { label: String(date), observedAt: gen })],
      ],
      caveats: needsApproval
        ? ['Variance computed by the deterministic closing report; requires manager approval per that report; never a person-blame signal.']
        : ['Variance computed by the deterministic closing report; never a person-blame signal.'],
    });
  }
  const net = num(raw.sales.netRevenue);
  if (net !== undefined) {
    signals.push({
      signalId: makeSignalId('sales_day_close', input.restaurantId, date),
      code: 'sales_day_close',
      category: 'sales',
      source: N,
      statement: `Net revenue for ${date} was ${net} across ${num(raw.sales.orders) ?? 'an unknown number of'} orders (avg ${num(raw.sales.averageOrderValue) ?? 'n/a'}/order).`,
      value: net,
      unit: 'currency',
      direction: net > 0 ? 'up' : 'down',
      confidence: num(raw.sales.orders) ? 0.95 : 0.7,
      sampleSize: num(raw.sales.orders),
      scope,
      freshness: 'fresh',
      generatedAt: gen,
      evidence: [
        ev('metric', 'metric:cashDay:netRevenue', net, { label: String(date) }),
        ...(num(raw.sales.grossRevenue) !== undefined ? [ev('metric', 'metric:cashDay:grossRevenue', num(raw.sales.grossRevenue), { label: String(date) })] : []),
        ...((raw.sales.payments ?? []).length > 0 ? [ev('tool_output', 'closingReportService.zReport.payments', undefined, { sampleSize: (raw.sales.payments ?? []).length })] : []),
      ],
      caveats: ['Represents the deterministic Z-report sales figures for the closing day.'],
    });
  }
  return result(N, 'ok', signals, { now, caveats: ['Cash reconciliation uses the closing ledger; openingCash comes from CashLedger history.'] });
}

// Re-export the direction helper so integration code/tests import from one place.
export { directionFromChange };
