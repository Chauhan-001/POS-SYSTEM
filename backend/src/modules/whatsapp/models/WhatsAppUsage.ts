/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WhatsAppUsage Model — Per-message usage tracking for billing/reporting.
 *
 * Records every WhatsApp message dispatched through the platform so that
 * usage-based billing, analytics, and cost tracking can be added later
 * without redesigning the integration.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type WhatsAppMessageCategory = 'marketing' | 'utility' | 'authentication';
export type WhatsAppMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface IWhatsAppUsage extends Document {
  restaurantId: mongoose.Types.ObjectId;
  messageId?: string;
  campaignId?: mongoose.Types.ObjectId;
  campaignHistoryId?: mongoose.Types.ObjectId;
  to: string;
  category: WhatsAppMessageCategory;
  status: WhatsAppMessageStatus;
  timestamp: Date;
  metaMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  cost?: number;
  currency?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const WhatsAppUsageSchema = new Schema<IWhatsAppUsage>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    messageId: { type: String, trim: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', index: true },
    campaignHistoryId: { type: Schema.Types.ObjectId, ref: 'CampaignHistory', index: true },
    to: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: ['marketing', 'utility', 'authentication'],
      default: 'utility',
    },
    status: {
      type: String,
      required: true,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed'],
      default: 'queued',
      index: true,
    },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
    metaMessageId: { type: String, trim: true, index: true },
    errorCode: { type: String, trim: true, default: null },
    errorMessage: { type: String, trim: true, default: null },
    cost: { type: Number, min: 0, default: null },
    currency: { type: String, trim: true, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

WhatsAppUsageSchema.index({ restaurantId: 1, timestamp: -1 });
WhatsAppUsageSchema.index({ restaurantId: 1, campaignId: 1, timestamp: -1 });
WhatsAppUsageSchema.index({ metaMessageId: 1 });

export default mongoose.model<IWhatsAppUsage>('WhatsAppUsage', WhatsAppUsageSchema);
