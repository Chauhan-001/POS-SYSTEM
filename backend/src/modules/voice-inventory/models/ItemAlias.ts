/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ItemAlias Model — Per-restaurant alias mapping for inventory items.
 * Maps spoken names (Hindi, Hinglish, English, brand names) to canonical items.
 *
 * Each restaurant manages their own alias set, configurable via Settings.
 * Examples:
 *   canonicalName: "Fresh Milk"
 *   aliases: ["Milk", "Doodh", "दूध", "Amul Milk", "Mother Dairy Milk"]
 *
 * Security:
 *   - Aliases are never exposed to the LLM directly (resolved server-side)
 *   - Each alias is scoped to a restaurantId to prevent cross-tenant access
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IItemAlias extends Document {
  restaurantId: mongoose.Types.ObjectId;
  canonicalName: string;
  aliases: string[];
  unit: string;
  isActive: boolean;
  createdBy: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ItemAliasSchema = new Schema<IItemAlias>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    canonicalName: {
      type: String,
      required: true,
      trim: true,
    },
    aliases: {
      type: [String],
      default: [],
      validate: {
        validator: function (v: string[]) {
          return v.length <= 100; // Max 100 aliases per item
        },
        message: 'Cannot have more than 100 aliases per item',
      },
    },
    unit: {
      type: String,
      required: true,
      trim: true,
      default: 'kg',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      required: true,
      trim: true,
    },
    updatedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: one canonical name per restaurant
ItemAliasSchema.index({ restaurantId: 1, canonicalName: 1 }, { unique: true });
// Index for alias lookup (case-insensitive search)
ItemAliasSchema.index({ restaurantId: 1, aliases: 1 });
// Index for active filtering
ItemAliasSchema.index({ restaurantId: 1, isActive: 1 });

export default mongoose.model<IItemAlias>('ItemAlias', ItemAliasSchema);
