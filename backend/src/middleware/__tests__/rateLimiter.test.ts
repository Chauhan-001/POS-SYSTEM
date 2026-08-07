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
import { adminApiLimiter } from '../rateLimiter';
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
