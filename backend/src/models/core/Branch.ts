/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branch Model — Represents a restaurant branch/location.
 * Multi-branch support allows chain restaurants to manage multiple locations
 * under one system. Each branch has its own settings, employees, tables, and data.
 * isHeadBranch: true for the main/head branch that can view consolidated reports.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IBranch extends Document {
  restaurantId?: mongoose.Types.ObjectId;
  name: string;
  address?: string;
  phone?: string;
  isHeadBranch: boolean;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BranchSchema = new Schema<IBranch>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    name: { type: String, required: true, trim: true, index: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    isHeadBranch: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

BranchSchema.index({ isActive: 1 });
BranchSchema.index({ isHeadBranch: 1 });

export default mongoose.model<IBranch>('Branch', BranchSchema);
