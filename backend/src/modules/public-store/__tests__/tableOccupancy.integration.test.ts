import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Restaurant from '../../../models/Restaurant';
import Table from '../../../models/Table';
import Order from '../../../models/Order';
import Product from '../../../models/Product';
import QROrderingSession from '../../qr-ordering/models/QROrderingSession';
import { publicStoreOrderService } from '../services/publicStoreOrderService';
import { generatePublicToken } from '../../../utils/publicToken';
import { orderService } from '../../../services';
import { AppError } from '../../../utils/AppError';

let mongod: MongoMemoryServer;

/**
 * ONE live order per table — the occupancy guard shared by the QR scan
 * claim, the QR order submission, and the POS order creation. A table may
 * only ever be occupied by a single order, regardless of which side (cashier
 * first-KOT or customer QR scan) got there first.
 */
describe('Table occupancy (one live order per table)', () => {
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
      Restaurant.deleteMany({}).exec(),
      Table.deleteMany({}).exec(),
      Order.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      QROrderingSession.deleteMany({}).exec(),
    ]);
  });

  async function seed() {
    const restaurant = await Restaurant.create({
      restaurantId: `OCC${Date.now()}`,
      name: 'Occ Test Kitchen',
      phone: '9999999999',
      area: 'Test',
      city: 'Test',
      currency: 'INR',
      isActive: true,
      publicToken: generatePublicToken(),
    });
    const table = await Table.create({
      restaurantId: restaurant._id,
      number: 7,
      capacity: 4,
      status: 'Available',
      isDeleted: false,
    });
    const product = await Product.create({
      restaurantId: restaurant._id,
      name: 'Plain Dosa',
      code: `DOSA${Date.now()}`,
      category: 'South Indian',
      price: 99,
      availability: true,
      isDeleted: false,
    });
    return { restaurant, table, product, token: String(restaurant.publicToken) };
  }

  it('rejects a QR scan claim on a table with a live order (TABLE_ALREADY_OCCUPIED)', async () => {
    const { restaurant, table, product } = await seed();
    // The cashier's first-KOT order occupies the table first.
    await orderService.create(
      {
        orderNumber: 5001,
        type: 'Dine In',
        status: 'New',
        tableId: String(table._id),
        tableNumber: table.number,
        items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
      },
      { restaurantId: String(restaurant._id), operator: 'Cashier' }
    );

    await expect(
      publicStoreOrderService.claimForCustomer(String(restaurant.publicToken), 'session-scan-1', String(table._id), table.number)
    ).rejects.toMatchObject({ statusCode: 409, code: 'TABLE_ALREADY_OCCUPIED' });
  });

  it('rejects a direct QR order on an occupied table even WITHOUT a seat session (the bypass hole)', async () => {
    const { restaurant, table, product } = await seed();
    await orderService.create(
      {
        orderNumber: 5002,
        type: 'Dine In',
        status: 'New',
        tableId: String(table._id),
        tableNumber: table.number,
        items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
      },
      { restaurantId: String(restaurant._id), operator: 'Cashier' }
    );

    // No seatSessionId, no clientRef — previously skipped the occupancy check
    // and created a second live order on the same table.
    await expect(
      publicStoreOrderService.createOrder(String(restaurant.publicToken), {
        mode: 'TABLE',
        tableId: String(table._id),
        tableNumber: table.number,
        items: [{ productId: String(product._id), quantity: 1 }],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'TABLE_ALREADY_OCCUPIED' });

    // Exactly one live order remains on the table.
    const live = await Order.countDocuments({
      tableId: String(table._id),
      status: { $nin: ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'] },
    });
    expect(live).toBe(1);
  });

  it('rejects a POS Dine-In order on a table already occupied by a QR order (reverse race)', async () => {
    const { restaurant, table, product } = await seed();
    // Customer scans + orders first (QR order owns the table).
    await publicStoreOrderService.createOrder(String(restaurant.publicToken), {
      mode: 'TABLE',
      tableId: String(table._id),
      tableNumber: table.number,
      items: [{ productId: String(product._id), quantity: 1 }],
      seatSessionId: 'session-qr-1',
      clientRef: 'occ-test-client-1',
    });

    // Now the cashier's first-KOT order must be refused.
    let caught: any = null;
    try {
      await orderService.create(
        {
          orderNumber: 5003,
          type: 'Dine In',
          status: 'New',
          tableId: String(table._id),
          tableNumber: table.number,
          items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
        },
        { restaurantId: String(restaurant._id), operator: 'Cashier' }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught?.statusCode).toBe(409);
    expect(caught?.code).toBe('TABLE_ALREADY_OCCUPIED');

    const live = await Order.countDocuments({
      tableId: String(table._id),
      status: { $nin: ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'] },
    });
    expect(live).toBe(1);
  });

  it('allows the first order on a free table (no false positive)', async () => {
    const { restaurant, table, product } = await seed();
    const created = await orderService.create(
      {
        orderNumber: 5004,
        type: 'Dine In',
        status: 'New',
        tableId: String(table._id),
        tableNumber: table.number,
        items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
      },
      { restaurantId: String(restaurant._id), operator: 'Cashier' }
    );
    expect(created).toBeTruthy();
    expect(created?.orderNumber).toBe(5004);
  });

  it('allows a QR order on a free table (no false positive)', async () => {
    const { restaurant, table, product } = await seed();
    const result = await publicStoreOrderService.createOrder(String(restaurant.publicToken), {
      mode: 'TABLE',
      tableId: String(table._id),
      tableNumber: table.number,
      items: [{ productId: String(product._id), quantity: 1 }],
      seatSessionId: 'session-free-1',
      clientRef: 'occ-free-client-1',
    });
    expect(result.order).toBeTruthy();
    expect((result.order as any)?.tableId).toBe(String(table._id));
  });

  it('full lifecycle: QR order → bill paid → table freed → new QR claim + POS order both succeed', async () => {
    const { restaurant, table, product } = await seed();

    // ── 1. First seating: customer scans the QR and places an order ──
    const first = await publicStoreOrderService.createOrder(String(restaurant.publicToken), {
      mode: 'TABLE',
      tableId: String(table._id),
      tableNumber: table.number,
      items: [{ productId: String(product._id), quantity: 1 }],
      seatSessionId: 'lifecycle-session-1',
      clientRef: 'lifecycle-client-1',
    });
    expect(first.order).toBeTruthy();
    const firstOrderId = String((first.order as any)?._id || (first.order as any)?.id);

    // The QR order owns the table: the guard refuses a second seating and a
    // second POS order while it is live.
    await expect(
      publicStoreOrderService.claimForCustomer(String(restaurant.publicToken), 'lifecycle-scan-2', String(table._id), table.number)
    ).rejects.toMatchObject({ statusCode: 409, code: 'TABLE_ALREADY_OCCUPIED' });
    let blocked: any = null;
    try {
      await orderService.create(
        {
          orderNumber: 5010,
          type: 'Dine In',
          status: 'New',
          tableId: String(table._id),
          tableNumber: table.number,
          items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
        },
        { restaurantId: String(restaurant._id), operator: 'Cashier' }
      );
    } catch (err) {
      blocked = err;
    }
    expect(blocked?.statusCode).toBe(409);
    expect(blocked?.code).toBe('TABLE_ALREADY_OCCUPIED');

    // ── 2. The bill is paid → the order reaches a terminal status ──
    const paid = await orderService.update(
      firstOrderId,
      { status: 'Paid', updatedBy: 'Cashier' },
      { restaurantId: String(restaurant._id), operator: 'Cashier' }
    );
    expect(paid).toBeTruthy();
    expect((paid as any)?.status).toBe('Paid');

    // ── 3. The table is freed: no live order remains ──
    const live = await Order.countDocuments({
      tableId: String(table._id),
      status: { $nin: ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'] },
    });
    expect(live).toBe(0);

    // ── 4. Re-seating works: a NEW QR claim succeeds ──
    const claim = await publicStoreOrderService.claimForCustomer(
      String(restaurant.publicToken),
      'lifecycle-session-2',
      String(table._id),
      table.number
    );
    expect(claim.sessionId).toBe('lifecycle-session-2');
    expect(claim.tableId).toBe(String(table._id));

    // ── 5. And a NEW POS Dine-In order succeeds (guard never blocks re-seating) ──
    const reseated = await orderService.create(
      {
        orderNumber: 5011,
        type: 'Dine In',
        status: 'New',
        tableId: String(table._id),
        tableNumber: table.number,
        items: [{ id: 'i1', product: { name: product.name, price: product.price }, quantity: 1, price: product.price }],
      },
      { restaurantId: String(restaurant._id), operator: 'Cashier' }
    );
    expect(reseated).toBeTruthy();
    expect(reseated?.orderNumber).toBe(5011);
    expect((reseated as any)?.tableId).toBe(String(table._id));

    // Exactly one live order again (the new seating's), on a free-for-all table.
    const liveAfter = await Order.countDocuments({
      tableId: String(table._id),
      status: { $nin: ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'] },
    });
    expect(liveAfter).toBe(1);
  });
});
