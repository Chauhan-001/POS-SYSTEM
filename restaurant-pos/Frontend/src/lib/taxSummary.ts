/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * taxSummary — deterministic per-slab tax aggregation for receipts.
 *
 * The receipt is a PRESENTATION layer: it never calculates financial truth on
 * its own. This helper only RE-DERIVES the same breakdown the billing engine
 * already computed at checkout, using the bill's own stored snapshots
 * (priceAtSale, gstRateAtSale, discountAtSale, quantity). It mirrors
 * useBilling.calculateCartTaxes() exactly:
 *
 *   rowTotal    = price × qty
 *   proportion  = rowTotal / subtotal
 *   rowDiscount = billDiscount × proportion
 *   rowTaxable  = max(0, rowTotal - rowDiscount)
 *   rowTax      = rowTaxable × (gstRate/100)
 *
 * Lines are then grouped by GST rate so a single bill can show 5% + 12% + 18%
 * slabs. Intra-state CGST/SGST is the half-split the receipt always used;
 * callers that know a transaction is IGST can pass `mode: 'igst'` to show a
 * single IGST component instead.
 */

export interface TaxComponent {
  type: 'CGST' | 'SGST' | 'IGST';
  rate: number; // component rate (e.g. 2.5 for CGST of a 5% slab)
  amount: number;
}

export interface TaxSlabRow {
  rate: number; // total GST rate, e.g. 5 | 12 | 18
  taxableAmount: number;
  taxAmount: number;
  components: TaxComponent[];
}

export interface TaxSummary {
  rows: TaxSlabRow[];
  totalTaxable: number;
  totalTax: number;
  mode: 'cgst_sgst' | 'igst';
}

export interface TaxSummaryItemLike {
  price?: number;
  quantity?: number;
  isFree?: boolean;
  cancelled?: boolean;
  product?: { gstPercent?: number };
  /** Historical snapshot fields persisted by the backend bill service. */
  priceAtSale?: number;
  gstRateAtSale?: number;
  discountAtSale?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the per-slab tax breakdown for a bill's line items.
 * `billDiscount` is the bill-level discount; it is allocated across rows by
 * each row's share of the subtotal — the same rule the billing engine uses.
 */
export function computeTaxSummary(items: TaxSummaryItemLike[], billDiscount = 0, mode: 'cgst_sgst' | 'igst' = 'cgst_sgst'): TaxSummary {
  const list = Array.isArray(items) ? items : [];
  const billable = list.filter((it) => !it.cancelled && !it.isFree);
  // Prefer the backend's historical snapshot (priceAtSale) over the live
  // cart price — historical bills must reproduce the tax applied at sale time.
  const subtotal = round2(billable.reduce((s, it) => s + (it.priceAtSale ?? it.price ?? 0) * (it.quantity || 0), 0));

  const rows = new Map<number, { taxable: number; tax: number }>();

  for (const it of billable) {
    const unitPrice = it.priceAtSale ?? it.price ?? 0;
    const rowTotal = unitPrice * (it.quantity || 0);
    const rate = Number(it.gstRateAtSale ?? it.product?.gstPercent ?? 0) || 0;
    const proportion = subtotal > 0 ? rowTotal / subtotal : 0;
    // discountAtSale (per-line, from the backend) wins; otherwise allocate the
    // bill discount proportionally — identical to the checkout engine.
    const rowDiscount = it.discountAtSale != null ? it.discountAtSale : billDiscount * proportion;
    const rowTaxable = Math.max(0, rowTotal - rowDiscount);
    const rowTax = round2(rowTaxable * (rate / 100));

    const cur = rows.get(rate) || { taxable: 0, tax: 0 };
    cur.taxable = round2(cur.taxable + rowTaxable);
    cur.tax = round2(cur.tax + rowTax);
    rows.set(rate, cur);
  }

  const sortedRates = [...rows.keys()].sort((a, b) => a - b);
  const rowsOut: TaxSlabRow[] = sortedRates.map((rate) => {
    const { taxable, tax } = rows.get(rate)!;
    const components: TaxComponent[] =
      mode === 'igst'
        ? [{ type: 'IGST', rate, amount: round2(tax) }]
        : [
            { type: 'CGST', rate: round2(rate / 2), amount: round2(tax / 2) },
            { type: 'SGST', rate: round2(rate / 2), amount: round2(tax / 2) },
          ];
    return { rate, taxableAmount: round2(taxable), taxAmount: round2(tax), components };
  });

  return {
    rows: rowsOut,
    totalTaxable: round2(rowsOut.reduce((s, r) => s + r.taxableAmount, 0)),
    totalTax: round2(rowsOut.reduce((s, r) => s + r.taxAmount, 0)),
    mode,
  };
}
