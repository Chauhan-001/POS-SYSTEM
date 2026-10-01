import mongoose, { Schema, Document } from 'mongoose';

/**
 * Device activity event feed (append-only). Phase 2.5 extends the original
 * event set with the full lifecycle: approval, rejection, removal, logout,
 * limit violations, and health transitions.
 */
export type DeviceActivityEvent =
  | 'device_registered'
  | 'device_login'
  | 'device_blocked'
  | 'device_unblocked'
  | 'device_inactive'
  | 'heartbeat'
  | 'device_approved'
  | 'device_rejected'
  | 'device_removed'
  | 'device_permanent_delete'
  | 'device_logout'
  | 'device_limit_violation'
  | 'device_offline'
  | 'device_online'
  | 'device_session_revoked'
  | 'device_status_change'
  | 'device_rename';

export interface IDeviceActivity extends Document {
  deviceId: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  event: DeviceActivityEvent;
  description: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  createdAt: Date;
}

const DeviceActivitySchema = new Schema<IDeviceActivity>(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    event: {
      type: String,
      enum: [
        'device_registered', 'device_login', 'device_blocked', 'device_unblocked',
        'device_inactive', 'heartbeat',
        'device_approved', 'device_rejected', 'device_removed', 'device_permanent_delete',
        'device_logout', 'device_limit_violation', 'device_offline', 'device_online',
        'device_session_revoked', 'device_status_change', 'device_rename',
      ],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

DeviceActivitySchema.index({ deviceId: 1, createdAt: -1 });
DeviceActivitySchema.index({ restaurantId: 1, createdAt: -1 });
DeviceActivitySchema.index({ event: 1, createdAt: -1 });

export default mongoose.model<IDeviceActivity>('DeviceActivity', DeviceActivitySchema);
