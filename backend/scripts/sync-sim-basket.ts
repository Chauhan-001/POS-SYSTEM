/**
 * sync-sim-basket.ts — basket (combo) sync + training for the sim tenant,
 * bounded to the most recent N bills so the run finishes quickly.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const LIMIT = Number(process.argv[2]) || 3000;

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const Restaurant = (await import('../src/models/core/Restaurant')).default;
  const rest = await Restaurant.findOne({ restaurantId: 'SIM_RESTAURANT_6M_001' }).lean();
  if (!rest) throw new Error('sim tenant not found');
  const rid = String(rest._id);

  const { runBasketSync, triggerBasketTrainingSafe, fetchBasketCombos } = await import('../src/modules/ml-pipeline/basketSyncService');

  console.log(`running basket sync (limitBills=${LIMIT})…`);
  const t0 = Date.now();
  const basket = await runBasketSync(rid, { limitBills: LIMIT }, { serviceTokenMode: true });
  console.log(`BASKET extraction (${Date.now() - t0}ms):`, JSON.stringify(basket.extraction).slice(0, 220));
  console.log(`BASKET sync (${Date.now() - t0}ms):`, JSON.stringify(basket.sync).slice(0, 350));

  const t1 = Date.now();
  const train = await triggerBasketTrainingSafe(rid);
  console.log(`BASKET train (${Date.now() - t1}ms):`, JSON.stringify(train).slice(0, 350));

  const t2 = Date.now();
  const combos = await fetchBasketCombos(rid, 10);
  console.log(`BASKET combos (${Date.now() - t2}ms):`, JSON.stringify(combos).slice(0, 600));

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
