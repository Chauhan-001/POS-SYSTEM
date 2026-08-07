/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportQueryBuilder.ts — Shared helpers for building admin report queries.
 *
 * Centralises the messy bits at the core of every report:
 *   - Date range derivation from period/from/to in a consistent timezone
 *   - Comparison windowing (current vs previous period for delta/trend)
 *   - Safe integer stepping for forecast buckets
 *   - Label + timekey generation for grouping
 *
 * All helpers are pure so the aggregation services and unit tests stay simple.
 */

export type PeriodKey = 'today' | 'yesterday' | '7d' | '14d' | '30d' | '90d' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'all';

/** A concrete, closed date window. */
export interface DateWindow {
  from: Date;
  to: Date;
  period: string;
}

/** Options accepted for window derivation. `from`/`to` always win over period. */
export interface WindowOptions {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  timezoneOffsetMinutes?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(offsetMinutes = 0): Date {
  const now = new Date(Date.now() - offsetMinutes * 60 * 1000);
  now.setHours(0, 0, 0, 0);
  return new Date(now.getTime() + offsetMinutes * 60 * 1000);
}

function startOfUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfMonth(offsetMinutes = 0): Date {
  const today = startOfToday(offsetMinutes);
  // Shift back to UTC for clean calendar math then add offset back.
  const shifted = new Date(today.getTime() - offsetMinutes * 60 * 1000);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
}

function startOfYear(offsetMinutes = 0): Date {
  const today = startOfToday(offsetMinutes);
  const shifted = new Date(today.getTime() - offsetMinutes * 60 * 1000);
  shifted.setUTCMonth(0, 1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
}

/** Normalise a fallible user input into a valid Date or undefined. */
export function toDate(input?: string | null, fallback?: Date): Date | undefined {
  if (!input) return fallback;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Build a closed date window. Priority: from/to (explicit) → period preset →
 * sensible default of the trailing 30 days.
 */
export function buildWindow(options: WindowOptions = {}): DateWindow {
  const offsetMinutes = options.timezoneOffsetMinutes ?? 0;
  const from = toDate(options.from);
  const to = toDate(options.to);

  if (from || to) {
    const resolvedFrom = from ?? new Date(0);
    const resolvedTo = to ?? new Date();
    if (resolvedTo.getTime() < resolvedFrom.getTime()) {
      // Guard against inverted ranges.
      return { from: resolvedFrom, to: resolvedFrom, period: 'custom' };
    }
    return { from: resolvedFrom, to: resolvedTo, period: 'custom' };
  }

  const period = (options.period || '30d') as PeriodKey;
  const now = new Date();

  switch (period) {
    case 'today': {
      const s = startOfToday(offsetMinutes);
      return { from: s, to: new Date(), period: 'today' };
    }
    case 'yesterday': {
      const s = startOfToday(offsetMinutes);
      return { from: new Date(s.getTime() - DAY_MS), to: s, period: 'yesterday' };
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now, period: '7d' };
    case '14d':
      return { from: new Date(now.getTime() - 14 * DAY_MS), to: now, period: '14d' };
    case '30d':
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now, period: '30d' };
    case '90d':
      return { from: new Date(now.getTime() - 90 * DAY_MS), to: now, period: '90d' };
    case 'this_month': {
      const s = startOfMonth(offsetMinutes);
      return { from: s, to: now, period: 'this_month' };
    }
    case 'last_month': {
      const cur = startOfMonth(offsetMinutes);
      const s = new Date(cur.getTime() - DAY_MS);
      const shifted = new Date(s.getTime() - offsetMinutes * 60 * 1000);
      shifted.setUTCDate(1);
      const start = new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
      return { from: start, to: cur, period: 'last_month' };
    }
    case 'this_year': {
      const s = startOfYear(offsetMinutes);
      return { from: s, to: now, period: 'this_year' };
    }
    case 'last_year': {
      const cur = startOfYear(offsetMinutes);
      const s = new Date(cur.getTime() - DAY_MS);
      const shifted = new Date(s.getTime() - offsetMinutes * 60 * 1000);
      shifted.setUTCMonth(0, 1);
      const start = new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
      return { from: start, to: cur, period: 'last_year' };
    }
    case 'all':
      return { from: new Date(0), to: now, period: 'all' };
    default:
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now, period: '30d' };
  }
}

/**
 * Build the immediately-previous window of equal length for delta/vs. comparisons.
 * For calendar periods (month/year) we compare the prior, equivalent calendar block;
 * for rolling windows we subtract the window span from both bounds.
 */
export function previousWindow(window: DateWindow, offsetMinutes = 0): DateWindow {
  const span = window.to.getTime() - window.from.getTime();
  switch (window.period) {
    case 'this_month': {
      const cur = startOfMonth(offsetMinutes);
      const shift = new Date(cur.getTime() - DAY_MS);
      const shifted = new Date(shift.getTime() - offsetMinutes * 60 * 1000);
      shifted.setUTCDate(1);
      const start = new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
      return { from: start, to: cur, period: 'last_month' };
    }
    case 'this_year': {
      const cur = startOfYear(offsetMinutes);
      const shift = new Date(cur.getTime() - DAY_MS);
      const shifted = new Date(shift.getTime() - offsetMinutes * 60 * 1000);
      shifted.setUTCMonth(0, 1);
      const start = new Date(shifted.getTime() + offsetMinutes * 60 * 1000);
      return { from: start, to: cur, period: 'last_year' };
    }
    default:
      // Rolling windows: same length immediately before.
      return { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime()), period: `prev_${window.period}` };
  }
}

