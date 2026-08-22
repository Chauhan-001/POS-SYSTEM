/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Recipe Manager test suite — Phase 28 coverage:
 *   - Unit conversion (kg↔g, L↔ml, incompatible-unit rejection)
 *   - Cost engine (weighted avg costs, wastage, sub-recipe scaling, cycles,
 *     missing costs, tenant isolation)
 *   - Recipe service (create, versioning on edit, activate sibling archiving,
 *     duplicate, archive, circular-dependency prevention)
 *   - Consumption idempotency (a bill is consumed exactly once)
 *   - Reconciliation (theoretical vs actual)
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { convertQuantity, canConvert, normalizeUnit } from '../services/unitConversion';
import { recipeCostEngine } from '../services/recipeCostEngine';
import { recipeService } from '../services/recipeService';
import { consumptionService } from '../services/consumptionService';
import { recalculateService } from '../services/recalculateService';
import Recipe from '../models/Recipe';
import RecipeVersion from '../models/RecipeVersion';
import RecipeConsumption from '../models/RecipeConsumption';
import Product from '../../../models/Product';
import Bill from '../../../models/Bill';
import InventoryEvent from '../../../models/InventoryEvent';
import CostSettings from '../models/CostSettings';
import { costSettingsService } from '../services/costSettingsService';
import { profitabilityService } from '../services/profitabilityService';

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

/** Create an inventory product (availability:false ingredient). */
async function makeIngredient(name: string, unit: string, averageCost: number, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `INV-${name.toUpperCase().replace(/\s+/g, '')}`,
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
    aliasUsageCount: 0,
    isDeleted: false,
    deletedAt: null,
  } as any);
}

