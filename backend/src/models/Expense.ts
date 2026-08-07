/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Expense Model — Operational expense tracking for P&L reporting (Phase 1.7).
 *
 * Multi-tenant (restaurantId) + optional branch scoping. Every expense is
 * versioned (optimistic concurrency for offline edits), can reference a Vendor
 * (finance module), optionally carries receipt attachments, and records a full
 * GST breakdown (CGST/SGST/IGST/CESS). `isCogs` marks inventory/ingredient
 * costs that belong in COGS instead of operating expenses — the real profit
 * engine relies on this flag rather than guessing from the category name.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IExpenseAttachment {
  name: string;
  mime: string;
  size: number;
  url?: string;       // cloud URL (future sync) or Electron-local file path
  storage?: 'local' | 'cloud';
  uploadedBy?: string;
  uploadedAt?: Date;
}

export interface IExpense extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  date: string;
  category: string;             // category NAME snapshot (kept for legacy reports)
  categoryId?: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  paymentMethod: string;
  vendor?: string;              // legacy free-text vendor snapshot
  vendorId?: mongoose.Types.ObjectId;
  notes?: string;
  /** Part of COGS (ingredients/raw materials) — used by the real profit engine. */
  isCogs: boolean;
  // ── GST breakdown ─────────────────────────────────────────
  gst?: {
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    inputGst: boolean;          // input (purchase) vs output (sale)
    taxInclusive: boolean;      // amount includes tax
    hsn?: string;
    sac?: string;
  };
  // ── Attachments (receipts / invoices) ──────────────────────
  attachments: IExpenseAttachment[];
  // ── Recurring linkage ──────────────────────────────────────
  isRecurring: boolean;
  isSystemGenerated?: boolean;  // child expense created by the recurring scheduler
  recurringTemplateId?: mongoose.Types.ObjectId;
  // ── Versioning (optimistic concurrency for offline edits) ─
  version: number;
  // ── Soft delete / restore ──────────────────────────────────
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  restoredAt?: Date;
  restoredBy?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IExpenseAttachment>(
  {
    name: { type: String, required: true, trim: true, maxlength: 300 },
    mime: { type: String, default: 'application/octet-stream', trim: true },
    size: { type: Number, default: 0, min: 0 },
    url: { type: String, trim: true, maxlength: 1000 },
    storage: { type: String, enum: ['local', 'cloud'], default: 'local' },
    uploadedBy: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ExpenseSchema = new Schema<IExpense>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    date: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, default: 'Cash', trim: true },
    vendor: { type: String, trim: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    isCogs: { type: Boolean, default: false },
    gst: {
      type: new Schema({
        cgst: { type: Number, default: 0, min: 0 },
        sgst: { type: Number, default: 0, min: 0 },
        igst: { type: Number, default: 0, min: 0 },
        cess: { type: Number, default: 0, min: 0 },
        inputGst: { type: Boolean, default: true },
        taxInclusive: { type: Boolean, default: true },
        hsn: { type: String, trim: true, maxlength: 20 },
        sac: { type: String, trim: true, maxlength: 20 },
      }, { _id: false }),
      default: undefined,
    },
    attachments: { type: [AttachmentSchema], default: [] },
    isRecurring: { type: Boolean, default: false },
    isSystemGenerated: { type: Boolean, default: false },
    recurringTemplateId: { type: Schema.Types.ObjectId, ref: 'RecurringExpense', default: null },
    version: { type: Number, default: 1, min: 1 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true },
    restoredAt: { type: Date, default: null },
    restoredBy: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

// ─── Composite indexes (multi-tenant + query paths) ────────────
ExpenseSchema.index({ restaurantId: 1, date: -1 });
ExpenseSchema.index({ restaurantId: 1, category: 1, date: -1 });
ExpenseSchema.index({ restaurantId: 1, branchId: 1, date: -1 });
ExpenseSchema.index({ restaurantId: 1, vendorId: 1, date: -1 });
ExpenseSchema.index({ restaurantId: 1, paymentMethod: 1, date: -1 });
ExpenseSchema.index({ restaurantId: 1, isDeleted: 1, date: -1 });

export default mongoose.model<IExpense>('Expense', ExpenseSchema);
