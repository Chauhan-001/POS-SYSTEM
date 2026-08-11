/**
 * =============================================================================
 *  reports.ts — Reports Module Routes (Phase 1.8)
 * =============================================================================
 *
 * Backend reporting engine. All data is computed server-side via MongoDB
 * aggregation pipelines / materialized summaries — the frontend only renders.
 *
 * Access model:
 *   - Sales / product / inventory / employee reports : all authenticated staff
 *   - Closing (X/Z) + exports                         : Owner / Manager only
 *   - Summary rebuild                                 : Owner / Manager only
 *
 * Path: /api/reports
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { requireFeature } from '../../../middleware/subscriptionMiddleware';
import { validate } from '../../../middleware/validate';
import { cached } from '../../../utils/ResponseCache';
import * as c from '../controllers/reportsController';
import {
  reportQuerySchema, productReportQuerySchema, closingQuerySchema,
  rebuildQuerySchema, exportQuerySchema, inventoryExpiryQuerySchema,
} from '../validators/reportQuerySchema';

const router = Router();

// ─── Sales reports (staff, cached 30s) ───────────────────────────
router.get('/sales/summary', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesSummary);
router.get('/sales/trend', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesTrend);
router.get('/sales/hourly', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesHourly);
router.get('/sales/peak-hours', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesPeakHours);
router.get('/sales/payments', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesPayments);
router.get('/sales/order-types', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesOrderTypes);
router.get('/sales/cashiers', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesCashiers);
router.get('/sales/periods', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesPeriods);
router.get('/sales/top-days', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesTopDays);
router.get('/sales/top-hours', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.salesTopHours);

// ─── Product reports ─────────────────────────────────────────────
router.get('/products/top', requireAuth, requireFeature('analytics'), validate({ query: productReportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productTop);
router.get('/products/least', requireAuth, requireFeature('analytics'), validate({ query: productReportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productLeast);
router.get('/products/revenue', requireAuth, requireFeature('analytics'), validate({ query: productReportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productRevenue);
router.get('/products/categories', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productCategories);
router.get('/products/menu-engineering', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productMenuEngineering);
router.get('/products/abc', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.productAbc);
router.get('/products/inactive', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 60_000, tags: ['reports'] }), c.productInactive);
router.get('/products/deleted', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 60_000, tags: ['reports'] }), c.productDeleted);

// ─── Inventory reports ───────────────────────────────────────────
router.get('/inventory/stock', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryStock);
router.get('/inventory/low-stock', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryLowStock);
router.get('/inventory/valuation', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryValuation);
router.get('/inventory/movement', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryMovement);
router.get('/inventory/aging', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryAging);
router.get('/inventory/reorder', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryReorder);
router.get('/inventory/fast-slow', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryFastSlow);
router.get('/inventory/waste', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryWaste);
router.get('/inventory/expiry', requireAuth, requireFeature('inventory'), validate({ query: inventoryExpiryQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventoryExpiry);
router.get('/inventory/suppliers', requireAuth, requireFeature('inventory'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.inventorySuppliers);

// ─── Employee reports ────────────────────────────────────────────
router.get('/employees/performance', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.employeePerformance);
router.get('/employees/audit-activity', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.employeeAuditActivity);

// ─── Branch consolidated summary (Owner/Manager) ──────────────────
router.get('/branch-summary', requireAuth, requireRole('Owner', 'Manager'), requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.branchSummary);

// ─── Closing (Owner/Manager only) ────────────────────────────────
router.get('/closing/x', requireAuth, requireRole('Owner', 'Manager'), requireFeature('analytics'), validate({ query: closingQuerySchema }), cached({ ttlMs: 15_000, tags: ['reports'] }), c.closingX);
router.get('/closing/z', requireAuth, requireRole('Owner', 'Manager'), requireFeature('analytics'), validate({ query: closingQuerySchema }), cached({ ttlMs: 15_000, tags: ['reports'] }), c.closingZ);

// ─── Materialized summaries ──────────────────────────────────────
router.get('/summaries/daily', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.summariesDaily);
router.get('/summaries/monthly', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.summariesMonthly);
router.get('/summaries/yearly', requireAuth, requireFeature('analytics'), validate({ query: reportQuerySchema }), cached({ ttlMs: 30_000, tags: ['reports'] }), c.summariesYearly);
router.post('/summaries/rebuild', requireAuth, requireRole('Owner', 'Manager'), requireFeature('analytics'), validate({ query: rebuildQuerySchema }), c.summariesRebuild);

// ─── Exports (Owner/Manager only) ────────────────────────────────
router.get('/export', requireAuth, requireRole('Owner', 'Manager'), requireFeature('analytics'), validate({ query: exportQuerySchema }), c.exportReport);

export default router;
