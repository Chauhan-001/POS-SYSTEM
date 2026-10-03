/**
 * probe-sim-context.ts — quick probe of sim tenant context/config facts (read-only).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;

  const r = await db.collection('restaurants').findOne(
    { restaurantId: 'SIM_RESTAURANT_6M_001' },
    { projection: { name: 1, latitude: 1, longitude: 1, cuisineType: 1, timezone: 1 } },
  );
  console.log('sim restaurant:', JSON.stringify(r, null, 1));

  const caches = await db.collection('caches').find({}).toArray().catch(() => []);
  const cacheNames = (caches as { _id?: unknown }[]).map((c) => String(c._id));
  console.log('cache collection docs:', cacheNames.slice(0, 10));

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
