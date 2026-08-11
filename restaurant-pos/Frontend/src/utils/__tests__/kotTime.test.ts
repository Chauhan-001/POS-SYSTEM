/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  kotPrintedTimeMs,
  getKOTElapsedMinutes,
  formatKOTTimestamp,
} from '../kotTime';

describe('kotPrintedTimeMs', () => {
  it('parses ISO timestamps', () => {
    const iso = '2026-08-09T10:03:25.000Z';
    const ms = kotPrintedTimeMs(iso);
    expect(ms).toBe(new Date(iso).getTime());
    expect(Number.isFinite(ms)).toBe(true);
  });

  it('parses legacy time-of-day strings as today', () => {
    const ms = kotPrintedTimeMs('10:03:25 PM');
    expect(ms).not.toBeNull();
    if (ms != null) {
      const d = new Date(ms);
      expect(d.getHours()).toBe(22); // 10 PM → 22
      expect(d.getMinutes()).toBe(3);
      expect(d.getSeconds()).toBe(25);
    }
  });

  it('parses "10:03 PM" and 12-hour AM boundaries', () => {
    expect(kotPrintedTimeMs('10:03 PM')).not.toBeNull();
    const midnight = kotPrintedTimeMs('12:00 AM');
    if (midnight != null) {
      expect(new Date(midnight).getHours()).toBe(0);
    }
    const noon = kotPrintedTimeMs('12:00 PM');
    if (noon != null) {
      expect(new Date(noon).getHours()).toBe(12);
    }
  });

  it('returns null for missing or garbage input (never NaN)', () => {
    expect(kotPrintedTimeMs(undefined)).toBeNull();
    expect(kotPrintedTimeMs(null)).toBeNull();
    expect(kotPrintedTimeMs('')).toBeNull();
    expect(kotPrintedTimeMs('not a time')).toBeNull();
    expect(kotPrintedTimeMs('99:99')).toBeNull();
  });
});

describe('getKOTElapsedMinutes', () => {
  const now = new Date('2026-08-09T12:00:00.000Z').getTime();

  it('computes elapsed minutes from an ISO timestamp', () => {
    const fiveMinAgo = new Date(now - 5 * 60000).toISOString();
    expect(getKOTElapsedMinutes(fiveMinAgo, now)).toBe(5);
  });

  it('returns 0 (not NaN) for missing/invalid printedAt', () => {
    expect(getKOTElapsedMinutes(undefined, now)).toBe(0);
    expect(getKOTElapsedMinutes('10:03:25 PM', 0)).toBe(0);
    expect(getKOTElapsedMinutes('garbage', now)).toBe(0);
  });

  it('never returns a negative number', () => {
    const future = new Date(now + 60 * 60000).toISOString();
    expect(getKOTElapsedMinutes(future, now)).toBe(0);
  });

  it('treats legacy time strings as today (non-negative, finite)', () => {
    const minutes = getKOTElapsedMinutes('10:03:25 PM');
    expect(Number.isFinite(minutes)).toBe(true);
    expect(minutes).toBeGreaterThanOrEqual(0);
  });
});

describe('formatKOTTimestamp', () => {
  it('formats ISO timestamps into a short readable string', () => {
    const iso = '2026-08-09T10:03:25.000Z';
    const out = formatKOTTimestamp(iso);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // Locale-independent: must NOT be the raw ISO string and must carry a
    // time (hour:minute always contains a colon).
    expect(out).not.toBe(iso);
    expect(out).toContain(':');
  });

  it('passes legacy display strings through unchanged', () => {
    expect(formatKOTTimestamp('10:03:25 PM')).toBe('10:03:25 PM');
  });

  it('never returns NaN text for any input', () => {
    expect(formatKOTTimestamp('garbage')).not.toMatch(/NaN/i);
    expect(formatKOTTimestamp('09 Aug 2026, 10:03 PM')).not.toMatch(/NaN/i);
  });

  it('returns an empty string for missing input', () => {
    expect(formatKOTTimestamp(undefined)).toBe('');
    expect(formatKOTTimestamp(null)).toBe('');
    expect(formatKOTTimestamp('')).toBe('');
  });
});
