/**
 * ============================================================================
 *  Cache Adapters — Pluggable Backend for ResponseCache
 * ============================================================================
 *
 * Architecture:
 *   ResponseCache (middleware) → ICacheAdapter (pluggable)
 *                                 ├── InMemoryAdapter (default, zero deps)
 *                                 └── RedisAdapter     (requires Redis server)
 *
 * The adapter is chosen at startup in server.ts. If REDIS_URL is configured and
 * Redis is reachable, the RedisAdapter is used. On failure (or no config), the
 * InMemoryAdapter is used as a safe fallback.
 *
 * Output serialization:
 *   Data is serialized to JSON strings for Redis storage. The InMemoryAdapter
 *   stores raw JavaScript objects for zero serialization overhead.
 * ============================================================================
 */

import Redis from 'ioredis';

// ─── Interface ────────────────────────────────────────────────

export interface CacheEntry {
  data: any;
  expiresAt: number;
  tags: string[];
  createdAt: number;
  accessCount: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  activeKeys: string[];
  oldestEntry: string | null;
  newestEntry: string | null;
  totalExpired: number;
}

export interface ICacheAdapter {
  /** Retrieve a cached value. Returns null on miss or expiry. */
  get(key: string): Promise<any | null>;

  /** Store a value with TTL and optional tags. */
  set(key: string, data: any, ttlMs: number, tags: string[]): Promise<void>;

  /** Remove a single key from cache. */
  invalidate(key: string): Promise<void>;

  /** Remove all entries tagged with the given tag. Returns count. */
  invalidateByTag(tag: string): Promise<number>;

  /** Remove all entries matching any of the given tags. */
  invalidateByTags(tags: string[]): Promise<number>;

  /** Wipe the entire cache. */
  clearAll(): Promise<void>;

  /** Return runtime statistics. */
  getStats(): Promise<CacheStats>;

  /** Called once on startup (e.g., to start a cleanup timer). */
  startCleanup(intervalMs: number): void;

  /** Called on shutdown (e.g., to close Redis connection). */
  shutdown(): Promise<void>;
}

// ─── Redis Key helpers ────────────────────────────────────────

const PREFIX_DATA = 'cache:data:';
const PREFIX_TAG  = 'cache:tag:';

function dataKey(raw: string): string { return `${PREFIX_DATA}${raw}`; }
function tagKey(tag: string): string   { return `${PREFIX_TAG}${tag}`; }

// ─── InMemoryAdapter (default, zero dependencies) ─────────────

export class InMemoryAdapter implements ICacheAdapter {
  private store = new Map<string, CacheEntry>();
  private tagIndex = new Map<string, Set<string>>(); // tag → set of data keys
  private hits = 0;
  private misses = 0;
  private totalExpired = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanup(intervalMs: number): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object') {
      this.cleanupTimer.unref();
    }
  }

  shutdown(): Promise<void> {
    this.stopCleanup();
    return Promise.resolve();
  }

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this._removeEntry(key);
        removed++;
      }
    }
    if (removed > 0) this.totalExpired += removed;
    return removed;
  }

  async get(key: string): Promise<any | null> {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return null; }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this._removeFromTagIndex(key);
      this.totalExpired++;
      this.misses++;
      return null;
    }
    entry.accessCount++;
    this.hits++;
    return entry.data;
  }

  async set(key: string, data: any, ttlMs: number, tags: string[]): Promise<void> {
    const now = Date.now();
    const entry: CacheEntry = {
      data,
      expiresAt: now + ttlMs,
      tags,
      createdAt: now,
      accessCount: 0,
    };
    this.store.set(key, entry);
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(key);
    }
  }

  async invalidate(key: string): Promise<void> {
    this._removeEntry(key);
  }

  async invalidateByTag(tag: string): Promise<number> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;
    let count = 0;
    for (const key of keys) {
      this.store.delete(key);
      count++;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    const affected = new Set<string>();
    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);
      if (keys) {
        for (const key of keys) affected.add(key);
      }
      this.tagIndex.delete(tag);
    }
    for (const key of affected) this.store.delete(key);
    return affected.size;
  }

  async clearAll(): Promise<void> {
    this.store.clear();
    this.tagIndex.clear();
  }

  async getStats(): Promise<CacheStats> {
    let oldest = Infinity;
    let newest = 0;
    let oldestKey: string | null = null;
    let newestKey: string | null = null;

    for (const [key, entry] of this.store.entries()) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
      if (entry.createdAt > newest) {
        newest = entry.createdAt;
        newestKey = key;
      }
    }

    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      activeKeys: Array.from(this.store.keys()),
      oldestEntry: oldestKey,
      newestEntry: newestKey,
      totalExpired: this.totalExpired,
    };
  }

  private _removeEntry(key: string): void {
    this.store.delete(key);
    this._removeFromTagIndex(key);
  }

  private _removeFromTagIndex(key: string): void {
    for (const [, keys] of this.tagIndex.entries()) {
      keys.delete(key);
    }
  }
}

