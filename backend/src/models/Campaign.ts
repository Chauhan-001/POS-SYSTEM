/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Model — CRM campaign builder (Phase 1.6, extended).
 * A campaign targets an audience (segments / manual phones / filters), uses a
 * message template (SMS/WhatsApp/Email/Notification/Webhook), has a schedule and
 * tracks delivery + redemption analytics. Delivery records are appended to
 * CampaignHistory; this document holds the campaign definition & aggregates.
 *
 * Phase 17/18 additions:
 *   - 'webhook' channel (the first functional delivery adapter)
 *   - schedule.dispatchedAt (idempotency marker set by the scheduler/worker)
 *   - delivery-friendly indexes
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel = 'sms' | 'whatsapp' | 'email' | 'app_notification' | 'webhook' | 'website';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed' | 'partial';

export interface ICampaign extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  offerId?: mongoose.Types.ObjectId;
  audience: {
    segmentIds: string[];
    segmentNames: string[];
    customerPhones: string[];
  };
  template: {
    channel: CampaignChannel;
    subject?: string;
    message: string;
  };
  schedule: {
    mode: 'immediate' | 'scheduled';
    scheduledAt?: Date | null;
    /** When the scheduler/worker claimed this campaign for dispatch (idempotency). */
    dispatchedAt?: Date | null;
  };
  status: CampaignStatus;
  stats: {
    audienceCount: number;
    sentCount: number;
    failedCount: number;
    redeemedCount: number;
  };
  historyIds: string[];
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', index: true },
    audience: {
      type: new Schema({
        segmentIds: [{ type: String, trim: true }],
        segmentNames: [{ type: String, trim: true }],
        customerPhones: [{ type: String, trim: true }],
      }, { _id: false }),
      default: () => ({ segmentIds: [], segmentNames: [], customerPhones: [] }),
    },
    template: {
      type: new Schema({
        channel: { type: String, enum: ['sms', 'whatsapp', 'email', 'app_notification', 'webhook', 'website'], required: true },
        subject: { type: String, trim: true },
        message: { type: String, required: true, trim: true },
      }, { _id: false }),
      required: true,
    },
    schedule: {
      type: new Schema({
        mode: { type: String, enum: ['immediate', 'scheduled'], default: 'immediate' },
        scheduledAt: { type: Date },
        dispatchedAt: { type: Date, default: null },
      }, { _id: false }),
      default: () => ({ mode: 'immediate', scheduledAt: undefined, dispatchedAt: null }),
    },
    status: { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'partial'], default: 'draft' },
    stats: {
      type: new Schema({
        audienceCount: { type: Number, default: 0, min: 0 },
        sentCount: { type: Number, default: 0, min: 0 },
        failedCount: { type: Number, default: 0, min: 0 },
        redeemedCount: { type: Number, default: 0, min: 0 },
      }, { _id: false }),
      default: () => ({ audienceCount: 0, sentCount: 0, failedCount: 0, redeemedCount: 0 }),
    },
    historyIds: [{ type: String, trim: true }],
    createdBy: { type: String, trim: true },
  },
  { timestamps: true }
);

CampaignSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
CampaignSchema.index({ restaurantId: 1, createdAt: -1 });
CampaignSchema.index({ restaurantId: 1, 'schedule.scheduledAt': 1, status: 1 });
CampaignSchema.index({ restaurantId: 1, offerId: 1 });

export default mongoose.model<ICampaign>('Campaign', CampaignSchema);
