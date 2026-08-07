import { z } from 'zod';
import { nonEmptyString, optString, objectId, takeawayStatus, paymentStatus } from './common';

const takeawayItemSchema = z.object({
  itemName: nonEmptyString.max(200),
  quantity: z.number().int().min(1).max(999),
  price: z.number().min(0),
  variantName: optString,
});

export const createTakeawayOrderSchema = z.object({
  orderNumber: z.number().int().min(1),
  customerName: nonEmptyString.max(200),
  customerPhone: z.string().max(20).optional(),
  status: takeawayStatus.optional(),
  amount: z.number().min(0),
  paymentStatus: paymentStatus.optional(),
  branchId: objectId.optional(),
  items: z.array(takeawayItemSchema).max(500).optional(),
}).strict();

export const updateTakeawayOrderSchema = createTakeawayOrderSchema.partial();

export const takeawayOrderQuerySchema = z.object({
  status: takeawayStatus.optional(),
  branchId: objectId.optional(),
}).optional();

export const takeawayOrderParamsSchema = z.object({
  id: objectId,
}).strict();

export const nextNumberQuerySchema = z.object({
  branchId: objectId,
}).strict();
