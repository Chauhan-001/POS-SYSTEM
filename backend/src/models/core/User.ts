import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'super_admin' | 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'inventory';

export interface IUser extends Document {
  /** Tenant restaurant. Nullable: the platform super_admin has no restaurant. */
  restaurantId: mongoose.Types.ObjectId | null;
  /** Unique user identifier for login (e.g. "admin") */
  userId: string;
  phone: string;
  name: string;
  email?: string;
  password: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  employeeId?: mongoose.Types.ObjectId;
  branchIds: mongoose.Types.ObjectId[];
  lastLogin?: Date;
  /** Last activity (login/refresh) — cached for sorting/filtering. */
  lastActivity?: Date;
  /** Manual lock metadata (Phase 2.3 — lock/unlock account). */
  lockedAt?: Date;
  lockedBy?: string;
  lockReason?: string;
  /** Rolling failed-login counter (reset on successful login). */
  failedLoginAttempts?: number;
  /** Lightweight activity history for status transitions (audit trail too). */
  activityHistory?: Array<{
    action: string;
    performedBy: string;
    timestamp: Date;
    details?: Record<string, unknown>;
  }>;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    userId: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    password: { type: String, required: true, minlength: 6, maxlength: 100 },
    role: {
      type: String,
      required: true,
      enum: ['super_admin', 'owner', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory'],
      index: true,
    },
    status: { type: String, default: 'active', enum: ['active', 'inactive', 'suspended'], index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    lastLogin: { type: Date, default: null },
    lastActivity: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lockReason: { type: String, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    activityHistory: [{
      action: { type: String },
      performedBy: { type: String },
      timestamp: { type: Date, default: Date.now },
      details: { type: Schema.Types.Mixed },
    }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ restaurantId: 1, phone: 1 }, { unique: true });
UserSchema.index({ restaurantId: 1, status: 1 });
UserSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
