/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WhatsAppIntegrationHistory Model — Audit trail for WhatsApp connections.
 *
 * Preserves historical connection data so admins can review past integrations,
 * troubleshoot issues, and maintain compliance records. Append-only.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type IntegrationHistoryStatus =
  | 'active'
  | 'inactive'
  | 'disconnected'
  | 'error';

export interface IWhatsAppIntegrationHistory extends Document {
  restaurantId: mongoose.Types.ObjectId;
  integrationId?: mongoose.Types.ObjectId;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  displayName?: string;
  status: IntegrationHistoryStatus;
  reason?: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  createdAt: Date;
}

const WhatsAppIntegrationHistorySchema = new Schema<IWhatsAppIntegrationHistory>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    integrationId: { type: Schema.Types.ObjectId, ref: 'WhatsAppIntegration', index: true },
    wabaId: { type: String, trim: true },
    phoneNumberId: { type: String, trim: true },
    displayPhoneNumber: { type: String, trim: true },
    displayName: { type: String, trim: true },
    status: {
      type: String,
      required: true,
      enum: ['active', 'inactive', 'disconnected', 'error'],
      index: true,
    },
    reason: { type: String, trim: true, default: null },
    connectedAt: { type: Date, required: true },
    disconnectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

WhatsAppIntegrationHistorySchema.index({ restaurantId: 1, createdAt: -1 });
WhatsAppIntegrationHistorySchema.index({ integrationId: 1, createdAt: -1 });

export default mongoose.model<IWhatsAppIntegrationHistory>('WhatsAppIntegrationHistory', WhatsAppIntegrationHistorySchema);
