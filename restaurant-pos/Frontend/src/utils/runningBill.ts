/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live running-bill totals for dine-in orders.
 * Computes the current bill for an occupied table from its live items (order
 * items or the active cart) using the same tax math as checkout — per-item GST
 * on row totals, no discount until the final bill is closed. Used by the table
 * card running amount and the Live Receipt preview so occupied tables always
 * reflect the latest order state.
 */

import type { CartItem } from '../types';

export interface RunningBillTotals {
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
}

export function computeRunningBillTotals(items: CartItem[] | any[]): RunningBillTotals {
  const list = Array.isArray(items) ? items : [];
  // Mirror the checkout math in useBilling: free items are priced at 0 and
  // cancelled items are excluded, so the running bill stays in sync with the
  // final receipt.
  const billable = list.filter((it: any) => !it.cancelled && !it.isFree);
  const subtotal = billable.reduce((s: number, it: any) => s + (it.price || 0) * (it.quantity || 0), 0);
  const gst = billable.reduce(
    (s: number, it: any) => s + (it.price || 0) * (it.quantity || 0) * ((it.product?.gstPercent || 0) / 100),
    0
  );
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: 0,
    gst: Math.round(gst * 100) / 100,
    grandTotal: Math.round((subtotal + gst) * 100) / 100,
  };
}
