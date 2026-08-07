/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1.7 Migration — Expenses & Finance.
 *
 * Safe, idempotent migration that:
 *  1. Stamps restaurantId on legacy expenses (inferred from their branch's
 *     restaurantId; otherwise left null-safe — the repo still scopes them to
 *     the tenant that owns the branch).
 *  2. Seeds the 13 system ExpenseCategories for every restaurant (idempotent).
 *  3. Creates a FinanceSettings document per restaurant (defaults).
 *  4. Migrates legacy free-text vendor strings into Vendor documents and links
 *     expenses by matching vendor names (only when a name is present).
 *  5. Sets isCogs on legacy expenses whose category is Ingredients & Raw
 *     Materials.
 *
 * Usage:  npx tsx scripts/migrate-phase-1.7.ts
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import Branch from '../src/models/Branch';
import Expense from '../src/models/Expense';
import Vendor from '../src/models/Vendor';
import FinanceSettings from '../src/models/FinanceSettings';
import ExpenseCategory from '../src/models/ExpenseCategory';
import { SYSTEM_CATEGORIES } from '../src/services/expenseCategoryService';

async function main() {
  const uri = config.mongoUri;
  console.log(`[migrate-1.7] Connecting to MongoDB…`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  console.log('[migrate-1.7] Connected.');

  // ── 1. Tenant-stamp legacy expenses ──────────────────────────
  const unstamped = await Expense.countDocuments({ restaurantId: { $exists: false } }).exec();
  console.log(`[migrate-1.7] Legacy expenses without restaurantId: ${unstamped}`);
  if (unstamped > 0) {
    const branches = await Branch.find({ restaurantId: { $ne: null } }).select('_id restaurantId').lean().exec();
    const branchRestaurant = new Map(branches.map((b: any) => [b._id.toString(), b.restaurantId?.toString()]));
    const legacy = await Expense.find({ restaurantId: { $exists: false } }).select('_id branchId').lean().exec();
    let stamped = 0;
    for (const e of legacy) {
      const rid = e.branchId ? branchRestaurant.get(e.branchId.toString()) : undefined;
      if (rid) {
        await Expense.updateOne({ _id: e._id }, { $set: { restaurantId: new mongoose.Types.ObjectId(rid) } }).exec();
        stamped++;
      }
    }
    console.log(`[migrate-1.7] Stamped restaurantId on ${stamped}/${legacy.length} legacy expenses (rest via branch).`);
  }

  // ── 2. Seed system expense categories per restaurant ────────
  const restaurants = await Branch.distinct('restaurantId').exec();
  const allRids = new Set<string>((restaurants as string[]).filter(Boolean));
  const expenseRids = await Expense.distinct('restaurantId').exec();
  (expenseRids as string[]).forEach((r) => allRids.add(r));

  let seeded = 0;
  for (const rid of allRids) {
    const existing = await ExpenseCategory.countDocuments({ restaurantId: rid }).exec();
    if (existing === 0) {
      await ExpenseCategory.insertMany(
        SYSTEM_CATEGORIES.map((c) => ({
          restaurantId: new mongoose.Types.ObjectId(rid),
          ...c,
          isSystem: true,
          isActive: true,
        }))
      );
      seeded += SYSTEM_CATEGORIES.length;
    }
    // Ensure FinanceSettings exists.
    await FinanceSettings.updateOne(
      { restaurantId: rid },
      { $setOnInsert: { restaurantId: new mongoose.Types.ObjectId(rid) } },
      { upsert: true }
    ).exec();
  }
  console.log(`[migrate-1.7] Seeded ${seeded} system categories across ${allRids.size} restaurants; FinanceSettings ensured.`);

  // ── 3. Migrate legacy vendor strings → Vendor documents ─────
  const vendorNames = await Expense.distinct('vendor').exec();
  const names = (vendorNames as string[]).filter((n) => n && n.trim().length > 0);
  let vendorsCreated = 0;
  let expensesLinked = 0;
  for (const name of names) {
    // Create one vendor per restaurant+name (idempotent via unique index guard).
    const byRestaurant = await Expense.aggregate([
      { $match: { vendor: name, vendorId: { $exists: false } } },
      { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
    ]).exec();
    for (const row of byRestaurant) {
      if (!row._id) continue;
      let vendor = await Vendor.findOne({ restaurantId: row._id, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).exec();
      if (!vendor) {
        vendor = await Vendor.create({ restaurantId: row._id, name });
        vendorsCreated++;
      }
      const res = await Expense.updateMany(
        { restaurantId: row._id, vendor: name, vendorId: { $exists: false } },
        { $set: { vendorId: vendor._id } }
      ).exec();
      expensesLinked += res.modifiedCount || 0;
    }
  }
  console.log(`[migrate-1.7] Created ${vendorsCreated} vendors, linked ${expensesLinked} legacy expenses.`);

  // ── 4. Backfill isCogs on legacy COGS-category expenses ─────
  const cogsName = SYSTEM_CATEGORIES.find((c) => c.isCogs)?.name;
  if (cogsName) {
    const res = await Expense.updateMany(
      { category: cogsName, isCogs: { $exists: false } },
      { $set: { isCogs: true, version: 1 } }
    ).exec();
    console.log(`[migrate-1.7] Backfilled isCogs on ${res.modifiedCount || 0} expenses.`);
  }

  await mongoose.disconnect();
  console.log('[migrate-1.7] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate-1.7] Migration failed:', err);
  process.exit(1);
});
