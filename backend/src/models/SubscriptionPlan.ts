import mongoose, { Schema, Document } from 'mongoose';
import { PLAN_STATUSES, PLAN_TYPES, PLAN_VISIBILITIES } from '../constants/planFeatures';
import type { PlanLimitKey } from '../constants/planFeatures';

export interface IPlanLimits {
  maxRestaurants: number; // 0 = unlimited
  maxBranches: number; // 0 = unlimited
  /** Max POS devices allowed at EACH individual branch (0 = unlimited). */
  maxDevicesPerBranch: number;
  maxProducts: number; // 0 = unlimited
  maxCustomers: number; // 0 = unlimited
  maxMonthlyOrders: number; // 0 = unlimited
  /** Media storage quota in MB (0 = unlimited). Default 500 MB. */
  maxStorageMB: number;
  maxAIRequests: number; // 0 = unlimited
  maxVoiceRequests: number; // 0 = unlimited
  maxImages: number; // 0 = unlimited
  maxExports: number; // 0 = unlimited
}

/** Snapshot of a plan configuration used for version history. */
export interface IPlanVersion {
  version: number;
  name: string;
  description: string;
  price: number;
  yearlyPrice: number;
  maxUsers: number;
  maxDevices: number;
  features: string[];
  aiEnabled: boolean;
  trialDays: number;
  sortOrder: number;
  isDefault: boolean;
  status: string;
  planType: string;
  visibility: string;
  limits: IPlanLimits;
  createdBy: string | null;
  note: string;
  timestamp: Date;
}

export interface ISubscriptionPlan extends Document {
  planId: string;
  name: string;
  description: string;
  /** Monthly price in currency units (legacy `price` — kept for billing compat). */
  price: number;
  /** Yearly price in currency units (billed once per year). 0 = not offered. */
  yearlyPrice: number;
  maxUsers: number;
  maxDevices: number;
  features: string[];
  aiEnabled: boolean;
  trialDays: number;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  /** Lifecycle status — inactive statuses are not assignable. */
  status: string;
  planType: string;
  visibility: string;
  limits: IPlanLimits;
  /** Incrementing config version; bump on every edit. */
  version: number;
  /** Ordered version history (oldest → newest). */
  versions: IPlanVersion[];
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PlanLimitsSchema = new Schema<IPlanLimits>(
  {
    maxRestaurants: { type: Number, default: 1, min: 0 },
    maxBranches: { type: Number, default: 1, min: 0 },
    maxDevicesPerBranch: { type: Number, default: 3, min: 0 },
    maxProducts: { type: Number, default: 0, min: 0 },
    maxCustomers: { type: Number, default: 0, min: 0 },
    maxMonthlyOrders: { type: Number, default: 0, min: 0 },
    maxStorageMB: { type: Number, default: 500, min: 0 },
    maxAIRequests: { type: Number, default: 0, min: 0 },
    maxVoiceRequests: { type: Number, default: 0, min: 0 },
    maxImages: { type: Number, default: 0, min: 0 },
    maxExports: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const PlanVersionSchema = new Schema<IPlanVersion>(
  {
    version: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, default: 0 },
    yearlyPrice: { type: Number, default: 0, min: 0 },
    maxUsers: { type: Number, default: 5 },
    maxDevices: { type: Number, default: 6 },
    features: [{ type: String }],
    aiEnabled: { type: Boolean, default: false },
    trialDays: { type: Number, default: 14 },
    sortOrder: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: String, default: 'active' },
    planType: { type: String, default: 'paid' },
    visibility: { type: String, default: 'public' },
    limits: { type: PlanLimitsSchema, default: () => ({}) },
    createdBy: { type: String, default: null },
    note: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SubscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    planId: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, default: 0, min: 0 },
    yearlyPrice: { type: Number, default: 0, min: 0 },
    maxUsers: { type: Number, default: 5, min: 0 },
    maxDevices: { type: Number, default: 6, min: 0 },
    features: [{ type: String }],
    aiEnabled: { type: Boolean, default: false },
    trialDays: { type: Number, default: 14, min: 0 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: PLAN_STATUSES, default: 'active', index: true },
    planType: { type: String, enum: PLAN_TYPES, default: 'paid', index: true },
    visibility: { type: String, enum: PLAN_VISIBILITIES, default: 'public' },
    limits: {
      type: PlanLimitsSchema,
      default: () => ({
        maxRestaurants: 1, maxBranches: 1, maxDevicesPerBranch: 3,
        maxProducts: 0, maxCustomers: 0, maxMonthlyOrders: 0, maxStorageMB: 500,
        maxAIRequests: 0, maxVoiceRequests: 0, maxImages: 0, maxExports: 0,
      }),
    },
    version: { type: Number, default: 1 },
    versions: { type: [PlanVersionSchema], default: [] },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
    archivedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Backward-compatible legacy field: `storageLimitMB` was the old name.
SubscriptionPlanSchema.virtual('storageLimitMB').get(function () {
  return this.limits?.maxStorageMB;
});

SubscriptionPlanSchema.index({ status: 1, isDeleted: 1 });
SubscriptionPlanSchema.index({ sortOrder: 1, name: 1 });

export default mongoose.model<ISubscriptionPlan>('SubscriptionPlan', SubscriptionPlanSchema);
