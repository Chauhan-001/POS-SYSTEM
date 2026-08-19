/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Validation — Zod schemas for all AI API requests.
 * Validates that incoming data is well-formed before sanitization.
 */

import { z } from 'zod';

// ─── INVENTORY ITEM SCHEMA ─────────────────────────────────────────

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  currentStock: z.number().min(0),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).optional(),
  unit: z.string().optional(),
  averageCost: z.number().min(0).optional(),
  status: z.enum(['healthy', 'normal', 'low', 'critical']).optional(),
  expiryDate: z.string().optional(),
});

// ─── WASTE ENTRY SCHEMA ────────────────────────────────────────────

const wasteEntrySchema = z.object({
  item: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.string().optional(),
  reason: z.string().optional(),
  cost: z.number().min(0),
  date: z.string().optional(),
});

// ─── SALES DATA SCHEMA ─────────────────────────────────────────────

const salesDataSchema = z.object({
  totalRevenue: z.number(),
  orderCount: z.number(),
  itemCount: z.number().optional(),
  totalDiscount: z.number().optional(),
  totalGst: z.number().optional(),
  averageOrderValue: z.number().optional(),
  topItems: z.array(z.object({
    name: z.string(),
    qty: z.number(),
    revenue: z.number().optional(),
  })).optional(),
  paymentMethods: z.array(z.object({
    method: z.string(),
    amount: z.number(),
    count: z.number().optional(),
  })).optional(),
  categoryBreakdown: z.array(z.object({
    category: z.string(),
    qty: z.number(),
    revenue: z.number().optional(),
  })).optional(),
  date: z.string().optional(),
});

// ─── EMPLOYEE SCHEMA ───────────────────────────────────────────────

const employeeSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  branchId: z.string().optional(),
});

// ─── API REQUEST SCHEMAS ───────────────────────────────────────────

export const inventoryHealthSchema = z.object({
  items: z.array(inventoryItemSchema).min(1),
  wasteTotal: z.number().min(0),
  employee: employeeSchema.optional(),
}).strict();

export const purchaseRecSchema = z.object({
  items: z.array(inventoryItemSchema).min(1),
  employee: employeeSchema.optional(),
}).strict();

export const lowStockSchema = z.object({
  items: z.array(inventoryItemSchema).min(1),
  employee: employeeSchema.optional(),
}).strict();

export const dailySummarySchema = z.object({
  sales: salesDataSchema,
  lowStockCount: z.number().min(0),
  openOrderCount: z.number().min(0),
  wasteToday: z.number().min(0),
  customerCount: z.number().min(0),
  employee: employeeSchema.optional(),
}).strict();

export const wasteAnalysisSchema = z.object({
  wasteEntries: z.array(wasteEntrySchema),
  employee: employeeSchema.optional(),
}).strict();

export const voiceParseSchema = z.object({
  transcript: z.string().min(1).max(500),
  items: z.array(z.object({
    name: z.string().min(1),
    unit: z.string().optional(),
  })).optional(),
  employee: employeeSchema.optional(),
}).strict();

export const closingAssistantSchema = z.object({
  totalRevenue: z.number().min(0),
  orderCount: z.number().min(0),
  lowStockItems: z.number().min(0),
  wasteCost: z.number().min(0),
  employee: employeeSchema.optional(),
}).strict();

export const weatherSchema = z.object({
  city: z.string().optional(),
  employee: employeeSchema.optional(),
}).strict();

export const offerRecommendationsSchema = z.object({
  /** Phase 9 — optional branch scope for the recommendation (validated server-side). */
  branchId: z.string().optional(),
  totalRevenue: z.number().min(0).optional(),
  orderCount: z.number().min(0).optional(),
  averageOrderValue: z.number().min(0).optional(),
  topSellingCategories: z.array(z.object({
    name: z.string(),
    qty: z.number(),
    revenue: z.number(),
  })).optional(),
  lowStockItems: z.array(z.object({
    name: z.string(),
    currentStock: z.number(),
    minStock: z.number(),
  })).optional(),
  currentOffers: z.array(z.string()).optional(),
  customerCount: z.number().min(0).optional(),
  weather: z.object({
    condition: z.string(),
    temperature: z.number(),
  }).optional(),
  /** Explicit user refresh → bypass the AI cache (Phase 3). */
  bustCache: z.boolean().optional().default(false),
  employee: employeeSchema.optional(),
}).strict();

