import { z } from 'zod';
import { nonEmptyString, optString, optBool, objectId, dateString, expensePaymentMethod } from './common';

export const createRecurringExpenseSchema = z.object({
  description: nonEmptyString.max(500),
  amount: z.number().min(0.01),
  category: nonEmptyString.max(100),
  categoryId: objectId.optional(),
  paymentMethod: expensePaymentMethod.optional(),
  vendorId: objectId.optional(),
  vendor: optString,
  isCogs: optBool,
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  startDate: dateString,
  endDate: dateString.optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  notes: optString,
  branchId: objectId.optional(),
}).strict();

export const updateRecurringExpenseSchema = createRecurringExpenseSchema.partial();

export const recurringExpenseQuerySchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  isPaused: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeDeleted: z.enum(['true', 'false']).optional(),
}).optional();

export const recurringExpenseParamsSchema = z.object({
  id: objectId,
}).strict();
