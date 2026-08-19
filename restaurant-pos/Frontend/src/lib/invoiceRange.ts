/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * invoiceRange.ts — per-terminal reserved invoice-number range.
 *
 * The server atomically reserves contiguous ranges from the shared
 * InvoiceCounter (GET /api/bills/invoice-range). This module persists THIS
 * terminal's reserved range in localStorage and hands out numbers locally, so
 * offline billing draws from a range no other terminal can own — offline
 * invoices can never collide on numbers (the old localStorage counter seeded
 * every terminal at 1001).
 *
 * Lifecycle:
 *   - useBilling warms up a range on app load (online) via fetchInvoiceRange.
 *   - Every checkout consumes the next number from the local range.
 *   - When the range is exhausted and the terminal is online, a fresh range is
 *     reserved; offline with an exhausted range falls back to the legacy local
 *     counter (a last-resort safety net, not the normal path).
 */

import { getDBData, setDBData } from '../data';

export interface InvoiceRange {
  /** Inclusive range boundaries owned by this terminal. */
  start: number;
  end: number;
  /** Next number to hand out (start..end inclusive). */
  next: number;
}

const RANGE_KEY = 'pos_invoice_range';

/** Read this terminal's reserved range (null when none is cached). */
export function getInvoiceRange(): InvoiceRange | null {
  const range = getDBData<InvoiceRange | null>(RANGE_KEY, null);
  if (!range) return null;
  // Defensive: reject malformed/fully-consumed ranges.
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || !Number.isInteger(range.next)) return null;
  return range;
}

/** Store a freshly reserved range (next starts at the range start). */
export function storeInvoiceRange(start: number, end: number): InvoiceRange {
  const range: InvoiceRange = { start, end, next: start };
  setDBData(RANGE_KEY, range);
  return range;
}

/**
 * Hand out the next invoice number from the reserved range, or null when the
 * range is missing/exhausted (caller must reserve a fresh one online).
 */
export function consumeInvoiceNumber(): number | null {
  const range = getInvoiceRange();
  if (!range) return null;
  if (range.next > range.end) {
    clearInvoiceRange();
    return null;
  }
  const number = range.next;
  range.next += 1;
  setDBData(RANGE_KEY, range);
  return number;
}

/** How many numbers remain in the reserved range (0 when none). */
export function invoiceNumbersRemaining(): number {
  const range = getInvoiceRange();
  if (!range) return 0;
  return Math.max(0, range.end - range.next + 1);
}

/** Drop the reserved range (restaurant change, range consumed, or reset). */
export function clearInvoiceRange(): void {
  setDBData(RANGE_KEY, null);
}
