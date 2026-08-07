/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * supportTicketService.ts — Support ticket lifecycle & persistence (Phase 2.8).
 *
 * Business logic for the Help-Desk module. Keeps every mutation attributable:
 * each change appends to the ticket's embedded `timeline` and writes an
 * append-only AuditLog entry (action, actor, IP).
 *
 * Reuses platform utilities:
 *  - queryParser (parsePagination / parseSearch / parseSort / parseDateRange)
 *  - mediaService (validated attachment persistence — magic bytes, tenant
 *    namespacing, safe filenames)
 *  - AuditLog via auditLogRepo
 *
 * Notification: no external delivery providers exist on the platform, so all
 * activity is surfaced through the per-ticket timeline + the global audit log —
 * the single shared in-app channel used elsewhere — rather than spawning an
 * isolated notification system.
 */

import crypto from 'crypto';
import SupportTicket, { TicketStatus, TicketTimelineEntry, TicketAttachmentMeta } from '../models/SupportTicket';
import type { TicketCategory, TicketPriority, TicketSource } from '../models/SupportTicket';
import TicketReply from '../models/TicketReply';
import TicketCounter from '../models/TicketCounter';
import Restaurant from '../models/Restaurant';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import { mediaService } from '../modules/media';
import { auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { parsePagination, parseSearch, parseSort, parseDateRange } from '../utils/queryParser';

export interface Actor {
  id?: string;
  name: string;
  ipAddress?: string;
}

// ─── Status state machine ──────────────────────────────────────────────────
// Terminal-ish statuses (closed / cancelled) only allow reopening or, in the
// case of cancelled, remaining cancelled. All other transitions preserve the
// audit trail through the timeline.
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open', 'in_progress', 'pending', 'resolved', 'cancelled', 'closed'],
  open: ['in_progress', 'pending', 'resolved', 'cancelled', 'closed'],
  in_progress: ['pending', 'resolved', 'cancelled', 'closed'],
  pending: ['open', 'in_progress', 'resolved', 'cancelled', 'closed'],
  resolved: ['closed', 'reopened'],
  reopened: ['open', 'in_progress', 'pending', 'resolved', 'cancelled', 'closed'],
  closed: ['reopened'],
  cancelled: [],
};

function formatTicketNumber(seq: number): string {
  return `TKT-${String(seq).padStart(6, '0')}`;
}

