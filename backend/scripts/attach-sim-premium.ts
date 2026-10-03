/**
 * attach-sim-premium.ts — give the sim tenant an ACTIVE subscription on the
 * premium plan. Without a subscription record, requireFeature allows requests
 * server-side but the FRONTEND plan gate (subscriptionFeatures) stays empty,
 * so every plan-gated module tile in More Options is hidden.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;

  const rid = '6ac031900f636f7cc8ab6f8f';
  const plan = await db.collection('subscriptionplans').findOne({ name: 'premium' });
  if (!plan) throw new Error('premium plan not found');

  const features: string[] = plan.features ?? [];
  const now = new Date();
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const result = await db.collection('subscriptions').updateOne(
    { restaurantId: rid },
    {
      $set: {
        plan: 'premium',
        planId: plan._id,
        billingPeriod: 'yearly',
        status: 'active',
        subscriptionStart: now,
        startDate: now,
        expiryDate: farFuture,
        endDate: null,
        renewalDate: farFuture,
        features,
        grantedFeatures: features,
      },
    },
    { upsert: true },
  );

  console.log('subscription updated:', JSON.stringify(result.upsertedId ?? rid), 'matched:', result.matchedCount, 'modified:', result.modifiedCount);
  console.log('features granted:', features.length, '→', features.slice(0, 10).join(', '), '…');

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
