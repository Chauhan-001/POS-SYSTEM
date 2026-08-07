import { z } from 'zod';
import { optString, objectId, tableStatus, tableShape } from './common';

export const createTableSchema = z.object({
  number: z.number().int().min(1),
  capacity: z.number().int().min(1).max(100),
  status: tableStatus.optional(),
  section: optString,
  branchId: objectId.optional(),
  floorId: objectId.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  rotation: z.number().min(0).max(360).optional(),
  shape: tableShape.optional(),
  isLocked: z.boolean().optional(),
}).strict();

export const updateTableSchema = createTableSchema.partial();

export const tableQuerySchema = z.object({
  branchId: objectId.optional(),
  section: optString,
  status: tableStatus.optional(),
}).optional();

export const tableParamsSchema = z.object({
  id: objectId,
}).strict();

export const bulkReplaceTablesSchema = z.object({
  tables: z.array(createTableSchema).max(200).default([]),
}).strict();

export const bulkReplaceParamsSchema = z.object({
  branchId: objectId,
}).strict();

/** POST /api/tables/:id/assign-waiter — Assign a waiter to a table */
export const assignWaiterSchema = z.object({
  waiterId: optString,
  waiterName: optString,
}).strict();

/** POST /api/tables/:id/move-order — Move a live order to another table */
export const moveOrderSchema = z.object({
  toTableId: objectId,
  reason: optString,
}).strict();

/** POST /api/tables/merge — Merge two tables' live orders into one */
export const mergeTablesSchema = z.object({
  fromTableId: objectId,
  toTableId: objectId,
  reason: optString,
}).strict();

/** POST /api/tables/:id/clean — Mark a table for cleaning (reason optional) */
export const cleanTableSchema = z.object({
  reason: optString,
}).strict();

/** POST /api/tables/:id/disable — Disable a table (reason required) */
export const disableTableSchema = z.object({
  reason: z.string().min(1).max(200).trim(),
}).strict();
