/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sessionSweeper.ts — QR ordering seat-session expiry sweeper.
 *
 * A customer who scans a table QR claims the table for their seating. The
 * claim carries an expiresAt (10-minute TTL, extended by heartbeats on real
 * activity). If the guest never orders and stops interacting, the claim must
 * expire so the table is NOT left Occupied for no reason.
 *
 * This sweeper is the global expiry engine: it marks every lapsed ACTIVE
 * claim EXPIRED and re-reconciles its table through the authoritative
 * TableStateService, which frees the table (Available) only if no live order
 * or reservation holds it. A table with a placed order is never touched —
 * once the order exists, occupancy is owned by the order, not the claim.
 *
 * The scheduler is opt-in (started from server.ts) and never runs in tests.
 */

import QROrderingSession from '../models/QROrderingSession';

/**
 * Expire every ACTIVE seat-claim whose TTL has lapsed, then release any
 * tables they were holding (best-effort — never touches a table with a live
 * order). Returns counts for logging/tests.
 */
export async function sweepExpiredSessions(): Promise<{ expired: number; freedTables: number }> {
  const now = new Date();
  const expired = await QROrderingSession.find({
    status: 'ACTIVE',
    expiresAt: { $lt: now },
  })
    .select({ tableId: 1 })
    .lean()
    .exec();

  if (expired.length === 0) return { expired: 0, freedTables: 0 };

  // Unique table ids touched by the expired claims.
  const tableIds = [
    ...new Set(
      expired
        .map((s) => (s.tableId ? String(s.tableId) : null))
        .filter(Boolean) as string[]
    ),
  ];

  await QROrderingSession.updateMany(
    { status: 'ACTIVE', expiresAt: { $lt: now } },
    { $set: { status: 'EXPIRED' } }
  ).exec();

  // Re-reconcile each affected table: with no ACTIVE claim (and no order /
  // reservation) the authoritative state machine frees it. A table with a
  // placed order stays Occupied — that's the "no expiry after order" rule.
  const { tableStateService } = await import('../../../services');
  let freedTables = 0;
  for (const tid of tableIds) {
    const table = await tableStateService
      .reconcileTable(tid, { operator: 'System' })
      .catch(() => null);
    if (table && String(table.status) === 'Available') freedTables++;
  }

  return { expired: expired.length, freedTables };
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic sweeper (default: every 60s). Idempotent. */
export function startSessionSweeper(intervalMs = 60_000): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    sweepExpiredSessions()
      .then((res) => {
        if (res.expired > 0) {
          console.log(`[QR] expired ${res.expired} seat-session(s), freed ${res.freedTables} table(s)`);
        }
      })
      .catch((err) => console.warn('[QR] seat-session sweep failed:', err?.message));
  }, intervalMs);
  if (typeof sweeperTimer === 'object' && 'unref' in sweeperTimer) sweeperTimer.unref();
}

/** Stop the sweeper (used by tests). */
export function stopSessionSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
