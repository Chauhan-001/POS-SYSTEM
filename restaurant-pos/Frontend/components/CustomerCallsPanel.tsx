/**
 * CustomerCallsPanel — the POS "Calls" bell page.
 *
 * Lists pending customer service calls (table / car / pickup) LIVE — a new
 * call appears the instant the customer taps the 🛎️ button (socket push, no
 * refresh). Every call is actionable:
 *   - Acknowledge: mark it done (persisted server-side + removed here).
 *   - View (table calls): jump straight to that table's order/cart in Billing —
 *     exactly like tapping the table in Orders.
 *
 * QR Studio keeps ONLY QR codes; the bell lives here.
 */
import { useMemo } from 'react';
import RefreshButton from './common/RefreshButton';
import {
  ArrowLeft, Bell, CheckCheck, Eye, CheckCircle2, BellRing, Clock,
} from 'lucide-react';

export interface PendingCall {
  id: string;
  type: string;
  orderType: string; // TABLE | CAR | PICKUP
  tableId?: string;
  carId?: string;
  message?: string;
  branchId?: string | null;
  createdAt?: string;
  // Lifecycle — set once a call has been acknowledged.
  status?: string;
  // Silenced (SEEN) — reminder muted but the card stays live.
  seenAt?: string;
  seenBy?: string;
  completedAt?: string;
  completedBy?: string;
  // ONLINE_ORDER rows carry the underlying order so staff can open it.
  orderId?: string;
  orderNumber?: number | string;
  tableNumber?: number | string;
  grandTotal?: number;
  itemsCount?: number;
}

type TableRow = { _id?: string; id?: string; number?: number | string; name?: string };
/** Minimal order view needed to decide silence-vs-complete for online orders. */
type OrderRow = { _id?: string; id?: string; status?: string };

/** An order is resolved once its bill is closed (Paid/Closed) or the order is
 *  Cancelled/Refunded — at that point the online-order notification completes. */
export function isOrderResolvedStatus(status?: string): boolean {
  return status === 'Paid' || status === 'Closed' || status === 'Cancelled' || status === 'Refunded';
}