async function makeMenuProduct(name: string, price: number, restaurantId = REST_A) {
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

describe('Unit conversion', () => {
  it('converts kg ↔ g exactly', () => {
    expect(convertQuantity(2, 'kg', 'g')).toBe(2000);
    expect(convertQuantity(250, 'g', 'kg')).toBe(0.25);
  });
  it('converts L ↔ ml exactly', () => {
    expect(convertQuantity(1.5, 'L', 'ml')).toBe(1500);
    expect(convertQuantity(750, 'ml', 'L')).toBe(0.75);
  });
  it('count units pass through', () => {
    expect(convertQuantity(3, 'pcs', 'pcs')).toBe(3);
    expect(convertQuantity(2, 'kg', 'kg')).toBe(2);
  });
  it('rejects incompatible families', () => {
    expect(() => convertQuantity(500, 'ml', 'kg')).toThrow(/incompatible/i);
    expect(canConvert('ml', 'kg')).toBe(false);
    expect(canConvert('g', 'kg')).toBe(true);
  });
  it('normalizes common spellings', () => {
    expect(normalizeUnit('Kilograms')).toBe('kg');
    expect(normalizeUnit('litres')).toBe('L');
    expect(normalizeUnit('pieces')).toBe('pcs');
  });
});

describe('RecipeCostEngine', () => {
  let paneer: any;
  let tomato: any;
  let butter: any;
  let gravy: any;
  let dish: any;

  beforeAll(ensureDb, 60_000);
  afterAll(shutdown);
  beforeEach(wipe);

  it('costs a simple recipe from weighted-average inventory costs', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 380);
    tomato = await makeIngredient('Tomato', 'kg', 60);
    butter = await makeIngredient('Butter', 'kg', 500);
    dish = await makeMenuProduct('Paneer Butter Masala', 280);

    const recipe = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'PBM v1',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      servingSize: 1,
      components: [
        { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
        { inventoryItemId: String(tomato._id), itemName: 'Tomato', unit: 'g', quantity: 150 },
        { inventoryItemId: String(butter._id), itemName: 'Butter', unit: 'g', quantity: 30 },
      ],
    }, { operator: 'owner' });

    const cost = await recipeCostEngine.costRecipeById(String((recipe as any)._id), REST_A);
    // 0.2 kg × 380 + 0.15 kg × 60 + 0.03 kg × 500 = 76 + 9 + 15 = 100
    expect(cost.recipeCost).toBe(100);
    expect(cost.foodCostPercent).toBe(35.71); // 100 / 280
    expect(cost.contribution).toBe(180);
    expect(cost.perServingCost).toBe(100);
  });

  it('applies component wastage percent', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 100);
    dish = await makeMenuProduct('Wastage Dish', 100);
    const recipe = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [
        { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 1000, wastagePercent: 10 },
      ],
    }, { operator: 'owner' });
    const cost = await recipeCostEngine.costRecipeById(String((recipe as any)._id), REST_A);
    expect(cost.recipeCost).toBe(110); // 1kg × 100 × 1.1
  });

  it('scales a sub-recipe by the required yield portion', async () => {
    const gravyBase = await makeIngredient('Gravy Base', 'kg', 40);
    gravy = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(gravyBase._id),
      name: 'Butter Masala Gravy',
      yieldQuantity: 1,
      yieldUnit: 'L',
      components: [
        { inventoryItemId: String(gravyBase._id), itemName: 'Gravy Base', unit: 'g', quantity: 1000 },
      ],
    }, { operator: 'owner' });
    const gravyDoc = await recipeService.activate(REST_A, String((gravy as any)._id), { operator: 'owner' });

    dish = await makeMenuProduct('Paneer Butter Masala', 280);
    const dishRecipe = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'PBM',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [
        {
          componentType: 'sub_recipe',
          subRecipeId: String((gravy as any)._id),
          itemName: 'Butter Masala Gravy',
          unit: 'ml',
          quantity: 250, // 250 ml of a 1 L yield = ¼ of the gravy cost
        },
      ],
    }, { operator: 'owner' });

    const cost = await recipeCostEngine.costRecipeById(String((dishRecipe as any)._id), REST_A);
    // gravy cost = 1 kg × 40 = 40; ¼ portion = 10
    expect(cost.recipeCost).toBe(10);
    expect(cost.lines[0].itemName).toBe('Gravy Base');
  });

  it('rejects circular sub-recipe references at save time', async () => {
    const a = await makeIngredient('A', 'kg', 10);
    const b = await makeIngredient('B', 'kg', 10);
    // A starts as a plain ingredient recipe.
    const ra = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(a._id),
      name: 'Recipe A',
      yieldQuantity: 1,
      yieldUnit: 'unit',
      components: [{ inventoryItemId: String(a._id), itemName: 'A', unit: 'g', quantity: 100 }],
    }, { operator: 'owner' });

    // B references A (fine — acyclic).
    const rb = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(b._id),
      name: 'Recipe B',
      yieldQuantity: 1,
      yieldUnit: 'unit',
      components: [
        { componentType: 'sub_recipe', subRecipeId: String((ra as any)._id), itemName: 'A', unit: 'unit', quantity: 1 },
      ],
    }, { operator: 'owner' });

    // Now make A reference B → cycle A → B → A.
    await expect(
      recipeService.update(REST_A, String((ra as any)._id), {
        components: [
          { componentType: 'sub_recipe', subRecipeId: String((rb as any)._id), itemName: 'B', unit: 'unit', quantity: 1 },
        ],
      }, { operator: 'owner' })
    ).rejects.toThrow(/circular/i);
  });

  it('is tenant-isolated: a recipe cannot reference another restaurant’s ingredient', async () => {
    const foreign = await makeIngredient('Foreign Item', 'kg', 99, REST_B);
    const dish = await makeMenuProduct('Isolation Dish', 100);
    await expect(
      recipeService.create(REST_A, {
        variantName: 'Default',
        productId: String(dish._id),
        name: 'Cross Tenant',
        yieldQuantity: 1,
        yieldUnit: 'plate',
        components: [
          { inventoryItemId: String(foreign._id), itemName: 'Foreign Item', unit: 'g', quantity: 100 },
        ],
      }, { operator: 'owner' })
    ).rejects.toThrow(/not found in your inventory/i);
  });

  it('versions an active recipe when its components change (history preserved)', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 380);
    dish = await makeMenuProduct('Paneer Dish', 280);
    const recipe = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Paneer Dish',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [
        { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
      ],
    }, { operator: 'owner' });
    const recipeId = String((recipe as any)._id);

    // Edit the active recipe → v1 snapshotted, v2 becomes current.
    await recipeService.update(REST_A, recipeId, {
      components: [
        { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 180 },
      ],
    }, { operator: 'owner' });

    const current = await recipeService.getById(REST_A, recipeId);
    expect((current as any).version).toBe(2);
    expect((current as any).components[0].quantity).toBe(180);

    const versions = await recipeService.versions(REST_A, recipeId);
    expect(versions.length).toBe(1);
    expect((versions[0] as any).version).toBe(1);
    expect((versions[0] as any).components[0].quantity).toBe(200);
  });

  it('activating a recipe auto-archives sibling active recipes for the same product', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 100);
    dish = await makeMenuProduct('Same Dish', 200);
    const r1 = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Same Dish v1',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });
    const r2 = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Same Dish v2',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 150 }],
    }, { operator: 'owner' });

    await recipeService.activate(REST_A, String((r2 as any)._id), { operator: 'owner' });

    const archived = await recipeService.getById(REST_A, String((r1 as any)._id));
    expect((archived as any).status).toBe('archived');
    const active = await recipeService.getById(REST_A, String((r2 as any)._id));
    expect((active as any).status).toBe('active');
  });

  it('duplicates as a draft with a fresh version counter', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 100);
    dish = await makeMenuProduct('Dup Dish', 200);
    const r = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Dup Dish',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });
    const copy = await recipeService.duplicate(REST_A, String((r as any)._id), { operator: 'owner' });
    expect((copy as any).name).toBe('Dup Dish (copy)');
    expect((copy as any).status).toBe('draft');
    expect((copy as any).version).toBe(1);
  });
});

