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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft, Plus, Printer, Trash2, Loader2, RefreshCw, QrCode, X, Lock,
  Share2, AlertTriangle,
} from 'lucide-react';
import {
  fetchQrTokens, createQrToken, deleteQrToken, seedQrTokens,
} from '../src/api/client';
import { fetchTables } from '../src/api/client';

type TokenRow = {
  _id?: string;
  id?: string;
  type: 'table' | 'car' | 'pickup';
  tableId?: string;
  tableNumber?: number | null;
  parkingSlot?: string | null;
  branchId?: string | null;
  token: string;
  url: string;
};

type TableRow = { _id?: string; id?: string; number?: number | string; name?: string; status?: string; capacity?: number; branchId?: string | null };

const TYPE_LABEL: Record<string, string> = { table: '🍽 Table', car: '🚗 Car', pickup: '🥡 Pickup' };

export default function QrStudioPage({
  currentBranchId,
  isMultiBranch,
  branchName,
  onBack,
}: {
  currencySymbol?: string;
  /** Selected branch from the top bar — scopes table stickers like the floor plan. */
  currentBranchId?: string | null;
  isMultiBranch?: boolean;
  branchName?: string;
  onBack: () => void;
}) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [qrData, setQrData] = useState<Record<string, string>>({});
  /** urls whose QR generation failed (renders an error + Retry instead of a stuck spinner). */
  const [qrErrors, setQrErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTable, setBusyTable] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<{ type: 'car' | 'pickup'; parkingSlot: string }>({
    type: 'car', parkingSlot: '',
  });
  const [notice, setNotice] = useState('');
  /** Auto-backfill in progress (missing table stickers are being generated). */
  const [seeding, setSeeding] = useState(false);
  /** URLs selected for the next print job ([] = nothing; renders only those). */
  const [printTargets, setPrintTargets] = useState<string[]>([]);
  /** Regeneration password gate — regen invalidates the printed QR, so it
   *  needs the current user's password (verified server-side). */
  const [regenTarget, setRegenTarget] = useState<{ tableId: string; tableLabel: string } | null>(null);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenError, setRegenError] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

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

  useEffect(() => {
    Promise.all([loadTokens(), loadTables()]).catch(() => setLoading(false));
  }, [loadTokens, loadTables]);

  // Branch switched (top-bar selector) — re-pull tables/tokens from the
  // backend instead of reusing the previous branch's state. fetchTables /
  // fetchQrTokens always hit the API (no local cache), so this guarantees the
  // new branch's stickers (and any table added/removed there) are fresh.
  const loadedBranchRef = useRef<string | null>(currentBranchId ?? null);
  useEffect(() => {
    if (loadedBranchRef.current === (currentBranchId ?? null)) return;
    loadedBranchRef.current = currentBranchId ?? null;
    setLoading(true);
    Promise.all([loadTokens(), loadTables()]).catch(() => setLoading(false));
  }, [currentBranchId, loadTokens, loadTables]);

  /* Render QR data URLs client-side (works offline, no server round-trip). */
  useEffect(() => {
    let cancelled = false;
    tokens.forEach((t) => {
      if (!t.url || qrData[t.url] || qrErrors[t.url]) return;
      QRCode.toDataURL(t.url, { width: 220, margin: 1, color: { dark: '#191b23', light: '#ffffff' } })
        .then((url) => { if (!cancelled) setQrData((prev) => ({ ...prev, [t.url]: url })); })
        .catch(() => { if (!cancelled) setQrErrors((prev) => ({ ...prev, [t.url]: true })); });
    });
    return () => { cancelled = true; };
  }, [tokens]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-render one QR after a generation failure (clears the error + stale data). */
  const retryQr = (url: string) => {
    setQrData((prev) => { const next = { ...prev }; delete next[url]; return next; });
    setQrErrors((prev) => { const next = { ...prev }; delete next[url]; return next; });
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#191b23', light: '#ffffff' } })
      .then((u) => setQrData((prev) => ({ ...prev, [url]: u })))
      .catch(() => setQrErrors((prev) => ({ ...prev, [url]: true })));
  };

  /**
   * Share a sticker: copy the QR image to the clipboard so the owner can paste
   * it anywhere (menu PDF, WhatsApp, social). Falls back to downloading the
   * PNG when the clipboard can't accept images.
   */
  const shareQr = async (t: TokenRow) => {
    const dataUrl = qrData[t.url];
    if (!dataUrl) { setNotice('QR not rendered yet — try again in a moment'); return; }
    const label = `${TYPE_LABEL[t.type]} · ${targetLabel(t)}`;
    const downloadFallback = () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${t.type}-${targetLabel(t).replace(/[^\w-]+/g, '-')}.png`;
      a.click();
      setNotice(`${label} QR downloaded ✓`);
    };
    try {
      const blob = await (await fetch(dataUrl)).blob();
      // Clipboard image support: Chromium/Electron with clipboard-write.
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || 'image/png']: blob }),
        ]);
        setNotice(`${label} QR copied — paste it anywhere ✓`);
        return;
      }
      downloadFallback();
    } catch {
      downloadFallback();
    }
  };

  const targetLabel = (t: TokenRow) => {
    if (t.type === 'table') return `Table ${t.tableNumber ?? '?'}`;
    if (t.type === 'car') return t.parkingSlot ? `Slot ${t.parkingSlot}` : 'Car';
    return 'Pickup';
  };

  // Multi-branch: scope stickers to the selected branch exactly like the
  // floor plan (pos.tables → branchTables[currentBranchId]) — otherwise every
  // branch's tables (e.g. tables 1-16 twice) would appear here. Branchless
  // rows are kept, matching the app-wide convention.
  const scoping = isMultiBranch && !!currentBranchId;
  const scopedTables = useMemo(() => {
    if (!scoping) return tables;
    return tables.filter((t) => !t.branchId || String(t.branchId) === currentBranchId);
  }, [tables, scoping, currentBranchId]);
  const scopedTokens = useMemo(() => {
    if (!scoping) return tokens;
    return tokens.filter((t) => !t.branchId || String(t.branchId) === currentBranchId);
  }, [tokens, scoping, currentBranchId]);

  const sortedTables = useMemo(
    () => [...scopedTables].sort((a, b) => Number(a.number || 0) - Number(b.number || 0)),
    [scopedTables],
  );

  // Map tableId → sticker so the Tables section shows each DB table's QR.
  const tokenByTableId = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const t of scopedTokens) if (t.type === 'table' && t.tableId) m.set(String(t.tableId), t);
    return m;
  }, [scopedTokens]);

  const tableRows = useMemo(
    () =>
      sortedTables.map((t) => {
        const id = String(t._id || t.id || '');
        return { id, table: t, token: id ? tokenByTableId.get(id) : undefined };
      }),
    [sortedTables, tokenByTableId],
  );

  /**
   * AUTO-GENERATE missing table stickers — every table must have a QR.
   * New tables get one at creation (backend tableService → upsertTableSticker);
   * this backfills pre-existing tables that predate the sticker feature. The
   * seed endpoint is idempotent (skips tables that already have a sticker), so
   * re-opening QR Studio (or switching branches) is safe.
   *
   * The attempt key = current branch + sorted table ids, so a table added later
   * (or a branch switch) re-triggers, but a failed seed (e.g. online store not
   * enabled) never loops.
   */
  const seedKeyRef = useRef<string | null>(null);
  const seedBusyRef = useRef(false);
  useEffect(() => {
    if (loading || seedBusyRef.current) return;
    const missing = tableRows.some((r) => !r.token);
    if (!missing) return;
    const key = `${currentBranchId ?? 'all'}:${tableRows.map((r) => r.id).sort().join(',')}`;
    if (seedKeyRef.current === key) return;
    seedBusyRef.current = true;
    setSeeding(true);
    seedQrTokens()
      .then((res: any) => {
        seedKeyRef.current = key;
        const created = Number(res?.created ?? 0);
        if (res?.ok && created > 0) setNotice(`${created} table QR${created === 1 ? '' : 's'} generated ✓`);
        else if (!res?.ok && res?.error) setNotice(res.error);
        return loadTokens();
      })
      .catch(() => { seedKeyRef.current = key; })
      .finally(() => { seedBusyRef.current = false; setSeeding(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tableRows, currentBranchId]);

  const otherTokens = useMemo(() => scopedTokens.filter((t) => t.type !== 'table'), [scopedTokens]);

  const create = async () => {
    if (busy) return;
    if (form.type === 'car' && !form.parkingSlot.trim()) { setNotice('Enter a parking slot label'); return; }
    setBusy(true);
    setNotice('');
    try {
      const body: any = { type: form.type };
      if (form.type === 'car') body.parkingSlot = form.parkingSlot.trim().toUpperCase();
      const res = await createQrToken(body);
      if (res?.ok) setNotice('Sticker created ✓');
      else setNotice(res?.error || 'Could not create the sticker — is the backend online?');
      setFormOpen(false);
      await loadTokens();
      setForm({ type: 'car', parkingSlot: '' });
    } finally {
      setBusy(false);
    }
  };

  /** Generate a FRESH sticker for a table that has none (backfill / seed). */
  const generateTable = async (tableId: string) => {
    if (busyTable) return;
    setBusyTable(tableId);
    setNotice('');
    try {
      const res = await createQrToken({ type: 'table', tableId });
      setNotice(res?.ok ? 'Table QR created ✓' : (res?.error || 'Could not create the QR — is the backend online?'));
      await loadTokens();
    } finally {
      setBusyTable(null);
    }
  };

  /** REGEN — replacing a printed sticker invalidates the old QR, so the
   *  current user's password is required (verified by the server). */
  const requestRegen = (tableId: string, token: TokenRow) => {
    if (!token) return;
    setRegenTarget({ tableId, tableLabel: `Table ${token.tableNumber ?? '?'}` });
    setRegenPassword('');
    setRegenError('');
  };

  const confirmRegen = async () => {
    const target = regenTarget;
    if (!target) return;
    if (!regenPassword.trim()) { setRegenError('Enter the current user password'); return; }
    setIsRegenerating(true);
    setRegenError('');
    try {
      const res = await createQrToken({ type: 'table', tableId: target.tableId, password: regenPassword });
      if (!res?.ok) {
        setRegenError(res?.error || 'Could not regenerate the QR. Check the current user password and try again.');
        setIsRegenerating(false);
        return;
      }
      setNotice('Table QR regenerated ✓ — the previously printed sticker is now invalid.');
      setRegenTarget(null);
      await loadTokens();
    } finally {
      setIsRegenerating(false);
    }
  };

  const remove = async (t: TokenRow) => {
    const id = t._id || t.id;
    if (!id || !window.confirm('Remove this sticker?')) return;
    await deleteQrToken(id);
    await loadTokens();
  };

  /** Print exactly the given stickers (independent per-QR printing). */
  const printStickers = (urls: string[]) => {
    setPrintTargets(urls);
    // Double rAF guarantees the selective print sheet has committed to the DOM
    // before the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const printSheetTokens = tokens.filter((t) => printTargets.includes(t.url));

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--color-bg-page)]">
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back"><ArrowLeft className="w-4 h-4" /></button>
        <span className="text-sm font-bold text-[var(--color-text-primary)]">QR Studio</span>
        <span className="text-[10px] text-gray-400 ml-auto">Print QR ordering stickers · customer-site v1</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {notice && <p className="text-xs font-semibold text-[var(--brand-color)]">{notice}</p>}

        {/* ═══ TABLE STICKERS — driven by the real tables in the database ═══ */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Table stickers</h3>
            <span className="text-[10px] text-gray-400">
              One QR per table from your database — {tableRows.filter((r) => r.token).length} of {tableRows.length} generated
              {scoping && branchName ? ` · ${branchName}` : ''}
              {seeding ? ' · generating missing QRs…' : ''}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : tableRows.length === 0 ? (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-dashed border-[var(--color-border-default)] p-8 text-center">
              <span className="text-2xl">🪑</span>
              <p className="text-sm font-bold text-[var(--color-text-primary)] mt-2">No tables found</p>
              <p className="text-xs text-gray-400 mt-1">Add tables in the floor plan first — their QR stickers will appear here automatically.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {tableRows.map(({ id, table, token }) => (
                <div
                  key={id || `t_${table.number}`}
                  className={`bg-[var(--color-bg-white)] rounded-2xl border shadow-sm p-4 flex flex-col items-center gap-2 ${
                    token ? 'border-[var(--color-border-default)]' : 'border-dashed border-[var(--color-border-default)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-lg">🍽️</span>
                    <p className="text-sm font-bold text-[var(--color-text-primary)]">Table {table.number ?? table.name ?? '?'}</p>
                    {table.capacity ? <span className="ml-auto text-[9px] text-gray-400">Seats {table.capacity}</span> : null}
                  </div>

                  {token ? (
                    <>
                      {qrData[token.url] ? (
                        <img src={qrData[token.url]} alt={`QR Table ${table.number}`} className="w-32 h-32" />
                      ) : qrErrors[token.url] ? (
                        <div className="w-32 h-32 flex flex-col items-center justify-center gap-1.5 bg-rose-50 rounded-xl border border-dashed border-rose-200">
                          <AlertTriangle className="w-6 h-6 text-rose-400" />
                          <span className="text-[9px] font-bold text-rose-500">Couldn't render QR</span>
                          <button
                            onClick={() => retryQr(token.url)}
                            className="px-2 py-1 rounded-lg border border-rose-200 text-[9px] font-bold text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        <div className="w-32 h-32 flex items-center justify-center text-gray-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[9px] font-mono text-purple-600">{token.token}</span>
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
                          onClick={() => shareQr(token)}
                          disabled={!qrData[token.url]}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-default)] text-[10px] font-bold text-gray-500 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
                          title="Copy this QR image — paste it anywhere (menu, WhatsApp, social)"
                        >
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                        <button
                          onClick={() => requestRegen(id, token)}
                          disabled={busyTable === id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-default)] text-[10px] font-bold text-gray-500 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
                          title="Regenerate this table's sticker (requires the current user password)"
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
                      <div className="w-32 h-32 flex flex-col items-center justify-center gap-1.5 bg-[var(--color-surface-muted)] rounded-xl border border-dashed border-[var(--color-border-default)]">
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
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Car & pickup stickers</h3>
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-xs font-bold text-[var(--color-text-primary)] hover:border-[var(--brand-color)] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New sticker
            </button>
          </div>

          {formOpen && (
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-sm p-5 space-y-3 mb-4">
              <p className="text-sm font-bold text-[var(--color-text-primary)]">New QR sticker</p>
              <div className="flex gap-2 flex-wrap">
                {(['car', 'pickup'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, type: t })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${form.type === t ? 'bg-[var(--brand-color)] text-white' : 'bg-[var(--color-surface-muted)] text-gray-500 hover:bg-[var(--color-surface-muted)]'}`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              {form.type === 'car' && (
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">Parking slot label</p>
                  <input
                    className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-default)] text-xs font-semibold text-[var(--color-text-primary)] uppercase"
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
            <p className="text-xs text-gray-400 bg-[var(--color-bg-white)] rounded-xl border border-dashed border-[var(--color-border-default)] px-4 py-6 text-center">
              No car or pickup stickers yet — use <strong>New sticker</strong> above to add one.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {otherTokens.map((t) => (
                <div key={t._id || t.url} className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-sm p-4 flex flex-col items-center gap-2">
                  {qrData[t.url] ? (
                    <img src={qrData[t.url]} alt={`QR ${t.token}`} className="w-32 h-32" />
                  ) : qrErrors[t.url] ? (
                    <div className="w-32 h-32 flex flex-col items-center justify-center gap-1.5 bg-rose-50 rounded-xl border border-dashed border-rose-200">
                      <AlertTriangle className="w-6 h-6 text-rose-400" />
                      <span className="text-[9px] font-bold text-rose-500">Couldn't render QR</span>
                      <button
                        onClick={() => retryQr(t.url)}
                        className="px-2 py-1 rounded-lg border border-rose-200 text-[9px] font-bold text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="w-32 h-32 flex items-center justify-center text-gray-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
                  )}
                  <p className="text-xs font-bold text-[var(--color-text-primary)]">{TYPE_LABEL[t.type]} · {targetLabel(t)}</p>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[9px] font-mono text-purple-600">{t.token}</span>
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
                      onClick={() => shareQr(t)}
                      disabled={!qrData[t.url]}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-default)] text-[10px] font-bold text-gray-500 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
                      title="Copy this QR image — paste it anywhere (menu, WhatsApp, social)"
                    >
                      <Share2 className="w-3 h-3" /> Share
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
          <div className="flex items-center gap-2 flex-wrap sticky bottom-0 bg-[var(--color-bg-page)] py-2">
            <button
              onClick={() => printStickers(tokens.map((t) => t.url))}
              disabled={tokens.some((t) => !qrData[t.url])}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-xs font-bold text-[var(--color-text-primary)] hover:border-[var(--brand-color)] transition-colors cursor-pointer disabled:opacity-50"
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

      {/* Password confirmation for REGEN — replacing a sticker invalidates
          the printed QR, so the current user's password is required. */}
      {regenTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { if (!isRegenerating) setRegenTarget(null); }}
        >
          <div
            className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] shadow-2xl w-[400px] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--brand-color)]" />
                Regenerate QR — {regenTarget.tableLabel}
              </h3>
              <button
                onClick={() => { if (!isRegenerating) setRegenTarget(null); }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-700 mb-1">
              Regenerating makes the <span className="font-bold">currently printed QR invalid</span>.
            </p>
            <p className="text-[10px] text-gray-400 mb-4">
              Enter the current user password to confirm. QR codes never expire.
            </p>
            <input
              type="password"
              autoFocus
              value={regenPassword}
              onChange={(e) => setRegenPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRegen(); }}
              placeholder="Current user password"
              className="w-full px-3 py-2 rounded-xl border border-[var(--color-border-input)] text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] mb-3"
            />
            {regenError && (
              <p className="text-[11px] font-bold text-red-600 mb-2">{regenError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setRegenTarget(null)}
                disabled={isRegenerating}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRegen}
                disabled={isRegenerating || !regenPassword.trim()}
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {isRegenerating ? 'Regenerating…' : 'Regenerate QR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
