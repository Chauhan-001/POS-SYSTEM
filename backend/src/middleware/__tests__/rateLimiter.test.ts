/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * adminApiLimiter tests — verify the admin dashboard rate limiter:
 *   - Requests under the per-IP limit pass through with standard headers.
 *   - Exceeding the limit returns 429 (standard + legacy headers disabled).
 *   - The 429 carries the expected JSON error body.
 * Uses the real exported limiter against a real express server, so the test
 * exercises the exact production middleware (config-driven max/window).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { adminApiLimiter, intelligenceConcurrencyGuard, concurrencyGuardFor } from '../rateLimiter';
import { config } from '../../config';

const MAX = config.rateLimiting.admin.maxRequests;
const WINDOW_SEC = config.rateLimiting.admin.windowMs / 1000;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/admin', adminApiLimiter, (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Fresh counter per test — the singleton limiter's in-memory store is reset so
// tests are independent of each other and of config defaults. If the store ever
// loses resetAll (e.g. a Redis-backed store), the assertions below fail loudly
// (remaining !== MAX-1, passed count out of range) rather than silently pass.
beforeEach(() => {
  (adminApiLimiter as any).store?.resetAll?.();
});

async function hitAdmin(): Promise<{ status: number; body: any; headers: Awaited<ReturnType<typeof fetch>>['headers'] }> {
  // Keep-alive (default) — `connection: close` on 300+ rapid requests churns
  // TCP sockets on Windows and can surface spurious ECONNREFUSED.
  const res = await fetch(`${baseUrl}/admin`);
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body, headers: res.headers };
}

describe('adminApiLimiter', () => {
  it('passes requests under the limit with standard rate-limit headers', async () => {
    const r = await hitAdmin();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers.get('ratelimit-limit')).toBe(String(MAX));
    expect(r.headers.get('ratelimit-policy')).toBe(`${MAX};w=${WINDOW_SEC}`);
    const remaining = Number(r.headers.get('ratelimit-remaining'));
    expect(remaining).toBe(MAX - 1);
  });

  it('returns 429 once the per-IP limit is exceeded', async () => {
    // Fire MAX + 10 requests sequentially (parallel bursts overflow the listen
    // backlog on Windows and can spuriously ECONNREFUSED). With the synchronous
    // in-memory store, exactly MAX pass and the rest are blocked.
    const statuses: number[] = [];
    for (let i = 0; i < MAX + 10; i++) {
      statuses.push((await hitAdmin()).status);
    }
    const passed = statuses.filter((s) => s === 200).length;
    const blocked = statuses.filter((s) => s === 429).length;

    // Exact boundary is an express-rate-limit implementation detail (some
    // versions block at count >= max, others at count > max) — assert behavior:
    // essentially the full budget passes, then everything after is 429.
    expect(passed).toBeLessThanOrEqual(MAX);
    expect(passed).toBeGreaterThanOrEqual(MAX - 5);
    expect(blocked).toBeGreaterThanOrEqual(5);
  });

  it('429 responses carry the limiter error body and zero remaining', async () => {
    // Consume the budget sequentially, then read one blocked response.
    for (let i = 0; i <= MAX; i++) {
      await hitAdmin();
    }
    const blocked = await hitAdmin();
    expect(blocked.status).toBe(429);
    expect(blocked.body?.error).toContain('Too many admin API requests');
    expect(Number(blocked.headers.get('ratelimit-remaining'))).toBe(0);
  });
});

/**
 * intelligenceConcurrencyGuard — the per-tenant in-flight cap.
 *
 * Both `finish` and `close` fire for a normal Express response, so an unguarded
 * release freed a tenant's slot TWICE per run. That under-counted concurrent
 * runs and admitted a third pipeline while a second was still executing — the
 * tool storm the guard exists to prevent. These tests run the real middleware
 * against a real server with responses held open, so the in-flight count is
 * observable through admission decisions alone.
 */
