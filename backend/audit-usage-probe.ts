import mongoose from 'mongoose';
import AIUsageLog from './src/models/core/AIUsageLog';
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pos');
  const newest = await AIUsageLog.find({}).sort({ createdAt: -1 }).limit(4).lean();
  console.log('now UTC:', new Date().toISOString());
  console.log('AIUsageLog total:', await AIUsageLog.countDocuments({}));
  for (const u of newest) {
    console.log(' -', (u.createdAt as Date).toISOString(), '| feature', u.feature, '| provider', JSON.stringify(u.provider), '| model', JSON.stringify(u.model), '| total', u.totalTokens, '| prompt', u.promptTokens, '| completion', u.completionTokens, '| cost', u.costUsd, '| latency', u.latencyMs, '| status', JSON.stringify(u.status), '| err', JSON.stringify(u.error));
  }
  const feats = await AIUsageLog.aggregate([{ $group: { _id: '$feature', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('by feature:', JSON.stringify(feats));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
