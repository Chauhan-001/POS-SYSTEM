/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign History Model — Tracks offer campaigns sent to customers via
 * WhatsApp, SMS, email, or app notifications.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel = 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'website' | 'in_app';

export interface ICampaignHistory extends Document {
  offerId: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  channel: CampaignChannel;
  /** Customer phones that were contacted */
  recipientPhones: string[];
  /** Count of recipients */
  recipientCount: number;
  /** Count of opened/delivered */
  openedCount: number;
  /** Count of redeemed */
  redeemedCount: number;
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
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email', 'app_notification', 'website', 'in_app'], required: true },
    recipientPhones: [{ type: String, trim: true }],
    recipientCount: { type: Number, default: 0, min: 0 },
    openedCount: { type: Number, default: 0, min: 0 },
    redeemedCount: { type: Number, default: 0, min: 0 },
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

export default mongoose.model<ICampaignHistory>('CampaignHistory', CampaignHistorySchema);
