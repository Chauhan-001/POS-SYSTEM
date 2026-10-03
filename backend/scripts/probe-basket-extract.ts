/**
 * probe-basket-extract.ts — time each step of the basket extraction.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const Restaurant = (await import('../src/models/core/Restaurant')).default;
  const rest = await Restaurant.findOne({ restaurantId: 'SIM_RESTAURANT_6M_001' }).lean();
  const rid = String(rest!._id);
  const ridObj = new mongoose.Types.ObjectId(rid);

  const Bill = (await import('../src/models/intelligence/Bill')).default;
  const BillItem = (await import('../src/models/intelligence/BillItem')).default;

  let t = Date.now();
  const bills = await Bill.find({ restaurantId: ridObj, isVoided: false })
    .sort({ date: 1, createdAt: 1 })
    .limit(3000)
    .lean();
  console.log('bills fetch (3000):', Date.now() - t, 'ms, got', bills.length);

  const billIds = bills.map((b: any) => b._id);
  t = Date.now();
  const items = await BillItem.find({ billId: { $in: billIds } }).lean();
  console.log('items fetch:', Date.now() - t, 'ms, got', items.length);

  const idx = await BillItem.collection.indexExists(['billId_1']);
  const allIdx = await BillItem.collection.indexInformation();
  console.log('billitem indexes:', JSON.stringify(Object.keys(allIdx)));

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
