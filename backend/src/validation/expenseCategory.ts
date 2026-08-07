import { z } from 'zod';
import { nonEmptyString, optString, optBool, objectId, hexColor } from './common';

export const createExpenseCategorySchema = z.object({
  name: nonEmptyString.max(100),
  icon: z.string().max(50).optional(),
  color: hexColor.optional(),
  sortOrder: z.number().int().min(0).default(0),
  isCogs: optBool,
  isActive: optBool,
}).strict();

export const updateExpenseCategorySchema = createExpenseCategorySchema.partial();

export const expenseCategoryQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
}).optional();

export const expenseCategoryParamsSchema = z.object({
  id: objectId,
}).strict();
