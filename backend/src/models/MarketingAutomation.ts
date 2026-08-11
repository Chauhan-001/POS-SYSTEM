/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketingAutomation Model — Predefined automation recipes (Phase 19).
 *
 * These are NOT a workflow engine. Each row is a simple recipe:
 *   type        — birthday | win_back | vip
 *   enabled     — ON/OFF toggle from the POS
 *   channel     — which delivery channel to use
 *   offerTemplate — the baked-in offer (title, type, value, min order)
 *   message     — optional custom message; empty = auto-generated
 *   lastRunAt   — idempotency marker: the recipe fires at most once per day
 *
 * The scheduler turns each enabled recipe into a real Campaign (targeting the
 * recipe's segment) and queues it for delivery — reusing the segment engine
 * and campaign infrastructure. No data migration is required.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type MarketingAutomationType = 'birthday' | 'win_back' | 'vip';

export interface IMarketingAutomation extends Document {
  restaurantId: mongoose.Types.ObjectId;
  type: MarketingAutomationType;
  name: string;
  description: string;
  enabled: boolean;
  channel: 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'webhook';
  offerTemplate: {
    type: string;
    value: number;
    title?: string;
    minOrderValue?: number;
  };
  /** Optional custom message; empty = auto-generated from the offer template. */
  message?: string;
  lastRunAt?: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MarketingAutomationSchema = new Schema<IMarketingAutomation>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    type: { type: String, enum: ['birthday', 'win_back', 'vip'], required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    enabled: { type: Boolean, default: false },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email', 'app_notification', 'webhook'], default: 'whatsapp' },
    offerTemplate: {
      type: new Schema(
        {
          type: { type: String, default: 'percentage' },
          value: { type: Number, default: 15, min: 0 },
          title: { type: String, trim: true, default: '' },
          minOrderValue: { type: Number, min: 0, default: null },
        },
        { _id: false },
      ),
      default: () => ({ type: 'percentage', value: 15, title: '', minOrderValue: null }),
    },
    message: { type: String, trim: true, default: '' },
    lastRunAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MarketingAutomationSchema.index({ restaurantId: 1, type: 1 });
MarketingAutomationSchema.index({ restaurantId: 1, enabled: 1, lastRunAt: 1 });

export default mongoose.model<IMarketingAutomation>('MarketingAutomation', MarketingAutomationSchema);
