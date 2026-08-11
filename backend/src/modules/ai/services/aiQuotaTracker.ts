/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * aiQuotaTracker.ts — Per-API-key LLM quota tracking (admin dashboard).
 *
 * Every LLM/STT provider call that hits an OpenAI-compatible endpoint (e.g.
 * Groq) returns rate-limit headers describing the per-key quota window
 * (`x-ratelimit-limit-tokens-per-day`, `x-ratelimit-remaining-*`, ...).
 * This module stores the latest snapshot per configured API key plus runtime
 * facts (last 429, last successful call, tokens observed) and exposes them in
 * an admin-safe, key-MASKED form — the raw key is never exposed.
 *
 * This is an in-memory observability store (process-lifetime). It is NOT a
 * billing source of truth — the durable record remains AIUsageLog.
 */

import { keyFingerprint, loadQuotaSnapshots, pruneQuotaSnapshots, scheduleQuotaPersist } from './aiQuotaPersistence';

// ─── Types ────────────────────────────────────────────────────────────

export interface QuotaWindow {
  /** Window label parsed from the header name, e.g. 'per-day', 'per-minute'. */
  window: string;
  limit: number;
  /** Null when the provider didn't report a remaining value for this window. */
  remaining: number | null;
  resetSeconds: number | null;
}

export interface QuotaKeyEntry {
  /** Position of this key in the configured chain (1 = primary). */
  index: number;
  /** Masked identifier — never the full key. */
  label: string;
  /** True when this key is the primary AI_API_KEY. */
  isPrimary: boolean;
  model: string;
  baseUrl: string;
  /** Latest rate-limit windows reported by the provider for this key. */
  windows: QuotaWindow[];
  /** Tokens used by this key since the backend started (observed in usage). */
  tokensUsedRuntime: number;
  /** Number of HTTP 429 responses observed on this key since startup. */
  rateLimitHits: number;
  /** ISO timestamp of the last 429 on this key (null if never). */
  lastRateLimitAt: string | null;
  /** ISO timestamp of the last successful call on this key. */
  lastUsedAt: string | null;
  /** True when the key is parked by the provider key-chain (429 cooldown). */
  parked: boolean;
}

export interface QuotaReport {
  enabled: boolean;
  provider: string;
  model: string;
  keys: QuotaKeyEntry[];
  /** ISO timestamp of the oldest snapshot in the report. */
  observedAt: string;
}

// ─── Header name helpers (Groq/OpenAI-compatible) ─────────────────────

const HEADER_PREFIX = 'x-ratelimit-';

/** Parse e.g. 'x-ratelimit-limit-tokens-per-day' -> { kind: 'limit', window: 'per-day' }. */
function parseHeaderName(name: string): { kind: 'limit' | 'remaining' | 'reset'; window: string } | null {
  const lower = name.toLowerCase();
  if (!lower.startsWith(HEADER_PREFIX)) return null;
  const rest = lower.slice(HEADER_PREFIX.length);
  // rest looks like 'limit-tokens-per-day' | 'remaining-requests' | 'reset-tokens'
  const match = rest.match(/^(limit|remaining|reset)-(tokens|requests)(-(.+))?$/);
  if (!match) return null;
  const kind = match[1] as 'limit' | 'remaining' | 'reset';
  const window = match[4] || 'per-minute';
  return { kind, window };
}

function toNumber(v: string | null): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert raw response headers into a quota snapshot for the given key.
 * Call this after every provider response (successful or 429) that carries
 * x-ratelimit-* headers.
 */
