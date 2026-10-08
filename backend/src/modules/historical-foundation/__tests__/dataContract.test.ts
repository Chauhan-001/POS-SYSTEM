/**
 * PHASE 1 — data contract + business-day tests.
 *
 * Guards the non-negotiables: unknown != zero, business dates are timezone-derived
 * (not UTC slices), and dates are validated. Pure — no DB.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXECUTION_MODE,
  assertFactConsistency,
  isBusinessDate,
  type HistoricalFact,
} from '../dataContract';
import {
  addBusinessDays,
  businessDateForTimezone,
  businessDateRange,
  isValidTimezone,
  utcSliceBusinessDate,
} from '../businessDay';

function fact(overrides: Partial<HistoricalFact> = {}): HistoricalFact {
  return {
    restaurantId: 'r1',
    branchId: null,
    businessDate: '2026-10-06',
    metric: 'sales.grossRevenue',
    value: 100,
    unit: 'INR',
    dataStatus: 'OBSERVED',
    provenance: { source: 'DailySummary', sourceCollections: ['dailysummaries'], derivationId: 'd1', synthetic: false },
    datasetVersion: 'hist-v1',
    runId: 'run1',
    ...overrides,
  };
}

describe('dataContract', () => {
  it('defaults to DRY_RUN (never a dangerous default)', () => {
    expect(DEFAULT_EXECUTION_MODE).toBe('DRY_RUN');
  });

  it('validates business dates strictly', () => {
    expect(isBusinessDate('2026-10-06')).toBe(true);
    for (const bad of ['2026-10-6', '2026/10/06', '2026-13-01', '2026-02-30', 'yesterday', '']) {
      expect(isBusinessDate(bad), bad).toBe(false);
    }
  });

  it('distinguishes measured zero from historically unavailable', () => {
    expect(() => assertFactConsistency(fact({ value: 0, dataStatus: 'OBSERVED' }))).not.toThrow();
    expect(() => assertFactConsistency(fact({ value: null, dataStatus: 'UNAVAILABLE' }))).not.toThrow();
  });

  it('rejects an unavailable fact that carries a non-null value', () => {
    expect(() => assertFactConsistency(fact({ value: 5, dataStatus: 'UNAVAILABLE' }))).toThrow();
  });

  it('rejects a null value that is not labelled UNAVAILABLE', () => {
    expect(() => assertFactConsistency(fact({ value: null, dataStatus: 'OBSERVED' }))).toThrow();
  });

  it('rejects an invalid businessDate on a fact', () => {
    expect(() => assertFactConsistency(fact({ businessDate: 'nope' }))).toThrow();
  });
});

describe('businessDay', () => {
  it('validates IANA timezones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });

  it('uses the restaurant timezone, NOT a UTC slice (D5 fix direction)', () => {
    // 2026-10-06T19:00Z = 2026-10-07 00:30 IST → business day differs by timezone.
    const instant = '2026-10-06T19:00:00.000Z';
    expect(utcSliceBusinessDate(instant)).toBe('2026-10-06'); // current (wrong for IST)
    expect(businessDateForTimezone(instant, 'Asia/Kolkata')).toBe('2026-10-07');
    expect(businessDateForTimezone(instant, 'UTC')).toBe('2026-10-06');
  });

  it('resolves the same instant differently across timezones', () => {
    const instant = '2026-10-06T23:30:00.000Z';
    expect(businessDateForTimezone(instant, 'UTC')).toBe('2026-10-06');
    expect(businessDateForTimezone(instant, 'Asia/Kolkata')).toBe('2026-10-07');
    expect(businessDateForTimezone(instant, 'America/New_York')).toBe('2026-10-06');
  });

  it('throws on an invalid timezone instead of silently falling back to UTC', () => {
    expect(() => businessDateForTimezone(Date.now(), 'Nope/Nope')).toThrow();
  });

  it('adds calendar days correctly across month boundaries', () => {
    expect(addBusinessDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addBusinessDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('builds an inclusive bounded date range', () => {
    expect(businessDateRange('2026-10-01', '2026-10-04')).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(businessDateRange('2026-10-04', '2026-10-01')).toEqual([]);
  });
});
