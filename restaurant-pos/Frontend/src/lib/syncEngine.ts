/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync engine for POS state synchronization across tabs/windows.
 * Tracks stale data keys and triggers re-fetch when coming online.
 *
 * Offline Queue:
 *   Failed write operations (POST, PUT, DELETE) are queued with full
 *   request details, persisted to localStorage, and automatically
 *   replayed when connectivity is restored. Each queue entry has a
 *   max retry count and timestamp for staleness checking.
 */

type Listener = () => void;

interface SyncState {
  lastSynced: string | null;
  online: boolean;
  pendingChanges: number;
}

/** A persisted write operation to be replayed when back online */
export interface PendingOperation {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  createdAt: string;
  retries: number;
  maxRetries: number;
  error?: string;
  /**
   * Reached maxRetries without success. The operation is KEPT (never silently
   * dropped — an offline bill must not vanish from the queue) but is excluded
   * from automatic replays until the operator explicitly retries or clears it
   * from the Sync panel.
   */
  stalled?: boolean;
}

const QUEUE_KEY = 'pos_sync_queue';
const MAX_RETRIES = 5;
const MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — discard stale entries

export class SyncEngine {
  private listeners: Set<Listener> = new Set();
  private syncState: SyncState = {
    lastSynced: null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingChanges: 0,
  };
  private staleKeys: Set<string> = new Set();
  /** Cache the last returned SyncState to provide stable references when nothing changed */
  private lastStateSnapshot: SyncState | null = null;
  /** Flag set when transitioning from offline→online, consumed by the React subscriber */
  private _pendingReplay = false;

  // ─── Persisted offline queue ─────────────────────────────────
  private queue: PendingOperation[] = [];

  constructor() {
    this.loadQueue();
  }

  /** Load persisted queue from localStorage (crash recovery) */
  private loadQueue(): void {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PendingOperation[];
        if (Array.isArray(parsed)) {
          // Discard entries older than MAX_RETENTION_MS
          const cutoff = Date.now() - MAX_RETENTION_MS;
          this.queue = parsed.filter(op => new Date(op.createdAt).getTime() > cutoff);
          this.syncState.pendingChanges = this.queue.length;
        }
      }
    } catch {
      this.queue = [];
    }
  }

  /** Persist queue to localStorage (writes through on every mutation) */
  private saveQueue(): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      // localStorage quota exceeded — silently drop stale entries
      this.queue = this.queue.slice(-20); // keep last 20
      try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue)); } catch { /* give up */ }
    }
  }

  // ─── Public Queue API ────────────────────────────────────────

  /** Enqueue a write operation to be replayed when online */
  enqueue(op: Omit<PendingOperation, 'id' | 'createdAt' | 'retries' | 'maxRetries'>): void {
    const entry: PendingOperation = {
      ...op,
      id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: MAX_RETRIES,
    };
    this.queue.push(entry);
    this.syncState.pendingChanges = this.queue.length;
    this.saveQueue();
    this.notify();
  }

  /** Get all pending operations */
  getQueue(): ReadonlyArray<PendingOperation> {
    return this.queue;
  }

  /**
   * Drop EVERY queued operation (memory + persisted). Called when the logged-in
   * RESTAURANT changes on this device: a previous tenant's offline writes must
   * never replay into a different restaurant's account, and stale queued ops
   * must never be retried against the new tenant.
   */
  clearQueue(): void {
    this.queue = [];
    this.syncState.pendingChanges = 0;
    try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
    this.notify();
  }

  /** Mark an operation as completed (remove from queue) */
  dequeue(id: string): void {
    this.queue = this.queue.filter(op => op.id !== id);
    this.syncState.pendingChanges = this.queue.length;
    this.saveQueue();
    this.notify();
  }

  /** Increment retry count for an operation */
  markRetry(id: string, error?: string): void {
    const op = this.queue.find(o => o.id === id);
    if (op) {
      op.retries++;
      op.error = error;
      if (op.retries >= op.maxRetries) {
        // Phase 5 — NEVER silently drop a persisted write. A completed offline
        // bill (or refund/void) that stopped syncing must remain visible and
        // recoverable — otherwise the terminal shows it as synced while the
        // server (and every server-side report) never receives it. Stall it:
        // excluded from auto-replay, surfaced in the Sync panel for a manual
        // Retry or Clear.
        op.stalled = true;
        console.warn('[SyncEngine] Operation stalled after max retries (kept for manual action):', op.method, op.path);
        this.saveQueue();
        this.notify();
      } else {
        this.saveQueue();
        this.notify();
      }
    }
  }

  /** Manually retry a stalled operation (resets its retry budget). */
  retryNow(id: string): void {
    const op = this.queue.find(o => o.id === id);
    if (op) {
      op.retries = 0;
      op.error = undefined;
      op.stalled = false;
      this.saveQueue();
      this.notify();
    }
  }

  /** Manually discard a stalled operation (operator's explicit decision). */
  clearOperation(id: string): void {
    const op = this.queue.find(o => o.id === id);
    if (op) {
      console.warn('[SyncEngine] Operation cleared by operator:', op.method, op.path);
      this.dequeue(id);
    }
  }

  /** Replay all queued operations against the API. Returns results. */
  async replayQueue(fetcher: (op: PendingOperation) => Promise<boolean>): Promise<{ success: number; failed: number }> {
    const snapshot = [...this.queue];
    let success = 0;
    let failed = 0;

    for (const op of snapshot) {
      // Stalled operations wait for explicit operator action (Retry/Clear in
      // the Sync panel) — never burn automatic retries on them again.
      if (op.stalled) continue;
      try {
        const ok = await fetcher(op);
        if (ok) {
          this.dequeue(op.id);
          success++;
        } else {
          this.markRetry(op.id, 'API returned error');
          failed++;
        }
      } catch (err: any) {
        this.markRetry(op.id, err?.message || 'Network error');
        failed++;
      }
    }

    return { success, failed };
  }

  // ─── Sync State ──────────────────────────────────────────────

  getSyncState(): SyncState {
    const s = this.syncState;
    if (
      this.lastStateSnapshot &&
      this.lastStateSnapshot.lastSynced === s.lastSynced &&
      this.lastStateSnapshot.online === s.online &&
      this.lastStateSnapshot.pendingChanges === s.pendingChanges
    ) {
      return this.lastStateSnapshot;
    }
    this.lastStateSnapshot = { ...s };
    return this.lastStateSnapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  sync(): void {
    this.syncState.lastSynced = new Date().toISOString();
    this.staleKeys.clear();
    this.notify();
  }

  markPending(): void {
    this.syncState.pendingChanges++;
    this.notify();
  }

  /** Mark a specific entity type as needing re-fetch from API */
  markStale(entityType: string): void {
    this.staleKeys.add(entityType);
    this.notify();
  }

  /** Check and consume the pending-replay flag. Returns true once per reconnect. */
  consumePendingReplay(): boolean {
    if (this._pendingReplay) {
      this._pendingReplay = false;
      return true;
    }
    return false;
  }

  /** Return all stale entity keys and clear the set */
  consumeStaleKeys(): string[] {
    const keys = Array.from(this.staleKeys);
    this.staleKeys.clear();
    return keys;
  }

  setOnline(online: boolean): void {
    const wasOffline = !this.syncState.online;
    this.syncState.online = online;
    if (online && wasOffline) {
      this._pendingReplay = true;
      this.sync();
    } else {
      this.notify();
    }
  }
}

export const syncEngine = new SyncEngine();
