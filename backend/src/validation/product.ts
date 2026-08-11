import { z } from 'zod';
import { nonEmptyString, requiredNonNegative, optString, optBool, objectId } from './common';

const aliasListSchema = z.array(z.string().min(1).max(200).trim()).max(200).default([]);

const learnedAliasSchema = z.object({
  alias: z.string().min(1).max(200).trim(),
  source: z.enum(['transcript', 'correction', 'ai_generated']).default('transcript'),
  usageCount: z.number().min(0).default(0),
  lastUsed: z.date().optional(),
  restaurantId: z.string().optional(),
});

export const createProductSchema = z.object({
  name: nonEmptyString.max(200),
  code: z.string().min(1).max(50),
  price: requiredNonNegative.max(999999),
  category: nonEmptyString.max(100),
  image: z.string().max(2000).optional(),
  gstPercent: z.number().min(0).max(100).optional(),
  availability: z.boolean().optional(),
  favorite: z.boolean().optional(),
  branchPrice: z.record(z.string(), z.number().min(0)).optional(),
  // ─── Inventory Fields ─────────────────────────────────────────
  currentStock: z.number().min(0).optional(),
  unit: z.string().max(20).optional(),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).optional(),
  reorderLevel: z.number().min(0).optional(),
  averageCost: z.number().min(0).optional(),
  supplier: z.string().max(200).optional(),
  storageLocation: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  barcode: z.string().max(100).optional(),
  expiryDate: z.string().max(20).optional(),
  batchNumber: z.string().max(100).optional(),
  // ─── Voice Inventory Resolution Fields ───────────────────────────
  voiceAliases: aliasListSchema.optional(),
  searchAliases: aliasListSchema.optional(),
  learnedAliases: z.array(learnedAliasSchema).max(500).optional(),
  lastUsedAlias: z.string().max(200).optional(),
  aliasUsageCount: z.number().min(0).optional(),
  variants: z.array(z.object({
    name: nonEmptyString.max(100),
    price: requiredNonNegative.max(999999),
    // Per-branch variant price overrides (branchId → price) — mirrors the
    // product-level branchPrice so variant prices can differ per branch too.
    branchPrice: z.record(z.string(), z.number().min(0)).optional(),
  })).max(50).optional(),
  // In-place per-variant branch price updates: variantName → branchId → price.
  // Applied to the existing ProductVariant docs without replacing the whole
  // variant set (unlike `variants`, which is a wholesale replace).
  variantBranchPrices: z.record(
    z.string().min(1).max(100),
    z.record(z.string(), z.number().min(0)).optional(),
  ).refine((m) => Object.keys(m).length <= 50, {
    message: 'Too many variant price entries (max 50)',
  }).optional(),
}).strict();

export const updateProductSchema = createProductSchema.partial();

export const aliasManagementSchema = z.object({
  /** Add aliases to an existing product (auto-deduplicated). */
  addVoiceAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
  addSearchAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
  /** Replace the full alias list. */
  setVoiceAliases: z.array(z.string().min(1).max(200).trim()).max(200).optional(),
  setSearchAliases: z.array(z.string().min(1).max(200).trim()).max(200).optional(),
  /** Remove specific aliases. */
  removeVoiceAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
  removeSearchAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
  /** Approve or reject AI-generated aliases (by exact alias string). */
  approveAiAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
  rejectAiAliases: z.array(z.string().min(1).max(200).trim()).max(100).optional(),
}).refine(
  (d) => Object.values(d).some((v) => Array.isArray(v) && v.length > 0),
  { message: 'At least one alias operation is required' }
);

export const adjustStockSchema = z.object({
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  /** Signed quantity change (+ in, − out). */
  delta: z.number().refine((v) => v !== 0, { message: 'delta must be non-zero' }),
  type: z.enum(['purchase', 'sale', 'waste', 'adjustment', 'opening', 'closing', 'correction', 'return']).optional(),
  reason: z.string().max(300).optional(),
  details: z.string().max(500).optional(),
  unit: z.string().max(20).optional(),
  purchasePrice: z.number().min(0).optional(),
}).strict();

export const productQuerySchema = z.object({
  category: optString,
  availability: z.enum(['true', 'false']).optional(),
}).optional();

export const productParamsSchema = z.object({
  id: objectId,
}).strict();

