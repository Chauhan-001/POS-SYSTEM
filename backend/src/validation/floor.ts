import { z } from 'zod';
import { optString, objectId, optNonNegative } from './common';

export const createFloorSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  branchId: objectId.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  theme: optString,
}).strict();

export const updateFloorSchema = createFloorSchema.partial();

export const floorQuerySchema = z.object({
  branchId: objectId.optional(),
  active: z.enum(['true', 'false']).optional(),
}).optional();

export const floorParamsSchema = z.object({
  id: objectId,
}).strict();
