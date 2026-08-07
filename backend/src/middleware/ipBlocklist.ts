/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ipBlocklist.ts — Manual IP blocklist middleware.
 *
 * Every incoming request is checked against the BlockedIp collection (active,
 * non-expired entries). Blocked sources receive an immediate 403.
 *
 * Design:
 *   - In-memory cache refreshed from MongoDB every REFRESH_MS (or when the
 *     cache is stale after a block/unblock mutation calls invalidateIpCache()).
 *   - Supports exact IPs, CIDR ranges (203.0.113.0/24) and bare prefixes
 *     (203.0.113.) so a whole attacking subnet can be cut off in one entry.
 *   - FAIL-OPEN: if the DB is unreachable, requests are allowed through and a
 *     warning is logged — a transient DB issue must never take the entire
 *     platform offline. The blocklist re-engages on the next successful refresh.
 *   - x-forwarded-for aware (first hop) so the real client IP is used behind a
 *     reverse proxy; falls back to req.ip / req.socket.remoteAddress.
 */

import { Request, Response, NextFunction } from 'express';
import BlockedIp from '../models/BlockedIp';

interface BlockEntry {
  ip: string;
  expiresAt: number | null; // epoch ms; null = permanent
}

const REFRESH_MS = 60_000; // re-query the DB at most once per minute
let cache: BlockEntry[] = [];
let lastRefresh = 0;
let refreshInFlight: Promise<void> | null = null;

// ─────────────────────────────────────────────────────────────────
// IP matching (exact / CIDR / prefix)
// ─────────────────────────────────────────────────────────────────

/** IPv4 CIDR match (e.g. "203.0.113.0/24" vs "203.0.113.9"). */
function isInCidrV4(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split('/');
  const bits = parseInt(bitsRaw, 10);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (addr: string): number | null => {
    // IPv4 only (also strips IPv4-mapped ::ffff: prefix)
    const v4 = addr.includes(':') ? addr.split(':').pop() : addr;
    const parts = v4!.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || parseInt(p, 10) > 255)) return null;
    return parts.reduce((acc, p) => (acc << 8) + parseInt(p, 10), 0) >>> 0;
  };
  const ipInt = toInt(ip);
  const netInt = toInt(net);
  if (ipInt === null || netInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** True if the given client IP matches a blocklist entry (expiry respected). */
function matches(ip: string, now: number): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();
  for (const entry of cache) {
    if (entry.expiresAt !== null && now >= entry.expiresAt) continue;
    const entryIp = entry.ip.trim().toLowerCase();
    if (entryIp === normalized) return true;
    if (entryIp.includes('/') && isInCidrV4(normalized, entryIp)) return true;
    if (entryIp.endsWith('.') && normalized.startsWith(entryIp)) return true;
    if (entryIp.includes(':') && entryIp.endsWith(':') && normalized.startsWith(entryIp)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Cache lifecycle
// ─────────────────────────────────────────────────────────────────

/** Load active, non-expired block entries into the in-memory cache. */
export async function refreshIpBlocklist(): Promise<void> {
  try {
    const now = new Date();
    const docs = await BlockedIp.find({
      isActive: true,
      $or: [{ permanent: true }, { expiresAt: { $gt: now } }],
    })
      .select('ip permanent expiresAt')
      .lean()
      .exec();
    cache = docs.map((d) => ({
      ip: d.ip,
      expiresAt: d.permanent || !d.expiresAt ? null : new Date(d.expiresAt).getTime(),
    }));
    lastRefresh = Date.now();
  } catch (err) {
    // FAIL-OPEN: keep serving, log once.
    console.error('[IpBlocklist] refresh failed (continuing to allow traffic):', (err as Error)?.message);
  }
}

/** Drop the cache so the next request re-queries the DB (call after mutations). */
export function invalidateIpBlocklistCache(): void {
  lastRefresh = 0;
}

/** Ensure the cache is fresh (deduplicated concurrent refreshes). */
function ensureFresh(): Promise<void> {
  if (Date.now() - lastRefresh < REFRESH_MS) return Promise.resolve();
  if (!refreshInFlight) {
    refreshInFlight = refreshIpBlocklist().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Resolve the real client IP (proxy-aware). */
export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).split(',')[0].trim();
  const ip = req.ip || req.socket?.remoteAddress || '';
  // Strip IPv6-mapped prefix so both forms match.
  return ip.replace(/^::ffff:/, '');
}

/**
 * Express middleware — rejects blocked client IPs with 403.
 * Mounted early (before all /api routers) so no endpoint is reachable
 * from a blocked source.
 */
export function ipBlocklist(_req: Request, _res: Response, _next: NextFunction): void {
  // Async guard inside sync signature (Express 4 tolerates returned promises).
  void (async () => {
    try {
      await ensureFresh();
      if (matches(clientIp(_req), Date.now())) {
        _res.status(403).json({
          error: 'Access denied',
          code: 'IP_BLOCKED',
          message: 'Your IP address has been blocked by the platform administrator.',
        });
        return;
      }
      _next();
    } catch (err) {
      console.error('[IpBlocklist] check failed (fail-open):', (err as Error)?.message);
      _next();
    }
  })();
}
