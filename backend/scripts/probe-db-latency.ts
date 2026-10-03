/**
 * probe-db-latency.ts — volume + timing for the two slowest endpoints' data.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  const rid = new mongoose.Types.ObjectId('6ac031900f636f7cc8ab6f8f');

  const t0 = Date.now();
  const billCount = await db.collection('bills').countDocuments({ restaurantId: rid });
  console.log('sim bills:', billCount, 'in', Date.now() - t0, 'ms');

  let crCount = -1;
  try {
    const t1 = Date.now();
    crCount = await db.collection('customerrequests').countDocuments({ restaurantId: rid });
    console.log('sim customerrequests:', crCount, 'in', Date.now() - t1, 'ms');
    const t2 = Date.now();
    const recent = await db.collection('customerrequests')
      .find({ restaurantId: rid })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    console.log('recent 200 requests:', Date.now() - t2, 'ms, got', recent.length);
  } catch (e: any) {
    console.log('customerrequests error:', e.message.slice(0, 120));
  }

  const t3 = Date.now();
  const recentBills = await db.collection('bills')
    .find({ restaurantId: rid })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  console.log('recent 500 bills:', Date.now() - t3, 'ms, got', recentBills.length);

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
