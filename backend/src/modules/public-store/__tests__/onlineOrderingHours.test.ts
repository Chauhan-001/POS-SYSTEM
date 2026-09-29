/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the online-ordering hours evaluator — the deterministic
 * pause/resume gate for website orders (Menu Availability schedule).
 */

import { describe, it, expect } from 'vitest';
import { isOnlineOrderingOpen, parseHHMM, describeOnlineOrderingHours } from '../services/onlineOrderingHours';

/** Local-time helper: new Date(y, m, d, h, min) is already local. */
const at = (day: number, h: number, min: number) => {
  // 2026-09-27 is a Sunday (day 0). day = 0..6 from that Sunday.
  return new Date(2026, 8, 27 + day, h, min, 0, 0);
};

describe('parseHHMM', () => {
  it('parses valid times to minutes since midnight', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('23:59')).toBe(1439);
    expect(parseHHMM('00:00')).toBe(0);
  });
  it('rejects malformed input', () => {
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('9:60')).toBeNull();
    expect(parseHHMM('abc')).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
  });
});

describe('isOnlineOrderingOpen — fail-open semantics', () => {
  it('is open when no schedule exists', () => {
    expect(isOnlineOrderingOpen(undefined)).toBe(true);
    expect(isOnlineOrderingOpen(null)).toBe(true);
    expect(isOnlineOrderingOpen({})).toBe(true);
  });
  it('is open when the schedule is disabled', () => {
    expect(isOnlineOrderingOpen({ enabled: false, openTime: '09:00', closeTime: '22:00', days: [1] }, at(1, 12, 0))).toBe(true);
  });
  it('is open when times are malformed', () => {
    expect(isOnlineOrderingOpen({ enabled: true, openTime: 'bad', closeTime: '22:00', days: [1] })).toBe(true);
  });
  it('is open when no days are configured', () => {
    expect(isOnlineOrderingOpen({ enabled: true, openTime: '09:00', closeTime: '22:00', days: [] }, at(1, 12, 0))).toBe(true);
  });
});

describe('isOnlineOrderingOpen — same-day window', () => {
  const cfg = { enabled: true, openTime: '09:00', closeTime: '22:00', days: [1, 2, 3, 4, 5] }; // Mon–Fri

  it('is closed before opening on a scheduled day', () => {
    expect(isOnlineOrderingOpen(cfg, at(1, 8, 59))).toBe(false); // Monday 08:59
  });
  it('is open at opening minute', () => {
    expect(isOnlineOrderingOpen(cfg, at(1, 9, 0))).toBe(true);
  });
  it('is open just before closing', () => {
    expect(isOnlineOrderingOpen(cfg, at(1, 21, 59))).toBe(true);
  });
  it('is closed at closing minute (half-open window)', () => {
    expect(isOnlineOrderingOpen(cfg, at(1, 22, 0))).toBe(false);
  });
  it('is closed all day on an unscheduled day (Saturday)', () => {
    expect(isOnlineOrderingOpen(cfg, at(6, 12, 0))).toBe(false);
  });
});

describe('isOnlineOrderingOpen — overnight window', () => {
  // Tue–Sun, 11:00 → 02:00 (spans midnight)
  const cfg = { enabled: true, openTime: '11:00', closeTime: '02:00', days: [2, 3, 4, 5, 6, 0] };

  it('is open in the evening before midnight', () => {
    expect(isOnlineOrderingOpen(cfg, at(2, 23, 0))).toBe(true); // Tuesday 23:00
  });
  it('is open after midnight as spillover of the SAME day window', () => {
    expect(isOnlineOrderingOpen(cfg, at(3, 1, 30))).toBe(true); // Wednesday 01:30
  });
  it('is closed after the window ends (02:00)', () => {
    expect(isOnlineOrderingOpen(cfg, at(3, 2, 0))).toBe(false);
  });
  it('is closed late morning before opening', () => {
    expect(isOnlineOrderingOpen(cfg, at(3, 10, 59))).toBe(false);
  });
  it('honours spillover only for scheduled previous days (Monday 01:00 ← Sunday window)', () => {
    // Sunday is in days, so Monday 01:00 is covered by Sunday's 11:00→02:00 tail.
    expect(isOnlineOrderingOpen(cfg, at(1, 1, 0))).toBe(true);
  });
});

describe('isOnlineOrderingOpen — degenerate equal times', () => {
  it('treats open == close as 24h on scheduled days', () => {
    const cfg = { enabled: true, openTime: '00:00', closeTime: '00:00', days: [1] };
    expect(isOnlineOrderingOpen(cfg, at(1, 3, 0))).toBe(true);
    expect(isOnlineOrderingOpen(cfg, at(2, 3, 0))).toBe(false);
  });
});

describe('describeOnlineOrderingHours', () => {
  it('returns null for absent/disabled schedules', () => {
    expect(describeOnlineOrderingHours(undefined)).toBeNull();
    expect(describeOnlineOrderingHours({ enabled: false, openTime: '09:00', closeTime: '22:00' })).toBeNull();
  });
  it('renders a daily label', () => {
    expect(describeOnlineOrderingHours({ enabled: true, openTime: '09:00', closeTime: '22:00', days: [0, 1, 2, 3, 4, 5, 6] }))
      .toBe('Daily, 09:00–22:00');
  });
});
