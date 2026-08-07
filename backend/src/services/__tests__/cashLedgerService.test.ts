import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { cashLedgerService } from '../index';
import CashLedger from '../../models/CashLedger';
import { AppError } from '../../utils/AppError';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

describe('CashLedgerService (Phase 1.7)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await CashLedger.deleteMany({}).exec();
  });

  it('records opening cash once per day', async () => {
    const opening = await cashLedgerService.openCash(REST, { amount: 5000, performedBy: 'Owner' });
    expect(opening.type).toBe('opening');
    expect(opening.balanceAfter).toBe(5000);
    await expect(cashLedgerService.openCash(REST, { amount: 5000 })).rejects.toThrow(/already recorded/);
  });

  it('tracks cash in/out with running balance', async () => {
    await cashLedgerService.openCash(REST, { amount: 5000 });
    await cashLedgerService.addEntry(REST, { type: 'cash_in', amount: 2000, note: 'bill payment' });
    await cashLedgerService.addEntry(REST, { type: 'cash_out', amount: 1000, note: 'petty cash' });
    expect(await cashLedgerService.getBalance(REST)).toBe(6000);
  });

  it('prevents cash going negative on a withdrawal', async () => {
    await cashLedgerService.openCash(REST, { amount: 100 });
    await expect(
      cashLedgerService.addEntry(REST, { type: 'cash_out', amount: 500 })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('closes a shift and computes over/short', async () => {
    await cashLedgerService.openCash(REST, { amount: 1000 });
    await cashLedgerService.recordExpense(REST, { expenseId: 'e1', amount: 300, note: 'cleaning' });
    // Expected: 700. Counted: 750 → +50 over.
    const closed = await cashLedgerService.closeShift(REST, { countedCash: 750, performedBy: 'Owner' });
    expect(closed.expectedCash).toBe(700);
    expect(closed.overShort).toBe(50);
    expect(closed.countedCash).toBe(750);

    // Cannot close twice for the same day.
    await expect(cashLedgerService.closeShift(REST, { countedCash: 750 })).rejects.toThrow(/already closed/);
  });

  it('computes daily cash totals for cash-flow reports', async () => {
    await cashLedgerService.openCash(REST, { amount: 1000, date: '2026-08-01' });
    await cashLedgerService.recordExpense(REST, { expenseId: 'e1', amount: 400, date: '2026-08-01' });
    await cashLedgerService.addEntry(REST, { type: 'cash_in', amount: 900, date: '2026-08-01' });
    await cashLedgerService.addEntry(REST, { type: 'bank_deposit', amount: 500, date: '2026-08-02' });

    const totals = await cashLedgerService.dailyTotals(REST, undefined, '2026-08-01', '2026-08-02');
    expect(totals.length).toBe(2);
    const day1 = totals.find((t: any) => t._id === '2026-08-01');
    expect(day1.opening).toBe(1000);
    expect(day1.cashIn).toBe(900);
    expect(day1.cashOut).toBe(400); // expense
    expect(day1.expenses).toBe(400);
  });

  it('scopes the ledger per tenant', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await cashLedgerService.openCash(REST, { amount: 5000 });
    expect(await cashLedgerService.getBalance(other)).toBe(0);
  });
});
