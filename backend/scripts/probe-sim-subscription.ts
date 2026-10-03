/**
 * probe-sim-subscription.ts — print the full premium plan feature list.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;

  const plan = await db.collection('subscriptionplans').findOne({ name: 'premium' });
  const features: string[] = plan?.features ?? [];
  console.log('premium plan feature count:', features.length);
  for (const f of features) console.log(' -', f);

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
