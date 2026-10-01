/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CalendarEvent — the ChitKuber Context Calendar (Phase 1).
 *
 * MongoDB is the source of truth for all context events (festivals, national
 * events, seasons, sports, local/restaurant events, custom marketing events).
 * Phase 1 is admin-managed only; later phases append `source: 'gemini'` /
 * `'external'` events through the same service without schema changes.
 *
 * Tenancy model:
 *   - Global events (scope india/state/region/city) have NO restaurantId and
 *     are shared across the platform.
 *   - Restaurant events (scope restaurant) carry restaurantId and are only
 *     ever served back for that restaurant.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

export const CALENDAR_EVENT_TYPES = [
  'festival',
  'national_event',
  'seasonal',
  'sports',
  'local_event',
  'restaurant_event',
  'custom',
] as const;

export const CALENDAR_EVENT_SCOPES = ['india', 'state', 'region', 'city', 'restaurant'] as const;

export const CALENDAR_RELEVANCE = ['low', 'medium', 'high'] as const;

/** 'draft' = AI-assisted / pending admin approval (Phase 2). Drafts are
 *  excluded from default listings and can only become active via approve. */
export const CALENDAR_EVENT_STATUSES = ['draft', 'active', 'archived'] as const;

export const CALENDAR_EVENT_SOURCES = ['admin', 'gemini', 'external'] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];
export type CalendarEventScope = (typeof CALENDAR_EVENT_SCOPES)[number];
export type CalendarRelevance = (typeof CALENDAR_RELEVANCE)[number];
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];
export type CalendarEventSource = (typeof CALENDAR_EVENT_SOURCES)[number];

export interface ICalendarEvent extends Document {
  name: string;
  type: CalendarEventType;
  startDate: Date;
  endDate: Date;
  scope: CalendarEventScope;
  country?: string;
  state?: string;
  region?: string;
  city?: string;
  restaurantId?: mongoose.Types.ObjectId | null;
  description?: string;
  tags: string[];
  marketingRelevance: CalendarRelevance;
  preparationWindowDays: number;
  status: CalendarEventStatus;
  source: CalendarEventSource;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarEventSchema = new Schema<ICalendarEvent>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: CALENDAR_EVENT_TYPES, required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    scope: { type: String, enum: CALENDAR_EVENT_SCOPES, required: true, index: true },
    country: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    region: { type: String, trim: true, maxlength: 80 },
    city: { type: String, trim: true, maxlength: 80 },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    tags: { type: [String], default: [] },
    marketingRelevance: { type: String, enum: CALENDAR_RELEVANCE, default: 'medium' },
    preparationWindowDays: { type: Number, default: 0, min: 0, max: 365 },
    status: { type: String, enum: CALENDAR_EVENT_STATUSES, default: 'active', index: true },
    source: { type: String, enum: CALENDAR_EVENT_SOURCES, default: 'admin' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Range + ordering queries dominate; keep one compound index for the common
// "active events overlapping [from, to]" lookup.
CalendarEventSchema.index({ status: 1, startDate: 1, endDate: 1 });

// Text search over name + description (name prefix; exact-phrase search lives
// in the service with a regex fallback so no atlas dependency).
CalendarEventSchema.index({ name: 'text', description: 'text' });

const CalendarEvent: Model<ICalendarEvent> =
  mongoose.models.CalendarEvent ||
  mongoose.model<ICalendarEvent>('CalendarEvent', CalendarEventSchema);

export default CalendarEvent;
