import { z } from 'zod';
import { phone as phoneSchema } from './common';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['reward_redemption', 'referral', 'login', 'general']).default('general'),
}).strict();

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{4,8}$/, 'OTP must be 4-8 digits'),
  purpose: z.enum(['reward_redemption', 'referral', 'login', 'general']).default('general'),
}).strict();
