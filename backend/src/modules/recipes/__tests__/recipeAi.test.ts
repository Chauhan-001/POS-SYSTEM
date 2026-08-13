/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI-assisted recipe creation tests (Phase F/H):
 *   - LLM structured extraction → deterministic inventory matching
 *   - AI unavailable / malformed output → safe aiUnavailable draft (no crash)
 *   - Cross-tenant product rejection
 *   - Cross-tenant ingredient isolation in matching
 *   - NEVER saves anything (draft is read-only)
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Mock the LLM provider BEFORE importing the service so the import picks it up.
const completeMock = vi.hoisted(() => vi.fn());
vi.mock('../../ai/provider/llmProvider', () => ({
  complete: completeMock,
}));

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

describe('recipeAiService (quick create)', () => {
  beforeAll(async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    completeMock.mockReset();
    await Promise.all([Product.deleteMany({})]);
  });

  it('extracts structured ingredients and matches them with deterministic cost previews', async () => {
    completeMock.mockResolvedValueOnce({
      content: JSON.stringify([
        { ingredientText: 'paneer', quantity: 200, unit: 'g' },
        { ingredientText: 'tomato', quantity: 150, unit: 'g' },
      ]),
    });
    await makeIngredientOrProduct(REST_A, 'Fresh Paneer', 'kg', 320);
    await makeIngredientOrProduct(REST_A, 'Tomato', 'g', 0.06);
    const product = await makeProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '200g paneer, 150g tomato', String(product._id));

    expect(draft.aiUnavailable).toBe(false);
    // 'paneer' matches 'Fresh Paneer' (mass family) → HIGH.
    const paneer = draft.matched.find((m) => m.ingredientText === 'paneer');
    expect(paneer).toBeDefined();
    expect(paneer?.confidence).toBe('HIGH');
    expect(paneer?.itemName).toBe('Fresh Paneer');
    // 200g × ₹320/kg = ₹64.00 — deterministic, not LLM-invented.
    expect(paneer?.costPreview).toBe(64);
    // 'tomato' exact name match → HIGH with 150g × ₹0.06 = ₹9.00.
    const tomato = draft.matched.find((m) => m.ingredientText === 'tomato');
    expect(tomato?.costPreview).toBe(9);
  });

  it('rejects a product from another restaurant (404)', async () => {
    completeMock.mockResolvedValueOnce({ content: JSON.stringify([{ ingredientText: 'paneer', quantity: 1, unit: 'pcs' }]) });
    const foreign = await makeProduct('Other Resto Dish', 'plate', 100, REST_B);
    await expect(recipeAiService.quickCreate(REST_A, '1 pcs paneer', String(foreign._id)))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('never matches another restaurant\'s inventory item', async () => {
    completeMock.mockResolvedValueOnce({ content: JSON.stringify([{ ingredientText: 'secret sauce', quantity: 1, unit: 'pcs' }]) });
    // Same-named item in restaurant B — must NOT leak into A's matching.
    await makeIngredientOrProduct(REST_B, 'Secret Sauce', 'pcs', 999);
    const product = await makeProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '1 pcs secret sauce', String(product._id));
    expect(draft.aiUnavailable).toBe(false);
    // No match in A → LOW / needs attention, and NO reference to B's item.
    const attention = draft.needsAttention.find((m) => m.ingredientText === 'secret sauce');
    expect(attention).toBeDefined();
    expect(attention?.confidence).toBe('LOW');
    expect(attention?.inventoryItemId).toBeUndefined();
  });

  it('flags unit-family mismatches instead of silently accepting them', async () => {
    completeMock.mockResolvedValueOnce({ content: JSON.stringify([{ ingredientText: 'paneer', quantity: 500, unit: 'ml' }]) });
    await makeIngredientOrProduct(REST_A, 'Fresh Paneer', 'kg', 320);
    const product = await makeProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '500 ml paneer', String(product._id));
    const attention = draft.needsAttention.find((m) => m.ingredientText === 'paneer');
    expect(attention).toBeDefined();
    expect(attention?.unitMismatch).toBe(true);
    expect(attention?.reason).toContain('doesn\'t match');
  });

  it('returns a safe aiUnavailable draft when the LLM fails (never crashes, never fabricates)', async () => {
    completeMock.mockRejectedValueOnce(new Error('provider down'));
    const product = await makeProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '200g paneer', String(product._id));
    expect(draft.aiUnavailable).toBe(true);
    expect(draft.matched).toEqual([]);
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  it('treats malformed LLM output as unavailable (Zod guard)', async () => {
    completeMock.mockResolvedValueOnce({ content: 'not json at all {{{' });
    const product = await makeProduct('Dish', 'plate', 299);

    const draft = await recipeAiService.quickCreate(REST_A, '200g paneer', String(product._id));
    expect(draft.aiUnavailable).toBe(true);
    expect(draft.matched).toEqual([]);
  });

  it('requires a product id and non-empty text', async () => {
    await expect(recipeAiService.quickCreate(REST_A, '', 'x')).rejects.toMatchObject({ statusCode: 400 });
  });
});

/** Helper — ingredient products share the Product collection. */
async function makeIngredientOrProduct(restaurantId: string, name: string, unit: string, averageCost: number) {
  return makeProduct(name, unit, averageCost, restaurantId);
}
