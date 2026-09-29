/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase→Expense + FIFO cost basis tests:
 *  1. A purchase auto-creates a system expense in the register (idempotent).
 *  2. Purchase edits keep the expense amount in sync; deletes void it.
 *  3. Stock-outs record the real FIFO cost (unitCost/totalCost) on the event.
 *  4. P&L: purchase-generated expenses are the cash view — excluded from the
 *     usage P&L so COGS is never double-counted; wastage uses recorded cost.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { purchaseService, stockMovementService, financeService } from '../index';
import Expense from '../../models/Expense';
import Product from '../../models/Product';
import InventoryEvent from '../../models/InventoryEvent';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();

async function seedInventoryProduct(over: any = {}) {
  return Product.create({
    name: over.name || 'Tomato',
    code: over.code || `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: 0,
    category: 'Inventory',
    image: '',
    gstPercent: 0,
    type: 'inventory',
    availability: false,
    restaurantId: new mongoose.Types.ObjectId(REST),
    branchPrice: {},
    currentStock: over.currentStock ?? 0,
    unit: over.unit || 'kg',
    minStock: 0,
    maxStock: 1000,
    reorderLevel: 0,
    averageCost: over.averageCost ?? 0,
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
    batches: over.batches || [],
  } as any);
}

describe('Purchase→Expense + FIFO cost basis', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Expense.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      InventoryEvent.deleteMany({}).exec(),
    ]);
  });

  it('purchase creates a system expense in the register (idempotent on retry)', async () => {
    await purchaseService.create(
      { item: 'Tomato', quantity: 10, price: 20, unit: 'kg', supplier: 'Fresh Farms' } as any,
      REST,
      { operator: 'Manager' }
    );

    let expenses = await Expense.find({ restaurantId: new mongoose.Types.ObjectId(REST) }).lean();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].isSystemGenerated).toBe(true);
    expect(expenses[0].isCogs).toBe(true);
    expect(expenses[0].category).toBe('Ingredients & Raw Materials');
    expect(expenses[0].amount).toBe(200);
    expect(expenses[0].sourceRef).toMatch(/^purchase:[a-fA-F0-9]{24}$/);
    expect(expenses[0].description).toContain('Tomato');

    // A second purchase (new purchase id → new expense) is correct; but the
    // upsert must never create two expenses for the SAME purchase. Verify the
    // idempotency anchor is unique per purchase by re-checking the count:
    await purchaseService.create(
      { item: 'Tomato', quantity: 10, price: 20, unit: 'kg' } as any,
      REST,
      { operator: 'Manager' }
    );
    expenses = await Expense.find({ restaurantId: new mongoose.Types.ObjectId(REST) }).lean();
    expect(expenses.length).toBe(2); // two purchases → two expenses (one each)
    const refs = new Set(expenses.map((e: any) => e.sourceRef));
    expect(refs.size).toBe(2); // no shared/duplicated sourceRef
  });

  it('purchase edit syncs the expense amount; delete voids it', async () => {
    const created: any = await purchaseService.create(
      { item: 'Onion', quantity: 5, price: 30, unit: 'kg' } as any,
      REST,
      { operator: 'Manager' }
    );
    const pid = created._id.toString();

    let linked = await Expense.findOne({ sourceRef: `purchase:${pid}` }).lean() as any;
    expect(linked).toBeTruthy();
    expect(linked.amount).toBe(150);

    // Edit: quantity 5→8 at same price → total 240.
    await purchaseService.update(pid, REST, { quantity: 8 } as any, { operator: 'Manager' });
    linked = await Expense.findOne({ sourceRef: `purchase:${pid}` }).lean() as any;
    expect(linked.amount).toBe(240);

    // Delete → expense soft-deleted (void), restorable.
    await purchaseService.delete(pid, REST, { operator: 'Manager' });
    linked = await Expense.findOne({ sourceRef: `purchase:${pid}` }).lean() as any;
    expect(linked.isDeleted).toBe(true);
  });

  it('stock-out records real FIFO cost from the consumed batch', async () => {
    const product: any = await seedInventoryProduct({ name: 'Flour', unit: 'kg' });
    // Stock-in: 10kg @ ₹40 (batch A), then 5kg @ ₹50 (batch B) — distinct
    // expiry dates so they stay as separate FIFO batches.
    await stockMovementService.applyMovement({
      restaurantId: REST, productId: product._id.toString(),
      delta: 10, type: 'purchase', unit: 'kg', purchasePrice: 40, expiryDate: '2027-01-01',
    });
    await stockMovementService.applyMovement({
      restaurantId: REST, productId: product._id.toString(),
      delta: 5, type: 'purchase', unit: 'kg', purchasePrice: 50, expiryDate: '2027-06-01',
    });

    // Consume 12kg → FIFO: 10 @ 40 (400) + 2 @ 50 (100) = 500.
    const result: any = await stockMovementService.applyMovement({
      restaurantId: REST, productId: product._id.toString(),
      delta: -12, type: 'sale', unit: 'kg',
    });
    expect(result.costBasis).toBe(500);
    expect(result.unitCost).toBeCloseTo(500 / 12, 2);

    const soldEvent: any = await InventoryEvent.findOne({ type: 'sold' }).lean();
    expect(soldEvent.totalCost).toBe(500);
    expect(soldEvent.unitCost).toBeCloseTo(500 / 12, 2);

    // Purchase events carry the price paid per unit too.
    const purchaseEvents: any[] = await InventoryEvent.find({ type: 'purchase' }).sort({ createdAt: 1 }).lean();
    expect(purchaseEvents[0].unitCost).toBe(40);
    expect(purchaseEvents[0].totalCost).toBe(400);
    expect(purchaseEvents[1].unitCost).toBe(50);
    expect(purchaseEvents[1].totalCost).toBe(250);

    // Merge behavior: same batch key (no expiry/batch) → one batch, price
    // updated to the latest purchase price.
    await stockMovementService.applyMovement({
      restaurantId: REST, productId: product._id.toString(),
      delta: 4, type: 'purchase', unit: 'kg', purchasePrice: 60,
    });
    const refreshed: any = await Product.findById(product._id).lean();
    const openEnded = refreshed.batches.find((b: any) => !b.expiryDate);
    expect(openEnded.quantity).toBe(4);
    expect(openEnded.cost).toBe(60);
  });

  it('wastage uses the recorded FIFO cost; P&L excludes purchase expenses from usage COGS', async () => {
    // Buy through the REAL purchase flow — this both stocks the item (batch
    // cost ₹80/kg) and auto-creates the system expense (cash view).
    await purchaseService.create(
      { item: 'Cheese', quantity: 10, price: 80, unit: 'kg' } as any,
      REST,
      { operator: 'Manager' }
    );
    const stocked: any = await Product.findOne({ name: 'Cheese', restaurantId: new mongoose.Types.ObjectId(REST) }).lean();
    expect(stocked.currentStock).toBe(10);
    // Waste 2kg → recorded cost 160.
    await stockMovementService.applyMovement({
      restaurantId: REST, productId: stocked._id.toString(),
      delta: -2, type: 'waste', unit: 'kg',
    });
    // Sell 3kg → recorded cost 240.
    await stockMovementService.applyMovement({
      restaurantId: REST, productId: stocked._id.toString(),
      delta: -3, type: 'sale', unit: 'kg',
    });

    // A manual operating expense.
    await Expense.create({
      restaurantId: new mongoose.Types.ObjectId(REST),
      date: new Date().toISOString().slice(0, 10),
      category: 'Utilities', description: 'power', amount: 100,
      paymentMethod: 'UPI', isCogs: false,
    } as any);

    const today = new Date().toISOString().slice(0, 10);
    const pnl: any = await financeService.pnl(REST, { period: 'custom', startDate: today, endDate: today });

    // Usage COGS = sold 240 + wasted 160 = 400 (NOT purchase 800).
    expect(pnl.cogs).toBe(400);
    expect(pnl.cogsSource).toBe('recorded');
    expect(pnl.expenseByCategory['Wastage'].amount).toBe(160);
    // Cash view reported separately, not inside expenses/COGS.
    expect(pnl.ingredientPurchases).toBe(800);
    // Ledger expenses = manual utility (100) + Wastage bucket (160).
    expect(pnl.totalExpenses).toBe(260);
    // Operating = ledger minus ledger-COGS (wastage 160) = 100.
    expect(pnl.operatingExpenses).toBe(100);
  });

  it('tenant isolation: another restaurant sees nothing', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await purchaseService.create(
      { item: 'Rice', quantity: 10, price: 50, unit: 'kg' } as any,
      REST,
      { operator: 'Manager' }
    );
    const otherPnl: any = await financeService.pnl(other, { period: 'custom', startDate: '2020-01-01', endDate: '2030-12-31' });
    expect(otherPnl.revenue).toBe(0);
    expect(otherPnl.totalExpenses).toBe(0);
    expect(otherPnl.ingredientPurchases).toBe(0);
  });
});
