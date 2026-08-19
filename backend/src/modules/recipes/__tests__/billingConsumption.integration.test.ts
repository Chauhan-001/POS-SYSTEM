/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A — Recipe consumption + billing integration tests.
 *
 * These exercise the REAL bill lifecycle (billService.create/voidBill)
 * end to end: a bill is persisted, recipe-linked products skip the legacy
 * per-menu-product deduction, ingredient stock is consumed through the stock
 * engine, and void/refund reverse exactly the right quantities.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { billService } from '../../../services';
import { consumptionService } from '../services/consumptionService';
import { recipeService } from '../services/recipeService';
import Recipe from '../models/Recipe';
import RecipeVersion from '../models/RecipeVersion';
import RecipeConsumption from '../models/RecipeConsumption';
import Product from '../../../models/Product';
import ConfigurationTemplate from '../../menu-config/models/ConfigurationTemplate';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import Employee from '../../../models/Employee';
import InventoryEvent from '../../../models/InventoryEvent';
import AuditLog from '../../../models/AuditLog';
import { hashPin } from '../../../utils/bcrypt';

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const BRANCH_A = new mongoose.Types.ObjectId().toString();
const BRANCH_B = new mongoose.Types.ObjectId().toString();

async function makeIngredient(name: string, unit: string, averageCost: number, currentStock = 100, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `INV-${name.toUpperCase().replace(/\s+/g, '')}`,
    price: 0,
    category: 'Inventory',
    availability: false,
    restaurantId,
    currentStock,
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

async function makeMenuProduct(name: string, price: number, currentStock = 10, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `MNU-${name.toUpperCase().replace(/\s+/g, '')}`,
    price,
    category: 'Main Course',
    availability: true,
    restaurantId,
    currentStock,
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

async function activateRecipe(restaurantId: string, productId: string | mongoose.Types.ObjectId, components: any[], name = 'Recipe') {
  return recipeService.create(restaurantId, {
    productId: String(productId),
    name,
    status: 'active',
    yieldQuantity: 1,
    yieldUnit: 'plate',
    components,
  }, { operator: 'owner' });
}

let invoiceSeq = 0;
/** The minimal bill payload billService.create needs (mirrors the frontend). */
function billPayload(items: any[], overrides: any = {}) {
  invoiceSeq += 1;
  return {
    invoiceNumber: `INV-${invoiceSeq}`,
    ticketNumber: `T-${invoiceSeq}`,
    date: '2026-08-12',
    time: '12:00',
    cashierName: 'Cashier',
    cashierRole: 'Cashier',
    subtotal: 1000,
    gst: 50,
    grandTotal: 1050,
    paymentMethod: 'Cash',
    orderType: 'Dine-in',
    branchId: BRANCH_A,
    items,
    ...overrides,
  };
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
  invoiceSeq = 0;
  await Promise.all([
    Recipe.deleteMany({}).exec(),
    RecipeVersion.deleteMany({}).exec(),
    RecipeConsumption.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    Employee.deleteMany({}).exec(),
    InventoryEvent.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
  ]);
}

async function shutdown() {
  if (connected) {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    connected = false;
  }
}

async function stockOf(productId: string): Promise<number> {
  const p = await Product.findById(productId).lean().exec();
  return Number(p?.currentStock) || 0;
}

/** Create an Owner/Manager employee so refund/void PIN checks pass. */
async function makeManager(restaurantId = REST_A, pin = '1008') {
  return Employee.create({
    username: `mgr_${restaurantId.slice(-4)}`,
    name: 'Manager',
    role: 'Manager',
    pin: await hashPin(pin),
    status: 'Active',
    restaurantId,
    branchId: BRANCH_A,
  } as any);
}

beforeAll(ensureDb, 60_000);
afterAll(shutdown, 60_000);
beforeEach(wipe);

describe('Phase A — recipe consumption in the real billing flow', () => {
  it('TEST 1 — basic recipe sale: ingredient consumed, one record, cost snapshot frozen', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    const before = await stockOf(String(paneer._id));
    const bill = await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    expect(bill).toBeTruthy();
    // 200 g = 0.2 kg consumed.
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.2, 5);

    const records = await RecipeConsumption.find({ restaurantId: REST_A }).lean().exec();
    expect(records.length).toBe(1);
    const r: any = records[0];
    expect(String(r.billId)).toBe(String((bill as any)._id));
    expect(r.items[0].itemName).toBe('Paneer');
    expect(r.items[0].quantity).toBeCloseTo(0.2, 5);
    expect(r.items[0].costPerUnit).toBe(380); // frozen weighted-avg cost
    expect(r.totalCost).toBeCloseTo(76, 5);   // 0.2 × 380

    // The consumed quantity went through the stock engine (InventoryEvent 'sold').
    const sold = await InventoryEvent.find({ restaurantId: REST_A, type: 'sold' }).lean().exec();
    expect(sold.some((e: any) => e.item === 'Paneer')).toBe(true);
  });

  it('TEST 2 — no recipe: legacy product deduction retained, no consumption record', async () => {
    const plain = await makeMenuProduct('Plain Fries', 120);
    const before = await stockOf(String(plain._id));

    const bill = await billService.create(billPayload([
      { product: { id: String(plain._id), name: 'Plain Fries' }, quantity: 2, price: 120 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    expect(bill).toBeTruthy();
    // Legacy per-menu-product deduction: 10 → 8.
    expect(await stockOf(String(plain._id))).toBeCloseTo(before - 2, 5);
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(0);
  });

  it('TEST 3 — no double deduction: recipe product skips legacy deduction, ingredients consumed', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280, 50); // menu product HAS stock
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    const dishBefore = await stockOf(String(dish._id));
    const paneerBefore = await stockOf(String(paneer._id));

    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 2, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Menu product stock UNCHANGED (recipe semantics are authoritative).
    expect(await stockOf(String(dish._id))).toBeCloseTo(dishBefore, 5);
    // Ingredient consumed: 2 × 200 g = 0.4 kg.
    expect(await stockOf(String(paneer._id))).toBeCloseTo(paneerBefore - 0.4, 5);
  });

  it('TEST 4 — multiple quantity: 5 × product consumes 1000 g', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    const before = await stockOf(String(paneer._id));
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 5, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // 5 × 200 g = 1000 g = 1 kg.
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 1, 5);
    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A }).lean().exec();
    expect(r.items[0].quantity).toBeCloseTo(1, 5);
  });

  it('TEST 5 — multiple recipe products sharing an ingredient: combined consumption is exact', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const pbm = await makeMenuProduct('Paneer Butter Masala', 280);
    const tikka = await makeMenuProduct('Paneer Tikka', 320);
    // PBM: 200 g paneer; Tikka: 150 g paneer.
    await activateRecipe(REST_A, pbm._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ], 'PBM');
    await activateRecipe(REST_A, tikka._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 150 },
    ], 'PT');

    const before = await stockOf(String(paneer._id));
    await billService.create(billPayload([
      { product: { id: String(pbm._id), name: 'Paneer Butter Masala' }, quantity: 2, price: 280 },
      { product: { id: String(tikka._id), name: 'Paneer Tikka' }, quantity: 3, price: 320 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Expected: 2 × 200 + 3 × 150 = 850 g = 0.85 kg.
    expect(await stockOf(String(paneer._id))).toBeCloseTo(before - 0.85, 5);
    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A }).lean().exec();
    expect(r.items[0].itemName).toBe('Paneer');
    expect(r.items[0].quantity).toBeCloseTo(0.85, 5);
  });

  it('TEST 6 — offline replay: same clientRef does not double-consume', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    const payload = billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ], { clientRef: 'ABC123' });

    const first = await billService.create(payload, { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    const paneerAfterFirst = await stockOf(String(paneer._id));

    // Replay the exact same payload (offline queue retry).
    const replay = await billService.create(payload, { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    expect(String((replay as any)._id)).toBe(String((first as any)._id)); // same bill
    expect(await stockOf(String(paneer._id))).toBeCloseTo(paneerAfterFirst, 5); // no second consumption
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_A })).toBe(1);
    expect(await InventoryEvent.countDocuments({ restaurantId: REST_A, type: 'sold' })).toBe(1);
  });

  it('TEST 7 — void: ingredient restored, consumption record reversed', async () => {
    await makeManager();
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    const bill = await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    const afterSale = await stockOf(String(paneer._id));

    await billService.voidBill(String((bill as any)._id), { reason: 'Void test', voidedBy: 'Manager' }, { restaurantId: REST_A, branchId: BRANCH_A });

    // Ingredient restored (+0.2 kg), menu product untouched (it was never deducted).
    expect(await stockOf(String(paneer._id))).toBeCloseTo(afterSale + 0.2, 5);
    expect(await stockOf(String(dish._id))).toBe(10);

    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A }).lean().exec();
    expect(r.status).toBe('voided');
    // A 'return' movement was recorded for the reversal.
    expect(await InventoryEvent.countDocuments({ restaurantId: REST_A, type: 'return' })).toBe(1);
  });

  it('TEST 9 — recipe version: historical sale keeps the version active at sale time', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    const rec = await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    // Sale while v1 (200 g) is active.
    const bill1 = await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Edit the active recipe to v2 (180 g).
    await recipeService.update(REST_A, String(rec._id), {
      components: [{ inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 180 }],
    } as any, { operator: 'owner' } as any);

    // New sale uses v2 (180 g).
    const bill2 = await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    const r1: any = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: (bill1 as any)._id }).lean().exec();
    const r2: any = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: (bill2 as any)._id }).lean().exec();
    expect(r1.items[0].quantity).toBeCloseTo(0.2, 5);  // v1 → 200 g
    expect(r1.lines[0].recipeVersion).toBe(1);
    expect(r2.items[0].quantity).toBeCloseTo(0.18, 5); // v2 → 180 g
    expect(r2.lines[0].recipeVersion).toBe(2);
  });

  it('TEST 10 — cost snapshot: later averageCost changes never touch historical consumption', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 300);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Ingredient cost rises to 350 AFTER the sale.
    await Product.findByIdAndUpdate(paneer._id, { averageCost: 350 }).exec();

    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A }).lean().exec();
    expect(r.items[0].costPerUnit).toBe(300); // frozen at sale time
    expect(r.totalCost).toBeCloseTo(0.2 * 300, 5);
  });

  it('TEST 11 — cross-tenant: restaurant B cannot consume restaurant A recipe/ingredients', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380, 100, REST_A);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280, 10, REST_A);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    // B attempts to bill A's product id (a forged cross-tenant reference).
    await billService.create(billPayload([
      { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
    ]), { restaurantId: REST_B, branchId: BRANCH_B, operator: 'Cashier' });

    // B has no active recipe for A's product → no consumption record, no ingredient deduction.
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_B })).toBe(0);
    expect(await stockOf(String(paneer._id))).toBe(100); // A's ingredient untouched
    // A's menu product was NOT deducted either (recipe exists but is A's — B never resolves it,
    // and the legacy deduction fails tenant isolation inside the stock engine, staying best-effort).
    expect(await stockOf(String(dish._id))).toBe(10);
  });

  it('TEST 12 — consumption failure is non-fatal: the bill still succeeds and failure is audited', async () => {
    const paneer = await makeIngredient('Paneer', 'kg', 380);
    const dish = await makeMenuProduct('Paneer Butter Masala', 280);
    await activateRecipe(REST_A, dish._id, [
      { inventoryItemId: String(paneer._id), itemName: 'Paneer', unit: 'g', quantity: 200 },
    ]);

    // Simulate an operational failure inside consumption processing.
    const orig = consumptionService.generateForBill.bind(consumptionService);
    (consumptionService as any).generateForBill = async () => { throw new Error('simulated consumption failure'); };

    let bill: any;
    try {
      bill = await billService.create(billPayload([
        { product: { id: String(dish._id), name: 'Paneer Butter Masala' }, quantity: 1, price: 280 },
      ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });
    } finally {
      (consumptionService as any).generateForBill = orig;
    }

    // The bill was still created successfully.
    expect(bill).toBeTruthy();
    expect(String(bill._id)).toBeTruthy();
    // Failure was audited (observable, not silently swallowed).
    const audit = await AuditLog.find({ action: 'RECIPE_CONSUMPTION_FAILED' }).lean().exec();
    expect(audit.length).toBe(1);
  });
});

