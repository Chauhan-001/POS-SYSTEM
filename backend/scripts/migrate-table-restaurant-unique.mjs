/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * migrate-table-restaurant-unique.mjs
 *
 * The Table schema's unique index is (restaurantId, branchId, number) —
 * scoped per restaurant so two tenants can each run branchless table
 * numbers 1-N. The live MongoDB still carries the OLD global unique index
 * (branchId, number), which made one restaurant's branchless tables 1-4
 * block every other restaurant from using those numbers.
 *
 * This script:
 *   1. Verifies no active (restaurantId, branchId, number) duplicates exist
 *      (aborts if they do — resolve collisions first).
 *   2. Drops the old global index branchId_1_number_1.
 *   3. Creates restaurantId_1_branchId_1_number_1 (unique, partial on
 *      isDeleted: false) — matching TableSchema in src/models/Table.ts.
 *
 * Run:  node scripts/migrate-table-restaurant-unique.mjs
 */

import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const OLD_INDEX = 'branchId_1_number_1';
const NEW_INDEX = 'restaurantId_1_branchId_1_number_1';

async function main() {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db;
  const col = db.collection('tables');

  console.log('Connected to', URI);

  // ── 1. Safety check: active duplicates under the NEW key ───────────
  const dups = await col
    .aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: { restaurantId: '$restaurantId', branchId: '$branchId', number: '$number' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ])
    .toArray();

  if (dups.length > 0) {
    console.error('ABORT: active duplicate (restaurantId, branchId, number) rows found:');
    for (const d of dups) console.error('  ', JSON.stringify(d));
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  console.log('No active (restaurantId, branchId, number) duplicates — safe to proceed.');

  // ── 2. Drop the old global index ────────────────────────────────────
  const before = await col.indexes();
  const hadOld = before.some((i) => i.name === OLD_INDEX);
  if (hadOld) {
    await col.dropIndex(OLD_INDEX);
    console.log(`Dropped old index "${OLD_INDEX}".`);
  } else {
    console.log(`Old index "${OLD_INDEX}" not present — nothing to drop.`);
  }

  // ── 3. Create the restaurant-scoped unique partial index ────────────
  const hasNew = (await col.indexes()).some((i) => i.name === NEW_INDEX);
  if (!hasNew) {
    await col.createIndex(
      { restaurantId: 1, branchId: 1, number: 1 },
      { name: NEW_INDEX, unique: true, partialFilterExpression: { isDeleted: false } }
    );
    console.log(`Created "${NEW_INDEX}" (unique, partial on isDeleted:false).`);
  } else {
    console.log(`Index "${NEW_INDEX}" already present.`);
  }

  // ── 4. Report final state ───────────────────────────────────────────
  console.log('\nFinal indexes on tables:');
  for (const i of await col.indexes()) {
    console.log(
      `  ${i.name}  ${JSON.stringify(i.key)}${i.unique ? '  UNIQUE' : ''}` +
        (i.partialFilterExpression ? `  partial:${JSON.stringify(i.partialFilterExpression)}` : '')
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
