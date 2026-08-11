/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderAdjustmentService tests — the unavailable-item fallback workflow:
 *   - REMOVE derives the refund from line snapshots (never client prices).
 *   - REPLACE cheaper → refund difference; REPLACE costlier → additionalDue.
 *   - CANCEL refunds the full paid amount and closes the order.
 *   - Idempotency: replaying the same adjustmentId applies nothing twice.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { orderAdjustmentService, billService, availabilityService } from '../index';
import Order from '../../models/Order';
import OrderItem from '../../models/OrderItem';
import OrderAdjustment from '../../models/OrderAdjustment';
import Product from '../../models/Product';
import AuditLog from '../../models/AuditLog';
import BranchSettings from '../../models/BranchSettings';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();

const ctx = { restaurantId: REST.toString(), branchId: BRANCH.toString(), operator: 'Test Cashier', operatorId: 'u_1' };

async function seedOrder(total = 500) {
  const order = await Order.create({
    orderNumber: 1058,
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

describe('OrderAdjustmentService — remove/replace/cancel + idempotency', () => {
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
      AuditLog.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      BranchSettings.deleteMany({}).exec(),
    ]);
    vi.restoreAllMocks();
    // Never hit a real bill/refund path in these unit tests.
    vi.spyOn(billService, 'refundBill').mockResolvedValue({ isRefunded: true } as any);
  });

  it('REMOVE derives the refund from the line snapshot and keeps the original total', async () => {
    const { order, items } = await seedOrder();
    const fries = items.find((i: any) => i.productId === 'p_fries')!;

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_remove_fries_001',
      action: 'REMOVE',
      items: [{ orderItemId: String(fries._id), quantity: 1 }],
      reason: 'Fries unavailable',
    }, ctx);

    expect(result.adjustment.delta).toBe(-150);
    expect(result.adjustment.refundRequired).toBe(150);
    expect(result.adjustment.newTotal).toBe(350);
    expect(result.adjustment.originalTotal).toBe(500);
    // Order financial snapshot preserved + updated.
    const refreshed = await Order.findById(order._id);
    expect(refreshed?.grandTotal).toBe(500); // original NEVER overwritten
    expect(refreshed?.adjustedGrandTotal).toBe(350);
    expect(refreshed?.amountRefunded).toBe(150);
    expect(refreshed?.adjustmentStatus).toBe('ADJUSTED');
    // The removed line is soft-deleted.
    const deletedFries = await OrderItem.findById(fries._id);
    expect(deletedFries?.isDeleted).toBe(true);
  });

  it('replaying the same adjustmentId applies nothing twice (no double refund)', async () => {
    const { order, items } = await seedOrder();
    const fries = items.find((i: any) => i.productId === 'p_fries')!;
    const payload = {
      adjustmentId: 'adj_dup_001',
      action: 'REMOVE' as const,
      items: [{ orderItemId: String(fries._id), quantity: 1 }],
      reason: 'Fries unavailable',
    };

    await orderAdjustmentService.adjust(String(order._id), payload, ctx);
    const replay = await orderAdjustmentService.adjust(String(order._id), payload, ctx);

    expect(replay.idempotent).toBe(true);
    expect(await OrderAdjustment.countDocuments({ adjustmentId: 'adj_dup_001' })).toBe(1);
    const refreshed = await Order.findById(order._id);
    expect(refreshed?.amountRefunded).toBe(150); // not 300
    expect(await OrderItem.countDocuments({ orderId: order._id, isDeleted: true })).toBe(1);
  });

  it('REPLACE cheaper derives a refund for the difference', async () => {
    const { order, items } = await seedOrder();
    const fries = items.find((i: any) => i.productId === 'p_fries')!;
    const salad = await Product.create({ name: 'Salad', code: 'SALAD', price: 100, category: 'Starters', gstPercent: 5 });

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_replace_cheaper_001',
      action: 'REPLACE',
      items: [{ orderItemId: String(fries._id), quantity: 1, replaceWithProductId: String(salad._id) }],
      reason: 'Fries unavailable — replaced with Salad',
    }, ctx);

    expect(result.adjustment.delta).toBe(-50);
    expect(result.adjustment.refundRequired).toBe(50);
    expect(result.adjustment.additionalDue).toBe(0);
    expect(result.adjustment.newTotal).toBe(450);
    // Replacement line was added.
    const after = await OrderItem.find({ orderId: order._id, isDeleted: { $ne: true } });
    expect(after.some((i: any) => i.productName === 'Salad')).toBe(true);
  });

  it('REPLACE costlier computes additionalDue that must be explicitly authorized', async () => {
    const { order, items } = await seedOrder();
    const fries = items.find((i: any) => i.productId === 'p_fries')!;
    const loaded = await Product.create({ name: 'Loaded Fries', code: 'LFRIES', price: 180, category: 'Starters', gstPercent: 5 });

    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_replace_costlier_001',
      action: 'REPLACE',
      items: [{ orderItemId: String(fries._id), quantity: 1, replaceWithProductId: String(loaded._id) }],
      reason: 'Fries unavailable — replaced with Loaded Fries',
    }, ctx);

    expect(result.adjustment.delta).toBe(30);
    expect(result.adjustment.additionalDue).toBe(30);
    expect(result.adjustment.refundRequired).toBe(0);
    expect(result.adjustment.newTotal).toBe(530);
    const refreshed = await Order.findById(order._id);
    expect(refreshed?.amountDueAdditional).toBe(30);
  });

  it('CANCEL refunds the full amount and closes the order', async () => {
    const { order } = await seedOrder();
    const result = await orderAdjustmentService.adjust(String(order._id), {
      adjustmentId: 'adj_cancel_001',
      action: 'CANCEL',
      reason: 'Cannot fulfil the order',
    }, ctx);

    expect(result.adjustment.action).toBe('CANCEL');
    expect(result.adjustment.refundRequired).toBe(500);
    expect(result.adjustment.newTotal).toBe(0);
    const refreshed = await Order.findById(order._id);
    expect(refreshed?.status).toBe('Cancelled');
    expect(refreshed?.adjustmentStatus).toBe('CANCELLED');
    expect(refreshed?.amountRefunded).toBe(500);
  });

  it('rejects adjustments on closed orders', async () => {
    const { order } = await seedOrder();
    await Order.updateOne({ _id: order._id }, { $set: { status: 'Closed' } });
    await expect(
      orderAdjustmentService.adjust(String(order._id), {
        adjustmentId: 'adj_on_closed_001',
        action: 'CANCEL',
        reason: 'should fail',
      }, ctx)
    ).rejects.toThrow('already Closed');
  });

  it('auto-mark sold-out: branch setting forces markUnavailable on REMOVE', async () => {
    const { order } = await seedOrder();
    await BranchSettings.create({
      branchId: BRANCH,
      restaurantId: REST,
      moduleSettings: { autoMarkSoldOutFromOrder: true },
    });
    const result = await orderAdjustmentService.adjust(
      String(order._id),
      {
        adjustmentId: 'adj_auto_mark_001',
        action: 'REMOVE',
        items: [{ productId: 'p_fries', quantity: 1 }],
        reason: 'Fries ran out',
        // NOTE: markUnavailable intentionally NOT passed — the setting must force it.
      },
      ctx
    );
    expect(result.adjustment.markUnavailable).toBe(true);
    expect(result.adjustment.refundRequired).toBe(150);
    expect(result.adjustment.newTotal).toBe(350);
  });

  it('auto-mark stays OFF when the branch setting is absent or disabled', async () => {
    const { order } = await seedOrder();
    const result = await orderAdjustmentService.adjust(
      String(order._id),
      {
        adjustmentId: 'adj_no_auto_mark_001',
        action: 'REMOVE',
        items: [{ productId: 'p_coke', quantity: 1 }],
        reason: 'Test',
      },
      ctx
    );
    expect(result.adjustment.markUnavailable).toBe(false);
    expect(result.adjustment.refundRequired).toBe(50);
    expect(result.adjustment.newTotal).toBe(450);
  });
});
