/**
 * clear-db-except-users.ts
 *
 * Drops all MongoDB collections EXCEPT "users" in the POS database.
 * This preserves user accounts (login credentials, role assignments) while
 * clearing everything else (products, orders, customers, branches, etc.).
 *
 * Usage:
 *   npx tsx scripts/clear-db-except-users.ts
 *
 * Safety:
 *   - Requires --confirm flag to actually run (dry-run by default)
 *   - Prints all collections that would be dropped before executing
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';

/** Collections that will be PRESERVED (not dropped) */
const PRESERVED_COLLECTIONS = new Set(['users']);

async function run() {
  const isConfirmed = process.argv.includes('--confirm');

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  const cols = await db.listCollections().toArray();
  const allNames = cols.map(c => c.name);
  const toDrop = allNames.filter(name => !PRESERVED_COLLECTIONS.has(name));

  console.log('🔍 Connected to:', MONGO_URI);
  console.log('📋 All collections:', allNames.join(', ') || '(none)');
  console.log('🛡️  Preserved:', [...PRESERVED_COLLECTIONS].join(', '));
  console.log('🗑️  Will drop:', toDrop.join(', ') || '(none — nothing to clean)');

  if (toDrop.length === 0) {
    console.log('✅ Nothing to drop. Database is already clean (except preserved collections).');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!isConfirmed) {
    console.log('\n⚠️  DRY-RUN — Pass --confirm to actually drop these collections.');
    console.log('   npx tsx scripts/clear-db-except-users.ts --confirm');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ─── Drop each target collection ───────────────────────────────────────
  let dropped = 0;
  let errors = 0;

  for (const name of toDrop) {
    try {
      await db.collection(name).drop();
      console.log(`   ✅ Dropped: ${name}`);
      dropped++;
    } catch (err: any) {
      if (err.codeName === 'NamespaceNotFound') {
        console.log(`   ⏭️  Already gone: ${name}`);
      } else {
        console.error(`   ❌ Error dropping ${name}:`, err.message);
        errors++;
      }
    }
  }

  console.log(`\n📊 Summary: ${dropped} dropped, ${errors} errors`);
  await mongoose.disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
