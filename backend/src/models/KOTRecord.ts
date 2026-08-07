/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KOTRecord Model — Kitchen Order Ticket records for the Kitchen Display System (KDS).
 * Each KOT represents a batch of items sent to the kitchen (original, additional, or reprint).
 * KOTs are linked to an order and contain item snapshots at the time of printing.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IKOTRecord extends Document {
  orderId: mongoose.Types.ObjectId;
  kotNumber: number;
  type: 'Original' | 'Additional' | 'Reprint';
  items: Array<{
    itemName: string;
    quantity: number;
    notes?: string;
    variantName?: string;
  }>;
  printedBy: string;
  note?: string;
  createdAt: Date;
}

const KOTRecordSchema = new Schema<IKOTRecord>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    kotNumber: { type: Number, required: true },
    type: { type: String, required: true, enum: ['Original', 'Additional', 'Reprint'] },
    items: [{
      itemName: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      notes: { type: String, trim: true },
      variantName: { type: String, trim: true },
    }],
    printedBy: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

KOTRecordSchema.index({ orderId: 1, kotNumber: -1 });

export default mongoose.model<IKOTRecord>('KOTRecord', KOTRecordSchema);
