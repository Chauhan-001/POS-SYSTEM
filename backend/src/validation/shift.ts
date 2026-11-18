/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift validation schemas (Phase 2).
 */

import { z } from 'zod';
import { objectId, optString, optNonNegative } from './common';

export const shiftOpenSchema = z.object({
  branchId: objectId,
  registerId: z.string().min(1, 'Register ID is required'),
  openingCash: optNonNegative,
  assignedStaff: objectId.optional(),
}).strict();

export const shiftCloseSchema = z.object({
  branchId: objectId.optional(),
  registerId: z.string().min(1, 'Register ID is required'),
  closingCash: optNonNegative,
  approvedBy: objectId.optional(),
  approvalNotes: optString,
}).strict();

export const shiftQuerySchema = z.object({
  branchId: objectId.optional(),
  registerId: z.string().optional(),
  status: z.enum(['open', 'closed', 'archived']).optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).optional();

export const shiftParamsSchema = z.object({
  id: objectId,
}).strict();
