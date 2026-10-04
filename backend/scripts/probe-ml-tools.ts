/**
 * Probe: execute getDemandForecast and getMarketBasketSignals exactly the way
 * the marketing agent does (tool registry + tenant ctx) and print that they
 * return REAL predictions for the sim tenant.
 * Run with: cd backend && npx tsx scripts/probe-ml-tools.ts
 */
import mongoose from 'mongoose';
import { ai } from '../src/ai';
import { executeTool } from '../src/ai/tools/registry/toolExecutor';
import {
  getDemandForecastToolDefinition,
  type DemandForecastOutput,
} from '../src/ai/tools/ml/getDemandForecastTool';
import {
  getMarketBasketSignalsToolDefinition,
  type MarketBasketSignalsOutput,
} from '../src/ai/tools/ml/getMarketBasketSignalsTool';

const RID = '6ac031900f636f7cc8ab6f8f';

async function main(): Promise<void> {
  // The tools read MLPrediction through mongoose — connect first, otherwise
  // queries buffer until the 10s tool timeout.
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  ai.bootstrap();
  const ctx = { tenant: { restaurantId: RID } };

  // ── getDemandForecast ──
  const demand = await executeTool(getDemandForecastToolDefinition, { limit: 60 }, ctx);
  if (demand.ok && (demand as { data?: unknown }).data) {
    const d = (demand as { data: DemandForecastOutput }).data;
    if (!d.available) {
      console.log('getDemandForecast: UNAVAILABLE —', d.detail);
    } else {
      const preds = d.predictions ?? [];
      const products = new Set(preds.map((p) => p.productId));
      const sample = preds.slice(0, 3).map(
        (p) => `${p.productId.slice(-6)} @ ${p.predictionFor}: ${p.expected} [${p.lower ?? '-'}..${p.upper ?? '-'}] ${p.confidenceLevel ?? ''}`,
      );
      console.log('getDemandForecast: AVAILABLE');
      console.log(`  rows=${preds.length} products=${products.size} model=${d.modelVersion} evaluation=${d.evaluationStatus} ageDays=${d.freshnessAgeDays}`);
      for (const s of sample) console.log('  sample:', s);
    }
  } else {
    console.log('getDemandForecast: tool error —', JSON.stringify(demand));
  }

  // ── getMarketBasketSignals ──
  const basket = await executeTool(getMarketBasketSignalsToolDefinition, { limit: 10 }, ctx);
  if (basket.ok && (basket as { data?: unknown }).data) {
    const b = (basket as { data: MarketBasketSignalsOutput }).data;
    if (!b.available) {
      console.log('getMarketBasketSignals: UNAVAILABLE —', b.detail);
    } else {
      console.log('getMarketBasketSignals: AVAILABLE');
      console.log(`  signals=${b.signals.length} model=${b.modelVersion ?? '-'} source=${b.predictionSource ?? '-'} mode=${b.recommendationMode ?? '-'} evaluation=${b.evaluationStatus} ageDays=${b.freshnessAgeDays}`);
      for (const s of b.signals.slice(0, 3)) {
        console.log(`  sample: ${JSON.stringify(s)}`);
      }
    }
  } else {
    console.log('getMarketBasketSignals: tool error —', JSON.stringify(basket));
  }

  process.exit(0);
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => {
    void mongoose.disconnect();
  });
