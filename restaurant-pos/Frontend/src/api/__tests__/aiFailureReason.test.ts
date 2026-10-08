/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI failure-reason recording (client.ts).
 *
 * After a null result from an owner-invoked AI endpoint, the request layer
 * records WHY (offline / client abort / 429 / session / server) for
 * `getLastAiFailureReason`. The marketing + inventory screens use that reason
 * to show a cause-specific sentence instead of one generic "couldn't load"
 * line — previously the 429-aware catch blocks were dead code because
 * `request()` never throws. This pins:
 *
 *   - 429 → 'rate_limited', 403 → 'auth_required', 5xx → 'server_error';
 *   - an aborted request (the AbortController timeout) → 'timeout';
 *   - a later SUCCESS on the same path clears the recorded reason (the value
 *     always describes the CURRENT call, never stale advice);
 *   - non-AI write paths are never recorded (no cross-talk);
 *   - the contract pinned by aiOfflineQueueGuard.test.ts is unchanged:
 *     failures still surface as null and are still never queued for replay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncEngine } from '../../lib/syncEngine';
import {
  runMarketingIntelligence,
  runInventoryAgentInsight,
  createPromotion,
  getLastAiFailureReason,
} from '../client';

const INTEL = '/ai/marketing-agent/intelligence';
const INV = '/ai/inventory-agent/recommend';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getLastAiFailureReason — why an AI call returned nothing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    syncEngine.clearQueue();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setOnline(true);
  });

  it('429 → rate_limited; the call still surfaces null and is never queued', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'in progress' }));
    expect(await runMarketingIntelligence({})).toBeNull();
    expect(getLastAiFailureReason(INTEL as never)).toBe('rate_limited');
    expect(syncEngine.getQueue()).toHaveLength(0);
  });

  it('403 → auth_required (a session problem, not a rate limit)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    expect(await runInventoryAgentInsight({})).toBeNull();
    expect(getLastAiFailureReason(INV as never)).toBe('auth_required');
  });

  it('500 → server_error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    expect(await runMarketingIntelligence({})).toBeNull();
    expect(getLastAiFailureReason(INTEL as never)).toBe('server_error');
  });

  it('an aborted request (the timeout path) → timeout, not network_error', async () => {
    // request() aborts via AbortController when the client budget expires —
    // simulate the exact rejection the abort produces.
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    );
    expect(await runInventoryAgentInsight({})).toBeNull();
    expect(getLastAiFailureReason(INV as never)).toBe('timeout');
  });

  it('a later successful call on the same path clears the recorded reason', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'in progress' }));
    expect(await runMarketingIntelligence({})).toBeNull();
    expect(getLastAiFailureReason(INTEL as never)).toBe('rate_limited');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, result: { ok: 1 } }));
    expect(await runMarketingIntelligence({})).toEqual({ success: true, result: { ok: 1 } });
    expect(getLastAiFailureReason(INTEL as never)).toBeUndefined();
  });

  it('non-AI write paths are never recorded and leave prior reasons intact', async () => {
    // Clear both paths with successes first, so the assertion is independent
    // of what earlier tests in this file recorded.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { success: true, result: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, result: {} }));
    await runMarketingIntelligence({});
    await runInventoryAgentInsight({});
    expect(getLastAiFailureReason(INTEL as never)).toBeUndefined();
    expect(getLastAiFailureReason(INV as never)).toBeUndefined();

    // A non-AI write failing with 429 is queued-guard behavior territory —
    // it must NOT touch the AI-reason map, and HTTP errors never queue.
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'nope' }));
    expect(await createPromotion({ title: 'Diwali' })).toBeNull();
    expect(getLastAiFailureReason(INTEL as never)).toBeUndefined();
    expect(getLastAiFailureReason(INV as never)).toBeUndefined();
    expect(syncEngine.getQueue()).toHaveLength(0);
  });
});
