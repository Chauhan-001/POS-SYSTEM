/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier validation schemas.
 */

import { z } from 'zod';
import { objectId, optString } from './common';

export const createSupplierSchema = z.object({
  branchId: objectId.optional(),
  name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(500).optional(),
  gstin: z.string().max(30).optional(),
  items: z.array(z.string().min(1).max(200)).max(500).optional().default([]),
  status: z.enum(['active', 'inactive']).optional(),
  notes: optString,
}).strict();

export const updateSupplierSchema = createSupplierSchema.partial();

export const supplierQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).optional();

export const supplierParamsSchema = z.object({
  id: objectId,
}).strict();
