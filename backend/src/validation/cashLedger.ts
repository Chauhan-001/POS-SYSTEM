import { z } from 'zod';
import { optString, objectId, dateString } from './common';

export const openCashSchema = z.object({
  amount: z.number().min(0),
  date: dateString.optional(),
  branchId: objectId.optional(),
  note: optString,
}).strict();

export const ledgerEntrySchema = z.object({
  type: z.enum(['cash_in', 'cash_out', 'drawer_adjustment', 'bank_deposit', 'bank_withdrawal']),
  amount: z.number().positive(),
  date: dateString.optional(),
  branchId: objectId.optional(),
  note: optString,
  refType: z.enum(['expense', 'bill', 'shift', 'bank']).optional(),
  refId: optString,
}).strict();

export const closeShiftSchema = z.object({
  countedCash: z.number().min(0),
  date: dateString.optional(),
  branchId: objectId.optional(),
  note: optString,
}).strict();

export const cashLedgerQuerySchema = z.object({
  branchId: objectId.optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  type: z.enum(['opening', 'cash_in', 'cash_out', 'expense', 'drawer_adjustment', 'shift_closing', 'bank_deposit', 'bank_withdrawal']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).optional();
