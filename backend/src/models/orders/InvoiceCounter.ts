/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InvoiceCounter Model — Atomic sequence counter for invoice numbers.
 * Uses MongoDB's findOneAndUpdate with $inc for thread-safe increments.
 * This prevents duplicate invoice numbers across multiple POS terminals.
 *
 * The counter is initialized to settings.invoiceStartingNumber (default 1001)
 * on first access. The branchId field enables per-branch sequences.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceCounter extends Document {
  name: string;       // e.g. 'invoice' or 'invoice_branch_xxx'
  sequence: number;   // current counter value
  branchId?: string;  // optional per-branch sequence
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceCounterSchema = new Schema<IInvoiceCounter>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    sequence: { type: Number, required: true, default: 1001 },
    branchId: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IInvoiceCounter>('InvoiceCounter', InvoiceCounterSchema);
