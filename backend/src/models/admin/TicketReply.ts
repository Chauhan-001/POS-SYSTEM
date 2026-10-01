/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TicketReply Model — A message (public or internal) on a support ticket.
 *
 * Public replies are visible to the restaurant/owner side; internal replies
 * are notes meant only for platform admins. Attachments follow the same
 * MediaService-persisted shape used by the parent ticket.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { TicketAttachmentMeta } from './SupportTicket';

export interface ITicketReply extends Document {
  ticketId: mongoose.Types.ObjectId;
  authorId?: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  attachments: TicketAttachmentMeta[];
  createdAt: Date;
  updatedAt: Date;
}

const ReplyAttachmentSchema = new Schema<TicketAttachmentMeta>({
  id: { type: String, required: true },
  key: { type: String, required: true, trim: true },
  size: { type: Number, required: true, min: 0 },
  mimetype: { type: String, required: true, trim: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  uploadedBy: { type: String, required: true, trim: true },
  uploadedAt: { type: Date, default: Date.now },
});

const TicketReplySchema = new Schema<ITicketReply>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
    authorId: { type: String, trim: true, maxlength: 120, default: null },
    authorName: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 10000 },
    isInternal: { type: Boolean, default: false },
    attachments: { type: [ReplyAttachmentSchema], default: [] },
  },
  { timestamps: true }
);

TicketReplySchema.index({ ticketId: 1, createdAt: 1 });

export default mongoose.model<ITicketReply>('TicketReply', TicketReplySchema);