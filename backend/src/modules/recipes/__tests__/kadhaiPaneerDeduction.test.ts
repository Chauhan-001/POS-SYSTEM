/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KADHAI PANEER INVENTORY DEDUCTION REPRODUCTION
 *
 * Mirrors the production flow end-to-end:
 *   BILL (Kadhai Paneer Half/Full)
 *   → normalizeBillItems (menuItemId + variantName)
 *   → resolveEffectiveRecipe (exact variant)
 *   → recipeCostEngine.costRecipe (ingredient cost lines)
 *   → consumptionService.generateForBill (aggregate + applyMovement 'sale')
 *   → FIFO batch consumption
 *   → Product.currentStock / batches[] updated in the DB
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recipeService } from '../services/recipeService';
import { billService } from '../../../services';
import Recipe from '../models/Recipe';
import RecipeConsumption from '../models/RecipeConsumption';
import Product from '../../../models/Product';
import ProductVariant from '../../../models/ProductVariant';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import InventoryEvent from '../../../models/InventoryEvent';

const REST_A = new mongoose.Types.ObjectId().toString();
const BRANCH_A = new mongoose.Types.ObjectId().toString();

async function makeIngredient(name: string, unit: string, averageCost: number, currentStock = 10) {
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

const comp = (item: any, qty: number, unit: string) => ({
  inventoryItemId: String(item._id),
  itemName: item.name,
  unit,
  quantity: qty,
  wastagePercent: 0,
  optional: false,
});

async function variantRecipe(dish: any, variantName: string, components: any[]) {
  return recipeService.create(REST_A, {
    productId: String(dish._id),
    variantName,
    recipeMode: 'override',
    name: `${dish.name} (${variantName}) Recipe`,
    status: 'active',
    yieldQuantity: 1,
    yieldUnit: 'unit',
    components,
  }, { operator: 'owner' });
}

let invoiceSeq = 0;
function billPayload(items: any[], overrides: any = {}) {
  invoiceSeq += 1;
  return {
    invoiceNumber: `INV-KP-${invoiceSeq}`,
    ticketNumber: `T-KP-${invoiceSeq}`,
    date: '2026-08-12',
    time: '12:00',
    cashierName: 'Cashier',
    cashierRole: 'Cashier',
    subtotal: 120,
    gst: 0,
    grandTotal: 120,
    paymentMethod: 'Cash',
    orderType: 'Dine-in',
    branchId: BRANCH_A,
    items,
    ...overrides,
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
    ProductVariant.deleteMany({}).exec(),
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    InventoryEvent.deleteMany({}).exec(),
  ]);
});

async function stockOf(id: string): Promise<number> {
  const p = await Product.findById(id).lean().exec();
  return Number(p?.currentStock) || 0;
}

async function batchesOf(id: string): Promise<any[]> {
  const p = await Product.findById(id).lean().exec();
  return (p as any)?.batches || [];
}

