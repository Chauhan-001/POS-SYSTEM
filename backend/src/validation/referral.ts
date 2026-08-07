import { z } from 'zod';
import { nonEmptyString, optString, phone as phoneSchema } from './common';

export const createReferralSchema = z.object({
  code: z.string().min(4).max(20),
  refereePhone: phoneSchema,
  refereeName: optString,
}).strict();

export const referralQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(['pending', 'completed', 'rewarded', 'voided']).optional(),
}).optional();

export const generateReferralCodeSchema = z.object({
  length: z.number().int().min(4).max(12).default(8),
}).strict();

export const referralParamsSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid referral ID'),
}).strict();

export const referralClaimSchema = z.object({
  code: z.string().min(4).max(20),
  refereePhone: phoneSchema,
  refereeName: optString,
}).strict();

export const validateReferralSchema = z.object({
  code: z.string().min(4).max(20),
}).strict();

export const referrerLookupSchema = z.object({
  code: z.string().min(4).max(20),
}).strict();