describe('Phase 4 — configuration-driven recipe layers (BASE + option deltas + add-ons)', () => {
  /** Attach a reusable MODIFIER_GROUP template with a delta recipe on an option. */
  async function attachModifierGroup(restaurantId: string, productId: string, deltaRecipeId: string) {
    const tpl = await ConfigurationTemplate.create({
      name: 'Toppings',
      type: 'MODIFIER_GROUP',
      status: 'active',
      version: 1,
      restaurantId,
      data: {
        selectionMode: 'MULTIPLE',
        required: false,
        options: [
          { id: 'o_cheese', name: 'Extra Cheese', priceDelta: 40, active: true, sortOrder: 0, recipeMappingId: String(deltaRecipeId) },
        ],
      },
    } as any);
    await Product.updateOne(
      { _id: productId },
      {
        $set: {
          menuConfig: {
            variantConfigurations: [],
            modifierConfigurations: [{ templateId: tpl._id, mode: 'shared' }],
            addOnConfigurations: [],
          },
        },
      }
    ).exec();
    return tpl;
  }

  /** Attach an ADD_ON_GROUP whose option references another menu product. */
  async function attachAddOnGroup(restaurantId: string, productId: string, addOnProductId: string) {
    const tpl = await ConfigurationTemplate.create({
      name: 'Sides',
      type: 'ADD_ON_GROUP',
      status: 'active',
      version: 1,
      restaurantId,
      data: {
        selectionMode: 'MULTIPLE',
        required: false,
        options: [
          { id: 'o_gbread', name: 'Garlic Bread', price: 80, priceDelta: 0, active: true, sortOrder: 0, productId: new mongoose.Types.ObjectId(addOnProductId) },
        ],
      },
    } as any);
    await Product.updateOne(
      { _id: productId },
      {
        $set: {
          menuConfig: {
            variantConfigurations: [],
            modifierConfigurations: [],
            addOnConfigurations: [{ templateId: tpl._id, mode: 'shared' }],
          },
        },
      }
    ).exec();
    return tpl;
  }

  it('TEST 13 — modifier option delta stacks on the base recipe (never replaces it)', async () => {
    const cheese = await makeIngredient('Cheese Block', 'kg', 500);
    const dough = await makeIngredient('Dough Ball', 'kg', 60);
    const pizza = await makeMenuProduct('Margherita Pizza', 280);
    // BASE recipe: dough 250g + cheese 100g
    await activateRecipe(REST_A, pizza._id, [
      { inventoryItemId: String(dough._id), itemName: 'Dough Ball', unit: 'g', quantity: 250 },
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 100 },
    ]);
    // DELTA recipe ("Extra Cheese"): cheese +40g — productId = the ingredient itself
    const deltaRecipe = await activateRecipe(REST_A, String(cheese._id), [
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 40 },
    ], 'Extra Cheese +40g');
    const tpl = await attachModifierGroup(REST_A, String(pizza._id), String((deltaRecipe as any)._id));

    const doughBefore = await stockOf(String(dough._id));
    const cheeseBefore = await stockOf(String(cheese._id));

    const billLike: any = { _id: new mongoose.Types.ObjectId(), invoiceNumber: 'INV-CFG1', date: '2026-08-12' };
    await consumptionService.generateForBill(billLike, [
      {
        menuItemId: String(pizza._id),
        itemName: 'Margherita Pizza',
        quantity: 2,
        configuration: { selections: [{ groupId: String(tpl._id), optionIds: ['o_cheese'] }] },
      },
    ], { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Dough: 250g × 2 = 0.5 kg (base only — no dough delta).
    expect(await stockOf(String(dough._id))).toBeCloseTo(doughBefore - 0.5, 5);
    // Cheese: base 100g × 2 + delta 40g × 2 = 280g = 0.28 kg (sum, never double-counted).
    expect(await stockOf(String(cheese._id))).toBeCloseTo(cheeseBefore - 0.28, 5);

    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: String(billLike._id) }).lean().exec();
    expect(r).toBeTruthy();
    const cheeseItem = r.items.find((i: any) => i.itemName === 'Cheese Block');
    expect(cheeseItem.quantity).toBeCloseTo(0.28, 5);
    // Delta layer is distinguishable in the record's lines.
    const deltaLine = r.lines.find((l: any) => l.source === 'option' && l.optionName === 'Extra Cheese');
    expect(deltaLine).toBeTruthy();
  });

  it('TEST 14 — option quantity multiplies the delta (Extra Cheese ×2 = +80g)', async () => {
    const cheese = await makeIngredient('Cheese Block', 'kg', 500);
    const pizza = await makeMenuProduct('Cheese Pizza', 300);
    await activateRecipe(REST_A, pizza._id, [
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 100 },
    ]);
    const deltaRecipe = await activateRecipe(REST_A, String(cheese._id), [
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 40 },
    ], 'Extra Cheese +40g');
    const tpl = await attachModifierGroup(REST_A, String(pizza._id), String((deltaRecipe as any)._id));

    const cheeseBefore = await stockOf(String(cheese._id));
    const billLike: any = { _id: new mongoose.Types.ObjectId(), invoiceNumber: 'INV-CFG2', date: '2026-08-12' };
    await consumptionService.generateForBill(billLike, [
      {
        menuItemId: String(pizza._id),
        itemName: 'Cheese Pizza',
        quantity: 1,
        configuration: { selections: [{ groupId: String(tpl._id), optionIds: ['o_cheese'], quantities: { o_cheese: 2 } }] },
      },
    ], { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // base 100g + (40g × 2) = 180g = 0.18 kg.
    expect(await stockOf(String(cheese._id))).toBeCloseTo(cheeseBefore - 0.18, 5);
  });

  it('TEST 15 — add-on consumes its own product recipe', async () => {
    const dough = await makeIngredient('Dough Ball', 'kg', 60);
    const butter = await makeIngredient('Butter Block', 'kg', 400);
    const pizza = await makeMenuProduct('Plain Pizza', 260);
    const garlicBread = await makeMenuProduct('Garlic Bread', 80);
    await activateRecipe(REST_A, pizza._id, [
      { inventoryItemId: String(dough._id), itemName: 'Dough Ball', unit: 'g', quantity: 250 },
    ]);
    await activateRecipe(REST_A, garlicBread._id, [
      { inventoryItemId: String(butter._id), itemName: 'Butter Block', unit: 'g', quantity: 30 },
    ]);
    const tpl = await attachAddOnGroup(REST_A, String(pizza._id), String(garlicBread._id));

    const doughBefore = await stockOf(String(dough._id));
    const butterBefore = await stockOf(String(butter._id));

    const billLike: any = { _id: new mongoose.Types.ObjectId(), invoiceNumber: 'INV-CFG3', date: '2026-08-12' };
    await consumptionService.generateForBill(billLike, [
      {
        menuItemId: String(pizza._id),
        itemName: 'Plain Pizza',
        quantity: 2,
        configuration: { selections: [{ groupId: String(tpl._id), optionIds: ['o_gbread'] }] },
      },
    ], { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    // Dough: 250g × 2 = 0.5 kg. Butter: add-on's own recipe 30g × 2 = 0.06 kg.
    expect(await stockOf(String(dough._id))).toBeCloseTo(doughBefore - 0.5, 5);
    expect(await stockOf(String(butter._id))).toBeCloseTo(butterBefore - 0.06, 5);

    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: String(billLike._id) }).lean().exec();
    const addonLine = r.lines.find((l: any) => l.source === 'addon' && l.optionName === 'Garlic Bread');
    expect(addonLine).toBeTruthy();
  });

  it('TEST 16 — full billing flow: configured sale consumes base + delta exactly once, no menu-product deduction', async () => {
    const cheese = await makeIngredient('Cheese Block', 'kg', 500);
    const pizza = await makeMenuProduct('Margherita Pizza', 280, 20); // menu product HAS stock
    await activateRecipe(REST_A, pizza._id, [
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 100 },
    ]);
    const deltaRecipe = await activateRecipe(REST_A, String(cheese._id), [
      { inventoryItemId: String(cheese._id), itemName: 'Cheese Block', unit: 'g', quantity: 40 },
    ], 'Extra Cheese +40g');
    const tpl = await attachModifierGroup(REST_A, String(pizza._id), String((deltaRecipe as any)._id));

    const pizzaBefore = await stockOf(String(pizza._id));
    const cheeseBefore = await stockOf(String(cheese._id));

    // Client price must match the authoritative reprice: base 280 + delta 40 = 320.
    const bill = await billService.create(billPayload([
      {
        product: { id: String(pizza._id), name: 'Margherita Pizza', gstPercent: 5 },
        quantity: 2,
        price: 320,
        configuration: { selections: [{ groupId: String(tpl._id), optionIds: ['o_cheese'] }] },
      },
    ]), { restaurantId: REST_A, branchId: BRANCH_A, operator: 'Cashier' });

    expect(bill).toBeTruthy();
    // Menu product stock untouched (recipe semantics authoritative — no double deduction).
    expect(await stockOf(String(pizza._id))).toBeCloseTo(pizzaBefore, 5);
    // Cheese: (100 + 40) × 2 = 280g = 0.28 kg.
    expect(await stockOf(String(cheese._id))).toBeCloseTo(cheeseBefore - 0.28, 5);

    const r: any = await RecipeConsumption.findOne({ restaurantId: REST_A, billId: String((bill as any)._id) }).lean().exec();
    expect(r).toBeTruthy();
    expect(r.items.find((i: any) => i.itemName === 'Cheese Block').quantity).toBeCloseTo(0.28, 5);
  });

  it('TEST 17 — cross-tenant: restaurant B cannot consume restaurant A delta recipes', async () => {
    const cheeseA = await makeIngredient('Cheese Block', 'kg', 500);
    const pizzaA = await makeMenuProduct('Margherita Pizza', 280, 20, REST_A);
    await activateRecipe(REST_A, pizzaA._id, [
      { inventoryItemId: String(cheeseA._id), itemName: 'Cheese Block', unit: 'g', quantity: 100 },
    ]);
    const deltaRecipe = await activateRecipe(REST_A, String(cheeseA._id), [
      { inventoryItemId: String(cheeseA._id), itemName: 'Cheese Block', unit: 'g', quantity: 40 },
    ], 'Extra Cheese +40g');
    // Attach the A-owned template to an A product, then bill it as TENANT B —
    // the template lookup is tenant-scoped so the delta must NOT apply.
    const tpl = await attachModifierGroup(REST_A, String(pizzaA._id), String((deltaRecipe as any)._id));

    const cheeseBefore = await stockOf(String(cheeseA._id));
    const billLike: any = { _id: new mongoose.Types.ObjectId(), invoiceNumber: 'INV-CFG4', date: '2026-08-12' };
    await consumptionService.generateForBill(billLike, [
      {
        menuItemId: String(pizzaA._id),
        itemName: 'Margherita Pizza',
        quantity: 1,
        configuration: { selections: [{ groupId: String(tpl._id), optionIds: ['o_cheese'] }] },
      },
    ], { restaurantId: REST_B, branchId: BRANCH_B, operator: 'Cashier' });

    // Nothing consumed: restaurant B cannot see A's templates or recipes.
    expect(await stockOf(String(cheeseA._id))).toBeCloseTo(cheeseBefore, 5);
    expect(await RecipeConsumption.countDocuments({ restaurantId: REST_B })).toBe(0);
  });
});
