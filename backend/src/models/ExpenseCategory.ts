/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExpenseCategory Model — Configurable expense categories (Phase 1.7).
 * Replaces the hardcoded category enum. System categories are seeded per
 * restaurant on first use; merchants can add custom categories, reorder them,
 * assign icons/colors, toggle enable/disable and flag category-level COGS.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IExpenseCategory extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  /** Category-level default for the COGS flag (overridable per expense). */
  isCogs: boolean;
  isSystem: boolean;
  isActive: boolean;
  createdBy?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseCategorySchema = new Schema<IExpenseCategory>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    icon: { type: String, trim: true, maxlength: 50, default: '📋' },
    color: { type: String, trim: true, match: /^#[0-9a-fA-F]{6}$/, default: '#64748b' },
    sortOrder: { type: Number, default: 0 },
    isCogs: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ExpenseCategorySchema.index({ restaurantId: 1, sortOrder: 1 });
ExpenseCategorySchema.index({ restaurantId: 1, name: 1 }, { unique: true });

export default mongoose.model<IExpenseCategory>('ExpenseCategory', ExpenseCategorySchema);
