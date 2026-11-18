/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift Model — Cash drawer shift lifecycle (Phase 2).
 *
 * A shift represents a cashier's session at a register. Each shift is tied to
 * exactly one register (deviceId) at one branch. Only one shift may be open
 * per register at a time, enforced by a partial unique index.
 *
 * Bills created while a shift is open carry the shiftId, so every cash
 * transaction is attributable to a specific shift and cashier. This enables
 * accurate cash reconciliation: expected cash = opening + cash sales + manual
 * in − manual out − cash expenses − cash refunds.
 *
 * Security:
 *   - Only the shift opener or a Manager/Owner can close a shift.
 *   - Manager override required when variance ≠ 0.
 *   - Closed shifts are immutable; post-closure bills create explicit
 *     adjustment records rather than modifying the closed snapshot.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ShiftStatus = 'open' | 'closed' | 'archived';

export interface IShift extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  /** Register/device identifier (Device.deviceId). One active shift per register. */
  registerId: string;
  /** Employee who opened the shift. */
  openedBy: mongoose.Types.ObjectId;
  /** Employee assigned to the shift (may differ from opener). */
  assignedStaff?: mongoose.Types.ObjectId;
  /** Opening float entered at shift start. */
  openingCash: number;
  /** Actual cash counted at close (set only on close). */
  closingCash?: number;
  /** Expected cash computed at close: opening + cash sales + in − out − expenses − refunds. */
  expectedCash: number;
  /** closingCash − expectedCash (set only on close). */
  variance?: number;
  status: ShiftStatus;
  openedAt: Date;
  closedAt?: Date;
  /** Manager who approved the variance (required when variance ≠ 0). */
  approvedBy?: mongoose.Types.ObjectId;
  approvalNotes?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShiftSchema = new Schema<IShift>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    registerId: { type: String, required: true, trim: true, index: true },
    openedBy: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    assignedStaff: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    openingCash: { type: Number, required: true, min: 0, default: 0 },
    closingCash: { type: Number, min: 0, default: null },
    expectedCash: { type: Number, min: 0, default: 0 },
    variance: { type: Number, default: null },
    status: {
      type: String,
      enum: ['open', 'closed', 'archived'],
      default: 'open',
      index: true,
    },
    openedAt: { type: Date, required: true, index: true },
    closedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    approvalNotes: { type: String, trim: true, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One active shift per register per branch. Partial index so closed shifts
// don't collide — a register can have many closed shifts but only one open.
ShiftSchema.index(
  { restaurantId: 1, branchId: 1, registerId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open', isDeleted: false } }
);

ShiftSchema.index({ restaurantId: 1, status: 1, openedAt: -1 });
ShiftSchema.index({ restaurantId: 1, openedBy: 1, status: 1 });
ShiftSchema.index({ restaurantId: 1, isDeleted: 1, createdAt: -1 });

export default mongoose.model<IShift>('Shift', ShiftSchema);
