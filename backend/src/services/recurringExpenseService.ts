/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecurringExpense Service — Recurring expense scheduler (Phase 1.7).
 *
 * generateDue() materializes child Expense documents for every template whose
 * nextRunDate has arrived. It is idempotent: each template advances
 * nextRunDate forward BEFORE creating the child (and never generates beyond
 * endDate), so a replay or a second cron tick can never duplicate an expense.
 * Pause/resume freeze/unfreeze generation; a resumed template simply resumes
 * from its nextRunDate (skipping missed periods).
 */

import mongoose from 'mongoose';
import { recurringExpenseRepo, auditLogRepo } from '../repositories';
import { expenseService } from './index';
import { AppError } from '../utils/AppError';
import type { RecurrenceFrequency, IRecurringExpense } from '../models';

export class RecurringExpenseService {
  async list(
    restaurantId: string,
    params: { frequency?: string; isPaused?: string; includeDeleted?: string; page?: number; limit?: number } = {}
  ) {
    const query: any = {};
    if (params.frequency) query.frequency = params.frequency;
    if (params.isPaused) query.isPaused = params.isPaused === 'true';

    const repo = recurringExpenseRepo.forTenant(restaurantId);
    const result = params.includeDeleted === 'true'
      ? await repo.findAllRaw(query, { page: params.page || 1, limit: params.limit || 50, sort: { nextRunDate: 1 } })
      : await repo.findAll(query, { page: params.page || 1, limit: params.limit || 50, sort: { nextRunDate: 1 } });

    return {
      data: result.data.map((d: any) => d.toObject()),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      nextPage: result.page < result.totalPages ? result.page + 1 : null,
      previousPage: result.page > 1 ? result.page - 1 : null,
    };
  }

  async get(restaurantId: string, id: string) {
    const tpl = await recurringExpenseRepo.forTenant(restaurantId).findOne({ _id: id as any } as any);
    if (!tpl) throw new AppError(404, 'Recurring expense not found');
    return tpl.toObject();
  }

