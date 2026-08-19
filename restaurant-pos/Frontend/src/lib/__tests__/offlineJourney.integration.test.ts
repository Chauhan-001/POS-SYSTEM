/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline-journey integration test — real modules, mocked transport.
 *
 * Simulates the full journey a restaurant terminal goes through:
 *
 *   ONLINE → OFFLINE → BILL → RESTART → RECONNECT → REPLAY
 *
 * using the REAL SyncEngine + the REAL API client (writeOfflineAware queue,
 * executePendingOperation replay), with only `fetch` mocked. It asserts:
 *
 *   - the offline bill write never touches the network (it is queued),
 *   - the queued operation AND the local bill ledger survive a "restart"
 *     (fresh SyncEngine instance re-reading localStorage),
 *   - on reconnect the queue replays and the server receives EXACTLY ONE
 *     bill POST with UNCHANGED totals,
 *   - the local ledger still holds exactly one bill (replay never duplicates),
 *   - a queued bill is never dropped across restarts while the server is
 *     unreachable.
 *
 * Server-side idempotency (same clientRef ⇒ same bill, one document) is
 * proven against real MongoDB by the matching backend test in
 * backend/src/services/__tests__/billFinancialInvariants.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, syncEngine } from '../syncEngine';
import { createBill, executePendingOperation } from '../../api/client';
import { setDBData, getDBData } from '../../data';

const QUEUE_KEY = 'pos_sync_queue';

/** The bill a cashier completes while the terminal is offline. */
const offlineBill = {
  clientRef: 'offline_journey_001',
  invoiceNumber: 'INV-OFF-1001',
  ticketNumber: 'TK-1',
  date: '2026-08-17',
  time: '14:30',
  cashierName: 'Cashier A',
  items: [
    { id: 'row_1', product: { id: 'prod_1', name: 'Paneer', gstPercent: 5 }, productName: 'Paneer', quantity: 2, price: 280 },
  ],
  subtotal: 560,
  discount: 50,
  gst: 25.5,
  grandTotal: 535.5,
  paymentMethod: 'Cash',
  orderType: 'Dine In',
};

/** Successful server response for the replayed bill create. */
function okResponse(): Response {
  return new Response(JSON.stringify({ success: true, data: { id: 'bill_server_1', clientRef: offlineBill.clientRef } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Flip navigator.onLine (what isBrowserOffline() consults). */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

/** The bill POSTs the sync engine sent to the server. */
function billPosts(calls: unknown[][]): Array<{ url: string; body: any }> {
  return calls
    .filter((c: any) => String(c[0]).endsWith('/api/bills'))
    .map((c: any) => ({ url: String(c[0]), body: c[1]?.body ? JSON.parse(c[1].body) : null }));
}

describe('Offline journey — bill offline, restart, reconnect, replay', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Reset the app-wide singleton the API client enqueues into (fresh
    // SyncEngine instances below simulate the POS restart).
    syncEngine.clearQueue();
    setOnline(false);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bills offline, survives restart, and replays exactly once with unchanged totals', async () => {
    let accepted = 0; // bills the (mocked) server actually accepted (HTTP 200)
    // ── 1. BILL OFFLINE ──────────────────────────────────────────
    // The write never reaches the network; it is queued and persisted.
    const result = await createBill(offlineBill);
    expect(result).toBeNull(); // offline write returns null (queued)
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncEngine.getQueue()).toHaveLength(1);
    const queued = syncEngine.getQueue()[0];
    expect(queued.method).toBe('POST');
    expect(queued.path).toBe('/bills');
    expect((queued.body as any).clientRef).toBe('offline_journey_001');

    // The local ledger holds the completed bill (mirrors useBilling's
    // setDBData('pos_bills', ...) persistence).
    setDBData('pos_bills', [offlineBill]);

    // ── 2. RESTART — a fresh engine + app reload restore queue and ledger ──
    const restarted = new SyncEngine();
    restarted.setOnline(false); // device is still offline after boot
    expect(restarted.getQueue()).toHaveLength(1);
    const billsAfterRestart = getDBData<any[]>('pos_bills', []);
    expect(billsAfterRestart).toHaveLength(1);
    expect(billsAfterRestart[0].grandTotal).toBe(535.5);

    // ── 3. RECONNECT — offline→online arms the replay flag ───────
    setOnline(true);
    restarted.setOnline(true);
    expect(restarted.consumePendingReplay()).toBe(true);

    // ── 4. REPLAY — the server accepts the queued bill ───────────
    fetchMock.mockImplementation(() => { accepted++; return okResponse(); });
    const outcome = await restarted.replayQueue(executePendingOperation);
    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(restarted.getQueue()).toHaveLength(0);

    // ── ASSERT: exactly ONE bill reached the server, totals unchanged ──
    const posts = billPosts(fetchMock.mock.calls);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/bills');
    expect(accepted).toBe(1); // exactly one bill accepted server-side
    expect(posts[0].body.clientRef).toBe('offline_journey_001');
    expect(posts[0].body.subtotal).toBe(560);
    expect(posts[0].body.discount).toBe(50);
    expect(posts[0].body.gst).toBe(25.5);
    expect(posts[0].body.grandTotal).toBe(535.5);

    // Local ledger unchanged: still exactly one bill, same totals (no duplicate).
    const after = getDBData<any[]>('pos_bills', []);
    expect(after).toHaveLength(1);
    expect(after[0].grandTotal).toBe(535.5);
  });

  it('keeps the queued bill across restarts while the server is unreachable, then replays once', async () => {
    let accepted = 0; // bills the (mocked) server actually accepted (HTTP 200)
    await createBill(offlineBill);
    setDBData('pos_bills', [offlineBill]);

    // Restart #1 — server still down: replay fails, the op is KEPT (never dropped).
    let engine = new SyncEngine();
    setOnline(true);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 503 })));
    const firstTry = await engine.replayQueue(executePendingOperation);
    expect(firstTry).toEqual({ success: 0, failed: 1 });
    expect(engine.getQueue()).toHaveLength(1); // still queued, recoverable
    expect(getDBData<any[]>('pos_bills', [])).toHaveLength(1); // ledger intact

    // Restart #2 — server recovered: the same op replays once and drains.
    engine = new SyncEngine();
    expect(engine.getQueue()).toHaveLength(1); // survived the second restart
    fetchMock.mockImplementation(() => { accepted++; return okResponse(); });
    const secondTry = await engine.replayQueue(executePendingOperation);
    expect(secondTry).toEqual({ success: 1, failed: 0 });
    expect(engine.getQueue()).toHaveLength(0);

    // Exactly ONE accepted bill POST in the whole journey — the 503 attempt
    // was rejected and never created a bill server-side.
    expect(accepted).toBe(1);
    const posts = billPosts(fetchMock.mock.calls);
    const acceptedPosts = posts.filter((p) => p.body?.clientRef === 'offline_journey_001');
    expect(acceptedPosts).toHaveLength(2); // one rejected attempt + one accepted replay
    expect(acceptedPosts[1].body.grandTotal).toBe(535.5); // unchanged totals on replay
    expect(getDBData<any[]>('pos_bills', [])).toHaveLength(1);
  });
});
