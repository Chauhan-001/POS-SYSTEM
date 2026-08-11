/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryEvent Model — Audit feed of non-purchase inventory activity
 * (sold / adjusted / waste / closing). Mirrors the Purchase collection so the
 * Inventory Activity timeline has real, restaurant-scoped history instead of
 * static demo rows.
 *
 * - sold:    items consumed through real bills (derived at backfill time)
 * - closing: end-of-day stock counts (derived from DailySummary snapshots)
 * - adjusted: manual corrections / staff consumption
 * - waste:   spoiled, expired or dropped stock
 */

import mongoose, { Schema, Document } from 'mongoose';

export type InventoryEventType = 'sold' | 'adjusted' | 'waste' | 'closing' | 'purchase' | 'return';

export interface IInventoryEvent extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  type: InventoryEventType;
  item: string;
  quantity: number;
  unit: string;
  operator: string;
  details: string;
  /** YYYY-MM-DD event date — same convention as purchases. */
  eventDate: string;
  /** Optional source reference (e.g. the VoiceAuditLog id that created this
   *  event) so a voice undo can remove exactly the rows it produced. */
  refId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InventoryEventSchema = new Schema<IInventoryEvent>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    type: { type: String, required: true, enum: ['sold', 'adjusted', 'waste', 'closing', 'purchase', 'return'], index: true },
    item: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    unit: { type: String, default: 'kg', trim: true },
    operator: { type: String, default: 'System', trim: true },
    details: { type: String, required: true, trim: true },
    eventDate: { type: String, required: true, trim: true },
    /** Optional source reference (e.g. the VoiceAuditLog id that created this
     *  event) so a voice undo can remove exactly the rows it produced. */
    refId: { type: String, trim: true, default: undefined },
  },
  { timestamps: true }
);

InventoryEventSchema.index({ restaurantId: 1, eventDate: -1, createdAt: -1 });
InventoryEventSchema.index({ restaurantId: 1, type: 1, eventDate: -1 });

export default mongoose.model<IInventoryEvent>('InventoryEvent', InventoryEventSchema);
