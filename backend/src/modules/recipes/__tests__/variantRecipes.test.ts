/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Variant Recipes test suite — VARIANT-ONLY model.
 *
 * There is NO base recipe and NO inheritance: every recipe belongs to exactly
 * one variant. Products without variants use the virtual 'Default' variant.
 *
 * Non-negotiable invariants under test:
 *   - update(Half) !== update(Full): each variant owns an independent recipe.
 *   - a variant with NO recipe consumes nothing (zero, never inherited).
 *   - a plain sale of a variant-LESS product resolves its 'Default' recipe.
 *   - a plain sale of a product WITH variants requires a variant (none).
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recipeService } from '../services/recipeService';
import { recipeResolutionService } from '../services/recipeResolutionService';
import { consumptionService } from '../services/consumptionService';
import { profitabilityService } from '../services/profitabilityService';
import { createRecipeSchema } from '../validators/recipe';
import Recipe from '../models/Recipe';
import RecipeVersion from '../models/RecipeVersion';
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
    RecipeVersion.deleteMany({}).exec(),
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

/** Create a variant recipe (variant-only model). */
async function variantRecipeFor(dish: ProductDoc, variantName: string, components: any[], status: 'draft' | 'active' = 'active') {
  return recipeService.create(REST_A, {
    productId: String(dish._id),
    variantName,
    recipeMode: 'override',
    name: `${dish.name} (${variantName}) Recipe`,
    status,
    yieldQuantity: 1,
    yieldUnit: 'plate',
    components,
  }, { operator: 'owner' });
}

