/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase validation schemas — inventory purchase history.
 */

import { z } from 'zod';
import { objectId, nonEmptyString, optString, dateString } from './common';

export const purchaseStatus = z.enum(['completed', 'pending', 'cancelled']);

export const createPurchaseSchema = z.object({
  branchId: objectId.optional(),
  supplier: nonEmptyString.max(200),
  item: nonEmptyString.max(200),
  category: optString,
  quantity: z.number().positive(),
  unit: z.string().max(20).optional().default('kg'),
  price: z.number().min(0),
  date: dateString.optional(),
  status: purchaseStatus.optional(),
  notes: optString,
}).strict();

/**
 * Partial update schema (PATCH) — every field optional so staff can correct a
 * single value (e.g. quantity) without resubmitting the whole record. No
 * defaults here: an absent field must keep its stored value.
 */
export const updatePurchaseSchema = z.object({
  branchId: objectId.optional(),
  supplier: nonEmptyString.max(200).optional(),
  item: nonEmptyString.max(200).optional(),
  category: optString.optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).optional(),
  price: z.number().min(0).optional(),
  date: dateString.optional(),
  status: purchaseStatus.optional(),
  notes: optString.optional(),
}).strict();

export const purchaseQuerySchema = z.object({
  branchId: objectId.optional(),
  supplier: z.string().max(100).optional(),
  item: z.string().max(100).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).optional();

export const purchaseParamsSchema = z.object({
  id: objectId,
}).strict();
