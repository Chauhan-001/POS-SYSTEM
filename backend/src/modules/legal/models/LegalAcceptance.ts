/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LegalAcceptance — immutable record of a user's acceptance of a specific
 * legal-document version.
 *
 * Contractual acceptance (this model) is deliberately separate from privacy
 * consent (ConsentRecord). One acceptance row per (user, restaurant, document
 * type, version) — re-acceptance creates a NEW row; the old row is never
 * modified or deleted.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { LegalDocumentType } from './LegalDocument';

export interface ILegalAcceptance extends Document {
  /** POS user id (owner/staff) or admin user id for platform docs. */
  userId: string;
  /** Tenant (restaurant) this acceptance belongs to — null for platform-level docs. */
  restaurantId?: mongoose.Types.ObjectId;
  documentType: LegalDocumentType;
  documentVersion: string;
  /** Snapshot of the document title at acceptance time (display only). */
  documentTitle?: string;
  /** Snapshot of effectiveAt at acceptance time. */
  effectiveAt?: Date;
  acceptedAt: Date;
  /** Where the acceptance happened: 'onboarding' | 'settings' | 're_acceptance' | 'pos' | 'admin' */
  context: string;
  /** Application surface: 'pos' | 'admin' | 'customer_site' */
  platform: string;
  /** Minimal, non-PII metadata (e.g. app version, device role). */
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const LegalAcceptanceSchema = new Schema<ILegalAcceptance>(
  {
    userId: { type: String, required: true, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    documentType: { type: String, required: true, index: true },
    documentVersion: { type: String, required: true, trim: true },
    documentTitle: { type: String, trim: true },
    effectiveAt: { type: Date },
    acceptedAt: { type: Date, required: true, default: Date.now, index: true },
    context: { type: String, required: true, default: 'pos', trim: true },
    platform: { type: String, required: true, default: 'pos', trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Unique per (user, restaurant, type, version) — idempotent acceptance.
LegalAcceptanceSchema.index(
  { userId: 1, restaurantId: 1, documentType: 1, documentVersion: 1 },
  { unique: true }
);

export default mongoose.model<ILegalAcceptance>('LegalAcceptance', LegalAcceptanceSchema);
