/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContextManager — In-memory conversation context store for multi-turn
 * voice inventory conversations.
 *
 * Each restaurant+employee can have one active conversation at a time.
 * Conversations auto-expire after 30 minutes of inactivity.
 *
 * Architecture:
 *   ConversationManager → ContextManager → { LRU Map with TTL }
 *
 * The store is in-process memory (not Redis) to keep latency <2ms per lookup
 * and avoid network calls. For horizontal scale, swap in a Redis adapter.
 *
 * Security:
 *   - All conversation data is ephemeral (never persisted to disk).
 *   - Context is scoped to (restaurantId, employeeId) pairs.
 *   - TTL auto-expiry ensures stale contexts don't accumulate.
 */

import type { ConversationState, ConversationTurn } from '../types';
import crypto from 'crypto';

// ====================================================================
// TYPES
// ====================================================================

interface ContextEntry {
  state: ConversationState;
  expiresAt: number; // epoch ms
}

// ====================================================================
// CONFIGURATION
// ====================================================================

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 20;
const MAX_CONVERSATIONS = 1000; // Hard cap to prevent memory leak

// ====================================================================
// IN-MEMORY STORE
// ====================================================================

/**
 * Map keyed by `${restaurantId}:${employeeId}` for quick lookup.
 * Using a plain Map (not LRU) since TTL-based expiry replaces LRU eviction.
 */
const store = new Map<string, ContextEntry>();

// ─── Periodic cleanup ──────────────────────────────────────────────

/** Run cleanup every 5 minutes. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
    // If still over limit after TTL expiry, evict oldest entries.
    if (store.size > MAX_CONVERSATIONS) {
      const sorted = [...store.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt
      );
      const toDelete = sorted.slice(0, store.size - MAX_CONVERSATIONS);
      for (const [key] of toDelete) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is still active.
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

startCleanup();

// ====================================================================
// PUBLIC API
// ====================================================================

/**
 * Create a new conversation context.
 * If an active conversation already exists for this (restaurantId, employeeId),
 * it is returned instead (you can force a new one by calling destroy() first).
 */
export function createContext(
  restaurantId: string,
  employeeId?: string,
  employeeName?: string
): ConversationState {
  const key = buildKey(restaurantId, employeeId);
  const existing = store.get(key);
  if (existing && existing.expiresAt > Date.now() && !existing.state.completed) {
    return existing.state;
  }

  const conversationId = crypto.randomUUID();
  const now = new Date();
  const state: ConversationState = {
    conversationId,
    restaurantId,
    employeeId,
    employeeName,
    missingFields: [],
    turnHistory: [],
    startedAt: now,
    lastActiveAt: now,
    completed: false,
    totalLatencyMs: 0,
  };

  store.set(key, {
    state,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });

  return state;
}

/**
 * Get the active conversation for a restaurant+employee pair.
 * Returns null if no active conversation exists or it has expired.
 */
export function getContext(
  restaurantId: string,
  employeeId?: string
): ConversationState | null {
  const key = buildKey(restaurantId, employeeId);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.state;
}

/**
 * Get a conversation by its ID (cross-employee lookup, e.g. for admin queries).
 */
export function getContextById(conversationId: string): ConversationState | null {
  for (const [, entry] of store) {
    if (entry.state.conversationId === conversationId && entry.expiresAt > Date.now()) {
      return entry.state;
    }
  }
  return null;
}

/**
 * Add a turn to the conversation and update the TTL.
 */
export function addTurn(
  restaurantId: string,
  employeeId: string | undefined,
  turn: ConversationTurn
): ConversationState | null {
  const state = getContext(restaurantId, employeeId);
  if (!state) return null;

  state.turnHistory.push(turn);
  if (state.turnHistory.length > MAX_TURNS) {
    state.turnHistory = state.turnHistory.slice(-MAX_TURNS);
  }
  state.lastActiveAt = new Date();

  // Refresh TTL.
  const key = buildKey(restaurantId, employeeId);
  const entry = store.get(key);
  if (entry) {
    entry.expiresAt = Date.now() + DEFAULT_TTL_MS;
  }

  return state;
}

/**
 * Update the conversation state (partial update).
 */
export function updateContext(
  restaurantId: string,
  employeeId: string | undefined,
  updates: Partial<ConversationState>
): ConversationState | null {
  const state = getContext(restaurantId, employeeId);
  if (!state) return null;

  Object.assign(state, updates);
  state.lastActiveAt = new Date();

  // Refresh TTL.
  const key = buildKey(restaurantId, employeeId);
  const entry = store.get(key);
  if (entry) {
    entry.expiresAt = Date.now() + DEFAULT_TTL_MS;
  }

  return state;
}

/**
 * Mark the conversation as completed and optionally set the final action.
 */
export function completeContext(
  restaurantId: string,
  employeeId: string | undefined,
  finalAction: 'confirmed' | 'cancelled' | 'expired'
): void {
  const state = getContext(restaurantId, employeeId);
  if (!state) return;

  state.completed = true;
  state.finalAction = finalAction;
  state.lastActiveAt = new Date();

  // Short TTL so it stays for a moment (for final UI render) then cleans up.
  const key = buildKey(restaurantId, employeeId);
  const entry = store.get(key);
  if (entry) {
    entry.expiresAt = Date.now() + 60_000; // 1 minute for final display
  }
}

/**
 * Force-destroy a conversation context.
 */
export function destroyContext(
  restaurantId: string,
  employeeId?: string
): void {
  const key = buildKey(restaurantId, employeeId);
  store.delete(key);
}

/**
 * Get the number of active conversations (for monitoring).
 */
export function getActiveCount(): number {
  const now = Date.now();
  let count = 0;
  for (const [, entry] of store) {
    if (entry.expiresAt > now) count++;
  }
  return count;
}

// ====================================================================
// HELPERS
// ====================================================================

function buildKey(restaurantId: string, employeeId?: string): string {
  return `${restaurantId}:${employeeId || 'anonymous'}`;
}

