/**
 * Probe: billitems linkage fields (bill vs order) and orderitems tenant usage.
 * Run with: cd backend && npx tsx scripts/probe-bill-fields.ts
 */
import mongoose from 'mongoose';

const RID = '6ac031900f636f7cc8ab6f8f';
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pos';

async function main(): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  const rid = new mongoose.Types.ObjectId(RID);

  const bi = db.collection('billitems');
  const sample = await bi.findOne({});
  console.log('billitems sample keys:', sample ? Object.keys(sample).join(',') : 'none');

  const byBill = await bi.countDocuments({ restaurantId: rid });
  const byOrder = await bi.countDocuments({ restaurantId: rid, orderId: { $exists: true, $ne: null } });
  console.log(`billitems restaurantId=${rid}: ${byBill}, with orderId: ${byOrder}`);

  const oi = db.collection('orderitems');
  const oiTenant = await oi.countDocuments({ restaurantId: rid });
  console.log(`orderitems tenant docs: ${oiTenant}`);
  const oiSample = await oi.findOne({ restaurantId: rid });
  console.log('orderitems sample keys:', oiSample ? Object.keys(oiSample).join(',') : 'none');

  // orderitems without restaurantId field at all?
  const oiNoRid = await oi.countDocuments({ restaurantId: { $exists: false } });
  console.log(`orderitems missing restaurantId field: ${oiNoRid} of ${(await oi.estimatedDocumentCount())}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
