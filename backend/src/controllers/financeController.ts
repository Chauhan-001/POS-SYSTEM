/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finance Controller — Backend-generated financial engine endpoints (Phase 1.7).
 * Dashboard summary, P&L, cash flow, GST, monthly statement, branch comparison
 * and CSV exports. All tenant-scoped — the frontend never computes final
 * profit numbers.
 */

import { Request, Response } from 'express';
import { financeService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[FinanceController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/finance/settings — finance configuration. */
export async function getFinanceSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await financeService.getSettings(userOf(req)?.restaurantId || '');
    res.json({ data: settings });
  } catch (error) { handleError(res, error, 'getSettings'); }
}

/** PUT /api/finance/settings — update GST / COGS / drawer config. */
export async function updateFinanceSettings(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const settings = await financeService.updateSettings(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.json({ data: settings });
  } catch (error) { handleError(res, error, 'updateSettings'); }
}

/** GET /api/finance/summary?period=today|week|month|year */
export async function getFinanceSummary(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.summary(auth?.restaurantId || '', {
      period: (req.query.period as any) || 'today',
      branchId: req.query.branchId as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'summary'); }
}

/** GET /api/finance/pnl?period=&startDate=&endDate= */
export async function getPnl(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.pnl(auth?.restaurantId || '', {
      period: (req.query.period as any) || 'today',
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'pnl'); }
}

/** GET /api/finance/cashflow?startDate=&endDate= */
export async function getCashFlow(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.cashFlow(auth?.restaurantId || '', {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'cashflow'); }
}

/** GET /api/finance/gst?startDate=&endDate= */
export async function getGstReport(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.gstReport(auth?.restaurantId || '', {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'gst'); }
}

/** GET /api/finance/register?groupBy=&startDate=&endDate= */
export async function getExpenseRegister(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.expenseRegister(auth?.restaurantId || '', {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
      groupBy: (req.query.groupBy as any) || 'category',
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'register'); }
}

/** GET /api/finance/monthly?year= */
export async function getMonthlyStatement(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.monthlyStatement(auth?.restaurantId || '', req.query.year ? Number(req.query.year) : undefined);
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'monthly'); }
}

/** GET /api/finance/branches?startDate=&endDate= — branch comparison. */
export async function getBranchComparison(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.branchComparison(auth?.restaurantId || '', {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'branches'); }
}

/** GET /api/finance/vendor-dues — outstanding across vendors. */
export async function getVendorDues(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await financeService.vendorDues(auth?.restaurantId || '');
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'vendorDues'); }
}

/** GET /api/finance/export/:report?format=csv */
export async function exportFinanceReport(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const report = req.params.report as 'pnl' | 'cashflow' | 'gst' | 'register' | 'monthly';
    const csv = await financeService.exportCsv(auth?.restaurantId || '', report, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
      year: req.query.year,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    res.send(csv);
  } catch (error) { handleError(res, error, 'export'); }
}
