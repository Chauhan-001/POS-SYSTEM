/**
 * reset-all-seed-data.cjs
 *
 * Removes ALL seeded / demo / test data from the POS database so the platform
 * returns to a clean, first-run state:
 *
 *   - Every collection except the platform essentials below is emptied.
 *   - Demo restaurants (Mega Feast House, MOGA, Intelligence Lab, isolation /
 *     audit test tenants…) and every record they own are deleted.
 *   - Demo users (owner accounts) are deleted; the platform super_admin stays.
 *   - The super_admin login is (re)set to  userId: 'admin'  /  password: '1008'
 *     — this credential works ONLY on the admin portal (POST /api/auth/admin/login).
 *
 * Preserved:
 *   users, restaurants (only the ADMIN platform tenant), subscriptionplans,
 *   legaldocuments, financesettings, settings, auditchainmetas, and the ADMIN
 *   tenant's subscription row.
 *
 * Usage (from backend/):
 *   node scripts/reset-all-seed-data.cjs            # dry-run — prints the plan
 *   node scripts/reset-all-seed-data.cjs --confirm  # actually wipes the demo data
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const ADMIN_RESTAURANT_ID = 'ADMIN';

/** Collections that are platform-level and must never be wiped. */
const KEEP_COLLECTIONS = new Set([
  'users',
  'restaurants',
  'subscriptionplans',
  'legaldocuments',
  'financesettings',
  'settings',
  'auditchainmetas',
]);

async function run() {
  const isConfirmed = process.argv.includes('--confirm');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  const allNames = cols.map((c) => c.name);
  const toEmpty = allNames.filter((n) => !KEEP_COLLECTIONS.has(n));

  console.log('🔍 Connected to:', MONGO_URI);
  console.log('🗑️  Will EMPTY (deleteMany, indexes preserved):');
  console.log('   ' + (toEmpty.join(', ') || '(none)'));
  console.log('🛡️  Preserved collections:', [...KEEP_COLLECTIONS].join(', '));
  console.log('🧹 users      → keep only super_admin');
  console.log('🧹 restaurants → keep only "' + ADMIN_RESTAURANT_ID + '" platform tenant');
  console.log('🔑 admin portal → userId "admin" / password "1008"');

  if (!isConfirmed) {
    console.log('\n⚠️  DRY-RUN — pass --confirm to actually wipe the demo data.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── 1. Empty every non-platform collection ─────────────────────────
  let emptied = 0;
  for (const name of toEmpty) {
    try {
      const r = await db.collection(name).deleteMany({});
      console.log(`   ✅ ${name}: removed ${r.deletedCount}`);
      emptied += r.deletedCount;
    } catch (err) {
      console.error(`   ❌ ${name}:`, err.message);
    }
  }

  // ── 2. Keep only the platform admin tenant + super_admin ────────────
  const users = await db.collection('users').deleteMany({ role: { $ne: 'super_admin' } });
  console.log(`   🧹 users: removed ${users.deletedCount} non-admin accounts`);

  const adminRest = await db.collection('restaurants').findOne({ restaurantId: ADMIN_RESTAURANT_ID });
  const adminRestId = adminRest ? adminRest._id : null;
  const restFilter = adminRestId
    ? { _id: { $ne: adminRestId } }
    : {};
  const rests = await db.collection('restaurants').deleteMany(restFilter);
  console.log(`   🧹 restaurants: removed ${rests.deletedCount} demo tenants`);

  // Keep the ADMIN tenant's subscription row (if any), drop the rest.
  if (adminRestId) {
    const subs = await db.collection('subscriptions').deleteMany({ restaurantId: { $ne: adminRestId } });
    console.log(`   🧹 subscriptions: removed ${subs.deletedCount} demo rows`);
  } else {
    const subs = await db.collection('subscriptions').deleteMany({});
    console.log(`   🧹 subscriptions: removed ${subs.deletedCount} (no ADMIN tenant found)`);
  }

  // ── 3. Set the admin portal credential: admin / 1008 ────────────────
  const password = await bcrypt.hash('1008', 10);
  const upd = await db.collection('users').updateOne(
    { role: 'super_admin' },
    { $set: { userId: 'admin', password, email: 'admin@pos.com' }, $unset: { failedLoginAttempts: '' } }
  );
  console.log(`   🔑 admin portal login: ${upd.matchedCount > 0 ? 'admin / 1008 set' : 'NO super_admin user found!'}`);

  // ── 4. Sanity — show what remains ───────────────────────────────────
  const remaining = [];
  for (const c of cols) {
    const n = await db.collection(c.name).countDocuments();
    if (n > 0) remaining.push(`${c.name}=${n}`);
  }
  console.log('\n📊 Remaining non-empty collections:');
  console.log('   ' + (remaining.join(', ') || '(all empty)'));

  await mongoose.disconnect();
  console.log('\n✅ Done — database reset to a clean first-run state.');
}

run().catch((err) => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});
