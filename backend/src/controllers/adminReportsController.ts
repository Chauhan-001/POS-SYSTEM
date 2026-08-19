/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminReportsController.ts — Platform & restaurant-scoped reports.
 *
 * Two families of endpoints live here:
 *
 *  A. Restaurant-scoped reports (delegates to the Phase 1.8 reports module):
 *     GET /admin/restaurants/:id/reports/sales-summary|sales-trend|...  etc.
 *
 *  B. Platform-wide Admin Reports (Phase 2.10):
 *     GET /admin/reports/summary|growth|revenue|subscriptions|ai-revenue|
 *         support|devices|usage|owners|inactive|features
 *     GET /admin/reports/:restaurantId/subscriptions
 *     POST /admin/reports/exports
 *     GET  /admin/reports/exports/:id
 *     GET  /admin/reports/exports/:id/download
 *     GET  /admin/reports/snapshots
 *     POST /admin/reports/snapshots/run
 *
 * Controllers are thin: they map validated input to services and wrap responses
 * through the standard apiResponse helpers.
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { ok, okWithMeta, fail } from '../utils/apiResponse';
import {
  salesReportService,
  summaryService,
  productReportService,
  inventoryReportService,
  employeeReportService,
  closingReportService,
} from '../modules/reports/services';
import { adminReportingService } from '../modules/adminReports/adminReportingService';
import { createExportJob, getJobStatus, resolveJobFile } from '../modules/adminReports/exporters/reportExportService';
import { ReportExportJob } from '../modules/adminReports/models';
import { runNightlySnapshots, runInactiveSnapshotJob } from '../modules/adminReports/jobs/reportJobs';
import { buildWindow } from '../modules/adminReports/reportQueryBuilder';
import { getRestaurantSubscriptionLifecycle } from '../modules/adminReports/aggregations/subscriptions';

// ═══════════════════════════════════════════════════════════════════════════
// A. Restaurant-scoped sales / product / inventory / employee / Z reports
// ═══════════════════════════════════════════════════════════════════════════

function reportScope(req: Request) {
  return {
    restaurantId: req.params.id,
    branchId: (req.query.branchId as string) || undefined,
    startDate: (req.query.startDate as string) || undefined,
    endDate: (req.query.endDate as string) || undefined,
  };
}

function handleReportError(res: Response, error: unknown, label: string): void {
  console.error(`[AdminReports:${label}] error:`, error);
  res.status(500).json({ message: 'Internal server error' });
}

/** GET /admin/restaurants/:id/reports/sales-summary */
export async function getAdminSalesSummary(req: Request, res: Response): Promise<void> {
  try {
    const result = await salesReportService.summary(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'sales-summary'); }
}

/** GET /admin/restaurants/:id/reports/sales-trend */
export async function getAdminSalesTrend(req: Request, res: Response): Promise<void> {
  try {
    const result = await salesReportService.trend(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'sales-trend'); }
}

/** GET /admin/restaurants/:id/reports/sales-payments */
export async function getAdminSalesPayments(req: Request, res: Response): Promise<void> {
  try {
    const result = await salesReportService.payments(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'sales-payments'); }
}

/** GET /admin/restaurants/:id/reports/sales-order-types */
export async function getAdminSalesOrderTypes(req: Request, res: Response): Promise<void> {
  try {
    const result = await salesReportService.orderTypes(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'sales-order-types'); }
}

/** GET /admin/restaurants/:id/reports/sales-cashiers */
export async function getAdminSalesCashiers(req: Request, res: Response): Promise<void> {
  try {
    const result = await salesReportService.cashiers(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'sales-cashiers'); }
}

/** GET /admin/restaurants/:id/reports/products-top */
export async function getAdminProductTop(req: Request, res: Response): Promise<void> {
  try {
    const result = await productReportService.top(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'products-top'); }
}

/** GET /admin/restaurants/:id/reports/products-categories */
export async function getAdminProductCategories(req: Request, res: Response): Promise<void> {
  try {
    const result = await productReportService.categories(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'products-categories'); }
}

/** GET /admin/restaurants/:id/reports/products-abc */
export async function getAdminProductAbc(req: Request, res: Response): Promise<void> {
  try {
    const result = await productReportService.abc(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'products-abc'); }
}

/** GET /admin/restaurants/:id/reports/inventory-stock */
export async function getAdminInventoryStock(req: Request, res: Response): Promise<void> {
  try {
    const result = await inventoryReportService.stock(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'inventory-stock'); }
}

/** GET /admin/restaurants/:id/reports/inventory-valuation */
export async function getAdminInventoryValuation(req: Request, res: Response): Promise<void> {
  try {
    const result = await inventoryReportService.valuation(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'inventory-valuation'); }
}

/** GET /admin/restaurants/:id/reports/employees-performance */
export async function getAdminEmployeePerformance(req: Request, res: Response): Promise<void> {
  try {
    const result = await employeeReportService.performance(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'employees-performance'); }
}

/** GET /admin/restaurants/:id/reports/closing-z */
export async function getAdminClosingZ(req: Request, res: Response): Promise<void> {
  try {
    const result = await closingReportService.zReport(reportScope(req), (req.query.date as string) || undefined);
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'closing-z'); }
}

