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

export class SyncService {
  /**
   * Pull the latest data from all syncable collections.
   * Used by the frontend sync engine to reconcile local state.
   * Multi-tenant (Phase 1.6): customers and bills are scoped to the calling
   * restaurant so Restaurant A never syncs Restaurant B's profiles/ledger.
   */
  async pull(restaurantId?: string) {
    const customerRepoScoped = restaurantId ? customerRepo.forTenant(restaurantId) : customerRepo;
    const expenseRepoScoped = restaurantId ? expenseRepo.forTenant(restaurantId) : expenseRepo;
    const categoryRepoScoped = restaurantId ? expenseCategoryRepo.forTenant(restaurantId) : expenseCategoryRepo;
    const vendorRepoScoped = restaurantId ? vendorRepo.forTenant(restaurantId) : vendorRepo;
    const [
      products, orders, bills, customers,
      employees, expenses, branches, branchSettings, expenseCategories, vendors,
    ] = await Promise.all([
      productRepo.findAll({}, {}),
      orderRepo.findAll({}, {}),
      billRepo.findAll(restaurantId ? { restaurantId } as any : {}, {}),
      customerRepoScoped.findAll({}, {}),
      employeeRepo.findAll({}, {}),
      expenseRepoScoped.findAll({}, {}),
      branchRepo.findAll({}, {}),
      branchSettingsRepo.findAll({}, {}),
      categoryRepoScoped.findAll({}, { sort: { sortOrder: 1 } }),
      vendorRepoScoped.findAll({}, { sort: { name: 1 } }),
    ]);

    return {
      products: products.data,
      orders: orders.data,
      bills: bills.data,
      customers: customers.data,
      employees: employees.data,
      expenses: expenses.data,
      branches: branches.data,
      branchSettings: branchSettings.data,
      expenseCategories: expenseCategories.data,
      vendors: vendors.data,
    };
  }
}
