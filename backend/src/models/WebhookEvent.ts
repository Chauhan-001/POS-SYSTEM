/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebhookEvent Model — Stores all incoming webhook events for audit & idempotency.
 * Prevents duplicate processing of the same webhook event.
 * Append-only — logs are never modified.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookEvent extends Document {
  eventId: string;         // Razorpay event_id (unique, used for idempotency)
  eventType: string;       // e.g. 'payment.captured', 'order.paid'
  gateway: string;         // 'razorpay' | 'stripe' etc
  payload: string;         // Raw JSON payload
  status: 'received' | 'processed' | 'failed';
  errorMessage?: string;
  processedAt?: Date;
  createdAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    gateway: { type: String, required: true, default: 'razorpay' },
    payload: { type: String, required: true },
    status: { type: String, enum: ['received', 'processed', 'failed'], default: 'received', index: true },
    errorMessage: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

WebhookEventSchema.index({ eventType: 1, createdAt: -1 });

export default mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