// ─── RedisAdapter (shared across processes, survives restarts) ─

export class RedisAdapter implements ICacheAdapter {
  private redis: Redis;
  private hits = 0;
  private misses = 0;
  private totalExpired = 0;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // give up
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true, // don't connect until .connect() is called
      enableReadyCheck: true,
    });
  }

  /** Call after construction to establish the connection. Returns true on success. */
  async connect(): Promise<boolean> {
    try {
      await this.redis.connect();
      await this.redis.ping();
      console.log('[RedisAdapter] Connected to Redis');
      return true;
    } catch (err) {
      console.error('[RedisAdapter] Connection failed:', (err as Error).message);
      return false;
    }
  }

  startCleanup(_intervalMs: number): void {
    // Redis handles TTL expiry natively — no cleanup needed.
  }

  async shutdown(): Promise<void> {
    await this.redis.quit();
  }

  async get(key: string): Promise<any | null> {
    try {
      const raw = await this.redis.get(dataKey(key));
      if (raw === null) {
        this.misses++;
        return null;
      }
      const parsed = JSON.parse(raw);
      // Check expiry (belt-and-suspenders, Redis TTL handles most cases)
      if (parsed.e && parsed.e <= Date.now()) {
        await this.redis.del(dataKey(key));
        this.totalExpired++;
        this.misses++;
        return null;
      }
      this.hits++;
      return parsed.d;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(key: string, data: any, ttlMs: number, tags: string[]): Promise<void> {
    try {
      const now = Date.now();
      const payload = JSON.stringify({
        d: data,        // the actual data
        e: now + ttlMs, // absolute expiry timestamp
        c: now,         // created at
      });

      const pipeline = this.redis.pipeline();
      pipeline.set(dataKey(key), payload, 'PX', ttlMs);

      // Update tag index — store each tag as a Set of data keys
      for (const tag of tags) {
        pipeline.sadd(tagKey(tag), key);
      }

      await pipeline.exec();
    } catch (err) {
      console.error('[RedisAdapter] set error:', (err as Error).message);
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      // Remove from all tag sets (we don't know which tags, so scan)
      // For efficiency, just delete the data key directly.
      // Tag sets may contain stale references, but they're cleaned up
      // on invalidationByTag when the SMEMBERS result contains missing keys.
      await this.redis.del(dataKey(key));
    } catch {
      // silently ignore — cache invalidation is best-effort
    }
  }

  async invalidateByTag(tag: string): Promise<number> {
    try {
      const members = await this.redis.smembers(tagKey(tag));
      if (members.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      // Delete the tag set itself
      pipeline.del(tagKey(tag));
      // Delete all data keys in this tag group
      for (const member of members) {
        pipeline.del(dataKey(member));
      }
      await pipeline.exec();
      return members.length;
    } catch {
      return 0;
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    let total = 0;
    for (const tag of tags) {
      total += await this.invalidateByTag(tag);
    }
    return total;
  }

  async clearAll(): Promise<void> {
    try {
      // Use SCAN to find all cache keys and delete them
      let cursor = '0';
      const pipeline = this.redis.pipeline();
      do {
        const result = await this.redis.scan(cursor, 'MATCH', 'cache:*', 'COUNT', 500);
        cursor = result[0];
        const keys = result[1];
        if (keys.length > 0) {
          pipeline.del(...keys);
        }
      } while (cursor !== '0');
      await pipeline.exec();
    } catch {
      // best-effort
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      // Count cache:data:* keys — this is an approximation using SCAN
      let count = 0;
      let cursor = '0';
      const sampleKeys: string[] = [];

      do {
        const result = await this.redis.scan(cursor, 'MATCH', 'cache:data:*', 'COUNT', 1000);
        cursor = result[0];
        count += result[1].length;
        // Keep a few sample keys for activeKeys
        if (sampleKeys.length < 20) {
          sampleKeys.push(...result[1].slice(0, 20));
        }
      } while (cursor !== '0');

      return {
        size: count,
        hits: this.hits,
        misses: this.misses,
        activeKeys: sampleKeys.map((k) => k.replace(PREFIX_DATA, '')),
        oldestEntry: null,
        newestEntry: null,
        totalExpired: this.totalExpired,
      };
    } catch {
      return { size: 0, hits: this.hits, misses: this.misses, activeKeys: [], oldestEntry: null, newestEntry: null, totalExpired: this.totalExpired };
    }
  }

  /** Expose the underlying Redis client for advanced use (e.g., health checks). */
  getClient(): Redis {
    return this.redis;
  }
}
