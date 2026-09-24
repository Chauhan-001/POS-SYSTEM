/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WhatsAppIntegration Model — Per-restaurant WhatsApp Business Platform connection.
 *
 * Stores the Meta-issued identifiers and encrypted credentials for a single
 * restaurant's WhatsApp Business Account. Every restaurant has at most one
 * ACTIVE integration; old connections are preserved for audit/history.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type WhatsAppIntegrationStatus =
  | 'not_connected'
  | 'connecting'
  | 'active'
  | 'inactive'
  | 'disconnected'
  | 'error';

export interface IWhatsAppIntegration extends Document {
  restaurantId: mongoose.Types.ObjectId;
  provider: string;
  status: WhatsAppIntegrationStatus;
  businessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  displayName?: string;
  credentialReference: string;
  connectedAt?: Date;
  disconnectedAt?: Date;
  lastVerifiedAt?: Date;
  lastError?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppIntegrationSchema = new Schema<IWhatsAppIntegration>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    provider: { type: String, required: true, default: 'whatsapp', index: true },
    status: {
      type: String,
      required: true,
      enum: ['not_connected', 'connecting', 'active', 'inactive', 'disconnected', 'error'],
      default: 'not_connected',
      index: true,
    },
    businessId: { type: String, trim: true, index: true },
    wabaId: { type: String, trim: true, index: true },
    phoneNumberId: { type: String, trim: true, index: true },
    displayPhoneNumber: { type: String, trim: true },
    displayName: { type: String, trim: true },
    credentialReference: { type: String, required: true, trim: true },
    connectedAt: { type: Date },
    disconnectedAt: { type: Date },
    lastVerifiedAt: { type: Date },
    lastError: { type: String, trim: true, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

WhatsAppIntegrationSchema.index({ restaurantId: 1, provider: 1 }, { unique: true });
WhatsAppIntegrationSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model<IWhatsAppIntegration>('WhatsAppIntegration', WhatsAppIntegrationSchema);
