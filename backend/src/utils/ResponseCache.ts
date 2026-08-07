/**
 * ============================================================================
 * ResponseCache — Pluggable Server-Side Response Cache (Adapter-based)
 * ============================================================================
 *
 * This module provides the Express middleware for caching server responses.
 * The actual storage backend is pluggable via an ICacheAdapter:
 *   - InMemoryAdapter (default, used when Redis is unavailable)
 *   - RedisAdapter    (shared across instances, survives restarts)
 *
 * The adapter is injected at startup (see server.ts).
 *
 * Usage (identical regardless of backend):
 *   router.get('/admin/analytics/dashboard',
 *     requireAuth,
 *     cached({ ttlMs: 60_000, tags: ['analytics'] }),
 *     getDashboardStats
 *   );
 *
 * Invalidation on mutations:
 *   router.post('/admin/subscription-plans',
 *     requireAuth, createPlan,
 *     invalidateCache('plans')
 *   );
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { ICacheAdapter, InMemoryAdapter } from '../cache/adapters';

// ─── Types ────────────────────────────────────────────────────

export interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** Optional custom cache key (overrides auto-generation) */
  key?: string;
  /** Tags for group invalidation (e.g., ['analytics', 'plans', 'settings']) */
  tags?: string[];
  /** If true, caches based on path only (ignores query params) */
  ignoreQuery?: boolean;
}

// ─── Cache Singleton (start with InMemory, replaced by server.ts if Redis is available) ─

class ResponseCache {
  private adapter: ICacheAdapter = new InMemoryAdapter();

  /**
   * Replace the backend adapter at runtime.
   * Called from server.ts after attempting Redis connection.
   */
  setAdapter(adapter: ICacheAdapter): void {
    this.adapter = adapter;
  }

  /** Expose the current adapter (for startup/health checks). */
  getAdapter(): ICacheAdapter {
    return this.adapter;
  }

  // ─── Delegate to adapter ───────────────────────────────────

  async get(key: string): Promise<any | null> {
    return this.adapter.get(key);
  }

  async set(key: string, data: any, ttlMs: number, tags: string[] = []): Promise<void> {
    return this.adapter.set(key, data, ttlMs, tags);
  }

  async invalidate(key: string): Promise<void> {
    return this.adapter.invalidate(key);
  }

  async invalidateByTag(tag: string): Promise<number> {
    return this.adapter.invalidateByTag(tag);
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    return this.adapter.invalidateByTags(tags);
  }

  async clearAll(): Promise<void> {
    return this.adapter.clearAll();
  }

  async getStats(): Promise<any> {
    return this.adapter.getStats();
  }

  startCleanup(intervalMs: number): void {
    this.adapter.startCleanup(intervalMs);
  }

  async shutdown(): Promise<void> {
    return this.adapter.shutdown();
  }

  // ─── Key generation (adapter-independent) ──────────────────

  /** Generate a deterministic cache key from a request. */
  generateKey(req: Request, options?: CacheOptions): string {
    if (options?.key) return options.key;

    let path = req.path;

    // Build query string portion
    if (!options?.ignoreQuery && req.query && Object.keys(req.query).length > 0) {
      const sortedParams = Object.keys(req.query)
        .sort()
        .map((k) => {
          const v = req.query[k];
          return `${k}=${Array.isArray(v) ? v.sort().join(',') : v}`;
        })
        .join('&');
      if (sortedParams) {
        path += '?' + sortedParams;
      }
    }

    // Include locale from Accept-Language header when present
    const locale = req.headers['accept-language']?.toString().split(',')[0]?.trim();
    if (locale) {
      path += `|locale=${locale}`;
    }

    return `${req.method}:${path}`;
  }

  /** Ensure the response is only cached for GET requests. */
  isCacheable(req: Request): boolean {
    return req.method === 'GET';
  }
}

// ─── Singleton ────────────────────────────────────────────────

export const responseCache = new ResponseCache();

// ─── Express Middleware ───────────────────────────────────────

/**
 * Express middleware that caches the JSON response.
 *
 * - Only works for GET requests.
 * - Intercepts `res.json()` to capture the response body on first request.
 * - Returns cached response for subsequent requests within TTL.
 *
 * Must be placed AFTER auth/role middleware but BEFORE the controller handler:
 *
 *   router.get('/path',
 *     requireAuth,
 *     cached({ ttlMs: 60_000, tags: ['analytics'] }),
 *     handler
 *   );
 */
export function cached(options: CacheOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!responseCache.isCacheable(req)) {
      next();
      return;
    }

    const key = responseCache.generateKey(req, options);

    try {
      const cachedData = await responseCache.get(key);

      if (cachedData !== null) {
        // Cache HIT — return immediately, skip controller
        res.json(cachedData);
        return;
      }

      // Cache MISS — intercept res.json to capture fresh response
      const originalJson = res.json.bind(res);

      res.json = function (body: any): Response {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          responseCache.set(key, body, options.ttlMs, options.tags || []);
        }
        return originalJson(body);
      };

      next();
    } catch {
      // Cache error — degraded mode: fall through to controller
      const originalJson = res.json.bind(res);
      res.json = function (body: any): Response {
        return originalJson(body);
      };
      next();
    }
  };
}

/**
 * Express middleware that invalidates cache by tag AFTER the response
 * is successfully sent. Use on mutation routes (POST/PUT/DELETE).
 *
 *   router.post('/admin/subscription-plans',
 *     requireAuth, createPlan,
 *     invalidateCache('plans')
 *   );
 */
export function invalidateCache(tag: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.invalidateByTag(tag);
      }
    });
    next();
  };
}

/**
 * Invalidate multiple tags at once.
 */
export function invalidateCacheTags(tags: string[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.invalidateByTags(tags);
      }
    });
    next();
  };
}

export default responseCache;
