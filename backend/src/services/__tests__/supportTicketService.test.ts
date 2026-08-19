/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SupportTicketService Tests (Phase 2.8)
 *
 * Uses mongodb-memory-server (real MongoDB) and exercises the REAL
 * supportTicketService methods end to end.
 *
 * Coverage:
 *   - Create (sequential ticket numbers, restaurant validation, audit)
 *   - Get (404 guard)
 *   - List (search / status / priority filters, sort, pagination)
 *   - Status lifecycle (valid + invalid transitions, close metadata)
 *   - Assign / unassign (assignee resolution, validation)
 *   - Replies (public + internal, timeline + audit)
 *   - Attachments (persist + delete through the media service)
 *   - Soft delete + restore
 *   - Stats + activity
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Restaurant from '../../models/Restaurant';
import User from '../../models/User';
import SupportTicket from '../../models/SupportTicket';
import TicketReply from '../../models/TicketReply';
import TicketCounter from '../../models/TicketCounter';
import AuditLog from '../../models/AuditLog';
import { config } from '../../config';
import * as svc from '../supportTicketService';

let mongod: MongoMemoryServer;
let uploadsDir: string;

const actor = { id: 'admin', name: 'Super Admin', ipAddress: '127.0.0.1' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pos-support-media-'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await fs.rm(uploadsDir, { recursive: true, force: true });
  // The service attachment flow writes through the media singleton (real
  // uploads dir on disk). Remove any residue it created.
  await fs.rm(config.uploads.dir, { recursive: true, force: true });
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Restaurant.deleteMany({}).exec(),
    User.deleteMany({}).exec(),
    SupportTicket.deleteMany({}).exec(),
    TicketReply.deleteMany({}).exec(),
    TicketCounter.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
  ]);
});

async function seedRestaurant(overrides: Record<string, any> = {}) {
  return Restaurant.create({
    restaurantId: 'SUP_001',
    name: 'Support Test Restaurant',
    phone: '9999999999',
    ...overrides,
  });
}

async function seedAdminUser(restaurant: any, overrides: Record<string, any> = {}) {
  return User.create({
    restaurantId: restaurant._id,
    userId: 'agent',
    phone: '+1234567890',
    name: 'Agent One',
    email: 'agent@pos.com',
    password: 'hashed',
    role: 'super_admin',
    status: 'active',
    branchIds: [],
    ...overrides,
  });
}

function ticketInput(restaurantId: string, overrides: Record<string, any> = {}) {
  return {
    restaurantId: restaurantId.toString(),
    category: 'technical',
    priority: 'high',
    subject: 'POS sync failing',
    description: 'Cannot sync bills to cloud.',
    actor,
    ...overrides,
  };
}

