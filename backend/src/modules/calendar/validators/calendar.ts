/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Calendar Validation — Zod schemas for the Context Calendar API (Phase 1).
 *
 * Schemas only shape input; cross-field and tenancy rules (endDate >=
 * startDate, scope-field requirements, restaurant scoping) are enforced in
 * calendarService so the same rules apply to Gemini/external writes later.
 */

import { z } from 'zod';
import {
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_SCOPES,
  CALENDAR_RELEVANCE,
  CALENDAR_EVENT_STATUSES,
} from '../models/CalendarEvent';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date (expected ISO string)');

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .optional()
  .transform((t) => t ?? []);

export const createEventSchema = z
  .object({
    name: z.string().trim().min(1, 'Event name is required').max(200),
    type: z.enum(CALENDAR_EVENT_TYPES),
    startDate: isoDate,
    endDate: isoDate,
    scope: z.enum(CALENDAR_EVENT_SCOPES),
    country: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    region: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    /** Admin may target an event at a restaurant; tenancy is validated in the service. */
    restaurantId: objectIdString.optional(),
    description: z.string().trim().max(2000).optional(),
    tags: tagsSchema,
    marketingRelevance: z.enum(CALENDAR_RELEVANCE).default('medium'),
    preparationWindowDays: z.number().int().min(0).max(365).default(0),
    status: z.enum(CALENDAR_EVENT_STATUSES).default('active'),
  })
  .strict();

export const updateEventSchema = createEventSchema.partial();

export const eventParamsSchema = z.object({ id: objectIdString });

export const eventQuerySchema = z
  .object({
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    type: z.enum(CALENDAR_EVENT_TYPES).optional(),
    scope: z.enum(CALENDAR_EVENT_SCOPES).optional(),
    status: z.enum(CALENDAR_EVENT_STATUSES).optional(),
    search: z.string().trim().max(200).optional(),
    restaurantId: objectIdString.optional(),
    /** Upcoming window helper: events starting within N days from now. */
    withinDays: z.coerce.number().int().min(1).max(366).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strip();

export const archiveEventSchema = z.object({}).strip();

// ─── Calendar AI assistant (Phase 2) ─────────────────────────────
// The LLM never receives restaurantId and never persists anything; the
// approve endpoint re-validates every candidate server-side.

export const assistantGenerateSchema = z
  .object({
    request: z.string().trim().min(3).max(500),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strip();

export const assistantApproveSchema = z
  .object({
    /** Reviewed candidates echoed back from the generate response. */
    candidates: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
    /** Explicitly accept a duplicate the admin reviewed. */
    force: z.boolean().optional(),
  })
  .strip();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventQueryInput = z.infer<typeof eventQuerySchema>;
