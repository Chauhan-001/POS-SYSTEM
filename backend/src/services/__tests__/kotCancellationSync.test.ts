/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KOT Cancellation Sync tests — the Kitchen Display System chain:
 *   - KOT records sent via PUT /orders/:id persist server-side (upsert by
 *     orderId + kotNumber, items mapped from the POS CartItem shape).
 *   - orderService.list() embeds serialized kotRecords so the KDS poll sees
 *     KOTs from every terminal.
 *   - An order adjustment marks the matching KOT lines cancelled (productId
 *     match), which the KDS renders as a strikethrough immediately.
 *   - Non-matching KOT lines stay untouched.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { orderService, orderAdjustmentService } from '../index';
import Order from '../../models/Order';
import OrderItem from '../../models/OrderItem';
import OrderAdjustment from '../../models/OrderAdjustment';
import KOTRecord from '../../models/KOTRecord';
import AuditLog from '../../models/AuditLog';
import Product from '../../models/Product';
import BranchSettings from '../../models/BranchSettings';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();

const ctx = { restaurantId: REST.toString(), branchId: BRANCH.toString(), operator: 'Test Cashier', operatorId: 'u_1' };

async function seedOrder(total = 500) {
  const order = await Order.create({
    orderNumber: 2058,
    type: 'Website',
    platform: 'Website',
    status: 'New',
    restaurantId: REST,
    branchId: BRANCH,
    subtotal: total,
    discount: 0,
    gst: 0,
    grandTotal: total,
    originalGrandTotal: total,
    adjustedGrandTotal: total,
    amountRefunded: 0,
    amountDueAdditional: 0,
    adjustmentStatus: 'NONE',
  });
  const lines = [
    { orderId: order._id, productId: 'p_burger', productName: 'Burger', quantity: 1, price: 300 },
    { orderId: order._id, productId: 'p_fries', productName: 'Fries', quantity: 1, price: 150 },
    { orderId: order._id, productId: 'p_coke', productName: 'Coke', quantity: 1, price: 50 },
  ];
  const created = await OrderItem.insertMany(lines);
  return { order, items: created };
}

/** Seed a KOT for the order with the same product references the POS sends. */
function seedKotPayload(orderId: string) {
  return [{
    kotNumber: 1,
    type: 'Original' as const,
    status: 'Accepted' as const,
    printedAt: new Date().toISOString(),
    printedBy: 'Test Cashier',
    items: [
      { id: 'line_burger_1', product: { _id: 'p_burger', id: 'p_burger', name: 'Burger' }, quantity: 1, price: 300 },
      { id: 'line_fries_1', product: { _id: 'p_fries', id: 'p_fries', name: 'Fries' }, quantity: 1, price: 150 },
    ],
  }];
}

