import mongoose, { Schema, Document } from 'mongoose';

export type LicenseType = 'trial' | 'perpetual' | 'subscription';

export interface ILicense extends Document {
  restaurantId: mongoose.Types.ObjectId;
  licenseKey: string;
  type: LicenseType;
  issuedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LicenseSchema = new Schema<ILicense>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    licenseKey: { type: String, required: true, unique: true, trim: true },
    type: { type: String, required: true, enum: ['trial', 'perpetual', 'subscription'] },
    issuedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

LicenseSchema.index({ restaurantId: 1, isActive: 1 });

export default mongoose.model<ILicense>('License', LicenseSchema);
