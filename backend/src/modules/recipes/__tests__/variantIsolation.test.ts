/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Variant Recipe ISOLATION tests — the non-negotiable invariants for the
 * Recipe Editor redesign (VARIANT-ONLY model — no base recipes, no inheritance):
 *
 *   - Each variant owns an INDEPENDENT recipe document. update(Half) must
 *     never change Full, and update(Full) must never change Half.
 *   - Copy (Half → Full) produces a deep-cloned INDEPENDENT draft; editing
 *     Full afterwards must never mutate Half.
 *   - Delete targets exactly one variant's recipe.
 *   - Costing uses the VARIANT's selling price (Half ₹120 vs Full ₹179.98).
 *   - Billing consumes the exact variant's recipe.
 *   - Non-variant products consume via the virtual 'Default' variant.
 *   - Draft overrides are surfaced as 'draft' in the Recipe Manager status.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recipeService } from '../services/recipeService';
import { recipeResolutionService } from '../services/recipeResolutionService';
import { consumptionService } from '../services/consumptionService';
import { recipeCostEngine } from '../services/recipeCostEngine';
import Recipe from '../models/Recipe';
import RecipeConsumption from '../models/RecipeConsumption';
import Product from '../../../models/Product';
import ProductVariant from '../../../models/ProductVariant';
import Bill from '../../../models/Bill';
import InventoryEvent from '../../../models/InventoryEvent';

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

type ProductDoc = any;

async function makeIngredient(name: string, unit: string, averageCost: number, currentStock = 100000, restaurantId = REST_A): Promise<ProductDoc> {
  return Product.create({
    name,
    code: `INV-${name.toUpperCase().replace(/\s+/g, '')}`,
    price: 0,
    category: 'Inventory',
    type: 'inventory',
    availability: false,
    restaurantId,
    currentStock,
    unit,
    minStock: 0,
    maxStock: 100000,
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
    aliasUsageCount: 0,
    isDeleted: false,
    deletedAt: null,
  } as any);
}

async function makeMenuProduct(name: string, price: number, restaurantId = REST_A): Promise<ProductDoc> {
  return Product.create({
    name,
    code: `MNU-${name.toUpperCase().replace(/\s+/g, '')}`,
    price,
    category: 'Main Course',
    availability: true,
    restaurantId,
    currentStock: 0,
    unit: 'pcs',
    minStock: 0,
    maxStock: 1000,
    reorderLevel: 0,
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
    lastUsedAlias: null,
    aliasUsageCount: 0,
    isDeleted: false,
    deletedAt: null,
  } as any);
}

const comp = (item: ProductDoc, qty: number, unit = 'g') => ({
  inventoryItemId: String(item._id),
  itemName: item.name,
  unit,
  quantity: qty,
});

/**
 * Kadhai Paneer with Half ₹120 and Full ₹179.98 — the exact scenario from the
 * requirement. Half = paneer 150g / tomato 100g; Full = paneer 250g /
 * tomato 150g / cream 80ml.
 */
async function kadhaiPaneer() {
  const dish = await makeMenuProduct('Kadhai Paneer', 120);
  const paneer = await makeIngredient('Paneer', 'g', 4);
  const tomato = await makeIngredient('Tomato', 'g', 2);
  const cream = await makeIngredient('Cream', 'ml', 3);
  await ProductVariant.create({ productId: dish._id, name: 'Half', price: 120 });
  await ProductVariant.create({ productId: dish._id, name: 'Full', price: 179.98 });
  return { dish, paneer, tomato, cream };
}

async function variantFor(dish: ProductDoc, variantName: string, components: any[], status: 'draft' | 'active' = 'active') {
  return recipeService.create(REST_A, {
    productId: String(dish._id),
    variantName,
    recipeMode: 'override',
    name: `${dish.name} (${variantName}) Recipe`,
    status,
    yieldQuantity: 1,
    yieldUnit: 'unit',
    components,
  }, { operator: 'owner' });
}