describe('create / read', () => {
  it('creates a ticket with a sequential number and an audit entry', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    expect(t.ticketNumber).toBe('TKT-000001');
    expect(t.status).toBe('new');
    expect(t.restaurantName).toBe('Support Test Restaurant');
    expect(t.timeline.some((e: any) => e.action === 'created')).toBe(true);
    expect((await AuditLog.findOne({ action: 'SUPPORT_TICKET_CREATED' }).exec())).toBeTruthy();
  });

  it('allocates sequential numbers without gaps', async () => {
    const restaurant = await seedRestaurant();
    const ids = restaurant._id.toString();
    const a = await svc.createSupportTicket(ticketInput(ids));
    const b = await svc.createSupportTicket(ticketInput(ids));
    const c = await svc.createSupportTicket(ticketInput(ids));
    expect([a.ticketNumber, b.ticketNumber, c.ticketNumber])
      .toEqual(['TKT-000001', 'TKT-000002', 'TKT-000003']);
  });

  it('rejects creation against a missing or deleted restaurant', async () => {
    await expect(
      svc.createSupportTicket(ticketInput(new mongoose.Types.ObjectId().toString()))
    ).rejects.toMatchObject({ statusCode: 404 });

    const restaurant = await seedRestaurant({ isDeleted: true, deletedAt: new Date() });
    await expect(
      svc.createSupportTicket(ticketInput(restaurant._id.toString()))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 404 for a missing ticket on read', async () => {
    await expect(svc.getSupportTicket(new mongoose.Types.ObjectId().toString()))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('list / search / filters', () => {
  it('filters by status and priority', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    await svc.createSupportTicket(ticketInput(id, { category: 'billing', priority: 'urgent', subject: 'Overcharged' }));
    await svc.createSupportTicket(ticketInput(id, { category: 'billing', priority: 'low', subject: 'Minor question' }));
    const high = await svc.createSupportTicket(ticketInput(id, { category: 'technical', priority: 'high', subject: 'Outage' }));
    await svc.setTicketStatus(high._id.toString(), 'closed', 'done', actor);

    const urgent = await svc.listSupportTickets({ status: 'new', priority: 'urgent' });
    expect(urgent.total).toBe(1);

    const closed = await svc.listSupportTickets({ status: 'closed' });
    expect(closed.total).toBe(1);
    expect(closed.data[0].subject).toBe('Outage');
  });

  it('searches across subject/description/number/restaurant', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    await svc.createSupportTicket(ticketInput(id, { subject: 'Printer paper jam', description: 'Star printer not feeding' }));
    await svc.createSupportTicket(ticketInput(id, { subject: 'Logo update', description: 'Need new logo uploaded' }));

    const res = await svc.listSupportTickets({ search: 'printer' });
    expect(res.total).toBe(1);
    expect(res.data[0].subject).toContain('Printer');
  });

  it('paginates results', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    for (let i = 0; i < 5; i++) {
      await svc.createSupportTicket(ticketInput(id, { subject: `Ticket ${i}` }));
    }
    const page1 = await svc.listSupportTickets({ page: 1, limit: 2 });
    const page2 = await svc.listSupportTickets({ page: 2, limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.data.length).toBe(2);
    expect(page2.data.length).toBe(2);
    expect(page1.totalPages).toBe(3);
    expect(page1.data[0]._id.toString()).not.toBe(page2.data[0]._id.toString());
  });

  it('sorts by priority with semantic rank (urgent before low)', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    await svc.createSupportTicket(ticketInput(id, { priority: 'low', subject: 'low' }));
    await svc.createSupportTicket(ticketInput(id, { priority: 'urgent', subject: 'urgent' }));
    await svc.createSupportTicket(ticketInput(id, { priority: 'medium', subject: 'medium' }));

    const res = await svc.listSupportTickets({ sortBy: 'priority', sortOrder: 'desc' });
    expect(res.data.map((d: any) => d.priority)).toEqual(['urgent', 'medium', 'low']);
  });

  it('excludes soft-deleted tickets by default but returns them when requested', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    const t = await svc.createSupportTicket(ticketInput(id, { subject: 'To delete' }));
    await svc.deleteTicket(t._id.toString(), 'stale', actor);

    expect((await svc.listSupportTickets({})).total).toBe(0);
    expect((await svc.listSupportTickets({ deleted: 'true' })).total).toBe(1);
  });
});

describe('status lifecycle', () => {
  it('allows a valid transition and records close metadata', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    await svc.setTicketStatus(t._id.toString(), 'in_progress', undefined, actor);
    const resolved = await svc.setTicketStatus(t._id.toString(), 'resolved', 'fixed config', actor);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionNote).toBe('fixed config');
    expect(resolved.closedByName).toBe('Super Admin');
    expect(resolved.closedAt).toBeTruthy();

    const closed = await svc.setTicketStatus(t._id.toString(), 'closed', undefined, actor);
    expect(closed.status).toBe('closed');

    expect(closed.timeline.filter((e: any) => e.action === 'status_changed').length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an invalid transition', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));
    await svc.setTicketStatus(t._id.toString(), 'cancelled', undefined, actor);
    await expect(
      svc.setTicketStatus(t._id.toString(), 'in_progress', undefined, actor)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a no-op transition', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));
    await expect(
      svc.setTicketStatus(t._id.toString(), 'new', undefined, actor)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('writes an audit entry for status changes', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));
    await svc.setTicketStatus(t._id.toString(), 'resolved', undefined, actor);
    expect((await AuditLog.findOne({ action: 'SUPPORT_TICKET_STATUS_CHANGED', entityId: t._id.toString() }).exec())).toBeTruthy();
  });
});

describe('assignment', () => {
  it('assigns to an admin user and records the assignee name', async () => {
    const restaurant = await seedRestaurant();
    const admin = await seedAdminUser(restaurant, { userId: 'agent_x', name: 'Agent X' });
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    const assigned = await svc.assignTicket(t._id.toString(), admin._id.toString(), actor);
    expect(assigned.assigneeName).toBe('Agent X');
    expect(assigned.timeline.some((e: any) => e.action === 'assigned')).toBe(true);
    expect((await AuditLog.findOne({ action: 'SUPPORT_TICKET_ASSIGNED' }).exec())).toBeTruthy();
  });

  it('unassigns and rejects unknown assignees', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    await expect(
      svc.assignTicket(t._id.toString(), new mongoose.Types.ObjectId().toString(), actor)
    ).rejects.toMatchObject({ statusCode: 400 });

    const unassigned = await svc.assignTicket(t._id.toString(), null, actor);
    expect(unassigned.assigneeName).toBeUndefined();
  });
});

