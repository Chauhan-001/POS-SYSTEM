/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Table (branchId, number) uniqueness — active-only migration.
 *
 * Problem: the old unique index { branchId, number } also covered soft-deleted
 * tables (isDeleted = true). Re-adding a deleted table with the same number
 * then failed with a 409 duplicate-key error, even though the old table no
 * longer exists in the floor plan.
 *
 * Fix: replace it with a PARTIAL unique index that only constrains ACTIVE
 * tables (isDeleted = false). Soft-deleted rows keep order/history references
 * intact but no longer block re-creating the same table number.
 *
 * Ordering is safe at every step:
 *   1. Create the new partial unique index (succeeds because the old unique
 *      index still guarantees no duplicate ACTIVE pairs).
 *   2. Drop the old unique index.
 * No window exists where duplicate active (branchId, number) rows could be
 * inserted.
 *
 * Usage:  npx tsx scripts/migrate-table-active-unique.ts
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import Table from '../src/models/Table';

const OLD_INDEX_NAME = 'branchId_1_number_1';
const NEW_INDEX_NAME = 'table_branch_number_active';

async function migrate(): Promise<void> {
  const coll = Table.collection;
  const existing = await coll.indexes();
  const oldIdx = existing.find((i: any) => i.name === OLD_INDEX_NAME);
  const newIdx = existing.find((i: any) => i.name === NEW_INDEX_NAME);

  // 0. Backfill: the partial filter { isDeleted: false } only covers documents
  // where the field is literally the boolean false. Any legacy row missing the
  // field would silently drop out of uniqueness — normalize them first.
  const backfill = await coll.updateMany(
    { isDeleted: { $exists: false } },
    { $set: { isDeleted: false } }
  );
  if (backfill.modifiedCount > 0) {
    console.log(`[migrate-table-active-unique] backfilled isDeleted=false on ${backfill.modifiedCount} legacy table(s)`);
  }

  // 1. Create the partial unique index on active tables (if not present).
  if (newIdx) {
    console.log(`[migrate-table-active-unique] index already exists: ${NEW_INDEX_NAME}`);
  } else {
    await coll.createIndex(
      { branchId: 1, number: 1 },
      { name: NEW_INDEX_NAME, unique: true, partialFilterExpression: { isDeleted: false } }
    );
    console.log(`[migrate-table-active-unique] created partial unique index: ${NEW_INDEX_NAME}`);
  }

  // 2. Drop the old full unique index.
  if (oldIdx) {
    await coll.dropIndex(OLD_INDEX_NAME);
    console.log(`[migrate-table-active-unique] dropped old unique index: ${OLD_INDEX_NAME}`);
  } else {
    console.log(`[migrate-table-active-unique] old index ${OLD_INDEX_NAME} not present — nothing to drop`);
  }

  // 3. Report the final index state for confirmation.
  const final = await coll.indexes();
  console.log(
    '[migrate-table-active-unique] tables indexes:',
    final.map((i: any) => `${i.name}${i.unique ? ' (unique)' : ''}${i.partialFilterExpression ? ' (partial)' : ''}`).join(', ')
  );
}

mongoose
  .connect(config.mongoUri)
  .then(async () => {
    try {
      await migrate();
    } finally {
      await mongoose.disconnect();
    }
  })
  .catch((err) => {
    console.error('[migrate-table-active-unique] FAILED:', err);
    process.exitCode = 1;
  });
