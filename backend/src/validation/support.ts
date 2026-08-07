/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * support.ts — Zod validation for the Support / Help-Desk module (Phase 2.8).
 *
 * Every ticket route validates params / query / body BEFORE reaching the
 * controller (validate middleware). Strict schemas reject unknown keys, mirroring
 * the admin-module conventions.
 */

import { z } from 'zod';
import { objectId, nonEmptyString, optString } from './common';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TICKET_SOURCES } from '../models';

/** Params for single-ticket routes: /admin/support/tickets/:id */
export const ticketParamsSchema = z.object({
  id: objectId,
}).strict();

/** Params for attachment routes: /admin/support/tickets/:id/attachments/:attachmentId */
export const ticketAttachmentParamsSchema = z.object({
  id: objectId,
  attachmentId: z.string().min(1).max(64).trim(),
}).strict();

/** Create a support ticket against a restaurant. */
export const createTicketSchema = z.object({
  restaurantId: objectId,
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  subject: nonEmptyString.max(200),
  description: nonEmptyString.max(10000),
  source: z.enum(TICKET_SOURCES).optional(),
  reporterName: optString,
  reporterEmail: z.string().email().or(z.literal('')).optional(),
}).strict();

/** Patch updateable scalar fields (subject/category/priority/description). */
export const updateTicketSchema = z.object({
  subject: nonEmptyString.max(200).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  description: nonEmptyString.max(10000).optional(),
}).strict();

/** Transition a ticket to a lifecycle status. */
export const ticketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: optString,
}).strict();

/** Assign / unassign a ticket to an admin (assigneeId null to unassign). */
export const assignTicketSchema = z.object({
  assigneeId: objectId.nullable().optional(),
}).strict();

/** Add a reply (public or internal) to a ticket. */
export const replySchema = z.object({
  body: nonEmptyString.max(10000),
  isInternal: z.boolean().optional(),
}).strict();

/** Personalize / record closing feedback. */
export const ticketSatisfactionSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: optString,
}).strict();

/** List tickets — search / filter / sort / pagination (whitelisted). */
export const ticketListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(200)).optional(),
  search: z.string().max(200).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  restaurantId: objectId.optional(),
  assigneeId: objectId.optional(),
  source: z.enum(TICKET_SOURCES).optional(),
  deleted: z.enum(['true', 'false']).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'ticketNumber', 'priority', 'status', 'restaurantName']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).strict();

export default {
  ticketParamsSchema,
  ticketAttachmentParamsSchema,
  createTicketSchema,
  updateTicketSchema,
  ticketStatusSchema,
  assignTicketSchema,
  replySchema,
  ticketSatisfactionSchema,
  ticketListQuerySchema,
};