/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Online-order notification lifecycle — the Calls panel semantics:
 *
 *   1. A new online order creates a PENDING ONLINE_ORDER CustomerRequest.
 *   2. Acknowledge while the bill is open SILENCES the reminder (status SEEN,
 *      seenAt/seenBy recorded) but the card stays live — it is NOT completed.
 *   3. When the order reaches a terminal status (Paid/Closed/Cancelled/
 *      Refunded) orderService.update auto-completes the request (COMPLETED,
 *      completedAt + operator) — exactly once.
 *   4. Non-terminal updates leave the silenced card untouched.
 *   5. Silencing an already-completed request is a clean 404 (idempotent).
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { orderService } from '../../../services';
import Order from '../../../models/Order';
import CustomerRequest from '../models/CustomerRequest';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();

const ctx = { restaurantId: REST.toString(), branchId: BRANCH.toString(), operator: 'Test Cashier' };

async function seedOnlineOrder(orderNumber = 2090) {
  const order = await Order.create({
    orderNumber,
    type: 'Website',
    platform: 'Website',
    status: 'New',
    restaurantId: REST,
    branchId: BRANCH,
    subtotal: 449,
    discount: 0,
    gst: 0,
    grandTotal: 449,
    originalGrandTotal: 449,
    adjustedGrandTotal: 449,
    amountRefunded: 0,
    amountDueAdditional: 0,
    adjustmentStatus: 'NONE',
  });
  return order;
}

async function seedRequest(orderId: mongoose.Types.ObjectId, orderNumber: number) {
  return CustomerRequest.create({
    sessionId: `online_${orderId.toString()}`,
    restaurantId: REST,
    branchId: BRANCH,
    orderType: 'TABLE',
    type: 'ONLINE_ORDER',
    priority: 'HIGH',
    status: 'PENDING',
    orderId,
    orderNumber,
    message: '1× Margherita Pizza',
  });
}

