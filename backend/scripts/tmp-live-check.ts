import mongoose from 'mongoose';
import Order from '../src/models/Order';
import CustomerRequest from '../src/modules/qr-ordering/models/CustomerRequest';

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos');
  const tid = '6a7d93373e31a75d3917fb61';
  const orders = await Order.find({ tableId: tid }).sort({ createdAt: 1 }).lean().exec() as any[];
  console.log('total orders ever on table 900:', orders.length);
  for (const o of orders) console.log(`  #${o.orderNumber} ${o.status} ${o.type} ${o.createdAt.toISOString()}`);
  const calls = await CustomerRequest.countDocuments({ type: 'ONLINE_ORDER', tableId: new mongoose.Types.ObjectId(tid) });
  console.log('ONLINE_ORDER calls for table 900:', calls);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
