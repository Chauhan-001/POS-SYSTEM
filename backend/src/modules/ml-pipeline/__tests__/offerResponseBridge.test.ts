/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerResponseBridge.test.ts — Step 5 Node-side bridge tests:
 *
 *   - unconfigured → honest error (never a fake score)
 *   - score round-trip with tenant + service-token headers
 *   - honest cold-start payload passes through untouched
 *   - evaluation + retrain round-trips
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';

import {
  fetchOfferResponseScore,
  fetchOfferResponseEvaluation,
  triggerOfferResponseRetrain,
} from '../offerResponseClient';

const REST_A = '507f1f77bcf86cd799439011';

let mockServer: http.Server | null = null;
let mockCalls: Array<{ headers: http.IncomingHttpHeaders; body: any; path: string }> = [];
let mockResponse: { status: number; body: unknown } = { status: 200, body: null };

async function startMockServer(handler?: (req: http.IncomingMessage, body: any, path: string) => { status: number; body: unknown }) {
  mockServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      mockCalls.push({ headers: req.headers, body, path: req.url || '' });
      const out = handler ? handler(req, body, req.url || '') : mockResponse;
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => mockServer!.listen(0, '127.0.0.1', resolve));
  const addr = mockServer.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  if (mockServer) {
    await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    mockServer = null;
  }
  mockCalls = [];
  mockResponse = { status: 200, body: null };
  delete process.env.ML_UPLIT_BASE_URL;
  delete process.env.ML_SERVICE_TOKEN;
});

describe('offerResponseClient (mocked Uplift service)', () => {
  it('rejects honestly when ML_UPLIT_BASE_URL is unset', async () => {
    await expect(fetchOfferResponseScore(REST_A, { visits_30d: 5 })).rejects.toThrow(/ML_UPLIT_BASE_URL/);
    await expect(fetchOfferResponseEvaluation(REST_A)).rejects.toThrow(/ML_UPLIT_BASE_URL/);
    await expect(triggerOfferResponseRetrain(REST_A)).rejects.toThrow(/ML_UPLIT_BASE_URL/);
  });

  it('score round-trip sends tenant + service-token headers and the features envelope', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;
    process.env.ML_SERVICE_TOKEN = 'st_test_456';

    mockResponse = {
      status: 200,
      body: {
        p_response: 0.42,
        is_trained: true,
        model_version: '2026-10-01T00:00:00Z',
        reason: null,
        data: { trained_rows: 260, trained_conversions: 130, response_rate_baseline: 0.5 },
        model: 'offer_response',
        scope: 'response (non-causal) — for causal targeting use /api/customers uplift ranking',
      },
    };

    const result = await fetchOfferResponseScore(REST_A, { visits_30d: 8, average_order_value: 600 });

    expect(result.is_trained).toBe(true);
    expect(result.p_response).toBeCloseTo(0.42, 6);
    expect(result.scope).toMatch(/non-causal/);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].path).toBe('/api/offer-response/score');
    expect(mockCalls[0].headers['x-restaurant-id']).toBe(REST_A);
    expect(mockCalls[0].headers['x-service-token']).toBe('st_test_456');
    expect(mockCalls[0].body.customer.visits_30d).toBe(8);
  });

  it('passes the honest cold-start payload through untouched (no fabrication)', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;

    mockResponse = {
      status: 200,
      body: {
        p_response: null,
        is_trained: false,
        model_version: null,
        reason: 'insufficient_data',
        detail: ['treated rows 30 < 100 minimum', 'conversions 4 < 20 minimum'],
        data: { treated_rows: 30, conversions: 4 },
        model: 'offer_response',
        scope: 'response (non-causal) — for causal targeting use /api/customers uplift ranking',
      },
    };

    const result = await fetchOfferResponseScore(REST_A, {});
    expect(result.is_trained).toBe(false);
    expect(result.p_response).toBeNull();
    expect(result.reason).toBe('insufficient_data');
    expect(result.detail).toHaveLength(2);
  });

  it('surfaces HTTP failures from the ML service with status + body excerpt', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;
    mockResponse = { status: 503, body: { detail: 'model store unavailable' } };

    await expect(fetchOfferResponseScore(REST_A, {})).rejects.toThrow(/HTTP 503/);
  });

  it('evaluate round-trip clamps the holdout fraction into the 0.1..0.5 band', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;
    mockResponse = {
      status: 200,
      body: {
        evaluable: true,
        reasons: [],
        auc: 0.87,
        log_loss: 0.31,
        temporal_split: true,
        train_rows: 180,
        holdout_rows: 80,
        holdout_conversions: 39,
        model: 'offer_response',
      },
    };

    const result = await fetchOfferResponseEvaluation(REST_A, 0.9);
    expect(result.evaluable).toBe(true);
    expect(result.auc).toBeCloseTo(0.87, 6);
    expect(mockCalls[0].body.holdout_fraction).toBe(0.5); // clamped
  });

  it('evaluate passes through honest non-evaluable results', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;
    mockResponse = {
      status: 200,
      body: {
        evaluable: false,
        reasons: ['treated rows 40 < 120 for a holdout split'],
        auc: null,
        log_loss: null,
      },
    };

    const result = await fetchOfferResponseEvaluation(REST_A);
    expect(result.evaluable).toBe(false);
    expect(result.auc).toBeNull();
    expect(result.reasons[0]).toMatch(/holdout split/);
  });

  it('retrain round-trip reports ready=False + gate reasons without faking readiness', async () => {
    const baseUrl = await startMockServer();
    process.env.ML_UPLIT_BASE_URL = baseUrl;
    mockResponse = {
      status: 200,
      body: {
        success: true,
        restaurant_id: REST_A,
        ready: false,
        reasons: ['treated rows 0 < 100 minimum'],
        data: { treated_rows: 0, conversions: 0 },
      },
    };

    const result = await triggerOfferResponseRetrain(REST_A);
    expect(result.success).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.reasons![0]).toMatch(/< 100 minimum/);
    expect(mockCalls[0].path).toBe('/api/offer-response/retrain');
    expect(mockCalls[0].headers['x-restaurant-id']).toBe(REST_A);
  });
});
