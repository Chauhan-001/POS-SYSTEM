import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TIMELINE_ENTRIES } from '../data';
import { usePurchasesCtx, useInventoryEventsCtx, useNotify } from '../InventoryManager';
import TimelineCard from '../components/TimelineCard';
import type { TimelineEntry } from '../types';

/**
 * InventoryTimeline — Activity feed of inventory events.
 *
 * Everything comes from real backend collections:
 *   - 'purchased' → shared purchases context (Purchase collection)
 *   - 'sold' / 'adjusted' / 'waste' / 'closing' → shared InventoryEvent context
 *     (loaded once by InventoryManager; waste/adjustments saved on the Waste
 *     page appear here immediately).
 *
 * The static demo feed is only used when the API is unreachable (offline).
 */
export default function InventoryTimeline() {
  const notify = useNotify();
  const { purchases, synced, removePurchase } = usePurchasesCtx();
  const { events: activityEntries, synced: eventsSynced } = useInventoryEventsCtx();
  const [entries, setEntries] = useState<TimelineEntry[]>(TIMELINE_ENTRIES);
  const [purchaseIds, setPurchaseIds] = useState<Set<string>>(new Set());

  // Merge real purchases with real activity events (or static fallback).
  useEffect(() => {
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
      setPurchaseIds(new Set(purchases.map((p) => p.id)));
      // Never mix static 'purchased' demo rows in with real purchases.
      const activity = (activityEntries || TIMELINE_ENTRIES).filter((e) => e.type !== 'purchased');
      setEntries(
        [...purchased, ...activity].sort((a, b) =>
          String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
        )
      );
    } else if (activityEntries) {
      setPurchaseIds(new Set());
      setEntries(activityEntries);
    } else {
      setPurchaseIds(new Set());
      setEntries(TIMELINE_ENTRIES);
    }
  }, [purchases, activityEntries]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this purchase from history?')) return;
    const ok = await removePurchase(id);
    notify(ok ? 'Purchase removed' : 'Could not delete purchase — try again', ok ? 'info' : 'warning');
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Activity</h1>
          {(synced || eventsSynced) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">Synced</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{entries.length} events</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
      >
        {entries.map((entry, i) => (
          <TimelineCard
            key={entry.id}
            entry={entry}
            isLast={i === entries.length - 1}
            onDelete={purchaseIds.has(entry.id) ? handleDelete : undefined}
          />
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">No inventory activity yet.</p>
        )}
      </motion.div>
    </div>
  );
}
