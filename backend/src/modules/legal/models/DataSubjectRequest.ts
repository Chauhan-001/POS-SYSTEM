/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DataSubjectRequest — auditable record of privacy/data-management requests:
 *  - export    — user requests a copy of their personal data
 *  - close     — user requests account closure (flag for processing; does NOT
 *                auto-delete legally-required business records)
 *  - rectify   — user requests correction of their profile data
 *  - withdraw  — user withdraws optional consent (also mirrored in ConsentRecord)
 *
 * These requests are processed by the platform (and, where required, confirmed
 * by a human admin) — this model is the request log, not a delete button.
 * Deletion/anonymization of business records requires an explicit policy
 * decision (see the data-deletion architecture doc in the report).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type DataSubjectRequestType = 'export' | 'close' | 'rectify' | 'withdraw';
export type DataSubjectRequestStatus = 'received' | 'processing' | 'completed' | 'rejected' | 'needs_review';

export const DATA_SUBJECT_REQUEST_TYPES: DataSubjectRequestType[] = ['export', 'close', 'rectify', 'withdraw'];
export const DATA_SUBJECT_REQUEST_STATUSES: DataSubjectRequestStatus[] = [
  'received', 'processing', 'completed', 'rejected', 'needs_review',
];

export interface IDataSubjectRequest extends Document {
  userId: string;
  restaurantId?: mongoose.Types.ObjectId;
  requestType: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  /** Human-readable request detail (e.g. which field to rectify). */
  requestDetail?: string;
  /** Reference to a generated export artifact (e.g. audit export job id). */
  artifactRef?: string;
  /** Admin/owner note about the resolution. */
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: Date | null;
  requestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DataSubjectRequestSchema = new Schema<IDataSubjectRequest>(
  {
    userId: { type: String, required: true, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    requestType: { type: String, required: true, enum: DATA_SUBJECT_REQUEST_TYPES, index: true },
    status: { type: String, required: true, enum: DATA_SUBJECT_REQUEST_STATUSES, default: 'received', index: true },
    requestDetail: { type: String, trim: true, maxlength: 2000 },
    artifactRef: { type: String, trim: true },
    resolutionNote: { type: String, trim: true, maxlength: 2000 },
    resolvedBy: { type: String, trim: true },
    resolvedAt: { type: Date, default: null },
    requestedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

DataSubjectRequestSchema.index({ userId: 1, restaurantId: 1, requestedAt: -1 });

export default mongoose.model<IDataSubjectRequest>('DataSubjectRequest', DataSubjectRequestSchema);
