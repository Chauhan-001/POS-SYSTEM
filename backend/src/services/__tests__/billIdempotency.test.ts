/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bill idempotency + tenant isolation tests — Phase 1.10 validation of the
 * offline-first billing layer:
 *   - The same { restaurantId, clientRef } replay returns the existing bill
 *     and never duplicates the record, stock deduction, or loyalty award.
 *   - Different clientRefs (or different restaurants with the same clientRef)
 *     create distinct bills — the dedup key is tenant-scoped.
 *   - getById / list are restaurant-isolated (cross-tenant reads return null).
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { billService } from '../index';
import Bill from '../../models/Bill';
import BillItem from '../../models/BillItem';
import AuditLog from '../../models/AuditLog';
import { stockMovementService } from '../stockMovementService';
import { loyaltyService } from '../index';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const BRANCH_A = new mongoose.Types.ObjectId().toString();

const billPayload = (over: Record<string, unknown> = {}) => ({
  clientRef: 'bill_local_abc123',
  invoiceNumber: 'INV-2026-1001',
  ticketNumber: 'TK-1001',
  date: '2026-08-01',
  time: '14:30',
  cashierName: 'Test Cashier',
  cashierRole: 'Cashier',
  items: [{ menuItemId: 'p_1', itemName: 'Paneer Tikka', quantity: 2, price: 180 }],
  subtotal: 360,
  discount: 0,
  gst: 18,
  grandTotal: 378,
  paymentMethod: 'Cash',
  orderType: 'Dine-in',
  ...over,
});

describe('BillService idempotency + tenant isolation (Phase 1.10)', () => {
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
      Bill.deleteMany({}).exec(),
      BillItem.deleteMany({}).exec(),
      AuditLog.deleteMany({}).exec(),
    ]);
    vi.clearAllMocks();
    vi.spyOn(stockMovementService, 'applyMovement').mockResolvedValue({} as any);
    vi.spyOn(loyaltyService, 'recordBill').mockResolvedValue({ pointsEarned: 0 } as any);
  });

  it('replays the same clientRef and returns the existing bill (no duplicate)', async () => {
    const first = await billService.create(billPayload(), { restaurantId: REST_A, branchId: BRANCH_A });
    const firstId = (first as any)._id.toString();

    // Simulate an offline queue replay of the exact same payload.
    const replay = await billService.create(billPayload(), { restaurantId: REST_A, branchId: BRANCH_A });
    const replayId = (replay as any)._id.toString();

    expect(replayId).toBe(firstId); // same immutable record returned
    expect(await Bill.countDocuments({ restaurantId: REST_A })).toBe(1);
    // No double stock deduction, no double loyalty award.
    expect(stockMovementService.applyMovement).toHaveBeenCalledTimes(1);
    expect(loyaltyService.recordBill).not.toHaveBeenCalled(); // no customerId in payload
  });

  it('creates separate bills for different clientRefs', async () => {
    await billService.create(billPayload({ clientRef: 'bill_local_1' }), { restaurantId: REST_A });
    await billService.create(billPayload({ clientRef: 'bill_local_2', invoiceNumber: 'INV-2026-1002' }), { restaurantId: REST_A });

    const count = await Bill.countDocuments({ restaurantId: REST_A });
    expect(count).toBe(2);
    expect(stockMovementService.applyMovement).toHaveBeenCalledTimes(2);
  });

  it('keeps the dedup key tenant-scoped: same clientRef in two restaurants is allowed', async () => {
    const billA = await billService.create(billPayload({ invoiceNumber: 'INV-2026-2001' }), { restaurantId: REST_A });
    const billB = await billService.create(billPayload({ invoiceNumber: 'INV-2026-3001' }), { restaurantId: REST_B });

    expect((billA as any)._id.toString()).not.toBe((billB as any)._id.toString());
    expect(await Bill.countDocuments({ restaurantId: REST_A })).toBe(1);
    expect(await Bill.countDocuments({ restaurantId: REST_B })).toBe(1);
  });

  it('is restaurant-isolated on getById (cross-tenant read returns null)', async () => {
    const bill = await billService.create(billPayload(), { restaurantId: REST_A });

    // Restaurant B asking for Restaurant A's bill → not found.
    const crossRead = await billService.getById((bill as any)._id.toString(), { restaurantId: REST_B });
    expect(crossRead).toBeNull();

    // Restaurant A asking for its own bill → found.
    const ownRead = await billService.getById((bill as any)._id.toString(), { restaurantId: REST_A });
    expect(ownRead).not.toBeNull();
  });

  it('list() never leaks another restaurant’s bills', async () => {
    await billService.create(billPayload(), { restaurantId: REST_A, branchId: BRANCH_A });
    await billService.create(billPayload({ invoiceNumber: 'INV-2026-9999' }), { restaurantId: REST_B });

    const listA = await billService.list({ restaurantId: REST_A, branchId: BRANCH_A });
    const listB = await billService.list({ restaurantId: REST_B });

    expect(listA.data.length).toBe(1);
    expect(listB.data.length).toBe(1);
    const aIds = (listA.data as any[]).map((b) => String(b._id));
    const bIds = (listB.data as any[]).map((b) => String(b._id));
    expect(aIds).not.toEqual(bIds);
  });

  it('stocks and loyalty are applied exactly once across a replay when a customer is attached', async () => {
    const customerId = new mongoose.Types.ObjectId().toString();
    const payload = billPayload({
      clientRef: 'bill_local_cust',
      customerId,
      customerPhone: '9876543210',
      pointsEarned: 10,
    });

    await billService.create(payload, { restaurantId: REST_A });
    await billService.create(payload, { restaurantId: REST_A }); // replay

    expect(await Bill.countDocuments({ restaurantId: REST_A })).toBe(1);
    // stock deduction ran for the 1 line item, exactly once.
    const stockCalls = (stockMovementService.applyMovement as ReturnType<typeof vi.fn>).mock.calls;
    expect(stockCalls.length).toBe(1);
    // loyalty was recorded exactly once.
    expect(loyaltyService.recordBill).toHaveBeenCalledTimes(1);
  });
});
