/**
 * QrStudioPage — printable QR ordering stickers (table / car / pickup).
 *
 * The customer QR site is served by the `customer-site/` app; every sticker is
 * a URL into it:  {qrBaseUrl}/#/{publicToken}?mode=table|car|pickup&ref=…
 * QR data URLs are rendered client-side with the `qrcode` package, so printing
 * works offline.
 *
 * Table stickers are generated PER-TABLE from the real database tables (never
 * hardcoded): the Tables section lists every table the restaurant created and
 * lets the cashier generate (or regenerate) that table's sticker individually.
 * Car / pickup stickers are created via "New sticker". Every QR can be printed
 * independently — each card has its own Print button.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft, Plus, Printer, Trash2, Loader2, RefreshCw, CheckCircle2, QrCode, Bell,
} from 'lucide-react';
import {
  fetchQrTokens, createQrToken, deleteQrToken,
  fetchWaiterRequests, completeWaiterRequest,
} from '../src/api/client';
import { getCurrentRestaurantId } from '../src/api/client';
import { fetchTables } from '../src/api/client';

type TokenRow = {
  _id?: string;
  id?: string;
  type: 'table' | 'car' | 'pickup';
  tableId?: string;
  tableNumber?: number | null;
  parkingSlot?: string | null;
  token: string;
  url: string;
};

type TableRow = { _id?: string; id?: string; number?: number | string; name?: string; status?: string; capacity?: number };

const TYPE_LABEL: Record<string, string> = { table: '🍽 Table', car: '🚗 Car', pickup: '🥡 Pickup' };
const REQUEST_LABEL: Record<string, string> = {
  WATER: '💧 Water', BILL: '🧾 Bill', ASSISTANCE: '🙋 Assistance',
  CLEANING: '🧻 Cleaning', CALL_WAITER: '🛎️ Call waiter', PLATE: '🍽 Plate', SPOON: '🥄 Spoon',
};

export default function QrStudioPage({ onBack }: { currencySymbol?: string; onBack: () => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [qrData, setQrData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTable, setBusyTable] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<{ type: 'car' | 'pickup'; parkingSlot: string }>({
    type: 'car', parkingSlot: '',
  });
  const [notice, setNotice] = useState('');
  const [requests, setRequests] = useState<any[]>([]);
  /** URLs selected for the next print job ([] = nothing; renders only those). */
  const [printTargets, setPrintTargets] = useState<string[]>([]);

  const restaurantId = useMemo(() => getCurrentRestaurantId(), []);

  const loadTokens = useCallback(async () => {
    const list = await fetchQrTokens();
    setTokens(list || []);
    setLoading(false);
    return list || [];
  }, []);

  const loadTables = useCallback(async () => {
    const list = await fetchTables();
    setTables(list || []);
  }, []);

  const loadRequests = useCallback(async () => {
    if (!restaurantId) return;
    const list = await fetchWaiterRequests({ restaurantId, status: 'PENDING' });
    setRequests(list || []);
  }, [restaurantId]);

  useEffect(() => {
    Promise.all([loadTokens(), loadTables(), loadRequests()]).catch(() => setLoading(false));
    const t = setInterval(loadRequests, 20000);
    return () => clearInterval(t);
  }, [loadTokens, loadTables, loadRequests]);

  /* Render QR data URLs client-side (works offline, no server round-trip). */
  useEffect(() => {
    let cancelled = false;
    tokens.forEach((t) => {
      if (qrData[t.url] || !t.url) return;
      QRCode.toDataURL(t.url, { width: 220, margin: 1, color: { dark: '#191b23', light: '#ffffff' } })
        .then((url) => { if (!cancelled) setQrData((prev) => ({ ...prev, [t.url]: url })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [tokens]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetLabel = (t: TokenRow) => {
    if (t.type === 'table') return `Table ${t.tableNumber ?? '?'}`;
    if (t.type === 'car') return t.parkingSlot ? `Slot ${t.parkingSlot}` : 'Car';
    return 'Pickup';
  };

  const sortedTables = useMemo(
    () => [...tables].sort((a, b) => Number(a.number || 0) - Number(b.number || 0)),
    [tables],
  );

  // Map tableId → sticker so the Tables section shows each DB table's QR.
  const tokenByTableId = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const t of tokens) if (t.type === 'table' && t.tableId) m.set(String(t.tableId), t);
    return m;
  }, [tokens]);

  const tableRows = useMemo(
    () =>
      sortedTables.map((t) => {
        const id = String(t._id || t.id || '');
        return { id, table: t, token: id ? tokenByTableId.get(id) : undefined };
      }),
    [sortedTables, tokenByTableId],
  );

  const otherTokens = useMemo(() => tokens.filter((t) => t.type !== 'table'), [tokens]);

  const create = async () => {
    if (busy) return;
    if (form.type === 'car' && !form.parkingSlot.trim()) { setNotice('Enter a parking slot label'); return; }
    setBusy(true);
    setNotice('');
    try {
      const body: any = { type: form.type };
      if (form.type === 'car') body.parkingSlot = form.parkingSlot.trim().toUpperCase();
      const res = await createQrToken(body);
      if (!res) setNotice('Could not create the sticker — is the backend online?');
      else setNotice('Sticker created ✓');
      setFormOpen(false);
      await loadTokens();
      setForm({ type: 'car', parkingSlot: '' });
    } finally {
      setBusy(false);
    }
  };

  /** Generate (or regenerate) the sticker for one real DB table. */
  const generateTable = async (tableId: string) => {
    if (busyTable) return;
    setBusyTable(tableId);
    setNotice('');
    try {
      const res = await createQrToken({ type: 'table', tableId });
      setNotice(res ? 'Table QR created ✓' : 'Could not create the QR — is the backend online?');
      await loadTokens();
    } finally {
      setBusyTable(null);
    }
  };

  const remove = async (t: TokenRow) => {
    const id = t._id || t.id;
    if (!id || !window.confirm('Remove this sticker?')) return;
    await deleteQrToken(id);
    await loadTokens();
  };

  const complete = async (id: string) => {
    await completeWaiterRequest(id);
    await loadRequests();
  };

  /** Print exactly the given stickers (independent per-QR printing). */
  const printStickers = (urls: string[]) => {
    setPrintTargets(urls);
    // Double rAF guarantees the selective print sheet has committed to the DOM
    // before the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const pendingCount = requests.length;
  const printSheetTokens = tokens.filter((t) => printTargets.includes(t.url));

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#faf8ff]">
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back"><ArrowLeft className="w-4 h-4" /></button>
        <span className="text-sm font-bold text-[#191b23]">QR Studio</span>
        <span className="text-[10px] text-gray-400 ml-auto">Print QR ordering stickers · customer-site v1</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {notice && <p className="text-xs font-semibold text-[var(--brand-color)]">{notice}</p>}

        {/* service requests (waiter bell) */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f0f0f5]">
            <Bell className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-[#191b23]">Customer service requests</span>
            {pendingCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">{pendingCount}</span>
            )}
            <button onClick={loadRequests} className="ml-auto p-1.5 text-gray-400 hover:text-[var(--brand-color)] rounded-lg transition-colors cursor-pointer" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
          {requests.length === 0 ? (
            <p className="px-5 py-4 text-xs text-gray-400">No pending requests — customers tapping the 🛎️ button appear here instantly.</p>
          ) : (
            <div className="divide-y divide-[#f0f0f5]">
              {requests.map((r: any) => (
                <div key={r._id} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-lg">{REQUEST_LABEL[r.type] || '🛎️ Request'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#191b23] truncate">
                      {r.orderType === 'TABLE' ? `Table ${r.tableId ? '' : '—'}` : r.orderType === 'CAR' ? `Car ${r.carId || ''}` : 'Pickup'}
                      {r.message && <span className="text-gray-400 font-normal"> · {r.message}</span>}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    onClick={() => complete(r._id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Done
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ TABLE STICKERS — driven by the real tables in the database ═══ */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-[#191b23]">Table stickers</h3>
            <span className="text-[10px] text-gray-400">
              One QR per table from your database — {tableRows.filter((r) => r.token).length} of {tableRows.length} generated
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : tableRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-[#e1e2ed] p-8 text-center">
              <span className="text-2xl">🪑</span>
              <p className="text-sm font-bold text-[#191b23] mt-2">No tables found</p>
              <p className="text-xs text-gray-400 mt-1">Add tables in the floor plan first — their QR stickers will appear here automatically.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {tableRows.map(({ id, table, token }) => (
                <div
                  key={id || `t_${table.number}`}
                  className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col items-center gap-2 ${
                    token ? 'border-[#e1e2ed]' : 'border-dashed border-[#e1e2ed]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-lg">🍽️</span>
                    <p className="text-sm font-bold text-[#191b23]">Table {table.number ?? table.name ?? '?'}</p>
                    {table.capacity ? <span className="ml-auto text-[9px] text-gray-400">Seats {table.capacity}</span> : null}
                  </div>

                  {token ? (
                    <>
                      {qrData[token.url] ? (
                        <img src={qrData[token.url]} alt={`QR Table ${table.number}`} className="w-32 h-32" />
                      ) : (
                        <div className="w-32 h-32 flex items-center justify-center text-gray-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-[#f4f2fb] text-[9px] font-mono text-purple-600">{token.token}</span>
                      <div className="flex items-center gap-1.5 w-full justify-center">
                        <button
                          onClick={() => printStickers([token.url])}
                          disabled={!qrData[token.url]}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--brand-color)] text-white text-[10px] font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                          title="Print just this QR"
                        >
                          <Printer className="w-3 h-3" /> Print
                        </button>
                        <button
                          onClick={() => generateTable(id)}
                          disabled={busyTable === id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#e1e2ed] text-[10px] font-bold text-gray-500 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
                          title="Regenerate this table's sticker"
                        >
                          {busyTable === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regen
                        </button>
                        <button
                          onClick={() => token && remove(token)}
                          className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-rose-500 transition-colors cursor-pointer"
                          title="Remove this sticker"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-32 h-32 flex flex-col items-center justify-center gap-1.5 bg-[#fafbfc] rounded-xl border border-dashed border-[#e1e2ed]">
                        <QrCode className="w-8 h-8 text-gray-300" />
                        <span className="text-[9px] text-gray-400">No QR yet</span>
                      </div>
                      <button
                        onClick={() => generateTable(id)}
                        disabled={busyTable === id}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                      >
                        {busyTable === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create QR
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ OTHER STICKERS (car / pickup) ═══ */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-[#191b23]">Car & pickup stickers</h3>
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#e1e2ed] text-xs font-bold text-[#191b23] hover:border-[var(--brand-color)] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New sticker
            </button>
          </div>

          {formOpen && (
            <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm p-5 space-y-3 mb-4">
              <p className="text-sm font-bold text-[#191b23]">New QR sticker</p>
              <div className="flex gap-2 flex-wrap">
                {(['car', 'pickup'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, type: t })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${form.type === t ? 'bg-[var(--brand-color)] text-white' : 'bg-[#f4f2fb] text-gray-500 hover:bg-[#ece9f7]'}`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              {form.type === 'car' && (
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">Parking slot label</p>
                  <input
                    className="w-full px-3 py-2 rounded-xl border border-[#e1e2ed] text-xs font-semibold text-[#191b23] uppercase"
                    placeholder="P1"
                    value={form.parkingSlot}
                    onChange={(e) => setForm({ ...form, parkingSlot: e.target.value })}
                  />
                </div>
              )}
              <button
                onClick={create}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                Generate QR
              </button>
            </div>
          )}

          {otherTokens.length === 0 ? (
            <p className="text-xs text-gray-400 bg-white rounded-xl border border-dashed border-[#e1e2ed] px-4 py-6 text-center">
              No car or pickup stickers yet — use <strong>New sticker</strong> above to add one.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {otherTokens.map((t) => (
                <div key={t._id || t.url} className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm p-4 flex flex-col items-center gap-2">
                  {qrData[t.url] ? (
                    <img src={qrData[t.url]} alt={`QR ${t.token}`} className="w-32 h-32" />
                  ) : (
                    <div className="w-32 h-32 flex items-center justify-center text-gray-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
                  )}
                  <p className="text-xs font-bold text-[#191b23]">{TYPE_LABEL[t.type]} · {targetLabel(t)}</p>
                  <span className="px-2 py-0.5 rounded-full bg-[#f4f2fb] text-[9px] font-mono text-purple-600">{t.token}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => printStickers([t.url])}
                      disabled={!qrData[t.url]}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--brand-color)] text-white text-[10px] font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                      title="Print just this QR"
                    >
                      <Printer className="w-3 h-3" /> Print
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* toolbar */}
        {tokens.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap sticky bottom-0 bg-[#faf8ff] py-2">
            <button
              onClick={() => printStickers(tokens.map((t) => t.url))}
              disabled={tokens.some((t) => !qrData[t.url])}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#e1e2ed] bg-white text-xs font-bold text-[#191b23] hover:border-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
              title={tokens.some((t) => !qrData[t.url]) ? 'Wait for all QR codes to render' : 'Print every sticker'}
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" /> Print all ({tokens.length})
            </button>
            <span className="text-[11px] text-gray-400">{tokens.length} stickers total</span>
          </div>
        )}
      </div>

      {/* print-only sticker sheet — renders ONLY the selected sticker(s) */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .qr-print-sheet, .qr-print-sheet * { visibility: visible !important; }
          .qr-print-sheet { position: fixed; inset: 0; display: grid !important; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 24px; }
          .qr-print-sticker { border: 1.5px dashed #999; border-radius: 12px; padding: 10px; text-align: center; page-break-inside: avoid; }
          .qr-print-sticker img { width: 128px; height: 128px; margin: 4px auto; }
          .qr-print-sticker .p-name { font-weight: 800; font-size: 13px; }
          .qr-print-sticker .p-target { font-weight: 600; font-size: 11px; margin: 2px 0; }
          .qr-print-sticker .p-scan { font-size: 9px; color: #555; }
        }
      `}</style>
      <div className="qr-print-sheet" style={{ display: 'none' }}>
        {printSheetTokens.map((t) => (
          <div key={`print-${t._id || t.url}`} className="qr-print-sticker">
            <div className="p-name">Scan to Order ⚡</div>
            {qrData[t.url] ? <img src={qrData[t.url]} alt="" /> : null}
            <div className="p-target">{TYPE_LABEL[t.type]} · {targetLabel(t)}</div>
            <div className="p-scan">{t.url}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
