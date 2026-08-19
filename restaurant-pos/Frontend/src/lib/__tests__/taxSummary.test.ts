/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * computeTaxSummary — the deterministic per-slab breakdown used by the thermal
 * receipt and the customer receipt page. The math must mirror the billing
 * engine (per-line GST, proportional discount allocation) and must prefer the
 * backend's historical snapshots (priceAtSale / gstRateAtSale) over the live
 * product so old bills never drift when tax config changes.
 */
import { describe, expect, it } from 'vitest';
import { computeTaxSummary } from '../taxSummary';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  product: { id: 'x', name: 'Item', gstPercent: 5, availability: true },
  quantity: 1,
  price: 100,
  ...over,
});

describe('computeTaxSummary', () => {
  it('groups two slabs with proportional discount allocation (5% + 18%)', () => {
    const s = computeTaxSummary(
      [
        item({ id: 'a', product: { name: 'Paneer', gstPercent: 5 }, price: 450, quantity: 1 }),
        item({ id: 'b', product: { name: 'Burger', gstPercent: 5 }, price: 300, quantity: 1 }),
        item({ id: 'c', product: { name: 'Coke', gstPercent: 18 }, price: 50, quantity: 1 }),
        item({ id: 'd', product: { name: 'Chips', gstPercent: 12 }, price: 100, quantity: 1 }),
      ],
      30 // discount
    );

    // subtotal 900; discount 30 proportional:
    //  5% group: taxable (450-15)+(300-10) = 725, tax = 36.25
    // 12% group: taxable 100 - 3.33 = 96.67, tax = 11.60
    // 18% group: taxable 50 - 1.67 = 48.33, tax = 8.70
    expect(s.rows.map((r) => r.rate)).toEqual([5, 12, 18]);
    const [r5, r12, r18] = s.rows;
    expect(r5.taxableAmount).toBeCloseTo(725, 1);
    expect(r5.taxAmount).toBeCloseTo(36.25, 1);
    expect(r12.taxableAmount).toBeCloseTo(96.67, 1);
    expect(r18.taxableAmount).toBeCloseTo(48.33, 1);
    // CGST == SGST == half of the slab tax
    expect(r5.components[0].amount).toBeCloseTo(r5.taxAmount / 2, 1);
    expect(r5.components[1].amount).toBeCloseTo(r5.taxAmount / 2, 1);
    // TOTAL TAX must equal the engine's summed tax
    expect(s.totalTax).toBeCloseTo(r5.taxAmount + r12.taxAmount + r18.taxAmount, 1);
  });

  it('prefers historical snapshots (priceAtSale / gstRateAtSale) over the live product', () => {
    const s = computeTaxSummary(
      [item({ product: { gstPercent: 18 }, price: 100, priceAtSale: 200, gstRateAtSale: 5 })],
      0
    );
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].rate).toBe(5); // snapshot rate wins
    expect(s.rows[0].taxableAmount).toBe(200); // snapshot price wins
    expect(s.rows[0].taxAmount).toBe(10);
  });

  it('single slab → one row with the classic half-split', () => {
    const s = computeTaxSummary([item({ price: 500 })], 0);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].rate).toBe(5);
    expect(s.rows[0].taxAmount).toBe(25);
    expect(s.rows[0].components[0].type).toBe('CGST');
    expect(s.rows[0].components[0].amount).toBe(12.5);
    expect(s.rows[0].components[1].type).toBe('SGST');
  });

  it('IGST mode produces a single IGST component per slab', () => {
    const s = computeTaxSummary([item({ price: 100 })], 0, 'igst');
    expect(s.rows[0].components).toHaveLength(1);
    expect(s.rows[0].components[0].type).toBe('IGST');
    expect(s.rows[0].components[0].amount).toBe(5);
  });

  it('excludes free and cancelled items and includes 0% rows', () => {
    const s = computeTaxSummary(
      [
        item({ id: 'a', price: 100, isFree: true }),
        item({ id: 'b', price: 100, cancelled: true }),
        item({ id: 'c', product: { gstPercent: 0 }, price: 50 }),
      ],
      0
    );
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].rate).toBe(0);
    expect(s.rows[0].taxableAmount).toBe(50);
    expect(s.rows[0].taxAmount).toBe(0);
  });

  it('empty / no-tax bills produce an empty summary', () => {
    expect(computeTaxSummary([], 0).rows).toHaveLength(0);
    expect(computeTaxSummary(undefined as any, 0).rows).toHaveLength(0);
  });
});
