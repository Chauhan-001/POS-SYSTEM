/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * aiQuotaPersistence.ts — MongoDB persistence for AI quota snapshots.
 *
 * The in-memory quota tracker (aiQuotaTracker.ts) is the fast read/write path.
 * This module mirrors each key's snapshot to MongoDB with a short debounce so
 * the admin dashboard quota cards survive backend restarts.
 *
 * SECURITY: raw API keys are never persisted — documents are keyed by a one-way
 * SHA-256 fingerprint and store only the masked label.
 */

import { createHash } from 'crypto';
import { AiQuotaSnapshot } from '../../../models';

// ─── Key fingerprinting ─────────────────────────────────────────────────

/** One-way fingerprint of an API key — safe to persist and match on. */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Mask a key for safe display: 'gsk_ab12…wxyz'. */
function maskKey(key: string): string {
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

// ─── Snapshot shape (matches the tracker's per-key entry) ──────────────

export interface QuotaSnapshotToPersist {
  key: string; // raw key — hashed before any storage
  index: number;
  isPrimary: boolean;
  /** Stored as modelName in Mongo (avoids the Document.model clash). */
  model: string;
  baseUrl: string;
  windows: { window: string; limit: number; remaining: number | null; resetSeconds: number | null }[];
  tokensUsedRuntime: number;
  rateLimitHits: number;
  lastRateLimitAt: string | null;
  lastUsedAt: string | null;
  parked: boolean;
  /** ISO timestamp of the last in-memory mutation (used for merge ordering). */
  changedAt: string;
}

// ─── Debounce machinery ────────────────────────────────────────────────

const DEBOUNCE_MS = 2_000;
const pending = new Map<string, { snapshot: QuotaSnapshotToPersist; timer: NodeJS.Timeout }>();

/** Schedule (or refresh) the debounced upsert for one key. Fire-and-forget. */
export function scheduleQuotaPersist(snapshot: QuotaSnapshotToPersist): void {
  const existing = pending.get(snapshot.key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(snapshot.key);
    void persistSnapshot(snapshot);
  }, DEBOUNCE_MS);
  timer.unref?.();
  pending.set(snapshot.key, { snapshot, timer });
}

/** Write one key's snapshot (upsert by fingerprint). Never throws. */
export async function persistSnapshot(snapshot: QuotaSnapshotToPersist): Promise<void> {
  try {
    await AiQuotaSnapshot.updateOne(
      { keyFingerprint: keyFingerprint(snapshot.key) },
      {
        $set: {
          label: maskKey(snapshot.key),
          index: snapshot.index,
          isPrimary: snapshot.isPrimary,
          modelName: snapshot.model,
          baseUrl: snapshot.baseUrl,
          windows: snapshot.windows,
          tokensUsedRuntime: snapshot.tokensUsedRuntime,
          rateLimitHits: snapshot.rateLimitHits,
          lastRateLimitAt: snapshot.lastRateLimitAt,
          lastUsedAt: snapshot.lastUsedAt,
          parked: snapshot.parked,
        },
      },
      { upsert: true },
    ).exec();
  } catch (err: any) {
    console.error('[AiQuotaPersistence] persist failed:', err?.message || err);
  }
}

// ─── Startup hydration ─────────────────────────────────────────────────

export interface LoadedQuotaSnapshot {
  keyFingerprint: string;
  label: string;
  index: number;
  isPrimary: boolean;
  /** Stored as modelName in Mongo — mapped back to `model` on load. */
  model: string;
  baseUrl: string;
  windows: { window: string; limit: number; remaining: number | null; resetSeconds: number | null }[];
  tokensUsedRuntime: number;
  rateLimitHits: number;
  lastRateLimitAt: string | null;
  lastUsedAt: string | null;
  parked: boolean;
  updatedAt: Date;
}

/** Load every persisted snapshot (best-effort; returns [] on any failure). */
export async function loadQuotaSnapshots(): Promise<LoadedQuotaSnapshot[]> {
  try {
    const docs = await AiQuotaSnapshot.find({}).lean().exec();
    return (docs || []).map((d: any) => ({
      keyFingerprint: d.keyFingerprint,
      label: d.label,
      index: d.index ?? 0,
      isPrimary: d.isPrimary ?? false,
      model: d.modelName ?? '',
      baseUrl: d.baseUrl ?? '',
      windows: d.windows ?? [],
      tokensUsedRuntime: d.tokensUsedRuntime ?? 0,
      rateLimitHits: d.rateLimitHits ?? 0,
      lastRateLimitAt: d.lastRateLimitAt ?? null,
      lastUsedAt: d.lastUsedAt ?? null,
      parked: d.parked ?? false,
      updatedAt: d.updatedAt,
    }));
  } catch (err: any) {
    console.error('[AiQuotaPersistence] load failed:', err?.message || err);
    return [];
  }
}

/** Remove persisted snapshots whose fingerprint no longer matches any configured key. */
export async function pruneQuotaSnapshots(keepFingerprints: string[]): Promise<void> {
  try {
    if (keepFingerprints.length === 0) return;
    await AiQuotaSnapshot.deleteMany({ keyFingerprint: { $nin: keepFingerprints } }).exec();
  } catch (err: any) {
    console.error('[AiQuotaPersistence] prune failed:', err?.message || err);
  }
}
