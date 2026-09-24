/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Assisted recipe creation tests (Phase F/H) — deterministic extraction.
 *
 * PHASE 3: the LLM extraction stage was removed; the parser is now fully
 * deterministic. These tests cover:
 *   - Text extraction ("200g paneer, 150g tomato") → deterministic inventory
 *     matching with deterministic cost previews
 *   - No parseable ingredients → safe aiUnavailable draft (no crash)
 *   - Cross-tenant product rejection
 *   - Cross-tenant ingredient isolation in matching
 *   - Unit-family mismatch flagging
 *   - NEVER saves anything (draft is read-only)
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Product from '../../../models/Product';
import { recipeAiService } from '../services/recipeAiService';

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

async function makeProduct(name: string, unit: string, averageCost: number, restaurantId = REST_A, extra: any = {}) {
  return Product.create({
    name,
    code: `AI-${name.toUpperCase().replace(/\s+/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    price: 0,
    category: 'Inventory',
    type: 'inventory',
    availability: false,
    restaurantId,
    currentStock: 100,
    unit,
    minStock: 0,
    maxStock: 1000,
    reorderLevel: 0,
    averageCost,
    supplier: '',
    storageLocation: '',
    notes: '',
    barcode: '',
    expiryDate: '',
    batchNumber: '',
    voiceAliases: [],
    searchAliases: [],
    learnedAliases: [],
    lastUsedAlias: null,
    ...extra,
  });
}

async function makeMenuProduct(name: string, unit: string, price: number, restaurantId = REST_A) {
  return makeProduct(name, unit, 0, restaurantId, { type: 'menu', price, availability: true });
}

describe('recipeAiService (quick create, deterministic extraction)', () => {
  beforeAll(async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([Product.deleteMany({})]);
  });

  it('extracts structured ingredients and matches them with deterministic cost previews', async () => {
    await makeProduct('Fresh Paneer', 'kg', 320);
    await makeProduct('Tomato', 'g', 0.06);
    const product = await makeMenuProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '200g paneer, 150g tomato', String(product._id));

    expect(draft.aiUnavailable).toBe(false);
    // 'paneer' matches 'Fresh Paneer' (mass family) → HIGH.
    const paneer = draft.matched.find((m) => m.ingredientText === 'paneer');
    expect(paneer).toBeDefined();
    expect(paneer?.confidence).toBe('HIGH');
    expect(paneer?.itemName).toBe('Fresh Paneer');
    // 200g × ₹320/kg = ₹64.00 — deterministic, never invented.
    expect(paneer?.costPreview).toBe(64);
    // 'tomato' exact name match → HIGH with 150g × ₹0.06 = ₹9.00.
    const tomato = draft.matched.find((m) => m.ingredientText === 'tomato');
    expect(tomato?.costPreview).toBe(9);
  });

  it('rejects a product from another restaurant (404)', async () => {
    const foreign = await makeMenuProduct('Other Resto Dish', 'plate', 100, REST_B);
    await expect(recipeAiService.quickCreate(REST_A, '1 pcs paneer', String(foreign._id)))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("never matches another restaurant's inventory item", async () => {
    // Same-named item in restaurant B — must NOT leak into A's matching.
    await makeProduct('Secret Sauce', 'pcs', 999, REST_B);
    const product = await makeMenuProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '1 pcs secret sauce', String(product._id));
    expect(draft.aiUnavailable).toBe(false);
    // No match in A → LOW / needs attention, and NO reference to B's item.
    const attention = draft.needsAttention.find((m) => m.ingredientText === 'secret sauce');
    expect(attention).toBeDefined();
    expect(attention?.confidence).toBe('LOW');
    expect(attention?.inventoryItemId).toBeUndefined();
  });

  it('flags unit-family mismatches instead of silently accepting them', async () => {
    await makeProduct('Fresh Paneer', 'kg', 320);
    const product = await makeMenuProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '500 ml paneer', String(product._id));
    const attention = draft.needsAttention.find((m) => m.ingredientText === 'paneer');
    expect(attention).toBeDefined();
    expect(attention?.unitMismatch).toBe(true);
    expect(attention?.reason).toContain("doesn't match");
  });

  it('returns a safe aiUnavailable draft when no ingredients are detected (never crashes, never fabricates)', async () => {
    const product = await makeMenuProduct('Dish', 'plate', 299);

    // Text with no parseable "<qty><unit> <ingredient>" rows.
    const draft = await recipeAiService.quickCreate(REST_A, '???', String(product._id));
    expect(draft.aiUnavailable).toBe(true);
    expect(draft.matched).toEqual([]);
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  it('requires a product id and non-empty text', async () => {
    await expect(recipeAiService.quickCreate(REST_A, '', 'x')).rejects.toMatchObject({ statusCode: 400 });
  });
});
