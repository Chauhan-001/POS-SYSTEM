/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cacheService.ts — Simple in-memory cache for AI analytics aggregation results.
 *
 * Used by aiAnalyticsService to cache expensive aggregation pipeline results.
 * Default TTL is 5 minutes (300 seconds).
 *
 * This implementation uses an in-memory store. For production deployments behind
 * multiple node instances, replace with Redis or a shared cache.
 */

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

/**
 * Get a value from the cache.
 * Returns undefined if the key doesn't exist or is expired.
 */
export async function getCache<T = any>(key: string): Promise<T | undefined> {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/**
 * Set a value in the cache with a TTL in seconds.
 */
export async function setCache(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Delete a specific key from the cache.
 */
export async function deleteCache(key: string): Promise<void> {
  store.delete(key);
}

/**
 * Clear all entries from the cache.
 */
export async function clearCache(): Promise<void> {
  store.clear();
}

/**
 * Get the number of entries currently in the cache.
 */
export function cacheSize(): number {
  return store.size;
}