/** Atomically allocate the next sequential ticket number (no gaps on concurrency). */
async function allocateTicketNumber(): Promise<string> {
  const counter = await TicketCounter.findOneAndUpdate(
    { name: 'support_ticket' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).exec();
  return formatTicketNumber(counter!.seq);
}

/** Append a timeline entry to a ticket document (no side effect on its own). */
function timelineEntry(actor: Actor, action: string, description: string): TicketTimelineEntry {
  return {
    id: crypto.randomUUID(),
    action,
    description,
    performedBy: actor.name,
    performedById: actor.id,
    timestamp: new Date(),
  };
}

async function writeAudit(input: {
  action: string;
  ticketId: string;
  restaurantId: string;
  actor: Actor;
  details?: Record<string, unknown>;
}): Promise<void> {
  await auditLogRepo.create({
    action: input.action,
    entityType: 'SupportTicket',
    entityId: input.ticketId,
    performedBy: input.actor.name,
    performedById: input.actor.id,
    restaurantId: input.restaurantId,
    ipAddress: input.actor.ipAddress,
    details: input.details,
  } as any);
}

// ─── Create / Read ─────────────────────────────────────────────────────────

export async function createSupportTicket(input: {
  restaurantId: string;
  category: string;
  priority?: string;
  subject: string;
  description: string;
  source?: string;
  reporterName?: string;
  reporterEmail?: string;
  actor: Actor;
}): Promise<any> {
  const restaurant = await Restaurant.findById(input.restaurantId).lean().exec();
  if (!restaurant) throw new AppError(404, 'Restaurant not found');
  if (restaurant.isDeleted) throw new AppError(400, 'Cannot raise a ticket for a deleted restaurant');

  const ticketNumber = await allocateTicketNumber();
  const actor = input.actor;

  const ticket = await SupportTicket.create({
    ticketNumber,
    restaurantId: restaurant._id,
    restaurantName: restaurant.name,
    category: input.category as TicketCategory,
    priority: (input.priority || 'medium') as TicketPriority,
    status: 'new',
    subject: input.subject,
    description: input.description,
    source: (input.source || 'internal') as TicketSource,
    reporterName: input.reporterName || undefined,
    reporterEmail: input.reporterEmail || undefined,
    attachments: [],
    timeline: [timelineEntry(actor, 'created', 'Ticket created')],
  });

  await writeAudit({
    action: 'SUPPORT_TICKET_CREATED',
    ticketId: ticket._id.toString(),
    restaurantId: restaurant._id.toString(),
    actor,
    details: { ticketNumber, category: ticket.category, priority: ticket.priority },
  });

  return ticket;
}

export async function getSupportTicket(id: string): Promise<any> {
  const ticket = await SupportTicket.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
  if (!ticket) throw new AppError(404, 'Ticket not found');
  return ticket;
}

export async function listSupportTickets(query: Record<string, any> = {}): Promise<any> {
  const { page, limit } = parsePagination(query, { page: 1, limit: 20 });

  const filter: Record<string, any> = {};
  const showDeleted = query.deleted === 'true';
  if (!showDeleted) filter.isDeleted = { $ne: true };

  const eq = ['status', 'priority', 'category', 'source'] as const;
  for (const key of eq) {
    if (query[key]) filter[key] = query[key];
  }
  if (query.restaurantId) filter.restaurantId = query.restaurantId;
  if (query.assigneeId) filter.assigneeId = query.assigneeId;

  const search = parseSearch(query.search, ['subject', 'description', 'ticketNumber', 'restaurantName', 'reporterName']);
  if (search) filter.$and = [...(filter.$and || []), search];

  if (query.from || query.to) {
    const range = parseDateRange([query.from, query.to].filter(Boolean).join(','), 'createdAt');
    if (range) filter.$and = [...(filter.$and || []), range];
  }

  const allowedSortFields = ['createdAt', 'updatedAt', 'ticketNumber', 'priority', 'status', 'restaurantName'];
  const sortBy = query.sortBy;
  // parseSort expects `-field` for descending, `field` for ascending.
  const sortValue = sortBy
    ? (query.sortOrder === 'asc' ? sortBy : `-${sortBy}`)
    : '-createdAt';
  const sort = parseSort(sortValue, allowedSortFields);

  // Priority ordering is semantic, not lexical — map to a numeric rank so
  // "urgent > high > medium > low" sorts intuitively.
  const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };

  const mongoSort: Record<string, any> = {};
  for (const [field, dir] of Object.entries(sort)) {
    if (field === 'priority') {
      mongoSort['_priority_rank'] = dir;
    } else {
      mongoSort[field] = dir;
    }
  }
  const needsPriorityRank = '_priority_rank' in mongoSort;

  const skip = (page - 1) * limit;
  const pipeline: Record<string, any>[] = [
    { $match: filter },
    { $addFields: { _priority_rank: { $switch: { branches: Object.entries(priorityRank).map(([k, v]) => ({
      case: { $eq: ['$priority', k] }, then: v })), default: 0 } } } },
  ];

  const [data, total] = await Promise.all([
    SupportTicket.aggregate([
      ...pipeline,
      { $sort: mongoSort },
      { $skip: skip },
      { $limit: limit },
      { $project: { _priority_rank: 0 } },
    ] as any).exec(),
    SupportTicket.countDocuments(filter).exec(),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    sortApplied: sortBy || 'createdAt',
    priorityRanked: needsPriorityRank,
  };
}

export async function getTicketStats(filter: Record<string, any> = {}): Promise<any> {
  const base: Record<string, any> = { isDeleted: { $ne: true } };
  if (filter.restaurantId) base.restaurantId = filter.restaurantId;
  if (filter.assigneeId) base.assigneeId = filter.assigneeId;

  const byStatus = await SupportTicket.aggregate([
    { $match: base },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).exec();
  const byPriority = await SupportTicket.aggregate([
    { $match: base },
    { $group: { _id: '$priority', count: { $sum: 1 } } },
  ]).exec();
  const total = await SupportTicket.countDocuments(base).exec();

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    byPriority: Object.fromEntries(byPriority.map((r) => [r._id, r.count])),
  };
}

// ─── Update / lifecycle ────────────────────────────────────────────────────

const UPDATEABLE = ['subject', 'category', 'priority', 'description'] as const;

export async function updateSupportTicket(id: string, patch: Record<string, any>, actor: Actor): Promise<any> {
  const ticket = await getSupportTicket(id);
  const changes: string[] = [];
  for (const key of UPDATEABLE) {
    if (patch[key] !== undefined) {
      ticket[key] = patch[key];
      changes.push(key);
    }
  }
  if (changes.length > 0) {
    ticket.timeline.push(timelineEntry(actor, 'updated', `Updated: ${changes.join(', ')}`));
    await ticket.save();
    await writeAudit({
      action: 'SUPPORT_TICKET_UPDATED',
      ticketId: ticket._id.toString(),
      restaurantId: ticket.restaurantId.toString(),
      actor,
      details: { fields: changes },
    });
  }
  return ticket;
}

export async function setTicketStatus(id: string, status: TicketStatus, note: string | undefined, actor: Actor): Promise<any> {
  const ticket = await getSupportTicket(id);
  const current = ticket.status as TicketStatus;

  if (status === current) {
    throw new AppError(400, `Ticket is already ${status}`);
  }
  const allowed = ALLOWED_TRANSITIONS[current] || [];
  if (!allowed.includes(status)) {
    throw new AppError(400, `Cannot transition ticket from '${current}' to '${status}'`);
  }

  ticket.status = status;
  if (note) ticket.timeline.push(timelineEntry(actor, 'status_note', note));

  if (status === 'resolved' || status === 'closed') {
    if (note) ticket.resolutionNote = note;
    ticket.closedAt = new Date();
    ticket.closedByName = actor.name;
  } else if (status === 'reopened') {
    ticket.closedAt = undefined;
    ticket.closedByName = undefined;
  }

  ticket.timeline.push(timelineEntry(actor, 'status_changed', `Status changed from '${current}' to '${status}'`));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_STATUS_CHANGED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor,
    details: { from: current, to: status, note },
  });
  return ticket;
}

