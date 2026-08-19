/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SEEN/COMPLETED socket push — silencing or completing a customer request on
 * ONE terminal must broadcast to EVERY POS terminal of the restaurant so the
 * reminder stops (SEEN) or the card moves to Acknowledged (COMPLETED)
 * instantly, not after the next 15s poll.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Request, Response } from 'express';

// Mock the socket layer so emitToRestaurant is a spy (no real Socket.IO server
// needed for a controller unit test).
vi.mock('../../../socket', () => ({
  emitToRestaurant: vi.fn(),
}));
import { emitToRestaurant } from '../../../socket';
const emitMock = vi.mocked(emitToRestaurant);

import { markRequestSeen, completeRequest } from '../controllers/qrOrderingController';
import CustomerRequest from '../models/CustomerRequest';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();

function makeReq(id: string, body: Record<string, unknown> = {}) {
  // AuthenticatedRequest carries the tenant on req.user (see authMiddleware).
  return {
    params: { id },
    body,
    user: { restaurantId: REST.toString(), role: 'cashier' },
  } as unknown as Request;
}
function makeRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

async function seedRequest(status: 'PENDING' | 'SEEN' = 'PENDING') {
  const request = await CustomerRequest.create({
    sessionId: 'unit_emit_test',
    restaurantId: REST,
    branchId: BRANCH,
    orderType: 'TABLE',
    type: 'ONLINE_ORDER',
    priority: 'HIGH',
    status,
    orderId: new mongoose.Types.ObjectId(),
    orderNumber: 3001,
    message: '1× Margherita Pizza',
  });
  return request;
}

describe('customer request socket emits (multi-terminal sync)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await CustomerRequest.deleteMany({});
    emitMock.mockClear();
  });

  it('markRequestSeen emits waiter:call:seen with the request id + branch to the restaurant room', async () => {
    const req = await seedRequest('PENDING');
    const res = makeRes();

    await markRequestSeen(makeReq(req._id.toString(), { seenBy: 'Cashier A' }), res);

    // Controller responds with res.json(success) (no explicit res.status(200)).
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [rid, event, payload] = emitMock.mock.calls[0];
    const p = payload as Record<string, unknown>;
    expect(String(rid)).toBe(REST.toString());
    expect(event).toBe('waiter:call:seen');
    expect(p).toMatchObject({
      id: req._id.toString(),
      status: 'SEEN',
      branchId: BRANCH.toString(),
      type: 'ONLINE_ORDER',
      seenBy: 'Cashier A',
    });
    expect(p.seenAt).toBeDefined();
  });

  it('completeRequest emits waiter:call:completed with the actor + timestamp', async () => {
    const req = await seedRequest('PENDING');
    const res = makeRes();

    await completeRequest(makeReq(req._id.toString(), { completedBy: 'Cashier B' }), res);

    // Controller responds with res.json(success) (no explicit res.status(200)).
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [rid, event, payload] = emitMock.mock.calls[0];
    const p = payload as Record<string, unknown>;
    expect(String(rid)).toBe(REST.toString());
    expect(event).toBe('waiter:call:completed');
    expect(p).toMatchObject({
      id: req._id.toString(),
      status: 'COMPLETED',
      branchId: BRANCH.toString(),
      completedBy: 'Cashier B',
    });
    expect(p.completedAt).toBeDefined();
  });

  it('does NOT emit when the request belongs to another tenant (404 path)', async () => {
    const req = await seedRequest('PENDING');
    const res = makeRes();
    // A different restaurant's id (not in DB for this tenant) → 404, no emit.
    const otherId = new mongoose.Types.ObjectId();

    await markRequestSeen(makeReq(otherId.toString()), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(emitMock).not.toHaveBeenCalled();
    expect(req.status).toBe('PENDING');
  });
});
