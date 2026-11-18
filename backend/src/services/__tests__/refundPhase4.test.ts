import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { billService } from '../index';
import Bill from '../../models/intelligence/Bill';
import BillItem from '../../models/intelligence/BillItem';
import RefundRecord from '../../models/orders/RefundRecord';
import Employee from '../../models/core/Employee';
import { hashPin } from '../../utils/bcrypt';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();
const BRANCH = new mongoose.Types.ObjectId().toString();
const MANAGER_PIN = '1234';
let hashedPin: string;

async function seedBill(overrides: any = {}) {
  return Bill.create({
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticketNumber: `TK-${Math.random().toString(36).slice(2, 7)}`,
    date: '2026-08-05',
    time: '12:00',
    cashierName: 'Staff',
    cashierRole: 'Cashier',
    subtotal: 1000,
    discount: 0,
    gst: 150,
    grandTotal: 1150,
    paymentMethod: 'Cash',
    orderType: 'Dine In',
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: new mongoose.Types.ObjectId(BRANCH),
    pointsEarned: 0,
    pointsRedeemed: 0,
    isVoided: false,
    isRefunded: false,
    refundAmount: 0,
    ...overrides,
  });
}

async function seedBillItem(billId: string, overrides: any = {}) {
  return BillItem.create({
    billId,
    menuItemId: new mongoose.Types.ObjectId().toString(),
    itemName: 'Test Item',
    priceAtSale: 500,
    quantity: 2,
    gstRateAtSale: 5,
    discountAtSale: 0,
    isFree: false,
    ...overrides,
  });
}

async function seedManager() {
  hashedPin = await hashPin(MANAGER_PIN);
  return Employee.create({
    username: `mgr_${Date.now()}`,
    name: 'Test Manager',
    role: 'Manager',
    pin: hashedPin,
    status: 'Active',
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: new mongoose.Types.ObjectId(BRANCH),
    isDeleted: false,
  });
}

describe('Phase 4: Refund - Multiple Partial Refunds', () => {
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
      RefundRecord.deleteMany({}).exec(),
      Employee.deleteMany({}).exec(),
    ]);
  });

  // ─── Multiple partial refunds on same bill ───

  it('supports multiple partial refunds on same bill', async () => {
    const manager = await seedManager();
    const bill = await seedBill({ grandTotal: 1050, subtotal: 1000, gst: 50 });
    await seedBillItem(bill._id.toString(), { quantity: 2, priceAtSale: 500 });

    // First partial refund: refund 1 of 2 items
    const refund1 = await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'Customer returned one item',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    expect(refund1.isRefunded).toBe(false); // Not fully refunded yet

    // Second partial refund: refund the remaining item
    const refund2 = await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'Customer returned second item',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    expect(refund2.isRefunded).toBe(true); // Fully refunded now
  });

  // ─── Excessive quantities rejected ───

  it('rejects refund quantity exceeding sold quantity', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString(), { quantity: 2 });

    await expect(
      billService.refundBill(bill._id.toString(), {
        items: [{ menuItemId: '', itemName: 'Test Item', quantity: 5 }],
        reason: 'Excessive refund',
        refundedBy: manager.name,
        managerPin: MANAGER_PIN,
        refundPaymentMethod: 'Cash',
      }, { restaurantId: REST, branchId: BRANCH })
    ).rejects.toThrow();
  });

  // ─── Excessive amounts rejected ───

  it('rejects refund amount exceeding grand total', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString());

    // First refund
    await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 2 }],
      reason: 'First refund',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    // Second refund attempt would exceed grand total
    await expect(
      billService.refundBill(bill._id.toString(), {
        items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
        reason: 'Excessive amount',
        refundedBy: manager.name,
        managerPin: MANAGER_PIN,
        refundPaymentMethod: 'Cash',
      }, { restaurantId: REST, branchId: BRANCH })
    ).rejects.toThrow();
  });

  // ─── Duplicate refund request (idempotency) ───

  it('does not double-count duplicate refund request', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString(), { quantity: 1 });

    // First refund
    await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'First refund',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    // The bill is now fully refunded (quantity 1), so second attempt should fail
    await expect(
      billService.refundBill(bill._id.toString(), {
        items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
        reason: 'Duplicate refund',
        refundedBy: manager.name,
        managerPin: MANAGER_PIN,
        refundPaymentMethod: 'Cash',
      }, { restaurantId: REST, branchId: BRANCH })
    ).rejects.toThrow();
  });

  // ─── Full refund ───

  it('supports full refund of entire bill', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString(), { quantity: 1, priceAtSale: 1000, gstRateAtSale: 15, discountAtSale: 0 });

    const refund = await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'Full refund',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    expect(refund.isRefunded).toBe(true);
    expect(refund.refundAmount).toBe(1150); // Full grand total
  });

  // ─── Mixed refund tenders ───

  it('records cash refund payment method correctly', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString());

    const refund = await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'Cash refund',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    const refundRecord = await RefundRecord.findOne({ billId: bill._id.toString() }).lean().exec();
    expect(refundRecord?.refundPaymentMethod).toBe('Cash');
  });

  it('records UPI refund payment method correctly', async () => {
    const manager = await seedManager();
    const bill = await seedBill({ paymentMethod: 'UPI' });
    await seedBillItem(bill._id.toString());

    const refund = await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'UPI refund',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'UPI',
    }, { restaurantId: REST, branchId: BRANCH });

    const refundRecord = await RefundRecord.findOne({ billId: bill._id.toString() }).lean().exec();
    expect(refundRecord?.refundPaymentMethod).toBe('UPI');
  });

  // ─── Cumulative refund does not exceed grand total ───

  it('cumulative refunds cannot exceed grand total', async () => {
    const manager = await seedManager();
    const bill = await seedBill();
    await seedBillItem(bill._id.toString(), { quantity: 2 });

    // First refund: 1 item
    await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'First partial',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    // Second refund: 1 more item (total = 2 items = full bill)
    await billService.refundBill(bill._id.toString(), {
      items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
      reason: 'Second partial',
      refundedBy: manager.name,
      managerPin: MANAGER_PIN,
      refundPaymentMethod: 'Cash',
    }, { restaurantId: REST, branchId: BRANCH });

    // Third refund attempt should fail - bill fully refunded
    await expect(
      billService.refundBill(bill._id.toString(), {
        items: [{ menuItemId: '', itemName: 'Test Item', quantity: 1 }],
        reason: 'Third refund attempt',
        refundedBy: manager.name,
        managerPin: MANAGER_PIN,
        refundPaymentMethod: 'Cash',
      }, { restaurantId: REST, branchId: BRANCH })
    ).rejects.toThrow();
  });
});
