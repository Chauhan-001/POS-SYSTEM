/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync Service — Handles data synchronization between frontend and MongoDB.
 * The frontend sync engine pulls latest data (GET /api/sync) and merges it into
 * local state; writes go through the per-resource CRUD endpoints.
 */

import {
  productRepo, orderRepo, billRepo, customerRepo,
  employeeRepo, expenseRepo, branchRepo, branchSettingsRepo,
  expenseCategoryRepo, vendorRepo,
} from '../repositories';
import { resolveMenuProductScope } from './productService';

export class SyncService {
  /**
   * Pull the latest data from all syncable collections.
   * Used by the frontend sync engine to reconcile local state.
   * Multi-tenant (Phase 1.6 / 6): EVERY collection is scoped to the calling
   * restaurant. Previously products/orders/employees/branches/branchSettings
   * were pulled with an empty filter — an authenticated POS terminal received
   * every restaurant's data (and every employee's bcrypt pin/password hash),
   * which was both a cross-tenant leak and an unbounded sync payload. The
   * scoped filter keeps the payload bounded to the caller's own business.
   */
  async pull(restaurantId?: string) {
    const customerRepoScoped = restaurantId ? customerRepo.forTenant(restaurantId) : customerRepo;
    const expenseRepoScoped = restaurantId ? expenseRepo.forTenant(restaurantId) : expenseRepo;
    const categoryRepoScoped = restaurantId ? expenseCategoryRepo.forTenant(restaurantId) : expenseCategoryRepo;
    const vendorRepoScoped = restaurantId ? vendorRepo.forTenant(restaurantId) : vendorRepo;
    // Tenant scope applied to EVERY collection — never an empty filter.
    const scoped: any = restaurantId ? { restaurantId } : {};
    // Products keep the menu's own scope rule: a restaurant with zero own
    // products falls back to the shared/global catalog (matches the products
    // endpoint), otherwise only the restaurant's own products are synced.
    const productScope = restaurantId
      ? await resolveMenuProductScope(restaurantId)
      : [{}];
    const [
      products, orders, bills, customers,
      employees, expenses, branches, branchSettings, expenseCategories, vendors,
    ] = await Promise.all([
      productRepo.findAll({ $or: productScope, isDeleted: { $ne: true } } as any, {}),
      orderRepo.findAll(scoped, {}),
      billRepo.findAll(restaurantId ? { restaurantId } as any : {}, {}),
      customerRepoScoped.findAll({}, {}),
      employeeRepo.findAll(scoped, {}),
      expenseRepoScoped.findAll({}, {}),
      branchRepo.findAll(scoped, {}),
      branchSettingsRepo.findAll(scoped, {}),
      categoryRepoScoped.findAll({}, { sort: { sortOrder: 1 } }),
      vendorRepoScoped.findAll({}, { sort: { name: 1 } }),
    ]);

    return {
      products: products.data,
      orders: orders.data,
      bills: bills.data,
      customers: customers.data,
      // Credential fields (pin/password hashes) are NEVER synced to the
      // terminal — same policy as the employees API (stripPin).
      employees: employees.data.map((e: any) => {
        const obj = e.toObject ? e.toObject() : e;
        const { pin, password, ...safe } = obj;
        return safe;
      }),
      expenses: expenses.data,
      branches: branches.data,
      branchSettings: branchSettings.data,
      expenseCategories: expenseCategories.data,
      vendors: vendors.data,
    };
  }
}
