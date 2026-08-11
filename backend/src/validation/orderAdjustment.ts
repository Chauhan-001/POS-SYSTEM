/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order adjustment validation — unavailable-item workflows on submitted orders
 * (REMOVE / REPLACE / CANCEL). All monetary values are computed server-side
 * from line snapshots; the client never sends prices.
 */

import { z } from 'zod';
import { nonEmptyString, optString } from './common';

const adjustmentItemSchema = z.object({
  /** The OrderItem id to adjust (preferred — unambiguous). */
  orderItemId: z.string().min(1).optional(),
  /** Product id fallback (legacy/offline rows without a stable item id). */
  productId: z.string().min(1).optional(),
  /** Quantity to remove (must be ≤ original quantity). */
  quantity: z.number().int().min(1),
  /** REPLACE target — the product replacing the unavailable one. */
  replaceWithProductId: z.string().min(1).optional(),
}).strict().refine(
  (d) => !!(d.orderItemId || d.productId),
  { message: 'Either orderItemId or productId is required' }
);

export const adjustOrderSchema = z.object({
  /** Idempotency key — replays of the same adjustment are ignored. */
  adjustmentId: z.string().min(6).max(80).trim(),
  action: z.enum(['REMOVE', 'REPLACE', 'CANCEL']),
  items: z.array(adjustmentItemSchema).min(1).max(200).optional(),
  reason: nonEmptyString.max(500),
  /** Also mark the affected product UNAVAILABLE for new online orders. */
  markUnavailable: z.boolean().optional().default(false),
  /** Owner/Manager PIN required when the adjustment triggers a ledger refund. */
  managerPin: z.string().min(4).max(10).optional(),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'CANCEL') {
    if (d.items && d.items.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CANCEL does not accept items' });
    }
  } else if (!d.items || d.items.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'items are required for REMOVE/REPLACE' });
  } else if (d.action === 'REPLACE') {
    const missing = d.items.filter((i: any) => !i.replaceWithProductId);
    if (missing.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'REPLACE requires replaceWithProductId for every item' });
    }
  }
});