describe('ConsumptionService', () => {
  let paneer: any;
  let dish: any;

  beforeAll(ensureDb, 60_000);
  beforeEach(wipe);

  it('is idempotent: the same bill is consumed exactly once', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 380);
    dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'PBM',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });

    const bill = await Bill.create({
      invoiceNumber: 'INV-1',
      ticketNumber: 'T1',
      date: '2026-08-12',
      time: '12:00',
      cashierName: 'Cashier',
      cashierRole: 'Cashier',
      subtotal: 280,
      gst: 14,
      grandTotal: 294,
      paymentMethod: 'Cash',
      orderType: 'Dine-in',
      restaurantId: REST_A,
      clientRef: 'bill_x',
    });
    const items = [{ menuItemId: String(dish._id), itemName: 'Paneer Butter Masala', quantity: 3, price: 280 }];

    const first = await consumptionService.generateForBill(bill, items, { restaurantId: REST_A, operator: 'Cashier' });
    expect(first).not.toBeNull();
    const recordId = String(first._id);

    // Replay (duplicate request / retry / offline replay).
    const second = await consumptionService.generateForBill(bill, items, { restaurantId: REST_A, operator: 'Cashier' });
    expect(String(second._id)).toBe(recordId);
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(1);

    // Theoretical consumption: 3 × 200 g = 600 g = 0.6 kg.
    const record = await RecipeConsumption.findById(recordId).lean().exec() as any;
    expect(record.items[0].quantity).toBe(0.6);
    expect(record.items[0].costPerUnit).toBe(380);
    expect(record.totalCost).toBe(228); // 0.6 × 380

    // Stock movement recorded on the ingredient (not the menu product).
    const soldEvents = await InventoryEvent.find({ restaurantId: REST_A, type: 'sold' }).lean().exec();
    expect(soldEvents.length).toBe(1);
    expect(soldEvents[0].item).toBe('Paneer');
  });

  it('reverses a voided bill and restores the ingredients', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 380);
    dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'PBM',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });

    const bill = await Bill.create({
      invoiceNumber: 'INV-2',
      ticketNumber: 'T2',
      date: '2026-08-12',
      time: '12:00',
      cashierName: 'Cashier',
      cashierRole: 'Cashier',
      subtotal: 280,
      gst: 14,
      grandTotal: 294,
      paymentMethod: 'Cash',
      orderType: 'Dine-in',
      restaurantId: REST_A,
    });
    const items = [{ menuItemId: String(dish._id), itemName: 'Paneer Butter Masala', quantity: 2, price: 280 }];
    await consumptionService.generateForBill(bill, items, { restaurantId: REST_A });

    await consumptionService.reverseForBill(String(bill._id), { restaurantId: REST_A, operator: 'Manager' }, 'Void test');

    const record = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: bill._id }).lean().exec() as any;
    expect(record.status).toBe('voided');
    // A return movement restored the ingredient.
    const returnEvents = await InventoryEvent.find({ restaurantId: REST_A, type: 'return' }).lean().exec();
    expect(returnEvents.length).toBe(1);
    expect(returnEvents[0].item).toBe('Paneer');
  });

  it('reconciles theoretical vs actual consumption', async () => {
    paneer = await makeIngredient('Paneer', 'kg', 380);
    dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'PBM',
      status: 'active',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });

    const bill = await Bill.create({
      invoiceNumber: 'INV-3',
      ticketNumber: 'T3',
      date: '2026-08-12',
      time: '12:00',
      cashierName: 'Cashier',
      cashierRole: 'Cashier',
      subtotal: 280,
      gst: 14,
      grandTotal: 294,
      paymentMethod: 'Cash',
      orderType: 'Dine-in',
      restaurantId: REST_A,
    });
    await consumptionService.generateForBill(bill, [{ menuItemId: String(dish._id), itemName: 'Paneer Butter Masala', quantity: 5, price: 280 }], { restaurantId: REST_A });

    const report = await consumptionService.reconcile(REST_A, { startDate: '2026-08-01', endDate: '2026-08-31' });
    const row = report.rows.find((r: any) => r.name === 'Paneer');
    expect(row).toBeDefined();
    expect(row.theoreticalQty).toBe(1); // 5 × 200g = 1 kg
    expect(row.actualQty).toBe(1);      // stock engine recorded the same
    expect(row.varianceQty).toBe(0);
  });
});

