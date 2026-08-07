/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Printer Model — Real, tenant-scoped printer registry (Phase 1.9).
 * Replaces the hardcoded/fake printer IPs previously baked into the
 * SettingsManager UI. Each printer is a persisted record with a real
 * connection target, paper/encoding config, health state, and optional
 * branch/device scoping for routing.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type PrinterType =
  | 'kitchen'
  | 'receipt'
  | 'bar'
  | 'dessert'
  | 'kds'
  | 'network'
  | 'usb'
  | 'bluetooth';

export type PrinterConnectionKind = 'network' | 'usb' | 'bluetooth';

export interface PrinterConnection {
  kind: PrinterConnectionKind;
  /** Network printers: host (IP/hostname) + port (e.g. 9100). */
  host?: string;
  port?: number;
  /** USB/Bluetooth: device address / vendor id / port name. */
  address?: string;
}

export interface PrinterMargins {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface IPrinter extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  deviceId?: string | null;
  name: string;
  type: PrinterType;
  connection: PrinterConnection;
  paperSize: '58mm' | '80mm';
  copies: number;
  margins: PrinterMargins;
  encoding: string;
  receiptWidthChars?: number;
  isDefault: boolean;
  enabled: boolean;
  healthStatus: 'unknown' | 'online' | 'offline' | 'error';
  lastTestedAt?: Date | null;
  lastError?: string | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PrinterSchema = new Schema<IPrinter>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    deviceId: { type: String, trim: true, default: null, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth'],
      required: true,
    },
    connection: {
      kind: { type: String, enum: ['network', 'usb', 'bluetooth'], required: true },
      host: { type: String, trim: true },
      port: { type: Number, min: 1, max: 65535 },
      address: { type: String, trim: true },
    },
    paperSize: { type: String, enum: ['58mm', '80mm'], default: '80mm' },
    copies: { type: Number, default: 1, min: 1, max: 10 },
    margins: {
      top: { type: Number, default: 0 },
      bottom: { type: Number, default: 0 },
      left: { type: Number, default: 0 },
      right: { type: Number, default: 0 },
    },
    encoding: { type: String, default: 'UTF-8' },
    receiptWidthChars: { type: Number, min: 20, max: 80 },
    isDefault: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    healthStatus: { type: String, enum: ['unknown', 'online', 'offline', 'error'], default: 'unknown' },
    lastTestedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PrinterSchema.index({ restaurantId: 1, name: 1 });
PrinterSchema.index({ restaurantId: 1, type: 1, enabled: 1 });
PrinterSchema.index({ restaurantId: 1, branchId: 1 });

export default mongoose.model<IPrinter>('Printer', PrinterSchema);
