/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportQuerySchema — Zod validation for report query params (Phase 1.8).
 */

import { z } from 'zod';

export const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().min(1).optional(),
});

export const paginatedReportSchema = dateRangeSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const reportQuerySchema = dateRangeSchema;

export const productReportQuerySchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const closingQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().min(1).optional(),
});

export const rebuildQuerySchema = dateRangeSchema;

export const exportQuerySchema = dateRangeSchema.extend({
  format: z.enum(['csv', 'xlsx', 'pdf']).optional(),
  report: z.string().min(1),
});
