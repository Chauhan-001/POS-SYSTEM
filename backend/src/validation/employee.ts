import { z } from 'zod';
import { nonEmptyString, optString, objectId, employeeRole, employeeStatus, pin as pinSchema } from './common';

export const createEmployeeSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  name: nonEmptyString.max(200),
  role: employeeRole,
  pin: pinSchema,
  status: employeeStatus.optional(),
  branchId: objectId.optional().nullable(),
}).strict();

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const employeeQuerySchema = z.object({
  branchId: objectId.optional(),
  role: employeeRole.optional(),
}).optional();

export const employeeParamsSchema = z.object({
  id: objectId,
}).strict();