export function recordQuotaSnapshot(
  key: string,
  headers: Headers | Record<string, string>,
  meta: { model: string; baseUrl: string; success: boolean; status?: number },
): void {
  const h = headers instanceof Headers ? headers : new Headers(headers);
  const windows = new Map<string, { limit: number | null; remaining: number | null; resetSeconds: number | null }>();

  h.forEach((value, rawName) => {
    const parsed = parseHeaderName(rawName);
    if (!parsed) return;
    const entry = windows.get(parsed.window) || { limit: null, remaining: null, resetSeconds: null };
    if (parsed.kind === 'limit') entry.limit = toNumber(value);
    else if (parsed.kind === 'remaining') entry.remaining = toNumber(value);
    else if (parsed.kind === 'reset') {
      const secs = toNumber(value);
      // Groq sends '6s' style values for resets.
      entry.resetSeconds = secs !== null ? secs : parseInt(String(value).replace(/[^0-9]/g, ''), 10) || null;
    }
    windows.set(parsed.window, entry);
  });

  if (windows.size === 0) return;

  const entry = getOrCreateEntry(key, meta);
  const now = new Date();
  entry.windows = Array.from(windows.entries())
    .filter(([, w]) => w.limit !== null || w.remaining !== null)
    .map(([window, w]) => ({
      window,
      limit: w.limit ?? 0,
      remaining: w.remaining, // null when the provider didn't report it
      resetSeconds: w.resetSeconds,
    }));
  entry.observedAt = now.toISOString();

  if (meta.success) {
    entry.lastUsedAt = now.toISOString();
  } else if (meta.status === 429) {
    entry.rateLimitHits += 1;
    entry.lastRateLimitAt = now.toISOString();
    entry.parked = true;
  }
  persistEntry(entry);
}

/** Record tokens observed on a successful LLM response (usage.totalTokens). */
export function recordTokensUsed(key: string, tokens: number, meta: { model: string; baseUrl: string }): void {
  if (!tokens || tokens <= 0) return;
  const entry = getOrCreateEntry(key, meta);
  entry.tokensUsedRuntime += tokens;
  entry.observedAt = new Date().toISOString();
  persistEntry(entry);
}

/** Mark a key's 429-parked state (called by the provider key-chain when it parks a key). */
export function setKeyParked(key: string, parked: boolean, meta: { model: string; baseUrl: string }): void {
  const entry = getOrCreateEntry(key, meta);
  entry.parked = parked;
  persistEntry(entry);
}

/** Debounced MongoDB mirror of an entry (fire-and-forget). */
function persistEntry(entry: InternalEntry): void {
  // Only persist keys that are part of the configured chain — transient
  // options.apiKey keys (diagnostics, tests) never create lingering Mongo rows.
  if (!configuredChain().includes(entry.key)) return;
  scheduleQuotaPersist({
    key: entry.key,
    index: entry.index,
    isPrimary: entry.isPrimary,
    model: entry.model,
    baseUrl: entry.baseUrl,
    windows: entry.windows,
    tokensUsedRuntime: entry.tokensUsedRuntime,
    rateLimitHits: entry.rateLimitHits,
    lastRateLimitAt: entry.lastRateLimitAt,
    lastUsedAt: entry.lastUsedAt,
    parked: entry.parked,
    changedAt: entry.observedAt,
  });
}

/** Mask a key for safe display: 'gsk_ab12…wxyz'. */
function maskKey(key: string): string {
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

const PREFIX_MAP: Record<string, string> = {
  gsk_: 'Groq',
  sk: 'OpenAI',
  ska: 'Anthropic',
};

function keyKind(key: string): string {
  for (const [prefix, label] of Object.entries(PREFIX_MAP)) {
    if (key.startsWith(prefix)) return label;
  }
  return 'Custom';
}

// ─── Internal store ───────────────────────────────────────────────────

interface InternalEntry {
  key: string;
  index: number;
  isPrimary: boolean;
  model: string;
  baseUrl: string;
  windows: QuotaWindow[];
  tokensUsedRuntime: number;
  rateLimitHits: number;
  lastRateLimitAt: string | null;
  lastUsedAt: string | null;
  parked: boolean;
  observedAt: string;
}

const entries = new Map<string, InternalEntry>();

function getOrCreateEntry(key: string, meta: { model: string; baseUrl: string }): InternalEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      index: 0,
      isPrimary: false,
      model: meta.model,
      baseUrl: meta.baseUrl,
      windows: [],
      tokensUsedRuntime: 0,
      rateLimitHits: 0,
      lastRateLimitAt: null,
      lastUsedAt: null,
      parked: false,
      observedAt: new Date().toISOString(),
    };
    entries.set(key, entry);
  }
  return entry;
}

/**
 * Build the configured key chain from env — mirrors aiConfig.apiKeys but reads
 * process.env directly to avoid a circular import with config.ts. Dedupes so a
 * key accidentally listed twice can't mislabel roles in the quota report.
 */
