/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * settingsSchema — Zod validation for settings + printer endpoints (Phase 1.9).
 */

import { z } from 'zod';

export const settingsScopeSchema = z.enum(['restaurant', 'branch', 'device']);

export const settingsQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
}).optional();

export const patchSettingsSchema = z.object({
  scope: settingsScopeSchema,
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  settings: z.record(z.string(), z.any()).refine((v) => Object.keys(v).length > 0, {
    message: 'settings must contain at least one key',
  }),
  baseVersion: z.number().int().min(1).optional(),
  changeReason: z.string().max(300).optional(),
});

export const historyQuerySchema = z.object({
  scope: settingsScopeSchema.default('restaurant'),
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
}).optional();

export const rollbackSchema = z.object({
  scope: settingsScopeSchema,
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  toVersion: z.number().int().min(1),
  changeReason: z.string().max(300).optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).optional();

const connectionSchema = z
  .object({
    kind: z.enum(['network', 'usb', 'bluetooth']),
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    address: z.string().min(1).max(255).optional(),
  })
  .refine((c) => (c.kind === 'network' ? !!c.host : true), {
    message: 'Network printers require a host',
    path: ['host'],
  });

const printerBaseSchema = {
  name: z.string().min(1).max(100),
  type: z.enum(['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth']),
  connection: connectionSchema,
  paperSize: z.enum(['58mm', '80mm']).optional(),
  copies: z.number().int().min(1).max(10).optional(),
  margins: z
    .object({
      top: z.number().min(0).max(100).optional(),
      bottom: z.number().min(0).max(100).optional(),
      left: z.number().min(0).max(100).optional(),
      right: z.number().min(0).max(100).optional(),
    })
    .optional(),
  encoding: z.string().min(1).max(30).optional(),
  receiptWidthChars: z.number().int().min(20).max(80).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
};

export const createPrinterSchema = z.object(printerBaseSchema);

export const updatePrinterSchema = z
  .object({
    ...printerBaseSchema,
    name: z.string().min(1).max(100).optional(),
    type: z.enum(['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth']).optional(),
    connection: connectionSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field to update' });

export const printerParamsSchema = z.object({
  id: z.string().min(1),
});

export const printerListQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  type: z.enum(['kitchen', 'receipt', 'bar', 'dessert', 'kds', 'network', 'usb', 'bluetooth']).optional(),
  enabled: z.enum(['true', 'false']).optional(),
}).optional();
