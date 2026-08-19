import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { usePurchasesCtx, useInventoryEventsCtx, useNotify } from '../InventoryManager';
import TimelineCard from '../components/TimelineCard';
import type { TimelineEntry } from '../types';

const PAGE_SIZE = 20;

/**
 * InventoryTimeline — Activity feed of inventory events.
 *
 * Everything comes from real backend collections:
 *   - 'purchased' → shared purchases context (Purchase collection)
 *   - 'sold' / 'adjusted' / 'waste' / 'closing' / 'purchase' / 'return' →
 *     shared InventoryEvent context (loaded once by InventoryManager).
 *
 * The stock engine logs a 'purchase' InventoryEvent for every purchase, so
 * when the purchases feed is available we drop those duplicate rows (the
 * purchases feed is the authoritative purchase record). 'return' events come
 * from bill refunds restoring stock. No demo/seed fallback: when the API is
 * unreachable the feed is empty and an honest offline state is shown.
 */
export default function InventoryTimeline() {
  const notify = useNotify();
  const { purchases, synced, removePurchase } = usePurchasesCtx();
  const { events: activityEntries, synced: eventsSynced, refreshEvents, deleteEvent } = useInventoryEventsCtx();
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null);

  // Which rows are real purchase records (deletable) — derived directly from
  // the purchases feed, no render-phase setState needed.
  const purchaseIds = useMemo(() => new Set((purchases || []).map((p) => p.id)), [purchases]);

  // Merge real purchases with real activity events (or static fallback).
  // The stock engine emits a 'purchase' event for every purchase — dedupe it
  // against the purchases feed so a purchase never shows twice.
  const entries = useMemo<TimelineEntry[]>(() => {
    if (purchases) {
      const purchased: TimelineEntry[] = purchases.map((p) => ({
        id: p.id,
        type: 'purchased',
        item: p.item,
        quantity: p.quantity,
        unit: p.unit,
        timestamp: p.date,
        operator: p.supplier,
        details: `Purchase from ${p.supplier}`,
      }));
      const activity = (activityEntries || [])
        .filter((e) => e.type !== 'purchased' && !(e.type === 'purchase' && purchases.length > 0));
      return [...purchased, ...activity].sort((a, b) =>
        String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
      );
    }
    return activityEntries || [];
  }, [purchases, activityEntries]);

  // Keep the view on the newest page when data refreshes (new action appears
  // at the top), and clamp the page if the list shrank.
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [entries.length > 0 ? entries[0]?.id : 'none', totalPages]);
  const currentPage = Math.min(page, totalPages);
  const pageEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const startIdx = (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, entries.length);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshEvents()]);
    setRefreshing(false);
    notify('Activity refreshed', 'info');
  }, [refreshEvents, notify]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this purchase from history?')) return;
    const ok = await removePurchase(id);
    notify(ok ? 'Purchase removed' : 'Could not delete purchase — try again', ok ? 'info' : 'warning');
  };

  const handleUndo = async (id: string) => {
    setUndoConfirm(null);
    const ok = await deleteEvent(id);
    notify(ok ? 'Event undone — removed from history' : 'Could not undo — try again', ok ? 'info' : 'warning');
  };

  const handleItemClick = useCallback((entry: TimelineEntry) => {
    // Navigate to the Items tab — the product name is shown in the entry
    // The parent InventoryManager handles tab navigation
    window.dispatchEvent(new CustomEvent('inventory:navigate', { detail: { tab: 'items', search: entry.item } }));
  }, []);

  // Page-number window (max 5) around the current page.
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage, totalPages]);

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Activity</h1>
          {(synced || eventsSynced) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">Synced</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh activity"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          {entries.length} events
          {entries.length > PAGE_SIZE && ` · showing ${startIdx}–${endIdx}`}
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-6 shadow-sm"
      >
        {pageEntries.map((entry, i) => (
          <TimelineCard
            key={entry.id}
            entry={entry}
            isLast={i === pageEntries.length - 1}
            onDelete={purchaseIds.has(entry.id) ? handleDelete : undefined}
            onUndo={!purchaseIds.has(entry.id) ? () => setUndoConfirm(entry.id) : undefined}
            onClick={() => handleItemClick(entry)}
          />
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">No inventory activity yet.</p>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-[var(--color-border-default)]">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <div className="flex items-center gap-1">
              {pageNumbers.map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    p === currentPage
                      ? 'bg-[var(--brand-color)] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-blue-50 hover:text-[var(--brand-color)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </motion.div>

      {/* Undo confirmation dialog */}
      {undoConfirm && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-white)] rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <h4 className="font-black text-gray-900 text-sm">Undo this activity?</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-1">
              This will remove the event from the activity history. This action cannot be undone.
            </p>
            <p className="text-[11px] text-amber-600 font-bold mb-5">
              Note: This does not reverse stock changes — only removes the history entry.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setUndoConfirm(null)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUndo(undoConfirm)}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Undo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
