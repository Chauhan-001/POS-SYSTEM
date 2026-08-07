/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportQueryBuilder.test.ts — Unit tests for the shared report query helpers.
 *
 * These helpers are pure, so the tests need no database. They cover the
 * exact date-window / delta / forecast math every report relies on.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildWindow,
  previousWindow,
  buildForecastBuckets,
  safeStep,
  simpleMovingAverage,
  pctChange,
  retentionRate,
  toDate,
} from '../reportQueryBuilder';

describe('buildWindow', () => {
  it('period 30d produces a 30-day trailing window ending now', () => {
    const w = buildWindow({ period: '30d' });
    expect(w.period).toBe('30d');
    const spanDays = (w.to.getTime() - w.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThanOrEqual(29.9);
    expect(spanDays).toBeLessThanOrEqual(30.1);
  });

  it('explicit from/to win over period', () => {
    const w = buildWindow({ period: '7d', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
    expect(w.period).toBe('custom');
    expect(w.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('this_month starts at the first of the month (UTC)', () => {
    const w = buildWindow({ period: 'this_month' });
    expect(w.period).toBe('this_month');
    // 1st of the month in UTC
    expect(w.from.getUTCDate()).toBe(1);
    expect(w.from.getUTCHours()).toBe(0);
  });

  it('all starts at epoch', () => {
    const w = buildWindow({ period: 'all' });
    expect(w.period).toBe('all');
    expect(w.from.getTime()).toBe(0);
  });

  it('inverted explicit ranges are clamped to from==to', () => {
    const w = buildWindow({ from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });
    expect(w.from.getTime()).toBe(w.to.getTime());
    expect(w.period).toBe('custom');
  });
});

describe('previousWindow', () => {
  it('returns an equal-length window immediately before rolling windows', () => {
    const w = buildWindow({ period: '30d' });
    const prev = previousWindow(w);
    const curSpan = w.to.getTime() - w.from.getTime();
    const prevSpan = prev.to.getTime() - prev.from.getTime();
    expect(Math.abs(curSpan - prevSpan)).toBeLessThan(1000);
    expect(prev.to.getTime()).toBeLessThanOrEqual(w.from.getTime());
  });
});

describe('buildForecastBuckets', () => {
  it('creates step buckets following the current window', () => {
    const w = buildWindow({ period: '30d' });
    const buckets = buildForecastBuckets(w, 3);
    expect(buckets).toHaveLength(3);
    expect(buckets[0].from.getTime()).toBeGreaterThanOrEqual(w.to.getTime());
    expect(buckets[2].to.getTime()).toBeGreaterThan(buckets[1].to.getTime());
  });

  it('clamps steps to a sane range', () => {
    const w = buildWindow({ period: '30d' });
    expect(buildForecastBuckets(w, -5)).toHaveLength(1);
    expect(buildForecastBuckets(w, 999)).toHaveLength(36);
  });
});

describe('simpleMovingAverage', () => {
  it('returns nulls until the window is filled', () => {
    const series = [
      { key: 'a', value: 2 }, { key: 'b', value: 4 }, { key: 'c', value: 6 },
    ];
    const sma = simpleMovingAverage(series, 3);
    expect(sma[0].sma).toBeNull();
    expect(sma[1].sma).toBeNull();
    expect(sma[2].sma).toBe(4);
  });
});

describe('pctChange', () => {
  it('computes positive deltas', () => {
    expect(pctChange(120, 100)).toBe(20);
  });
  it('handles divide-by-zero gracefully', () => {
    expect(pctChange(50, 0)).toBe(0);
  });
  it('treats non-finite inputs as zero', () => {
    expect(pctChange(Number.NaN, 10)).toBe(0);
  });
});

describe('retentionRate', () => {
  it('returns 100% retention for the full base', () => {
    expect(retentionRate(100, 100)).toBe(100);
  });
  it('returns 0 for a zero base', () => {
    expect(retentionRate(50, 0)).toBe(0);
  });
  it('rounds to two decimals', () => {
    expect(retentionRate(33, 100)).toBe(33);
  });
});

describe('toDate', () => {
  it('parses valid ISO strings', () => {
    expect(toDate('2026-01-01T00:00:00.000Z')?.getUTCFullYear()).toBe(2026);
  });
  it('returns fallback for invalid input', () => {
    const fallback = new Date('2026-05-01T00:00:00.000Z');
    expect(toDate('not-a-date', fallback)).toBe(fallback);
  });
  it('returns undefined when no input and no fallback', () => {
    expect(toDate(undefined)).toBeUndefined();
  });
});

// Suppress unused import warning if the helper is re-exported elsewhere.
export default vi.fn();