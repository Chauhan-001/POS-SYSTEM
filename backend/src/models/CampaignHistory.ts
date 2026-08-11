/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign History Model — Tracks offer campaigns sent to customers via
 * WhatsApp, SMS, email, app notifications, or webhook.
 *
 * Phase 17: `results[]` records the outcome of EVERY recipient delivery attempt
 * (individual failures are never lost), and `campaignId` links the record back
 * to the Campaign that produced it (replacing reliance on the offerId only).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel = 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'website' | 'in_app' | 'webhook';

export interface DeliveryResultEntry {
  phone: string;
  status: 'delivered' | 'failed';
  error?: string;
  deliveredAt?: string;
}

export interface ICampaignHistory extends Document {
  /** Offer this delivery promoted — null when the campaign has no linked offer. */
  offerId?: mongoose.Types.ObjectId | null;
  restaurantId: mongoose.Types.ObjectId;
  /** Owning campaign (delivery-queue era) — null/absent for legacy rows. */
  campaignId?: mongoose.Types.ObjectId;
  channel: CampaignChannel;
  /** Customer phones that were contacted */
  recipientPhones: string[];
  /** Count of recipients */
  recipientCount: number;
  /** Count of opened/delivered */
  openedCount: number;
  /** Count of redeemed */
  redeemedCount: number;
  /** Per-recipient delivery outcome (never loses individual failures) */
  results: DeliveryResultEntry[];
  /** Message sent (template rendered) */
  messageContent: string;
  /** Whether the campaign is scheduled (vs sent immediately) */
  isScheduled: boolean;
  /** Scheduled send date */
  scheduledDate?: string;
  /** Actual send date */
  sentDate?: string;
  /** Cost of campaign (e.g. SMS costs) */
  campaignCost: number;
  status: 'pending' | 'sent' | 'failed' | 'partial';
  errorLog?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignHistorySchema = new Schema<ICampaignHistory>(
  {
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', default: null, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email', 'app_notification', 'website', 'in_app', 'webhook'], required: true },
    recipientPhones: [{ type: String, trim: true }],
    recipientCount: { type: Number, default: 0, min: 0 },
    openedCount: { type: Number, default: 0, min: 0 },
    redeemedCount: { type: Number, default: 0, min: 0 },
    results: {
      type: [
        new Schema(
          {
            phone: { type: String, trim: true, required: true },
            status: { type: String, enum: ['delivered', 'failed'], required: true },
            error: { type: String, trim: true, default: undefined },
            deliveredAt: { type: String, trim: true, default: undefined },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    messageContent: { type: String, default: '', trim: true },
    isScheduled: { type: Boolean, default: false },
    scheduledDate: { type: String, trim: true },
    sentDate: { type: String, trim: true },
    campaignCost: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'partial'], default: 'pending' },
    errorLog: { type: String, trim: true },
  },
  { timestamps: true }
);

CampaignHistorySchema.index({ offerId: 1, sentDate: -1 });
CampaignHistorySchema.index({ restaurantId: 1, sentDate: -1 });
CampaignHistorySchema.index({ restaurantId: 1, campaignId: 1, createdAt: -1 });

export default mongoose.model<ICampaignHistory>('CampaignHistory', CampaignHistorySchema);
