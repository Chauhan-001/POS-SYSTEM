/**
 * sync-sim-demand-basket.ts — run the demand-forecast sync and the basket
 * (combo) sync for the sim tenant, including basket training, mirroring the
 * segment-sync script.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const Restaurant = (await import('../src/models/core/Restaurant')).default;
  const rest = await Restaurant.findOne({ restaurantId: 'SIM_RESTAURANT_6M_001' }).lean();
  if (!rest) throw new Error('sim tenant not found');
  const rid = String(rest._id);

  // ── Demand sync ──
  const { runDemandSync } = await import('../src/modules/ml-pipeline/demandSyncService');
  try {
    const demand = await runDemandSync(rid, {}, { serviceTokenMode: true });
    console.log('DEMAND extraction:', JSON.stringify(demand.extraction).slice(0, 300));
    console.log('DEMAND sync:', JSON.stringify(demand.sync).slice(0, 400));
  } catch (err: any) {
    console.log('DEMAND failed:', err.message.slice(0, 300));
  }

  // ── Basket sync ──
  const { runBasketSync, triggerBasketTrainingSafe, fetchBasketCombos } = await import('../src/modules/ml-pipeline/basketSyncService');
  try {
    const basket = await runBasketSync(rid, {}, { serviceTokenMode: true });
    console.log('BASKET extraction:', JSON.stringify(basket.extraction).slice(0, 300));
    console.log('BASKET sync:', JSON.stringify(basket.sync).slice(0, 400));
  } catch (err: any) {
    console.log('BASKET sync failed:', err.message.slice(0, 300));
  }

  try {
    const train = await triggerBasketTrainingSafe(rid);
    console.log('BASKET train:', JSON.stringify(train).slice(0, 300));
  } catch (err: any) {
    console.log('BASKET train failed:', err.message.slice(0, 300));
  }

  try {
    const combos = await fetchBasketCombos(rid, 10);
    console.log('BASKET combos fetched:', JSON.stringify(combos).slice(0, 400));
  } catch (err: any) {
    console.log('BASKET combos fetch failed:', err.message.slice(0, 300));
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
