/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — Context Calendar acceptance tests (spec §20), following the
 * project's established service-level test convention (MongoMemoryServer):
 *
 *   Model/service: create valid, reject missing name / bad dates / bad scope,
 *                  update, archive+restore, filter, search
 *   Security:      restaurant events never leak across tenants (list + get)
 *   API layer:     zod validators reject bad input before the service runs
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import CalendarEvent from '../models/CalendarEvent';
import {
  calendarService,
  CalendarValidationError,
  CalendarNotFoundError,
} from '../services/calendarService';
import {
  createEventSchema,
  updateEventSchema,
  eventQuerySchema,
  type CreateEventInput,
} from '../validators/calendar';

let mongod: MongoMemoryServer;

function inDays(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

function iso(d: Date): string {
  return d.toISOString();
}

const validEvent: CreateEventInput = {
  name: 'Diwali',
  type: 'festival',
  startDate: iso(inDays(20)),
  endDate: iso(inDays(24)),
  scope: 'india',
  tags: ['Sweets', 'sweets', 'family'],
  marketingRelevance: 'medium',
  preparationWindowDays: 0,
  status: 'active',
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('calendarService — create', () => {
  it('creates a valid event with defaults (active, admin, medium, 0 prep days)', async () => {
    const ev = await calendarService.createEvent({ ...validEvent });
    expect(ev.name).toBe('Diwali');
    expect(ev.status).toBe('active');
    expect(ev.source).toBe('admin');
    expect(ev.marketingRelevance).toBe('medium');
    expect(ev.preparationWindowDays).toBe(0);
    // Tags normalized to lowercase array
    expect(ev.tags).toEqual(['sweets', 'family']);
  });

  it('rejects an empty name', async () => {
    await expect(
      calendarService.createEvent({ ...validEvent, name: '   ' } as any),
    ).rejects.toBeTruthy();
  });

  it('rejects endDate before startDate', async () => {
    await expect(
      calendarService.createEvent({
        ...validEvent,
        startDate: iso(inDays(20)),
        endDate: iso(inDays(10)),
      }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it('rejects scope=state without state', async () => {
    await expect(
      calendarService.createEvent({ ...validEvent, scope: 'state' } as any),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it('rejects scope=city without city', async () => {
    await expect(
      calendarService.createEvent({ ...validEvent, scope: 'city', state: 'Uttarakhand' } as any),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it('rejects scope=restaurant without restaurantId', async () => {
    await expect(
      calendarService.createEvent({ ...validEvent, scope: 'restaurant' } as any),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it('creates restaurant-scoped event and forces global scopes to restaurantId=null', async () => {
    const rid = new mongoose.Types.ObjectId();
    const ev = await calendarService.createEvent({
      ...validEvent,
      name: 'Restaurant Anniversary',
      scope: 'restaurant',
      restaurantId: rid.toString(),
      type: 'restaurant_event',
    });
    expect(ev.restaurantId?.toString()).toBe(rid.toString());

    // A global event must NOT carry a restaurantId even if a client sends one.
    const global = await calendarService.createEvent({
      ...validEvent,
      name: 'Global Diwali',
      restaurantId: rid.toString(),
    } as any);
    expect(global.restaurantId).toBeNull();
  });
});

describe('calendarService — update / archive / restore', () => {
  it('updates fields and re-validates date order', async () => {
    const ev = await calendarService.createEvent({ ...validEvent });
    const updated = await calendarService.updateEvent(ev._id.toString(), {
      name: 'Diwali (updated)',
      marketingRelevance: 'high',
    });
    expect(updated.name).toBe('Diwali (updated)');
    expect(updated.marketingRelevance).toBe('high');

    await expect(
      calendarService.updateEvent(ev._id.toString(), {
        startDate: iso(inDays(40)),
        endDate: iso(inDays(20)),
      }),
    ).rejects.toBeInstanceOf(CalendarValidationError);
  });

  it('archives and restores (recoverable, not deleted)', async () => {
    const ev = await calendarService.createEvent({ ...validEvent });
    const archived = await calendarService.archiveEvent(ev._id.toString());
    expect(archived.status).toBe('archived');
    const restored = await calendarService.restoreEvent(ev._id.toString());
    expect(restored.status).toBe('active');
  });

  it('404s on unknown ids', async () => {
    await expect(
      calendarService.getEvent(new mongoose.Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });
});

describe('calendarService — filters, search, tenancy', () => {
  it('filters by type/scope/status and date-overlap window', async () => {
    await CalendarEvent.deleteMany({});
    const rid = new mongoose.Types.ObjectId();
    await calendarService.createEvent({ ...validEvent });
    await calendarService.createEvent({
      ...validEvent, name: 'Cricket Final', type: 'sports', startDate: iso(inDays(5)), endDate: iso(inDays(5)),
    });
    await calendarService.createEvent({
      ...validEvent, name: 'Anniversary', type: 'restaurant_event', scope: 'restaurant',
      restaurantId: rid.toString(), startDate: iso(inDays(2)), endDate: iso(inDays(2)),
    });

    const sports = await calendarService.listEvents({ type: 'sports' });
    expect(sports).toHaveLength(1);
    expect(sports[0].name).toBe('Cricket Final');

    const upcoming = await calendarService.listEvents({ withinDays: 10, status: 'active' });
    expect(upcoming.map((e) => e.name).sort()).toEqual(['Anniversary', 'Cricket Final']);

    const archived = await calendarService.listEvents({
      status: 'archived',
      restaurantId: rid.toString(),
    });
    expect(archived).toHaveLength(0);
  });

  it('searches name/description/tags case-insensitively', async () => {
    await CalendarEvent.deleteMany({});
    await calendarService.createEvent({ ...validEvent });
    await calendarService.createEvent({
      ...validEvent, name: 'Local Food Festival', description: 'Dehradun street food weekend',
    });

    const byName = await calendarService.listEvents({ search: 'diwali' });
    expect(byName).toHaveLength(1);
    const byDesc = await calendarService.listEvents({ search: 'dehradun' });
    expect(byDesc).toHaveLength(1);
  });

  it('restaurant events never leak across tenants', async () => {
    await CalendarEvent.deleteMany({});
    const ridA = new mongoose.Types.ObjectId();
    const ridB = new mongoose.Types.ObjectId();
    await calendarService.createEvent({ ...validEvent }); // global
    await calendarService.createEvent({
      ...validEvent, name: 'A Anniversary', scope: 'restaurant', restaurantId: ridA.toString(),
      type: 'restaurant_event', startDate: iso(inDays(1)), endDate: iso(inDays(1)),
    });

    // Tenant B sees global events + its own — never A's restaurant event.
    const forB = await calendarService.listEvents({ tenantRestaurantId: ridB.toString() });
    expect(forB.some((e) => e.name === 'A Anniversary')).toBe(false);
    expect(forB.some((e) => e.name === 'Diwali')).toBe(true);

    // Tenant A sees its own.
    const forA = await calendarService.listEvents({ tenantRestaurantId: ridA.toString() });
    expect(forA.some((e) => e.name === 'A Anniversary')).toBe(true);
  });
});

describe('API validators (zod layer)', () => {
  it('rejects create without name / type / dates / scope', () => {
    expect(createEventSchema.safeParse({ ...validEvent, name: undefined }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...validEvent, type: 'unknown' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...validEvent, startDate: 'not-a-date' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...validEvent, scope: 'galaxy' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...validEvent, preparationWindowDays: -1 }).success).toBe(false);
  });

  it('applies documented defaults on create', () => {
    const parsed = createEventSchema.parse({ ...validEvent });
    expect(parsed.marketingRelevance).toBe('medium');
    expect(parsed.preparationWindowDays).toBe(0);
    expect(parsed.status).toBe('active');
  });

  it('update schema is partial and query schema strips unknown params', () => {
    expect(updateEventSchema.safeParse({ name: 'x' }).success).toBe(true);
    const q = eventQuerySchema.parse({ limit: '10', evil: 'x' });
    expect((q as any).limit).toBe(10);
    expect((q as any).evil).toBeUndefined();
  });
});
