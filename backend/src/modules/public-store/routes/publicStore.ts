/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public store API routes. Public (no auth) — read-only storefront data +
 * online order submission for the customer website. All mutations re-validate
 * server-side and are idempotency-key protected.
 * Mounted in server.ts BEFORE the global apiLimiter with publicLimiter so
 * customer phones scanning a QR never consume the business API budget.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  getPublicConfig,
  getPublicMenu,
  precheckOrder,
  createPublicOrder,
  trackPublicOrder,
  createPublicRequest,
} from '../controllers/publicStoreController';

const router = Router();

const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
}).strict();

const customerSchema = z.object({
  name: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
}).optional();

const precheckSchema = z.object({
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  items: z.array(cartItemSchema).min(1).max(100),
}).strict();

const createOrderSchema = z.object({
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  items: z.array(cartItemSchema).min(1).max(100),
  customer: customerSchema,
  deliveryAddress: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  /** QR ordering context (from the sticker URL). */
  mode: z.enum(['TABLE', 'CAR', 'PICKUP']).optional(),
  tableId: z.string().max(64).optional(),
  tableNumber: z.number().int().min(1).optional(),
  parkingSlot: z.string().max(40).optional(),
  carPlate: z.string().max(20).optional(),
  tip: z.number().min(0).max(100000).optional(),
  /** Idempotency key — replays of the same submission return the same order. */
  clientRef: z.string().min(6).max(80).optional(),
}).strict();

const requestSchema = z.object({
  mode: z.enum(['TABLE', 'CAR', 'PICKUP']).default('TABLE'),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  tableId: z.string().max(64).optional(),
  parkingSlot: z.string().max(40).optional(),
  carPlate: z.string().max(20).optional(),
  name: z.string().max(60).optional(),
  phone: z.string().max(20).optional(),
  type: z.enum(['water', 'tissue', 'bill', 'assistance', 'custom']).default('custom'),
  message: z.string().max(300).optional(),
}).strict();

// Existing loyalty storefront config (read-only).
router.get('/:token', getPublicConfig);

// Online ordering surface (customer website consumes these; the site UI itself
// is a separate project).
router.get('/:token/menu', getPublicMenu);
router.post('/:token/orders/precheck', (req, res, next) => {
  const parsed = precheckSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }
  req.body = parsed.data;
  next();
}, precheckOrder);
router.post('/:token/orders', (req, res, next) => {
  const parsed = createOrderSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }
  req.body = parsed.data;
  next();
}, createPublicOrder);

// Live order tracking by idempotency key (customer track page).
router.get('/:token/orders/:clientRef', trackPublicOrder);

// Customer service requests (call waiter / water / bill / assistance).
router.post('/:token/requests', (req, res, next) => {
  const parsed = requestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }
  req.body = parsed.data;
  next();
}, createPublicRequest);

export default router;
