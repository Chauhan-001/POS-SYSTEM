/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KOTRecord Model — Kitchen Order Ticket records for the Kitchen Display System (KDS).
 * Each KOT represents a batch of items sent to the kitchen (original, additional, or reprint).
 * KOTs are linked to an order and contain item snapshots at the time of printing.
 *
 * Phase: KDS sync for order adjustments — items carry `productId` (so the
 * adjustment service can mark the matching KOT lines cancelled) and per-item
 * `cancelled`/`cancelReason`/`cancelledAt` flags (so the KDS instantly shows a
 * strikethrough when an unavailable item is removed/replaced). `toFrontend()`
 * serializes a stored KOT into the exact shape the POS KitchenDisplay renders.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IKOTItem {
  /** Product reference — enables adjustment → KOT line matching. */
  productId?: string;
  /** Stable per-line key from the POS cart — prevents same-product lines
   * (different variants/notes) colliding on id after a server round-trip. */
  lineId?: string;
  itemName: string;
  quantity: number;
  price?: number;
  notes?: string;
  variantName?: string;
  /** Phase 4 — human-readable configured line for the kitchen display. */
  configSummary?: string;
  /** Set server-side when an order adjustment removes this item. */
  cancelled?: boolean;
  cancelReason?: string;
  cancelledAt?: string;
}

export interface IKOTRecord extends Document {
  orderId: mongoose.Types.ObjectId;
  kotNumber: number;
  type: 'Original' | 'Additional' | 'Reprint';
  /** Kitchen workflow status — mirrors the POS KOTStatus type. */
  status: 'Accepted' | 'Preparing' | 'Ready' | 'Served' | 'Cancelled';
  items: IKOTItem[];
  printedBy: string;
  printedAt?: Date;
  note?: string;
  createdAt: Date;
}

const KOTRecordSchema = new Schema<IKOTRecord>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    kotNumber: { type: Number, required: true },
    type: { type: String, required: true, enum: ['Original', 'Additional', 'Reprint'] },
    status: { type: String, default: 'Accepted', enum: ['Accepted', 'Preparing', 'Ready', 'Served', 'Cancelled'] },
    items: [{
      productId: { type: String, trim: true },
      lineId: { type: String, trim: true },
      itemName: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, min: 0 },
      notes: { type: String, trim: true },
      variantName: { type: String, trim: true },
      /** Phase 4 — human-readable configured line for the kitchen display
       *  ("Large • Cheese Burst • Mushroom"). Never internal ids/versions. */
      configSummary: { type: String, trim: true, maxlength: 500 },
      cancelled: { type: Boolean, default: false },
      cancelReason: { type: String, trim: true },
      cancelledAt: { type: String, trim: true },
    }],
    printedBy: { type: String, required: true, trim: true },
    printedAt: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

KOTRecordSchema.index({ orderId: 1, kotNumber: -1 });

/**
 * Serialize a stored KOT into the POS frontend shape (KOTRecord type).
 * Items become CartItem-like objects (id/product/quantity/notes/price +
 * cancellation flags) so KitchenDisplay can render them without mapping.
 */
export function kotToFrontend(kot: any): any {
  const doc = kot && typeof kot.toObject === 'function' ? kot.toObject() : kot;
  if (!doc) return doc;
  const items = Array.isArray(doc.items) ? doc.items : [];
  return {
    id: String(doc._id || doc.id || ''),
    kotNumber: doc.kotNumber,
    type: doc.type,
    status: doc.status || 'Accepted',
    items: items.map((item: any) => ({
      id: item.lineId || item.productId || item.itemName,
      product: {
        id: item.productId,
        _id: item.productId,
        name: item.itemName,
        price: item.price || 0,
      },
      quantity: item.quantity,
      notes: item.notes,
      variantName: item.variantName,
      configSummary: item.configSummary,
      price: item.price || 0,
      cancelled: !!item.cancelled,
      cancelReason: item.cancelReason,
      cancelledAt: item.cancelledAt,
    })),
    printedAt: doc.printedAt ? new Date(doc.printedAt).toISOString() : new Date(doc.createdAt || Date.now()).toISOString(),
    printedBy: doc.printedBy || 'System',
    note: doc.note,
  };
}

export default mongoose.model<IKOTRecord>('KOTRecord', KOTRecordSchema);
