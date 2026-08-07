/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FinanceSettings Model — Per-restaurant finance configuration (Phase 1.7).
 * Single document per restaurant (upserted on first use). Controls GST
 * accounting defaults (CGST/SGST/IGST/CESS, HSN/SAC enforcement, inclusive vs
 * exclusive), the COGS strategy for the profit engine, and the cash drawer
 * opening default. These are server-side source-of-truth values.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IFinanceSettings extends Document {
  restaurantId: mongoose.Types.ObjectId;
  // ── GST accounting ────────────────────────────────────────
  gstEnabled: boolean;
  gstMode: 'inclusive' | 'exclusive';
  defaultCgst: number;              // %
  defaultSgst: number;              // %
  defaultIgst: number;              // %
  defaultCess: number;              // %
  hsnRequired: boolean;
  sacRequired: boolean;
  // ── Profit engine ─────────────────────────────────────────
  cogsMode: 'auto' | 'category';    // 'auto' = Ingredients & Raw Materials → COGS; 'category' = use isCogs flags
  // ── Cash drawer ───────────────────────────────────────────
  openingCashDefault: number;
  updatedBy?: string;
  /** Soft-delete flag — present so the base repository's standard filter works. */
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FinanceSettingsSchema = new Schema<IFinanceSettings>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true, index: true },
    gstEnabled: { type: Boolean, default: true },
    gstMode: { type: String, enum: ['inclusive', 'exclusive'], default: 'inclusive' },
    defaultCgst: { type: Number, default: 2.5, min: 0, max: 100 },
    defaultSgst: { type: Number, default: 2.5, min: 0, max: 100 },
    defaultIgst: { type: Number, default: 5, min: 0, max: 100 },
    defaultCess: { type: Number, default: 0, min: 0, max: 100 },
    hsnRequired: { type: Boolean, default: false },
    sacRequired: { type: Boolean, default: false },
    cogsMode: { type: String, enum: ['auto', 'category'], default: 'auto' },
    openingCashDefault: { type: Number, default: 0, min: 0 },
    updatedBy: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model<IFinanceSettings>('FinanceSettings', FinanceSettingsSchema);
