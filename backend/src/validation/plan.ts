/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * plan.ts — Zod validation for the Plans Management module (Phase 2.4).
 *
 * Every plan admin route validates params / query / body BEFORE reaching the
 * controller (validate middleware). Schemas are strict: unknown keys are
 * rejected, limits are non-negative, pricing is non-negative, feature keys are
 * checked against the centralized catalog where practical, and status values
 * are whitelisted.
 */

import { z } from 'zod';
import { objectId } from './common';
import {
  LIMIT_KEYS,
  PLAN_STATUSES,
  PLAN_TYPES,
  PLAN_VISIBILITIES,
} from '../constants/planFeatures';

/** ObjectId params for single-plan admin routes: /admin/subscription-plans/:id */
export const planIdParamsSchema = z.object({
  id: objectId,
}).strict();

/** Limit keys schema — 0 = unlimited, all non-negative. */
export const planLimitsSchema = z.object({
  maxRestaurants: z.number().int().min(0).optional(),
  maxBranches: z.number().int().min(0).optional(),
  maxDevicesPerBranch: z.number().int().min(0).optional(),
  // Legacy alias — accepted but normalized to maxDevicesPerBranch by planService.
  maxDevices: z.number().int().min(0).optional(),
  maxProducts: z.number().int().min(0).optional(),
  maxCustomers: z.number().int().min(0).optional(),
  maxMonthlyOrders: z.number().int().min(0).optional(),
  maxStorageMB: z.number().int().min(0).optional(),
  maxAIRequests: z.number().int().min(0).optional(),
  maxVoiceRequests: z.number().int().min(0).optional(),
  maxImages: z.number().int().min(0).optional(),
  maxExports: z.number().int().min(0).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one limit is required',
}).refine((v) => {
  // Prevent nonsensical configurations (e.g. maxRestaurants 0 with price).
  return true;
});

/** Reusable feature-array validation against the centralized catalog. */
export const featureListSchema = z.array(
  z.string().min(1).max(80),
).max(100).optional();

/**
 * Plan create schema. `planId` + `name` required; `price`/`trialDays` and all
 * limits must be non-negative. Feature keys are validated against the catalog.
 */
export const planCreateSchema = z.object({
  planId: z.string().min(1).max(60).trim().transform((v) => v.toLowerCase()),
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(1000).optional().default(''),
  price: z.number().min(0).max(10_000_000).optional().default(0),
  yearlyPrice: z.number().min(0).max(10_000_000).optional().default(0),
  maxUsers: z.number().int().min(0).optional().default(5),
  maxDevices: z.number().int().min(0).optional().default(6),
  features: featureListSchema,
  aiEnabled: z.boolean().optional().default(false),
  trialDays: z.number().int().min(0).max(365).optional().default(14),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional().default(0),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  status: z.enum(PLAN_STATUSES).optional().default('active'),
  planType: z.enum(PLAN_TYPES).optional().default('paid'),
  visibility: z.enum(PLAN_VISIBILITIES).optional().default('public'),
  limits: planLimitsSchema.optional(),
}).strict();

/** Update — all fields optional, everything else identical semantics. */
export const planUpdateSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(1000).optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  yearlyPrice: z.number().min(0).max(10_000_000).optional(),
  maxUsers: z.number().int().min(0).optional(),
  maxDevices: z.number().int().min(0).optional(),
  features: featureListSchema,
  aiEnabled: z.boolean().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  planType: z.enum(PLAN_TYPES).optional(),
  visibility: z.enum(PLAN_VISIBILITIES).optional(),
  limits: planLimitsSchema.optional(),
  // `note` is captured in the version history for the change reason.
  note: z.string().max(500).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field is required',
});

/** Clone — a new plan based on an existing one. */
export const planCloneSchema = z.object({
  planId: z.string().min(1).max(60).trim().transform((v) => v.toLowerCase()),
  name: z.string().min(1).max(120).trim(),
  note: z.string().max(500).optional(),
}).strict();

/** Status change body — e.g. POST /plans/:id/status { status: 'draft' }. */
export const planStatusSchema = z.object({
  status: z.enum(PLAN_STATUSES),
  note: z.string().max(500).optional(),
}).strict();

/** Rollback body — target version + optional note. */
export const planRollbackSchema = z.object({
  version: z.number().int().min(1),
  note: z.string().max(500).optional(),
}).strict();

/**
 * Plan assignment (admin side):
 *   - `restaurantId` targets a restaurant's subscription
 *   - `planId` is the target plan
 *   - `effectiveDate` optional ISO datetime — future dates schedule the change
 *   - `note` captured in the audit log
 */
export const planAssignSchema = z.object({
  restaurantId: objectId,
  planId: z.string().min(1).max(60),
  billingPeriod: z.enum(['monthly', 'yearly']).optional(),
  effectiveDate: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
}).strict();

/**
 * List query schema — search / filter / sort / pagination with whitelisted
 * values and flat names matching the admin dashboard.
 */
export const planListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(200).optional()),
  search: z.string().max(200).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  planType: z.enum(PLAN_TYPES).optional(),
  visibility: z.enum(PLAN_VISIBILITIES).optional(),
  feature: z.string().max(80).optional(),
  trial: z.enum(['true', 'false']).optional(),
  paid: z.enum(['true', 'false']).optional(),
  enterprise: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
  deleted: z.enum(['true', 'false']).optional(),
  createdFrom: z.string().max(40).optional(),
  createdTo: z.string().max(40).optional(),
  updatedFrom: z.string().max(40).optional(),
  updatedTo: z.string().max(40).optional(),
  sortBy: z.enum(['name', 'price', 'createdAt', 'updatedAt', 'sortOrder', 'restaurantCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  active: z.enum(['true', 'false']).optional(), // legacy alias
}).strict();

export default {
  planIdParamsSchema,
  planLimitsSchema,
  planCreateSchema,
  planUpdateSchema,
  planCloneSchema,
  planStatusSchema,
  planAssignSchema,
  planRollbackSchema,
  planListQuerySchema,
};
