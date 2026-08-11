/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * deliveryService.test.ts — Regression tests for the campaign delivery layer.
 * Focus: the webhook SSRF guard (Phase 16 hardening). A restaurant-supplied
 * webhook URL must never let the server POST into private/loopback networks or
 * cloud-metadata endpoints.
 */

import { describe, it, expect } from 'vitest';
import { channelConfigured } from '../deliveryService';

// isSafeWebhookUrl is module-private; channelConfigured exercises it through the
// public surface (a private-range URL must NOT be considered configured, and an
// invalid URL must not crash the check).
describe('webhook SSRF guard', () => {
  it('accepts a normal public HTTPS webhook URL', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'https://hooks.example.com/campaign';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(true);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects loopback URLs', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'http://localhost:3000/hook';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects RFC1918 private IPs', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'https://192.168.1.10/hook';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects cloud-metadata / link-local addresses', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'https://169.254.169.254/latest/meta-data';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects private IPs over plain HTTP too (metadata SSRF via http)', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'http://169.254.169.254/latest/meta-data';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects 0.0.0.0 over http', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'http://0.0.0.0:8080/hook';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('rejects non-http(s) schemes', async () => {
    process.env.MARKETING_WEBHOOK_URL = 'file:///etc/passwd';
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
    delete process.env.MARKETING_WEBHOOK_URL;
  });

  it('is false when no webhook is configured at all', async () => {
    delete process.env.MARKETING_WEBHOOK_URL;
    delete process.env.MARKETING_WEBHOOK_SECRET;
    const ok = await channelConfigured('webhook');
    expect(ok).toBe(false);
  });
});