let mongod: MongoMemoryServer;
let connected = false;

async function ensureDb() {
  if (!connected) {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    connected = true;
  }
}

async function wipe() {
  await Promise.all([
    Recipe.deleteMany({}).exec(),
    RecipeConsumption.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
    ProductVariant.deleteMany({}).exec(),
    Bill.deleteMany({}).exec(),
    InventoryEvent.deleteMany({}).exec(),
  ]);
}

async function shutdown() {
  if (connected) {
    await mongoose.disconnect();
    connected = false;
    if (mongod) await mongod.stop();
  }
}

describe('Variant Recipe Isolation', () => {
  beforeAll(ensureDb);
  beforeEach(wipe);
  afterAll(shutdown);

  it('update(Half) must never change Full, and update(Full) must never change Half', async () => {
    const { dish, paneer, tomato, cream } = await kadhaiPaneer();
    const half = await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'active');
    const full = await variantFor(dish, 'Full', [comp(paneer, 250), comp(tomato, 150), comp(cream, 80, 'ml')], 'active');

    // Change Full → paneer 300g.
    await recipeService.update(REST_A, String(full._id), { components: [comp(paneer, 300), comp(tomato, 150), comp(cream, 80, 'ml')] });

    const halfDoc = (await Recipe.findById(half._id).lean().exec()) as any;
    const fullDoc = (await Recipe.findById(full._id).lean().exec()) as any;

    // Half is completely untouched.
    expect(halfDoc.components.find((c: any) => c.itemName === 'Paneer').quantity).toBe(150);
    expect(halfDoc.components.length).toBe(2);
    // Full carries its own new value.
    expect(fullDoc.components.find((c: any) => c.itemName === 'Paneer').quantity).toBe(300);
    expect(fullDoc.components.length).toBe(3);
    // Distinct documents — never the same _id.
    expect(String(halfDoc._id)).not.toBe(String(fullDoc._id));
  });

  it('copy(Half → Full) creates an independent recipe; editing Full after copying leaves Half alone', async () => {
    const { dish, paneer, tomato, cream } = await kadhaiPaneer();
    const half = await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'active');

    // Full has no recipe yet → resolve 'none' (no inheritance).
    const before = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), 'Full');
    expect(before.resolution.mode).toBe('none');

    // Copy Half → Full (server copy endpoint semantics).
    const copied = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Full', { operator: 'owner' });
    expect(copied.status).toBe('draft');
    expect(copied.components.map((c: any) => c.itemName).sort()).toEqual(['Paneer', 'Tomato']);
    expect(String(copied._id)).not.toBe(String(half._id));

    // Change Full (paneer 250g + cream 80ml) — Half must stay exactly as it was.
    await recipeService.update(REST_A, String(copied._id), {
      components: [comp(paneer, 250), comp(tomato, 150), comp(cream, 80, 'ml')],
    });
    await recipeService.activate(REST_A, String(copied._id), { operator: 'owner' });

    const halfDoc = (await Recipe.findById(half._id).lean().exec()) as any;
    const fullDoc = (await Recipe.findById(copied._id).lean().exec()) as any;
    expect(halfDoc.components.find((c: any) => c.itemName === 'Paneer').quantity).toBe(150);
    expect(halfDoc.components.length).toBe(2);
    expect(fullDoc.components.find((c: any) => c.itemName === 'Paneer').quantity).toBe(250);
    expect(fullDoc.components.length).toBe(3);
  });

  it('deep clone: mutating the copied array never mutates the source document', async () => {
    const { dish, paneer, tomato } = await kadhaiPaneer();
    const half = await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'active');
    const copied = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Full', { operator: 'owner' });

    const halfDoc = (await Recipe.findById(half._id).lean().exec()) as any;
    expect(copied.components).not.toBe(halfDoc.components);
    expect(copied.components[0]).not.toBe(halfDoc.components[0]);
    copied.components[0].quantity = 9999;
    const halfReloaded = (await Recipe.findById(half._id).lean().exec()) as any;
    expect(halfReloaded.components[0].quantity).toBe(150);
  });

  it('delete targets exactly one variant\'s recipe', async () => {
    const { dish, paneer, tomato, cream } = await kadhaiPaneer();
    const half = await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'draft');
    const full = await variantFor(dish, 'Full', [comp(paneer, 250), comp(tomato, 150), comp(cream, 80, 'ml')], 'active');

    // Draft recipes can be soft-deleted directly.
    const res = await recipeService.softDelete(REST_A, String(half._id), { operator: 'owner' });
    expect(res.success).toBe(true);

    // Full's active recipe is untouched and still resolves exactly.
    const fullRes = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), 'Full');
    expect(fullRes.resolution.mode).toBe('exact');
    expect(fullRes.recipe.components.find((c: any) => c.itemName === 'Paneer').quantity).toBe(250);

    // Half now resolves NONE (no inheritance — it must get its own recipe).
    const halfRes = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), 'Half');
    expect(halfRes.resolution.mode).toBe('none');
  });

  it('active recipes still require archive-before-delete (business rule preserved)', async () => {
    const { dish, paneer } = await kadhaiPaneer();
    const full = await variantFor(dish, 'Full', [comp(paneer, 250)], 'active');
    await expect(
      recipeService.softDelete(REST_A, String(full._id), { operator: 'owner' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('costing uses the variant\'s selling price for each variant recipe', async () => {
    const { dish, paneer, tomato, cream } = await kadhaiPaneer();
    const half = await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'active'); // cost = 800, price 120
    const full = await variantFor(dish, 'Full', [comp(paneer, 250), comp(tomato, 150), comp(cream, 80, 'ml')], 'active'); // cost = 1000+300+240 = 1540, price 179.98

    const halfCost = await recipeCostEngine.costRecipeById(String(half._id), REST_A);
    expect(halfCost.sellingPrice).toBe(120); // Half priced at ₹120
    expect(halfCost.foodCostPercent).toBeCloseTo((800 / 120) * 100, 1);

    const fullCost = await recipeCostEngine.costRecipeById(String(full._id), REST_A);
    expect(fullCost.sellingPrice).toBeCloseTo(179.98, 2); // Full priced at ITS OWN price
    expect(fullCost.recipeCost).toBe(1540);
    expect(fullCost.contribution).toBeCloseTo(179.98 - 1540, 2);
    expect(fullCost.foodCostPercent).toBeCloseTo((1540 / 179.98) * 100, 1);

    // The STORED summary (what the UI/list reads) is also variant-priced.
    const fullDoc = (await Recipe.findById(full._id).lean().exec()) as any;
    expect(fullDoc.costSummary.foodCostPercent).toBeCloseTo((1540 / 179.98) * 100, 1);
  });

  it('billing consumes the exact variant recipe (Full ≠ Half quantities)', async () => {
    const { dish, paneer, tomato, cream } = await kadhaiPaneer();
    await variantFor(dish, 'Half', [comp(paneer, 150), comp(tomato, 100)], 'active');
    await variantFor(dish, 'Full', [comp(paneer, 250), comp(tomato, 150), comp(cream, 80, 'ml')], 'active');

    const mkBill = async (invoiceNumber: string, clientRef: string) =>
      Bill.create({
        invoiceNumber,
        ticketNumber: `T-${clientRef}`,
        date: '2026-08-12',
        time: '12:00',
        cashierName: 'Cashier',
        cashierRole: 'Cashier',
        subtotal: 240,
        gst: 0,
        grandTotal: 240,
        paymentMethod: 'Cash',
        orderType: 'Dine-in',
        restaurantId: REST_A,
        clientRef,
      });

    const fullBill = await mkBill('I-FULL-1', 'bill_full');
    const fullRecord = await consumptionService.generateForBill(fullBill, [
      { menuItemId: String(dish._id), itemName: 'Kadhai Paneer', quantity: 2, price: 179.98, variantName: 'Full' },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    const fullDb = (await RecipeConsumption.findById(fullRecord._id).lean().exec()) as any;
    expect(fullDb.items.find((i: any) => i.itemName === 'Paneer').quantity).toBe(500);
    expect(fullDb.items.find((i: any) => i.itemName === 'Tomato').quantity).toBe(300);
    expect(fullDb.items.find((i: any) => i.itemName === 'Cream').quantity).toBe(160);
    expect(fullDb.lines[0].resolvedMode).toBe('exact');
    expect(fullDb.lines[0].variantName).toBe('Full');

    const halfBill = await mkBill('I-HALF-1', 'bill_half');
    const halfRecord = await consumptionService.generateForBill(halfBill, [
      { menuItemId: String(dish._id), itemName: 'Kadhai Paneer', quantity: 2, price: 120, variantName: 'Half' },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    const halfDb = (await RecipeConsumption.findById(halfRecord._id).lean().exec()) as any;
    expect(halfDb.items.find((i: any) => i.itemName === 'Paneer').quantity).toBe(300);
    expect(halfDb.items.find((i: any) => i.itemName === 'Tomato').quantity).toBe(200);
    expect(halfDb.items.some((i: any) => i.itemName === 'Cream')).toBe(false);
  });

  it('non-variant products keep working — plain sales consume the Default recipe', async () => {
    const dish = await makeMenuProduct('Plain Paneer', 240);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await variantFor(dish, 'Default', [comp(paneer, 200)], 'active');

    const bill = await Bill.create({
      invoiceNumber: 'I-PLAIN-1',
      ticketNumber: 'T-PLAIN',
      date: '2026-08-12',
      time: '12:00',
      cashierName: 'Cashier',
      cashierRole: 'Cashier',
      subtotal: 240,
      gst: 0,
      grandTotal: 240,
      paymentMethod: 'Cash',
      orderType: 'Dine-in',
      restaurantId: REST_A,
      clientRef: 'bill_plain',
    });
    const record = await consumptionService.generateForBill(bill, [
      { menuItemId: String(dish._id), itemName: 'Plain Paneer', quantity: 1, price: 240 },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    expect(record).not.toBeNull();
    const db = (await RecipeConsumption.findById(record._id).lean().exec()) as any;
    expect(db.items[0].quantity).toBe(200);
    expect(db.lines[0].resolvedMode).toBe('exact');
    // The line resolved the product's 'Default' recipe.
    const resolved = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id));
    expect(resolved.resolution.mode).toBe('exact');
    expect(resolved.recipe.variantName).toBe('Default');
    expect(String(db.lines[0].sourceRecipeId)).toBe(String(resolved.recipe._id));
  });

  it('Recipe Manager status surfaces DRAFT recipes distinctly from active/missing', async () => {
    const { dish, paneer, tomato } = await kadhaiPaneer();
    await variantFor(dish, 'Half', [comp(paneer, 150)], 'active');
    await variantFor(dish, 'Full', [comp(paneer, 250)], 'draft'); // Full is a draft recipe

    const status = await recipeResolutionService.listProductRecipeStatus(REST_A);
    const row = status.products.find((p) => p.productId === String(dish._id));
    expect(row).toBeDefined();
    const half = row!.variants.find((v) => v.name === 'Half');
    const full = row!.variants.find((v) => v.name === 'Full');
    expect(half?.status).toBe('configured');
    expect(full?.status).toBe('draft');
    expect(full?.overrideRecipeId).toBeDefined();
  });

  it('tenant isolation: a recipe is never readable or writable across restaurants', async () => {
    const dishA = await makeMenuProduct('Tenant A Dish', 100, REST_A);
    const riceA = await makeIngredient('Rice', 'g', 2, 100000, REST_A);
    const baseA = await variantFor(dishA, 'Half', [comp(riceA, 100)]);

    await expect(
      recipeService.getById(REST_B, String(baseA._id))
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      recipeService.update(REST_B, String(baseA._id), { components: [comp(riceA, 999)] })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
