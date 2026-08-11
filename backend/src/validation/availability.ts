/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Availability validation schemas — online menu availability toggles.
 */

import { z } from 'zod';
import { optString, objectId } from './common';

export const availabilityStatusEnum = z.enum(['AVAILABLE', 'UNAVAILABLE']);

const availabilityItemSchema = z.object({
  productId: objectId,
  status: availabilityStatusEnum,
  /** ISO date string; when UNAVAILABLE + set, availability auto-restores after this. */
  unavailableUntil: z.string().datetime({ offset: true }).or(z.string().min(5)).optional().nullable(),
  reason: z.string().trim().max(300).optional(),
  /** Master site-visibility: false hides the item from the customer site. */
  visibleOnSite: z.boolean().optional(),
}).strict();

/** PUT /api/availability/bulk — one or many toggles in a single call. */
export const availabilityBulkSchema = z.object({
  branchId: objectId.optional().nullable(),
  items: z.array(availabilityItemSchema).min(1).max(500),
}).strict();

export const availabilityQuerySchema = z.object({
  branchId: objectId.optional(),
  productId: objectId.optional(),
  status: availabilityStatusEnum.optional(),
}).optional();

export const availabilityHistoryQuerySchema = z.object({
  branchId: objectId.optional(),
  productId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).optional();