function configuredChain(): string[] {
  return Array.from(new Set([
    process.env.AI_API_KEY || '',
    ...(process.env.AI_API_KEY_FALLBACKS || '').split(',').map((s) => s.trim()).filter(Boolean),
    process.env.AI_API_KEY_FALLBACK || '',
  ].filter(Boolean)));
}

/** Rebuild the index/isPrimary flags from the current configured chain. */
function refreshChainMeta(): void {
  const chain = configuredChain();
  // Pre-seed an entry for every configured key so the admin quota report shows
  // all keys (even ones that haven't made a call yet) with their index/role.
  chain.forEach((key) => {
    if (!entries.has(key)) {
      getOrCreateEntry(key, {
        model: process.env.AI_MODEL || '',
        baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
      });
    }
  });
  entries.forEach((entry) => {
    const idx = chain.indexOf(entry.key);
    entry.index = idx >= 0 ? idx + 1 : 0;
    entry.isPrimary = entry.key === (process.env.AI_API_KEY || '');
  });
}

/**
 * Admin-safe quota report. Key values are masked; indices reflect the
 * configured key chain (1 = primary, 2 = fallback, …). Only keys that are
 * part of the configured chain are reported — transient/unknown keys that
 * made a call (e.g. diagnostics) are filtered out.
 */
/**
 * Startup hydration: load persisted snapshots from MongoDB and merge them into
 * the in-memory store so quota history survives backend restarts. Only applied
 * to keys that are part of the configured chain; persisted rows for keys no
 * longer configured are pruned. Best-effort, never throws.
 *
 * MUST ONLY be called once at boot (before app.listen) — it applies persisted
 * data unconditionally and would clobber live updates if invoked mid-lifecycle.
 */
export async function hydrateQuotaFromDb(): Promise<void> {
  try {
    const snapshots = await loadQuotaSnapshots();
    const chain = configuredChain();
    const keepFingerprints = chain.map(keyFingerprint);
    if (keepFingerprints.length > 0) void pruneQuotaSnapshots(keepFingerprints);

    for (const snap of snapshots) {
      // Re-link persisted snapshot to the matching configured key.
      const matchedKey = chain.find((k) => keyFingerprint(k) === snap.keyFingerprint);
      if (!matchedKey) continue;
      const entry = getOrCreateEntry(matchedKey, { model: snap.model || process.env.AI_MODEL || '', baseUrl: snap.baseUrl });
      // Hydration runs at startup when the in-memory store is empty, so the
      // persisted snapshot is applied unconditionally (it IS the history). Any
      // live calls after boot will refresh it with newer data.
      const persistedAt = new Date(snap.updatedAt).getTime();
      entry.windows = snap.windows;
      entry.tokensUsedRuntime = snap.tokensUsedRuntime;
      entry.rateLimitHits = snap.rateLimitHits;
      entry.lastRateLimitAt = snap.lastRateLimitAt;
      entry.lastUsedAt = snap.lastUsedAt;
      entry.parked = snap.parked;
      if (Number.isFinite(persistedAt)) entry.observedAt = new Date(persistedAt).toISOString();
    }
  } catch (err: any) {
    console.error('[AiQuotaTracker] hydrate failed:', err?.message || err);
  }
}

export function getQuotaReport(): QuotaReport {
  refreshChainMeta();
  const keys: QuotaKeyEntry[] = Array.from(entries.values())
    .filter((e) => e.index > 0)
    .sort((a, b) => a.index - b.index)
    .map((e) => ({
      index: e.index,
      label: maskKey(e.key),
      isPrimary: e.isPrimary,
      model: e.model,
      baseUrl: e.baseUrl,
      windows: e.windows,
      tokensUsedRuntime: e.tokensUsedRuntime,
      rateLimitHits: e.rateLimitHits,
      lastRateLimitAt: e.lastRateLimitAt,
      lastUsedAt: e.lastUsedAt,
      parked: e.parked,
    }));

  const primaryKey = process.env.AI_API_KEY || '';

  return {
    enabled: Boolean(primaryKey),
    provider: process.env.AI_PROVIDER || 'not configured',
    model: process.env.AI_MODEL || '',
    keys,
    observedAt: new Date().toISOString(),
  };
}