export async function assignTicket(id: string, assigneeId: string | null | undefined, actor: Actor): Promise<any> {
  const ticket = await getSupportTicket(id);

  if (assigneeId) {
    const assignee = await User.findOne({ _id: assigneeId, isDeleted: { $ne: true } }).exec();
    if (!assignee) throw new AppError(400, 'Assignee not found');
    ticket.assigneeId = assignee._id;
    ticket.assigneeName = assignee.name;
    ticket.timeline.push(timelineEntry(actor, 'assigned', `Assigned to ${assignee.name}`));
  } else {
    ticket.assigneeId = undefined;
    ticket.assigneeName = undefined;
    ticket.timeline.push(timelineEntry(actor, 'unassigned', 'Unassigned'));
  }
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_ASSIGNED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor,
    details: { assigneeId: assigneeId || null, assigneeName: ticket.assigneeName || null },
  });
  return ticket;
}

// ─── Replies ───────────────────────────────────────────────────────────────

export async function getTicketReplies(id: string): Promise<any[]> {
  await getSupportTicket(id); // 404-guard
  return TicketReply.find({ ticketId: id, isDeleted: { $ne: true } }).sort({ createdAt: 1 }).exec();
}

export async function addTicketReply(input: {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  authorId?: string;
  authorName: string;
}): Promise<any> {
  const ticket = await getSupportTicket(input.ticketId);
  const reply = await TicketReply.create({
    ticketId: ticket._id,
    authorId: input.authorId,
    authorName: input.authorName,
    body: input.body,
    isInternal: input.isInternal ?? false,
    attachments: [],
  });

  ticket.timeline.push(timelineEntry(
    { id: input.authorId, name: input.authorName },
    input.isInternal ? 'internal_note' : 'replied',
    input.isInternal ? 'Added an internal note' : 'Added a reply',
  ));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_REPLIED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor: { id: input.authorId, name: input.authorName },
    details: { replyId: reply._id.toString(), isInternal: input.isInternal ?? false },
  });
  return reply;
}

