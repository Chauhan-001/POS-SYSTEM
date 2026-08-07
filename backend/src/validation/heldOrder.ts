import { z } from 'zod';
import { nonEmptyString, optString, objectId } from './common';

/**
 * Held orders are opaque cart snapshots (mixed items + customer), so the
 * schema only pins the envelope fields and leaves the nested structure open.
 */
export const createHeldOrderSchema = z.object({
  clientId: nonEmptyString.max(200),
  orderId: optString,
  customer: z.any().optional(),
  items: z.array(z.any()).max(2000).default([]),
  type: optString,
  timestamp: optString,
  branchId: objectId.optional(),
}).strict();

export const updateHeldOrderSchema = createHeldOrderSchema.partial();

export const heldOrderQuerySchema = z.object({
  branchId: objectId.optional(),
}).optional();

export const heldOrderParamsSchema = z.object({
  id: objectId,
}).strict();
