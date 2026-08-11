import { z } from 'zod';
import { nonEmptyString, optString, optNonNegative, requiredNonNegative, objectId, dateString, timeString, paymentMethod, orderType, cartItemSchema } from './common';

const splitDetailsSchema = z.object({
  cashAmount: z.number().min(0).optional(),
  cardAmount: z.number().min(0).optional(),
  upiAmount: z.number().min(0).optional(),
  walletAmount: z.number().min(0).optional(),
}).optional();

/** Flexible time regex that accepts both 24h (14:30) and 12h (2:30 PM, 02:30 PM) formats */
const timeFlexible = z.string().regex(/^\d{1,2}:\d{2}(\s?(AM|PM|am|pm))?$/, 'Time must be HH:MM or h:MM AM/PM format');

export const createBillSchema = z.object({
  // Phase 1.10 — idempotency key sent by the POS terminal (its local bill id).
  // The backend dedupes on { restaurantId, clientRef } so an offline replay can
  // never create a duplicate bill / double-deduct stock / double-award points.
  clientRef: z.string().max(80).optional(),
  invoiceNumber: nonEmptyString.max(50),
  ticketNumber: nonEmptyString.max(50),
  date: dateString,
  time: timeFlexible,
  cashierName: nonEmptyString.max(100),
  cashierRole: nonEmptyString.max(50),
  items: z.array(cartItemSchema).max(500),
  subtotal: requiredNonNegative,
  discount: optNonNegative,
  gst: optNonNegative,
  grandTotal: requiredNonNegative,
  paymentMethod: paymentMethod,
  splitDetails: splitDetailsSchema,
  orderType: orderType,
  branchId: objectId.optional(),
  orderId: objectId.optional().nullable(),
  customerId: objectId.optional().nullable(),
  customerPhone: z.string().regex(/^\d{10}$/).optional().nullable(),
  customerName: optString,
  pointsEarned: optNonNegative,
  pointsRedeemed: optNonNegative,
  redeemedRewardTitle: optString.nullable(),
  milestoneRewardAwarded: optString.nullable(),
});

export const billQuerySchema = z.object({
  date: z.string().max(20).optional(),
  branchId: objectId.optional(),
  paymentMethod: paymentMethod.optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
}).optional();

export const billParamsSchema = z.object({
  id: objectId,
}).strict();

export const voidBillSchema = z.object({
  reason: optString,
  voidedBy: optString,
  managerPin: z.string().min(4).max(10).optional(),
}).optional();

/**
 * Refund a bill — full refund when `items` is omitted, partial refund when a
 * subset of line items is provided. A Manager/Owner PIN is required so refunds
 * always have an accountable operator.
 */
export const refundBillSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().min(1).optional(),
    itemName: z.string().min(1).optional(),
    quantity: z.number().int().min(1).optional(),
  })).max(500).optional(),
  reason: nonEmptyString.max(500),
  refundedBy: nonEmptyString.max(100),
  managerPin: z.string().min(4).max(10),
}).strict();
