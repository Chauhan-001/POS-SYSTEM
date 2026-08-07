import { z } from 'zod';
import { dateString, optString } from './common';

export const customerReportQuerySchema = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  tier: z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
}).optional();

export const exportCustomersQuerySchema = z.object({
  search: optString,
  segment: optString,
  tier: z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']).optional(),
  format: z.enum(['csv', 'json']).default('csv'),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
}).optional();
