/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminReportsRoutes.ts — Routes for the Admin Reports module (Phase 2.10).
 *
 * Mounts at `/api/admin/reports/*`. Every route is RBAC-protected via
 * `requireAuth` + `requireCollectionAccess` and gated by the shared API
 * rate limiter (mounted upstream in server.ts). Validation is applied per-route
 * through the `validate` middleware.
 */

import { Router } from 'express';
// Admin-dashboard gate: accepts ONLY admin-surface (super_admin) tokens.
import { requireAdminAuth as requireAuth } from '../middleware/authMiddleware';
import { requireCollectionAccess } from '../middleware/authorizationMiddleware';
import type { AuthorizationAction } from '../models/Authorization';
import { cached } from '../utils/ResponseCache';
import { validate } from '../middleware/validate';
import {
  reportQuerySchema,
  reportForecastQuerySchema,
  reportInactiveQuerySchema,
  reportExportBodySchema,
  reportExportParamsSchema,
  restaurantSubscriptionParamsSchema,
  reportSnapshotBodySchema,
} from '../validation/adminReports';
import {
  getReportSummary,
  getGrowthReportEndpoint,
  getRevenueReportEndpoint,
  getSubscriptionReportEndpoint,
  getAiRevenueReportEndpoint,
  getAiUsageMetricsEndpoint,
  getSupportReportEndpoint,
  getDeviceReportEndpoint,
  getUsageReportEndpoint,
  getOwnerReportEndpoint,
  getInactiveReportEndpoint,
  getFeatureReportEndpoint,
  getRestaurantSubscriptionLifecycleEndpoint,
  createReportExport,
  getReportExportStatus,
  downloadReportExport,
  runReportSnapshots,
  listReportSnapshots,
} from '../controllers/adminReportsController';

const router: Router = Router();

// ─── Recommended auth gate helper: every route is protected ────────────────
const R = (collection: string, action: AuthorizationAction) => [requireAuth, requireCollectionAccess(collection, action)];

// ─── Summary + report endpoints ─────────────────────────────────────────────
router.get('/admin/reports/summary', ...R('Restaurant', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getReportSummary);

router.get('/admin/reports/growth', ...R('Restaurant', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getGrowthReportEndpoint);

router.get('/admin/reports/revenue', ...R('Subscription', 'read'), validate({ query: reportForecastQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getRevenueReportEndpoint);

router.get('/admin/reports/subscriptions', ...R('Subscription', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getSubscriptionReportEndpoint);

router.get('/admin/reports/ai-revenue', ...R('Subscription', 'read'), validate({ query: reportForecastQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getAiRevenueReportEndpoint);

router.get('/admin/reports/ai-usage-metrics', ...R('Subscription', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 60_000, tags: ['admin-reports'] }), getAiUsageMetricsEndpoint);

router.get('/admin/reports/support', ...R('SupportTicket', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getSupportReportEndpoint);

router.get('/admin/reports/devices', ...R('Device', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getDeviceReportEndpoint);

router.get('/admin/reports/usage', ...R('AuditLog', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getUsageReportEndpoint);

router.get('/admin/reports/owners', ...R('User', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getOwnerReportEndpoint);

router.get('/admin/reports/inactive', ...R('Restaurant', 'read'), validate({ query: reportInactiveQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getInactiveReportEndpoint);

router.get('/admin/reports/features', ...R('Restaurant', 'read'), validate({ query: reportQuerySchema }), cached({ ttlMs: 120_000, tags: ['admin-reports'] }), getFeatureReportEndpoint);

router.get('/admin/reports/:restaurantId/subscriptions', ...R('Subscription', 'read'), validate({ params: restaurantSubscriptionParamsSchema }), getRestaurantSubscriptionLifecycleEndpoint);

// ─── Exports ────────────────────────────────────────────────────────────────
router.post('/admin/reports/exports', ...R('Subscription', 'create'), validate({ body: reportExportBodySchema }), createReportExport);

router.get('/admin/reports/exports/:id', ...R('Subscription', 'read'), validate({ params: reportExportParamsSchema }), getReportExportStatus);

router.get('/admin/reports/exports/:id/download', ...R('Subscription', 'read'), validate({ params: reportExportParamsSchema }), downloadReportExport);

// ─── Snapshots ──────────────────────────────────────────────────────────────
router.get('/admin/reports/snapshots', ...R('Restaurant', 'read'), listReportSnapshots);

router.post('/admin/reports/snapshots/run', ...R('Subscription', 'update'), validate({ body: reportSnapshotBodySchema }), runReportSnapshots);

export default router;