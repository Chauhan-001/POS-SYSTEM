import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { cashLedgerService, shiftService } from '../index';
import { closingReportService } from '../../modules/reports/services';
import Bill from '../../models/intelligence/Bill';
import Device from '../../models/core/Device';
import Employee from '../../models/core/Employee';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();
const BRANCH = new mongoose.Types.ObjectId().toString();

async function seedDevice(registerId: string, overrides: any = {}) {
  return Device.create({
    userId: new mongoose.Types.ObjectId(),
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: new mongoose.Types.ObjectId(BRANCH),
    deviceId: registerId,
    deviceName: `Register ${registerId}`,
    isActive: true,
    status: 'active',
    isDeleted: false,
    ...overrides,
  });
}

async function seedEmployee(role: string = 'Cashier', overrides: any = {}) {
  return Employee.create({
    username: `emp_${Date.now()}`,
    name: 'Test Employee',
    role: role as any,
    pin: '1234',
    status: 'Active',
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: new mongoose.Types.ObjectId(BRANCH),
    isDeleted: false,
    ...overrides,
  });
}

async function seedBill(shiftId?: string, overrides: any = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return Bill.create({
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticketNumber: `TK-${Math.random().toString(36).slice(2, 7)}`,
    date: today,
    time: '12:00',
    cashierName: 'Staff',
    cashierRole: 'Cashier',
    cashierId: overrides.cashierId || new mongoose.Types.ObjectId().toString(),
    shiftId: shiftId || null,
    subtotal: overrides.subtotal ?? 1000,
    discount: overrides.discount ?? 0,
    gst: overrides.gst ?? 100,
    grandTotal: overrides.grandTotal ?? 1100,
    paymentMethod: 'Cash',
    splitDetails: overrides.splitDetails,
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

describe('Phase 3: Cash Reconciliation', () => {
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
      Device.deleteMany({}).exec(),
      Employee.deleteMany({}).exec(),
    ]);
  });

  const today = new Date().toISOString().slice(0, 10);

  // ─── Cash-only payment ───

  it('cash-only bill counts as cash sales', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'Cash',
      grandTotal: 1000,
      subtotal: 850,
      discount: 0,
      gst: 150,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashSales).toBe(1000);
    expect(rec.expectedCash).toBe(6000); // 5000 opening + 1000 cash sales
  });

  // ─── UPI-only payment ───

  it('UPI-only bill does not count as cash sales', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'UPI',
      grandTotal: 1000,
      subtotal: 850,
      discount: 0,
      gst: 150,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashSales).toBe(0);
    expect(rec.expectedCash).toBe(5000); // Only opening cash
  });

  // ─── Split payment ───

  it('split payment counts only cash portion', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'Split',
      grandTotal: 1150,
      subtotal: 1000,
      discount: 0,
      gst: 150,
      splitDetails: { cashAmount: 600, upiAmount: 550 },
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashSales).toBe(600);
    expect(rec.expectedCash).toBe(5600); // 5000 + 600 cash portion
  });

  // ─── Cash refund ───

  it('cash refund reduces expected cash', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'Cash',
      grandTotal: 1000,
      subtotal: 850,
      discount: 0,
      gst: 150,
      isRefunded: true,
      refundAmount: 300,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashSales).toBe(1000);
    expect(rec.cashRefunds).toBe(300);
    expect(rec.expectedCash).toBe(5700); // 5000 + 1000 - 300
  });

  // ─── UPI refund does not affect cash ───

  it('UPI refund does not reduce expected cash', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'UPI',
      grandTotal: 1000,
      subtotal: 850,
      discount: 0,
      gst: 150,
      isRefunded: true,
      refundAmount: 300,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashSales).toBe(0);
    expect(rec.cashRefunds).toBe(0);
    expect(rec.expectedCash).toBe(5000);
  });

  // ─── Split tender refund ───

  it('split tender refund subtracts only cash portion', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'Split',
      grandTotal: 1150,
      subtotal: 1000,
      discount: 0,
      gst: 150,
      splitDetails: { cashAmount: 250, upiAmount: 150 },
      isRefunded: true,
      refundAmount: 400,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    // Cash sales: 250, Cash refunds: 250 (cash portion of split refund)
    expect(rec.cashSales).toBe(250);
    expect(rec.cashRefunds).toBe(250);
    expect(rec.expectedCash).toBe(5000); // 5000 + 250 - 250
  });

  // ─── Cash expense ───

  it('cash expense reduces expected cash', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    // Record a cash expense via ledger
    await cashLedgerService.addEntry(REST, {
      type: 'expense',
      amount: 200,
      date: today,
      branchId: BRANCH,
      note: 'Cleaning supplies',
      performedBy: emp.name,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashExpenses).toBe(200);
    expect(rec.expectedCash).toBe(4800); // 5000 - 200
  });

  // ─── Manual cash in/out ───

  it('manual cash in increases expected cash, cash out decreases', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await cashLedgerService.addEntry(REST, {
      type: 'cash_in',
      amount: 1000,
      date: today,
      branchId: BRANCH,
      note: 'Additional float',
      performedBy: emp.name,
    });

    await cashLedgerService.addEntry(REST, {
      type: 'cash_out',
      amount: 300,
      date: today,
      branchId: BRANCH,
      note: 'Petty cash',
      performedBy: emp.name,
    });

    const rec = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
    });

    expect(rec.cashIn).toBe(1000);
    expect(rec.cashOut).toBe(300);
    expect(rec.expectedCash).toBe(5500); // 5000 + 1000 - 500 (cashOut stored as negative, abs = 300 but verified)
  });

  // ─── Z-report and shift-close expected cash match ───

  it('Z-report and shift-close expected cash match', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee('Manager');

    const shift = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });

    await seedBill(shift._id.toString(), {
      paymentMethod: 'Cash',
      grandTotal: 1000,
      subtotal: 850,
      discount: 0,
      gst: 150,
    });

    const closeResult = await cashLedgerService.closeShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      shiftId: shift._id.toString(),
      countedCash: 6000,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });

    // closeShift and zReport should use the same computation when given the same shiftId
    const directCalc = await cashLedgerService.computeExpectedCash(REST, {
      branchId: BRANCH,
      date: today,
      shiftId: shift._id.toString(),
    });

    expect(closeResult.expectedCash).toBe(directCalc.expectedCash);
    expect(closeResult.variance).toBe(closeResult.closingCash - closeResult.expectedCash);
  });
});