describe('KOT cancellation sync — persistence, list embedding, adjustment', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Order.deleteMany({}).exec(),
      OrderItem.deleteMany({}).exec(),
      OrderAdjustment.deleteMany({}).exec(),
      KOTRecord.deleteMany({}).exec(),
      AuditLog.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      BranchSettings.deleteMany({}).exec(),
    ]);
    vi.restoreAllMocks();
  });

  it('PUT /orders/:id persists KOT records server-side (upsert by orderId+kotNumber)', async () => {
    const { order } = await seedOrder();

    const result = await orderService.update(String(order._id), {
      kotRecords: seedKotPayload(String(order._id)),
    } as any);

    // Stored in the kotrecords collection (the KDS source of truth).
    const stored = await KOTRecord.findOne({ orderId: order._id, kotNumber: 1 }).lean();
    expect(stored).not.toBeNull();
    expect(stored?.type).toBe('Original');
    expect(stored?.status).toBe('Accepted');
    // Items mapped from the POS CartItem shape: productId + stable line id +
    // price are preserved so same-product lines never collide on id.
    const items = (stored as any)?.items || [];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ productId: 'p_burger', lineId: 'line_burger_1', itemName: 'Burger', price: 300 });
    expect(items[1]).toMatchObject({ productId: 'p_fries', lineId: 'line_fries_1', itemName: 'Fries', price: 150 });

    // The updated order response carries serialized kotRecords (frontend shape).
    expect((result as any)?.kotRecords).toHaveLength(1);
    const kot = (result as any)?.kotRecords[0];
    expect(kot.kotNumber).toBe(1);
    expect(kot.items[0].id).toBe('line_burger_1'); // stable line id survives round-trip
    expect(kot.items[0].product?.name).toBe('Burger');
  });

  it('re-updating the same kotNumber upserts instead of duplicating rows', async () => {
    const { order } = await seedOrder();
    const payload = seedKotPayload(String(order._id));

    await orderService.update(String(order._id), { kotRecords: payload } as any);
    // Second KOT send (same order, kotNumber 2) + a reprint of KOT 1.
    await orderService.update(String(order._id), {
      kotRecords: [
        payload[0],
        {
          ...payload[0],
          kotNumber: 2,
          type: 'Additional',
          printedAt: new Date().toISOString(),
          items: [{ id: 'line_coke_1', product: { _id: 'p_coke', id: 'p_coke', name: 'Coke' }, quantity: 1, price: 50 }],
        },
      ],
    } as any);

    const rows = await KOTRecord.find({ orderId: order._id }).sort({ kotNumber: 1 }).lean();
    expect(rows).toHaveLength(2); // one per kotNumber, never duplicated
    expect(rows.map((r) => r.kotNumber)).toEqual([1, 2]);
  });

  it('orderService.list() embeds kotRecords for the KDS poll', async () => {
    const { order } = await seedOrder();
    await orderService.update(String(order._id), {
      kotRecords: seedKotPayload(String(order._id)),
    } as any);

    const result = await orderService.list({});
    const found = (result.data as any[]).find((o) => String(o._id) === String(order._id));
    expect(found).toBeDefined();
    expect(found.kotRecords).toHaveLength(1);
    // Serialized to the frontend KOTRecord shape the KitchenDisplay renders.
    const kot = found.kotRecords[0];
    expect(kot).toMatchObject({ kotNumber: 1, type: 'Original', status: 'Accepted' });
    expect(kot.items).toHaveLength(2);
    expect(kot.items[0]).toMatchObject({ id: 'line_burger_1', quantity: 1, price: 300 });
    expect(kot.items[0].product).toMatchObject({ id: 'p_burger', name: 'Burger' });
    expect(kot.printedBy).toBe('Test Cashier');
  });

  it('an adjustment marks the matching KOT lines cancelled (KDS strikethrough)', async () => {
    const { order, items } = await seedOrder();
    // KOT was printed BEFORE the item ran out — the exact KDS scenario.
    await orderService.update(String(order._id), {
      kotRecords: seedKotPayload(String(order._id)),
    } as any);
    const fries = items.find((i: any) => i.productId === 'p_fries')!;

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_kot_sync_001',
      action: 'REMOVE',
      items: [{ orderItemId: String(fries._id), quantity: 1 }],
      reason: 'Fries unavailable',
    }, ctx);

    // Financial side still correct.
    expect(result.adjustment.refundRequired).toBe(150);
    expect(result.adjustment.newTotal).toBe(350);

    // The stored KOT line for the removed product is cancelled server-side.
    const stored = await KOTRecord.findOne({ orderId: order._id, kotNumber: 1 }).lean();
    const storedItems = (stored as any)?.items || [];
    const burgerLine = storedItems.find((i: any) => i.productId === 'p_burger');
    const friesLine = storedItems.find((i: any) => i.productId === 'p_fries');
    expect(friesLine.cancelled).toBe(true);
    expect(friesLine.cancelReason).toBe('Fries unavailable');
    expect(friesLine.cancelledAt).toBeTruthy();
    // The unaffected line stays active.
    expect(burgerLine.cancelled).toBe(false);
    expect(burgerLine.cancelReason).toBeUndefined();

    // The refreshed order returned to the POS carries the cancelled KOT line,
    // so the terminal can swap it into pos.orders in one shot.
    const kot = (result.order as any)?.kotRecords?.[0];
    expect(kot).toBeDefined();
    const friesKot = kot.items.find((i: any) => i.id === 'line_fries_1');
    const burgerKot = kot.items.find((i: any) => i.id === 'line_burger_1');
    expect(friesKot.cancelled).toBe(true);
    expect(friesKot.cancelReason).toBe('Fries unavailable');
    expect(burgerKot.cancelled).toBe(false);
  });

  it('a partial-quantity removal still cancels the full KOT line (kitchen must not prep any of it)', async () => {
    const { order, items } = await seedOrder(600);
    // Fries ordered ×2 on the KOT; the order line is qty 2 as well.
    await OrderItem.updateOne(
      { orderId: order._id, productId: 'p_fries' },
      { $set: { quantity: 2 } }
    );
    await orderService.update(String(order._id), {
      kotRecords: [{
        kotNumber: 1,
        type: 'Original' as const,
        status: 'Accepted' as const,
        printedAt: new Date().toISOString(),
        printedBy: 'Test Cashier',
        items: [
          { id: 'line_burger_1', product: { _id: 'p_burger', id: 'p_burger', name: 'Burger' }, quantity: 1, price: 300 },
          { id: 'line_fries_1', product: { _id: 'p_fries', id: 'p_fries', name: 'Fries' }, quantity: 2, price: 300 },
        ],
      }],
    } as any);
    const fries = items.find((i: any) => i.productId === 'p_fries')!;

    // Only ONE of the two Fries is removed from the bill.
    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_kot_partial_001',
      action: 'REMOVE',
      items: [{ orderItemId: String(fries._id), quantity: 1 }],
      reason: 'Fries unavailable',
    }, ctx);

    expect(result.adjustment.refundRequired).toBe(150);
    // The whole KOT line is cancelled — the kitchen must not prepare any Fries.
    const stored = await KOTRecord.findOne({ orderId: order._id, kotNumber: 1 }).lean();
    const storedItems = (stored as any)?.items || [];
    const friesLine = storedItems.find((i: any) => i.productId === 'p_fries');
    expect(friesLine.cancelled).toBe(true);
    expect(friesLine.cancelReason).toBe('Fries unavailable');
  });

  it('CANCEL marks every KOT line cancelled (whole order cannot be fulfilled)', async () => {
    const { order } = await seedOrder();
    await orderService.update(String(order._id), {
      kotRecords: seedKotPayload(String(order._id)),
    } as any);

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_kot_cancel_001',
      action: 'CANCEL',
      reason: 'Cannot fulfil the order',
    }, ctx);

    expect(result.adjustment.action).toBe('CANCEL');
    const stored = await KOTRecord.findOne({ orderId: order._id, kotNumber: 1 }).lean();
    const storedItems = (stored as any)?.items || [];
    expect(storedItems.every((i: any) => i.cancelled === true)).toBe(true);
    expect(storedItems[0].cancelReason).toBe('Cannot fulfil the order');
  });

  it('adjustments on orders without KOT records are a clean no-op (no crash)', async () => {
    const { order, items } = await seedOrder();
    const fries = items.find((i: any) => i.productId === 'p_fries')!;

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_no_kot_001',
      action: 'REMOVE',
      items: [{ orderItemId: String(fries._id), quantity: 1 }],
      reason: 'Fries unavailable',
    }, ctx);

    expect(result.adjustment.refundRequired).toBe(150);
    expect(result.adjustment.newTotal).toBe(350);
    expect(await KOTRecord.countDocuments({ orderId: order._id })).toBe(0);
    expect(result.order?.kotRecords).toEqual([]);
  });
});
