/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HelpView — lightweight, tenant-scoped usage analytics for help content.
 *
 * Purpose: record WHICH help content is actually consumed so the platform can
 * improve the help based on real usage (not guesses). Two event kinds:
 *   - view    → a FAQ question was expanded, or a legal document was opened
 *   - search  → a FAQ search was performed (query + how many results matched;
 *               a query with 0 results is the strongest signal content is
 *               missing)
 *
 * Design rules:
 *  - Every row is scoped to the restaurantId from the JWT — never from the
 *    client. Tenant isolation is enforced at the controller layer.
 *  - Rows are append-only and cheap; they are NOT part of the compliance
 *    audit chain (see the audit module for immutable, integrity-checked logs).
 *  - viewerId/viewerName are snapshots at event time (a staff member's name
 *    may change later — the event keeps the value that was true then).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type HelpContentType = 'faq' | 'legal';
export type HelpEventType = 'view' | 'search';

export interface IHelpView extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  /** Who performed the event (employee/user id snapshot). */
  viewerId?: string;
  /** Display name of the viewer at event time. */
  viewerName?: string;
  eventType: HelpEventType;
  contentType: HelpContentType;
  /**
   * Stable identifier of the content:
   *   faq   → `${sectionId}:${index}` (e.g. "ordering:0")
   *   legal → `${documentType}:${version}` (e.g. "privacy_policy:1.0")
   */
  contentKey: string;
  /** Human-readable snapshot of the content (question text / doc title). */
  contentTitle: string;
  /** For search events — the normalized query text. */
  query?: string;
  /** For search events — how many FAQ items matched. */
  resultCount?: number;
  viewedAt: Date;
  createdAt: Date;
}

const HelpViewSchema = new Schema<IHelpView>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    viewerId: { type: String, trim: true },
    viewerName: { type: String, trim: true },
    eventType: { type: String, required: true, enum: ['view', 'search'], index: true },
    contentType: { type: String, required: true, enum: ['faq', 'legal'] },
    contentKey: { type: String, required: true, trim: true, maxlength: 200 },
    contentTitle: { type: String, trim: true, maxlength: 500 },
    query: { type: String, trim: true, maxlength: 300 },
    resultCount: { type: Number, min: 0 },
    viewedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

HelpViewSchema.index({ restaurantId: 1, eventType: 1, contentType: 1, contentKey: 1, viewedAt: -1 });
HelpViewSchema.index({ restaurantId: 1, viewedAt: -1 });

export default mongoose.model<IHelpView>('HelpView', HelpViewSchema);
