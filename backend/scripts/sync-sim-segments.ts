/**
 * sync-sim-segments.ts — run the ML segmentation sync (extract → ingest →
 * gated train → fetch → store) for the sim tenant, outside the HTTP layer.
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

  const { runSegmentSync, storeSegments } = await import('../src/modules/ml-pipeline/segmentSyncService');

  const result = await runSegmentSync(rid);
  console.log('sync:', JSON.stringify(result, null, 1).slice(0, 1200));

  if (result.segments) {
    const stored = await storeSegments(rid, result.segments);
    console.log('stored:', JSON.stringify(stored));
  } else {
    console.log('no segments returned (train gate?)');
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
