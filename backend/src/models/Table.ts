/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Table Model — Restaurant floor plan tables.
 * Tables are linked to branches for per-branch floor layouts.
 * Each table has a number, capacity, section, and current status.
 * Separate from Order so table status tracking is independent.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITable extends Document {
  number: number;
  capacity: number;
  status: string;
  section?: string;
  branchId?: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  floorId?: mongoose.Types.ObjectId;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: 'circle' | 'square' | 'rectangle';
  isLocked?: boolean;
  mergedWith?: string[];
  waiterId?: string;
  waiterName?: string;
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  occupiedSince?: Date;
  lastReleasedAt?: Date;
  cleaningSince?: Date;
  reservationId?: string;
  reservationName?: string;
  reservationTime?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TableSchema = new Schema<ITable>(
  {
    number: { type: Number, required: true, min: 1 },
    capacity: { type: Number, required: true, min: 1 },
    status: { type: String, default: 'Available', index: true },
    section: { type: String, trim: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    x: { type: Number },
    y: { type: Number },
    width: { type: Number },
    height: { type: Number },
    shape: { type: String, enum: ['circle', 'square', 'rectangle'], default: 'circle' },
    rotation: { type: Number, default: 0, min: 0, max: 360 },
    isLocked: { type: Boolean, default: false },
    mergedWith: { type: [String], default: undefined },
    waiterId: { type: String, trim: true },
    waiterName: { type: String, trim: true },
    customerId: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    customerName: { type: String, trim: true },
    occupiedSince: { type: Date, default: null },
    lastReleasedAt: { type: Date, default: null },
    cleaningSince: { type: Date, default: null },
    reservationId: { type: String, trim: true },
    reservationName: { type: String, trim: true },
    reservationTime: { type: String, trim: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    floorId: { type: Schema.Types.ObjectId, ref: 'Floor', default: null, index: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TableSchema.index({ branchId: 1, section: 1 });
// Uniqueness on (restaurantId, branchId, number) applies ONLY to active
// (non-deleted) tables. Scoping by restaurantId means two tenants can each
// run branchless table numbers 1-N without colliding — the old global
// (branchId, number) index let one restaurant's branchless tables 1-4 block
// every other restaurant from using those numbers. Soft-deleted rows keep
// order/history references intact but must not block re-adding a table with
// the same number (partial index — the live MongoDB index must match; see
// scripts/migrate-table-restaurant-unique.mjs).
TableSchema.index(
  { restaurantId: 1, branchId: 1, number: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
TableSchema.index({ branchId: 1, floorId: 1 });
TableSchema.index({ restaurantId: 1, status: 1 });

export default mongoose.model<ITable>('Table', TableSchema);