async function billFor(invoiceNumber: string, clientRef: string) {
  return Bill.create({
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
}

describe('Variant Recipes (variant-only)', () => {
  beforeAll(ensureDb);
  beforeEach(wipe);
  afterAll(shutdown);

  // ─── Model & service rules ──────────────────────────────────────
  it('creates a variant recipe with recipeMode override and variantName set', async () => {
    const dish = await makeMenuProduct('Daal Makhani', 240);
    const ingredient = await makeIngredient('Daal', 'g', 2);
    const recipe = await variantRecipeFor(dish, 'Half', [comp(ingredient, 150)]);
    const doc = (await Recipe.findById(recipe._id).lean().exec()) as any;
    expect(doc.recipeMode).toBe('override');
    expect(doc.variantName).toBe('Half');
    expect(doc.sourceRecipeId).toBeNull();
  });

  it('rejects a recipe without a variantName', async () => {
    const dish = await makeMenuProduct('Thali', 260);
    const rice = await makeIngredient('Rice', 'g', 2);
    await expect(
      recipeService.create(REST_A, {
        productId: String(dish._id),
        recipeMode: 'override',
        yieldQuantity: 1,
        yieldUnit: 'plate',
        components: [comp(rice, 100)],
      } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects recipeMode base — base recipes no longer exist', async () => {
    const dish = await makeMenuProduct('Thali', 260);
    const rice = await makeIngredient('Rice', 'g', 2);
    await expect(
      recipeService.create(REST_A, {
        productId: String(dish._id),
        variantName: 'Jumbo',
        recipeMode: 'base',
        yieldQuantity: 1,
        yieldUnit: 'plate',
        components: [comp(rice, 100)],
      } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('validators require a variantName and reject base mode', () => {
    const badBase = { productId: new mongoose.Types.ObjectId().toString(), variantName: 'X', recipeMode: 'base', yieldQuantity: 1, components: [] };
    const badNoVariant = { productId: new mongoose.Types.ObjectId().toString(), recipeMode: 'override', yieldQuantity: 1, components: [] };
    const good = { productId: new mongoose.Types.ObjectId().toString(), variantName: 'Half', recipeMode: 'override', yieldQuantity: 1, components: [] };
    expect(createRecipeSchema.safeParse(badBase as any).success).toBe(false);
    expect(createRecipeSchema.safeParse(badNoVariant as any).success).toBe(false);
    expect(createRecipeSchema.safeParse(good as any).success).toBe(true);
  });

  it('duplicating a variant recipe preserves its variantName', async () => {
    const dish = await makeMenuProduct('Naan', 60);
    const flour = await makeIngredient('Flour', 'g', 1);
    const recipe = await variantRecipeFor(dish, 'Butter', [comp(flour, 150)]);
    const dup = await recipeService.duplicate(REST_A, String(recipe._id), { operator: 'owner' });
    expect(dup.recipeMode).toBe('override');
    expect(dup.variantName).toBe('Butter');
  });

  it('update rejects reparenting a recipe to another variant or product', async () => {
    const dish = await makeMenuProduct('Naan', 60);
    const flour = await makeIngredient('Flour', 'g', 1);
    const recipe = await variantRecipeFor(dish, 'Butter', [comp(flour, 150)], 'active');
    await expect(
      recipeService.update(REST_A, String(recipe._id), { variantName: 'Garlic' } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      recipeService.update(REST_A, String(recipe._id), { productId: new mongoose.Types.ObjectId().toString() } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      recipeService.update(REST_A, String(recipe._id), { recipeMode: 'base' } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
    const doc = (await Recipe.findById(recipe._id).lean().exec()) as any;
    expect(doc.variantName).toBe('Butter');
  });

  // ─── Copy ───────────────────────────────────────────────────────
  it('copy-variant clones components onto a new active recipe; a second copy lands as a draft alongside', async () => {
    const dish = await makeMenuProduct('Pizza', 449);
    const dough = await makeIngredient('Dough', 'g', 2);
    const cheese = await makeIngredient('Cheese', 'g', 6);
    await ProductVariant.create({ productId: dish._id, name: 'Peppy', price: 499 });
    const half = await variantRecipeFor(dish, 'Half', [comp(dough, 250), comp(cheese, 100)], 'active');
    const copy = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Peppy', { operator: 'owner', status: 'active' });
    expect(copy.recipeMode).toBe('override');
    expect(copy.variantName).toBe('Peppy');
    expect(copy.components.length).toBe(2);
    expect(copy.components.every((c: any) => c.componentSource === 'copy')).toBe(true);
    expect(copy.status).toBe('active');
    // A second copy never overwrites the ACTIVE recipe — it creates a fresh DRAFT.
    const second = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Peppy', { operator: 'owner' });
    expect(second.status).toBe('draft');
    expect(String(second._id)).not.toBe(String(copy._id));
    expect(await Recipe.countDocuments({ restaurantId: REST_A, variantName: 'Peppy', status: 'active' })).toBe(1);
  });

  it('copy-variant replaces an existing DRAFT recipe in place (independent deep clone)', async () => {
    const dish = await makeMenuProduct('Pizza', 449);
    const dough = await makeIngredient('Dough', 'g', 2);
    await ProductVariant.create({ productId: dish._id, name: 'Peppy', price: 499 });
    const half = await variantRecipeFor(dish, 'Half', [comp(dough, 250)], 'active');
    const first = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Peppy', { operator: 'owner' });
    expect(first.status).toBe('draft');
    const second = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Peppy', { operator: 'owner' });
    expect(String(second._id)).toBe(String(first._id));
    expect(second.status).toBe('draft');
    expect(await Recipe.countDocuments({ restaurantId: REST_A, variantName: 'Peppy' })).toBe(1);
  });

  it('copy-variant creates an independent draft target; editing it never touches the source', async () => {
    const dish = await makeMenuProduct('Burger', 299);
    const patty = await makeIngredient('Patty', 'g', 7);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 299 });
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 399 });
    const half = await variantRecipeFor(dish, 'Half', [comp(patty, 150)], 'active');
    const full = await recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Full', { operator: 'owner' });
    expect(full.status).toBe('draft');
    expect(full.variantName).toBe('Full');
    expect(full.components[0].quantity).toBe(150);
    // Independence: editing Full must never touch Half.
    await recipeService.update(REST_A, String(full._id), { components: [comp(patty, 300)] });
    const halfDoc = (await Recipe.findById(half._id).lean().exec()) as any;
    expect(halfDoc.components[0].quantity).toBe(150);
  });

  it('copy-variant rejects a target variant that is not a variant of the source product', async () => {
    const dish = await makeMenuProduct('Pizza', 449);
    const dough = await makeIngredient('Dough', 'g', 2);
    const half = await variantRecipeFor(dish, 'Half', [comp(dough, 250)], 'active');
    await expect(
      recipeResolutionService.copyVariantRecipe(REST_A, String(half._id), 'Cheese', { operator: 'owner' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('copy-variant is tenant isolated — another restaurant\'s recipe is never a source', async () => {
    const dish = await makeMenuProduct('Tenant Dish', 200, REST_B);
    const rice = await makeIngredient('Rice', 'g', 2, 100000, REST_B);
    const theirs = await recipeService.create(REST_B, {
      productId: String(dish._id),
      variantName: 'Big',
      recipeMode: 'override',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [comp(rice, 100)],
    }, { operator: 'owner' });
    await expect(
      recipeResolutionService.copyVariantRecipe(REST_A, String(theirs._id), 'Large', { operator: 'owner' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Resolution ─────────────────────────────────────────────────
  it('resolves a variant with its own recipe to the recipe (exact)', async () => {
    const dish = await makeMenuProduct('Paneer Bhurji', 280);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await variantRecipeFor(dish, 'Jumbo', [comp(paneer, 320)], 'active');
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), 'Jumbo');
    expect(res.resolution.mode).toBe('exact');
    expect(res.recipe.components[0].quantity).toBe(320);
  });

  it('a variant with no recipe resolves to none + HIGH warning (no inheritance)', async () => {
    const dish = await makeMenuProduct('Paneer Bhurji', 280);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await variantRecipeFor(dish, 'Half', [comp(paneer, 180)], 'active'); // Half exists, Jumbo does not
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), 'Jumbo');
    expect(res.resolution.mode).toBe('none');
    expect(res.recipe).toBeNull();
    expect(res.resolution.warning?.severity).toBe('HIGH');
    expect(res.resolution.warning?.code).toBe('variant_no_recipe');
  });

  it('a plain sale of a variant-LESS product resolves its Default recipe', async () => {
    const dish = await makeMenuProduct('Plain Fries', 120);
    const potato = await makeIngredient('Potato', 'g', 1);
    await variantRecipeFor(dish, 'Default', [comp(potato, 200)], 'active');
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), undefined);
    expect(res.resolution.mode).toBe('exact');
    expect(res.recipe.variantName).toBe('Default');
    expect(res.resolution.variantName).toBe('Default');
  });

  it('a plain sale of a product WITH variants resolves none (variant required)', async () => {
    const dish = await makeMenuProduct('Kadhai', 120);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 120 });
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 179.98 });
    await variantRecipeFor(dish, 'Half', [comp(paneer, 150)], 'active');
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), undefined);
    expect(res.resolution.mode).toBe('none');
    expect(res.resolution.warning?.code).toBe('variant_required');
  });

  it('legacy base recipe (empty variantName) still resolves as Default until migration', async () => {
    const dish = await makeMenuProduct('Legacy Dish', 200);
    const rice = await makeIngredient('Rice', 'g', 2);
    await Recipe.create({
      restaurantId: REST_A,
      productId: dish._id,
      productName: dish.name,
      variantName: null,
      recipeMode: 'base',
      name: 'Base',
      status: 'active',
      version: 1,
      effectiveFrom: '2026-01-01',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: rice._id, itemName: 'Rice', unit: 'g', quantity: 100 }],
      costSummary: { calculatedAt: new Date() },
      isDeleted: false,
    } as any);
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, String(dish._id), undefined);
    expect(res.resolution.mode).toBe('exact');
    expect(res.recipe.variantName).toBeNull();
  });

  it('invalid ids resolve to none without throwing', async () => {
    const res = await recipeResolutionService.resolveEffectiveRecipe(REST_A, 'not-an-objectid', 'X');
    expect(res.resolution.mode).toBe('none');
    expect(res.recipe).toBeNull();
  });

  // ─── Consumption ────────────────────────────────────────────────
  it('consumes the VARIANT\'s own recipe quantities', async () => {
    const dish = await makeMenuProduct('Daal', 240);
    const daal = await makeIngredient('Daal', 'g', 2);
    await variantRecipeFor(dish, 'Jumbo', [comp(daal, 400)], 'active');
    const bill = await billFor('V-INV-1', 'v1');
    const record = await consumptionService.generateForBill(bill, [
      { menuItemId: String(dish._id), itemName: 'Daal', quantity: 1, price: 290, variantName: 'Jumbo' },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    const db = (await RecipeConsumption.findById(record._id).lean().exec()) as any;
    expect(db.items[0].quantity).toBe(400);
    expect(db.lines[0].resolvedMode).toBe('exact');
    const sold = await InventoryEvent.find({ restaurantId: REST_A, type: 'sold', item: 'Daal' }).lean().exec();
    expect(sold.length).toBe(1);
  });

  it('a variant with NO recipe consumes nothing (zero, never inherited)', async () => {
    const dish = await makeMenuProduct('NoRecipe Dish', 200);
    const bill = await billFor('V-INV-3', 'v3');
    const record = await consumptionService.generateForBill(bill, [
      { menuItemId: String(dish._id), itemName: 'NoRecipe Dish', quantity: 1, price: 200, variantName: 'Small' },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    expect(record).toBeNull();
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(0);
    expect(await InventoryEvent.countDocuments({ restaurantId: REST_A, type: 'sold' })).toBe(0);
  });

  it('a plain sale of a variant-less product consumes its Default recipe', async () => {
    const dish = await makeMenuProduct('Plain Paneer', 240);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await variantRecipeFor(dish, 'Default', [comp(paneer, 200)], 'active');
    const bill = await billFor('V-INV-5', 'v5');
    const record = await consumptionService.generateForBill(bill, [
      { menuItemId: String(dish._id), itemName: 'Plain Paneer', quantity: 2, price: 240 },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    const db = (await RecipeConsumption.findById(record._id).lean().exec()) as any;
    expect(db.items[0].quantity).toBe(400); // 2 × 200 Default
    expect(db.lines[0].resolvedMode).toBe('exact');
  });

  it('a mixed bill consumes each variant independently per line', async () => {
    const dish = await makeMenuProduct('Steak', 650);
    const beef = await makeIngredient('Beef', 'g', 10);
    await variantRecipeFor(dish, 'Regular', [comp(beef, 250)], 'active');
    await variantRecipeFor(dish, 'Large', [comp(beef, 500)], 'active');
    const bill = await billFor('V-INV-4', 'v4');
    const record = await consumptionService.generateForBill(bill, [
      { menuItemId: String(dish._id), itemName: 'Steak', quantity: 2, price: 800, variantName: 'Large' },
      { menuItemId: String(dish._id), itemName: 'Steak', quantity: 1, price: 650, variantName: 'Regular' },
    ], { restaurantId: REST_A, operator: 'Cashier' });
    const db = (await RecipeConsumption.findById(record._id).lean().exec()) as any;
    expect(db.items[0].quantity).toBe(1250); // 2×500 + 1×250
    expect(db.lines.map((l: any) => l.resolvedMode).sort()).toEqual(['exact', 'exact']);
  });

  // ─── Profitability ──────────────────────────────────────────────
  it('bill economics uses the variant\'s recipe cost', async () => {
    const dish = await makeMenuProduct('Curry', 300);
    const mix = await makeIngredient('Spice Mix', 'g', 5);
    await variantRecipeFor(dish, 'Rich', [comp(mix, 300)], 'active'); // 1500
    const econ = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 2, variantName: 'Rich' }],
    });
    expect(econ.rows[0].recipeCost).toBe(1500);
    expect(econ.rows[0].resolvedMode).toBe('exact');
    expect(econ.estVariableCost).toBe(3000);
  });

  // ─── Recipe Manager status ──────────────────────────────────────
  it('status list reports configured/draft/missing per variant (no inherit)', async () => {
    const dish = await makeMenuProduct('Pizza', 449);
    const dough = await makeIngredient('Dough', 'g', 2);
    await ProductVariant.create({ productId: dish._id, name: 'Regular', price: 449 });
    await ProductVariant.create({ productId: dish._id, name: 'Large', price: 549 });
    await variantRecipeFor(dish, 'Regular', [comp(dough, 250)], 'active');
    await variantRecipeFor(dish, 'Large', [comp(dough, 300)], 'draft');
    const status = await recipeResolutionService.listProductRecipeStatus(REST_A);
    expect(status.summary.products).toBe(1);
    expect(status.summary.configuredVariants).toBe(1);
    expect(status.summary.missingVariants).toBe(0);
    const row = status.products[0];
    const regular = row.variants.find((v) => v.name === 'Regular');
    const large = row.variants.find((v) => v.name === 'Large');
    expect(regular?.status).toBe('configured');
    expect(large?.status).toBe('draft');
    expect(row.warnings.some((w) => w.code === 'variant_missing')).toBe(false);
  });

  it('status list flags variants with no recipe as HIGH gaps', async () => {
    const dish = await makeMenuProduct('Dark Dish', 199);
    await ProductVariant.create({ productId: dish._id, name: 'Single', price: 199 });
    const status = await recipeResolutionService.listProductRecipeStatus(REST_A);
    const row = status.products[0];
    expect(row.variants[0].status).toBe('missing');
    const severities = row.warnings.map((w) => w.severity);
    expect(severities).toEqual(['HIGH']);
    expect(row.warnings[0].code).toBe('variant_missing');
    expect(status.summary.coveragePercent).toBe(0);
  });

  it('status list exposes the Default variant for variant-less products', async () => {
    const dish = await makeMenuProduct('Plain Fries', 120);
    const potato = await makeIngredient('Potato', 'g', 1);
    await variantRecipeFor(dish, 'Default', [comp(potato, 200)], 'active');
    const status = await recipeResolutionService.listProductRecipeStatus(REST_A);
    const row = status.products[0];
    expect(row.variants.map((v) => v.name)).toEqual(['Default']);
    expect(row.variants[0].status).toBe('configured');
    expect(status.summary.configuredVariants).toBe(1);
    expect(status.summary.coveragePercent).toBe(100);
  });

  it('status list counts configured variants as costed poles', async () => {
    const dish = await makeMenuProduct('Burger', 299);
    const patty = await makeIngredient('Patty', 'g', 7);
    await ProductVariant.create({ productId: dish._id, name: 'Double', price: 399 });
    await ProductVariant.create({ productId: dish._id, name: 'Single', price: 299 });
    await variantRecipeFor(dish, 'Double', [comp(patty, 300)], 'active');
    const status = await recipeResolutionService.listProductRecipeStatus(REST_A);
    expect(status.summary.configuredVariants).toBe(1);
    expect(status.summary.missingVariants).toBe(1);
    expect(status.summary.coveragePercent).toBe(50);
  });

  it('variant list for a product merges ProductVariant + observed recipe names; Default when none', async () => {
    const dish = await makeMenuProduct('Shake', 150);
    const milk = await makeIngredient('Milk', 'ml', 1);
    await variantRecipeFor(dish, 'Chocolate', [comp(milk, 250, 'ml')], 'active');
    await ProductVariant.create({ productId: dish._id, name: 'Vanilla', price: 150 });
    const names = await recipeResolutionService.getVariantsForProduct(REST_A, String(dish._id));
    expect(names.sort()).toEqual(['Chocolate', 'Vanilla']);
    // Variant-less product → virtual Default.
    const dish2 = await makeMenuProduct('No Variants', 99);
    const names2 = await recipeResolutionService.getVariantsForProduct(REST_A, String(dish2._id));
    expect(names2).toEqual(['Default']);
  });

  it('tenant isolation: status and resolution never leak across restaurants', async () => {
    const dishA = await makeMenuProduct('Tenant A Dish', 100, REST_A);
    const riceA = await makeIngredient('Rice', 'g', 2, 100000, REST_A);
    await variantRecipeFor(dishA, 'Half', [comp(riceA, 100)], 'active');
    const dishB = await makeMenuProduct('Tenant B Dish', 100, REST_B);
    const resB = await recipeResolutionService.resolveEffectiveRecipe(REST_B, String(dishB._id), 'X');
    expect(resB.resolution.mode).toBe('none');
    const statusA = await recipeResolutionService.listProductRecipeStatus(REST_A);
    expect(statusA.products.length).toBe(1);
    expect(statusA.products[0].productId).toBe(String(dishA._id));
  });

  // ─── Hygiene ────────────────────────────────────────────────────
  it('sweep flags recipes without a variant (legacy base leftovers)', async () => {
    const dish = await makeMenuProduct('Legacy Dish', 200);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await Recipe.create({
      restaurantId: REST_A,
      productId: dish._id,
      productName: dish.name,
      variantName: null,
      recipeMode: 'base',
      name: 'Base',
      status: 'active',
      version: 1,
      effectiveFrom: '2026-01-01',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: paneer._id, itemName: 'Paneer', unit: 'g', quantity: 100 }],
      costSummary: { calculatedAt: new Date() },
      isDeleted: false,
    } as any);
    const sweep = await recipeResolutionService.sweep(REST_A);
    const kinds = sweep.problems.map((p) => p.kind);
    expect(kinds).toContain('recipe_without_variant');
  });

  it('migration renames a variant-less base recipe to Default', async () => {
    const dish = await makeMenuProduct('Single Dish', 200);
    const rice = await makeIngredient('Rice', 'g', 2);
    const base = await Recipe.create({
      restaurantId: REST_A,
      productId: dish._id,
      productName: dish.name,
      variantName: null,
      recipeMode: 'base',
      name: 'Base',
      status: 'active',
      version: 1,
      effectiveFrom: '2026-01-01',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: rice._id, itemName: 'Rice', unit: 'g', quantity: 100 }],
      costSummary: { calculatedAt: new Date() },
      isDeleted: false,
    } as any);
    const out = await recipeResolutionService.migrateRemoveBaseRecipes({ restaurantId: REST_A });
    expect(out.renamed).toBe(1);
    const doc = (await Recipe.findById(base._id).lean().exec()) as any;
    expect(doc.variantName).toBe('Default');
    expect(doc.recipeMode).toBe('override');
    expect(doc.status).toBe('active'); // untouched status
  });

  it('migration copies a base recipe onto every variant lacking one, then archives it', async () => {
    const dish = await makeMenuProduct('Variant Dish', 250);
    const paneer = await makeIngredient('Paneer', 'g', 4);
    await ProductVariant.create({ productId: dish._id, name: 'Half', price: 150 });
    await ProductVariant.create({ productId: dish._id, name: 'Full', price: 350 });
    // Pre-configured Full recipe (should NOT be overwritten).
    await variantRecipeFor(dish, 'Full', [comp(paneer, 400)], 'active');
    const base = await Recipe.create({
      restaurantId: REST_A,
      productId: dish._id,
      productName: dish.name,
      variantName: null,
      recipeMode: 'base',
      name: 'Base',
      status: 'active',
      version: 1,
      effectiveFrom: '2026-01-01',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: paneer._id, itemName: 'Paneer', unit: 'g', quantity: 200 }],
      costSummary: { calculatedAt: new Date() },
      isDeleted: false,
    } as any);

    const out = await recipeResolutionService.migrateRemoveBaseRecipes({ restaurantId: REST_A });
    expect(out.renamed).toBe(0);
    expect(out.copied).toBe(1); // Half copied; Full already existed
    expect(out.archived).toBe(1);

    const half = (await Recipe.findOne({ productId: dish._id, variantName: 'Half' }).lean().exec()) as any;
    expect(half).toBeDefined();
    expect(half.status).toBe('active'); // preserved the base's status
    expect(half.components[0].quantity).toBe(200);
    expect(half.sourceRecipeId).toBeNull();
    const full = (await Recipe.findOne({ productId: dish._id, variantName: 'Full' }).lean().exec()) as any;
    expect(full.components[0].quantity).toBe(400); // untouched
    const archivedBase = (await Recipe.findById(base._id).lean().exec()) as any;
    expect(archivedBase.status).toBe('archived');
  });
});
