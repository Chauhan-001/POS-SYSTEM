/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryDemandForecasting.test.ts — regression coverage for two defects
 * that silently disabled the inventory agent's forecasting tools:
 *
 *  1. `getInventoryItems` returns `expiryDate` as a 'YYYY-MM-DD' STRING (that
 *     is how the catalog stores it), but the engine called `.getTime()` on it.
 *     Every item with an expiry date threw a TypeError, and the tool's
 *     try/catch turned that into a false "expiry unavailable".
 *  2. `getMenuItemRecipes` read `recipe.ingredients`, while the canonical schema
 *     stores recipe lines in `components`. `recipe.ingredients` is undefined,
 *     so `.filter(...)` threw for every tenant with a real recipe.
 *
 * The tests assert the HONEST contract too: a check that ran and found nothing
 * (`assessed: true, alerts: []`) is different from a source that could not be
 * read (`assessed: false`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  assessExpiryRisk,
  assessStockoutRisk,
  generateExpiryAlerts,
} from '../inventoryDemandForecastingService';
import Product from '../../models/catalog/Product';
import Recipe from '../../modules/recipes/models/Recipe';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';

/** 'YYYY-MM-DD' (the catalog's storage format) N days from now. */
function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function makeInventoryItem(name: string, expiryDate: string) {
  return Product.create({
    restaurantId: R1,
    name,
    code: name.toUpperCase().replace(/\s+/g, '_'),
    price: 0,
    category: 'Raw material',
    availability: false,
    currentStock: 10,
    minStock: 2,
    maxStock: 50,
    unit: 'kg',
    averageCost: 40,
    expiryDate,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const oid = new mongoose.Types.ObjectId(R1);
  await Product.deleteMany({ restaurantId: oid });
  await Recipe.deleteMany({ restaurantId: oid });
});

describe('expiry assessment', () => {
  it('parses the catalog\'s string expiry date instead of throwing on .getTime()', async () => {
    await makeInventoryItem('Tomato', isoDay(3));

    // Pre-fix this rejected with "expiryDate.getTime is not a function".
    const assessment = await assessExpiryRisk(R1, undefined, 30);
    expect(assessment.assessed).toBe(true);
    expect(assessment.alerts).toHaveLength(1);
    const alert = assessment.alerts[0];
    expect(alert.ingredientName).toBe('Tomato');
    expect(alert.daysUntilExpiry).toBeGreaterThan(0);
    expect(alert.expiryDate).toBeInstanceOf(Date);
  });

  it('reports an assessed-but-empty result when nothing expires in the horizon', async () => {
    await makeInventoryItem('Rice', isoDay(200));

    const assessment = await assessExpiryRisk(R1, undefined, 30);
    // Expiry IS tracked here → a clean check, NOT "unavailable".
    expect(assessment.assessed).toBe(true);
    expect(assessment.alerts).toEqual([]);
  });

  it('reports NOT assessed when no item carries any expiry date', async () => {
    await makeInventoryItem('Blank', '');

    const assessment = await assessExpiryRisk(R1, undefined, 30);
    expect(assessment.assessed).toBe(false);
    expect(assessment.alerts).toEqual([]);
  });

  it('generateExpiryAlerts stays a thin alerts-only wrapper', async () => {
    await makeInventoryItem('Paneer', isoDay(2));
    const alerts = await generateExpiryAlerts(R1, undefined, 30);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });
});

describe('expiry assessment contract', () => {
  it('marks a tracked, clean source as assessed with no alerts', async () => {
    await makeInventoryItem('Rice', isoDay(200));

    const out = await assessExpiryRisk(R1, undefined, 30);
    expect(out.assessed).toBe(true);
    expect(out.alerts).toEqual([]);
  });

  it('marks an untracked source as not assessed', async () => {
    await makeInventoryItem('Blank', '');

    const out = await assessExpiryRisk(R1, undefined, 30);
    expect(out.assessed).toBe(false);
  });
});

describe('stockout assessment', () => {
  it('reads canonical recipes from `components` without throwing', async () => {
    await makeInventoryItem('Tomato', '');
    const ingredient = await Product.findOne({ restaurantId: new mongoose.Types.ObjectId(R1) }).lean();
    const menu = await Product.create({
      restaurantId: R1,
      name: 'Tomato Soup',
      code: 'TOMATO_SOUP',
      price: 120,
      category: 'Soup',
      availability: true,
      currentStock: 0,
      minStock: 0,
      maxStock: 0,
      unit: 'plate',
      averageCost: 0,
    });

    await Recipe.create({
      restaurantId: R1,
      productId: menu._id,
      productName: 'Tomato Soup',
      name: 'Tomato Soup',
      status: 'active',
      effectiveFrom: isoDay(0),
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [
        {
          inventoryItemId: ingredient!._id,
          itemName: 'Tomato',
          unit: 'kg',
          quantity: 0.5,
          normalizedQuantity: 0.5,
          normalizedUnit: 'kg',
          componentType: 'ingredient',
        },
      ],
    });

    // Pre-fix this rejected: recipe.ingredients was undefined → .filter() threw.
    const assessment = await assessStockoutRisk(R1, undefined, 14);
    expect(assessment).toBeTruthy();
    expect(Array.isArray(assessment.alerts)).toBe(true);
  });

  it('reports NOT assessed when there are no readable recipes', async () => {
    await makeInventoryItem('Tomato', '');
    const assessment = await assessStockoutRisk(R1, undefined, 14);
    expect(assessment.assessed).toBe(false);
  });

  it('the stockout assessment never throws and reports not assessed', async () => {
    await makeInventoryItem('Tomato', '');
    const out = await assessStockoutRisk(R1, undefined, 14);
    expect(out.assessed).toBe(false);
  });
});
