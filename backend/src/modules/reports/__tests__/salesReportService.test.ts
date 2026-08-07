import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import { salesReportService } from '../services';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

const billPayload = (over: any = {}) => ({
  invoiceNumber: `INV-${Math.floor(Math.random() * 1e6)}`,
  ticketNumber: 'T-1',
  date: '2026-08-01',
  time: '12:30',
  cashierName: 'Owner',
  cashierRole: 'Owner',
  subtotal: 900,
  discount: 100,
  gst: 40,
  grandTotal: 840,
  paymentMethod: 'Cash',
  orderType: 'Dine In',
  restaurantId: REST_A,
  branchId: null,
  isVoided: false,
  isRefunded: false,
  refundAmount: 0,
  pointsEarned: 80,
  pointsRedeemed: 0,
  ...over,
});

async function seedBill(data: any, items: Array<{ itemName: string; priceAtSale: number; quantity: number }> = []) {
  const bill = await Bill.create(billPayload(data));
  for (const it of items) {
    await BillItem.create({ billId: bill._id, menuItemId: it.itemName, itemName: it.itemName, priceAtSale: it.priceAtSale, quantity: it.quantity, gstRateAtSale: 5, discountAtSale: 0, isFree: false });
  }
  return bill;
}

describe('SalesReportService (Phase 1.8)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([Bill.deleteMany({}).exec(), BillItem.deleteMany({}).exec()]);
  });

  it('computes the sales summary with revenue, orders, discounts, taxes', async () => {
    await seedBill({}, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 2 }]);
    await seedBill({ paymentMethod: 'UPI', grandTotal: 200 }, []);

    const s = await salesReportService.summary({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(s.summary.grossSales).toBe(1040);
    expect(s.summary.netSales).toBe(1040);
    expect(s.summary.orders).toBe(2);
    expect(s.summary.discounts).toBe(200);
    expect(s.summary.taxes).toBe(80);
    expect(s.summary.cashSales).toBe(840);
  });

  it('excludes voided bills from revenue', async () => {
    await seedBill({}, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 1 }]);
    await seedBill({ isVoided: true, grandTotal: 9999 }, []);

    const s = await salesReportService.summary({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(s.summary.orders).toBe(1);
    expect(s.summary.netSales).toBe(840); // only the valid bill
    expect(s.status.voided).toBe(1);
    expect(s.status.completed).toBe(1);
  });

  it('nets out refunded amounts', async () => {
    await seedBill({}, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 1 }]);
    await seedBill({ isRefunded: true, refundAmount: 300, grandTotal: 500 }, []);

    const s = await salesReportService.summary({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(s.summary.netSales).toBe(1040); // 840 + (500-300)
    expect(s.status.refunded).toBe(1);
    expect(s.status.refundAmount).toBe(300);
  });

  it('enforces tenant isolation across restaurants', async () => {
    await seedBill({}, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 1 }]);
    await seedBill({ restaurantId: REST_B, invoiceNumber: 'INV-B', grandTotal: 100 }, []);

    const forA = await salesReportService.summary({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    const forB = await salesReportService.summary({ restaurantId: REST_B, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(forA.summary.orders).toBe(1);
    expect(forB.summary.orders).toBe(1);
    expect(forA.summary.netSales).toBe(840);
    expect(forB.summary.netSales).toBe(100);
  });

  it('produces a daily trend with item counts', async () => {
    await seedBill({}, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 2 }]);
    await seedBill({ date: '2026-08-02', grandTotal: 200 }, []);

    const trend: any[] = await salesReportService.trend({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-02' });
    expect(trend.length).toBe(2);
    const day1 = trend.find((t: any) => t.date === '2026-08-01');
    expect(day1?.items).toBe(2);
  });

  it('reports payment method distribution', async () => {
    await seedBill({ paymentMethod: 'Cash' });
    await seedBill({ paymentMethod: 'UPI', grandTotal: 200 });

    const payments: any[] = await salesReportService.payments({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    const cash = payments.find((p: any) => p.method === 'Cash');
    const upi = payments.find((p: any) => p.method === 'UPI');
    expect(cash?.amount).toBe(840);
    expect(upi?.amount).toBe(200);
  });

  it('ranks cashiers by revenue', async () => {
    await seedBill({ cashierName: 'Ravi' }, [{ itemName: 'Pizza', priceAtSale: 500, quantity: 1 }]);
    await seedBill({ cashierName: 'Anita', grandTotal: 900 }, []);

    const cashiers: any[] = await salesReportService.cashiers({ restaurantId: REST_A, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(cashiers.length).toBe(2);
    const anita = cashiers.find((c: any) => c.cashier === 'Anita');
    expect(anita?.orders).toBe(1);
  });
});
