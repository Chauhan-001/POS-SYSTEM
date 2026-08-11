/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SttProviderManager + SttUsageService tests — verify the production STT
 * provider chain orchestration:
 *   - first provider with a non-empty transcript wins; later providers skipped
 *   - empty transcript is treated as failure so the chain advances
 *   - a tripped circuit breaker (OPEN) makes the entry skipped, not failed
 *   - per-provider estimated cost is derived from duration and rate
 *   - total-chain failure returns the attempt trace with per-provider status
 *   - SttUsageService persists a usage record and aggregates a summary
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { SttProviderManager, createBreaker, STT_COST_PER_MINUTE, type SttProviderEntry } from '../services/SttProviderManager';
import { recordSttUsage, getSttUsageSummary } from '../services/SttUsageService';
import SttUsage from '../models/SttUsage';
import type { ISTTProvider, STTResult } from '../types';

let mongod: MongoMemoryServer;

const REST = new mongoose.Types.ObjectId().toString();

function okResult(transcript: string, durationMs = 500): STTResult {
  return { transcript, confidence: 0.9, isFinal: true, durationMs, language: 'hi-en' };
}

function provider(name: string, behavior: () => Promise<STTResult>): ISTTProvider {
  return { name, transcribe: behavior };
}

function chain(entries: Array<{ key: string; provider: ISTTProvider }>): SttProviderManager {
  const mgrEntries: SttProviderEntry[] = entries.map((e) => ({
    key: e.key,
    displayName: e.provider.name,
    provider: e.provider,
    breaker: createBreaker(e.key),
  }));
  return new SttProviderManager(mgrEntries);
}

