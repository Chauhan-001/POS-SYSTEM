/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingScheduler.test.ts — Unit tests for the marketing scheduler's
 * nightly segment auto-refresh gate (Phase: auto-refresh customer segments).
 * The pure `shouldRunSegmentRefresh` helper is tested directly; the DB-heavy
 * refresh pass itself is exercised by the E2E smoke test.
 */

import { describe, it, expect } from 'vitest';
import { shouldRunSegmentRefresh } from '../marketingScheduler';

describe('shouldRunSegmentRefresh (nightly segment auto-refresh)', () => {
  // Build dates in SERVER-LOCAL time (the scheduler uses now.getHours(), so
  // the window is "04:00 local server time" — never UTC-shifted).
  const at = (hour: number, minute = 0, day = '2026-08-08') => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hour, minute, 0, 0);
  };

  it('runs once per day shortly after the 04:00 window opens', () => {
    // Nothing ran yet today, and it is past 4 AM → due.
    expect(shouldRunSegmentRefresh('', at(4, 5))).toBe(true);
  });

  it('does NOT run before 04:00', () => {
    expect(shouldRunSegmentRefresh('', at(3, 59))).toBe(false);
  });

  it('does NOT run twice on the same day', () => {
    // Already refreshed today (last date matches) → skip even at 11 AM.
    expect(shouldRunSegmentRefresh('2026-08-08', at(11, 30))).toBe(false);
  });

  it('runs again on a NEW day', () => {
    // Refreshed yesterday, now it is the next day at 04:01 → due again.
    expect(shouldRunSegmentRefresh('2026-08-07', at(4, 1, '2026-08-08'))).toBe(true);
  });

  it('runs on a new day even if the hour is late', () => {
    expect(shouldRunSegmentRefresh('2026-08-07', at(23, 0, '2026-08-08'))).toBe(true);
  });
});
