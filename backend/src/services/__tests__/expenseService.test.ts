import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { expenseService, cashLedgerService } from '../index';
import Expense from '../../models/Expense';
import CashLedger from '../../models/CashLedger';
import { AppError } from '../../utils/AppError';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

const expensePayload = (over: any = {}) => ({
  amount: 2500,
  category: 'Rent & Lease',
  description: 'Monthly rent',
  date: '2026-08-01',
  paymentMethod: 'Bank Transfer',
  ...over,
});

describe('ExpenseService (Phase 1.7)', () => {
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
      Expense.deleteMany({}).exec(),
      CashLedger.deleteMany({}).exec(),
    ]);
  });

  it('creates an expense stamped with the tenant', async () => {
    const expense = await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    expect(expense.amount).toBe(2500);
    expect(expense.restaurantId.toString()).toBe(REST_A);
    expect(expense.version).toBe(1);
    expect(expense.isDeleted).toBe(false);
  });

  it('enforces tenant isolation — Restaurant B cannot see or update Restaurant A expenses', async () => {
    const created = await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    const id = (created as any)._id.toString();

    // B cannot list A's expenses.
    const listB = await expenseService.list(REST_B, {});
    expect(listB.total).toBe(0);
    // B cannot fetch A's expense.
    await expect(expenseService.get(REST_B, id)).rejects.toThrow(/not found/);
    // B cannot update A's expense.
    await expect(expenseService.update(REST_B, id, { amount: 1 })).rejects.toThrow(/not found/);
    // B cannot delete A's expense.
    await expect(expenseService.softDelete(REST_B, id)).rejects.toThrow(/not found/);
    // A still sees it unchanged.
    const inA = await expenseService.get(REST_A, id);
    expect(inA.amount).toBe(2500);
  });

  it('updates an expense and bumps the version', async () => {
    const created = await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    const id = (created as any)._id.toString();

    const updated = await expenseService.update(REST_A, id, { amount: 3000, baseVersion: 1 }, { operator: 'Manager' });
    expect(updated.amount).toBe(3000);
    expect(updated.version).toBe(2);
  });

  it('rejects a stale edit with a 409 conflict (optimistic concurrency)', async () => {
    const created = await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    const id = (created as any)._id.toString();

    await expenseService.update(REST_A, id, { amount: 3000 }, { operator: 'Manager' }); // version → 2
    await expect(
      expenseService.update(REST_A, id, { amount: 9999, baseVersion: 1 }, { operator: 'Manager' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('soft-deletes and restores', async () => {
    const created = await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    const id = (created as any)._id.toString();

    const deleted = await expenseService.softDelete(REST_A, id, { operator: 'Owner', reason: 'wrong entry' });
    expect(deleted.isDeleted).toBe(true);

    // Hidden from normal list.
    const list = await expenseService.list(REST_A, {});
    expect(list.total).toBe(0);
    // Visible with includeDeleted.
    const withDeleted = await expenseService.list(REST_A, { includeDeleted: 'true' });
    expect(withDeleted.total).toBe(1);

    const restored = await expenseService.restore(REST_A, id, { operator: 'Owner' });
    expect(restored?.isDeleted).toBe(false);
    expect(restored?.restoredAt).toBeTruthy();
  });

  it('supports debounced search and pagination', async () => {
    await expenseService.create(REST_A, expensePayload({ description: 'Rent for August', amount: 100 }));
    await expenseService.create(REST_A, expensePayload({ description: 'Salary for staff', amount: 200 }));
    await expenseService.create(REST_A, expensePayload({ description: 'Rent deposit refund', amount: 300 }));

    const searchRent = await expenseService.list(REST_A, { search: 'rent', page: 1, limit: 10 });
    expect(searchRent.total).toBe(2);

    const page1 = await expenseService.list(REST_A, { page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.nextPage).toBe(2);
  });

  it('records a cash-ledger expense entry for cash payments only', async () => {
    // Cash expense → ledger entry.
    const cash = await expenseService.create(REST_A, expensePayload({ paymentMethod: 'Cash', amount: 500 }), { operator: 'Owner' });
    const ledger = await cashLedgerService.history(REST_A, {});
    expect(ledger.total).toBe(1);
    expect(ledger.data[0].type).toBe('expense');
    expect(ledger.data[0].amount).toBe(-500);
    expect(ledger.balance).toBe(-500);

    // Non-cash expense → no ledger entry.
    await expenseService.create(REST_A, expensePayload({ paymentMethod: 'UPI', amount: 900 }), { operator: 'Owner' });
    const after = await cashLedgerService.history(REST_A, {});
    expect(after.total).toBe(1);
    expect(after.balance).toBe(-500);

    // Deleting the cash expense reverses it.
    await expenseService.softDelete(REST_A, (cash as any)._id.toString(), { operator: 'Owner' });
    const reversed = await cashLedgerService.history(REST_A, {});
    expect(reversed.total).toBe(2);
    expect(reversed.data[0].type).toBe('cash_in');
    expect(reversed.balance).toBe(0);
  });

  it('exports CSV with headers', async () => {
    await expenseService.create(REST_A, expensePayload(), { operator: 'Owner' });
    const csv = await expenseService.exportCsv(REST_A, {});
    expect(csv).toContain('Date,Category,Description,Amount');
    expect(csv.split('\n').length).toBe(2); // header + 1 row
  });
});
