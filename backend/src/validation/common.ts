/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Common validation schemas and helpers used across all resources.
 */

import { z } from 'zod';

/** MongoDB 24-hex-character ObjectId string */
export const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ObjectId format');

/** 10-digit Indian phone number */
export const phone = z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits');

/** 4-6 digit PIN string */
export const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits');

/** YYYY-MM-DD date string */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format');

/** HH:MM time string */
export const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format');

/** ISO 8601 datetime string */
export const isoDateTime = z.string().datetime({ message: 'Must be ISO 8601 datetime' });

/** Non-empty string trimmed */
export const nonEmptyString = z.string().min(1, 'Must not be empty').max(500);

/** Optional non-empty string */
export const optString = z.string().max(500).optional();

/** Optional boolean */
export const optBool = z.boolean().optional();

/** Optional number >= 0 */
export const optNonNegative = z.number().min(0).optional();

/** Required number >= 0 */
export const requiredNonNegative = z.number().min(0);

/** Currency symbol (1-5 chars) */
export const currencySymbol = z.string().min(1).max(5);

/** Hex color string */
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be hex color (#RRGGBB)');

/** Employee roles */
export const employeeRole = z.enum(['Owner', 'Manager', 'Cashier']);

/** Employee status */
export const employeeStatus = z.enum(['Active', 'Inactive']);

/** Payment methods */
export const paymentMethod = z.enum(['Cash', 'UPI', 'Card', 'Wallet', 'Split']);

/** Order types */
export const orderType = z.enum(['Dine In', 'Takeaway', 'Delivery', 'Swiggy', 'Zomato', 'Uber Eats', 'Website', 'Phone Orders']);

/** Table statuses */
export const tableStatus = z.enum(['Available', 'Occupied', 'Reserved', 'Preparing', 'Food Ready', 'Served', 'Waiting Payment', 'Cleaning', 'Paid', 'Cancelled', 'Disabled', 'Merged']);

/** Table shapes */
export const tableShape = z.enum(['circle', 'square', 'rectangle']);

/** Reward types */
export const rewardType = z.enum(['percentage', 'flat', 'item']);

/** Reservation statuses */
export const reservationStatus = z.enum(['Confirmed', 'Seated', 'Cancelled', 'No Show']);

/** Waiting entry statuses */
export const waitingStatus = z.enum(['Waiting', 'Seated', 'Cancelled']);

/** Takeaway order statuses */
export const takeawayStatus = z.enum(['Preparing', 'Ready', 'Collected', 'Completed']);

/** Payment statuses */
export const paymentStatus = z.enum(['Pending', 'Paid']);

/** Order statuses */
export const orderStatus = z.enum(['New', 'Accepted', 'Preparing', 'Ready', 'Served', 'Waiting Payment', 'Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Transferred', 'Merged', 'Split']);

/** Print sizes */
export const printSize = z.enum(['58mm', '80mm']);

/** Expense categories */
export const expenseCategory = z.enum([
  'Ingredients & Raw Materials', 'Salaries & Wages', 'Utilities', 'Rent & Lease',
  'Equipment & Maintenance', 'Marketing & Advertising', 'Delivery & Logistics',
  'Cleaning & Supplies', 'Licenses & Permits', 'Taxes & Fees', 'Insurance',
  'Technology & Software', 'Miscellaneous',
]);

/** Expense payment methods */
export const expensePaymentMethod = z.enum(['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other']);

/** Cart item schema (for nested arrays) */
export const cartItemSchema = z.object({
  id: z.string().min(1),
  product: z.any(),
  productName: z.string().min(1).optional(),
  selectedVariant: z.any().optional(),
  quantity: z.number().int().min(1),
  notes: optString,
  price: z.number().min(0),
  isFree: z.boolean().optional(),
  originalPrice: z.number().min(0).optional(),
  kotPrinted: z.boolean().optional(),
  customPrice: z.number().min(0).optional(),
});

/** Party types */
export const partyType = z.enum(['adult', 'family', 'business']).optional();
