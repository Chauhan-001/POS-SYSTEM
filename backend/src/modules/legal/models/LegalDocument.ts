/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LegalDocument — versioned, immutable-after-publish legal documents.
 *
 * Design rules:
 *  - status lifecycle: draft → published → archived (draft → archived allowed).
 *  - Only ONE published version may exist per (documentType, jurisdiction,
 *    language). Publishing a new version auto-archives the previous published
 *    version (atomic, in the service layer).
 *  - Published and archived documents are immutable: content/title/effectiveAt
 *    can never be edited. Only drafts can be modified.
 *  - Old versions are never deleted.
 *
 * The backend is the single source of truth for legal-document versions — the
 * frontends only ever render what this model exposes.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type LegalDocumentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'merchant_agreement'
  | 'customer_terms'
  | 'refund_policy'
  | 'ai_voice_disclosure'
  | 'acceptable_use'
  | 'data_processing_addendum';

export type LegalDocumentStatus = 'draft' | 'published' | 'archived';

export const LEGAL_DOCUMENT_TYPES: LegalDocumentType[] = [
  'terms_of_service',
  'privacy_policy',
  'merchant_agreement',
  'customer_terms',
  'refund_policy',
  'ai_voice_disclosure',
  'acceptable_use',
  'data_processing_addendum',
];

export const LEGAL_DOCUMENT_STATUSES: LegalDocumentStatus[] = ['draft', 'published', 'archived'];

export interface ILegalDocument extends Document {
  documentType: LegalDocumentType;
  /** Semantic version string, e.g. "1.0", "1.1", "2.0". */
  version: string;
  title: string;
  /** Document body (plain text or structured markdown). Rendered read-only. */
  content: string;
  /** Date the document becomes binding if accepted on/after. */
  effectiveAt: Date;
  /** When it was published (null while draft). */
  publishedAt: Date | null;
  status: LegalDocumentStatus;
  /** ISO 3166-1 alpha-2 country code, "GLOBAL" for worldwide docs. */
  jurisdiction: string;
  /** IETF language tag, e.g. "en", "hi". */
  language: string;
  /** Whether accepting this document is mandatory (blocking) for users. */
  requireAcceptance: boolean;
  /** Whether a change to this document triggers re-acceptance for prior acceptors. */
  reAcceptanceRequired: boolean;
  /** Free-text notes visible to admins only (e.g. lawyer review status). */
  adminNotes?: string;
  /** Admin identity that last modified this document. */
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LegalDocumentSchema = new Schema<ILegalDocument>(
  {
    documentType: { type: String, required: true, enum: LEGAL_DOCUMENT_TYPES, index: true },
    version: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    content: { type: String, required: true },
    effectiveAt: { type: Date, required: true, default: Date.now },
    publishedAt: { type: Date, default: null },
    status: { type: String, required: true, enum: LEGAL_DOCUMENT_STATUSES, default: 'draft', index: true },
    jurisdiction: { type: String, required: true, default: 'IN', trim: true, index: true },
    language: { type: String, required: true, default: 'en', trim: true, index: true },
    requireAcceptance: { type: Boolean, default: true },
    reAcceptanceRequired: { type: Boolean, default: true },
    adminNotes: { type: String, trim: true, maxlength: 2000 },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

// One published version per (type, jurisdiction, language) — enforced in the
// service layer with a transaction; this index supports the lookup.
LegalDocumentSchema.index({ documentType: 1, jurisdiction: 1, language: 1, status: 1, version: 1 });
LegalDocumentSchema.index({ status: 1, documentType: 1, publishedAt: -1 });

export default mongoose.model<ILegalDocument>('LegalDocument', LegalDocumentSchema);
