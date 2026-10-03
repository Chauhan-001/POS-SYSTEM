/**
 * probe-competition.ts — run external-context + ML tools against the sim tenant
 * with a PRODUCTION-SHAPED tenant context (ObjectId restaurantId, as the JWT
 * carries) and print raw outputs including honest-unavailability reasons.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const { ai } = await import('../src/ai/index');
  ai.bootstrap();
  const { toolRegistry } = await import('../src/ai/tools/registry/toolRegistry');
  const { executeTool } = await import('../src/ai/tools/registry/toolExecutor');

  const Restaurant = (await import('../src/models/core/Restaurant')).default;
  const rest = await Restaurant.findOne({ restaurantId: 'SIM_RESTAURANT_6M_001' }).lean();
  if (!rest) throw new Error('sim tenant not found');
  const ctx = {
    tenant: { restaurantId: String(rest._id), actorId: 'probe', actorName: 'API Probe' },
  } as never;

  const probes: Array<[string, Record<string, unknown>]> = [
    ['getNearbyCompetition', {}],
    ['getSportsContext', {}],
    ['getWeatherContext', {}],
    ['getFestivalContext', {}],
    ['getMLCustomerSegments', {}],
    ['getDemandForecast', {}],
    ['getMarketBasketSignals', {}],
    ['getUpliftSignals', {}],
    [
      'getOfferResponsePrediction',
      { features: { visitCountDays90: 4, avgBasketValue: 520, lastVisitDaysAgo: 12, preferredMeal: 'dinner' } },
    ],
  ];

  for (const [name, input] of probes) {
    const def = toolRegistry.get(name);
    if (!def) {
      console.log(`=== ${name}: NOT REGISTERED`);
      continue;
    }
    const t0 = Date.now();
    const res = await executeTool(def, input, ctx);
    const ms = Date.now() - t0;
    console.log(`\n=== ${name} (${ms}ms) ok=${(res as { ok?: boolean }).ok}`);
    console.log(JSON.stringify((res as { data?: unknown; error?: unknown }).data ?? (res as { error?: unknown }).error, null, 1).slice(0, 1400));
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