/** GET /admin/restaurants/:id/reports/summaries-monthly */
export async function getAdminSummariesMonthly(req: Request, res: Response): Promise<void> {
  try {
    const result = await summaryService.monthly(reportScope(req));
    res.json({ data: result });
  } catch (error) { handleReportError(res, error, 'summaries-monthly'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// B. Platform-wide Admin Reports (Phase 2.10)
// ═══════════════════════════════════════════════════════════════════════════

function actorFrom(req: AuthenticatedRequest): { id?: string; name: string } {
  const user = req.user as any;
  return { id: user?.userId || user?.id, name: user?.name || user?.userId || 'System' };
}

function windowMeta(req: any): Record<string, unknown> {
  const q = req.query ?? {};
  const w = buildWindow({ period: q.period, from: q.from, to: q.to });
  return { period: w.period, from: w.from.toISOString(), to: w.to.toISOString() };
}

export async function getReportSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.summary({ period: q.period, from: q.from, to: q.to });
    res.json(ok(data));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load report summary', error?.statusCode));
  }
}

export async function getGrowthReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.growth({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load growth report', error?.statusCode));
  }
}

export async function getRevenueReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.revenue({ period: q.period, from: q.from, to: q.to, forecastSteps: q.forecastSteps });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load revenue report', error?.statusCode));
  }
}

export async function getSubscriptionReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.subscriptions({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load subscription report', error?.statusCode));
  }
}

export async function getAiRevenueReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.aiRevenue({ period: q.period, from: q.from, to: q.to, markup: q.markup });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load AI revenue report', error?.statusCode));
  }
}

export async function getAiUsageMetricsEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.aiUsageMetrics({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load AI usage metrics', error?.statusCode));
  }
}

export async function getSupportReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.support({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load support report', error?.statusCode));
  }
}

export async function getDeviceReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.devices({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load device report', error?.statusCode));
  }
}

export async function getUsageReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.usage({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load usage report', error?.statusCode));
  }
}

export async function getOwnerReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.owners({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load owner report', error?.statusCode));
  }
}

export async function getInactiveReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.inactive({
      period: q.period, from: q.from, to: q.to,
      thresholdDays: q.thresholdDays, limit: q.limit, useSnapshot: q.useSnapshot === 'true',
    });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load inactive report', error?.statusCode));
  }
}

export async function getFeatureReportEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as any;
    const data = await adminReportingService.features({ period: q.period, from: q.from, to: q.to });
    res.json(okWithMeta(data, windowMeta(req)));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load feature report', error?.statusCode));
  }
}

export async function getRestaurantSubscriptionLifecycleEndpoint(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const restaurantId = (req.params as any).restaurantId;
    const data = await getRestaurantSubscriptionLifecycle(restaurantId);
    res.json(ok(data));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load subscription lifecycle', error?.statusCode));
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export async function createReportExport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as any;
    const actor = actorFrom(req);
    const job = await createExportJob({
      reportKey: body.reportKey,
      format: body.format,
      query: { ...(body.query ?? {}), password: body.password },
      requestedBy: actor.name,
      requestedById: actor.id,
    });
    res.status(201).json(ok(await getJobStatus(String(job._id))));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to create export job', error?.statusCode));
  }
}

export async function getReportExportStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const job = await getJobStatus((req.params as any).id);
    if (!job) {
      res.status(404).json(fail('Export job not found'));
      return;
    }
    res.json(ok(job));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to load export job', error?.statusCode));
  }
}

export async function downloadReportExport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const job = await ReportExportJob.findById((req.params as any).id).lean().exec();
    if (!job) {
      res.status(404).json(fail('Export job not found'));
      return;
    }
    if (job.status !== 'completed') {
      res.status(409).json(fail('Export job is not complete yet'));
      return;
    }
    const { buffer, fileName } = resolveJobFile(job as any);
    const ext = fileName.split('.').pop() ?? 'csv';
    const mime: Record<string, string> = {
      csv: 'text/csv',
      json: 'application/json',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
      'csv.enc': 'application/octet-stream',
      'json.enc': 'application/octet-stream',
      'xlsx.enc': 'application/octet-stream',
      'pdf.enc': 'application/octet-stream',
    };
    res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to download export', error?.statusCode));
  }
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

export async function runReportSnapshots(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const nightly = await runNightlySnapshots();
    await runInactiveSnapshotJob();
    res.json(ok({ nightly, inactive: true, at: new Date().toISOString() }));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to run snapshots', error?.statusCode));
  }
}

export async function listReportSnapshots(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { ReportSnapshot } = await import('../modules/adminReports/models');
    const rows = await ReportSnapshot.find({})
      .sort({ snapshotDate: -1 })
      .limit(100)
      .select('kind period snapshotDate _id')
      .lean();
    res.json(ok(rows.map((r: any) => ({
      id: String(r._id),
      kind: r.kind,
      period: r.period,
      snapshotDate: r.snapshotDate,
    }))));
  } catch (error: any) {
    res.status(error?.statusCode || 500).json(fail(error?.message || 'Failed to list snapshots', error?.statusCode));
  }
}