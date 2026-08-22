import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Calendar, Clock, AlertTriangle, AlertCircle, Info, CheckCircle, Loader2 } from 'lucide-react';
import { useNotify, useInventory } from '../InventoryManager';
import { usePageRefresh } from '../usePageRefresh';
import { fetchInventoryExpiry } from '../../../src/api/client';
import ReceiptLoader from '../../ReceiptLoader';

type ExpiryItem = {
  name: string;
  batchNumber?: string;
  currentStock: number;
  unit: string;
  expiryDate?: string;
  batches?: { batchNumber?: string; expiryDate?: string; quantity: number }[];
};

/** Build the expiry list from REAL item data (products with expiryDate in
 *  MongoDB). Per-batch FIFO: each batch with an expiry becomes its own row with
 *  the REMAINING quantity of that batch. Legacy items without batches fall back
 *  to the item's single expiryDate. No demo fallback. */
function buildExpiryItems(items: ExpiryItem[]) {
  const rows: {
    id: string;
    item: string;
    batchNumber: string;
    quantity: number;
    unit: string;
    expiryDate: string;
    daysRemaining: number;
    suggestedAction: 'discard' | 'use_immediately' | 'sale';
  }[] = [];
  for (const i of items) {
    const withExpiry = (i.batches || []).filter(b => b.expiryDate && Number(b.quantity) > 0);
    if (withExpiry.length > 0) {
      for (const b of withExpiry) {
        const daysRemaining = Math.ceil((new Date(b.expiryDate!).getTime() - Date.now()) / 86400000);
        rows.push({
          id: `exp_${i.name}_${b.batchNumber || b.expiryDate || '0'}`,
          item: i.name,
          batchNumber: b.batchNumber || b.expiryDate || '—',
          quantity: Number(b.quantity) || 0,
          unit: i.unit,
          expiryDate: b.expiryDate!,
          daysRemaining,
          suggestedAction: (daysRemaining < 0 ? 'discard' : daysRemaining <= 1 ? 'use_immediately' : daysRemaining <= 3 ? 'sale' : 'use_immediately') as any,
        });
      }
    } else if (i.expiryDate) {
      const daysRemaining = Math.ceil((new Date(i.expiryDate).getTime() - Date.now()) / 86400000);
      rows.push({
        id: `exp_${i.name}_${i.batchNumber || '0'}`,
        item: i.name,
        batchNumber: i.batchNumber || '—',
        quantity: i.currentStock,
        unit: i.unit,
        expiryDate: i.expiryDate,
        daysRemaining,
        suggestedAction: (daysRemaining < 0 ? 'discard' : daysRemaining <= 1 ? 'use_immediately' : daysRemaining <= 3 ? 'sale' : 'use_immediately') as any,
      });
    }
  }
  // Sort: most urgent (earliest expiry) first.
  return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

const timeGroups = [
  { label: 'Expired', range: (d: number) => d < 0, color: 'bg-red-50 border-red-200', dot: 'bg-[var(--color-red-500-solid)]', textColor: 'text-red-700' },
  { label: 'Today', range: (d: number) => d === 0, color: 'bg-red-50 border-red-200', dot: 'bg-[var(--color-red-500-solid)]', textColor: 'text-red-700' },
  { label: 'Tomorrow', range: (d: number) => d === 1, color: 'bg-amber-50 border-amber-200', dot: 'bg-[var(--color-amber-500-solid)]', textColor: 'text-amber-700' },
  { label: '3 Days', range: (d: number) => d >= 2 && d <= 3, color: 'bg-amber-50 border-amber-200', dot: 'bg-[var(--color-amber-500-solid)]', textColor: 'text-amber-700' },
  { label: '7 Days', range: (d: number) => d >= 4 && d <= 7, color: 'bg-blue-50 border-blue-200', dot: 'bg-[var(--color-blue-500-solid)]', textColor: 'text-blue-700' },
  { label: 'Safe', range: (d: number) => d > 7, color: 'bg-emerald-50 border-emerald-200', dot: 'bg-[var(--color-emerald-500-solid)]', textColor: 'text-emerald-700' },
];

const actionLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  use_immediately: { label: 'Use Now', icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'bg-amber-50 text-amber-700' },
  donate: { label: 'Donate', icon: <Info className="w-3.5 h-3.5" />, color: 'bg-blue-50 text-blue-700' },
  discard: { label: 'Discard', icon: <AlertTriangle className="w-3.5 h-3.5" />, color: 'bg-red-50 text-red-700' },
  sale: { label: 'Sale', icon: <Clock className="w-3.5 h-3.5" />, color: 'bg-emerald-50 text-emerald-700' },
};