describe('SttProviderManager transcription chain', () => {
  it('no providers configured → graceful failure', async () => {
    const mgr = new SttProviderManager([]);
    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/No STT providers/i);
  });

  it('first provider with a transcript wins; second is skipped', async () => {
    let secondCalled = false;
    const mgr = chain([
      { key: 'google', provider: provider('Google', async () => okResult('add 20 litre milk')) },
      { key: 'deepgram', provider: provider('Deepgram', async () => { secondCalled = true; return okResult('nope'); }) },
    ]);

    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(true);
    expect(out.provider).toBe('google');
    expect(out.result?.transcript).toBe('add 20 litre milk');
    expect(secondCalled).toBe(false);
    expect(out.attemptHistory.map((a) => a.key)).toEqual(['google']);
    expect(out.attemptHistory[0].status).toBe('ok');
  });

  it('empty transcript advances to the fallback provider', async () => {
    const googleResolved = { reported: 0, returned: 0 };
    const mgr = chain([
      { key: 'google', provider: provider('Google', async () => { googleResolved.reported = 1; googleResolved.returned = 1; return okResult(''); }) },
      { key: 'deepgram', provider: provider('Deepgram', async () => okResult('add 5kg rice', 900)) },
    ]);

    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(true);
    expect(out.provider).toBe('deepgram');
    expect(out.attemptHistory.map((a) => `${a.key}:${a.status}`)).toEqual(['google:failed', 'deepgram:ok']);
  });

  it('provider failure advances to the fallback provider', async () => {
    const mgr = chain([
      { key: 'google', provider: provider('Google', async () => { throw new Error('upstream down'); }) },
      { key: 'deepgram', provider: provider('Deepgram', async () => okResult('waste 2L milk', 800)) },
    ]);

    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(true);
    expect(out.provider).toBe('deepgram');
    expect(out.attemptHistory[0].status).toBe('failed');
    expect(out.attemptHistory[0].error).toMatch(/upstream down/);
  });

  it('a tripped (OPEN) circuit breaker makes the provider skipped, not failed', async () => {
    // Trip the Google breaker: failureThreshold defaults to 3.
    const failGoogle = async (): Promise<STTResult> => { throw new Error('boom'); };
    const mgr = chain([
      { key: 'google', provider: provider('Google', failGoogle) },
      { key: 'deepgram', provider: provider('Deepgram', async () => okResult('add 5 paneer', 700)) },
    ]);
    // Trigger the breaker repeatedly to flip it OPEN.
    for (let i = 0; i < 4; i++) {
      await mgr.transcribe(new Blob(['x'])).catch(() => {});
    }
    expect(mgr.list()[0]).toBe('google');

    // Next call: Google should be skipped due to OPEN circuit.
    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(true);
    expect(out.provider).toBe('deepgram');
    expect(out.attemptHistory[0].status).toBe('skipped');
    expect(out.attemptHistory[0].error).toMatch(/circuit OPEN/i);
  });

  it('all providers failing returns a failure with the full attempt trace', async () => {
    const mgr = chain([
      { key: 'google', provider: provider('Google', async () => { throw new Error('g-down'); }) },
      { key: 'deepgram', provider: provider('Deepgram', async () => { throw new Error('d-down'); }) },
    ]);

    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(false);
    expect(out.error).toBe('All STT providers failed');
    expect(out.attemptHistory).toHaveLength(2);
    expect(out.attemptHistory.map((a) => a.status)).toEqual(['failed', 'failed']);
  });

  it('estimates USD cost from provider-reported duration and the per-provider rate', async () => {
    const mgr = chain([
      { key: 'deepgram', provider: provider('Deepgram', async () => okResult('add milk', 12_000)) }, // 12s
    ]);
    const out = await mgr.transcribe(new Blob(['x']));
    expect(out.success).toBe(true);
    const expected = (STT_COST_PER_MINUTE['deepgram'] * 12) / 60;
    expect(out.costUsd).toBeCloseTo(expected, 4);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it('estimates duration from bytes when provider reports none', async () => {
    const mgr = chain([
      { key: 'deepgram', provider: provider('Deepgram', async () => ({ ...okResult('x'), durationMs: 0 })) },
    ]);
    // 32,000 bytes ≈ 2 seconds at 16 KB/s
    const out = await mgr.transcribe(new Blob([new Uint8Array(32_000)]));
    expect(out.costUsd).toBeCloseTo((STT_COST_PER_MINUTE['deepgram'] * 2) / 60, 4);
  });
});

describe('SttUsageService records + aggregates', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await SttUsage.deleteMany({}).exec();
  });

  it('persists a usage record with provider, cost, latency and attempt trace', async () => {
    await recordSttUsage({
      restaurantId: REST,
      employeeId: 'emp-9',
      provider: 'deepgram',
      model: 'nova-3-general',
      audioBytes: 16000,
      status: 'success',
      latencyMs: 850,
      costUsd: 0.0012,
      transcriptExcerpt: 'add 20 litre milk',
      attemptHistory: [{ key: 'google', status: 'failed', error: 'boom' }, { key: 'deepgram', status: 'ok' }],
    });

    const docs = await SttUsage.find({ restaurantId: REST }).lean();
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d.provider).toBe('deepgram');
    expect(d.status).toBe('success');
    expect(d.costUsd).toBe(0.0012);
    expect(d.audioSeconds).toBe(1); // 16000 bytes / 16000
    expect(d.attemptHistory).toHaveLength(2);
  });

  it('aggregates total cost, seconds, calls and by-provider splits', async () => {
    await recordSttUsage({ restaurantId: REST, provider: 'google', model: 'm', audioBytes: 16000, status: 'success', latencyMs: 1, costUsd: 0.024 });
    await recordSttUsage({ restaurantId: REST, provider: 'deepgram', model: 'm', audioBytes: 16000, status: 'error', latencyMs: 2, costUsd: 0.004 });
    await recordSttUsage({ restaurantId: REST, provider: 'deepgram', model: 'm', audioBytes: 0, status: 'empty', latencyMs: 3, costUsd: 0 });

    const summary = await getSttUsageSummary(REST);
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalSeconds).toBe(2);
    expect(summary.totalCostUsd).toBeCloseTo(0.028, 4);
    expect(summary.byProvider['google']).toBe(1);
    expect(summary.byProvider['deepgram']).toBe(2);
    expect(summary.byStatus['success']).toBe(1);
    expect(summary.byStatus['error']).toBe(1);
    expect(summary.byStatus['empty']).toBe(1);
  });

  it('is tenant-scoped: other restaurant rows are ignored', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await recordSttUsage({ restaurantId: other, provider: 'google', model: 'm', audioBytes: 0, status: 'success', latencyMs: 1, costUsd: 0 });
    const summary = await getSttUsageSummary(REST);
    expect(summary.totalCalls).toBe(0);
  });
});