/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Request Model — Tracks all customer requests via QR ordering
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerRequest extends Document {
  sessionId: string;
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  orderType: 'TABLE' | 'CAR' | 'TAKEAWAY' | 'PICKUP';
  tableId?: mongoose.Types.ObjectId;
  carId?: string;
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  type:
    | 'CALL_WAITER'
    | 'WATER'
    | 'BILL'
    | 'CLEANING'
    | 'PLATE'
    | 'SPOON'
    | 'ASSISTANCE'
    | 'ORDER_READY';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'SEEN' | 'ACCEPTED' | 'COMPLETED' | 'ARCHIVED';
  message?: string;
  items?: string;
  quantity?: number;
  assignedTo?: mongoose.Types.ObjectId;
  assignedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerRequestSchema = new Schema<ICustomerRequest>(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      index: true,
    },
    orderType: {
      type: String,
      enum: ['TABLE', 'CAR', 'TAKEAWAY', 'PICKUP'],
      required: true,
      index: true,
    },
    tableId: {
      type: Schema.Types.ObjectId,
      ref: 'Table',
      index: true,
    },
    carId: {
      type: String,
      trim: true,
      index: true,
    },
    customer: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    type: {
      type: String,
      enum: ['CALL_WAITER', 'WATER', 'BILL', 'CLEANING', 'PLATE', 'SPOON', 'ASSISTANCE', 'ORDER_READY'],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      default: 'MEDIUM',
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'SEEN', 'ACCEPTED', 'COMPLETED', 'ARCHIVED'],
      default: 'PENDING',
      index: true,
    },
    message: {
      type: String,
      trim: true,
    },
    items: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      min: 1,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
    },
    assignedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for common queries
CustomerRequestSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
CustomerRequestSchema.index({ sessionId: 1, status: 1 });
CustomerRequestSchema.index({ branchId: 1, tableId: 1, status: 1 });
CustomerRequestSchema.index({ orderType: 1, status: 1 });

export default mongoose.model<ICustomerRequest>('CustomerRequest', CustomerRequestSchema);
