import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { shiftService } from '../index';
import { billService } from '../index';
import Shift from '../../models/finance/Shift';
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

async function seedEmployee(overrides: any = {}) {
  return Employee.create({
    username: `emp_${Date.now()}`,
    name: 'Test Employee',
    role: 'Cashier',
    pin: '1234',
    status: 'Active',
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchId: new mongoose.Types.ObjectId(BRANCH),
    isDeleted: false,
    ...overrides,
  });
}

async function seedBill(shiftId?: string, overrides: any = {}) {
  return Bill.create({
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticketNumber: `TK-${Math.random().toString(36).slice(2, 7)}`,
    date: '2026-08-05',
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

describe('ShiftService (Phase 2)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Shift.init();
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}).exec(),
      Bill.deleteMany({}).exec(),
      Device.deleteMany({}).exec(),
      Employee.deleteMany({}).exec(),
    ]);
  });

  // ─── Register identity ───

  it('validates register existence before opening shift', async () => {
    await expect(
      shiftService.openShift(REST, {
        branchId: BRANCH,
        registerId: 'REG-999',
        openingCash: 5000,
        operatorId: new mongoose.Types.ObjectId().toString(),
        operatorRole: 'Cashier',
        operatorName: 'Staff',
      })
    ).rejects.toThrow(/not found/);
  });

  // ─── Multiple registers at one branch ───

  it('allows multiple concurrent open shifts on different registers', async () => {
    await seedDevice('REG-01');
    await seedDevice('REG-02');
    const emp = await seedEmployee();

    const s1 = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });
    expect(s1.status).toBe('open');

    const s2 = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-02',
      openingCash: 3000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });
    expect(s2.status).toBe('open');
    expect(s1.registerId).not.toBe(s2.registerId);
  });

  // ─── Sequential shifts on same register ───

  it('allows sequential shifts on the same register after close', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee({ role: 'Manager' });

    const s1 = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });
    expect(s1.status).toBe('open');

    const closed = await shiftService.closeShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      closingCash: 5200,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });
    expect(closed.status).toBe('closed');
    expect(closed.variance).toBe(200);

    const s2 = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5200,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });
    expect(s2.status).toBe('open');
    expect(s2._id.toString()).not.toBe(s1._id.toString());
  });

  // ─── Duplicate active shift rejection ───

  it('rejects duplicate active shift on same register', async () => {
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

    await expect(
      shiftService.openShift(REST, {
        branchId: BRANCH,
        registerId: 'REG-01',
        openingCash: 3000,
        operatorId: emp._id.toString(),
        operatorRole: 'Cashier',
        operatorName: emp.name,
      })
    ).rejects.toThrow(/already has an open shift/);
  });

  // ─── Staff authorization ───

  it('allows shift opener to close their own shift', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const s = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    const closed = await shiftService.closeShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      closingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });
    expect(closed.status).toBe('closed');
    expect(closed.variance).toBe(0);
  });

  it('rejects non-opener cashier closing another cashier shift', async () => {
    await seedDevice('REG-01');
    const empA = await seedEmployee({ name: 'Cashier A' });
    const empB = await seedEmployee({ name: 'Cashier B' });

    await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: empA._id.toString(),
      operatorRole: 'Cashier',
      operatorName: empA.name,
    });

    await expect(
      shiftService.closeShift(REST, {
        branchId: BRANCH,
        registerId: 'REG-01',
        closingCash: 5000,
        operatorId: empB._id.toString(),
        operatorRole: 'Cashier',
        operatorName: empB.name,
      })
    ).rejects.toThrow(/Only the shift opener or a Manager/);
  });

  // ─── Manager override ───

  it('allows Manager to close any shift with variance', async () => {
    await seedDevice('REG-01');
    const cashier = await seedEmployee({ name: 'Cashier' });
    const manager = await seedEmployee({ name: 'Manager', role: 'Manager' });

    const s = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: cashier._id.toString(),
      operatorRole: 'Cashier',
      operatorName: cashier.name,
    });

    const closed = await shiftService.closeShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      closingCash: 4500,
      operatorId: manager._id.toString(),
      operatorRole: 'Manager',
      operatorName: manager.name,
      approvedBy: manager._id.toString(),
      approvalNotes: 'Variance approved',
    });
    expect(closed.status).toBe('closed');
    expect(closed.variance).toBe(-500);
    expect(closed.approvedBy.toString()).toBe(manager._id.toString());
  });

  it('rejects cashier closing with variance without manager approval', async () => {
    await seedDevice('REG-01');
    const cashier = await seedEmployee();

    await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: cashier._id.toString(),
      operatorRole: 'Cashier',
      operatorName: cashier.name,
    });

    await expect(
      shiftService.closeShift(REST, {
        branchId: BRANCH,
        registerId: 'REG-01',
        closingCash: 4500,
        operatorId: cashier._id.toString(),
        operatorRole: 'Cashier',
        operatorName: cashier.name,
      })
    ).rejects.toThrow(/Variance/);
  });

  // ─── Tenant isolation ───

  it('isolates shifts between restaurants', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee();

    const s1 = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    const OTHER = new mongoose.Types.ObjectId().toString();
    const shifts = await shiftService.listShifts(OTHER);
    expect(shifts.data.length).toBe(0);
  });

  // ─── Bill creation captures shiftId ───

  it('captures shiftId on bill creation when shift is open', async () => {
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

    const bill = await billService.create({
      invoiceNumber: 'INV-TEST-001',
      ticketNumber: 'TK-001',
      date: '2026-08-05',
      time: '12:00',
      cashierName: emp.name,
      cashierRole: 'Cashier',
      registerId: 'REG-01',
      items: [],
      subtotal: 1000,
      gst: 100,
      grandTotal: 1100,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
    }, {
      restaurantId: REST,
      branchId: BRANCH,
      operator: emp.name,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
    });

    expect(bill.shiftId.toString()).toBe(shift._id.toString());
    expect(bill.cashierId.toString()).toBe(emp._id.toString());
  });

  // ─── Historical bills with null shiftId ───

  it('allows bills without shiftId (historical records)', async () => {
    const bill = await Bill.create({
      invoiceNumber: 'INV-HIST-001',
      ticketNumber: 'TK-HIST-001',
      date: '2026-08-01',
      time: '10:00',
      cashierName: 'Old Cashier',
      cashierRole: 'Cashier',
      subtotal: 500,
      discount: 0,
      gst: 50,
      grandTotal: 550,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
      restaurantId: new mongoose.Types.ObjectId(REST),
      branchId: new mongoose.Types.ObjectId(BRANCH),
      pointsEarned: 0,
      pointsRedeemed: 0,
      isVoided: false,
      isRefunded: false,
      refundAmount: 0,
    });
    expect(bill.shiftId).toBeNull();
    expect(bill.cashierId).toBeNull();
  });

  // ─── Get open shift ───

  it('returns null when no shift is open', async () => {
    const result = await shiftService.getOpenShift(REST, 'REG-01');
    expect(result).toBeNull();
  });

  it('returns the open shift for a register', async () => {
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

    const found = await shiftService.getOpenShift(REST, 'REG-01');
    expect(found?._id.toString()).toBe(shift._id.toString());
    expect(found.status).toBe('open');
  });

  // ─── Shift listing ───

  it('lists shifts with tenant scoping', async () => {
    await seedDevice('REG-01');
    await seedDevice('REG-02');
    const emp = await seedEmployee();

    await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-02',
      openingCash: 3000,
      operatorId: emp._id.toString(),
      operatorRole: 'Cashier',
      operatorName: emp.name,
    });

    const shifts = await shiftService.listShifts(REST);
    expect(shifts.data.length).toBe(2);
  });

  // ─── Shift close with variance ───

  it('computes variance correctly on close', async () => {
    await seedDevice('REG-01');
    const emp = await seedEmployee({ role: 'Manager' });

    const s = await shiftService.openShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      openingCash: 5000,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });

    const closed = await shiftService.closeShift(REST, {
      branchId: BRANCH,
      registerId: 'REG-01',
      closingCash: 5300,
      operatorId: emp._id.toString(),
      operatorRole: 'Manager',
      operatorName: emp.name,
    });

    expect(closed.expectedCash).toBe(5000);
    expect(closed.closingCash).toBe(5300);
    expect(closed.variance).toBe(300);
  });
});
