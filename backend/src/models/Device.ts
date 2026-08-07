import mongoose, { Schema, Document } from 'mongoose';

/**
 * Device lifecycle statuses (Phase 2.5):
 *   active    — trusted / approved, usable
 *   inactive  — previously seen but offline past the inactivity threshold
 *   blocked   — admin-revoked (login + refresh rejected)
 *   pending   — registered but awaiting admin/owner approval
 *   rejected  — approval declined (login + refresh rejected)
 * The first three are legacy values and remain fully supported.
 */
export type DeviceStatus = 'active' | 'inactive' | 'blocked' | 'pending' | 'rejected';

/** Database sync health for offline-first terminals. */
export type DeviceSyncStatus = 'synced' | 'syncing' | 'pending' | 'failed' | 'offline';

export interface IDevice extends Document {
  userId: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  deviceId: string;
  deviceName?: string;
  /** Human-friendly alias (optional, distinct from deviceName). */
  nickname?: string | null;
  /** Device fingerprint for duplicate/spoof detection. */
  fingerprint?: string | null;
  platform?: string | null;
  browser?: string | null;
  isElectron?: boolean;
  isMobile?: boolean;
  os?: string;
  osVersion?: string;
  appVersion?: string;
  electronVersion?: string | null;
  lastLoginAt?: Date;
  /** Last activity (login, heartbeat, or admin touch). */
  lastActivityAt?: Date;
  /** Last heartbeat from the terminal (health source). */
  lastHeartbeatAt?: Date;
  isOnline?: boolean;
  lastSyncAt?: Date;
  dbSyncStatus?: DeviceSyncStatus;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  isActive: boolean;
  status: DeviceStatus;
  /** Approval record — set when a pending device is approved/rejected. */
  approvedBy?: string | null;
  approvedAt?: Date | null;
  rejectedBy?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  notes?: string | null;
  trustLevel?: 'trusted' | 'untrusted';
  firstSeenAt?: Date;
  // Soft delete
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema = new Schema<IDevice>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    deviceId: { type: String, required: true, trim: true },
    deviceName: { type: String, trim: true, default: '' },
    nickname: { type: String, trim: true, default: null },
    fingerprint: { type: String, trim: true, default: null },
    platform: { type: String, trim: true, default: null },
    browser: { type: String, trim: true, default: null },
    isElectron: { type: Boolean, default: false },
    isMobile: { type: Boolean, default: false },
    os: { type: String, trim: true, default: '' },
    osVersion: { type: String, trim: true, default: '' },
    appVersion: { type: String, trim: true, default: '' },
    electronVersion: { type: String, trim: true, default: null },
    lastLoginAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    isOnline: { type: Boolean, default: false, index: true },
    lastSyncAt: { type: Date, default: null },
    dbSyncStatus: {
      type: String,
      enum: ['synced', 'syncing', 'pending', 'failed', 'offline'],
      default: 'synced',
    },
    pendingSyncCount: { type: Number, default: 0, min: 0 },
    failedSyncCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked', 'pending', 'rejected'],
      default: 'active',
      index: true,
    },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    notes: { type: String, default: null },
    trustLevel: { type: String, enum: ['trusted', 'untrusted'], default: 'trusted' },
    firstSeenAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletionReason: { type: String, default: null },
  },
  { timestamps: true }
);

DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ restaurantId: 1 });
DeviceSchema.index({ restaurantId: 1, status: 1, isDeleted: 1 });
DeviceSchema.index({ restaurantId: 1, isDeleted: 1, lastHeartbeatAt: -1 });
// Sparse fingerprint index — only devices that provide a fingerprint are
// deduplicated by it (spoofing / duplicate-device protection).
DeviceSchema.index({ fingerprint: 1 }, { sparse: true });
DeviceSchema.index({ status: 1, isDeleted: 1, isOnline: 1 });

export default mongoose.model<IDevice>('Device', DeviceSchema);
