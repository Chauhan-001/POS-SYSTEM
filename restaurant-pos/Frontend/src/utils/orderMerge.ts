/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Monotonic merge of locally-held orders against a server snapshot.
 *
 * The POS treats local state as the source of truth and syncs every mutation
 * to the API with a fire-and-forget PUT. Background refreshes (the 30s poll,
 * socket-triggered refetches) then race those PUTs: a snapshot fetched before
 * a KOT status change commits can carry the OLD status, and blindly replacing
 * local state with it would regress a Served KOT back to Accepted — the order
 * reappears in the KDS "New Orders" column.
 *
 * The kitchen lifecycle is strictly monotonic (Accepted → Preparing → Ready →
 * Served, Cancelled is terminal), so a merge that never moves a KOT backward
 * and never moves an order backward through its derived status eliminates the
 * regression while still picking up genuine changes from other terminals
 * (new KOTs, adjustments, cancellations, closed/paid orders).
 */

import type { KOTRecord, Order } from '../types';
import { deriveOrderStatusFromKots } from '../hooks/useOrders';

/** KOT lifecycle rank — higher always wins; Cancelled is terminal (never regressed). */
const KOT_RANK: Record<string, number> = {
  Accepted: 0,
  Preparing: 1,
  Ready: 2,
  Served: 3,
};

/** Order statuses that are terminal/authoritative — a server snapshot always wins. */
const TERMINAL_ORDER_STATUSES = new Set([
  'Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Transferred', 'Merged', 'Split',
]);

/** Rank of the non-terminal lifecycle segment (used to avoid status regressions). */
const ORDER_RANK: Record<string, number> = {
  New: 0,
  Accepted: 1,
  Preparing: 2,
  Ready: 3,
  Served: 4,
  'Waiting Payment': 5,
};

function kotKey(kot: any): string {
  return String(kot?.kotNumber ?? kot?.id ?? '');
}

/**
 * Merge two KOT lists without ever regressing a KOT's lifecycle status.
 * - Matching KOTs (same kotNumber/id): the more-advanced status wins; a local
 *   Served is never overwritten by a stale server Accepted.
 * - Cancelled is terminal in both directions.
 * - KOTs seen only on one side are kept (a KOT added by another terminal, or
 *   a local KOT whose server write is still in flight).
 */
export function mergeKotRecords(local: KOTRecord[] | undefined, fresh: any[] | undefined): any[] {
  const localList = Array.isArray(local) ? local : [];
  const freshList = Array.isArray(fresh) ? fresh : [];
  if (localList.length === 0) return freshList;
  if (freshList.length === 0) return localList;

  const localByKey = new Map(localList.map(k => [kotKey(k), k]));
  const mergedKeys = new Set<string>();
  const out: any[] = [];

  for (const f of freshList) {
    const key = kotKey(f);
    mergedKeys.add(key);
    const l = localByKey.get(key);
    if (!l) { out.push(f); continue; }
    // Cancelled arrives from the server on KOT line cancellations even though
    // the local KOTStatus type only models the active lifecycle.
    const lStatus = String(l.status || '');
    const fStatus = String(f.status || '');
    if (lStatus === 'Cancelled' || fStatus === 'Cancelled') {
      // Terminal both ways: accept a server-side cancellation, keep a local one.
      out.push(lStatus === 'Cancelled' ? l : f);
      continue;
    }
    const lRank = KOT_RANK[lStatus] ?? 0;
    const fRank = KOT_RANK[fStatus] ?? 0;
    out.push(fRank >= lRank ? f : l);
  }

  // Local KOTs absent from the snapshot (server write still in flight, or the
  // snapshot predates it) — keep them; never drop a live KOT.
  for (const k of localList) {
    const key = kotKey(k);
    if (!mergedKeys.has(key)) out.push(k);
  }

  return out.sort((a, b) => (Number(a?.kotNumber) || 0) - (Number(b?.kotNumber) || 0));
}

/**
 * Merge a server order snapshot into the locally-held order.
 * Keeps items/timeline from the local copy when the snapshot omits them
 * (list rows embed kotRecords but items/timeline live in separate
 * collections), merges kotRecords monotonically, and never regresses the
 * order's lifecycle status.
 */
export function mergeOrderWithServer(local: Order, fresh: any): Order {
  const kotRecords = mergeKotRecords(local.kotRecords, fresh?.kotRecords);

  // Terminal statuses from the server are authoritative (paid/closed elsewhere).
  let status: Order['status'] = local.status;
  const freshStatus = fresh?.status as Order['status'] | undefined;
  if (freshStatus && TERMINAL_ORDER_STATUSES.has(freshStatus)) {
    status = freshStatus;
  } else if (freshStatus) {
    const lr = ORDER_RANK[local.status] ?? 0;
    const fr = ORDER_RANK[freshStatus] ?? 0;
    status = fr >= lr ? freshStatus : local.status;
  }
  // Re-derive from the merged KOTs (e.g. all served → Served) but never
  // override a terminal status.
  if (!TERMINAL_ORDER_STATUSES.has(status)) {
    status = deriveOrderStatusFromKots(kotRecords as KOTRecord[], status);
  }

  return {
    ...local,
    ...fresh,
    status,
    kotRecords,
    items: fresh?.items?.length ? fresh.items : local.items,
    timeline: fresh?.timeline?.length ? fresh.timeline : local.timeline,
  };
}

/**
 * Merge the full local orders array with a server list response.
 * - Orders present locally AND on the server: monotonic merge (above).
 * - Orders only on the server (created on another terminal): appended.
 * - Orders only locally: kept while the snapshot is empty (server hiccup),
 *   dropped on a real (non-empty) snapshot — the server is authoritative for
 *   order existence, matching the previous replace semantics.
 */
export function mergeOrdersWithServer(local: Order[] | any[], incoming: any[]): any[] {
  if (!Array.isArray(local)) local = [];
  if (!Array.isArray(incoming) || incoming.length === 0) return local;

  const incomingById = new Map(incoming.map((o: any) => [String(o._id || o.id), o]));
  const merged = local
    .filter((o: any) => {
      const id = String(o._id || o.id);
      return id && incomingById.has(id);
    })
    .map((o: any) => {
      const fresh = incomingById.get(String(o._id || o.id));
      return fresh ? mergeOrderWithServer(o, fresh) : o;
    });

  // Append orders the server knows but this terminal hasn't seen yet.
  for (const fresh of incoming) {
    const id = String(fresh._id || fresh.id);
    if (id && !merged.some((o: any) => String(o._id || o.id) === id)) {
      merged.push(fresh);
    }
  }
  return merged;
}
