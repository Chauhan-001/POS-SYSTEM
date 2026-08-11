/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QrToken Model — printable QR stickers for QR ordering.
 *
 * One row per sticker. `token` is the opaque capability embedded in the QR
 * (resolves the restaurant via Restaurant.publicToken resolution logic in the
 * public-store module); the sticker's context (table / car slot / pickup) rides
 * in the generated `url` query string so the customer site knows the mode
 * without any server round-trip.
 *
 * Tokens are tenant-scoped: a token row always belongs to exactly one
 * restaurant (and optionally one branch).
 *
 * NEVER-EXPIRE GUARANTEE: QrToken rows have NO TTL index and the `active`
 * flag is never flipped automatically — a printed sticker keeps working
 * forever. A table sticker changes only when (a) the owner explicitly
 * regenerates it in QR Studio, or (b) it is first created automatically for a
 * brand-new table (tableService → qrTokenService.upsertTableSticker).
 * Auto-generation never modifies existing rows, so refreshing a sticker is
 * always an explicit owner action.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type QrTokenType = 'table' | 'car' | 'pickup';

export interface IQrToken extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  type: QrTokenType;
  /** Table (type === 'table') — linked to the POS Table record. */
  tableId?: mongoose.Types.ObjectId | null;
  /** Snapshot of the table number at generation time (stickers stay readable). */
  tableNumber?: number | null;
  /** Car parking slot label (type === 'car'). */
  parkingSlot?: string | null;
  /** Opaque sticker capability (unique across the whole deployment). */
  token: string;
  /** Full customer-site URL baked into the QR. */
  url: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const QrTokenSchema = new Schema<IQrToken>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    type: { type: String, enum: ['table', 'car', 'pickup'], required: true, index: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null },
    tableNumber: { type: Number, default: null },
    parkingSlot: { type: String, trim: true, default: null },
    token: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

QrTokenSchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
// One sticker per table — regenerating an existing table token replaces it.
QrTokenSchema.index(
  { restaurantId: 1, tableId: 1 },
  { unique: true, partialFilterExpression: { tableId: { $type: 'objectId' } } }
);

export default mongoose.model<IQrToken>('QrToken', QrTokenSchema);
