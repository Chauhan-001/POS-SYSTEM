/**
 * One-off: grab the sim tenant's top product IDs (billitems joined through
 * sim-tenant bills), then call the backend demand + basket prediction pull
 * routes with a fresh JWT.
 * Run with: cd backend && npx tsx scripts/pull-sim-predictions.ts
 */
import mongoose from 'mongoose';

const RID = '6ac031900f636f7cc8ab6f8f';
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';

async function main(): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  const rid = new mongoose.Types.ObjectId(RID);

  // billitems carry no restaurantId — join through the tenant's bills
  const bills = await db
    .collection('bills')
    .find({ restaurantId: rid }, { projection: { _id: 1 } })
    .limit(5000)
    .toArray();
  const billIds = bills.map(b => b._id);
  console.log(`sim bills sampled: ${billIds.length}`);

  const agg = await db
    .collection('billitems')
    .aggregate([
      { $match: { billId: { $in: billIds } } },
      { $match: { menuItemId: { $ne: null } } },
      { $group: { _id: '$menuItemId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ])
    .toArray();

  const productIds = agg.map(a => String(a._id)).filter(Boolean);
  console.log(`top products (${productIds.length}):`, productIds.slice(0, 5).join(', '), '...');
  if (productIds.length === 0) throw new Error('no products found for tenant');

  // Fresh tenant JWT
  const loginRes = await fetch('http://127.0.0.1:3002/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sim_urban_tadka', password: '246810' }),
  });
  const login = (await loginRes.json()) as { accessToken?: string };
  const token = login.accessToken;
  if (!token) throw new Error('no accessToken from login');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const demandRes = await fetch('http://127.0.0.1:3002/api/ml-pipeline/demand/predictions/pull', {
    method: 'POST',
    headers,
    body: JSON.stringify({ productIds }),
  });
  console.log('demand pull:', await demandRes.json());

  const basketRes = await fetch('http://127.0.0.1:3002/api/ml-pipeline/basket/predictions/pull', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  console.log('basket pull:', await basketRes.json());

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
