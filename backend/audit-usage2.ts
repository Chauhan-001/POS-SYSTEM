import mongoose from 'mongoose';
import AIUsageLog from './src/models/core/AIUsageLog';
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pos');
  const rows = await AIUsageLog.find({}).sort({ createdAt: -1 }).limit(2).lean();
  console.log('COUNT=' + (await AIUsageLog.countDocuments({})));
  console.log('T0=' + ((rows[0]?.createdAt as Date)?.toISOString() ?? 'none'));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
