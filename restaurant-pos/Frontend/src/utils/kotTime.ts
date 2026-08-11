/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KOT timestamp helpers.
 *
 * KOT records historically stored `printedAt` as a *display* string
 * (`new Date().toLocaleTimeString()` → "10:03:25 PM"), which is not
 * parseable by `new Date()` — that made the Kitchen display compute
 * NaN and render "NaNh NaNm ago". New records store an ISO timestamp.
 * These helpers parse both formats (ISO first, legacy time-of-day as a
 * fallback) and never return NaN.
 */

const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

/**
 * Best-effort epoch-millis for a KOT `printedAt` value.
 *
 * - ISO timestamps parse directly.
 * - Legacy display strings ("10:03:25 PM", "10:03 PM") are interpreted as
 *   today's time-of-day.
 * - Anything else (missing/garbage) returns null — callers must treat null
 *   as "unknown" and never render NaN.
 */
export function kotPrintedTimeMs(printedAt?: string | null): number | null {
  if (!printedAt) return null;
  const asDate = new Date(printedAt);
  const ms = asDate.getTime();
  if (Number.isFinite(ms)) return ms;

  const m = TIME_ONLY_RE.exec(printedAt.trim());
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = m[3] ? parseInt(m[3], 10) : 0;
    const suffix = (m[4] || '').toUpperCase();
    if (suffix === 'PM' && h < 12) h += 12;
    if (suffix === 'AM' && h === 12) h = 0;
    if (h > 23 || min > 59 || sec > 59) return null;
    const d = new Date();
    d.setHours(h, min, sec, 0);
    let ms = d.getTime();
    // Legacy strings carry no date. If the parsed time-of-day is in the
    // future, the KOT was almost certainly printed yesterday (overnight or
    // held-over orders) — shift it back a day so the elapsed time is sane.
    if (ms > Date.now()) ms -= 86400000;
    return ms;
  }
  return null;
}

/**
 * Whole elapsed minutes since a KOT was printed.
 * Returns 0 for unknown/missing timestamps so callers never see NaN.
 */
export function getKOTElapsedMinutes(
  printedAt?: string | null,
  nowMs: number = Date.now(),
): number {
  const ms = kotPrintedTimeMs(printedAt);
  if (ms == null) return 0;
  return Math.max(0, Math.floor((nowMs - ms) / 60000));
}

/**
 * Display-safe KOT timestamp: formats ISO timestamps as a short
 * locale string ("09 Aug, 10:03 PM") and passes legacy display
 * strings through unchanged.
 */
export function formatKOTTimestamp(printedAt?: string | null): string {
  if (!printedAt) return '';
  const asDate = new Date(printedAt);
  if (Number.isFinite(asDate.getTime())) {
    return asDate.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  // Already a display-formatted string (legacy records, previews).
  return printedAt;
}
