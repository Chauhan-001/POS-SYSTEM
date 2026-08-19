/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SyncEngine offline-queue tests — Phase 1.10 validation of the offline-first
 * sync layer:
 *   - enqueue persists to localStorage (crash recovery) and bumps pending count
 *   - stale entries older than the retention window are discarded on load
 *   - dequeue removes + persists
 *   - markRetry increments and drops after max retries
 *   - replayQueue: success → dequeue, API error → retry, network error → retry
 *   - offline→online sets the pending-replay flag (consumed once)
 *   - stale entity keys are marked/consumed
 *   - getSyncState returns stable references when nothing changed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../syncEngine';

const QUEUE_KEY = 'pos_sync_queue';

function makeEngine(): SyncEngine {
  return new SyncEngine();
}

const op = (over: Record<string, unknown> = {}) => ({
  method: 'POST' as const,
  path: '/api/bills',
  body: { grandTotal: 100 },
  ...over,
});

describe('SyncEngine offline queue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('enqueues an operation and persists it for crash recovery', () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const queue = engine.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].retries).toBe(0);
    expect(queue[0].maxRetries).toBe(5);
    // Persisted → a fresh engine instance (crash) restores the same entry.
    const reloaded = makeEngine();
    expect(reloaded.getQueue()).toHaveLength(1);
    expect(reloaded.getQueue()[0].path).toBe('/api/bills');
  });

  it('discards entries older than the 7-day retention window on load', () => {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        {
          id: 'op_stale',
          method: 'POST',
          path: '/api/bills',
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          retries: 0,
          maxRetries: 5,
        },
        {
          id: 'op_fresh',
          method: 'POST',
          path: '/api/bills',
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: 5,
        },
      ])
    );
    const engine = makeEngine();
    const ids = engine.getQueue().map((q) => q.id);
    expect(ids).toEqual(['op_fresh']);
    expect(ids).not.toContain('op_stale');
  });

  it('dequeue removes the operation and persists the change', () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const id = engine.getQueue()[0].id;
    engine.dequeue(id);
    expect(engine.getQueue()).toHaveLength(0);
    // Persisted removal survives a reload.
    expect(makeEngine().getQueue()).toHaveLength(0);
  });

  it('markRetry increments the retry counter and records the error', () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const id = engine.getQueue()[0].id;
    engine.markRetry(id, 'API returned error');
    expect(engine.getQueue()[0].retries).toBe(1);
    expect(engine.getQueue()[0].error).toBe('API returned error');
  });

  it('STALLS an operation after max retries instead of silently dropping it (Phase 5)', () => {
    const engine = makeEngine();
    engine.enqueue(op()); // /api/bills — a financial write must never vanish
    const id = engine.getQueue()[0].id;
    for (let i = 0; i < 5; i++) engine.markRetry(id, 'err');
    const remaining = engine.getQueue();
    expect(remaining).toHaveLength(1); // kept, never dropped
    expect(remaining[0].stalled).toBe(true);
    expect(remaining[0].retries).toBe(5);
    expect(remaining[0].error).toBe('err');
  });

  it('replayQueue skips stalled operations until manually retried', async () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const id = engine.getQueue()[0].id;
    for (let i = 0; i < 5; i++) engine.markRetry(id, 'err');
    const fetcher = vi.fn(async () => true);
    const result = await engine.replayQueue(fetcher);
    expect(fetcher).not.toHaveBeenCalled(); // no auto-retry on stalled ops
    expect(result).toEqual({ success: 0, failed: 0 });
    expect(engine.getQueue()[0].stalled).toBe(true);
  });

  it('retryNow resets a stalled operation so replay can succeed', async () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const id = engine.getQueue()[0].id;
    for (let i = 0; i < 5; i++) engine.markRetry(id, 'err');
    engine.retryNow(id);
    expect(engine.getQueue()[0].stalled).toBe(false);
    expect(engine.getQueue()[0].retries).toBe(0);
    expect(engine.getQueue()[0].error).toBeUndefined();
    const fetcher = vi.fn(async () => true);
    const result = await engine.replayQueue(fetcher);
    expect(result.success).toBe(1);
    expect(engine.getQueue()).toHaveLength(0);
  });

  it('clearOperation removes an op only on explicit operator action', async () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const id = engine.getQueue()[0].id;
    for (let i = 0; i < 5; i++) engine.markRetry(id, 'err');
    engine.clearOperation(id);
    expect(engine.getQueue()).toHaveLength(0);
  });

  it('replayQueue dequeues successful operations and reports counts', async () => {
    const engine = makeEngine();
    engine.enqueue(op({ path: '/api/bills' }));
    engine.enqueue(op({ path: '/api/orders' }));
    engine.enqueue(op({ path: '/api/bills/2' }));

    const fetcher = vi.fn(async (o: any) => o.path !== '/api/orders'); // 2 ok, 1 fail
    const result = await engine.replayQueue(fetcher);

    expect(result).toEqual({ success: 2, failed: 1 });
    const remaining = engine.getQueue().map((q) => q.path);
    expect(remaining).toEqual(['/api/orders']);
    expect(remaining[0] === '/api/orders' && engine.getQueue()[0].retries).toBe(1);
  });

  it('replayQueue marks retry on network exceptions without throwing', async () => {
    const engine = makeEngine();
    engine.enqueue(op());
    const fetcher = vi.fn(async () => { throw new Error('network down'); });
    const result = await engine.replayQueue(fetcher);
    expect(result.failed).toBe(1);
    expect(engine.getQueue()[0].retries).toBe(1);
  });

  it('sets the pending-replay flag on offline→online transition (consumed once)', () => {
    const engine = makeEngine();
    engine.setOnline(false);
    expect(engine.consumePendingReplay()).toBe(false); // no transition yet
    engine.setOnline(true); // offline→online transition
    expect(engine.consumePendingReplay()).toBe(true);
    expect(engine.consumePendingReplay()).toBe(false); // consumed once
  });

  it('marks and consumes stale entity keys for re-fetch on reconnect', () => {
    const engine = makeEngine();
    engine.markStale('products');
    engine.markStale('customers');
    engine.markStale('products'); // dedupe via Set
    const keys = engine.consumeStaleKeys();
    expect(keys).toContain('products');
    expect(keys).toContain('customers');
    expect(keys).toHaveLength(2);
    expect(engine.consumeStaleKeys()).toEqual([]); // cleared
  });

  it('getSyncState returns a stable reference when nothing changed', () => {
    const engine = makeEngine();
    const s1 = engine.getSyncState();
    const s2 = engine.getSyncState();
    expect(s1).toBe(s2); // same object reference
    engine.enqueue(op());
    const s3 = engine.getSyncState();
    expect(s3).not.toBe(s1);
    expect(s3.pendingChanges).toBe(1);
  });

  it('sync() records lastSynced and notifies subscribers', () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.sync();
    expect(listener).toHaveBeenCalled();
    expect(engine.getSyncState().lastSynced).toBeTruthy();
  });
});
