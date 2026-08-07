import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { vendorService, expenseService } from '../index';
import Vendor from '../../models/Vendor';
import Expense from '../../models/Expense';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();
const OTHER = new mongoose.Types.ObjectId().toString();

describe('VendorService (Phase 1.7)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([Vendor.deleteMany({}).exec(), Expense.deleteMany({}).exec()]);
  });

  it('creates a vendor with GSTIN and finds it by search', async () => {
    const vendor = await vendorService.create(REST, {
      name: 'Green Grocers', gstin: '29ABCDE1234F1Z5', phone: '9876543210',
    });
    expect(vendor.gstin).toBe('29ABCDE1234F1Z5');
    const found = await vendorService.list(REST, { search: 'green' });
    expect(found.total).toBe(1);
  });

  it('enforces tenant isolation on vendors', async () => {
    const vendor = await vendorService.create(REST, { name: 'Water Co' });
    const id = (vendor as any)._id.toString();
    await expect(vendorService.get(OTHER, id)).rejects.toThrow(/not found/);
  });

  it('computes billed/paid/outstanding from the expense ledger', async () => {
    const vendor = await vendorService.create(REST, { name: 'Power Co' });
    const vendorId = (vendor as any)._id.toString();

    // Billed 1500 via UPI (paid), 700 via Bank Transfer (outstanding).
    await expenseService.create(REST, {
      amount: 1500, category: 'Utilities', description: 'bill',
      date: '2026-08-01', paymentMethod: 'UPI', vendorId,
    });
    await expenseService.create(REST, {
      amount: 700, category: 'Utilities', description: 'bill',
      date: '2026-08-02', paymentMethod: 'Bank Transfer', vendorId,
    });

    const { summary } = await vendorService.summary(REST, vendorId);
    expect(summary.totalBilled).toBe(2200);
    expect(summary.totalPaid).toBe(1500);
    expect(summary.outstanding).toBe(700);
    expect(summary.expenseCount).toBe(2);
  });

  it('soft-deletes a vendor', async () => {
    const vendor = await vendorService.create(REST, { name: 'X Co' });
    await vendorService.softDelete(REST, (vendor as any)._id.toString());
    const list = await vendorService.list(REST, {});
    expect(list.total).toBe(0);
  });
});
