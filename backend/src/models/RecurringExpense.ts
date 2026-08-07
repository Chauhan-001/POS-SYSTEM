/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecurringExpense Model — Recurring expense templates (Phase 1.7).
 * A template describes an expense that repeats on a schedule (daily / weekly /
 * monthly / quarterly / yearly). The scheduler (recurringExpenseService
 * generateDue) materializes child Expense documents idempotently using
 * nextRunDate — a template is never "due" twice for the same period, and
 * pause/resume simply freezes/unfreezes generation.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface IRecurringExpense extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  categoryId?: mongoose.Types.ObjectId;
  category: string;                 // category name snapshot
  description: string;
  amount: number;
  paymentMethod: string;
  vendorId?: mongoose.Types.ObjectId;
  vendor?: string;
  isCogs: boolean;
  frequency: RecurrenceFrequency;
  startDate: string;                // YYYY-MM-DD
  endDate?: string;                 // YYYY-MM-DD (absent = never ends)
  nextRunDate: string;              // YYYY-MM-DD — next generation date
  lastRunDate?: string;
  lastGeneratedExpenseId?: mongoose.Types.ObjectId;
  isPaused: boolean;
  dayOfWeek?: number;               // 0=Sunday..6=Saturday (weekly)
  dayOfMonth?: number;              // 1..31 (monthly/quarterly/yearly)
  notes?: string;
  createdBy?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringExpenseSchema = new Schema<IRecurringExpense>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
    category: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, default: 'Cash', trim: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    vendor: { type: String, trim: true },
    isCogs: { type: Boolean, default: false },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
      required: true,
      default: 'monthly',
    },
    startDate: { type: String, required: true, trim: true },
    endDate: { type: String, trim: true },
    nextRunDate: { type: String, required: true, trim: true, index: true },
    lastRunDate: { type: String, trim: true },
    lastGeneratedExpenseId: { type: Schema.Types.ObjectId, ref: 'Expense', default: null },
    isPaused: { type: Boolean, default: false },
    dayOfWeek: { type: Number, min: 0, max: 6 },
    dayOfMonth: { type: Number, min: 1, max: 31 },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

RecurringExpenseSchema.index({ restaurantId: 1, nextRunDate: 1, isPaused: 1, isDeleted: 1 });
RecurringExpenseSchema.index({ restaurantId: 1, frequency: 1 });

export default mongoose.model<IRecurringExpense>('RecurringExpense', RecurringExpenseSchema);
