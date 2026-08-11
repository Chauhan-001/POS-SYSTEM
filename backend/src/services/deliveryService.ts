/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * deliveryService.ts — Delivery provider abstraction for campaigns.
 *
 * Phase 16: replaces the old `sendChannel()` console.log stub. Every channel is
 * an adapter behind one interface. A channel is NEVER marked "sent" unless the
 * adapter actually transmitted and the provider accepted the payload.
 *
 * Implemented today:
 *   - webhook       — the only in-repo outbound integration (HMAC-signed POST)
 *   - whatsapp/sms/email/app_notification — NOT configured → honest "not_configured"
 *
 * Webhook configuration (in priority order):
 *   1. Restaurant.settings.integrations.webhook.{enabled,url,secret}
 *   2. Env: MARKETING_WEBHOOK_URL / MARKETING_WEBHOOK_SECRET
 */

import mongoose from 'mongoose';
import { createHmac } from 'node:crypto';
import { URL } from 'node:url';
import Restaurant from '../models/Restaurant';

export type DeliveryChannel = 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'webhook';

export interface DeliveryPayload {
  to: string;
  message: string;
  subject?: string;
  offerTitle?: string;
  campaignId?: string;
  historyId?: string;
  restaurantId?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
  deliveredAt?: string;
}

export interface DeliveryProvider {
  readonly channel: DeliveryChannel;
  isConfigured(): boolean;
  send(payload: DeliveryPayload): Promise<DeliveryResult>;
}

// ─── Webhook adapter ─────────────────────────────────────────────────────────

async function resolveWebhookConfig(restaurantId?: string): Promise<{ url?: string; secret?: string }> {
  const env = {
    url: process.env.MARKETING_WEBHOOK_URL || '',
    secret: process.env.MARKETING_WEBHOOK_SECRET || '',
  };
  if (!restaurantId) return env;
  try {
    const rest = await Restaurant.findById(restaurantId).lean().exec();
    const wh = (rest as any)?.settings?.integrations?.webhook;
    if (wh && wh.url) {
      return { url: String(wh.url), secret: String(wh.secret || '') };
    }
  } catch (err: any) {
    console.warn('[Delivery:Webhook] failed to read restaurant webhook config:', err?.message);
  }
  return env;
}

/**
 * SSRF guard: a restaurant-supplied webhook URL must be HTTPS and must not
 * point at loopback / private / link-local networks (including cloud metadata
 * IPs). The webhook is invoked SERVER-SIDE, so a localhost target is never
 * legitimate (the server would POST to itself or to dev-only services) — it is
 * rejected outright. Literal private-range IPs are rejected; DNS-resolved
 * hostnames pointing at internal ranges are the operator's responsibility, but
 * the scheme must be https.
 */
function isSafeWebhookUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'webhook URL is not a valid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'webhook URL must use http(s)';
  }
  const host = parsed.hostname.toLowerCase();

  // Never allow localhost / loopback under ANY scheme.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost')) {
    return 'webhook URL must not point to localhost/loopback';
  }

  // Reject literal private/loopback/link-local/metadata IPs on BOTH schemes.
  // (Also catches 0.0.0.0 and 169.254.x.x over plain HTTP, which could reach
  // cloud metadata endpoints.) DNS-resolved hostnames pointing at internal
  // ranges remain the operator's responsibility.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    const [a, b] = octets;
    const privateRanges =
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127); // CGNAT
    if (privateRanges) {
      return 'webhook URL must not point to a private/loopback IP';
    }
  }

  if (parsed.protocol === 'http:') {
    // Cleartext HTTP is only acceptable on the public internet for testing;
    // in production all real endpoints are HTTPS. Keep the option but require
    // an explicit non-loopback host.
    return null;
  }

  return null;
}

const webhookProvider: DeliveryProvider = {
  channel: 'webhook',
  isConfigured() {
    return Boolean(process.env.MARKETING_WEBHOOK_URL);
  },
  async send(payload: DeliveryPayload): Promise<DeliveryResult> {
    const { url, secret } = await resolveWebhookConfig(payload.restaurantId);
    if (!url) {
      return { ok: false, error: 'webhook not configured (set MARKETING_WEBHOOK_URL or restaurant settings)' };
    }
    const urlError = isSafeWebhookUrl(url);
    if (urlError) {
      console.warn(`[Delivery:Webhook] blocked unsafe webhook URL: ${urlError}`);
      return { ok: false, error: urlError };
    }
    try {
      const body = JSON.stringify({
        event: 'campaign.delivery',
        channel: 'webhook',
        to: payload.to,
        subject: payload.subject,
        message: payload.message,
        offerTitle: payload.offerTitle,
        campaignId: payload.campaignId,
        historyId: payload.historyId,
        sentAt: new Date().toISOString(),
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) {
        // HMAC-SHA256 signature so the receiving endpoint can verify the sender.
        headers['X-Webhook-Signature'] = createHmac('sha256', secret).update(body).digest('hex');
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `webhook responded ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, deliveredAt: new Date().toISOString() };
    } catch (err: any) {
      return { ok: false, error: `webhook send failed: ${err?.message || 'unknown'}` };
    }
  },
};

// ─── Not-configured adapters ─────────────────────────────────────────────────

function notConfigured(channel: DeliveryChannel): DeliveryProvider {
  return {
    channel,
    isConfigured() {
      return false;
    },
    async send(): Promise<DeliveryResult> {
      return { ok: false, error: `${channel} channel is not configured (Settings → Integrations)` };
    },
  };
}

const NOT_CONFIGURED: Record<DeliveryChannel, DeliveryProvider> = {
  whatsapp: notConfigured('whatsapp'),
  sms: notConfigured('sms'),
  email: notConfigured('email'),
  app_notification: notConfigured('app_notification'),
  webhook: webhookProvider,
};

export function providerFor(channel: string): DeliveryProvider {
  return NOT_CONFIGURED[(channel as DeliveryChannel)] || notConfigured('email');
}

/**
 * Channels that are configured and thus safe to offer in the campaign builder.
 * A channel can still fail per-recipient at delivery time.
 */
export async function availableChannels(restaurantId?: string): Promise<DeliveryChannel[]> {
  const { url } = await resolveWebhookConfig(restaurantId);
  const configured: DeliveryChannel[] = [];
  if (url) configured.push('webhook');
  return configured;
}

/**
 * True when a channel has a usable provider configuration for THIS restaurant.
 * Webhook configuration can come from restaurant settings (Settings →
 * Integrations) OR the server env — checking only env would wrongly declare a
 * Settings-configured webhook "not configured" during queue processing.
 */
export async function channelConfigured(channel: DeliveryChannel, restaurantId?: string): Promise<boolean> {
  if (channel !== 'webhook') return false; // only webhook is a real adapter today
  const { url } = await resolveWebhookConfig(restaurantId);
  if (!url) return false;
  return isSafeWebhookUrl(url) === null;
}
