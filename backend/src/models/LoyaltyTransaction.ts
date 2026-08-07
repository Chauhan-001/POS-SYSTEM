/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LoyaltyTransaction Model — Append-only points & wallet ledger (Phase 1.6).
 * Every point movement (earn, redeem, expiry, adjustment, referral, bonus)
 * and wallet movement is recorded here. This ledger is the fraud-prevention
 * backbone: redemptions consume from a FIFO pool of unexpired earn entries
 * (tracked via remaining/expiresAt), which makes negative balances,
 * double-redemption and duplicate bill rewards impossible at the data layer.
 *
 * Rules:
 *  - Positive transactions (earn/welcome/birthday/referral/adjustment) create
 *    pool entries with `remaining` and `expiresAt`.
 *  - Negative transactions (redeem) consume pool entries FIFO and record the
 *    consumedFrom detail for full auditability.
 *  - Never delete or mutate past entries — append corrections instead.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type LoyaltyTransactionType =
  | 'earn'
  | 'welcome'
  | 'birthday'
  | 'anniversary'
  | 'referral'
  | 'adjustment'
  | 'redeem'
  | 'expiry'
  | 'refund'
  | 'wallet_credit'
  | 'wallet_debit';

export interface ILoyaltyTransaction extends Document {
  restaurantId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  customerPhone?: string;
  branchId?: mongoose.Types.ObjectId;
  type: LoyaltyTransactionType;
  /** Signed point delta (positive = credit, negative = debit). 0 for wallet-only rows. */
  points: number;
  /** Signed wallet delta. 0 for points-only rows. */
  wallet: number;
  /** Customer's points balance after this transaction */
  balanceAfter: number;
  /** Customer's wallet balance after this transaction */
  walletBalanceAfter: number;
  description?: string;
  refType?: string;    // 'bill' | 'reward' | 'offer' | 'referral' | 'otp'
  refId?: string;      // bill id / reward id / referral id
  // ── FIFO point pool (earn rows only) ──────────────────────
  remaining?: number;  // unspent points in this entry
  expiresAt?: Date | null;
  consumedFrom?: Array<{ transactionId: string; points: number }>;
  createdBy?: string;
  createdAt: Date;
}

const LoyaltyTransactionSchema = new Schema<ILoyaltyTransaction>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerPhone: { type: String, trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    type: { type: String, enum: [
      'earn', 'welcome', 'birthday', 'anniversary', 'referral', 'adjustment',
      'redeem', 'expiry', 'refund', 'wallet_credit', 'wallet_debit',
    ], required: true },
    points: { type: Number, default: 0 },
    wallet: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    walletBalanceAfter: { type: Number, default: 0 },
    description: { type: String, trim: true },
    refType: { type: String, trim: true },
    refId: { type: String, trim: true },
    remaining: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
    consumedFrom: {
      type: [new Schema({ transactionId: { type: String }, points: { type: Number, min: 0 } }, { _id: false })],
      default: undefined,
    },
    createdBy: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LoyaltyTransactionSchema.index({ restaurantId: 1, customerId: 1, createdAt: -1 });
LoyaltyTransactionSchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
LoyaltyTransactionSchema.index({ restaurantId: 1, createdAt: -1 });
LoyaltyTransactionSchema.index({ customerId: 1, remaining: 1, expiresAt: 1 });

export default mongoose.model<ILoyaltyTransaction>('LoyaltyTransaction', LoyaltyTransactionSchema);
