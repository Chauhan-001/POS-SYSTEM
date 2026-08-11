/**
 * fix-order-tenant-stamp.mjs — REPAIR the missing tenant stamp on seeded orders.
 *
 * The mega seeder created ~1,339 orders + ~416 takeaway orders with a branchId
 * but WITHOUT restaurantId. Because GET /api/orders was (until the companion
 * backend fix) unscoped, those rows leaked into every tenant's POS as phantom
 * "Active" orders. This script stamps restaurantId on every order/takeaway
 * order whose branchId belongs to a Mega Feast branch and whose restaurantId
 * is missing — idempotent, safe to re-run.
 *
 * Run from backend/:  node scripts/fix-order-tenant-stamp.mjs
 */
import mongoose from 'mongoose';

const NAME_PREFIX = 'Mega Feast House';

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos', { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const rests = await db.collection('restaurants').find({ name: { $regex: `^${NAME_PREFIX}` } }).toArray();
  if (rests.length === 0) { console.log('No Mega Feast restaurant found — nothing to do.'); await mongoose.disconnect(); return; }

  let totalOrders = 0, totalTakeaway = 0;
  for (const rest of rests) {
    const restOid = rest._id;
    const branches = await db.collection('branches').find({ restaurantId: restOid }, { projection: { _id: 1 } }).toArray();
    const branchIds = branches.map((b) => b._id);
    if (branchIds.length === 0) continue;

    const missing = { $or: [{ restaurantId: null }, { restaurantId: { $exists: false } }] };

    const o = await db.collection('orders').updateMany(
      { ...missing, branchId: { $in: branchIds } },
      { $set: { restaurantId: restOid } },
    );
    const t = await db.collection('takeawayorders').updateMany(
      { ...missing, branchId: { $in: branchIds } },
      { $set: { restaurantId: restOid } },
    );
    console.log(`[${rest.name}] orders stamped: ${o.modifiedCount}, takeaway stamped: ${t.modifiedCount}`);
    totalOrders += o.modifiedCount; totalTakeaway += t.modifiedCount;
  }

  // Safety sweep: any order left with a null/missing restaurantId is a true
  // orphan (no branch anywhere claims it) — report only, don't delete.
  const stillOrphan = await db.collection('orders').countDocuments({ $or: [{ restaurantId: null }, { restaurantId: { $exists: false } }] });
  const stillOrphanTk = await db.collection('takeawayorders').countDocuments({ $or: [{ restaurantId: null }, { restaurantId: { $exists: false } }] });
  console.log(`\nDone — total stamped: ${totalOrders} orders, ${totalTakeaway} takeaway.`);
  console.log(`Remaining unstamped rows (true orphans, no branch link): ${stillOrphan} orders, ${stillOrphanTk} takeaway.`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
