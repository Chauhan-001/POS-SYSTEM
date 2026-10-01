/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlTools.test.ts — Phase 4 acceptance tests (spec §19/§30): every ML tool
 * reports honest model status, never fabricates predictions, respects
 * evaluation gates, and stays tenant-isolated.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../../index';
import { toolRegistry } from '../../registry/toolRegistry';
import { executeTool } from '../../registry/toolExecutor';
import { getDemandForecastToolDefinition } from '../getDemandForecastTool';
import { getMarketBasketSignalsToolDefinition } from '../getMarketBasketSignalsTool';
import { getMLCustomerSegmentsToolDefinition } from '../getMLCustomerSegmentsTool';
import { getUpliftSignalsToolDefinition } from '../getUpliftSignalsTool';

import MLPrediction from '../../../../models/intelligence/MLPrediction';
import MLPredictionOutcome from '../../../../models/intelligence/MLPredictionOutcome';
import OfferExperimentEvent from '../../../../models/intelligence/OfferExperimentEvent';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    MLPrediction.deleteMany({}).exec(),
    MLPredictionOutcome.deleteMany({}).exec(),
    OfferExperimentEvent.deleteMany({}).exec(),
  ]);
});

async function makeDemandPrediction(restaurantId: string, overrides: Record<string, unknown> = {}) {
  return MLPrediction.create({
    restaurantId,
    modelName: 'demand',
    modelVersion: 'v9-test',
    predictionType: 'product_demand',
    entityId: 'prod-1',
    predictionFor: '2026-10-03',
    generatedAt: new Date(),
    prediction: { expected: 42, lower: 35, upper: 50, dataMode: 'trained' },
    confidence: { level: 'HIGH_CONFIDENCE', score: 0.9, dataMode: 'trained' },
    source: 'demand_model',
  } as any);
}

async function makeOutcome(restaurantId: string, modelName: string) {
  return MLPredictionOutcome.create({
    restaurantId,
    modelName,
    modelVersion: 'v9-test',
    productId: '-',
    predictionFor: '2026-10-01',
    predictionType: 'product_demand',
    predictedValue: 40,
    actualValue: 38,
    absoluteError: 2,
    evaluatedAt: new Date(),
  } as any);
}

// ─── Registration ───────────────────────────────────────────────────

describe('ML tool registration', () => {
  it('registers all four ML tools under category ml', () => {
    for (const name of ['getDemandForecast', 'getMarketBasketSignals', 'getMLCustomerSegments', 'getUpliftSignals']) {
      expect(toolRegistry.get(name)?.category).toBe('ml');
    }
  });
});

// ─── getDemandForecast ──────────────────────────────────────────────

