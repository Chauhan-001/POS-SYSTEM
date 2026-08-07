import { z } from 'zod';
import { objectId, dateString } from './common';

export const financePeriodQuerySchema = z.object({
  branchId: objectId.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
}).optional();

export const financeReportQuerySchema = z.object({
  branchId: objectId.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  format: z.enum(['json', 'csv', 'excel', 'pdf']).default('json'),
}).optional();

export const updateFinanceSettingsSchema = z.object({
  gstEnabled: z.boolean().optional(),
  gstMode: z.enum(['inclusive', 'exclusive']).optional(),
  defaultCgst: z.number().min(0).max(100).optional(),
  defaultSgst: z.number().min(0).max(100).optional(),
  defaultIgst: z.number().min(0).max(100).optional(),
  defaultCess: z.number().min(0).max(100).optional(),
  hsnRequired: z.boolean().optional(),
  sacRequired: z.boolean().optional(),
  cogsMode: z.enum(['auto', 'category']).optional(),
  openingCashDefault: z.number().min(0).optional(),
}).strict();
