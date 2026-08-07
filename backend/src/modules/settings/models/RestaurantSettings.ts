/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RestaurantSettings Model — Centralized, tenant-scoped POS configuration (Phase 1.9).
 *
 * One document per (restaurantId, scope) where scope is one of:
 *   'restaurant'              → restaurant-wide defaults
 *   'branch'   (+branchId)    → per-branch overrides
 *   'device'   (+deviceId)    → per-device overrides
 *
 * Effective settings are resolved at read time with priority:
 *   device → branch → restaurant → frontend defaults.
 *
 * Every change bumps settingsVersion and appends to `history`, enabling
 * optimistic concurrency (PATCH with baseVersion → 409 on conflict),
 * rollback to any prior version, and a full audit trail.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type SettingsScope = 'restaurant' | 'branch' | 'device';

export interface SettingsHistoryEntry {
  version: number;
  settings: Record<string, any>;
  changeReason?: string;
  updatedBy?: string;
  updatedAt: Date;
}

export interface IRestaurantSettings extends Document {
  restaurantId: mongoose.Types.ObjectId;
  scope: SettingsScope;
  branchId?: mongoose.Types.ObjectId | null;
  deviceId?: string | null;
  settingsVersion: number;
  settings: Record<string, any>;
  changeReason?: string;
  updatedBy?: string;
  history: SettingsHistoryEntry[];
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const RestaurantSettingsSchema = new Schema<IRestaurantSettings>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    scope: { type: String, enum: ['restaurant', 'branch', 'device'], required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    deviceId: { type: String, trim: true, default: null, index: true },
    settingsVersion: { type: Number, default: 1, min: 1 },
    settings: { type: Schema.Types.Mixed, default: {} },
    changeReason: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
    history: {
      type: [
        {
          version: { type: Number, required: true },
          settings: { type: Schema.Types.Mixed, default: {} },
          changeReason: { type: String, trim: true },
          updatedBy: { type: String, trim: true },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One doc per tenant+scope — prevents two restaurant-level docs for the same restaurant,
// two branch docs for the same branch, or two device docs for the same device.
RestaurantSettingsSchema.index(
  { restaurantId: 1, scope: 1, branchId: 1, deviceId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);
RestaurantSettingsSchema.index({ restaurantId: 1, scope: 1, settingsVersion: -1 });

export default mongoose.model<IRestaurantSettings>('RestaurantSettings', RestaurantSettingsSchema);