describe('getDemandForecast', () => {
  it('returns stored predictions with model metadata', async () => {
    await makeDemandPrediction(R1);
    await makeOutcome(R1, 'demand');

    const result = await executeTool(getDemandForecastToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    const data = result.data as Extract<typeof result.data, { available: true }>;
    expect(data.modelId).toBe('demand');
    expect(data.modelVersion).toBe('v9-test');
    expect(data.evaluationStatus).toBe('evaluated');
    expect(data.predictions).toHaveLength(1);
    expect(data.predictions![0]).toMatchObject({ productId: 'prod-1', expected: 42, lower: 35, upper: 50 });
    expect(typeof data.freshnessAgeDays).toBe('number');
  });

  it('reports not_evaluated when outcomes were never recorded', async () => {
    await makeDemandPrediction(R1);
    const result = await executeTool(getDemandForecastToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect((result.data as any).evaluationStatus).toBe('not_evaluated');
  });

  it('is honestly unavailable when no predictions exist (nothing fabricated)', async () => {
    const result = await executeTool(getDemandForecastToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      available: false,
      modelId: 'demand',
      evaluationStatus: 'not_evaluated',
    });
    expect((result.data as any).predictions).toBeUndefined();
  });

  it('is tenant isolated', async () => {
    await makeDemandPrediction(R1);
    const result = await executeTool(getDemandForecastToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(false);
  });

  it('rejects invalid input', async () => {
    const result = await executeTool(getDemandForecastToolDefinition, { limit: 0 }, { tenant: tenantR1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_INPUT_INVALID');
  });
});

// ─── getMarketBasketSignals ─────────────────────────────────────────

describe('getMarketBasketSignals', () => {
  it('serves stored combo predictions when present', async () => {
    await MLPrediction.create({
      restaurantId: R1,
      modelName: 'combo',
      modelVersion: 'basket-v2',
      predictionType: 'combo_ranking',
      entityId: 'a|b',
      predictionFor: '-',
      generatedAt: new Date(),
      prediction: { productAId: 'a', productBId: 'b', expectedPurchases7d: 12, estimatedFutureProfit: 300 },
      source: 'combo_model',
    } as any);

    const result = await executeTool(getMarketBasketSignalsToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    const data = result.data as Extract<typeof result.data, { available: true }>;
    expect(data.predictionSource).toBe('stored_predictions');
    expect(data.modelVersion).toBe('basket-v2');
    expect(data.signals[0]).toMatchObject({ productAId: 'a', productBId: 'b', source: 'ml_prediction' });
  });

  it('is unavailable when neither store nor live service has data', async () => {
    const result = await executeTool(getMarketBasketSignalsToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(false);
    expect(typeof (result.data as any).detail).toBe('string');
  });
});

// ─── getMLCustomerSegments ──────────────────────────────────────────

describe('getMLCustomerSegments', () => {
  it('aggregates stored segment predictions without PII and splits trained/untrained', async () => {
    for (const [customer, seg, trained] of [
      ['c1', 'Champions', true],
      ['c2', 'Champions', true],
      ['c3', 'At Risk', false],
    ] as const) {
      await MLPrediction.create({
        restaurantId: R1,
        modelName: 'segment',
        modelVersion: 'seg-v1',
        predictionType: 'customer_segment',
        entityId: customer,
        predictionFor: '-',
        generatedAt: new Date(),
        prediction: {
          segment: seg,
          method: trained ? 'kmeans' : 'rule',
          isTrained: trained,
          recencyDays: 10,
          frequency: 4,
          monetary: 900,
        },
        source: 'segment_model',
      } as any);
    }

    const result = await executeTool(getMLCustomerSegmentsToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    const data = result.data as Extract<typeof result.data, { available: true }>;
    expect(data.totalCustomersScored).toBe(3);
    expect(data.trainedCustomers).toBe(2);
    expect(data.untrainedCustomers).toBe(1);
    const champions = data.segments.find((s) => s.segment === 'Champions');
    expect(champions).toMatchObject({ customerCount: 2, trainedCount: 2, untrainedCount: 0 });
    // Aggregate-only: no customer entity ids may leak.
    expect(JSON.stringify(data)).not.toContain('c1');
  });

  it('is unavailable when no segmentation predictions exist', async () => {
    const result = await executeTool(getMLCustomerSegmentsToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, modelId: 'segment' });
  });
});

// ─── getUpliftSignals ───────────────────────────────────────────────

describe('getUpliftSignals', () => {
  it('is not_evaluable when the experiment gate fails, with reasons', async () => {
    // A handful of assignments — far below any minimum experiment size.
    await OfferExperimentEvent.create({
      restaurantId: R1,
      customerId: 'cust-1',
      eventType: 'assigned',
      treatment: 1,
      purchase: 0,
    } as any);

    // The gate must run BEFORE any network call, so point the client env at a
    // never-called address (clients read env at call time; restored below).
    const prevUrl = process.env.ML_UPLIT_BASE_URL;
    process.env.ML_UPLIT_BASE_URL = 'http://127.0.0.1:1';
    try {
      const result = await executeTool(
        getUpliftSignalsToolDefinition,
        { minimumExperimentSize: 100 },
        { tenant: tenantR1 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.available).toBe(false);
      expect((result.data as any).evaluationStatus).toBe('not_evaluable');
      expect(Array.isArray((result.data as any).gateReasons)).toBe(true);
      expect((result.data as any).customers).toBeUndefined();
    } finally {
      if (prevUrl === undefined) delete process.env.ML_UPLIT_BASE_URL;
      else process.env.ML_UPLIT_BASE_URL = prevUrl;
    }
  });

  it('is unavailable when the uplift service is not configured', async () => {
    const result = await executeTool(getUpliftSignalsToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(false);
    expect((result.data as any).detail).toMatch(/not configured/i);
  });

  it('rejects out-of-range limits', async () => {
    const result = await executeTool(getUpliftSignalsToolDefinition, { limit: 500 }, { tenant: tenantR1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_INPUT_INVALID');
  });
});
