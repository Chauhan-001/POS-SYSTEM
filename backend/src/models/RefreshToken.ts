import mongoose, { Schema, Document } from 'mongoose';

export interface IRefreshToken extends Document {
  userId: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  deviceId?: string;
  deviceName?: string;
  os?: string;
  appVersion?: string;
  /** IP address captured at login (for login history). */
  ipAddress?: string;
  /** Raw User-Agent header captured at login (for login history). */
  userAgent?: string;
  tokenHash: string;
  expiresAt: Date;
  isRevoked: boolean;
  lastActivityAt?: Date;
  /** Set when a previously-rotated token is replayed — signals compromise. */
  reuseDetectedAt?: Date;
  createdAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    deviceId: { type: String, trim: true, default: null },
    deviceName: { type: String, trim: true, default: null },
    os: { type: String, trim: true, default: null },
    appVersion: { type: String, trim: true, default: null },
    ipAddress: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null, maxlength: 400 },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    isRevoked: { type: Boolean, default: false, index: true },
    lastActivityAt: { type: Date, default: null },
    reuseDetectedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

RefreshTokenSchema.index({ tokenHash: 1 });
RefreshTokenSchema.index({ userId: 1, isRevoked: 1 });

export default mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
