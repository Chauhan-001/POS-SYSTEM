/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Customer Model — Production-grade loyalty customer profiles (Phase 1.6).
 * Tracks personal details, loyalty points/wallet, tier, visits, spend stats,
 * referrals, segments and marketing preferences.
 *
 * Multi-tenant: every customer belongs to exactly one restaurant
 * ({ restaurantId, phone } unique). All repository queries MUST be scoped by
 * restaurantId — see TenantRepository in repositories/tenantRepository.ts.
 *
 * Purchase history lives in the Bill/BillItem collections. Bills reference
 * the customer by both customerId and a phone/name snapshot for historical
 * integrity.
 *
 * API contract: the schema uses isNewCustomer (avoids Mongoose isNew conflict);
 * services map it to isNew for the frontend.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CustomerTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export type CustomerStatus = 'active' | 'blocked' | 'dormant' | 'deleted';

export interface ICustomer extends Document {
  // ── Tenant / ownership ─────────────────────────────────────
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  createdBy?: string;
  updatedBy?: string;

  // ── Identity ───────────────────────────────────────────────
  phone: string;
  name: string;
  email?: string;
  birthday?: string;      // YYYY-MM-DD
  anniversary?: string;   // YYYY-MM-DD
  gender?: 'Male' | 'Female' | 'Other';
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  gstNumber?: string;
  profilePhoto?: string;
  notes?: string;
  tags: string[];
  preferredPaymentMethod?: 'Cash' | 'UPI' | 'Card' | 'Wallet' | 'Split';
  favoriteItems: string[];       // item names
  favoriteCategories: string[];  // category names
  marketingOptIn: boolean;
  taxExemption: boolean;
  isVip: boolean;
  status: CustomerStatus;
  blockReason?: string;

  // ── Referrals ──────────────────────────────────────────────
  referralCode?: string;
  referredBy?: string;    // referrer's referral code
  referralCount: number;

  // ── Loyalty (server-authoritative — never trust client values) ──
  points: number;              // current usable balance (sum of unexpired pool)
  lifetimePoints: number;      // total points ever earned
  walletBalance: number;       // cashback / credit wallet
  tier: CustomerTier;
  tierChangedAt?: Date;

  // ── Spend / visit statistics (server-computed) ─────────────
  totalSpend: number;
  averageSpend: number;
  totalOrders: number;
  visits: number;
  lastVisit?: Date;
  visitFrequency: number;      // average days between visits (0 = unknown)
  firstVisit?: Date;

  // ── Lifecycle ──────────────────────────────────────────────
  isNewCustomer: boolean;
  isBlocked: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },

    phone: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    birthday: { type: String, trim: true },
    anniversary: { type: String, trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    profilePhoto: { type: String, trim: true },
    notes: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    preferredPaymentMethod: { type: String, enum: ['Cash', 'UPI', 'Card', 'Wallet', 'Split'] },
    favoriteItems: [{ type: String, trim: true }],
    favoriteCategories: [{ type: String, trim: true }],
    marketingOptIn: { type: Boolean, default: false },
    taxExemption: { type: Boolean, default: false },
    isVip: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'blocked', 'dormant', 'deleted'], default: 'active', index: true },
    blockReason: { type: String, trim: true },

    referralCode: { type: String, trim: true, uppercase: true },
    referredBy: { type: String, trim: true, uppercase: true },
    referralCount: { type: Number, default: 0, min: 0 },

    points: { type: Number, default: 0, min: 0 },
    lifetimePoints: { type: Number, default: 0, min: 0 },
    walletBalance: { type: Number, default: 0, min: 0 },
    tier: { type: String, enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'], default: 'Bronze' },
    tierChangedAt: { type: Date, default: null },

    totalSpend: { type: Number, default: 0, min: 0 },
    averageSpend: { type: Number, default: 0, min: 0 },
    totalOrders: { type: Number, default: 0, min: 0 },
    visits: { type: Number, default: 0, min: 0 },
    lastVisit: { type: Date, default: null },
    visitFrequency: { type: Number, default: 0, min: 0 },
    firstVisit: { type: Date, default: null },

    isNewCustomer: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Indexes (multi-tenant aware) ────────────────────────────────
CustomerSchema.index({ restaurantId: 1, phone: 1 }, { unique: true });
CustomerSchema.index({ restaurantId: 1, name: 1 });
CustomerSchema.index({ restaurantId: 1, points: -1 });
CustomerSchema.index({ restaurantId: 1, email: 1 });
CustomerSchema.index({ restaurantId: 1, referralCode: 1 });
CustomerSchema.index({ restaurantId: 1, gstNumber: 1 });
CustomerSchema.index({ restaurantId: 1, tier: 1 });
CustomerSchema.index({ restaurantId: 1, totalSpend: -1 });
CustomerSchema.index({ restaurantId: 1, visits: -1 });
CustomerSchema.index({ restaurantId: 1, lastVisit: -1 });
CustomerSchema.index({ restaurantId: 1, tags: 1 });
CustomerSchema.index({ restaurantId: 1, birthday: 1 });
CustomerSchema.index({ name: 'text', phone: 'text', email: 'text', gstNumber: 'text', tags: 'text' });

export default mongoose.model<ICustomer>('Customer', CustomerSchema);
