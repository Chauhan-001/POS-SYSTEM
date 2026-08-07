/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminReports.ts — Zod validation for the Admin Reports module (Phase 2.10).
 *
 * Every `/admin/reports/*` route validates params / query / body BEFORE hitting
 * the controller. Schemas follow the strict conventions of the audit module.
 */

import { z } from 'zod';
import { objectId, nonEmptyString, optString } from './common';

const REPORT_PERIODS = ['today', 'yesterday', '7d', '14d', '30d', '90d', 'this_month', 'last_month', 'this_year', 'last_year', 'all'] as const;

/** Shared query params across all report endpoints. */
export const reportQuerySchema = z.object({
  period: z.enum(REPORT_PERIODS).optional(),
  from: z.string().datetime().optional().or(z.literal('').optional()),
  to: z.string().datetime().optional().or(z.literal('').optional()),
}).strict();

export const reportForecastQuerySchema = reportQuerySchema.extend({
  forecastSteps: z.coerce.number().int().min(1).max(36).optional(),
  markup: z.coerce.number().positive().optional(),
}).strict();

export const reportInactiveQuerySchema = reportQuerySchema.extend({
  thresholdDays: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  useSnapshot: z.enum(['true', 'false']).optional(),
}).strict();

/** Export job creation body. */
export const reportExportBodySchema = z.object({
  reportKey: z.enum(['growth', 'revenue', 'subscriptions', 'ai-revenue', 'support', 'devices', 'usage', 'owners', 'inactive', 'features']),
  format: z.enum(['csv', 'json', 'xlsx', 'pdf']),
  query: reportQuerySchema.partial().optional(),
  password: optString,
}).strict();

/** Params for /admin/reports/exports/:id and :id/download */
export const reportExportParamsSchema = z.object({
  id: objectId,
}).strict();

/** Params for /admin/reports/:restaurantId/subscriptions */
export const restaurantSubscriptionParamsSchema = z.object({
  restaurantId: objectId,
}).strict();

export const reportSnapshotBodySchema = z.object({
  kind: z.enum(['growth', 'revenue', 'usage', 'feature', 'subscription', 'ai_revenue']),
}).strict();

export { nonEmptyString };
