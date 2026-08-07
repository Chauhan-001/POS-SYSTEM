import { z } from 'zod';
import { nonEmptyString, optString, optBool, optNonNegative, objectId, orderStatus, orderType, paymentMethod, cartItemSchema } from './common';

export const createOrderSchema = z.object({
  orderNumber: z.number().int().min(1),
  type: orderType,
  status: orderStatus.optional(),
  tableId: optString,
  tableNumber: z.number().int().min(1).optional(),
  platform: optString,
  branchId: objectId.optional(),
  customerPhone: z.string().regex(/^\d{10}$/).optional().nullable(),
  customerName: optString,
  waiterId: optString,
  waiterName: optString,
  guestCount: z.number().int().min(1).optional(),
  specialInstructions: optString,
  deliveryAddress: optString,
  deliveryEta: optString,
  subtotal: optNonNegative,
  discount: optNonNegative,
  gst: optNonNegative,
  grandTotal: optNonNegative,
  paymentMethod: paymentMethod.optional(),
  paidAt: z.string().optional(),
  closedAt: z.string().optional(),
  appliedRewardTitle: optString,
  loyaltyPointsEarned: optNonNegative,
  loyaltyPointsRedeemed: optNonNegative,
  items: z.array(cartItemSchema).max(500).optional(),
}).strict();

export const updateOrderSchema = createOrderSchema.partial();

export const orderQuerySchema = z.object({
  status: orderStatus.optional(),
  branchId: objectId.optional(),
  date: z.string().max(20).optional(),
  tableId: optString,
}).optional();

export const orderParamsSchema = z.object({
  id: objectId,
}).strict();
