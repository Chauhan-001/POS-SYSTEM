/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Ordering Module — Future customer website integration and QR-based ordering infrastructure.
 *
 * This module provides the backend infrastructure needed to support a future customer-facing website
 * that allows customers to place orders via QR codes at tables, in cars, for pickup, or for takeaway.
 *
 * Features:
 * - QR code-based ordering sessions with unique session IDs
 * - Support for TABLE, CAR, TAKEAWAY, PICKUP order types
 * - Customer request management (assistance, bill requests, etc.)
 * - Session lifecycle management with auto-expiry
 * - Notification system to POS
 * - Offline queue for failed requests
 * - Feature toggles via Settings
 *
 * IMPORTANT: This is BACKEND-only infrastructure for a FUTURE customer website.
 * NO customer UI should be implemented here — only APIs and models that the website will call.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IQROrderingSession extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  tableId?: mongoose.Types.ObjectId;
  carId?: string;
  orderType: 'TABLE' | 'CAR' | 'TAKEAWAY' | 'PICKUP';
  sessionId: string; // Customer-facing QR code session ID
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  cart: {
    items: Array<Record<string, any>>;
    subtotal: number;
    discount?: number;
    gst?: number;
    grandTotal: number;
  };
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QROrderingSessionSchema = new Schema<IQROrderingSession>(
  {
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
    orderType: {
      type: String,
      enum: ['TABLE', 'CAR', 'TAKEAWAY', 'PICKUP'],
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customer: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    cart: {
      items: [{ type: Schema.Types.Mixed }],
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      gst: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
QROrderingSessionSchema.index({ restaurantId: 1, status: 1, expiresAt: 1 });
QROrderingSessionSchema.index({ branchId: 1, tableId: 1, status: 1 });
QROrderingSessionSchema.index({ carId: 1, status: 1 });

export default mongoose.model<IQROrderingSession>('QROrderingSession', QROrderingSessionSchema);