const TYPE_META: Record<string, { emoji: string; label: string; chip: string }> = {
  WATER: { emoji: '💧', label: 'Water', chip: 'bg-sky-50 text-sky-700 ring-sky-100' },
  BILL: { emoji: '🧾', label: 'Bill', chip: 'bg-amber-50 text-amber-700 ring-amber-100' },
  ASSISTANCE: { emoji: '🙋', label: 'Assistance', chip: 'bg-violet-50 text-violet-700 ring-violet-100' },
  CLEANING: { emoji: '🧻', label: 'Cleaning', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  CALL_WAITER: { emoji: '🛎️', label: 'Call waiter', chip: 'bg-rose-50 text-rose-700 ring-rose-100' },
  PLATE: { emoji: '🍽️', label: 'Plate', chip: 'bg-orange-50 text-orange-700 ring-orange-100' },
  SPOON: { emoji: '🥄', label: 'Spoon', chip: 'bg-orange-50 text-orange-700 ring-orange-100' },
  ONLINE_ORDER: { emoji: '🛍️', label: 'Online order', chip: 'bg-blue-50 text-blue-700 ring-blue-100' },
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Local wall-clock time for an ISO timestamp, e.g. "4:02 PM". */
function formatClock(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CustomerCallsPanel({
  calls,
  acknowledgedCalls = [],
  tables = [],
  orders = [],
  onBack,
  onRefresh,
  onAcknowledge,
  onAcknowledgeAll,
  onViewTable,
  onViewOrder,
}: {
  calls: PendingCall[];
  /** Recently acknowledged calls — kept on screen (with timestamps) so the cashier still has the record. */
  acknowledgedCalls?: PendingCall[];
  tables?: TableRow[];
  /** Live order list (polled + socket-pushed) — used to gate ONLINE_ORDER
   *  acknowledgment: a notification card is only actionable once that order's
   *  bill is closed (Paid/Closed). */
  orders?: OrderRow[];
  onBack: () => void;
  onRefresh: () => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
  onViewTable: (tableId: string) => void;
  onViewOrder?: (orderId: string) => void;
}) {
  const tableNumberById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tables) {
      const id = String(t._id || t.id || '');
      if (id) m.set(id, String(t.number ?? t.name ?? '?'));
    }
    return m;
  }, [tables]);

  // orderId → order status (live: the parent passes the polled/socket-pushed
  // order list, so a card's state flips automatically the moment a bill closes).
  const orderStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      const id = String(o._id || o.id || '');
      if (id) m.set(id, o.status || '');
    }
    return m;
  }, [orders]);

  /** True when this call is still ringing (not yet silenced). Acknowledge is
   *  ALWAYS clickable — for online orders with an open bill it silences the
   *  reminder (card stays live until the bill closes); otherwise it completes. */
  const isSilenced = (c: PendingCall): boolean => c.status === 'SEEN';
  /** Online order whose bill is still open — the card stays live until it closes. */
  const isAwaitingBillClose = (c: PendingCall): boolean =>
    c.type === 'ONLINE_ORDER' && !!c.orderId && !isOrderResolvedStatus(orderStatusById.get(c.orderId));

  // Newest call first; the newest row gets a subtle "fresh" highlight.
  const sorted = useMemo(
    () => [...calls].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [calls],
  );
  // Acknowledged calls stay visible as a record — newest completion first.
  const done = useMemo(
    () =>
      [...acknowledgedCalls].sort((a, b) =>
        String(b.completedAt || b.createdAt || '').localeCompare(String(a.completedAt || a.createdAt || '')),
      ),
    [acknowledgedCalls],
  );

  // Pending calls that are actionable via "Acknowledge all" — every pending
  // call qualifies (online orders with open bills get silenced, the rest are
  // completed), so show the bulk button whenever anything is pending.
  const acknowledgeable = useMemo(() => sorted, [sorted]);

  const locationLabel = (c: PendingCall): string => {
    if (c.type === 'ONLINE_ORDER') return `Order #${c.orderNumber ?? '…'}`;
    if (c.orderType === 'TABLE') return `Table ${c.tableId ? (tableNumberById.get(c.tableId) ?? '…') : '—'}`;
    if (c.orderType === 'CAR') return `Car ${c.carId || ''}`;
    return 'Pickup';
  };

  /** Secondary line for online orders: items count + bill amount. */
  const orderSub = (c: PendingCall): string | null => {
    if (c.type !== 'ONLINE_ORDER') return null;
    const parts: string[] = [];
    if (c.itemsCount) parts.push(`${c.itemsCount} item${c.itemsCount === 1 ? '' : 's'}`);
    if (typeof c.grandTotal === 'number') parts.push(`₹${c.grandTotal.toFixed(2)}`);
    if (c.tableNumber) parts.push(`Table ${c.tableNumber}`);
    return parts.length ? parts.join(' · ') : null;
  };

  const typeMeta = (type?: string) => TYPE_META[type || ''] || TYPE_META.CALL_WAITER;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--color-bg-page)]">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back"><ArrowLeft className="w-4 h-4" /></button>
        <Bell className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-bold text-[var(--color-text-primary)]">Customer calls</span>
        {sorted.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
            {sorted.length > 99 ? '99+' : sorted.length}
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto hidden sm:block">
          Rings live — no refresh needed
        </span>
        {acknowledgeable.length > 0 && (
          <button
            onClick={onAcknowledgeAll}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
            title="Silence every pending call — online orders stay until their bill closes, the rest complete"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Acknowledge all
          </button>
        )}
        <RefreshButton onRefresh={onRefresh} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] rounded-lg transition-colors" title="Refresh" />
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        {sorted.length === 0 && done.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <div className="w-16 h-16 rounded-3xl bg-[var(--color-bg-white)] border border-[var(--color-border-default)] flex items-center justify-center text-3xl shadow-sm">🛎️</div>
            <p className="text-sm font-bold text-[var(--color-text-primary)] mt-1">No calls yet</p>
            <p className="text-xs text-gray-400 max-w-xs">
              When a customer taps the bell on their QR page — table, car or pickup — it appears here instantly.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
          <section>
          {sorted.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pending</h3>
              <span className="text-[10px] font-bold text-gray-300">({sorted.length})</span>
            </div>
          )}
          <ul className="space-y-2.5">
            {sorted.map((c, idx) => {
              const meta = typeMeta(c.type);
              const isNewest = idx === 0;
              const isTable = c.orderType === 'TABLE';
              return (
                <li
                  key={c.id}
                  className={`bg-[var(--color-bg-white)] rounded-2xl border shadow-sm px-4 py-3 flex items-center gap-3 transition-shadow hover:shadow-md ${
                    isNewest ? 'border-amber-300 ring-2 ring-amber-100' : 'border-[var(--color-border-default)]'
                  }`}
                >
                  <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl ${meta.chip}`}>
                    {meta.emoji}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[var(--color-text-primary)]">{locationLabel(c)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ring-1 ${meta.chip}`}>{meta.label}</span>
                      {isNewest && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600">
                          <BellRing className="w-2.5 h-2.5 animate-pulse" /> NEW
                        </span>
                      )}
                    </div>
                    {orderSub(c) && <p className="text-[11px] font-semibold text-gray-600 mt-0.5">{orderSub(c)}</p>}
                    {c.message && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{c.message}</p>}
                    <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
                      <Clock className="w-2.5 h-2.5" /> {timeAgo(c.createdAt)}
                    </p>
                    {isAwaitingBillClose(c) && !isSilenced(c) && (
                      <p className="flex items-center gap-1 text-[10px] font-semibold text-sky-600 mt-1">
                        <Clock className="w-2.5 h-2.5" /> Acknowledge to silence the reminder — this card stays until the bill is closed
                      </p>
                    )}
                    {isAwaitingBillClose(c) && isSilenced(c) && (
                      <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 mt-1">
                        <CheckCircle2 className="w-3 h-3" /> Reminder silenced — clears when the bill is closed
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isTable && c.tableId && c.type !== 'ONLINE_ORDER' && (
                      <button
                        onClick={() => onViewTable(c.tableId as string)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                        title="Open this table's order / cart (same as tapping the table in Orders)"
                      >
                        <Eye className="w-3 h-3" /> View
                      </button>
                    )}
                    {c.type === 'ONLINE_ORDER' && c.orderId && onViewOrder && (
                      <button
                        onClick={() => onViewOrder(c.orderId as string)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                        title="Open this online order's bill / items"
                      >
                        <Eye className="w-3 h-3" /> View
                      </button>
                    )}
                    {isSilenced(c) && isAwaitingBillClose(c) ? (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold"
                        title="Reminder silenced — this card clears automatically when the bill is closed"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Silenced
                      </span>
                    ) : (
                      <button
                        onClick={() => onAcknowledge(c.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                        title={
                          isAwaitingBillClose(c)
                            ? 'Silence the reminder — this card stays until the bill is closed'
                            : 'Mark this call as handled'
                        }
                      >
                        <CheckCircle2 className="w-3 h-3" /> Acknowledge
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          </section>

          {/* Acknowledged — kept as a record with timestamps. */}
          {done.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Acknowledged</h3>
                <span className="text-[10px] font-bold text-gray-300">({done.length})</span>
              </div>
              <ul className="space-y-2.5">
                {done.map((c) => {
                  const meta = typeMeta(c.type);
                  return (
                    <li
                      key={c.id}
                      className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3"
                    >
                      <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl opacity-70 ${meta.chip}`}>
                        {meta.emoji}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-gray-500">{locationLabel(c)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ring-1 opacity-70 ${meta.chip}`}>{meta.label}</span>
                          {c.completedBy && (
                            <span className="text-[9px] font-semibold text-gray-400">by {c.completedBy}</span>
                          )}
                        </div>
                        {orderSub(c) && <p className="text-[11px] font-semibold text-gray-400 mt-0.5">{orderSub(c)}</p>}
                        {c.message && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{c.message}</p>}
                        <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
                          <Clock className="w-2.5 h-2.5" />
                          {c.completedAt
                            ? `Acknowledged ${formatClock(c.completedAt)}`
                            : `Acknowledged ${timeAgo(c.completedAt)}`}
                          {c.createdAt && <> · called {timeAgo(c.createdAt)}</>}
                        </p>
                      </div>

                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          </div>
        )}

        {sorted.length > 0 && (
          <p className="text-center text-[10px] text-gray-400 mt-4">
            Tip: <strong>View</strong> opens the table&apos;s bill or the online order directly — acknowledge once it&apos;s handled.
          </p>
        )}
      </div>
    </div>
  );
}
