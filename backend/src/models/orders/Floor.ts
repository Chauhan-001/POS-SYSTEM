/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Floor Model — Multi-floor restaurant layout management.
 * A branch can have multiple floors (Ground, First, Outdoor, VIP, Terrace, Bar…).
 * Each floor stores its name, ordering, visibility and optional theme so the
 * floor plan can be switched instantly without losing table positions.
 * Tables link to a floor via `Table.floorId` (backward compatible — tables
 * without a floorId belong to the branch's default/legacy floor).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IFloor extends Document {
  name: string;
  branchId?: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  sortOrder: number;
  isActive: boolean;
  theme?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FloorSchema = new Schema<IFloor>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    sortOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    theme: { type: String, trim: true, maxlength: 40 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

FloorSchema.index({ branchId: 1, sortOrder: 1 });
FloorSchema.index({ branchId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });

export default mongoose.model<IFloor>('Floor', FloorSchema);
