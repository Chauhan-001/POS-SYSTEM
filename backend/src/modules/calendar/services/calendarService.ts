/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Calendar Service — authoritative business rules for the Context Calendar
 * (Phase 1: admin-managed). All writes flow through here so later sources
 * (gemini/external) inherit the same validation and tenancy rules.
 *
 * Tenancy model:
 *   - scope 'restaurant' events MUST carry a restaurantId and are only
 *     served for that restaurant (listEvents/getEvent filters).
 *   - scope india/state/region/city events are global (no restaurantId) and
 *     visible platform-wide.
 */

import mongoose from 'mongoose';
import CalendarEvent, {
  type ICalendarEvent,
  type CalendarEventScope,
} from '../models/CalendarEvent';
import type {
  CreateEventInput,
  UpdateEventInput,
  EventQueryInput,
} from '../validators/calendar';
import { invalidateCalendarIntelligence } from './calendarSignalEngine';

export class CalendarValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CalendarValidationError';
  }
}

export class CalendarNotFoundError extends Error {
  status = 404;
  constructor(message = 'Calendar event not found') {
    super(message);
    this.name = 'CalendarNotFoundError';
  }
}

function assertDateOrder(startDate: Date, endDate: Date): void {
  if (endDate.getTime() < startDate.getTime()) {
    throw new CalendarValidationError('endDate must be on or after startDate');
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Scope-field requirements (spec §5): state→state, city→state+city, restaurant→restaurantId. */
function assertScopeFields(
  scope: CalendarEventScope,
  fields: { state?: string; city?: string; restaurantId?: string | null },
): void {
  if (scope === 'state' && !fields.state?.trim()) {
    throw new CalendarValidationError('state is required when scope = state');
  }
  if (scope === 'city') {
    if (!fields.state?.trim()) throw new CalendarValidationError('state is required when scope = city');
    if (!fields.city?.trim()) throw new CalendarValidationError('city is required when scope = city');
  }
  if (scope === 'restaurant' && !fields.restaurantId) {
    throw new CalendarValidationError('restaurantId is required when scope = restaurant');
  }
}

/** Global scopes must NOT carry a restaurantId — keeps the shared calendar clean. */
function normalizeRestaurantId(
  scope: CalendarEventScope,
  restaurantId: string | null | undefined,
): mongoose.Types.ObjectId | null {
  if (scope === 'restaurant') {
    return new mongoose.Types.ObjectId(restaurantId as string);
  }
  return null;
}

export interface CalendarActor {
  /** Admin user id (from the admin JWT), used for createdBy audit. */
  userId?: string | null;
  /** Trusted source for the audit trail — callers cannot set it via the body. */
  source?: 'admin' | 'gemini' | 'external';
}

export async function createEvent(input: CreateEventInput, actor: CalendarActor = {}): Promise<ICalendarEvent> {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  assertDateOrder(startDate, endDate);
  assertScopeFields(input.scope, input);

  const doc = await CalendarEvent.create({
    name: input.name,
    type: input.type,
    startDate,
    endDate,
    scope: input.scope,
    country: input.country?.trim() || undefined,
    state: input.state?.trim() || undefined,
    region: input.region?.trim() || undefined,
    city: input.city?.trim() || undefined,
    restaurantId: normalizeRestaurantId(input.scope, input.restaurantId),
    description: input.description?.trim() || undefined,
    tags: normalizeTags(input.tags),
    marketingRelevance: input.marketingRelevance ?? 'medium',
    preparationWindowDays: input.preparationWindowDays ?? 0,
    status: input.status ?? 'active',
    source: actor.source ?? 'admin',
    createdBy: actor.userId && mongoose.isValidObjectId(actor.userId) ? new mongoose.Types.ObjectId(actor.userId) : null,
  });
  invalidateCalendarIntelligence(input.restaurantId ?? undefined);
  return doc;
}

export async function updateEvent(id: string, input: UpdateEventInput): Promise<ICalendarEvent> {
  const existing = await CalendarEvent.findById(id).exec();
  if (!existing) throw new CalendarNotFoundError();

  const nextScope = (input.scope ?? existing.scope) as CalendarEventScope;
  const nextStart = input.startDate ? new Date(input.startDate) : existing.startDate;
  const nextEnd = input.endDate ? new Date(input.endDate) : existing.endDate;
  assertDateOrder(nextStart, nextEnd);

  // Scope may be changed — re-check its field requirements against the merged doc.
  assertScopeFields(nextScope, {
    state: input.state ?? existing.state,
    city: input.city ?? existing.city,
    restaurantId:
      input.scope === 'restaurant'
        ? (input.restaurantId ?? existing.restaurantId?._id?.toString() ?? existing.restaurantId?.toString())
        : existing.restaurantId?.toString(),
  });

  const restaurantId =
    input.scope !== undefined
      ? normalizeRestaurantId(nextScope, input.scope === 'restaurant'
          ? (input.restaurantId ?? existing.restaurantId?.toString())
          : undefined)
      : existing.restaurantId;

  existing.set({
    name: input.name?.trim() || existing.name,
    type: input.type ?? existing.type,
    startDate: nextStart,
    endDate: nextEnd,
    scope: nextScope,
    country: input.country !== undefined ? (input.country?.trim() || undefined) : existing.country,
    state: input.state !== undefined ? (input.state?.trim() || undefined) : existing.state,
    region: input.region !== undefined ? (input.region?.trim() || undefined) : existing.region,
    city: input.city !== undefined ? (input.city?.trim() || undefined) : existing.city,
    restaurantId,
    description: input.description !== undefined ? (input.description?.trim() || undefined) : existing.description,
    tags: input.tags !== undefined ? normalizeTags(input.tags) : existing.tags,
    marketingRelevance: input.marketingRelevance ?? existing.marketingRelevance,
    preparationWindowDays: input.preparationWindowDays ?? existing.preparationWindowDays,
    status: input.status ?? existing.status,
  });
  await existing.save();
  invalidateCalendarIntelligence(existing.restaurantId?.toString());
  return existing;
}

export async function getEvent(id: string): Promise<ICalendarEvent> {
  const doc = await CalendarEvent.findById(id).exec();
  if (!doc) throw new CalendarNotFoundError();
  return doc;
}

/** Deactivate, keep recoverable (spec prefers archive over delete). */
export async function archiveEvent(id: string): Promise<ICalendarEvent> {
  const doc = await CalendarEvent.findByIdAndUpdate(
    id,
    { status: 'archived' },
    { new: true },
  ).exec();
  if (!doc) throw new CalendarNotFoundError();
  invalidateCalendarIntelligence(doc.restaurantId?.toString());
  return doc;
}

/** Recover an archived event (kept practical per spec §6). */
export async function restoreEvent(id: string): Promise<ICalendarEvent> {
  const doc = await CalendarEvent.findByIdAndUpdate(
    id,
    { status: 'active' },
    { new: true },
  ).exec();
  if (!doc) throw new CalendarNotFoundError();
  invalidateCalendarIntelligence(doc.restaurantId?.toString());
  return doc;
}

/**
 * Approve a draft → active (Calendar Phase 2, spec §9). Only drafts can be
 * approved — archived (rejected) events must be restored first, so a rejected
 * candidate can never silently become canonical.
 */
export async function approveEvent(id: string): Promise<ICalendarEvent> {
  const doc = await CalendarEvent.findById(id).exec();
  if (!doc) throw new CalendarNotFoundError();
  if (doc.status !== 'draft') {
    throw new CalendarValidationError(`Only draft events can be approved (current status: ${doc.status}).`);
  }
  doc.status = 'active';
  await doc.save();
  invalidateCalendarIntelligence(doc.restaurantId?.toString());
  return doc;
}

export interface ListOptions extends EventQueryInput {
  /**
   * Tenant filter: when set, only global events + that restaurant's own
   * events are returned. The platform admin dashboard may omit it to see all.
   */
  tenantRestaurantId?: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listEvents(options: ListOptions = {}): Promise<ICalendarEvent[]> {
  const filter: Record<string, unknown> = {};

  if (options.status) {
    filter.status = options.status;
  } else {
    // Default listing excludes AI drafts (Phase 2) — they surface via the
    // assistant review flow / explicit status=draft request only.
    filter.status = { $ne: 'draft' };
  }
  if (options.type) filter.type = options.type;
  if (options.scope) filter.scope = options.scope;
  if (options.restaurantId) filter.restaurantId = new mongoose.Types.ObjectId(options.restaurantId);

  // Overlap: event intersects [startDate, endDate].
  if (options.startDate || options.endDate) {
    filter.startDate = options.endDate ? { ...(filter.startDate as object ?? {}), $lte: new Date(options.endDate) } : filter.startDate;
    filter.endDate = options.startDate ? { ...(filter.endDate as object ?? {}), $gte: new Date(options.startDate) } : filter.endDate;
  }

  // Upcoming window: starts within N days from now (used by Upcoming Events).
  if (options.withinDays) {
    const now = new Date();
    const horizon = new Date(now.getTime() + options.withinDays * 86_400_000);
    filter.startDate = { ...(filter.startDate as object ?? {}), $gte: now, $lte: horizon };
  }

  // Tenancy: global events (restaurantId null) + the given restaurant's own.
  if (options.tenantRestaurantId) {
    filter.$or = [
      { restaurantId: null },
      { restaurantId: new mongoose.Types.ObjectId(options.tenantRestaurantId) },
    ];
  }

  if (options.search) {
    const rx = new RegExp(escapeRegex(options.search), 'i');
    filter.$and = [{ $or: [{ name: rx }, { description: rx }, { tags: rx }] }];
  }

  const query = CalendarEvent.find(filter).sort({ startDate: 1, name: 1 });
  if (options.limit) query.limit(options.limit);
  return query.exec();
}

export const calendarService = {
  createEvent,
  updateEvent,
  getEvent,
  archiveEvent,
  restoreEvent,
  approveEvent,
  listEvents,
  CalendarValidationError,
  CalendarNotFoundError,
};
