/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MenuAvailabilityPage — the POS "Menu Availability" control: a fast,
 * inventory-free switch for whether each menu item can currently be ordered
 * ONLINE. Every toggle is server-authoritative and audited; when offline the
 * change is optimistically applied locally and queued for replay (the customer
 * website still only ever reads the backend).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowLeft, WifiOff, Check, Loader2, ToggleLeft } from 'lucide-react';
import * as api from '../src/api/client';
import { syncEngine } from '../src/lib/syncEngine';
import type { Product, Branch, MenuAvailabilityState } from '../src/types';

interface MenuAvailabilityPageProps {
  products: Product[];
  branches?: Branch[];
  currencySymbol: string;
  onBack: () => void;
}

type PresetKey = 'indefinite' | '30m' | '1h' | 'today';

const PRESETS: Array<{ key: PresetKey; label: string; hours?: number }> = [
  { key: 'indefinite', label: 'Indefinitely' },
  { key: '30m', label: '30 min', hours: 0.5 },
  { key: '1h', label: '1 hour', hours: 1 },
  { key: 'today', label: 'End of today' },
];

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function MenuAvailabilityPage({
  products,
  branches = [],
  currencySymbol,
  onBack,
}: MenuAvailabilityPageProps) {
  const [states, setStates] = useState<Record<string, MenuAvailabilityState>>({});
  // DB-driven rows straight from GET /availability (server-scoped to THIS
  // restaurant only). Cards + categories are built from here, never from stale
  // POS state or other tenants' products.
  const [menu, setMenu] = useState<MenuAvailabilityState[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'UNAVAILABLE'>('ALL');
  const [branchId, setBranchId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [pendingProducts, setPendingProducts] = useState<Set<string>>(new Set());
  const [pendingSync, setPendingSync] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // productId with the OFF panel open
  const [draftReason, setDraftReason] = useState('');
  const [draftPreset, setDraftPreset] = useState<PresetKey>('indefinite');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Request sequence guard — supersede stale loads instead of bailing on a
  // mount-ref. React StrictMode (dev) double-invokes effects (setup → cleanup
  // → setup); a mountRef set false by that cleanup would discard EVERY load
  // result and leave the page on "Loading availability…" forever. A monoton-
  // ically increasing id lets the LATEST load apply and drops superseded ones
  // (also correct across branch switches).
  const loadSeq = useRef(0);

  const multiBranch = branches.length > 1;
  const effectiveBranchId = branchId || null;

  // Track the sync engine's pending queue so staff can see "not synced yet".
  useEffect(() => {
    const update = () => setPendingSync(syncEngine.getSyncState().pendingChanges);
    update();
    const unsub = syncEngine.subscribe(update);
    return unsub;
  }, []);

  const load = useCallback(async (branch: string | null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    let rows: MenuAvailabilityState[] | null;
    try {
      rows = await api.fetchAvailability(branch ? { branchId: branch } : {});
    } catch {
      // A thrown rejection must never strand the spinner — treat it like a
      // network failure below (keep last-known rows; fallback applies only
      // when nothing has ever loaded).
      rows = null;
    }
    // A newer load (branch switch / remount) supersedes this one.
    if (loadSeq.current !== seq) return;
    if (rows === null) {
      // Network failure — keep the last known DB rows already in state. Only
      // when nothing has ever loaded does the cached-product fallback apply.
      setLoading(false);
      return;
    }
    if (Array.isArray(rows)) {
      setMenu(rows);
      const map: Record<string, MenuAvailabilityState> = {};
      for (const r of rows) map[r.productId] = r;
      setStates(map);
    } else {
      setError('Could not load availability — check your connection.');
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Branch switch — reset to the empty/spinner state first so a failed
    // fetch for the new branch can never keep showing another branch's rows
    // (the offline products fallback applies instead).
    setMenu([]);
    setStates({});
    load(effectiveBranchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // Source of truth = the restaurant's own DB rows from /availability (the
  // backend already scopes them to this restaurant's restaurantId). When
  // offline (fetch failed and nothing has ever loaded), fall back to the
  // products prop so the page still renders the catalog it had cached — but
  // ONLY rows that are real MongoDB products (24-hex ObjectId ids). Hardcoded
  // demo/legacy rows (p1, demo_prod_*, p_<timestamp>_<rand>, …) use local-only
  // ids and are always excluded, so this screen can never surface items that
  // aren't saved under this restaurant in the database.
  const isMongoObjectId = (id?: string) => /^[a-fA-F0-9]{24}$/.test(String(id || ''));
  const effectiveRows = useMemo<MenuAvailabilityState[]>(() => {
    if (menu.length > 0) return menu;
    // Offline fallback — products are already menu-only (type=menu).
    return products
      .filter((p) => isMongoObjectId(p.id))
      .map((p) => ({
        productId: p.id,
        name: p.name,
        category: p.category || '',
        price: p.price,
        code: p.code || '',
        image: p.image || null,
        onlineAvailable: p.availability !== false,
        status: p.availability === false ? 'UNAVAILABLE' : 'AVAILABLE',
        unavailableUntil: null,
        reason: null,
        visibleOnSite: true,
      }));
  }, [menu, products]);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const r of effectiveRows) if (r.category) set.add(r.category);
    return Array.from(set);
  }, [effectiveRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effectiveRows
      .filter((r) => category === 'All' || r.category === category)
      .filter((r) => {
        if (statusFilter === 'ALL') return true;
        return (states[r.productId]?.status || r.status) === statusFilter;
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [effectiveRows, category, statusFilter, search, states]);

  const availableCount = useMemo(
    () => effectiveRows.filter((r) => (states[r.productId]?.status || r.status) === 'AVAILABLE').length,
    [effectiveRows, states]
  );
  const unavailableCount = effectiveRows.length - availableCount;

  async function applyToggle(item: MenuAvailabilityState, nextStatus: 'AVAILABLE' | 'UNAVAILABLE', unavailableUntil?: string | null, reason?: string) {
    const pid = item.productId;
    setPendingProducts((prev) => new Set(prev).add(pid));
    setSaving(true);
    setJustSaved(null);

    // Optimistic update — the customer site still only reads the backend, so a
    // local flip is safe until it syncs.
    setStates((prev) => ({
      ...prev,
      [pid]: {
        ...(prev[pid] || {
          productId: pid, name: item.name, category: item.category || '',
          price: item.price, code: item.code || '', onlineAvailable: true,
        }),
        status: nextStatus,
        onlineAvailable: nextStatus === 'AVAILABLE',
        unavailableUntil: nextStatus === 'UNAVAILABLE' ? unavailableUntil || null : null,
        reason: nextStatus === 'UNAVAILABLE' ? reason || '' : null,
      },
    }));
    setEditing(null);
    setDraftReason('');
    setDraftPreset('indefinite');

    const result = await api.updateAvailabilityBulk({
      branchId: effectiveBranchId,
      items: [{ productId: pid, status: nextStatus, unavailableUntil: unavailableUntil || null, reason: reason || '' }],
    });

    setPendingProducts((prev) => {
      const next = new Set(prev);
      next.delete(pid);
      return next;
    });
    setSaving(false);

    if (result) {
      setJustSaved(pid);
      setTimeout(() => setJustSaved((cur) => (cur === pid ? null : cur)), 1400);
    } else {
      // Offline (or server error) — the API layer queued the write. Keep the
      // optimistic state and surface the pending-sync badge.
      setError('');
    }
  }

  function openOffPanel(item: MenuAvailabilityState) {
    setEditing(item.productId);
    setDraftReason(states[item.productId]?.reason || 'Sold out');
    setDraftPreset('indefinite');
  }

  function presetToDate(preset: PresetKey): string | null {
    if (preset === 'indefinite') return null;
    if (preset === 'today') return endOfToday().toISOString();
    const d = new Date(Date.now() + (PRESETS.find((p) => p.key === preset)?.hours || 1) * 3600_000);
    return d.toISOString();
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-[var(--color-text-primary)]">Menu Availability</span>
        <span className="text-[10px] text-gray-400 ml-auto hidden sm:block">Online ordering control — no inventory needed</span>
        {pendingSync > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold">
            <WifiOff className="w-3 h-3" /> {pendingSync} pending sync
          </span>
        )}
      </div>

      <div className="px-4 py-3 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] flex flex-wrap items-center gap-2 shrink-0">
        {/* Summary chips */}
        <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold">
          {availableCount} available
        </span>
        <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
          {unavailableCount} sold out
        </span>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="pl-8 pr-3 py-1.5 rounded-lg border border-[var(--color-border-default)] text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 w-40 sm:w-52"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-2 py-1.5 rounded-lg border border-[var(--color-border-default)] text-xs bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="ALL">All items</option>
          <option value="AVAILABLE">Available</option>
          <option value="UNAVAILABLE">Sold out</option>
        </select>

        {/* Branch scope */}
        {multiBranch && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-[var(--color-border-default)] text-xs bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-blue-100"
            title="Scope availability to a branch"
          >
            <option value="">All branches (default)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Category chips */}
      <div className="px-4 py-2 flex gap-1.5 overflow-x-auto border-b border-[var(--color-border-default)] bg-[var(--color-surface-muted)] shrink-0">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
              category === c
                ? 'bg-[var(--brand-color)] text-white shadow-sm'
                : 'bg-[var(--color-bg-white)] text-gray-500 border border-[var(--color-border-default)] hover:border-gray-300'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-surface-muted)]">
        {error && !loading && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading availability…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <ToggleLeft className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-xs font-semibold">No items found</p>
            <p className="text-[10px] mt-1">Try a different search or category.</p>
          </div>
        ) : (
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {rows.map((row) => {
              const st = states[row.productId];
              const available = (st?.status || row.status) === 'AVAILABLE';
              const isPending = pendingProducts.has(row.productId);
              const isEditing = editing === row.productId;
              return (
                <div
                  key={row.productId}
                  className={`bg-[var(--color-bg-white)] rounded-xl border transition-all ${
                    available ? 'border-[var(--color-border-default)] hover:shadow-sm' : 'border-red-100 bg-red-50/40'
                  }`}
                >
                  <div className="flex items-center gap-3 p-3">
                    {row.image ? (
                      <img src={row.image} alt="" className="w-9 h-9 rounded-lg object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-[10px] font-bold shrink-0">
                        {row.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{row.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {currencySymbol}{row.price.toFixed(2)} · {row.category}
                      </p>
                      {!available && (
                        <p className="text-[9px] text-red-600 font-semibold mt-0.5 truncate">
                          {st?.unavailableUntil
                            ? `Back ${new Date(st.unavailableUntil).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                            : st?.reason || 'Sold out'}
                        </p>
                      )}
                    </div>

                    {/* Toggle */}
                    {available ? (
                      <button
                        onClick={() => openOffPanel(row)}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold hover:bg-green-100 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                        title="Mark unavailable for online ordering"
                      >
                        <span className="w-2 h-2 rounded-full bg-[var(--color-green-500-solid)]" />
                        ON
                      </button>
                    ) : (
                      <button
                        onClick={() => applyToggle(row, 'AVAILABLE')}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-red-50 text-red-600 border border-red-200 text-[10px] font-bold hover:bg-red-100 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                        title="Restore for online ordering"
                      >
                        <span className="w-2 h-2 rounded-full bg-[var(--color-red-500-solid)]" />
                        OFF
                      </button>
                    )}
                  </div>

                  {/* Unavailable-until panel (when turning OFF) */}
                  {isEditing && (
                    <div className="px-3 pb-3 border-t border-[var(--color-border-default)] pt-2.5">
                      <p className="text-[10px] font-bold text-[var(--color-text-primary)] mb-2">Unavailable for online ordering…</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {PRESETS.map((p) => (
                          <button
                            key={p.key}
                            onClick={() => setDraftPreset(p.key)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                              draftPreset === p.key
                                ? 'bg-[var(--brand-color)] text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <input
                        value={draftReason}
                        onChange={(e) => setDraftReason(e.target.value)}
                        placeholder="Reason (e.g. Sold out)"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-default)] text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditing(null)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-gray-500 hover:bg-gray-100 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => applyToggle(row, 'UNAVAILABLE', presetToDate(draftPreset), draftReason || undefined)}
                          disabled={saving}
                          className="ml-auto flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-[var(--color-red-600-solid)] text-white text-[10px] font-bold hover:bg-[var(--color-red-700-solid)] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Mark unavailable
                        </button>
                      </div>
                    </div>
                  )}

                  {justSaved === row.productId && (
                    <div className="px-3 pb-2 -mt-1">
                      <span className="text-[9px] text-green-600 font-bold">✓ Saved</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
