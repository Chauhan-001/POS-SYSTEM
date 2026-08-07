/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * restaurant.ts — Zod validation for the Restaurant Management module.
 *
 * All admin restaurant mutation routes must validate against these schemas
 * BEFORE reaching the controller. Schemas are permissive (passthrough) on
 * create/update so the existing admin-dashboard payloads keep working while
 * validating the typed fields we care about.
 */

import { z } from 'zod';
import { objectId, optString, optBool } from './common';

/** Supported onboarding modes — see adminRestaurantsController.createRestaurant. */
export const onboardingModeSchema = z.enum(['cash', 'trial', 'create_only']);

const restaurantBaseFields = {
  name: optString,
  restaurantName: optString,
  legalName: optString,
  brandName: optString,
  restaurantType: optString,
  cuisineType: optString,
  phone: optString,
  altPhone: optString,
  email: optString,
  website: optString,
  description: optString,
  notes: optString,
  extraInfo: optString,
  gst: optString,
  fssai: optString,
  pan: optString,
  businessRegNumber: optString,
  ownerName: optString,
  ownerPhone: optString,
  ownerEmail: optString,
  emergencyContact: optString,
  identityType: optString,
  identityNumber: optString,
  address: optString,
  area: optString,
  district: optString,
  city: optString,
  state: optString,
  country: optString,
  pinCode: optString,
  latitude: optString,
  longitude: optString,
  timezone: optString,
  currency: optString,
  printerType: optString,
  receiptWidth: optString,
  taxMode: optString,
  plan: optString,
};

const restaurantFlagFields = {
  gstEnabled: optBool,
  offlineMode: optBool,
  aiEnabled: optBool,
  loyaltyEnabled: optBool,
  weatherEnabled: optBool,
  maxDevices: z.number().int().min(1).max(1000).optional(),
  isActive: optBool,
  onboardingMode: onboardingModeSchema.optional(),
};

/** Create restaurant — typed fields are light validation; unknown fields pass through. */
export const createRestaurantSchema = z.object({
  ...restaurantBaseFields,
  ...restaurantFlagFields,
}).passthrough();

/** Update restaurant — read allows partial updates; account / security fields are rejected. */
export const updateRestaurantSchema = z.object({
  ...restaurantBaseFields,
  ...restaurantFlagFields,
}).passthrough();

/** Params for single-resource admin routes. */
export const restaurantIdParamsSchema = z.object({
  id: objectId,
}).strict();

/** Restaurant status change request. */
export const restaurantStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'pending']).optional(),
}).passthrough();

/**
 * List query schema. Keeps flat field names that the admin dashboard sends:
 *   page, limit, search, status, plan, sortBy, sortOrder,
 * plus newer filters: createdFrom/createdTo, lastActiveFrom, deleted, onTrial.
 * Unknown query keys are stripped (strict) so clients can't inject arbitrary
 * Mongo operators through req.query.
 */
export const restaurantListQuerySchema = z.object({
  page: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(1e6)).optional(),
  limit: z.preprocess((v) => parseInt(String(v), 10), z.number().int().min(1).max(100).optional()),
  search: optString,
  owner: optString,
  status: z.enum(['active', 'inactive', 'suspended', 'pending', 'trial', 'expired']).optional(),
  plan: optString,
  sortBy: optString,
  sortOrder: z.enum(['asc', 'desc']).optional(),
  createdFrom: optString,
  createdTo: optString,
  lastActiveFrom: optString,
  deleted: z.enum(['true', 'false']).optional(),
}).strict();

/** Internal defaults and derived values used by the service. */
export const restaurantInternalSchema = z.object({
  plan: optString,
  maxDevices: z.number().optional(),
  onboardingMode: onboardingModeSchema.optional(),
  features: z.array(z.string()).optional(),
});

export default {
  createRestaurantSchema,
  updateRestaurantSchema,
  restaurantIdParamsSchema,
  restaurantStatusSchema,
  restaurantListQuerySchema,
};