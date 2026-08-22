/**
 * Migration: Backfill `type` field on all products.
 *
 * availability: true  → type: 'menu'
 * availability: false → type: 'inventory'
 *
 * Usage:
 *   npx ts-node scripts/migrate-product-type.ts           # dry-run (default)
 *   npx ts-node scripts/migrate-product-type.ts --apply   # execute
 *
 * Idempotent: skips documents that already have `type` set.
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant-pos';

async function run() {
  const apply = process.argv.includes('--apply');
  console.log(`\n🔧 Product Type Migration — ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;
  const col = db.collection('products');

  // Count documents that need migration (no `type` field yet)
  const needsType = await col.countDocuments({ type: { $exists: false } });
  const alreadyTyped = await col.countDocuments({ type: { $exists: true } });
  const total = await col.countDocuments({});

  console.log(`📊 Total products: ${total}`);
  console.log(`   Already have type: ${alreadyTyped}`);
  console.log(`   Need migration: ${needsType}`);

  if (needsType === 0) {
    console.log('\n✅ All products already have `type` field. Nothing to do.\n');
    await mongoose.disconnect();
    return;
  }

  // Breakdown by availability
  const menuCount = await col.countDocuments({ type: { $exists: false }, availability: true });
  const inventoryCount = await col.countDocuments({ type: { $exists: false }, availability: false });
  const noAvailCount = await col.countDocuments({ type: { $exists: false }, availability: { $exists: false } });

  console.log(`\n   Breakdown (untyped documents):`);
  console.log(`   - availability: true  → type: 'menu'     (${menuCount})`);
  console.log(`   - availability: false → type: 'inventory' (${inventoryCount})`);
  console.log(`   - no availability field → type: 'menu'    (${noAvailCount})`);

  if (!apply) {
    console.log('\nℹ️  Dry run — no changes made. Run with --apply to execute.\n');
    await mongoose.disconnect();
    return;
  }

  // Execute migration
  console.log('\n⏳ Migrating...\n');

  // 1. Menu items (availability: true or missing)
  const r1 = await col.updateMany(
    { type: { $exists: false }, availability: { $ne: false } },
    { $set: { type: 'menu' } },
  );
  console.log(`   ✅ Set type='menu': ${r1.modifiedCount} documents`);

  // 2. Inventory items (availability: false)
  const r2 = await col.updateMany(
    { type: { $exists: false }, availability: false },
    { $set: { type: 'inventory' } },
  );
  console.log(`   ✅ Set type='inventory': ${r2.modifiedCount} documents`);

  // 3. Any remaining (no availability field at all — default to menu)
  const r3 = await col.updateMany(
    { type: { $exists: false } },
    { $set: { type: 'menu' } },
  );
  if (r3.modifiedCount > 0) {
    console.log(`   ✅ Set type='menu' (no availability field): ${r3.modifiedCount} documents`);
  }

  // Verify
  const afterTotal = await col.countDocuments({});
  const afterMenu = await col.countDocuments({ type: 'menu' });
  const afterInventory = await col.countDocuments({ type: 'inventory' });
  const remaining = await col.countDocuments({ type: { $exists: false } });

  console.log(`\n📊 After migration:`);
  console.log(`   Total: ${afterTotal}`);
  console.log(`   type='menu': ${afterMenu}`);
  console.log(`   type='inventory': ${afterInventory}`);
  console.log(`   Still missing type: ${remaining}`);

  if (remaining > 0) {
    console.log('\n⚠️  WARNING: Some documents still lack the type field!');
  } else {
    console.log('\n✅ Migration complete. All products have a type field.\n');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
