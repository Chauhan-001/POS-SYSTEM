/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recipeEditorLogic — PURE, testable helpers for the variant-aware Recipe
 * Editor. No React, no network — everything here can be unit-tested in
 * isolation so the "Half ≠ Full" invariants are provable at the model layer.
 *
 * Variant-only model: every recipe belongs to exactly ONE variant. There is no
 * base recipe and no inheritance. Products without variants use the virtual
 * 'Default' variant. Variant identity is the `variantName` STRING.
 */

/** Virtual variant used by products that have no real variants. */
export const DEFAULT_VARIANT = 'Default';

// ─── Recipe document shape (subset of the backend Recipe doc) ──────
export interface EditorRecipe {
  _id: string;
  productId: string;
  productName: string;
  variantName?: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  yieldQuantity: number;
  yieldUnit: string;
  servingSize?: number;
  components: any[];
  costSummary?: {
    recipeCost: number; foodCostPercent: number; contribution: number;
    contributionMarginPercent: number; perServingCost: number;
    estimatedVariableCost?: number; conservativeCost?: number;
  };
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Variant row in the editor's side panel ────────────────────────
export type VariantStatus = 'active' | 'draft' | 'missing';

export interface EditorVariant {
  name: string;
  price: number;
}

export interface EditorVariantStatus {
  name: string;
  price: number;
  status: VariantStatus;
  recipeId?: string;
}

/**
 * Per-variant recipe status, derived from the ACTUAL backend state
 * (non-archived recipe docs):
 *   - active override → 'active'
 *   - draft override  → 'draft'
 *   - no recipe       → 'missing' (no inheritance — variants must have their own recipe)
 */
export function deriveVariantStatus(
  variantRecipe: EditorRecipe | null | undefined
): VariantStatus {
  if (!variantRecipe) return 'missing';
  if (variantRecipe.status === 'active') return 'active';
  if (variantRecipe.status === 'draft') return 'draft';
  return 'missing';
}

/**
 * Which recipe document does a SAVE target for (productId, variantName)?
 * Returns the non-archived recipe for that variant — preferring a DRAFT
 * (work-in-progress) over an ACTIVE one when both exist (copy-onto-active
 * creates a draft alongside), and null when the variant has no recipe yet
 * (the editor must CREATE one). NEVER returns another variant's recipe.
 */
export function targetRecipeFor(
  productId: string,
  variantName: string,
  recipes: EditorRecipe[]
): EditorRecipe | null {
  const name = variantName || '';
  const matches = recipes.filter(
    (r) =>
      String(r.productId) === productId &&
      (r.variantName || '') === name &&
      r.status !== 'archived'
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aw = a.status === 'draft' ? 0 : 1;
    const bw = b.status === 'draft' ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return matches[0];
}

/**
 * Deep-clone recipe components with FRESH keys. Copying a variant's recipe
 * must never share mutable data with the source — changing the clone's
 * quantities after a copy must not touch the source variant.
 */
export function cloneComponents<T extends { key?: string }>(
  components: T[],
  prefix = 'copy'
): T[] {
  return (components || []).map((c, i) => ({
    ...(JSON.parse(JSON.stringify(c)) as T),
    key: `${prefix}_${Date.now().toString(36)}_${i}`,
  }));
}

/**
 * Build the save payload for (productId, variantName, components).
 * Every recipe is the 'override' of a specific variant. For products without
 * variants, the caller passes 'Default' as variantName.
 */
export function payloadFrom(
  productId: string,
  variantName: string,
  components: any[],
  name?: string
): Record<string, unknown> {
  const variant = variantName.trim();
  if (!variant) throw new Error('payloadFrom: variantName is required');
  return {
    productId,
    variantName: variant,
    recipeMode: 'override',
    name: name || undefined,
    yieldQuantity: 1,
    yieldUnit: 'unit',
    servingSize: 1,
    components: (components || []).map((c) =>
      c.componentType === 'sub_recipe'
        ? {
            componentType: 'sub_recipe' as const,
            subRecipeId: c.subRecipeId,
            itemName: c.itemName || 'Sub-recipe',
            unit: c.unit,
            quantity: Number(c.quantity) || 0,
            wastagePercent: Number(c.wastagePercent) || 0,
            optional: !!c.optional,
          }
        : {
            inventoryItemId: c.inventoryItemId,
            itemName: c.itemName || 'Ingredient',
            unit: c.unit,
            quantity: Number(c.quantity) || 0,
            wastagePercent: Number(c.wastagePercent) || 0,
            optional: !!c.optional,
          }
    ),
  };
}
