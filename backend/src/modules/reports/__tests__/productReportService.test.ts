import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import Product from '../../../models/Product';
import { productReportService } from '../services';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();

async function seedBill(grandTotal: number, items: Array<{ itemName: string; priceAtSale: number; quantity: number }>) {
  const bill = await Bill.create({
    invoiceNumber: `INV-${Math.floor(Math.random() * 1e6)}`,
    ticketNumber: 'T-1',
    date: '2026-08-01',
    time: '12:30',
    cashierName: 'Owner',
    cashierRole: 'Owner',
    subtotal: grandTotal,
    discount: 0,
    gst: 0,
    grandTotal,
    paymentMethod: 'Cash',
    orderType: 'Dine In',
    restaurantId: REST_A,
    isVoided: false,
    isRefunded: false,
    refundAmount: 0,
  });
  for (const it of items) {
    await BillItem.create({ billId: bill._id, menuItemId: it.itemName, itemName: it.itemName, priceAtSale: it.priceAtSale, quantity: it.quantity, gstRateAtSale: 5, discountAtSale: 0, isFree: false });
  }
  return bill;
}

describe('ProductReportService (Phase 1.8)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([Bill.deleteMany({}).exec(), BillItem.deleteMany({}).exec(), Product.deleteMany({}).exec()]);
  });

  const scope = { restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' };

  it('ranks top and least selling products by quantity', async () => {
    await seedBill(1000, [
      { itemName: 'Pizza', priceAtSale: 500, quantity: 4 },
      { itemName: 'Burger', priceAtSale: 200, quantity: 1 },
    ]);
    const top = await productReportService.top(scope, 5);
    expect(top[0].name).toBe('Pizza');
    expect(top[0].qty).toBe(4);
    expect(top[0].revenue).toBe(2000);

    const least = await productReportService.least(scope, 5);
    expect(least[0].name).toBe('Burger');
  });

  it('excludes voided bills from product revenue', async () => {
    await seedBill(1000, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 2 }]);
    await Bill.updateMany({}, { $set: { isVoided: true } }).exec();
    const top = await productReportService.top(scope, 5);
    expect(top.length).toBe(0);
  });

  it('builds menu engineering quadrants and ABC classes', async () => {
    await seedBill(1000, [
      { itemName: 'Pizza', priceAtSale: 500, quantity: 5 },
      { itemName: 'Burger', priceAtSale: 100, quantity: 2 },
      { itemName: 'Fries', priceAtSale: 50, quantity: 10 },
    ]);
    const me = await productReportService.menuEngineering(scope);
    expect(me.length).toBe(3);
    expect(['Star', 'Puzzle', 'Plow Horse', 'Dog']).toContain(me[0].quadrant);

    const abc = await productReportService.abc(scope);
    expect(abc.length).toBe(3);
    expect(abc[0].class).toBe('A');
  });

  it('enforces tenant isolation on product reports', async () => {
    await seedBill(1000, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 2 }]);
    const other = await productReportService.top({ restaurantId: new mongoose.Types.ObjectId().toString(), startDate: '2026-08-01', endDate: '2026-08-01' }, 5);
    expect(other.length).toBe(0);
  });
});
