import { z } from 'zod';
import { nonEmptyString, optString, objectId } from './common';

export const createCampaignSchema = z.object({
  name: nonEmptyString.max(120),
  description: optString,
  offerId: objectId.optional(),
  audience: z.object({
    segmentIds: z.array(z.string().max(50)).default([]),
    customerPhones: z.array(z.string().regex(/^\d{10}$/)).default([]),
  }).default({ segmentIds: [], customerPhones: [] }),
  template: z.object({
    channel: z.enum(['sms', 'whatsapp', 'email', 'app_notification', 'webhook']),
    subject: optString,
    message: nonEmptyString.max(5000),
  }),
  schedule: z.object({
    mode: z.enum(['immediate', 'scheduled']).default('immediate'),
    scheduledAt: z.string().datetime().optional(),
  }).default({ mode: 'immediate', scheduledAt: undefined }),
}).strict();

export const updateCampaignSchema = createCampaignSchema.partial();

export const campaignParamsSchema = z.object({
  id: objectId,
}).strict();

export const campaignStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'partial']),
}).strict();

export const campaignQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'partial']).optional(),
}).optional();