// ─── MARKETING (Create-with-AI) ──────────────────────────────────

const offerTypeEnum = z.enum([
  'percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback',
  'reward_points', 'coupon', 'festival', 'referral', 'loyalty_bonus',
]);

/** Request schema for POST /api/ai/marketing/generate. */
export const marketingGenerateSchema = z.object({
  /** The owner's goal in natural language, e.g. "bring back customers who haven't visited in a month". */
  request: z.string().min(3, 'Describe your goal in a few words').max(500),
  tone: z.enum(['friendly', 'premium', 'exciting', 'simple', 'festive']).optional(),
  language: z.enum(['en', 'hi', 'hi-en']).optional(),
  /** Explicit user "Regenerate" → bypass the AI cache (Phase 3). */
  bustCache: z.boolean().optional().default(false),
}).strict();

/**
 * Server-side contract for the LLM's marketing plan output (Phase 9).
 * LLM output is UNTRUSTED input — every field is validated, bounded and
 * defaulted here before it can be shown to the owner or saved to MongoDB.
 */
export const marketingPlanSchema = z.object({
  objective: z.string().max(500),
  summaryInsight: z.string().max(500).optional().default(''),
  offer: z.object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    type: offerTypeEnum,
    value: z.number().min(0).max(1_000_000),
    minOrderValue: z.number().min(0).max(10_000_000).nullable().optional(),
    maxDiscount: z.number().min(0).max(1_000_000).nullable().optional(),
  }),
  audience: z.object({
    type: z.string().max(20).optional().default('segment'),
    segmentNames: z.array(z.string().max(120)).optional().default([]),
  }),
  messages: z.object({
    whatsapp: z.string().max(500).optional().default(''),
    sms: z.string().max(300).optional().default(''),
    push: z.string().max(200).optional().default(''),
    emailSubject: z.string().max(200).optional().default(''),
    emailBody: z.string().max(2000).optional().default(''),
  }),
  schedule: z.object({ type: z.string().max(20).optional().default('now') }).optional(),
  reason: z.string().max(1000).optional().default(''),
  estimatedImpact: z.string().max(500).optional().default(''),
}).strict();

/** Request schema for POST /api/ai/offer-copy (Offer Builder copy fields). */
export const offerCopySchema = z.object({
  type: offerTypeEnum,
  value: z.number().min(0).max(1_000_000),
  discountValue: z.string().max(100).optional(),
  applicableCategories: z.array(z.string().max(100)).optional().default([]),
  targetAudience: z.string().max(200).optional().default('all customers'),
  reason: z.string().max(500).optional().default('promotion'),
  minOrderValue: z.number().min(0).max(10_000_000).optional(),
  durationDays: z.number().int().min(1).max(365).optional().default(7),
  /** Phase 4 — the copy style + language the owner picked (Studio/Create/Promote). */
  tone: z.enum(['friendly', 'funky', 'zomato', 'professional', 'premium', 'festive', 'genz', 'minimal']).optional().default('friendly'),
  language: z.enum(['en', 'hi', 'hinglish']).optional().default('en'),
  /** Explicit user action (Regenerate / Generate again) → bypass the AI cache. */
  bustCache: z.boolean().optional().default(false),
}).strict();

/**
 * Server-side contract for the ONE consolidated LLM copy response (Phase 2).
 * All five fields are validated and bounded before they can reach the UI.
 */
export const offerCopyOutputSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  whatsapp: z.string().min(1).max(300),
  sms: z.string().min(1).max(200),
  push: z.string().min(1).max(160),
}).strict();
