/**
 * =============================================================================
 * businessDay.ts — HISTORICAL DATA FOUNDATION, PHASE 1 (BUSINESS-DATE CONTRACT)
 * =============================================================================
 *
 * The contract for resolving a restaurant's BUSINESS DATE from an instant, using
 * the restaurant timezone — the fix direction for finding D5 (analytics currently
 * slices `toISOString().substring(0,10)`, i.e. UTC midnight, ignoring the tenant's
 * timezone).
 *
 * PHASE BOUNDARY: this file provides the CONTRACT and a pure reference
 * implementation. It is NOT wired into analyticsService / reporting in Phase 1 —
 * any adoption that changes derived daily facts is a production-behaviour change
 * and belongs to Phase 3 with explicit approval. Nothing here reads or writes the
 * database, and no existing behaviour is altered.
 *
 * NOTE: the repository already has a business-date helper for the Z-report path
 * (`src/ai/agents/zReportContext.ts` → `normalizeBusinessDate`). Phase 3 must
 * evaluate reusing THAT helper before adopting this one; this file exists to
 * freeze the contract, not to duplicate production logic.
 */

import { isBusinessDate } from './dataContract';

export interface BusinessDayResolver {
  /** Restaurant timezone, IANA name, e.g. "Asia/Kolkata". */
  timezone: string;
  /**
   * Resolve the business date (YYYY-MM-DD) for an instant. Pure:
   * no I/O, no clock reads.
   */
  businessDateFor(instant: Date | number | string): string;
}

/** True when `tz` is an IANA timezone the runtime understands. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure reference: the calendar date of `instant` in `timezone`.
 *
 * This is the correct alternative to UTC slice. It does NOT assume UTC midnight
 * is the business day. If the timezone is invalid it throws rather than silently
 * falling back to UTC (silent fallback is how D5 happened).
 */
export function businessDateForTimezone(
  instant: Date | number | string,
  timezone: string,
): string {
  if (!isValidTimezone(timezone)) {
    throw new Error(`invalid timezone "${timezone}"`);
  }
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid instant: ${String(instant)}`);
  }
  // en-CA yields YYYY-MM-DD; 'sv-SE' also yields ISO-like dates. Use parts to be
  // locale-proof across Node builds.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const result = `${get('year')}-${get('month')}-${get('day')}`;
  if (!isBusinessDate(result)) {
    throw new Error(`resolved invalid business date "${result}" for tz ${timezone}`);
  }
  return result;
}

/** The current production behaviour (UTC slice), kept for comparison + tests. */
export function utcSliceBusinessDate(instant: Date | number | string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return d.toISOString().substring(0, 10);
}

/** Pure date arithmetic on a YYYY-MM-DD business date (calendar-day based). */
export function addBusinessDays(date: string, delta: number): string {
  if (!isBusinessDate(date)) throw new Error(`invalid business date ${date}`);
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().substring(0, 10);
}

/** Inclusive list of business dates from start..end. */
export function businessDateRange(start: string, end: string): string[] {
  if (!isBusinessDate(start) || !isBusinessDate(end)) {
    throw new Error(`invalid range ${start}..${end}`);
  }
  const out: string[] = [];
  let cur = start;
  if (start > end) return out;
  // Guard against pathological ranges (prompt: never load an unbounded span).
  for (let i = 0; i < 3660 && cur <= end; i++) {
    out.push(cur);
    cur = addBusinessDays(cur, 1);
  }
  return out;
}

export const businessDay: BusinessDayResolver = {
  timezone: 'UTC',
  businessDateFor: (instant) => businessDateForTimezone(instant, 'UTC'),
};
