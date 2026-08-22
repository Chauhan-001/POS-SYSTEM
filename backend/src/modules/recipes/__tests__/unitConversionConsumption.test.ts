/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UNIT CONVERSION THROUGH THE REAL CONSUMPTION PATH
 *
 * Recipe ingredient units (g / ml / kg / L) vs the inventory item's stored
 * unit (kg / g / L / ml). The cost engine converts the recipe quantity into
 * the ITEM's unit and the stock movement deducts that converted amount — so a
 * recipe in grams correctly reduces a kilogram-tracked inventory item.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recipeService } from '../services/recipeService';
import { billService } from '../../../services';
import { convertQuantity, normalizeUnit, canConvert } from '../services/unitConversion';
import Recipe from '../models/Recipe';
import RecipeConsumption from '../models/RecipeConsumption';
import Product from '../../../models/Product';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import InventoryEvent from '../../../models/InventoryEvent';

const REST_A = new mongoose.Types.ObjectId().toString();
const BRANCH_A = new mongoose.Types.ObjectId().toString();

async function makeIngredient(name: string, unit: string, averageCost: number, currentStock = 100) {
  return Product.create({
    name,
    code: `INV-${name.toUpperCase().replace(/\s+/g, '')}`,
    price: 0,
    category: 'Inventory',
    type: 'inventory',
    availability: false,
    restaurantId: REST_A,
    currentStock,
    unit,
    minStock: 0,
    maxStock: 1000,
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
    isDeleted: false,
    batches: [],
  } as any);
}

async function makeMenuProduct(name: string, price: number) {
  return Product.create({
    name,
    code: `MNU-${name.toUpperCase().replace(/\s+/g, '')}`,
    price,
    category: 'Main Course',
    availability: true,
    restaurantId: REST_A,
    currentStock: 0,
    unit: 'pcs',
    minStock: 0,
    maxStock: 1000,
    averageCost: 0,
    supplier: '',
    storageLocation: '',
    notes: '',
    barcode: '',
    expiryDate: '',
    batchNumber: '',
    voiceAliases: [],
    searchAliases: [],
    learnedAliases: [],
    isDeleted: false,
    batches: [],
  } as any);
}

async function activeRecipe(dish: any, components: any[]) {
  return recipeService.create(REST_A, {
    productId: String(dish._id),
    variantName: 'Default',
    recipeMode: 'override',
    name: `${dish.name} Recipe`,
    status: 'active',
    yieldQuantity: 1,
    yieldUnit: 'unit',
    components,
  }, { operator: 'owner' });
}

let invoiceSeq = 0;
function billPayload(items: any[]) {
  invoiceSeq += 1;
  return {
    invoiceNumber: `INV-UC-${invoiceSeq}`,
    ticketNumber: `T-UC-${invoiceSeq}`,
    date: '2026-08-12',
    time: '12:00',
    cashierName: 'Cashier',
    cashierRole: 'Cashier',
    subtotal: 100,
    gst: 0,
    grandTotal: 100,
    paymentMethod: 'Cash',
    orderType: 'Dine-in',
    branchId: BRANCH_A,
    items,
  };
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 60_000);
beforeEach(async () => {
  invoiceSeq = 0;
  await Promise.all([
    Recipe.deleteMany({}).exec(),
    RecipeConsumption.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    InventoryEvent.deleteMany({}).exec(),
  ]);
});

async function stockOf(id: string): Promise<number> {
  const p = await Product.findById(id).lean().exec();
  return Number(p?.currentStock) || 0;
}

describe('Unit conversion — recipe unit vs inventory unit', () => {
  it('convertQuantity: 150 g → 0.15 kg', () => {
    expect(convertQuantity(150, 'g', 'kg')).toBe(0.15);
  });
  it('convertQuantity: 0.25 kg → 250 g', () => {
    expect(convertQuantity(0.25, 'kg', 'g')).toBe(250);
  });
  it('convertQuantity: 10 ml → 0.01 L', () => {
    expect(convertQuantity(10, 'ml', 'L')).toBe(0.01);
  });
  it('convertQuantity: 2 L → 2000 ml', () => {
    expect(convertQuantity(2, 'L', 'ml')).toBe(2000);
  });
  it('convertQuantity: incompatible units throw (500 ml on a kg item)', () => {
    expect(() => convertQuantity(500, 'ml', 'kg')).toThrow(/incompatible/i);
  });
  it('normalizeUnit canonicalizes mg → mg (not g)', () => {
    expect(normalizeUnit('mg')).toBe('mg');
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('milliliters')).toBe('ml');
  });

  it('recipe in grams → inventory in kg: sale deducts the converted kg amount', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 10);
    const dish = await makeMenuProduct('Paneer Masala', 280);
    await activeRecipe(dish, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 150, wastagePercent: 0, optional: false },
    ]);

    const before = await stockOf(String(paneer._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // 150 g = 0.15 kg deducted from the kg-tracked item.
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.15, 5);
  });

  it('recipe in kg → inventory in g: sale deducts the converted gram amount', async () => {
    const salt = await makeIngredient('Salt', 'g', 2, 5000);
    const dish = await makeMenuProduct('Garlic Bread', 150);
    await activeRecipe(dish, [
      { inventoryItemId: String(salt._id), itemName: 'Salt', unit: 'kg', quantity: 0.25, wastagePercent: 0, optional: false },
    ]);

    const before = await stockOf(String(salt._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Garlic Bread' }, quantity: 2, price: 150 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // 2 × 0.25 kg = 0.5 kg = 500 g deducted from the g-tracked item.
    expect(await stockOf(String(salt._id))).toBeCloseTo(before - 500, 5);
  });

  it('recipe in ml → inventory in L: sale deducts the converted litre amount', async () => {
    const cream = await makeIngredient('Cream', 'L', 300, 10);
    const dish = await makeMenuProduct('Coffee', 80);
    await activeRecipe(dish, [
      { inventoryItemId: String(cream._id), itemName: 'Cream', unit: 'ml', quantity: 30, wastagePercent: 0, optional: false },
    ]);

    const before = await stockOf(String(cream._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Coffee' }, quantity: 3, price: 80 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // 3 × 30 ml = 90 ml = 0.09 L deducted.
    expect(await stockOf(String(cream._id))).toBeCloseTo(before - 0.09, 5);
  });

  it('recipe in same unit → no conversion drift (g → g)', async () => {
    const spices = await makeIngredient('Spices', 'g', 800, 1000);
    const dish = await makeMenuProduct('Masala Dish', 120);
    await activeRecipe(dish, [
      { inventoryItemId: String(spices._id), itemName: 'Spices', unit: 'g', quantity: 5, wastagePercent: 0, optional: false },
    ]);

    const before = await stockOf(String(spices._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Masala Dish' }, quantity: 4, price: 120 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // 4 × 5 g = 20 g deducted directly (no conversion).
    expect(await stockOf(String(spices._id))).toBeCloseTo(before - 20, 5);
  });

  it('canConvert reports false for cross-family units', () => {
    expect(canConvert('g', 'kg')).toBe(true);
    expect(canConvert('ml', 'L')).toBe(true);
    expect(canConvert('g', 'ml')).toBe(false);
    expect(canConvert('kg', 'pcs')).toBe(false);
  });
});
