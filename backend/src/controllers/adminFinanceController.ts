/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin Finance Controller — Platform-console visibility into a restaurant's
 * finance data (Phase 1.7). READ-ONLY, admin-authenticated, delegates to the
 * same Phase 1.7 services the POS uses with the target restaurantId from the
 * URL — so the platform console sees exactly what the restaurant sees.
 */

import { Request, Response } from 'express';
import {
  financeService, expenseService, vendorService, recurringExpenseService,
  cashLedgerService, expenseCategoryService,
} from '../services';

function handleError(res: Response, error: unknown, label: string): void {
  console.error(`[AdminFinance] ${label} error:`, error);
  res.status(500).json({ message: 'Internal server error' });
}

/** GET /api/admin/restaurants/:id/finance/overview — dashboard bundle. */
export async function getFinanceOverview(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const [summary, monthly, vendorDues, drawer, settings] = await Promise.all([
      financeService.summary(restaurantId, { period: 'month' }),
      financeService.monthlyStatement(restaurantId),
      financeService.vendorDues(restaurantId),
      financeService.drawerBalance(restaurantId),
      financeService.getSettings(restaurantId),
    ]);
    res.json({ data: { summary, monthly, vendorDues, drawerBalance: drawer, settings } });
  } catch (error) { handleError(res, error, 'overview'); }
}

/** GET /api/admin/restaurants/:id/finance/pnl */
export async function getFinancePnl(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.pnl(req.params.id, {
      period: (req.query.period as any) || 'month',
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'pnl'); }
}

/** GET /api/admin/restaurants/:id/finance/expenses */
export async function getFinanceExpenses(req: Request, res: Response): Promise<void> {
  try {
    const result = await expenseService.list(req.params.id, {
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      category: req.query.category as string,
      search: req.query.search as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'expenses'); }
}

/** GET /api/admin/restaurants/:id/finance/expense-register */
export async function getFinanceExpenseRegister(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.expenseRegister(req.params.id, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      groupBy: (req.query.groupBy as any) || 'category',
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'register'); }
}

/** GET /api/admin/restaurants/:id/finance/cashflow */
export async function getFinanceCashFlow(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.cashFlow(req.params.id, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'cashflow'); }
}

/** GET /api/admin/restaurants/:id/finance/cash-ledger */
export async function getFinanceCashLedger(req: Request, res: Response): Promise<void> {
  try {
    const result = await cashLedgerService.history(req.params.id, {
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'cashLedger'); }
}

/** GET /api/admin/restaurants/:id/finance/gst */
export async function getFinanceGst(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.gstReport(req.params.id, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'gst'); }
}

/** GET /api/admin/restaurants/:id/finance/vendors */
export async function getFinanceVendors(req: Request, res: Response): Promise<void> {
  try {
    const result = await vendorService.list(req.params.id, {
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      search: req.query.search as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'vendors'); }
}

/** GET /api/admin/restaurants/:id/finance/recurring */
export async function getFinanceRecurring(req: Request, res: Response): Promise<void> {
  try {
    const result = await recurringExpenseService.list(req.params.id, {
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'recurring'); }
}

/** GET /api/admin/restaurants/:id/finance/categories */
export async function getFinanceCategories(req: Request, res: Response): Promise<void> {
  try {
    const result = await expenseCategoryService.list(req.params.id);
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'categories'); }
}

/** GET /api/admin/restaurants/:id/finance/monthly */
export async function getFinanceMonthly(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.monthlyStatement(req.params.id, req.query.year ? Number(req.query.year) : undefined);
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'monthly'); }
}

/** GET /api/admin/restaurants/:id/finance/branches */
export async function getFinanceBranches(req: Request, res: Response): Promise<void> {
  try {
    const result = await financeService.branchComparison(req.params.id, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'branches'); }
}
