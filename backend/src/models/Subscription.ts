import mongoose, { Schema, Document } from 'mongoose';

export type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'suspended';

export interface ISubscriptionLimits {
  maxRestaurants: number;
  maxBranches: number;
  maxDevices: number;
  maxEmployees: number;
  maxProducts: number;
  maxCustomers: number;
  maxMonthlyOrders: number;
  maxStorageMB: number;
  maxAIRequests: number;
  maxVoiceRequests: number;
  maxImages: number;
  maxExports: number;
}

export interface ISubscription extends Document {
  restaurantId: mongoose.Types.ObjectId;
  plan: string;
  status: SubscriptionStatus;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionStart?: Date;
  expiryDate?: Date;
  renewalDate?: Date;
  graceEnd?: Date;
  startDate: Date;
  endDate?: Date;
  maxUsers: number;
  maxDevices: number;
  features: string[];
  limits: ISubscriptionLimits;
  /** Scheduled (future-dated) plan change — applied on the effective date. */
  pendingPlan?: string | null;
  pendingEffectiveDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionLimitsSchema = new Schema<ISubscriptionLimits>(
  {
    maxRestaurants: { type: Number, default: 1, min: 0 },
    maxBranches: { type: Number, default: 1, min: 0 },
    maxDevices: { type: Number, default: 3, min: 0 },
    maxEmployees: { type: Number, default: 10, min: 0 },
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

const SubscriptionSchema = new Schema<ISubscription>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true, index: true },
    plan: { type: String, required: true, default: 'professional' },
    status: { type: String, required: true, enum: ['trial', 'active', 'grace', 'suspended'], default: 'trial', index: true },
    trialStart: { type: Date, default: Date.now },
    trialEnd: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    subscriptionStart: { type: Date, default: null },
    expiryDate: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    renewalDate: { type: Date, default: null },
    graceEnd: { type: Date, default: () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, default: null },
    maxUsers: { type: Number, default: 5 },
    maxDevices: { type: Number, default: 3 },
    features: [{ type: String }],
    limits: { type: SubscriptionLimitsSchema, default: () => ({ maxRestaurants: 1, maxBranches: 1, maxDevices: 3, maxEmployees: 10, maxProducts: 0, maxCustomers: 0, maxMonthlyOrders: 0, maxStorageMB: 500, maxAIRequests: 0, maxVoiceRequests: 0, maxImages: 0, maxExports: 0 }) },
    pendingPlan: { type: String, default: null },
    pendingEffectiveDate: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
