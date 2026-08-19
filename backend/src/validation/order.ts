import { z } from 'zod';
import { nonEmptyString, optString, optBool, optNonNegative, objectId, orderStatus, orderType, paymentMethod, cartItemSchema } from './common';

/**
 * KOT record schema — the POS sends its full kotRecords array on every order
 * update so KOTs persist server-side (the KDS on other terminals reads them
 * back from /orders + /orders/:id). Items are CartItem-shaped from the POS
 * (product object, selectedVariant, cancelled flags) — mapped to the backend
 * subdoc in orderService.update.
 */
export const kotItemSchema = z.object({
  id: z.string().optional(),
  product: z.any().optional(),
  productName: z.string().optional(),
  selectedVariant: z.any().optional(),
  quantity: z.number().int().min(0).optional(),
  notes: optString,
  price: z.number().min(0).optional(),
  variantName: optString,
  cancelled: z.boolean().optional(),
  cancelReason: optString,
  cancelledAt: optString,
}).passthrough();

export const kotRecordSchema = z.object({
  id: z.string().optional(),
  kotNumber: z.number().int().min(1),
  type: z.enum(['Original', 'Additional', 'Reprint']),
  status: z.enum(['Accepted', 'Preparing', 'Ready', 'Served', 'Cancelled']).optional(),
  items: z.array(kotItemSchema).max(500).optional(),
  printedAt: z.string().optional(),
  printedBy: optString,
  note: optString,
}).passthrough();

export const createOrderSchema = z.object({
  orderNumber: z.number().int().min(1),
  type: orderType,
  status: orderStatus.optional(),
  tableId: optString,
  tableNumber: z.number().int().min(1).optional(),
  platform: optString,
  branchId: objectId.optional(),
  // Tenant identity — server re-stamps from the authenticated context anyway;
  // accepting it lets offline-synced orders carry their tenant explicitly.
  restaurantId: objectId.optional(),
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
  kotRecords: z.array(kotRecordSchema).max(200).optional(),
}).strict();

export const updateOrderSchema = createOrderSchema.partial();

export const orderQuerySchema = z.object({
  status: orderStatus.optional(),
  branchId: objectId.optional(),
  date: z.string().max(20).optional(),
  tableId: optString,
}).optional();

export const nextNumberQuerySchema = z.object({
  branchId: objectId.optional(),
}).optional();

export const orderParamsSchema = z.object({
  id: objectId,
}).strict();
