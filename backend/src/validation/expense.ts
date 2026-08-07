import { z } from 'zod';
import { nonEmptyString, optString, optBool, objectId, dateString, expensePaymentMethod } from './common';

// ─── GST breakdown ────────────────────────────────────────────
export const expenseGstSchema = z.object({
  cgst: z.number().min(0).default(0),
  sgst: z.number().min(0).default(0),
  igst: z.number().min(0).default(0),
  cess: z.number().min(0).default(0),
  inputGst: z.boolean().default(true),
  taxInclusive: z.boolean().default(true),
  hsn: z.string().max(20).optional(),
  sac: z.string().max(20).optional(),
}).strict();

export const expenseAttachmentSchema = z.object({
  name: z.string().min(1).max(300),
  mime: z.string().max(200).default('application/octet-stream'),
  size: z.number().min(0).max(100 * 1024 * 1024).default(0),
  url: z.string().max(1000).optional(),
  storage: z.enum(['local', 'cloud']).default('local'),
}).strict();

export const createExpenseSchema = z.object({
  amount: z.number().min(0.01),
  category: nonEmptyString.max(100),
  categoryId: objectId.optional(),
  date: dateString,
  description: nonEmptyString.max(500),
  paymentMethod: expensePaymentMethod.optional(),
  vendor: optString,
  vendorId: objectId.optional(),
  notes: optString,
  isCogs: optBool,
  isRecurring: optBool,
  branchId: objectId.optional(),
  gst: expenseGstSchema.optional(),
  attachments: z.array(expenseAttachmentSchema).max(10).optional(),
  createdBy: optString,
}).strict();

export const updateExpenseSchema = z.object({
  amount: z.number().min(0.01).optional(),
  category: nonEmptyString.max(100).optional(),
  categoryId: objectId.optional(),
  date: dateString.optional(),
  description: nonEmptyString.max(500).optional(),
  paymentMethod: expensePaymentMethod.optional(),
  vendor: optString,
  vendorId: objectId.optional(),
  notes: optString,
  isCogs: optBool,
  branchId: objectId.optional(),
  gst: expenseGstSchema.optional(),
  attachments: z.array(expenseAttachmentSchema).max(10).optional(),
  /** Optimistic concurrency — the version the client based its edit on. */
  baseVersion: z.number().int().min(1).optional(),
  updatedBy: optString,
}).strict();

export const expenseQuerySchema = z.object({
  branchId: objectId.optional(),
  category: z.string().max(100).optional(),
  vendorId: objectId.optional(),
  paymentMethod: expensePaymentMethod.optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  search: z.string().max(100).optional(),
  isCogs: z.enum(['true', 'false']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(['date', 'amount', 'createdAt']).default('date'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
}).optional();

export const expenseParamsSchema = z.object({
  id: objectId,
}).strict();

export const deleteExpenseSchema = z.object({
  reason: z.string().max(300).optional(),
  managerPin: z.string().regex(/^\d{4,6}$/).optional(),
}).strict();