describe('online-order notification lifecycle (silence → live → auto-complete)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('silencing sets SEEN + seenAt/seenBy and does NOT complete the card', async () => {
    const order = await seedOnlineOrder(2091);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);

    // Direct DB update simulates the POST /requests/:id/seen controller.
    const updated = await CustomerRequest.findByIdAndUpdate(
      req._id,
      {
        $set: {
          status: 'SEEN',
          seenAt: new Date(),
          seenBy: 'Sarah (Cashier)',
        },
      },
      { new: true }
    );

    expect(updated!.status).toBe('SEEN');
    expect(updated!.seenBy).toBe('Sarah (Cashier)');
    expect(updated!.seenAt).toBeInstanceOf(Date);
    expect(updated!.completedAt).toBeUndefined();
    // Still resolvable as a live (non-completed) card.
    const live = await CustomerRequest.countDocuments({ _id: req._id, status: { $in: ['PENDING', 'SEEN'] } });
    expect(live).toBe(1);
  });

  it('a non-terminal order update leaves the silenced card untouched', async () => {
    const order = await seedOnlineOrder(2092);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await CustomerRequest.updateOne({ _id: req._id }, { $set: { status: 'SEEN' } });

    await orderService.update(String(order._id), { status: 'Preparing' }, ctx as any);

    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('SEEN');
    expect(after!.completedAt).toBeUndefined();
  });

  it('closing the bill (Paid) auto-completes the ONLINE_ORDER request once', async () => {
    const order = await seedOnlineOrder(2093);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await CustomerRequest.updateOne({ _id: req._id }, { $set: { status: 'SEEN' } });

    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);

    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('COMPLETED');
    expect(after!.completedAt).toBeInstanceOf(Date);
    expect(after!.completedBy).toBe('Test Cashier');

    // Idempotency: a second terminal update does not error or duplicate.
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);
    const final = await CustomerRequest.findById(req._id);
    expect(final!.status).toBe('COMPLETED');
  });

  it('Cancelled orders also resolve their notification', async () => {
    const order = await seedOnlineOrder(2094);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);

    await orderService.update(String(order._id), { status: 'Cancelled' }, ctx as any);

    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('COMPLETED');
  });

  it('silencing a completed request is a clean no-op (404 semantics)', async () => {
    const order = await seedOnlineOrder(2095);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);

    // The controller only updates rows still in PENDING/SEEN.
    const found = await CustomerRequest.findOneAndUpdate(
      { _id: req._id, restaurantId: REST, status: { $in: ['PENDING', 'SEEN'] } },
      { $set: { status: 'SEEN', seenAt: new Date() } },
      { new: true }
    );
    expect(found).toBeNull();
  });

  it('REOPEN: a Paid order moved back to a live status re-activates its COMPLETED card to PENDING', async () => {
    const order = await seedOnlineOrder(2096);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);
    expect((await CustomerRequest.findById(req._id))!.status).toBe('COMPLETED');

    // Cashier reopens the bill to add items — status goes back to a live state.
    await orderService.update(String(order._id), { status: 'Preparing' }, ctx as any);

    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('PENDING');
    // Completion + silencing state is cleared so the card rings again and
    // acknowledgment is re-gated for the new bill cycle.
    expect(after!.completedAt).toBeUndefined();
    expect(after!.completedBy).toBeUndefined();
    expect(after!.seenAt).toBeUndefined();
    expect(after!.seenBy).toBeUndefined();
    // It is resolvable as a live (non-completed) card again.
    const live = await CustomerRequest.countDocuments({ _id: req._id, status: { $in: ['PENDING', 'SEEN'] } });
    expect(live).toBe(1);
  });

  it('REOPEN: the re-activated card can be silenced again and re-completed on the next close', async () => {
    const order = await seedOnlineOrder(2097);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);

    // Reopen (terminal → live) → card back to PENDING.
    await orderService.update(String(order._id), { status: 'Served' }, ctx as any);
    expect((await CustomerRequest.findById(req._id))!.status).toBe('PENDING');

    // Cashier silences the reminder again → SEEN.
    await CustomerRequest.findByIdAndUpdate(
      req._id,
      { $set: { status: 'SEEN', seenAt: new Date(), seenBy: 'Sarah (Cashier)' } },
      { new: true }
    );
    expect((await CustomerRequest.findById(req._id))!.status).toBe('SEEN');

    // Bill closes again → auto-completed exactly once, with the new actor.
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);
    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('COMPLETED');
    expect(after!.completedAt).toBeInstanceOf(Date);
    expect(after!.completedBy).toBe('Test Cashier');
  });

  it('REFUND: a Paid order refunded stays COMPLETED (terminal → terminal, bill closed either way)', async () => {
    const order = await seedOnlineOrder(2098);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await orderService.update(String(order._id), { status: 'Paid' }, ctx as any);
    expect((await CustomerRequest.findById(req._id))!.status).toBe('COMPLETED');

    // Refund is also terminal — the card must NOT come back to pending.
    await orderService.update(String(order._id), { status: 'Refunded' }, ctx as any);
    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('COMPLETED');
    expect(after!.completedAt).toBeInstanceOf(Date);
    expect(after!.completedBy).toBe('Test Cashier');
  });

  it('REOPEN is idempotent: a live-status update on an already-live order never touches the card', async () => {
    const order = await seedOnlineOrder(2099);
    const req = await seedRequest(order._id as mongoose.Types.ObjectId, order.orderNumber);
    await CustomerRequest.updateOne({ _id: req._id }, { $set: { status: 'SEEN' } });

    // New → Preparing (both live): the silenced card stays untouched.
    await orderService.update(String(order._id), { status: 'Preparing' }, ctx as any);
    const after = await CustomerRequest.findById(req._id);
    expect(after!.status).toBe('SEEN');
    expect(after!.completedAt).toBeUndefined();
  });
});
