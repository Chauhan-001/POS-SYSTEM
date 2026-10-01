/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the variant-aware Recipe Editor model.
 *
 * Variant-only model: every recipe belongs to exactly one variant. No base
 * recipe, no inheritance.
 */

import { describe, expect, it } from 'vitest';
import {
  type EditorRecipe,
  cloneComponents,
  deriveVariantStatus,
  payloadFrom,
  targetRecipeFor,
  DEFAULT_VARIANT,
} from '../recipeEditorLogic';

const recipe = (over: Partial<EditorRecipe> & { _id: string; productId: string; variantName?: string }): EditorRecipe => ({
  productName: 'Kadhai Paneer',
  name: 'Kadhai Paneer Recipe',
  status: 'active',
  version: 1,
  yieldQuantity: 1,
  yieldUnit: 'unit',
  components: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const HALF = '66f0aaaa1111111111111111';
const FULL = '66f0bbbb2222222222222222';
const PRODUCT = '66f0cccc3333333333333333';

describe('recipeEditorLogic', () => {
  describe('targetRecipeFor', () => {
    it('returns the recipe for the requested variant, never another variant\'s', () => {
      const half = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Half' });
      const full = recipe({ _id: FULL, productId: PRODUCT, variantName: 'Full' });
      expect(targetRecipeFor(PRODUCT, 'Half', [half, full])?._id).toBe(HALF);
      expect(targetRecipeFor(PRODUCT, 'Full', [half, full])?._id).toBe(FULL);
    });

    it('returns null when the variant has no recipe (the editor must CREATE)', () => {
      const half = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Half' });
      expect(targetRecipeFor(PRODUCT, 'Full', [half])).toBeNull();
    });

    it('never targets the BASE recipe when editing a variant (identity is strict)', () => {
      const base = recipe({ _id: HALF, productId: PRODUCT }); // no variantName = base
      expect(targetRecipeFor(PRODUCT, 'Full', [base])).toBeNull();
    });

    it('excludes archived recipes — they are not editable targets', () => {
      const archived = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Half', status: 'archived' });
      expect(targetRecipeFor(PRODUCT, 'Half', [archived])).toBeNull();
    });

    it('prefers a DRAFT over an ACTIVE recipe for the same variant (copy-onto-active case)', () => {
      const active = recipe({ _id: FULL, productId: PRODUCT, variantName: 'Full', status: 'active', updatedAt: '2026-01-01T00:00:00.000Z' });
      const draft = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Full', status: 'draft', updatedAt: '2026-01-02T00:00:00.000Z' });
      expect(targetRecipeFor(PRODUCT, 'Full', [active, draft])?._id).toBe(HALF);
    });
  });

  describe('cloneComponents (copy independence)', () => {
    it('is a deep clone — mutating the copy never mutates the source', () => {
      const source = [
        { key: 'a', inventoryItemId: 'inv-1', itemName: 'Paneer', quantity: 150, unit: 'g', wastagePercent: 0, optional: false, componentType: 'ingredient' },
        { key: 'b', inventoryItemId: 'inv-2', itemName: 'Tomato', quantity: 100, unit: 'g', wastagePercent: 0, optional: false, componentType: 'ingredient' },
      ];
      const copy = cloneComponents(source);
      expect(copy).not.toBe(source);
      expect(copy[0]).not.toBe(source[0]);
      expect(copy[0].quantity).toBe(150);
      // Fresh keys — the copied rows are never the source rows.
      expect(copy[0].key).not.toBe(source[0].key);
      // Mutating the clone must not affect the source.
      copy[0].quantity = 999;
      expect(source[0].quantity).toBe(150);
    });

    it('returns an empty array for empty input', () => {
      expect(cloneComponents([])).toEqual([]);
      expect(cloneComponents(undefined as any)).toEqual([]);
    });
  });

  describe('payloadFrom', () => {
    it('scopes a save to exactly one variant (override mode, variantName always set)', () => {
      const variantPayload = payloadFrom(PRODUCT, 'Full', [{ inventoryItemId: 'inv-1', itemName: 'Paneer', unit: 'g', quantity: 250, componentType: 'ingredient', optional: false, wastagePercent: 0 }], 'Full Recipe');
      expect(variantPayload.variantName).toBe('Full');
      expect(variantPayload.recipeMode).toBe('override');

      const defaultPayload = payloadFrom(PRODUCT, DEFAULT_VARIANT, [{ inventoryItemId: 'inv-1', itemName: 'Paneer', unit: 'g', quantity: 150, componentType: 'ingredient', optional: false, wastagePercent: 0 }]);
      expect(defaultPayload.variantName).toBe(DEFAULT_VARIANT);
      expect(defaultPayload.recipeMode).toBe('override');
    });

    it('never copies another variant\'s identity into the payload', () => {
      const payload = payloadFrom(PRODUCT, 'Full', []);
      expect(payload.productId).toBe(PRODUCT);
      expect(payload.variantName).toBe('Full');
    });

    it('requires a variantName — the empty/base case no longer exists', () => {
      expect(() => payloadFrom(PRODUCT, '   ', [])).toThrow(/variantName is required/);
    });
  });

  describe('deriveVariantStatus', () => {
    it('reports active / draft / missing from real backend state (no inheritance)', () => {
      const active = recipe({ _id: FULL, productId: PRODUCT, variantName: 'Full', status: 'active' });
      const draft = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Half', status: 'draft' });
      expect(deriveVariantStatus(active)).toBe('active');
      expect(deriveVariantStatus(draft)).toBe('draft');
      expect(deriveVariantStatus(null)).toBe('missing');   // no recipe — never inherits
      expect(deriveVariantStatus(undefined)).toBe('missing');
    });

    it('archived recipes are not active/draft — they are missing', () => {
      const archived = recipe({ _id: HALF, productId: PRODUCT, variantName: 'Half', status: 'archived' });
      expect(deriveVariantStatus(archived)).toBe('missing');
    });
  });
});
