/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cache.ts — Report cache layer.
 *
 * Admin reports are expensive aggregations. We memoise per report key +
 * signature (reportKey + options) for a short TTL so the dashboard can poll
 * without hammering Mongo. Also exposes tag invalidation via the shared
 * `responseCache` so mutations (exports, snapshots) can bust the cache.
 */

import { responseCache } from '../../../utils/ResponseCache';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAulT_TTL_MS = 2 * 60 * 1000; // 2 minutes
const store = new Map<string, CacheEntry<any>>();

function key(reportKey: string, signature: string): string {
  return `report:${reportKey}:${signature}`;
}

/**
 * Run `fn` and memoise the result for `ttlMs`. The cache is shared per process
 * and additionally pushed through the global responseCache tags when available.
 */
export async function cachedReport<T>(
  reportKey: string,
  signature: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; tags?: string[] } = {},
): Promise<T> {
  const k = key(reportKey, signature);
  const hit = store.get(k);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(k, { value, expiresAt: Date.now() + (opts.ttlMs ?? DEFAulT_TTL_MS) });
  return value;
}

/** Invalidate a single report key (or all when no key provided). */
export function invalidateReportCache(reportKey?: string): void {
  if (!reportKey) {
    store.clear();
    return;
  }
  const prefix = `report:${reportKey}:`;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
  try {
    responseCache.invalidate(`admin-reports:${reportKey}`);
  } catch {
    // Non-fatal.
  }
}

/** Shared helper: build a signature from raw options to dedupe cache keys. */
export function signatureOf(options: Record<string, unknown> | object): string {
  const source = options as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || v === null || v === '') continue;
    safe[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return JSON.stringify(safe);
}

// Expose for tests.
export { DEFAulT_TTL_MS };