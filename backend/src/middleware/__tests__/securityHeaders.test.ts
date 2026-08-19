/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * securityHeaders middleware tests — verify the production helmet config
 * (see middleware/securityHeaders.ts) sets the expected security headers on
 * every response: nosniff, clickjacking guards, CSP tuned for the SPA,
 * referrer policy, HSTS, COOP/CORP.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { securityHeaders } from '../securityHeaders';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(securityHeaders());
  app.get('/test', (_req, res) => res.json({ ok: true }));
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

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe('securityHeaders middleware', () => {
  it('still serves the route with a 200 and valid JSON body', async () => {
    const { status, body } = await get('/test');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const { headers } = await get('/test');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('blocks clickjacking via X-Frame-Options and CSP frame-ancestors', async () => {
    const { headers } = await get('/test');
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const csp = headers.get('content-security-policy') || '';
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('applies a CSP tuned for the SPA (self scripts, safe img sources, no upgrade-insecure-requests)', async () => {
    const { headers } = await get('/test');
    const csp = headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    // React inline style attributes + external Google Fonts are allowed…
    expect(csp).toContain("style-src 'self' https: 'unsafe-inline'");
    // …and images may come from self / data: / blob: / https:
    expect(csp).toContain("img-src 'self' data: blob: https:");
    // LAN/HTTP POS deployments must not be force-upgraded to https
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('allows the Razorpay checkout (script, frame and connect) so Settings → Upgrade Plan works in the built app', async () => {
    const { headers } = await get('/test');
    const csp = headers.get('content-security-policy') || '';
    // checkout.js must load as a script…
    expect(csp).toContain("script-src 'self' https://checkout.razorpay.com");
    // …the payment modal iframe must be allowed…
    expect(csp).toContain("frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com");
    // …and the checkout page + telemetry must be reachable.
    expect(csp).toContain("connect-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://lumberjack.razorpay.com");
  });

  it('sets Referrer-Policy and HSTS', async () => {
    const { headers } = await get('/test');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('strict-transport-security') || '').toMatch(/^max-age=\d+/);
  });

  it('allows cross-origin media loads (CORP cross-origin) while enforcing COOP', async () => {
    const { headers } = await get('/test');
    // Media served from this API is displayed by cross-origin frontends
    expect(headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });
});
