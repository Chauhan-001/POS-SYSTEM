import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recurringExpenseService, expenseService } from '../index';
import RecurringExpense from '../../models/RecurringExpense';
import Expense from '../../models/Expense';
import { AppError } from '../../utils/AppError';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

describe('RecurringExpenseService (Phase 1.7)', () => {
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
      RecurringExpense.deleteMany({}).exec(),
      Expense.deleteMany({}).exec(),
    ]);
  });

  it('requires dayOfWeek for weekly recurrence', async () => {
    await expect(
      recurringExpenseService.create(REST, {
        description: 'Rent', amount: 1000, category: 'Rent & Lease',
        frequency: 'weekly', startDate: '2026-08-01',
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('creates a template and generates a child expense (idempotent)', async () => {
    // Yearly recurrence from a past date → exactly ONE period is due (the next
    // run lands a full year out, so a replay can never double-generate).
    const tpl = await recurringExpenseService.create(REST, {
      description: 'Rent', amount: 1000, category: 'Rent & Lease',
      frequency: 'yearly', startDate: '2026-07-01', dayOfMonth: 1,
    });
    const tplId = (tpl as any)._id.toString();

    const first = await recurringExpenseService.generateDue(REST);
    expect(first.generated).toBe(1);
    expect(first.skipped).toBe(0);

    // The child expense exists, marked system-generated.
    const children = await expenseService.list(REST, {});
    expect(children.total).toBe(1);
    expect(children.data[0].isSystemGenerated).toBe(true);
    expect(children.data[0].date).toBe('2026-07-01');

    // Second run must NOT double-generate.
    const second = await recurringExpenseService.generateDue(REST);
    expect(second.generated).toBe(0);
    const childrenAfter = await expenseService.list(REST, {});
    expect(childrenAfter.total).toBe(1);

    // nextRunDate advanced to next year.
    const updated = await recurringExpenseService.get(REST, tplId);
    expect(updated.nextRunDate).toBe('2027-07-01');
  });

  it('pause/resume freezes and unfreezes generation', async () => {
    const tpl = await recurringExpenseService.create(REST, {
      description: 'Salary', amount: 2000, category: 'Salaries & Wages',
      frequency: 'monthly', startDate: '2026-07-05', dayOfMonth: 5,
    });
    const tplId = (tpl as any)._id.toString();
    await RecurringExpense.updateOne({ _id: tplId }, { $set: { nextRunDate: '2026-07-05' } }).exec();

    await recurringExpenseService.pause(REST, tplId);
    const pausedRun = await recurringExpenseService.generateDue(REST);
    expect(pausedRun.generated).toBe(0);

    await recurringExpenseService.resume(REST, tplId);
    const resumedRun = await recurringExpenseService.generateDue(REST);
    expect(resumedRun.generated).toBe(1);
  });

  it('never generates beyond endDate', async () => {
    const tpl = await recurringExpenseService.create(REST, {
      description: 'Insurance', amount: 500, category: 'Insurance',
      frequency: 'daily', startDate: '2026-07-01', endDate: '2026-07-01',
    });
    const tplId = (tpl as any)._id.toString();
    await RecurringExpense.updateOne({ _id: tplId }, { $set: { nextRunDate: '2026-07-02' } }).exec();

    const run = await recurringExpenseService.generateDue(REST);
    expect(run.generated).toBe(0); // past endDate → skipped
  });
});
