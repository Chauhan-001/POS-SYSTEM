/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExpenseCategory Service — Configurable expense categories (Phase 1.7).
 * System categories are seeded per restaurant on first access; merchants can
 * create custom categories, reorder, set icons/colors, and toggle enable.
 * All operations are tenant-scoped.
 */

import mongoose from 'mongoose';
import { expenseCategoryRepo, auditLogRepo } from '../repositories';
import Expense from '../models/Expense';
import { AppError } from '../utils/AppError';

export interface SystemCategoryDef {
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isCogs: boolean;
}

/** The 13 legacy enum categories, seeded as system categories (with COGS flag). */
export const SYSTEM_CATEGORIES: SystemCategoryDef[] = [
  { name: 'Ingredients & Raw Materials', icon: '🥬', color: '#16a34a', sortOrder: 10, isCogs: true },
  { name: 'Salaries & Wages', icon: '👥', color: '#0ea5e9', sortOrder: 20, isCogs: false },
  { name: 'Utilities', icon: '⚡', color: '#f59e0b', sortOrder: 30, isCogs: false },
  { name: 'Rent & Lease', icon: '🏢', color: '#8b5cf6', sortOrder: 40, isCogs: false },
  { name: 'Equipment & Maintenance', icon: '🔧', color: '#64748b', sortOrder: 50, isCogs: false },
  { name: 'Marketing & Advertising', icon: '📣', color: '#ec4899', sortOrder: 60, isCogs: false },
  { name: 'Delivery & Logistics', icon: '🛵', color: '#ef4444', sortOrder: 70, isCogs: false },
  { name: 'Cleaning & Supplies', icon: '🧽', color: '#14b8a6', sortOrder: 80, isCogs: false },
  { name: 'Licenses & Permits', icon: '📄', color: '#6366f1', sortOrder: 90, isCogs: false },
  { name: 'Taxes & Fees', icon: '🏛️', color: '#b45309', sortOrder: 100, isCogs: false },
  { name: 'Insurance', icon: '🛡️', color: '#0d9488', sortOrder: 110, isCogs: false },
  { name: 'Technology & Software', icon: '💻', color: '#2563eb', sortOrder: 120, isCogs: false },
  { name: 'Miscellaneous', icon: '📋', color: '#6b7280', sortOrder: 130, isCogs: false },
];

export class ExpenseCategoryService {
  /** Ensure system categories exist for a restaurant (idempotent seed). */
  async ensureSystemCategories(restaurantId: string) {
    const repo = expenseCategoryRepo.forTenant(restaurantId);
    const existing = await repo.findAll({}, {});
    const existingNames = new Set(existing.data.map((c: any) => c.name));

    const missing = SYSTEM_CATEGORIES.filter((c) => !existingNames.has(c.name));
    if (missing.length > 0) {
      await repo.bulkCreate(
        missing.map((c) => ({
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          ...c,
          isSystem: true,
          isActive: true,
        })) as any
      );
    }
    return repo.findAll({}, { sort: { sortOrder: 1 } }).then((r) => r.data.map((c: any) => c.toObject()));
  }

  /** List categories (system + custom), tenant-scoped. */
  async list(restaurantId: string, includeInactive = false) {
    await this.ensureSystemCategories(restaurantId);
    const query: any = includeInactive ? {} : { isActive: true };
    const result = await expenseCategoryRepo.forTenant(restaurantId).findAll(query, { sort: { sortOrder: 1 } });
    return result.data.map((c: any) => c.toObject());
  }

  /** Create a custom category. */
  async create(restaurantId: string, data: any, ctx: { operator?: string } = {}) {
    const repo = expenseCategoryRepo.forTenant(restaurantId);
    const dup = await repo.findOne({ name: data.name } as any);
    if (dup) throw new AppError(400, `Category "${data.name}" already exists`);

    const category = await repo.create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      ...data,
      isSystem: false,
      isActive: data.isActive ?? true,
      createdBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: 'EXPENSE_CATEGORY_CREATED',
      entityType: 'expense_category',
      entityId: (category as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { name: data.name },
    } as any);
    return category.toObject();
  }

  /** Update a category (name/icon/color/order/active/cogs). */
  async update(restaurantId: string, id: string, data: any, ctx: { operator?: string } = {}) {
    const category = await expenseCategoryRepo.forTenant(restaurantId).update(id, { ...data, updatedBy: ctx.operator } as any);
    if (!category) throw new AppError(404, 'Expense category not found');
    await auditLogRepo.create({
      action: 'EXPENSE_CATEGORY_UPDATED',
      entityType: 'expense_category',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: data,
    } as any);
    return category.toObject();
  }

  /**
   * Soft-delete a category. System categories and categories already used by
   * expenses cannot be deleted (they'd orphan historical reports).
   */
  async delete(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const repo = expenseCategoryRepo.forTenant(restaurantId);
    const category = await repo.findOne({ _id: id as any } as any);
    if (!category) throw new AppError(404, 'Expense category not found');
    if ((category as any).isSystem) throw new AppError(400, 'System categories cannot be deleted');

    const used = await Expense.exists({ restaurantId: new mongoose.Types.ObjectId(restaurantId), categoryId: id as any });
    if (used) throw new AppError(400, 'Category is used by expenses and cannot be deleted');

    await repo.softDelete(id);
    await auditLogRepo.create({
      action: 'EXPENSE_CATEGORY_DELETED',
      entityType: 'expense_category',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return true;
  }
}
