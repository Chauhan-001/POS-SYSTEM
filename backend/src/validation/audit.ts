/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * audit.ts — Zod validation for the enterprise audit log admin module.
 * Mirrors the admin-module strict-schema conventions (no unknown keys).
 */

import { z } from 'zod';
import { optString, objectId } from './common';
import { allCategories } from '../modules/audit';

const categories = allCategories();

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(512).optional(),
  search: optString,
  action: z.string().max(500).optional(),
  actionContains: optString,
  module: z.string().max(256).optional(),
  category: z.enum(categories).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  result: z.enum(['success', 'failure', 'pending']).optional(),
  performedBy: optString,
  performedById: optString,
  role: optString,
  restaurantId: optString,
  branchId: optString,
  restaurantName: optString,
  entityType: z.string().max(100).optional(),
  entityId: optString,
  ipAddress: optString,
  deviceId: optString,
  sessionId: optString,
  requestId: optString,
  correlationId: optString,
  startDate: optString,
  endDate: optString,
  from: optString,
  to: optString,
  sortBy: z.enum([
    'createdAt', 'action', 'severity', 'module', 'category', 'result',
    'performedBy', 'performedById', 'restaurantId', 'branchId', 'role',
    'durationMs', 'executionTimeMs',
  ]).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  includeStack: z.coerce.boolean().optional(),
}).strict();

export const auditDetailParamsSchema = z.object({ id: objectId }).strict();

export const auditExportBodySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx', 'pdf']).default('csv'),
  search: optString,
  action: optString,
  module: optString,
  category: z.enum(categories).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  result: z.enum(['success', 'failure', 'pending']).optional(),
  performedBy: optString,
  restaurantId: optString,
  entityType: optString,
  from: optString,
  to: optString,
  password: z.string().max(200).optional(),
}).strict();

export const auditIntegrityQuerySchema = z.object({}).strict();

export const auditRetentionRunBodySchema = z.object({
  force: z.coerce.boolean().optional(),
}).strict();

export const auditArchiveQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  module: optString,
  from: optString,
  to: optString,
}).strict();

export const auditArchiveRestoreBodySchema = z.object({
  ids: z.array(objectId).min(1).max(500),
}).strict();

export const auditLegalHoldBodySchema = z.object({
  module: optString,
  entityType: optString,
  entityId: optString,
  caseRef: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const auditLegalHoldParamsSchema = z.object({ id: objectId }).strict();

export const auditSavedSearchBodySchema = z.object({
  name: z.string().min(1).max(100),
  filters: z.record(z.string(), z.unknown()).optional(),
  isGlobal: z.boolean().optional(),
}).strict();

export const auditSavedSearchParamsSchema = z.object({ id: objectId }).strict();

export const auditAlertListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  resolved: z.coerce.boolean().optional(),
}).strict();

export const auditAlertParamsSchema = z.object({ id: objectId }).strict();