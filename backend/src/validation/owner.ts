/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * owner.ts — Zod validation for the Owners Management module (Phase 2.3).
 *
 * Every owner admin route validates params / query / body BEFORE reaching the
 * controller (validate middleware). Schemas are strict where the admin
 * dashboard only sends known keys, and permissive-but-typed where the legacy
 * payloads must keep working (backward compatibility).
 */

import { z } from 'zod';
import { objectId, optString } from './common';

/** Params for single-owner admin routes: /admin/owners/:id */
export const ownerIdParamsSchema = z.object({
  id: objectId,
}).strict();

/** Params for owner-scoped restaurant mapping: /admin/owners/:id/restaurants/:restaurantId */
export const ownerRestaurantParamsSchema = z.object({
  id: objectId,
  restaurantId: objectId,
}).strict();

/** Params for owner-scoped session revoke: /admin/owners/:id/sessions/:sessionId */
export const ownerSessionParamsSchema = z.object({
  id: objectId,
  sessionId: objectId,
}).strict();

/** Params for owner-scoped device ops: /admin/owners/:id/devices/:deviceId */
export const ownerDeviceParamsSchema = z.object({
  id: objectId,
  deviceId: objectId,
}).strict();

/**
 * List query schema — flat field names matching the admin dashboard:
 *   page, limit, search, status, restaurant, sortBy, sortOrder,
 * plus newer filters: createdFrom/createdTo, lastLoginFrom/To, deleted.
 * Unknown query keys are stripped so clients cannot inject Mongo operators.
 */
export const ownerListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(100).optional()),
  search: optString,
  status: z.enum(['active', 'inactive', 'suspended', 'deleted']).optional(),
  restaurant: optString,
  sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'lastLogin', 'lastActivity', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  createdFrom: optString,
  createdTo: optString,
  lastLoginFrom: optString,
  lastLoginTo: optString,
  deleted: z.enum(['true', 'false']).optional(),
}).strict();

/**
 * Create owner — atomic onboarding. The admin can optionally assign
 * restaurants up front. `password` is optional: when omitted the service
 * generates a random PIN (one-time temporary credential for the owner).
 */
export const ownerCreateSchema = z.object({
  name: z.string().min(1, 'Owner name is required').max(200).trim(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().min(5).max(30).trim().optional().or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100).optional(),
  restaurantIds: z.array(objectId).max(100).optional(),
}).strict();

/** Update owner — profile fields only. */
export const ownerUpdateSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().min(5).max(30).trim().optional().or(z.literal('')),
}).strict();

/** Status change request body (suspend / activate may carry a reason). */
export const ownerStatusSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict().optional();

/** Login-history list query. */
export const ownerLoginHistoryQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(100).optional()),
  // The feed emits login / failed / reset events (logout is reflected as a
  // revoked login session, not a separate event).
  event: z.enum(['login', 'failed', 'reset']).optional(),
}).strict();

export default {
  ownerIdParamsSchema,
  ownerRestaurantParamsSchema,
  ownerSessionParamsSchema,
  ownerDeviceParamsSchema,
  ownerListQuerySchema,
  ownerCreateSchema,
  ownerUpdateSchema,
  ownerStatusSchema,
  ownerLoginHistoryQuerySchema,
};