describe('RecalculateService (dependency-aware)', () => {
  beforeAll(ensureDb, 60_000);
  beforeEach(wipe);

  it('recalculates only recipes that use the changed ingredient', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 100);
    const milk = await makeIngredient('Milk', 'L', 50);
    const dishA = await makeMenuProduct('Dish A', 200);
    const dishB = await makeMenuProduct('Dish B', 200);

    const ra = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dishA._id),
      name: 'Uses Paneer',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 100 }],
    }, { operator: 'owner' });
    await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dishB._id),
      name: 'Uses Milk',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(milk._id), itemName: 'Milk', unit: 'ml', quantity: 250 }],
    }, { operator: 'owner' });

    // Paneer price doubles → only recipe A is affected.
    const updated = await recalculateService.recalcForIngredient(REST_A, String(paneer._id));
    expect(updated.length).toBe(1);
    expect(updated[0]).toBe(String((ra as any)._id));

    const a = await recipeService.getById(REST_A, String((ra as any)._id));
    expect((a as any).costSummary.recipeCost).toBe(10); // 0.1 kg × 100
  });
});

describe('layered cost model (CostSettings)', () => {
  let dish: any;

  beforeEach(async () => {
    await CostSettings.deleteMany({});
    dish = await makeMenuProduct('Layered Dish', 280);
  });

  it('adds minor, cooking, wastage and packaging allowances', async () => {
    await costSettingsService.update(REST_A, {
      minorIngredientAllowance: 3,
      cookingAllowance: 2.5,
      wastagePercent: 2,
      packaging: { dineIn: 0, takeaway: 8, delivery: 12 },
    });
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const recipe = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Layered',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      servingSize: 1,
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 }],
    }, { operator: 'owner' });

    // Direct = 0.2 × 380 = 76; minor 3; cooking 2.5; wastage 2% of (76+3+2.5) = 1.63
    const cost = await recipeCostEngine.costRecipeById(String((recipe as any)._id), REST_A);
    expect(cost.directIngredients).toBe(76);
    expect(cost.minorAllowance).toBe(3);
    expect(cost.cookingAllowance).toBe(2.5);
    expect(cost.wastageAllowance).toBe(1.63);
    expect(cost.packagingCost).toBe(0); // dine-in default
    expect(cost.estimatedVariableCost).toBe(83.13); // 76 + 3 + 2.5 + 1.63
    expect(cost.conservativeCost).toBe(91.44); // × 1.10 default markup
    expect(cost.contribution).toBe(196.87); // 280 − 83.13
    expect(cost.contributionMarginPercent).toBe(70.31);

    // Takeaway channel adds packaging.
    const takeaway = await recipeCostEngine.costRecipeById(String((recipe as any)._id), REST_A, undefined, 'takeaway');
    expect(takeaway.packagingCost).toBe(8);
    expect(takeaway.estimatedVariableCost).toBe(91.13);
  });

  it('settings change triggers restaurant-wide recalculation with layered fields', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 100);
    const created = await recipeService.create(REST_A, {
      variantName: 'Default',
      productId: String(dish._id),
      name: 'Affected',
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 1000 }],
    }, { operator: 'owner' });

    await costSettingsService.update(REST_A, { cookingAllowance: 2 });
    // recipeCost is still the direct cost (100); estimatedVariableCost adds cooking 2.
    const updated = await recipeService.getById(REST_A, String((created as any)._id));
    expect((updated as any).costSummary.estimatedVariableCost).toBe(102);
    expect((updated as any).costSummary.cookingAllowance).toBe(2);
  });

  it('calibrate returns a suggestion without mutating settings', async () => {
    await costSettingsService.update(REST_A, { cookingAllowance: 1 });
    const result = await costSettingsService.calibrate(REST_A, { days: 30 });
    expect(result.windowDays).toBe(30);
    expect(typeof result.suggestions.cookingAllowance.suggested).toBe('number');
    // Settings unchanged — calibration is advisory only.
    const settings = await costSettingsService.get(REST_A);
    expect(settings.cookingAllowance).toBe(1);
  });
});

