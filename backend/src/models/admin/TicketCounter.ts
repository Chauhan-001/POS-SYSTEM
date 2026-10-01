/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TicketCounter Model — Supports gapless sequential ticket numbers.
 *
 * A single row (name='support_ticket') is upserted atomically with an $inc so
 * concurrent ticket creation always receives a unique, sequential number
 * (e.g. TKT-000001, TKT-000002, ...). Mirrors the InvoiceCounter pattern.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketCounter extends Document {
  name: string;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

const TicketCounterSchema = new Schema<ITicketCounter>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<ITicketCounter>('TicketCounter', TicketCounterSchema);