/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SupportTicket Model — Platform support / help-desk tickets.
 *
 * A ticket represents a support request raised against a restaurant (billing,
 * technical, account, feature request, ...) and is managed by dashboard admins.
 *
 * Design:
 *  - Sequential, human-friendly ticket numbers (e.g. "TKT-000042") allocated
 *    atomically via the dedicated TicketCounter collection (no gaps from
 *    concurrent creation).
 *  - Embedded `timeline` gives a full per-ticket activity trail (reused pattern
 *    from Restaurant.auditTrail / User.activityHistory).
 *  - Soft delete: records are never hard-removed by normal flows.
 *  - Attachments reference files persisted by the platform's MediaService and
 *    are exposed as relative `/uploads/...` keys.
 */

import mongoose, { Schema, Document } from 'mongoose';

/** Categories a ticket can belong to. */
export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'feature_request', 'bug', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Priorities that drive triage order. */
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Lifecycle statuses. See ALLOWED_TRANSITIONS in the service for the state machine. */
export const TICKET_STATUSES = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'reopened', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Where a ticket originated from. */
export const TICKET_SOURCES = ['restaurant', 'owner', 'internal'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

/** An attachment persisted via the platform media service. */
export interface TicketAttachmentMeta {
  id: string;
  key: string;
  size: number;
  mimetype: string;
  originalName: string;
  uploadedBy: string;
  uploadedAt: Date;
}

/** An embedded activity entry in a ticket's timeline. */
export interface TicketTimelineEntry {
  id: string;
  action: string;
  description: string;
  performedBy: string;
  performedById?: string;
  timestamp: Date;
}

export interface ISupportTicket extends Document {
  /** Sequential human-friendly number, e.g. "TKT-000042". */
  ticketNumber: string;
  restaurantId: mongoose.Types.ObjectId;
  restaurantName: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  description: string;
  source: TicketSource;
  reporterName?: string;
  reporterEmail?: string;
  assigneeId?: mongoose.Types.ObjectId;
  assigneeName?: string;
  attachments: TicketAttachmentMeta[];
  timeline: TicketTimelineEntry[];
  resolutionNote?: string;
  closedAt?: Date;
  closedByName?: string;
  satisfactionRating?: number;
  satisfactionComment?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<TicketAttachmentMeta>({
  id: { type: String, required: true },
  key: { type: String, required: true, trim: true },
  size: { type: Number, required: true, min: 0 },
  mimetype: { type: String, required: true, trim: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  uploadedBy: { type: String, required: true, trim: true },
  uploadedAt: { type: Date, default: Date.now },
});

const TimelineEntrySchema = new Schema<TicketTimelineEntry>({
  id: { type: String, required: true },
  action: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  performedBy: { type: String, required: true, trim: true },
  performedById: { type: String, trim: true, default: null },
  timestamp: { type: Date, default: Date.now },
});

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    ticketNumber: { type: String, required: true, trim: true, unique: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    restaurantName: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: TICKET_CATEGORIES, index: true },
    priority: { type: String, default: 'medium', enum: TICKET_PRIORITIES, index: true },
    status: { type: String, default: 'new', enum: TICKET_STATUSES, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 10000 },
    source: { type: String, default: 'internal', enum: TICKET_SOURCES },
    reporterName: { type: String, trim: true, maxlength: 200, default: null },
    reporterEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assigneeName: { type: String, trim: true, maxlength: 200, default: null },
    attachments: { type: [AttachmentSchema], default: [] },
    timeline: { type: [TimelineEntrySchema], default: [] },
    resolutionNote: { type: String, trim: true, maxlength: 10000, default: null },
    closedAt: { type: Date, default: null },
    closedByName: { type: String, trim: true, maxlength: 200, default: null },
    satisfactionRating: { type: Number, min: 1, max: 5, default: null },
    satisfactionComment: { type: String, trim: true, maxlength: 5000, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SupportTicketSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ assigneeId: 1, status: 1 });
SupportTicketSchema.index({ priority: 1, status: 1 });
SupportTicketSchema.index({ subject: 'text', description: 'text', ticketNumber: 'text', restaurantName: 'text' });

export default mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);