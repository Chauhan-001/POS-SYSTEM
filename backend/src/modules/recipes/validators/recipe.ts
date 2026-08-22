import { z } from 'zod';
import { objectId } from '../../../validation/common';

const componentSchema = z.object({
  inventoryItemId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  itemName: z.string().min(1).max(200).trim(),
  unit: z.string().min(1).max(20).trim(),
  quantity: z.number().min(0),
  componentType: z.enum(['ingredient', 'sub_recipe']).default('ingredient'),
  subRecipeId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  wastagePercent: z.number().min(0).max(100).default(0),
  optional: z.boolean().default(false),
  notes: z.string().max(500).optional(),
  sequence: z.number().min(0).optional(),
}).refine((c) => {
  if (c.componentType === 'sub_recipe') return !!c.subRecipeId;
  return !!c.inventoryItemId;
}, { message: 'A component needs an inventoryItemId (ingredient) or subRecipeId (sub-recipe)' });

const recipeFieldsSchema = z.object({
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  /**
   * Every recipe belongs to EXACTLY ONE variant — there is no base recipe.
   * Products without variants use the virtual 'Default' variant.
   */
  variantName: z.string().min(1).max(100).trim(),
  /** Recipe role is always 'override' (kept for data compatibility; base recipes no longer exist). */
  recipeMode: z.enum(['override']).default('override'),
  /** For override recipes: the base Recipe this variant customizes. */
  sourceRecipeId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'active']).default('draft'),
  effectiveFrom: z.string().max(20).optional(),
  yieldQuantity: z.number().min(0).default(1),
  yieldUnit: z.string().min(1).max(20).default('unit'),
  servingSize: z.number().min(1).optional(),
  preparationNotes: z.string().max(4000).optional(),
  components: z.array(componentSchema).max(200).default([]),
});

export const createRecipeSchema = recipeFieldsSchema.strict();
export const updateRecipeSchema = recipeFieldsSchema.partial().strict();

export const recipeQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
}).optional();

export const variantCopySchema = z.object({
  variantName: z.string().min(1).max(100).trim(),
  status: z.enum(['draft', 'active']).optional(),
}).strict();

export const effectiveQuerySchema = z.object({
  productId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  variantName: z.string().max(100).optional(),
}).optional();

export const recipeParamsSchema = z.object({ id: objectId }).strict();

export const recalcSchema = z.object({
  inventoryItemId: z.string().regex(/^[a-fA-F0-9]{24}$/),
}).strict();

export const dateRangeQuerySchema = z.object({
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
}).optional();

// ─── Restaurant-level cost settings (layered cost model) ──────────

export const costSettingsSchema = z.object({
  minorIngredientAllowance: z.number().min(0).max(1000).optional(),
  cookingAllowance: z.number().min(0).max(1000).optional(),
  wastagePercent: z.number().min(0).max(100).optional(),
  conservativeMarkupPercent: z.number().min(0).max(100).optional(),
  packaging: z.object({
    dineIn: z.number().min(0).max(1000).optional(),
    takeaway: z.number().min(0).max(1000).optional(),
    delivery: z.number().min(0).max(1000).optional(),
  }).optional(),
}).strict();