// ─── Attachments ───────────────────────────────────────────────────────────

export async function addTicketAttachment(input: {
  ticketId: string;
  buffer: Buffer;
  mimetype: string;
  originalName: string;
  actor: Actor;
}): Promise<any> {
  const ticket = await getSupportTicket(input.ticketId);
  const { key, meta } = await mediaService.saveAttachment({
    restaurantId: ticket.restaurantId.toString(),
    buffer: input.buffer,
    mimetype: input.mimetype,
    originalName: input.originalName,
    actor: input.actor,
  });

  ticket.attachments.push(meta);
  ticket.timeline.push(timelineEntry(input.actor, 'attachment_added', `Attachment added: ${meta.originalName}`));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_ATTACHMENT_ADDED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor: input.actor,
    details: { key, size: meta.size, mimetype: meta.mimetype, originalName: meta.originalName },
  });
  return { key, meta };
}

export async function deleteTicketAttachment(id: string, attachmentId: string, actor: Actor): Promise<any> {
  const ticket = await getSupportTicket(id);
  const meta = (ticket.attachments as TicketAttachmentMeta[]).find((a) => a.id === attachmentId);
  if (!meta) throw new AppError(404, 'Attachment not found');

  await mediaService.deleteAttachment(meta.key).catch(() => {
    // Physical file already gone — still detach the reference.
  });

  ticket.attachments = (ticket.attachments as TicketAttachmentMeta[]).filter((a) => a.id !== attachmentId);
  ticket.timeline.push(timelineEntry(actor, 'attachment_removed', `Attachment removed: ${meta.originalName}`));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_ATTACHMENT_REMOVED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor,
    details: { key: meta.key, originalName: meta.originalName },
  });
  return { removed: meta.key };
}

// ─── Delete / restore ──────────────────────────────────────────────────────

export async function deleteTicket(id: string, reason: string | undefined, actor: Actor): Promise<any> {
  const ticket = await getSupportTicket(id);
  ticket.isDeleted = true;
  ticket.deletedAt = new Date();
  ticket.timeline.push(timelineEntry(actor, 'deleted', `Ticket deleted${reason ? `: ${reason}` : ''}`));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_DELETED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor,
    details: { reason },
  });
  return ticket;
}

export async function restoreTicket(id: string, actor: Actor): Promise<any> {
  const ticket = await SupportTicket.findOne({ _id: id, isDeleted: true }).exec();
  if (!ticket) throw new AppError(404, 'Deleted ticket not found');
  ticket.isDeleted = false;
  ticket.deletedAt = undefined;
  ticket.timeline.push(timelineEntry(actor, 'restored', 'Ticket restored'));
  await ticket.save();

  await writeAudit({
    action: 'SUPPORT_TICKET_RESTORED',
    ticketId: ticket._id.toString(),
    restaurantId: ticket.restaurantId.toString(),
    actor,
  });
  return ticket;
}

// ─── Activity / satisfaction ───────────────────────────────────────────────

export async function getTicketActivity(id: string): Promise<any[]> {
  await getSupportTicket(id); // 404-guard
  return AuditLog.find({ entityType: 'SupportTicket', entityId: id }).sort({ createdAt: -1 }).exec();
}

export async function recordTicketSatisfaction(id: string, rating: number, comment: string | undefined): Promise<any> {
  const ticket = await getSupportTicket(id);
  ticket.satisfactionRating = rating;
  if (comment) ticket.satisfactionComment = comment;
  await ticket.save();
  return ticket;
}