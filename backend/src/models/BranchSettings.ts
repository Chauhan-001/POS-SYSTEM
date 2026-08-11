/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BranchSettings Model — Per-branch configuration overrides.
 * Each branch can override global settings like tax rates,
 * restaurant name, receipt config, printer settings, etc.
 * If a setting is null/undefined at branch level, the system uses the global default.
 *
 * This schema mirrors the frontend SystemSettings interface fields
 * that can differ per branch.
 */

import mongoose, { Schema, Document } from 'mongoose';

/** Inline type for module-level feature toggles */
export interface ModuleSettings {
  enableTableService: boolean;
  enableWaiterManagement: boolean;
  enableReservations: boolean;
  enableQROrdering: boolean;
  enableDeliveryModule: boolean;
  enableOnlineOrders: boolean;
  enableKitchenDisplay: boolean;
  enableLoyalty: boolean;
  showImagesInBilling?: boolean;
  showCashierPerformance?: boolean;
  enableMultiBranch?: boolean;
  enableOffersPopup?: boolean;
  enableAutoPrintKOT?: boolean;
  enableQuickSoundAlerts?: boolean;
  showItemCodeOnCard?: boolean;
  enableGuestCheckout?: boolean;
  enableOrderNotes?: boolean;
  enableTakeawayModule?: boolean;
  enableDineInModule?: boolean;
  enableExpenseManagement?: boolean;
  enableDiscountOnBilling?: boolean;
  /** Online ordering: when a cashier marks an item unavailable from an incoming
   * order, also block it for NEW online orders (explicit opt-in, default OFF). */
  autoMarkSoldOutFromOrder?: boolean;
  /** Master switch for the online Menu Availability controls. */
  enableMenuAvailability?: boolean;
}

export interface IBranchSettings extends Document {
  branchId: mongoose.Types.ObjectId;
  /** Tenant scope — backfilled by migration; required going forward for isolation. */
  restaurantId?: mongoose.Types.ObjectId;
  restaurantName?: string;
  gstin?: string;
  address?: string;
  phone?: string;
  currency?: string;
  currencySymbol?: string;
  defaultTaxRate?: number;
  printSize?: '58mm' | '80mm';
  brandingColor?: string;
  autoPrintReceipt?: boolean;
  invoicePrefix?: string;
  invoiceStartingNumber?: number;
  invoiceSuffix?: string;
  receiptFooterMessage?: string;
  moduleSettings?: Partial<ModuleSettings>;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BranchSettingsSchema = new Schema<IBranchSettings>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, unique: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    restaurantName: { type: String, trim: true },
    gstin: { type: String, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    currency: { type: String, trim: true },
    currencySymbol: { type: String, trim: true },
    defaultTaxRate: { type: Number, min: 0, max: 100 },
    printSize: { type: String, enum: ['58mm', '80mm'] },
    brandingColor: { type: String, trim: true },
    autoPrintReceipt: { type: Boolean },
    invoicePrefix: { type: String, trim: true },
    invoiceStartingNumber: { type: Number, min: 1 },
    invoiceSuffix: { type: String, trim: true },
    receiptFooterMessage: { type: String, trim: true },
    moduleSettings: { type: Schema.Types.Mixed },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IBranchSettings>('BranchSettings', BranchSettingsSchema);
