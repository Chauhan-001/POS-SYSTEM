/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OnlineOrderingHours — deterministic evaluator for the online-ordering
 * schedule edited from the POS "Menu Availability" screen.
 *
 * Schedule shape (stored in settings as `onlineOrderingHours`):
 *   {
 *     enabled: boolean,        // false = storefront accepts orders 24/7
 *     openTime: 'HH:mm',       // 24h local time
 *     closeTime: 'HH:mm',      // 24h local time
 *     days: number[],          // 0=Sunday … 6=Saturday (weekday schedule)
 *   }
 *
 * Semantics (deliberately simple — no ambiguity):
 *   - `enabled: false` (or no schedule saved) → ALWAYS OPEN. Absence of a
 *     schedule must never silently pause a live storefront.
 *   - `closeTime` <= `openTime` is treated as an overnight window (e.g.
 *     11:00 → 02:00 spans midnight into the next day).
 *   - A day is open only when it is listed in `days` AND the current local
 *     time falls inside the window (overnight-aware: late-night minutes of an
 *     unlisted morning count toward the PREVIOUS day's evening window).
 *
 * This is pure logic (no DB, no clock dependency beyond the passed `now`) so
 * it is unit-testable and safe to call on every order request.
 */

export interface OnlineOrderingHoursConfig {
  enabled?: boolean;
  openTime?: string;
  closeTime?: string;
  days?: number[];
}

/** Parse 'HH:mm' → minutes since midnight. Returns null when malformed. */
export function parseHHMM(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function normalizeConfig(raw: OnlineOrderingHoursConfig | undefined | null): {
  open: number;
  close: number;
  days: number[];
} | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.enabled === false) return null; // schedule off = always open
  const open = parseHHMM(raw.openTime);
  const close = parseHHMM(raw.closeTime);
  if (open === null || close === null) return null;
  const days = Array.isArray(raw.days)
    ? raw.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 0) return null; // no days configured = never restrict
  return { open, close, days };
}

/**
 * Is online ordering OPEN for orders right now?
 * @param raw      the saved `onlineOrderingHours` settings blob (may be undefined)
 * @param now      evaluation instant (defaults to Date.now()) — injectable for tests
 */
export function isOnlineOrderingOpen(raw: OnlineOrderingHoursConfig | undefined | null, now: Date = new Date()): boolean {
  const cfg = normalizeConfig(raw);
  if (!cfg) return true; // no/invalid/off schedule → storefront open

  const localMinutes = now.getHours() * 60 + now.getMinutes();
  const weekday = now.getDay(); // 0=Sunday

  const inWindow = (dayMinutes: number): boolean => {
    if (cfg.open === cfg.close) return true; // degenerate equal times → treat as 24h
    if (cfg.close > cfg.open) {
      // Same-day window, e.g. 08:00 → 23:00
      return dayMinutes >= cfg.open && dayMinutes < cfg.close;
    }
    // Overnight window, e.g. 11:00 → 02:00
    return dayMinutes >= cfg.open || dayMinutes < cfg.close;
  };

  if (cfg.days.includes(weekday) && inWindow(localMinutes)) return true;

  // Overnight spillover: the early-morning tail of YESTERDAY's window. E.g.
  // Friday 11:00 → 02:00 means Saturday 00:00–02:00 is still "Friday open".
  if (cfg.close <= cfg.open) {
    const yesterday = (weekday + 6) % 7;
    if (cfg.days.includes(yesterday) && localMinutes < cfg.close) return true;
  }

  return false;
}

/** Human-readable label for banners, e.g. "Tue–Sun, 11:00–02:00". */
export function describeOnlineOrderingHours(raw: OnlineOrderingHoursConfig | undefined | null): string | null {
  const cfg = normalizeConfig(raw);
  if (!cfg) return null;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = cfg.days.length === 7
    ? 'Daily'
    : sortDays(cfg.days).map((d) => names[d]).join('–');
  return `${days}, ${raw!.openTime}–${raw!.closeTime}`;
}

function sortDays(days: number[]): number[] {
  // Start the week on Monday for display (Mon…Sun).
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}
