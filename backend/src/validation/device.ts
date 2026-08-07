/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * device.ts — Zod validation for the Device Management module (Phase 2.5).
 *
 * Every device route validates params / query / body BEFORE reaching the
 * controller (validate middleware). Schemas are strict for admin bodies and
 * permissive-but-typed where the legacy POS payloads must keep working
 * (backward compatibility — unknown keys are stripped, never rejected).
 */

import { z } from 'zod';
import { objectId } from './common';

/** Device lifecycle statuses (must mirror the model enum). */
export const DEVICE_STATUSES = ['active', 'inactive', 'blocked', 'pending', 'rejected'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** Params for single-device admin routes: /admin/devices/:id */
export const deviceParamsSchema = z.object({
  id: objectId,
}).strict();

/** Params for device + session: /admin/devices/:id/sessions/:sessionId */
export const deviceSessionParamsSchema = z.object({
  id: objectId,
  sessionId: objectId,
}).strict();

/**
 * POS / admin device registration. Legacy fields (deviceId, deviceName, os,
 * osVersion, appVersion) stay first-class; Phase 2.5 adds fingerprint,
 * platform, browser, electron/mobile flags, nickname and branch binding.
 * Non-strict: unknown payload keys are stripped so older clients never break.
 */
export const deviceRegisterSchema = z.object({
  deviceId: z.string().min(1).max(100).trim(),
  deviceName: z.string().max(100).trim().optional(),
  nickname: z.string().max(100).trim().optional(),
  fingerprint: z.string().max(200).trim().optional(),
  platform: z.string().max(40).trim().optional(),
  browser: z.string().max(80).trim().optional(),
  os: z.string().max(80).trim().optional(),
  osVersion: z.string().max(80).trim().optional(),
  appVersion: z.string().max(40).trim().optional(),
  isElectron: z.boolean().optional(),
  isMobile: z.boolean().optional(),
  branchId: objectId.optional(),
  /** Register in 'pending' state (admin approval workflow) instead of active. */
  requireApproval: z.boolean().optional(),
});

/** Approve body — optional admin note. */
export const deviceApprovalSchema = z.object({
  note: z.string().max(500).trim().optional(),
}).strict();

/** Reject body — optional reason recorded with the rejection. */
export const deviceRejectSchema = z.object({
  reason: z.string().max(500).trim().optional(),
}).strict();

/** Bulk approve/reject body — up to 200 device ids. */
export const deviceBulkSchema = z.object({
  ids: z.array(objectId).min(1).max(200),
  note: z.string().max(500).trim().optional(),
  reason: z.string().max(500).trim().optional(),
}).strict();

/** Remove body — optional reason for the soft delete. */
export const deviceRemoveSchema = z.object({
  reason: z.string().max(500).trim().optional(),
}).strict();

/** Remove-all-inactive body — optional restaurant scope. */
export const deviceRemoveInactiveSchema = z.object({
  restaurantId: objectId.optional(),
}).strict();

/**
 * Force-logout body. Scope controls what is logged out:
 *   current    — the caller's own device (deviceId required)
 *   selected   — specific device document ids (ids required)
 *   all        — every session for the authenticated user
 *   restaurant — every session in the restaurant (restaurantId required)
 */
export const deviceForceLogoutSchema = z.object({
  scope: z.enum(['current', 'selected', 'all', 'restaurant']).default('selected'),
  deviceId: z.string().max(100).trim().optional(),
  ids: z.array(objectId).max(200).optional(),
  restaurantId: objectId.optional(),
  reason: z.string().max(500).trim().optional(),
}).strict();

/** Heartbeat body — POS terminals call this periodically to report health. */
export const deviceHeartbeatSchema = z.object({
  deviceId: z.string().min(1).max(100).trim(),
  deviceName: z.string().max(100).trim().optional(),
  os: z.string().max(80).trim().optional(),
  osVersion: z.string().max(80).trim().optional(),
  appVersion: z.string().max(40).trim().optional(),
  electronVersion: z.string().max(40).trim().optional(),
  dbSyncStatus: z.enum(['synced', 'syncing', 'pending', 'failed', 'offline']).optional(),
  pendingSyncCount: z.number().int().min(0).max(1_000_000).optional(),
  failedSyncCount: z.number().int().min(0).max(1_000_000).optional(),
  lastSyncAt: z.string().max(40).optional(),
});

/**
 * Admin device list query — search / filter / sort / pagination with
 * whitelisted values matching the admin dashboard.
 */
export const deviceListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(200).optional()),
  search: z.string().max(200).optional(),
  status: z.enum(DEVICE_STATUSES).optional(),
  restaurantId: objectId.optional(),
  branchId: objectId.optional(),
  userId: objectId.optional(),
  platform: z.string().max(40).optional(),
  os: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
  approved: z.enum(['true', 'false']).optional(),
  pending: z.enum(['true', 'false']).optional(),
  online: z.enum(['true', 'false']).optional(),
  offline: z.enum(['true', 'false']).optional(),
  deleted: z.enum(['true', 'false']).optional(),
  lastActiveFrom: z.string().max(40).optional(),
  lastActiveTo: z.string().max(40).optional(),
  createdFrom: z.string().max(40).optional(),
  createdTo: z.string().max(40).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'lastActivityAt', 'lastLoginAt', 'deviceName', 'os', 'platform', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).strict();

export default {
  deviceParamsSchema,
  deviceSessionParamsSchema,
  deviceRegisterSchema,
  deviceApprovalSchema,
  deviceRejectSchema,
  deviceBulkSchema,
  deviceRemoveSchema,
  deviceRemoveInactiveSchema,
  deviceForceLogoutSchema,
  deviceHeartbeatSchema,
  deviceListQuerySchema,
};