export default function ExpiryManagement() {
  const notify = useNotify();
  const { items } = useInventory();
  // The dedicated backend expiry report (per-batch, with remaining quantity).
  // Falls back to the live inventory catalog when the report can't load.
  const [report, setReport] = useState<{
    name: string; category?: string; currentStock: number; unit: string;
    expiryDate: string; batchNumber: string | null; daysLeft: number; status: string;
  }[] | null>(null);
  const [reportSynced, setReportSynced] = useState(false);

  const loadReport = useCallback(() => {
    let cancelled = false;
    setReportSynced(false);
    fetchInventoryExpiry(30)
      .then(({ data }) => {
        if (cancelled) return;
        setReport(Array.isArray(data) ? data : null);
        setReportSynced(true);
      })
      .catch(() => { if (!cancelled) { setReport(null); setReportSynced(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = loadReport();
    return cleanup;
  }, [loadReport]);
  // Header refresh button re-fetches this page's data.
  usePageRefresh(loadReport);

  // Fallback to the inventory catalog (per-batch via item.batches, or legacy
  // expiryDate) when the report failed or returned nothing.
  const expiryItems = useMemo(() => {
    if (Array.isArray(report)) {
      return report.map(r => ({
        id: `exp_${r.name}_${r.batchNumber || r.expiryDate || '0'}`,
        item: r.name,
        batchNumber: r.batchNumber || null,
        quantity: r.currentStock,
        unit: r.unit,
        expiryDate: r.expiryDate,
        daysRemaining: r.daysLeft,
        suggestedAction: (r.daysLeft < 0 ? 'discard' : r.daysLeft <= 1 ? 'use_immediately' : r.daysLeft <= 3 ? 'sale' : 'use_immediately') as any,
      }));
    }
    return buildExpiryItems(items);
  }, [report, items]);
  const loading = !reportSynced;
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Expiry Tracking</h1>
        <p className="text-xs text-gray-400 mt-0.5">Items approaching expiration — per batch, with remaining quantity</p>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center">
          <ReceiptLoader label="Loading expiry data…" />
        </div>
      ) : (<>
      {/* Timeline cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {timeGroups.filter(g => g.label !== 'Safe').map(group => {
          const items = expiryItems.filter(i => group.range(i.daysRemaining));
          return (
            <motion.div key={group.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
              className={`rounded-2xl border p-5 ${group.color}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                <span className={`text-sm font-bold ${group.textColor}`}>{group.label}</span>
              </div>
              <p className={`text-3xl font-bold font-mono ${group.textColor}`}>{items.length}</p>
              <p className="text-[10px] text-gray-500 mt-1">items</p>
            </motion.div>
          );
        })}
      </div>

      {/* Items list */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
        className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden shadow-sm"
      >
        <div className="p-4 border-b border-[var(--color-border-default)]">
          <p className="text-sm font-bold">All Items</p>
        </div>
        <div className="divide-y divide-[var(--color-border-default)]">
          {expiryItems.length === 0 && (
            <div className="p-10 text-center">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-gray-600">No expiry dates tracked</p>
              <p className="text-xs text-gray-400 mt-1">Set an expiry date on any inventory item to see it here — synced from your database.</p>
            </div>
          )}
          {expiryItems.map((item, idx) => {
            const group = timeGroups.find(g => g.range(item.daysRemaining)) || timeGroups[timeGroups.length - 1];
            const action = actionLabels[item.suggestedAction] || actionLabels.discard;
            const batchCount = expiryItems.filter(e => e.item === item.item).length;
            return (
              <div key={item.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                  <div>
                    <p className="text-sm font-semibold">{item.item}</p>
                    <p className="text-[10px] text-gray-400">
                      {batchCount > 1 ? `Batch ${idx + 1} of ${batchCount}` : ''}
                      {item.batchNumber ? `${batchCount > 1 ? ' · ' : ''}Batch #${item.batchNumber}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold font-mono">
                      {item.quantity} <span className="text-[10px] font-normal text-gray-400">{item.unit} remaining</span>
                    </p>
                    <p className="text-[10px] text-gray-400">
                      <Calendar className="w-3 h-3 inline mr-0.5" />
                      expires {item.expiryDate}
                    </p>
                  </div>
                  <button onClick={() => notify(`${item.item} marked for ${action.label.toLowerCase()}`, 'success')}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all hover:scale-105 ${action.color}`}>
                    {action.icon}{action.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
      </>)}
    </div>
  );
}