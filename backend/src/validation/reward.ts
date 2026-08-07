import { z } from 'zod';
import { nonEmptyString, optString, optBool, requiredNonNegative, optNonNegative, objectId, rewardType } from './common';

export const createRewardSchema = z.object({
  title: nonEmptyString.max(200),
  pointsRequired: z.number().int().min(1),
  type: rewardType,
  value: requiredNonNegative,
  minBillAmount: optNonNegative,
  isLargeReward: optBool,
  rewardItemId: optString,
  rewardItemName: optString,
  stock: z.number().int().min(0).optional(),
  isActive: optBool,
}).strict();

export const updateRewardSchema = createRewardSchema.partial();

export const rewardQuerySchema = z.object({
  isActive: z.enum(['true', 'false']).optional(),
}).optional();

export const rewardParamsSchema = z.object({
  id: objectId,
}).strict();
