/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory event validation schemas — inventory activity feed.
 */

import { z } from 'zod';
import { objectId, dateString } from './common';

export const inventoryEventType = z.enum(['sold', 'adjusted', 'waste', 'closing', 'purchase', 'return']);

export const createInventoryEventSchema = z.object({
  branchId: objectId.optional(),
  type: inventoryEventType,
  item: z.string().min(1).max(200),
  quantity: z.number().refine((v) => v !== 0, { message: 'Quantity must be non-zero' }),
  unit: z.string().max(20).optional().default('pcs'),
  operator: z.string().max(100).optional(),
  details: z.string().max(500).optional(),
  eventDate: dateString.optional(),
}).strict();

export const inventoryEventQuerySchema = z.object({
  type: inventoryEventType.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).optional();
