/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MenuAvailability Model — standalone "can this menu item currently be ordered
 * online?" control. Deliberately independent of inventory stock levels: a
 * restaurant can mark an item AVAILABLE / UNAVAILABLE for online ordering with
 * no inventory data at all.
 *
 * Scoping:
 *   - restaurantId (required) — tenant
 *   - branchId (null) — restaurant-wide default; a row with a specific
 *     branchId overrides the default for that branch only.
 *   - productId (required)
 *
 * Resolution: branch override → restaurant default → AVAILABLE (nothing
 * recorded means everything is orderable, so rollouts never break).
 *
 * Optional expiry: `unavailableUntil` (with status UNAVAILABLE) lets a toggle
 * self-heal (30 min / 1 hr / end of day presets) — a background tick flips
 * expired rows back to AVAILABLE.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OnlineAvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE';
export type AvailabilitySource = 'manual' | 'order_adjustment' | 'auto_expiry';

export interface IMenuAvailability extends Document {
  restaurantId: mongoose.Types.ObjectId;
  /** null = restaurant-wide default; a specific branch id = branch override. */
  branchId: mongoose.Types.ObjectId | null;
  productId: mongoose.Types.ObjectId;
  status: OnlineAvailabilityStatus;
  /** When set with status UNAVAILABLE, availability auto-restores after this time. */
  unavailableUntil: Date | null;
  reason?: string;
  /** Master site-visibility switch: when FALSE the item is NOT listed on the
   * customer website at all (owner hide/remove control). Distinct from status:
   * UNAVAILABLE still lists the item as SOLD OUT; visibleOnSite=false removes
   * it from the site entirely. Defaults to true (new items appear on site). */
  visibleOnSite: boolean;
  source: AvailabilitySource;
  updatedBy?: string;
  updatedById?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MenuAvailabilitySchema = new Schema<IMenuAvailability>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    status: { type: String, enum: ['AVAILABLE', 'UNAVAILABLE'], default: 'AVAILABLE', index: true },
    unavailableUntil: { type: Date, default: null },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    visibleOnSite: { type: Boolean, default: true, index: true },
    source: { type: String, enum: ['manual', 'order_adjustment', 'auto_expiry'], default: 'manual' },
    updatedBy: { type: String, trim: true },
    updatedById: { type: String, trim: true },
  },
  { timestamps: true }
);

// One availability row per (restaurant, branch, product).
MenuAvailabilitySchema.index({ restaurantId: 1, branchId: 1, productId: 1 }, { unique: true });
// Expiry sweeper + list queries.
MenuAvailabilitySchema.index({ restaurantId: 1, branchId: 1, status: 1, unavailableUntil: 1 });
MenuAvailabilitySchema.index({ restaurantId: 1, productId: 1 });

export default mongoose.model<IMenuAvailability>('MenuAvailability', MenuAvailabilitySchema);