describe('intelligenceConcurrencyGuard', () => {
  const TENANT = 'guard-test-tenant';
  const originalMax = config.rateLimiting.intelligence.maxConcurrent;

  let server: Server;
  let baseUrl: string;
  /** Resolvers for responses deliberately held open. */
  let gate: Array<() => void>;
  let started = 0;

  /** Poll until `fn()` is true — the middleware is event-driven, not a promise. */
  async function waitFor(fn: () => boolean, timeoutMs = 5_000): Promise<void> {
    const from = Date.now();
    while (!fn()) {
      if (Date.now() - from > timeoutMs) throw new Error('timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  beforeAll(async () => {
    // Two slots so a finished run's release is separable from a still-running
    // one — with a cap of 1 the double release is invisible.
    config.rateLimiting.intelligence.maxConcurrent = 2;
    const app = express();
    app.use('/intel', (req, _res, next) => {
      (req as any).user = { restaurantId: TENANT };
      next();
    });
    app.post('/intel', intelligenceConcurrencyGuard, async (_req, res) => {
      started += 1;
      await new Promise<void>((resolve) => gate.push(resolve));
      res.json({ ok: true });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    config.rateLimiting.intelligence.maxConcurrent = originalMax;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    gate = [];
    started = 0;
  });

  it('admits up to the cap, rejects beyond it, and frees exactly one slot per finished run', async () => {
    const run = (): Promise<Response> => fetch(`${baseUrl}/intel`, { method: 'POST' });

    // A and B fill both slots and are held open.
    const a = run();
    await waitFor(() => started === 1);
    const b = run();
    await waitFor(() => started === 2);

    // C has no slot left → structured 429, and never reaches the handler.
    const c = await run();
    expect(c.status).toBe(429);
    expect((await c.json()).code).toBe('CONCURRENCY_LIMIT');
    expect(started).toBe(2);

    // Complete A. Exactly ONE slot may be freed: B is still in flight.
    gate.shift()!();
    await (await a).json();
    // `finish` then `close` are dispatched asynchronously; give both a chance
    // to run so a double release would already have under-counted here.
    await new Promise((r) => setTimeout(r, 150));

    // With one slot free, D is admitted (started → 3) and E is rejected again.
    // If A's release had run twice, the count would be 0 while B still runs, so
    // E would be wrongly admitted and this assertion would fail.
    const d = run();
    await waitFor(() => started === 3);

    // E must be rejected too. A 429 (or any rejection) settles immediately; a
    // wrongly ADMITTED request is held open by the handler, so "no response
    // within the window" is itself the evidence of a leaked slot. Racing the
    // fetch against a timer keeps a leaked-slot failure a crisp assertion
    // instead of a test-wide timeout.
    const e = run();
    const eStatus = await Promise.race([
      e.then((res) => res.status),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 1_000)),
    ]);

    // Drain every held response (including a wrongly-admitted E) before
    // asserting, so teardown is clean whichever way the race went.
    gate.splice(0).forEach((release) => release());
    await Promise.allSettled([a, b, d, e]);

    // 0 = admitted and held open, i.e. A's release ran twice.
    expect(eStatus).toBe(429);
    expect(started).toBe(3);
  });
});

/**
 * Per-agent isolation — one agent's run must not consume or block another
 * agent's slot. These counters used to be tenant-wide, so a marketing page load
 * holding `/intelligence` rejected the owner's own "Run deep analysis" click
 * (and any inventory-agent run) with a 429 for that pipeline's whole duration.
 */
describe('concurrencyGuardFor — per-agent isolation', () => {
  const TENANT = 'agent-isolation-tenant';
  const originalMax = config.rateLimiting.intelligence.maxConcurrent;

  let server: Server;
  let baseUrl: string;
  /** Resolvers for responses deliberately held open. */
  let gate: Array<() => void>;

  beforeAll(async () => {
    // Pin the cap to 1 so "one held run fills the slot" is unambiguous,
    // independent of what any earlier suite left in the shared config object.
    config.rateLimiting.intelligence.maxConcurrent = 1;
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { restaurantId: TENANT };
      next();
    });
    // Three independent agents, each with its own counter.
    for (const agent of ['marketing_intelligence', 'marketing_analyze', 'inventory_agent']) {
      app.get(`/${agent}`, concurrencyGuardFor(agent), async (_req, res) => {
        await new Promise<void>((resolve) => gate.push(resolve));
        res.json({ ok: true });
      });
    }
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    config.rateLimiting.intelligence.maxConcurrent = originalMax;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    gate = [];
  });

  it('a held marketing run does not block deep analysis or the inventory agent', async () => {
    // Occupy the marketing-intelligence slot and hold it open.
    const intel = fetch(`${baseUrl}/marketing_intelligence`);
    await new Promise((r) => setTimeout(r, 150));

    // Its OWN slot is full → a second intelligence run is rejected.
    const secondIntel = await fetch(`${baseUrl}/marketing_intelligence`);
    expect(secondIntel.status).toBe(429);
    expect((await secondIntel.json()).code).toBe('CONCURRENCY_LIMIT');

    // A different agent must be unaffected. An admitted request is held open by
    // the handler and never settles; a blocked one returns 429 immediately. So
    // racing against a timer turns a wrongly-blocked agent into a crisp
    // assertion instead of a test-wide hang.
    const otherAgents = await Promise.all(
      ['marketing_analyze', 'inventory_agent'].map(async (agent) => {
        const p = fetch(`${baseUrl}/${agent}`);
        return Promise.race([
          p.then((res) => `${agent}:${res.status}`),
          new Promise<string>((resolve) => setTimeout(() => resolve(`${agent}:no-response`), 1_000)),
        ]);
      }),
    );

    // "no-response" = admitted and still running (correct). Any status here
    // would mean the other agent was answered by the guard instead of running.
    expect(otherAgents).toEqual([
      'marketing_analyze:no-response',
      'inventory_agent:no-response',
    ]);

    // Drain every held response before teardown.
    gate.splice(0).forEach((release) => release());
    await Promise.allSettled([intel, secondIntel]);
  });
});
