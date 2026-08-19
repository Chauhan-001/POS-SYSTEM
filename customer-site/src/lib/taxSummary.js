/**
 * ReceiptPage tax helpers — deterministic per-slab aggregation for the
 * customer receipt. Mirrors the POS billing engine's math (per-line GST with
 * proportional discount allocation) so the digital receipt always matches the
 * printed thermal receipt and the backend totals.
 */

export function computeTaxSummary(items, billDiscount = 0) {
  const list = Array.isArray(items) ? items : [];
  const billable = list.filter((it) => !it.cancelled && !it.isFree);
  const subtotal = billable.reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);

  const byRate = new Map();
  for (const it of billable) {
    const rowTotal = (it.price || 0) * (it.quantity || 0);
    const rate = Number(it.gstRate ?? it.product?.gstPercent ?? 0) || 0;
    const proportion = subtotal > 0 ? rowTotal / subtotal : 0;
    const rowDiscount = billDiscount * proportion;
    const taxable = Math.max(0, rowTotal - rowDiscount);
    const tax = taxable * (rate / 100);
    const cur = byRate.get(rate) || { taxable: 0, tax: 0 };
    cur.taxable += taxable;
    cur.tax += tax;
    byRate.set(rate, cur);
  }

  const rows = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({
      rate,
      taxableAmount: Math.round(v.taxable * 100) / 100,
      taxAmount: Math.round(v.tax * 100) / 100,
      cgst: Math.round((v.tax / 2) * 100) / 100,
      sgst: Math.round((v.tax / 2) * 100) / 100,
    }));

  return {
    rows,
    totalTax: Math.round(rows.reduce((s, r) => s + r.taxAmount, 0) * 100) / 100,
  };
}
