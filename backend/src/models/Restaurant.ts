import mongoose, { Schema, Document } from 'mongoose';

/** Metadata for a persisted media file (logo / cover) — powers storage metrics
 * without re-scanning the filesystem on every request. */
export interface IRestaurantMediaMeta {
  /** Relative public URL path, e.g. /uploads/restaurants/<rid>/logo_xxx.jpg */
  key: string;
  /** File size in bytes. */
  size: number;
  /** Detected MIME type. */
  mimetype: string;
  /** Original client filename (display only, never used for storage). */
  originalName: string;
  /** Admin identity that uploaded the file. */
  uploadedBy: string;
  uploadedAt: Date;
}

export interface IRestaurantMedia {
  logo?: IRestaurantMediaMeta;
  cover?: IRestaurantMediaMeta;
}

export interface IRestaurant extends Document {
  restaurantId: string;
  name: string;
  legalName?: string;
  brandName?: string;
  restaurantType?: string;
  cuisineType?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  website?: string;
  description?: string;
  notes?: string;
  extraInfo?: string;
  gst?: string;
  fssai?: string;
  pan?: string;
  businessRegNumber?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  emergencyContact?: string;
  identityType?: string;
  identityNumber?: string;
  address?: string;
  area?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  pinCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  currency?: string;
  gstEnabled?: boolean;
  printerType?: string;
  receiptWidth?: string;
  taxMode?: string;
  offlineMode?: boolean;
  aiEnabled?: boolean;
  loyaltyEnabled?: boolean;
  weatherEnabled?: boolean;
  maxDevices?: number;
  logoUrl?: string;
  coverImageUrl?: string;
  media?: IRestaurantMedia;
  isActive: boolean;
  ownerUserId?: string;
  ownerPin?: string;
  tempPasswordShown?: boolean;
  secretKey?: string;
  apiKey?: string;
  /** Publicly-shareable token used in QR links (single per restaurant, read-only on the live public store). */
  publicToken?: string;
  adminNotes?: Array<{ id: string; note: string; admin: string; timestamp: Date }>;
  auditTrail?: Array<{ id: string; action: string; admin: string; timestamp: Date; reason?: string }>;
  settings?: Record<string, unknown>;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RestaurantSchema = new Schema<IRestaurant>(
  {
    restaurantId: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    brandName: { type: String, trim: true },
    restaurantType: { type: String, trim: true },
    cuisineType: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    altPhone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    website: { type: String, trim: true },
    description: { type: String, trim: true },
    notes: { type: String, trim: true },
    extraInfo: { type: String, trim: true },
    gst: { type: String, trim: true },
    fssai: { type: String, trim: true },
    pan: { type: String, trim: true },
    businessRegNumber: { type: String, trim: true },
    ownerName: { type: String, trim: true },
    ownerPhone: { type: String, trim: true },
    ownerEmail: { type: String, trim: true, lowercase: true },
    emergencyContact: { type: String, trim: true },
    identityType: { type: String, trim: true },
    identityNumber: { type: String, trim: true },
    address: { type: String, trim: true },
    area: { type: String, trim: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },
    pinCode: { type: String, trim: true },
    latitude: { type: String, trim: true },
    longitude: { type: String, trim: true },
    timezone: { type: String, default: 'UTC', trim: true },
    currency: { type: String, default: 'INR', trim: true },
    gstEnabled: { type: Boolean, default: true },
    printerType: { type: String, default: 'Thermal 80mm' },
    receiptWidth: { type: String, default: '80mm' },
    taxMode: { type: String, default: 'Inclusive' },
    offlineMode: { type: Boolean, default: true },
    aiEnabled: { type: Boolean, default: false },
    loyaltyEnabled: { type: Boolean, default: true },
    weatherEnabled: { type: Boolean, default: true },
    maxDevices: { type: Number, default: 3 },
    logoUrl: { type: String, trim: true },
    coverImageUrl: { type: String, trim: true },
    media: {
      type: new Schema<IRestaurantMedia>(
        {
          logo: {
            type: new Schema<IRestaurantMediaMeta>(
              {
                key: { type: String, required: true, trim: true },
                size: { type: Number, required: true, min: 0 },
                mimetype: { type: String, required: true, trim: true },
                originalName: { type: String, required: true, trim: true, maxlength: 255 },
                uploadedBy: { type: String, required: true, trim: true },
                uploadedAt: { type: Date, default: Date.now },
              },
              { _id: false }
            ),
          },
          cover: {
            type: new Schema<IRestaurantMediaMeta>(
              {
                key: { type: String, required: true, trim: true },
                size: { type: Number, required: true, min: 0 },
                mimetype: { type: String, required: true, trim: true },
                originalName: { type: String, required: true, trim: true, maxlength: 255 },
                uploadedBy: { type: String, required: true, trim: true },
                uploadedAt: { type: Date, default: Date.now },
              },
              { _id: false }
            ),
          },
        },
        { _id: false }
      ),
      default: {},
    },
    isActive: { type: Boolean, default: true },
    ownerUserId: { type: String, trim: true },
    ownerPin: { type: String },
    tempPasswordShown: { type: Boolean, default: false },
    secretKey: { type: String },
    apiKey: { type: String },
    publicToken: { type: String, trim: true, index: { unique: true, sparse: true } },
    adminNotes: [{
      id: { type: String },
      note: { type: String },
      admin: { type: String },
      timestamp: { type: Date, default: Date.now },
    }],
    auditTrail: [{
      id: { type: String },
      action: { type: String },
      admin: { type: String },
      timestamp: { type: Date, default: Date.now },
      reason: { type: String },
    }],
    settings: { type: Schema.Types.Mixed, default: {} },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

RestaurantSchema.index({ isActive: 1 });
RestaurantSchema.index({ restaurantId: 1 });

export default mongoose.model<IRestaurant>('Restaurant', RestaurantSchema);
