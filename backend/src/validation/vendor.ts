import { z } from 'zod';
import { nonEmptyString, optString, objectId, expensePaymentMethod } from './common';

export const gstinSchema = z.string().regex(
  /^[0-9A-Z]{15}$/,
  'GSTIN must be exactly 15 characters (alphanumeric, uppercase)'
).optional().or(z.literal(''));

export const createVendorSchema = z.object({
  name: nonEmptyString.max(150),
  gstin: gstinSchema,
  phone: z.string().max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  address: optString,
  city: optString,
  state: optString,
  pincode: z.string().max(10).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  defaultPaymentMethod: expensePaymentMethod.optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: optString,
  branchId: objectId.optional(),
}).strict();

export const updateVendorSchema = createVendorSchema.partial();

export const vendorQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeDeleted: z.enum(['true', 'false']).optional(),
}).optional();

export const vendorParamsSchema = z.object({
  id: objectId,
}).strict();
