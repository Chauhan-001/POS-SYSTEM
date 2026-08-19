/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * invoiceRange tests — the per-terminal reserved invoice-number range store.
 *
 * The server hands each terminal a disjoint range from the shared atomic
 * counter (see backend billService.reserveInvoiceRange). This store hands
 * numbers out locally so offline bills never collide. Covered here:
 *   - consume from an empty/missing range → null (caller must refill online)
 *   - store + sequential consumption within the range
 *   - exhaustion → null and the range is cleared (so a fresh one is reserved)
 *   - defensive rejection of malformed ranges
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInvoiceRange,
  storeInvoiceRange,
  consumeInvoiceNumber,
  invoiceNumbersRemaining,
  clearInvoiceRange,
} from '../invoiceRange';

describe('invoiceRange — per-terminal reserved range store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no range is reserved (offline, never warmed up)', () => {
    expect(getInvoiceRange()).toBeNull();
    expect(consumeInvoiceNumber()).toBeNull();
    expect(invoiceNumbersRemaining()).toBe(0);
  });

  it('hands out numbers sequentially within the reserved range', () => {
    storeInvoiceRange(1001, 1100);
    expect(invoiceNumbersRemaining()).toBe(100);
    expect(consumeInvoiceNumber()).toBe(1001);
    expect(consumeInvoiceNumber()).toBe(1002);
    expect(invoiceNumbersRemaining()).toBe(98);
    expect(consumeInvoiceNumber()).toBe(1003);
  });

  it('clears the range once exhausted so a fresh one is reserved', () => {
    storeInvoiceRange(10, 12);
    expect(consumeInvoiceNumber()).toBe(10);
    expect(consumeInvoiceNumber()).toBe(11);
    expect(consumeInvoiceNumber()).toBe(12);
    // Exhausted → null, and the stale range is dropped (refill path).
    expect(consumeInvoiceNumber()).toBeNull();
    expect(getInvoiceRange()).toBeNull();
  });

  it('defensively rejects malformed persisted ranges', () => {
    localStorage.setItem('pos_invoice_range', JSON.stringify({ start: 'x', end: 100, next: 1 }));
    expect(getInvoiceRange()).toBeNull();
    expect(consumeInvoiceNumber()).toBeNull();
  });

  it('clearInvoiceRange drops the reservation', () => {
    storeInvoiceRange(1001, 1100);
    clearInvoiceRange();
    expect(getInvoiceRange()).toBeNull();
    expect(consumeInvoiceNumber()).toBeNull();
  });
});
