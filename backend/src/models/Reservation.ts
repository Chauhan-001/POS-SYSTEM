/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reservation Model — Table reservations for advance booking.
 * Supports status tracking (Confirmed, Seated, Cancelled, No Show).
 * Linked to tables when a specific table is reserved.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IReservation extends Document {
  customerName: string;
  customerPhone: string;
  guestCount: number;
  date: string;
  time: string;
  tableId?: string;
  tableNumber?: number;
  status: 'Confirmed' | 'Seated' | 'Cancelled' | 'No Show';
  branchId?: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  notes?: string;
  occasion?: string;
  createdBy?: string;
  customerId?: string;
  seatedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReservationSchema = new Schema<IReservation>(
  {
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true, index: true },
    guestCount: { type: Number, required: true, min: 1 },
    date: { type: String, required: true, trim: true, index: true },
    time: { type: String, required: true, trim: true },
    tableId: { type: String, trim: true },
    tableNumber: { type: Number },
    status: { type: String, default: 'Confirmed', enum: ['Confirmed', 'Seated', 'Cancelled', 'No Show'] },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    notes: { type: String, trim: true },
    occasion: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    customerId: { type: String, trim: true },
    seatedAt: { type: Date, default: null },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ReservationSchema.index({ date: 1, time: 1 });
ReservationSchema.index({ branchId: 1, date: 1 });

export default mongoose.model<IReservation>('Reservation', ReservationSchema);
