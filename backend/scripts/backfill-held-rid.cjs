/**
 * One-off backfill: stamp restaurantId onto held orders (and any takeaway
 * orders) that lack it, resolved via their branch's restaurant.
 */
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('pos');

  const branches = await db.collection('branches').find({}).toArray();
  const branchToRest = new Map(branches.map((b) => [String(b._id), b.restaurantId ? String(b.restaurantId) : null]));
  const branchToName = new Map(branches.map((b) => [String(b._id), b.name || '?']));

  for (const coll of ['heldorders', 'takeawayorders']) {
    const col = db.collection(coll);
    const missing = await col
      .find({ $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] })
      .limit(5000)
      .toArray();
    let fixed = 0;
    let skipped = 0;
    for (const doc of missing) {
      const branchId = doc.branchId ? String(doc.branchId) : null;
      const rid = branchToRest.get(branchId);
      if (!rid) {
        console.log(`  SKIP ${coll} ${String(doc._id)} branch=${branchId} (${branchToName.get(branchId) || 'unknown'}) -> no restaurant`);
        skipped++;
        continue;
      }
      await col.updateOne({ _id: doc._id }, { $set: { restaurantId: rid } });
      fixed++;
    }
    console.log(`${coll}: ${missing.length} missing, fixed ${fixed}, skipped ${skipped}`);
  }

  await client.close();
})();