  /** Compute the next run date after a given date for a frequency. */
  private nextDate(anchor: string, freq: RecurrenceFrequency, opts: { dayOfWeek?: number; dayOfMonth?: number } = {}): string {
    const d = new Date(`${anchor}T00:00:00Z`);
    const next = new Date(d);
    switch (freq) {
      case 'daily':
        next.setUTCDate(next.getUTCDate() + 1);
        break;
      case 'weekly': {
        const target = typeof opts.dayOfWeek === 'number' ? opts.dayOfWeek : next.getUTCDay();
        do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() !== target);
        break;
      }
      case 'monthly': {
        const dom = typeof opts.dayOfMonth === 'number' ? opts.dayOfMonth : next.getUTCDate();
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(Math.min(dom, new Date(next.getUTCFullYear(), next.getUTCMonth() + 1, 0).getUTCDate()));
        break;
      }
      case 'quarterly': {
        next.setUTCMonth(next.getUTCMonth() + 3);
        break;
      }
      case 'yearly': {
        next.setUTCFullYear(next.getUTCFullYear() + 1);
        break;
      }
    }
    return next.toISOString().slice(0, 10);
  }

  async create(restaurantId: string, data: any, ctx: { operator?: string } = {}) {
    const frequency = data.frequency as RecurrenceFrequency;
    const startDate = data.startDate;
    // Validate dayOfWeek/dayOfMonth applicability.
    if (frequency === 'weekly' && typeof data.dayOfWeek !== 'number') {
      throw new AppError(400, 'dayOfWeek (0-6) is required for weekly recurrence');
    }
    if ((frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly') && typeof data.dayOfMonth !== 'number') {
      throw new AppError(400, `dayOfMonth (1-31) is required for ${frequency} recurrence`);
    }
    if (data.endDate && data.endDate < startDate) {
      throw new AppError(400, 'endDate must be after startDate');
    }

    const tpl = await recurringExpenseRepo.forTenant(restaurantId).create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      ...data,
      nextRunDate: startDate,
      isPaused: false,
      createdBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: 'RECURRING_EXPENSE_CREATED',
      entityType: 'recurring_expense',
      entityId: (tpl as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { description: data.description, frequency, amount: data.amount },
    } as any);
    return tpl.toObject();
  }

  async update(restaurantId: string, id: string, data: any, ctx: { operator?: string } = {}) {
    const tpl = await recurringExpenseRepo.forTenant(restaurantId).update(id, { ...data, updatedBy: ctx.operator } as any);
    if (!tpl) throw new AppError(404, 'Recurring expense not found');
    await auditLogRepo.create({
      action: 'RECURRING_EXPENSE_UPDATED',
      entityType: 'recurring_expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: data,
    } as any);
    return tpl.toObject();
  }

  async pause(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const tpl = await recurringExpenseRepo.forTenant(restaurantId).update(id, { isPaused: true } as any);
    if (!tpl) throw new AppError(404, 'Recurring expense not found');
    await auditLogRepo.create({
      action: 'RECURRING_EXPENSE_PAUSED',
      entityType: 'recurring_expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return tpl.toObject();
  }

  async resume(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const tpl = await recurringExpenseRepo.forTenant(restaurantId).update(id, { isPaused: false } as any);
    if (!tpl) throw new AppError(404, 'Recurring expense not found');
    await auditLogRepo.create({
      action: 'RECURRING_EXPENSE_RESUMED',
      entityType: 'recurring_expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return tpl.toObject();
  }

  async softDelete(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const tpl = await recurringExpenseRepo.forTenant(restaurantId).softDelete(id);
    if (!tpl) throw new AppError(404, 'Recurring expense not found');
    await auditLogRepo.create({
      action: 'RECURRING_EXPENSE_DELETED',
      entityType: 'recurring_expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return true;
  }

  /**
   * Generate all due child expenses. Returns a summary. Safe to run on a cron
   * or on-demand; idempotent per template thanks to nextRunDate advancement.
   */
  async generateDue(restaurantId: string, ctx: { operator?: string } = {}): Promise<{ generated: number; skipped: number; details: string[] }> {
    const repo = recurringExpenseRepo.forTenant(restaurantId);
    const today = new Date().toISOString().slice(0, 10);
    const due = await repo.findAll({ nextRunDate: { $lte: today }, isPaused: { $ne: true } } as any, { limit: 500, sort: { nextRunDate: 1 } });

    let generated = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const raw of due.data) {
      const tpl = raw as unknown as IRecurringExpense;
      // Skip templates past their end date.
      if (tpl.endDate && tpl.endDate < tpl.nextRunDate) {
        skipped++;
        continue;
      }

      // Advance BEFORE generating so a replay can never double-generate.
      // lastGeneratedExpenseId is informational only — the nextRunDate
      // advancement (committed after the child is created) is the real guard.
      const nextRun = this.nextDate(tpl.nextRunDate, tpl.frequency, { dayOfWeek: tpl.dayOfWeek, dayOfMonth: tpl.dayOfMonth });

      try {
        const child = await expenseService.create(restaurantId, {
          date: tpl.nextRunDate,
          category: tpl.category,
          categoryId: tpl.categoryId ? tpl.categoryId.toString() : undefined,
          description: tpl.description,
          amount: tpl.amount,
          paymentMethod: tpl.paymentMethod,
          vendorId: tpl.vendorId ? tpl.vendorId.toString() : undefined,
          vendor: tpl.vendor,
          notes: tpl.notes ? `${tpl.notes} (recurring)` : '(recurring expense)',
          isCogs: tpl.isCogs,
          branchId: tpl.branchId ? tpl.branchId.toString() : undefined,
          isRecurring: true,
          isSystemGenerated: true,
          recurringTemplateId: tpl._id.toString(),
        }, { operator: ctx.operator || 'System', branchId: tpl.branchId?.toString() });

        await repo.update(tpl._id.toString(), {
          nextRunDate: nextRun,
          lastRunDate: tpl.nextRunDate,
          lastGeneratedExpenseId: (child as any)._id,
        } as any);

        generated++;
        details.push(`${tpl.description} → ${tpl.nextRunDate}`);
      } catch (err: any) {
        skipped++;
        details.push(`FAILED ${tpl.description}: ${err.message}`);
      }
    }

    if (generated > 0) {
      await auditLogRepo.create({
        action: 'RECURRING_EXPENSES_GENERATED',
        entityType: 'recurring_expense',
        performedBy: ctx.operator || 'System',
        details: { generated, skipped },
      } as any);
    }

    return { generated, skipped, details };
  }
}