describe('ProfitabilityService.billEconomics (order-screen offer strip)', () => {
  beforeAll(ensureDb, 60_000);
  afterAll(shutdown);
  beforeEach(wipe);

  /** Create a recipe and activate it (billEconomics only sees active recipes). */
  async function makeActiveRecipe(
    restaurantId: string,
    dish: any,
    name: string,
    components: any[],
  ) {
    const created = await recipeService.create(restaurantId, {
      productId: String(dish._id),
      variantName: 'Default',
      name,
      yieldQuantity: 1,
      yieldUnit: 'plate',
      components,
    }, { operator: 'owner' });
    await recipeService.activate(restaurantId, String((created as any)._id), { operator: 'owner' });
    return created;
  }

  it('computes bill-level cost × quantity with an applied discount', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 100);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await makeActiveRecipe(REST_A, dish, 'PBM', [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 1000 },
    ]);

    // 2 × dish @ 280 → subtotal 560; recipe cost 100 × 2 = 200; ₹100 offer.
    const res = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 2 }],
      discount: 100,
    });
    expect(res.verdict).toBe('healthy');
    expect(res.subtotal).toBe(560);
    expect(res.estVariableCost).toBe(200);
    expect(res.revenueAfterDiscount).toBe(460);
    expect(res.contribution).toBe(260);
    expect(res.costedItems).toBe(1);
    expect(res.totalItems).toBe(1);
    expect(res.rows[0].lineCost).toBe(200);
  });

  it('flags a losing offer with a negative contribution', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 100);
    const dish = await makeMenuProduct('Costly Dish', 250);
    await makeActiveRecipe(REST_A, dish, 'CD', [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 3000 },
    ]);

    // Recipe cost 300 per unit; price 250 → already negative without an offer.
    const res = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 1 }],
      discount: 0,
    });
    expect(res.verdict).toBe('negative');
    expect(res.contribution).toBe(-50);
    expect(res.contributionMarginPercent).toBeLessThan(0);
  });

  it('marks tight margins below 20%', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 100);
    const dish = await makeMenuProduct('Tight Dish', 120);
    await makeActiveRecipe(REST_A, dish, 'TD', [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 1000 },
    ]);

    // Cost 100, price 120 → margin 16.67% → tight.
    const res = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 1 }],
    });
    expect(res.verdict).toBe('tight');
  });

  it('returns no-cost-data when nothing has an active recipe', async () => {
    const dish = await makeMenuProduct('No Recipe Dish', 100);
    const res = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 1 }],
    });
    expect(res.verdict).toBe('no-cost-data');
    expect(res.estVariableCost).toBe(0);
    expect(res.costedItems).toBe(0);
  });

  it('isolates tenants — cross-tenant product id is ignored', async () => {
    const paneerB = await makeIngredient('Paneer B', 'kg', 200, REST_B);
    const dish = await makeMenuProduct('Tenant B Dish', 200, REST_B);
    await makeActiveRecipe(REST_B, dish, 'TB', [
      { inventoryItemId: String(paneerB._id), itemName: 'Paneer B', unit: 'g', quantity: 1000 },
    ]);

    // dish + its recipe live in REST_B. A bill in REST_A referencing it must
    // see nothing (tenant-scoped product lookup) — and the same product id
    // must NOT pick up REST_A's ingredient costs.
    const res = await profitabilityService.billEconomics(REST_A, {
      items: [{ productId: String(dish._id), quantity: 1 }],
    });
    expect(res.totalItems).toBe(0);
    expect(res.verdict).toBe('no-cost-data');

    // Sanity: tenant B sees the costed bill fine.
    const resB = await profitabilityService.billEconomics(REST_B, {
      items: [{ productId: String(dish._id), quantity: 1 }],
    });
    expect(resB.totalItems).toBe(1);
    expect(resB.estVariableCost).toBe(200);
  });
});
