import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { financeService, expenseService, cashLedgerService } from '../index';
import Bill from '../../models/Bill';
import Expense from '../../models/Expense';
import CashLedger from '../../models/CashLedger';
import FinanceSettings from '../../models/FinanceSettings';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

async function seedBill(over: any = {}) {
  return Bill.create({
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticketNumber: `TK-${Math.random().toString(36).slice(2, 7)}`,
    date: over.date || '2026-08-01',
    time: '12:00',
    cashierName: 'Staff',
    cashierRole: 'Cashier',
    subtotal: over.subtotal ?? 1000,
    discount: over.discount ?? 0,
    gst: over.gst ?? 100,
    grandTotal: over.grandTotal ?? 1100,
    paymentMethod: over.paymentMethod || 'Cash',
    orderType: 'Dine In',
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: over.branchId ? new mongoose.Types.ObjectId(over.branchId) : undefined,
    pointsEarned: 0,
    pointsRedeemed: 0,
    isVoided: over.isVoided ?? false,
    isRefunded: over.isRefunded ?? false,
    refundAmount: over.refundAmount ?? 0,
    ...over,
  });
}

describe('FinanceService (Phase 1.7)', () => {
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
      Expense.deleteMany({}).exec(),
      CashLedger.deleteMany({}).exec(),
      FinanceSettings.deleteMany({}).exec(),
    ]);
  });

  it('computes a real P&L from bills + expenses (COGS vs operating)', async () => {
    await seedBill({ grandTotal: 1100, subtotal: 1000, gst: 100, date: '2026-08-05' });
    await seedBill({ grandTotal: 2200, subtotal: 2000, gst: 200, date: '2026-08-06' });
    // COGS expense (Ingredients & Raw Materials → auto COGS).
    await expenseService.create(REST, {
      amount: 600, category: 'Ingredients & Raw Materials',
      description: 'veg', date: '2026-08-06', paymentMethod: 'Cash',
    });
    // Operating expense.
    await expenseService.create(REST, {
      amount: 400, category: 'Utilities',
      description: 'power bill', date: '2026-08-06', paymentMethod: 'UPI',
    });

    const pnl = await financeService.pnl(REST, { period: 'custom', startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(pnl.revenue).toBe(3300);
    expect(pnl.cogs).toBe(600); // Ingredients category
    expect(pnl.operatingExpenses).toBe(400);
    expect(pnl.grossProfit).toBe(2700);
    expect(pnl.netProfit).toBe(2300);
  });

  it('excludes voided and refunded amounts from revenue', async () => {
    await seedBill({ grandTotal: 1100, date: '2026-08-05' });
    await seedBill({ grandTotal: 9999, isVoided: true, date: '2026-08-05' });
    await seedBill({ grandTotal: 500, isRefunded: true, refundAmount: 200, date: '2026-08-05' });

    const pnl = await financeService.pnl(REST, { period: 'custom', startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(pnl.revenue).toBe(1400); // 1100 + (500 - 200)
    expect(pnl.refunds).toBe(200);
    expect(pnl.orders).toBe(2); // only non-voided bills count
  });

  it('computes GST: output from bills, input from expenses, net payable', async () => {
    await seedBill({ grandTotal: 1180, subtotal: 1000, gst: 180, date: '2026-08-05' });
    await expenseService.create(REST, {
      amount: 1180, category: 'Equipment & Maintenance',
      description: 'printer', date: '2026-08-06', paymentMethod: 'Bank Transfer',
      gst: { cgst: 45, sgst: 45, igst: 0, cess: 0, inputGst: true, taxInclusive: true },
    });

    const gst = await financeService.gstReport(REST, { startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(gst.outputGst).toBe(180);
    expect(gst.inputGst).toBe(90);
    expect(gst.netPayable).toBe(90);
  });

  it('builds a cash-flow report from the ledger', async () => {
    await cashLedgerService.openCash(REST, { amount: 1000, date: '2026-08-01' });
    await cashLedgerService.addEntry(REST, { type: 'cash_in', amount: 500, date: '2026-08-01' });
    await cashLedgerService.recordExpense(REST, { expenseId: 'e1', amount: 300, date: '2026-08-02' });

    const flow = await financeService.cashFlow(REST, { startDate: '2026-08-01', endDate: '2026-08-02' });
    expect(flow.length).toBe(2);
    expect(flow[0].opening).toBe(1000);
    expect(flow[0].cashIn).toBe(500);
    expect(flow[1].cashOut).toBe(300);
    expect(flow[1].closing).toBe(1200);
  });

  it('produces a 12-month statement', async () => {
    await seedBill({ grandTotal: 1100, date: '2026-03-10' });
    await expenseService.create(REST, {
      amount: 100, category: 'Utilities', description: 'power', date: '2026-03-11', paymentMethod: 'UPI',
    });
    const stmt = await financeService.monthlyStatement(REST, 2026);
    expect(stmt.months.length).toBe(12);
    const mar = stmt.months.find((m: any) => m.month === '2026-03');
    expect(mar!.revenue).toBe(1100);
    expect(mar!.netProfit).toBe(1000);
  });

  it('supports cogsMode category (honors per-expense isCogs)', async () => {
    await financeService.updateSettings(REST, { cogsMode: 'category' });
    await seedBill({ grandTotal: 1100, date: '2026-08-05' });
    await expenseService.create(REST, {
      amount: 700, category: 'Utilities', description: 'power', date: '2026-08-06',
      paymentMethod: 'UPI', isCogs: true,
    });
    const pnl = await financeService.pnl(REST, { period: 'custom', startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(pnl.cogs).toBe(700);
    expect(pnl.operatingExpenses).toBe(0);
  });
});
