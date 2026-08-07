/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * jobs.ts — Nightly report snapshot + inactive-restaurant maintenance jobs.
 *
 * Mirrors the audit retention scheduler: a `setInterval` whose handle is
 * `unref()`ed so it never keeps the process alive, started from `server.ts`,
 * and idempotent (a guard prevents double-start in tests / hot reloads).
 */

import { InactiveRestaurantSnapshot, ReportSnapshot } from '../models';
import { adminReportingService } from '../adminReportingService';

let snapshotTimer: ReturnType<typeof setInterval> | null = null;

export type SnapshotKind = 'growth' | 'revenue' | 'usage' | 'feature' | 'subscription' | 'ai_revenue';

/** Persist a per-kind daily snapshot under {date:period}. */
export async function writeSnapshot(kind: SnapshotKind, payload: Record<string, unknown>): Promise<void> {
  const todayKey = new Date().toISOString().slice(0, 10);
  try {
    await ReportSnapshot.updateOne(
      { kind, period: todayKey },
      { $set: { kind, period: todayKey, snapshotDate: new Date(), payload } },
      { upsert: true },
    );
  } catch (err) {
    console.warn(`[report-job] snapshot ${kind} failed:`, (err as Error)?.message);
  }
}

/** Run every configured snapshot generation once (used by the scheduler). */
export async function runNightlySnapshots(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  const tasks: Array<[SnapshotKind, () => Promise<unknown>]> = [
    ['growth', () => adminReportingService.growth({ period: 'this_month' })],
    ['revenue', () => adminReportingService.revenue({ period: 'this_month' })],
    ['subscription', () => adminReportingService.subscriptions({ period: 'this_month' })],
    ['ai_revenue', () => adminReportingService.aiRevenue({ period: 'this_month' })],
    ['usage', () => adminReportingService.usage({ period: 'this_month' })],
    ['feature', () => adminReportingService.features({ period: 'this_month' })],
  ];
  for (const [kind, fn] of tasks) {
    try {
      const payload = await fn() as Record<string, unknown>;
      await writeSnapshot(kind, payload);
      result[kind] = true;
    } catch (err) {
      result[kind] = false;
      console.warn(`[report-job] nightly ${kind}:`, (err as Error)?.message);
    }
  }
  return result;
}

/** Persist the daily inactive-restaurant snapshot. */
export async function runInactiveSnapshotJob(thresholdDays = 30): Promise<void> {
  try {
    const payload = await adminReportingService.runInactiveSnapshot();
    await InactiveRestaurantSnapshot.deleteOne({ snapshotDate: payload.snapshotDate });
    await InactiveRestaurantSnapshot.create(payload);
  } catch (err) {
    console.warn('[report-job] inactive snapshot failed:', (err as Error)?.message);
  }
}

const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Start the nightly jobs. Idempotent; `unref()` so tests / the server can shut
 * down cleanly. First run after `initialDelayMs` (default 60s) to avoid racing
 * the server boot.
 */
export function startReportScheduler(initialDelayMs = 60_000): void {
  if (snapshotTimer) return;
  const schedule = () => {
    runNightlySnapshots().catch(() => {});
    runInactiveSnapshotJob().catch(() => {});
  };
  const first = setTimeout(schedule, initialDelayMs);
  if (typeof first === 'object' && 'unref' in first) first.unref();
  snapshotTimer = setInterval(schedule, SNAPSHOT_INTERVAL_MS);
  if (typeof snapshotTimer === 'object' && 'unref' in snapshotTimer) snapshotTimer.unref();
}

/** Stop the scheduler (used by tests). */
export function stopReportScheduler(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

export function snapshotTimerState(): boolean {
  return snapshotTimer !== null;
}