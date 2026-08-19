/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * helpAnalytics — tenant-scoped help-content usage tracking.
 *
 * Covers the two invariants that matter:
 *  1. Events are always stamped with the JWT restaurantId — a client-supplied
 *     restaurantId is ignored, so a client can never record events into (or
 *     read events from) another tenant.
 *  2. GET /stats aggregates per-content view counts + recent searches so the
 *     owner can see which help content is actually read.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Request, Response } from 'express';

import { recordHelpEvent, getHelpStats } from '../controllers/helpAnalyticsController';
import HelpView from '../models/HelpView';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId();
const REST_B = new mongoose.Types.ObjectId();

function makeReq(userRestaurantId: string, body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    body,
    user: { restaurantId: userRestaurantId, role: 'cashier', name: 'Cashier A' },
    ...overrides,
  } as unknown as Request;
}
function makeRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('help-analytics (tenant-scoped usage tracking)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await HelpView.deleteMany({});
  });

  it('records a FAQ view scoped to the JWT tenant, ignoring any client-supplied restaurantId', async () => {
    const res = makeRes();
    await recordHelpEvent(
      makeReq(REST_A.toString(), {
        eventType: 'view',
        contentType: 'faq',
        contentKey: 'ordering:0',
        contentTitle: 'How do I take an order for a table?',
        // Malicious/spoiled payload — must be ignored.
        restaurantId: REST_B.toString(),
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const row = await HelpView.findOne({});
    expect(row).not.toBeNull();
    expect(String(row!.restaurantId)).toBe(REST_A.toString());
    expect(row!.eventType).toBe('view');
    expect(row!.contentKey).toBe('ordering:0');
  });

  it('records a search event with its result count', async () => {
    const res = makeRes();
    await recordHelpEvent(
      makeReq(REST_A.toString(), {
        eventType: 'search',
        contentType: 'faq',
        contentKey: 'search:kot',
        contentTitle: 'Search: kot',
        query: 'kot',
        resultCount: 3,
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const row = await HelpView.findOne({});
    expect(row!.eventType).toBe('search');
    expect(row!.query).toBe('kot');
    expect(row!.resultCount).toBe(3);
  });

  it('rejects events with an invalid type / missing contentKey', async () => {
    const res = makeRes();
    await recordHelpEvent(makeReq(REST_A.toString(), { eventType: 'click', contentType: 'faq', contentKey: 'x' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    await recordHelpEvent(makeReq(REST_A.toString(), { eventType: 'view', contentType: 'faq' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(await HelpView.countDocuments({})).toBe(0);
  });

  it('aggregates per-content view counts and recent searches, tenant-isolated', async () => {
    // Tenant A: two opens of the same question + one search.
    for (let i = 0; i < 2; i++) {
      await recordHelpEvent(
        makeReq(REST_A.toString(), {
          eventType: 'view',
          contentType: 'faq',
          contentKey: 'ordering:0',
          contentTitle: 'How do I take an order for a table?',
        }),
        makeRes(),
      );
    }
    await recordHelpEvent(
      makeReq(REST_A.toString(), { eventType: 'search', contentType: 'faq', contentKey: 'search:gst', contentTitle: 'Search: gst', query: 'gst', resultCount: 0 }),
      makeRes(),
    );
    // Tenant B: one view of the same question — must NOT leak into A's stats.
    await recordHelpEvent(
      makeReq(REST_B.toString(), {
        eventType: 'view',
        contentType: 'faq',
        contentKey: 'ordering:0',
        contentTitle: 'How do I take an order for a table?',
      }),
      makeRes(),
    );

    const res = makeRes();
    await getHelpStats(makeReq(REST_A.toString(), {}), res);
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0] as any;

    expect(payload.totalViews).toBe(2);
    expect(payload.totalSearches).toBe(1);
    expect(payload.views).toHaveLength(1);
    expect(payload.views[0]).toMatchObject({ contentKey: 'ordering:0', count: 2, contentType: 'faq' });
    expect(payload.searches).toHaveLength(1);
    expect(payload.searches[0]).toMatchObject({ query: 'gst', resultCount: 0 });
  });
});