describe('replies', () => {
  it('adds public and internal replies with timeline + audit', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    const pub = await svc.addTicketReply({
      ticketId: t._id.toString(), body: 'We fixed the sync.', authorId: 'admin', authorName: 'Super Admin', isInternal: false,
    });
    const internal = await svc.addTicketReply({
      ticketId: t._id.toString(), body: 'Note for team: escalate.', authorId: 'admin', authorName: 'Super Admin', isInternal: true,
    });

    expect(pub.isInternal).toBe(false);
    expect(internal.isInternal).toBe(true);

    const replies = await svc.getTicketReplies(t._id.toString());
    expect(replies.length).toBe(2);
    expect(replies[0].body).toBe('We fixed the sync.');

    const fresh = await svc.getSupportTicket(t._id.toString());
    expect(fresh.timeline.some((e: any) => e.action === 'replied')).toBe(true);
    expect(fresh.timeline.some((e: any) => e.action === 'internal_note')).toBe(true);
    expect((await AuditLog.findOne({ action: 'SUPPORT_TICKET_REPLIED' }).exec())).toBeTruthy();
  });

  it('returns 404 when adding a reply to a missing ticket', async () => {
    await expect(
      svc.addTicketReply({ ticketId: new mongoose.Types.ObjectId().toString(), body: 'hi', authorName: 'A' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('attachments', () => {
  it('uploads a document attachment onto the ticket and deletes it', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    const pdf = Buffer.from('%PDF-1.7 minimal payload');
    const { key, meta } = await svc.addTicketAttachment({
      ticketId: t._id.toString(),
      buffer: pdf,
      mimetype: 'application/pdf',
      originalName: 'evidence.pdf',
      actor,
    });

    expect(key).toMatch(/\.pdf$/);
    const fresh = await svc.getSupportTicket(t._id.toString());
    expect(fresh.attachments.length).toBe(1);
    expect(fresh.attachments[0].originalName).toBe('evidence.pdf');
    expect(fresh.timeline.some((e: any) => e.action === 'attachment_added')).toBe(true);

    const removed = await svc.deleteTicketAttachment(t._id.toString(), meta.id, actor);
    expect(removed.removed).toBe(key);
    const after = await svc.getSupportTicket(t._id.toString());
    expect(after.attachments.length).toBe(0);
    expect(after.timeline.some((e: any) => e.action === 'attachment_removed')).toBe(true);
  });

  it('rejects a spoofed attachment', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));
    await expect(
      svc.addTicketAttachment({
        ticketId: t._id.toString(),
        buffer: Buffer.from('not a pdf'),
        mimetype: 'application/pdf',
        originalName: 'fake.pdf',
        actor,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    const fresh = await svc.getSupportTicket(t._id.toString());
    expect(fresh.attachments.length).toBe(0);
  });
});

describe('delete / restore / stats / activity', () => {
  it('soft deletes and restores a ticket', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));

    const del = await svc.deleteTicket(t._id.toString(), 'duplicate', actor);
    expect(del.isDeleted).toBe(true);

    await expect(svc.getSupportTicket(t._id.toString())).rejects.toMatchObject({ statusCode: 404 });

    const restored = await svc.restoreTicket(t._id.toString(), actor);
    expect(restored.isDeleted).toBe(false);
    expect((await svc.getSupportTicket(t._id.toString())).ticketNumber).toBe('TKT-000001');
    expect((await AuditLog.findOne({ action: 'SUPPORT_TICKET_RESTORED' }).exec())).toBeTruthy();
  });

  it('computes per-status and per-priority stats', async () => {
    const restaurant = await seedRestaurant();
    const id = restaurant._id.toString();
    const t1 = await svc.createSupportTicket(ticketInput(id, { priority: 'urgent' }));
    await svc.createSupportTicket(ticketInput(id, { priority: 'low' }));
    await svc.setTicketStatus(t1._id.toString(), 'open', undefined, actor);

    const stats = await svc.getTicketStats({});
    expect(stats.total).toBe(2);
    expect(stats.byStatus.new).toBe(1);
    expect(stats.byStatus.open).toBe(1);
    expect(stats.byPriority.urgent).toBe(1);
    expect(stats.byPriority.low).toBe(1);
  });

  it('exposes audit activity for a ticket', async () => {
    const restaurant = await seedRestaurant();
    const t = await svc.createSupportTicket(ticketInput(restaurant._id.toString()));
    await svc.setTicketStatus(t._id.toString(), 'resolved', undefined, actor);

    const activity = await svc.getTicketActivity(t._id.toString());
    const actions = activity.map((a: any) => a.action);
    expect(actions).toContain('SUPPORT_TICKET_CREATED');
    expect(actions).toContain('SUPPORT_TICKET_STATUS_CHANGED');
  });
});