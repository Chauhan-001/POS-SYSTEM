/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ipBlocklist.test.ts — Unit tests for the manual IP blocklist middleware.
 *
 * Runs against a real express server (like the other middleware tests). The
 * BlockedIp collection is seeded directly, then requests from blocked sources
 * are asserted to receive 403 while normal requests pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import BlockedIp from '../../models/BlockedIp';
import { ipBlocklist, invalidateIpBlocklistCache } from '../ipBlocklist';

let mongod: MongoMemoryServer;
let server: http.Server;
let port: number;

async function seed(ip: string, opts: { permanent?: boolean; hours?: number } = {}) {
  const expiresAt = opts.hours ? new Date(Date.now() + opts.hours * 60 * 60 * 1000) : null;
  return BlockedIp.create({
    ip,
    reason: 'test',
    blockedBy: 'Tester',
    permanent: opts.permanent ?? opts.hours === undefined,
    expiresAt,
    isActive: true,
  });
}

async function hit(fromIp?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${port}/probe`, {
    headers: fromIp ? { 'X-Forwarded-For': fromIp } : {},
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = express();
  app.use(ipBlocklist);
  app.get('/probe', (_req, res) => res.json({ ok: true }));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as any;
  port = addr.port;
});

afterAll(async () => {
  await server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await mongoose.disconnect();
  await mongod.stop();
});

describe('ipBlocklist middleware', () => {
  it('allows requests when nothing is blocked', async () => {
    invalidateIpBlocklistCache();
    const res = await hit('203.0.113.5');
    expect(res.status).toBe(200);
  });

  it('returns 403 for an exactly blocked IP', async () => {
    await seed('203.0.113.7');
    invalidateIpBlocklistCache();
    const res = await hit('203.0.113.7');
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('IP_BLOCKED');
  });

  it('blocks a host inside a CIDR range but not outside it', async () => {
    await seed('198.51.100.0/24');
    invalidateIpBlocklistCache();
    const inside = await hit('198.51.100.42');
    expect(inside.status).toBe(403);
    const outside = await hit('198.51.101.9');
    expect(outside.status).toBe(200);
  });

  it('blocks a bare IPv4 prefix', async () => {
    await seed('203.0.113.');
    invalidateIpBlocklistCache();
    const res = await hit('203.0.113.200');
    expect(res.status).toBe(403);
  });

  it('does not block after the temporary block expires', async () => {
    // hours: -1 is not allowed by validation, but the middleware honors expiry —
    // seed an already-expired entry directly.
    await BlockedIp.create({
      ip: '192.0.2.9',
      reason: 'expired',
      blockedBy: 'Tester',
      permanent: false,
      expiresAt: new Date(Date.now() - 60_000),
      isActive: true,
    });
    invalidateIpBlocklistCache();
    const res = await hit('192.0.2.9');
    expect(res.status).toBe(200);
  });

  it('ignores inactive (unblocked) entries', async () => {
    await BlockedIp.create({
      ip: '192.0.2.50',
      reason: 'unblocked',
      blockedBy: 'Tester',
      permanent: true,
      expiresAt: null,
      isActive: false,
    });
    invalidateIpBlocklistCache();
    const res = await hit('192.0.2.50');
    expect(res.status).toBe(200);
  });
});
