/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Circuit Breaker — Prevents cascading failures from external dependencies.
 *
 * States:
 *   CLOSED    — Normal operation. Requests pass through.
 *   OPEN      — Dependency is failing. Requests fast-fail with fallback.
 *   HALF_OPEN — Cooldown elapsed. One test request allowed to probe recovery.
 *
 * Features:
 *   - Configurable failure threshold & cooldown
 *   - Per-request timeout via AbortController
 *   - Limited concurrency (semaphore) to prevent thread/connection exhaustion
 *   - Optional fallback function returning degraded response
 *   - Automatic state transitions (OPEN → HALF_OPEN → CLOSED or OPEN again)
 */

interface CircuitBreakerOptions {
  /** Name for logging (e.g., 'Razorpay', 'AI', 'Weather') */
  name: string;
  /** Number of consecutive failures before tripping OPEN (default: 5) */
  failureThreshold?: number;
  /** Milliseconds to stay OPEN before transitioning to HALF_OPEN (default: 30000) */
  cooldownMs?: number;
  /** Milliseconds to wait before timing out a request (default: 10000) */
  timeoutMs?: number;
  /** Maximum concurrent in-flight requests (default: 10) */
  maxConcurrency?: number;
  /** Optional fallback function returning a degraded result on failure */
  fallback?: () => any;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  inFlight: number;
  totalTimeouts: number;
  totalFallbacks: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private openedAt: number | null = null;
  private inFlight = 0;
  private totalTimeouts = 0;
  private totalFallbacks = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly fallback?: () => any;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxConcurrency = options.maxConcurrency ?? 10;
    this.fallback = options.fallback;
  }

  /**
   * Get current stats for monitoring.
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
      lastFailureTime: this.lastFailureTime,
      inFlight: this.inFlight,
      totalTimeouts: this.totalTimeouts,
      totalFallbacks: this.totalFallbacks,
      openedAt: this.openedAt,
    };
  }

  /**
   * Execute an operation through the circuit breaker.
   *
   * @param operation - The async function to call (e.g., () => fetch(...))
   * @param overrideFallback - Optional fallback specific to this call
   * @returns The operation result or fallback value
   */
  async execute<T>(
    operation: () => Promise<T>,
    overrideFallback?: () => T | Promise<T>,
  ): Promise<{ success: boolean; data: T; fallback: boolean; latency: number }> {
    const startTime = Date.now();

    // ─── Check state ───────────────────────────────────────────────
    if (this.state === 'OPEN') {
      const elapsedSinceOpen = this.openedAt ? Date.now() - this.openedAt : 0;
      if (elapsedSinceOpen >= this.cooldownMs && this.state === 'OPEN') {
        this.state = 'HALF_OPEN';
        console.log(`[CircuitBreaker:${this.name}] Cooldown elapsed → HALF_OPEN (allowing test request)`);
      } else {
        return this.fastFail(startTime, overrideFallback);
      }
    }

    // ─── Concurrency limit ─────────────────────────────────────────
    if (this.inFlight >= this.maxConcurrency) {
      console.warn(`[CircuitBreaker:${this.name}] Concurrency limit reached (${this.inFlight}/${this.maxConcurrency}) — fast-failing`);
      return this.fastFail(startTime, overrideFallback);
    }

    this.inFlight++;

    try {
      // ─── Execute with timeout ─────────────────────────────────────
      const result = await this.executeWithTimeout(operation);

      // ─── Success ──────────────────────────────────────────────────
      this.inFlight--;
      this.successCount++;
      this.failureCount = 0;

      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.openedAt = null;
        console.log(`[CircuitBreaker:${this.name}] Test request succeeded → CLOSED (fully recovered)`);
      }

      return {
        success: true,
        data: result,
        fallback: false,
        latency: Date.now() - startTime,
      };
    } catch (error: any) {
      // ─── Failure ──────────────────────────────────────────────────
      this.inFlight--;
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        console.log(`[CircuitBreaker:${this.name}] Test request failed → back to OPEN (${error.message})`);
      } else if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        console.error(
          `[CircuitBreaker:${this.name}] ${this.failureCount} consecutive failures → OPEN (tripped for ${this.cooldownMs}ms)`
        );
      }

      // Try fallback
      return this.fastFail(startTime, overrideFallback, error.message);
    }
  }

  /**
   * Force-reset the circuit breaker (e.g., from admin panel).
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.openedAt = null;
    console.log(`[CircuitBreaker:${this.name}] Force-reset to CLOSED`);
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      this.totalTimeouts++;
    }, this.timeoutMs);

    try {
      // We can't pass the signal to arbitrary operations, so we race
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Request timed out after ${this.timeoutMs}ms`));
          });
        }),
      ]);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private fastFail<T>(
    startTime: number,
    overrideFallback?: () => T | Promise<T>,
    errorMsg?: string,
  ): { success: boolean; data: T; fallback: boolean; latency: number } {
    const fallbackFn = overrideFallback ?? this.fallback;

    if (fallbackFn) {
      this.totalFallbacks++;
      const fallbackResult = fallbackFn();
      const latency = Date.now() - startTime;
      return {
        success: true,
        data: fallbackResult as T,
        fallback: true,
        latency,
      };
    }

    const latency = Date.now() - startTime;
    throw new Error(
      `[CircuitBreaker:${this.name}] ${this.state === 'OPEN' ? 'Circuit is OPEN — fast-failing' : 'Request rejected'}${errorMsg ? `: ${errorMsg}` : ''}`
    );
  }
}
