/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CashLedger Model — True cash-flow ledger (Phase 1.7).
 * Every cash movement is an immutable entry: opening cash, cash in/out,
 * expense deductions, drawer adjustments, bank deposits/withdrawals and shift
 * closings (with over/short). balanceAfter is the running cash balance.
 * Deletion is disallowed by the service; entries are append-only + audited.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CashLedgerType =
  | 'opening'
  | 'cash_in'
  | 'cash_out'
  | 'expense'
  | 'drawer_adjustment'
  | 'shift_closing'
  | 'bank_deposit'
  | 'bank_withdrawal';

export interface ICashLedger extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  date: string;                     // YYYY-MM-DD
  type: CashLedgerType;
  amount: number;                   // positive for in, negative for out
  balanceAfter: number;
  refType?: string;                 // 'expense' | 'bill' | 'shift' | 'bank'
  refId?: string;
  note?: string;
  shiftId?: string;
  /** For shift_closing — counted cash & over/short. */
  countedCash?: number;
  overShort?: number;
  performedBy?: string;
  /** Soft-delete flag — present so the base repository's standard filter works. */
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CashLedgerSchema = new Schema<ICashLedger>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    date: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: ['opening', 'cash_in', 'cash_out', 'expense', 'drawer_adjustment', 'shift_closing', 'bank_deposit', 'bank_withdrawal'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    refType: { type: String, trim: true },
    refId: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 1000 },
    shiftId: { type: String, trim: true },
    countedCash: { type: Number },
    overShort: { type: Number },
    performedBy: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CashLedgerSchema.index({ restaurantId: 1, date: -1 });
CashLedgerSchema.index({ restaurantId: 1, branchId: 1, date: -1 });
CashLedgerSchema.index({ restaurantId: 1, type: 1, date: -1 });

export default mongoose.model<ICashLedger>('CashLedger', CashLedgerSchema);
