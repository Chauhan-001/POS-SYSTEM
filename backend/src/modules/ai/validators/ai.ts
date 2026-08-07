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
  employee: employeeSchema.optional(),
}).strict();
