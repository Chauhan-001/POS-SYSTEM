import { z } from 'zod';
import { nonEmptyString, optString, optBool, optNonNegative, objectId, phone as phoneSchema, dateString } from './common';

const customerGender = z.enum(['Male', 'Female', 'Other']).optional();
const preferredPayment = z.enum(['Cash', 'UPI', 'Card', 'Wallet', 'Split']).optional();

export const createCustomerSchema = z.object({
  phone: phoneSchema,
  name: nonEmptyString.max(200),
  email: z.string().email().max(200).optional(),
  // Loyalty hints are IGNORED by the server (server-authoritative) — accepted
  // for backward compatibility with the legacy POS payload.
  points: optNonNegative,
  visits: z.number().int().min(0).optional(),
  birthday: dateString.or(z.string().max(20)).optional(),
  anniversary: dateString.or(z.string().max(20)).optional(),
  lastVisit: z.string().max(20).optional(),
  notes: optString,
  isBlocked: optBool,
  // ── Extended CRM profile ──────────────────────────────────
  gender: customerGender,
  address: optString,
  city: optString,
  state: optString,
  country: optString,
  gstNumber: optString,
  profilePhoto: optString,
  tags: z.array(z.string().max(50)).optional(),
  preferredPaymentMethod: preferredPayment,
  favoriteItems: z.array(z.string().max(200)).optional(),
  favoriteCategories: z.array(z.string().max(200)).optional(),
  marketingOptIn: optBool,
  taxExemption: optBool,
  isVip: optBool,
  referralCode: z.string().max(20).optional(),
  referredBy: z.string().max(20).optional(),
}).strict();

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerQuerySchema = z.object({
  search: optString,
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  gstNumber: optString,
  referralCode: z.string().max(20).optional(),
  tag: optString,
  tier: z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']).optional(),
  status: z.enum(['active', 'blocked', 'dormant', 'deleted']).optional(),
  isVip: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z.enum(['name', 'points', 'totalSpend', 'visits', 'lastVisit', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
}).optional();

export const customerParamsSchema = z.object({
  id: z.string().regex(/^([a-fA-F0-9]{24}|\d{10,15})$/, 'Invalid customer ID — must be ObjectId or 10-15 digit phone'),
}).strict();

export const customerMergeSchema = z.object({
  primaryId: objectId,
  duplicateId: objectId,
}).strict();

export const customerImportSchema = z.object({
  customers: z.array(z.object({
    phone: phoneSchema,
    name: nonEmptyString.max(200),
    email: z.string().email().max(200).optional(),
    birthday: z.string().max(20).optional(),
    anniversary: z.string().max(20).optional(),
    gender: customerGender,
    address: optString,
    city: optString,
    state: optString,
    country: optString,
    gstNumber: optString,
    notes: optString,
    tags: z.array(z.string().max(50)).optional(),
    marketingOptIn: optBool,
  })).min(1).max(5000),
  mode: z.enum(['skip', 'update']).default('skip'),
}).strict();

export const customerBlockSchema = z.object({
  block: z.boolean(),
  reason: optString,
}).strict();

export const customerActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).optional();