describe('Kadhai Paneer — sale → variant recipe → ingredient consumption', () => {
  it('reproduces the production chain: multi-ingredient variant recipe consumed on sale', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 10); // 10 kg
    const gravy = await makeIngredient('Gravy', 'kg', 90, 5);
    const oil = await makeIngredient('Oil', 'L', 120, 3);
    const spices = await makeIngredient('Spices', 'g', 800, 1000);
    const dish = await makeMenuProduct('Kadhai Paneer', 280);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 180 });
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 280 });

    // Half: Paneer 150g, Gravy 50g, Oil 10ml, Spices 5g
    await variantRecipe(dish, 'Half', [
      comp(paneer, 150, 'g'),
      comp(gravy, 50, 'g'),
      comp(oil, 10, 'ml'),
      comp(spices, 5, 'g'),
    ]);
    // Full: Paneer 300g, Gravy 100g, Oil 20ml, Spices 8g
    await variantRecipe(dish, 'Full', [
      comp(paneer, 300, 'g'),
      comp(gravy, 100, 'g'),
      comp(oil, 20, 'ml'),
      comp(spices, 8, 'g'),
    ]);

    const pBefore = await stockOf(String(paneer._id));
    const gBefore = await stockOf(String(gravy._id));
    const oBefore = await stockOf(String(oil._id));
    const sBefore = await stockOf(String(spices._id));

    const bill = await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, selectedVariant: { name: 'Half', price: 180 }, quantity: 1, price: 180 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    expect(bill).toBeTruthy();
    // Half → Paneer 150g = 0.15 kg
    expect(await stockOf(String(paneer._id))).toBeCloseTo(pBefore - 0.15, 5);
    // Gravy 50g = 0.05 kg
    expect(await stockOf(String(gravy._id))).toBeCloseTo(gBefore - 0.05, 5);
    // Oil 10ml = 0.01 L
    expect(await stockOf(String(oil._id))).toBeCloseTo(oBefore - 0.01, 5);
    // Spices 5g (stock unit g)
    expect(await stockOf(String(spices._id))).toBeCloseTo(sBefore - 5, 5);

    const records = await RecipeConsumption.find({ restaurantId: REST_A }).lean().exec();
    expect(records.length).toBe(1);
    const rec: any = records[0];
    expect(String(rec.billId)).toBe(String((bill as any)._id));
    expect(rec.items.map((i: any) => i.itemName).sort()).toEqual(['Gravy', 'Oil', 'Paneer', 'Spices']);
    expect(rec.items.find((i: any) => i.itemName === 'Paneer').quantity).toBeCloseTo(0.15, 5);

    const sold = await InventoryEvent.find({ restaurantId: REST_A, type: 'sold' }).lean().exec();
    expect(sold.some((e: any) => e.item === 'Paneer')).toBe(true);
  });

  it('Half vs Full consume their OWN configured quantities', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 10);
    const dish = await makeMenuProduct('Kadhai Paneer', 280);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 180 });
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 280 });

    await variantRecipe(dish, 'Half', [comp(paneer, 150, 'g')]);
    await variantRecipe(dish, 'Full', [comp(paneer, 300, 'g')]);

    const before = await stockOf(String(paneer._id));

    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, selectedVariant: { name: 'Half', price: 180 }, quantity: 1, price: 180 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    // Half consumed 150g = 0.15 kg
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.15, 5);

    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, selectedVariant: { name: 'Full', price: 280 }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    // Full consumed 300g = 0.30 kg on top of the 0.15 kg
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.45, 5);

    // Each variant has its OWN recipe record (no shared/Default recipe).
    const halfRecipes = await Recipe.find({ productId: dish._id, variantName: 'Half', status: 'active' }).lean().exec();
    const fullRecipes = await Recipe.find({ productId: dish._id, variantName: 'Full', status: 'active' }).lean().exec();
    expect(halfRecipes.length).toBe(1);
    expect(fullRecipes.length).toBe(1);
    const halfPaneer = (halfRecipes[0] as any).components.find((c: any) => c.itemName === 'Paneer');
    const fullPaneer = (fullRecipes[0] as any).components.find((c: any) => c.itemName === 'Paneer');
    expect(halfPaneer.quantity).toBe(150);
    expect(fullPaneer.quantity).toBe(300);
  });

  it('quantity scaling: 3 × Half consumes 3 × 150g', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 10);
    const dish = await makeMenuProduct('Kadhai Paneer', 280);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 180 });
    await variantRecipe(dish, 'Half', [comp(paneer, 150, 'g')]);

    const before = await stockOf(String(paneer._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, selectedVariant: { name: 'Half', price: 180 }, quantity: 3, price: 540 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.45, 5); // 3 × 0.15 kg
  });

  it('FIFO: sale consumes the oldest remaining batch first, and the summary reflects it', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 7);
    const dish = await makeMenuProduct('Kadhai Paneer', 280);
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 280 });
    await variantRecipe(dish, 'Full', [comp(paneer, 300, 'g')]);

    // Seed two batches directly: A = 2kg (older), B = 5kg (newer)
    const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const d5 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await Product.updateOne({ _id: paneer._id }, {
      $set: {
        currentStock: 7,
        expiryDate: d2,
        batches: [
          { batchNumber: '', expiryDate: d2, quantity: 2, receivedDate: '2026-08-01', cost: 380 },
          { batchNumber: '', expiryDate: d5, quantity: 5, receivedDate: '2026-08-02', cost: 380 },
        ],
      },
    }).exec();

    // Sale consumes 300g = 0.3kg — from the 2kg batch (FIFO).
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, selectedVariant: { name: 'Full', price: 280 }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    const batches = await batchesOf(String(paneer._id));
    expect(String(batches[0].expiryDate)).toBe(d2); // oldest batch consumed first
    expect(Number(batches[0].quantity)).toBeCloseTo(1.7, 5); // 2 - 0.3
    expect(Number(batches[1].quantity)).toBe(5);
    expect(await stockOf(String(paneer._id))).toBeCloseTo(6.7, 5); // 7 - 0.3
    const fresh = await Product.findById(paneer._id).lean().exec();
    expect(String((fresh as any).expiryDate)).toBe(d2); // earliest REMAINING expiry
  });

  it('draft recipe does NOT consume; only an ACTIVE recipe does (the wizard now saves ACTIVE)', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 10);
    const dish = await makeMenuProduct('Kadhai Paneer', 280);

    // Draft recipe — sold units consume NOTHING.
    await recipeService.create(REST_A, {
      productId: String(dish._id),
      variantName: 'Default',
      recipeMode: 'override',
      name: `${dish.name} Recipe`,
      status: 'draft',
      yieldQuantity: 1,
      yieldUnit: 'unit',
      components: [comp(paneer, 150, 'g')],
    }, { operator: 'owner' });

    const before = await stockOf(String(paneer._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    // Draft → no ingredient consumption (legacy menu-product deduction instead).
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before, 5);
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(0);

    // Activate it → the NEXT sale consumes ingredients.
    const draft = await Recipe.findOne({ restaurantId: REST_A, productId: dish._id }).lean().exec();
    await recipeService.activate(REST_A, String((draft as any)._id), { operator: 'owner' });

    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Kadhai Paneer' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.15, 5);
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(1);
  });
});
