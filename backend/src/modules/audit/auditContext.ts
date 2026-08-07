/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * auditContext.ts — Request-scoped audit context.
 *
 * Every request carries a requestId + correlationId and a live reference to the
 * Express request. The AuditService reads this context to auto-populate actor,
 * tenant, device, IP, browser, OS and route attributes without developers
 * threading values through every call.
 *
 * `store.req` is intentionally a live reference: actor fields are resolved at
 * audit-write time (after the auth middleware has populated req.user).
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Request } from 'express';

export interface AuditRequestStore {
  requestId: string;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  req?: Request;
}

export const auditStorage = new AsyncLocalStorage<AuditRequestStore>();

export function getAuditStore(): AuditRequestStore | undefined {
  return auditStorage.getStore();
}

export function withAuditStore<T>(store: AuditRequestStore, fn: () => T): T {
  return auditStorage.run(store, fn);
}

// ─── Minimal User-Agent parser (no dependency) ────────────────────
// Detects the common browser families + OS + platform. Unknown values are
// passed through verbatim so nothing is lost.

export interface ParsedUserAgent {
  browser?: string;
  platform?: string;
  os?: string;
}

export function parseUserAgent(ua: string | undefined): ParsedUserAgent {
  if (!ua) return {};
  const value = ua.slice(0, 512);
  let browser: string | undefined;
  if (/Edg\//i.test(value)) browser = 'Edge';
  else if (/OPR\//i.test(value)) browser = 'Opera';
  else if (/Chrome\//i.test(value)) browser = 'Chrome';
  else if (/Safari\//i.test(value)) browser = 'Safari';
  else if (/Firefox\//i.test(value)) browser = 'Firefox';
  else if (/MSIE|Trident/i.test(value)) browser = 'IE';
  else if (/Electron\//i.test(value)) browser = 'Electron';

  let platform: string | undefined;
  if (/Windows/i.test(value)) platform = 'Windows';
  else if (/Android/i.test(value)) platform = 'Android';
  else if (/iPhone|iPad|iPod/i.test(value)) platform = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(value)) platform = 'macOS';
  else if (/Linux/i.test(value)) platform = 'Linux';

  let os: string | undefined;
  if (/Windows NT 10/i.test(value)) os = 'Windows 10/11';
  else if (/Windows NT 6\.[13]/i.test(value)) os = 'Windows 7/8';
  else if (/Android (\d+)/i.test(value)) os = `Android ${value.match(/Android (\d+)/)?.[1]}`;
  else if (/iPhone OS (\d+[._]\d+)/i.test(value)) os = `iOS ${value.match(/iPhone OS (\d+[._]\d+)/)?.[1]?.replace('_', '.')}`;
  else if (/Mac OS X (\d+[._]\d+)/i.test(value)) os = `macOS ${value.match(/Mac OS X (\d+[._]\d+)/)?.[1]?.replace('_', '.')}`;
  else if (/Linux/i.test(value)) os = 'Linux';
  else if (/CrOS/i.test(value)) os = 'ChromeOS';

  return { browser, platform, os };
}

export function requestIp(req?: Request): string | undefined {
  if (!req) return undefined;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real;
  return req.ip;
}

export function requestDeviceId(req?: Request): string | undefined {
  if (!req) return undefined;
  const d = req.headers['x-device-id'] || req.headers['x-client-id'];
  if (typeof d === 'string' && d.length > 0) return d.slice(0, 120);
  return undefined;
}