/**
 * Build a Mongoose `$match` stage scoping a timestamped collection to a window.
 */
export function matchWindow(field = 'createdAt'): (w: DateWindow) => Record<string, any> {
  return (w) => ({
    $match: {
      [field]: { $gte: w.from, $lte: w.to },
    },
  });
}

/** Clamp an arbitrary integer step so it is never negative / NaN / huge. */
export function safeStep(n: number | undefined | null, fallback: number): number {
  if (n === undefined || n === null || Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  if (Math.floor(n) < 0) return 0;
  return Math.floor(n);
}

/** Clamp an arbitrary integer step where the input may be typed nullable. */
export function safeIntStep(n: number | null | undefined, fallback: number): number {
  return safeStep(n as number | undefined | null, fallback);
}

/**
 * Build forecast buckets for a given step count, each bucket a { from, to }
 * window following the current window. Used by the revenue forecast report.
 */
export function buildForecastBuckets(window: DateWindow, steps: number): DateWindow[] {
  const count = Math.min(Math.max(safeStep(steps, 3), 1), 36);
  const span = Math.max(window.to.getTime() - window.from.getTime(), DAY_MS);
  const buckets: DateWindow[] = [];
  for (let i = 1; i <= count; i++) {
    const from = new Date(window.to.getTime() + (i - 1) * span);
    const to = new Date(window.to.getTime() + i * span);
    buckets.push({ from, to, period: `forecast_${i}` });
  }
  return buckets;
}

/**
 * Produce a daily-series `$group._id` string key label (YYYY-MM-DD in UTC)
 * used to pivot aggregation results into charts and simple moving averages.
 */
export function dayKeyExpr(field = 'createdAt'): Record<string, any> {
  return {
    $concat: [
      { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } },
    ],
  };
}

/** Compute a simple moving average over an ordered numeric series. */
export function simpleMovingAverage(series: Array<{ key: string; value: number }>, window: number): Array<{ key: string; sma: number | null }> {
  const n = Math.max(1, safeStep(window, 7));
  return series.map((p, idx) => {
    if (idx < n - 1) return { key: p.key, sma: null };
    let sum = 0;
    for (let i = idx - n + 1; i <= idx; i++) sum += series[i]?.value ?? 0;
    return { key: p.key, sma: Number((sum / n).toFixed(2)) };
  });
}

/** percent deltas guarded against divide-by-zero. */
export function pctChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return 0;
  }
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

/** Churn / retention helper: what share of a base remained? */
export function retentionRate(retained: number, base: number): number {
  if (!base) return 0;
  return Number(((retained / base) * 100).toFixed(2));
}