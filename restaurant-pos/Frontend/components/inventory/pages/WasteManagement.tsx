import { Trash2, Plus, X, Lightbulb } from 'lucide-react';
import RefreshButton from '../../common/RefreshButton';
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotify, useInventory, useInventoryEventsCtx } from '../InventoryManager';
import { analyzeWaste, type WasteAnalysis, type AiResult } from '../../../src/ai/aiData';
import type { WasteEntry } from '../types';

const WASTE_REASONS = ['spoiled', 'burnt', 'expired', 'dropped', 'other'] as const;

/**
 * Parse the waste reason out of the backend event details. The stock engine
 * stores details like "spoiled Milk discarded" or "Expired batch discarded
 * (exp …)" — the reason is the first keyword when it matches a known cause.
 */
function reasonFromDetails(details?: string): WasteEntry['reason'] {
  const dl = (details || '').toLowerCase();
  if (dl.includes('spoiled')) return 'spoiled';
  if (dl.includes('burnt')) return 'burnt';
  if (dl.includes('expired')) return 'expired';
  if (dl.includes('dropped')) return 'dropped';
  return 'other';
}

export default function WasteManagement({ moduleSettings }: { moduleSettings?: Record<string, boolean> }) {
  const notify = useNotify();
  const { items, removeStock } = useInventory();
  // Real waste feed — the InventoryEvent collection (type 'waste'), loaded once
  // by InventoryManager. No hardcoded/demo rows: an empty list is honest.
  const { events, refreshEvents } = useInventoryEventsCtx();
  const [showForm, setShowForm] = useState(false);
  const [formItem, setFormItem] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formReason, setFormReason] = useState('spoiled');

  // Cost per unit comes from the REAL catalog (product averageCost in MongoDB).
  const itemCostByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.name.toLowerCase(), i.averageCost || 0);
    return m;
  }, [items]);

  const wasteLog = useMemo<WasteEntry[]>(() => {
    if (!events) return []; // offline — show honest empty state, never demo data
    return events
      .filter(e => e.type === 'waste')
      .map(e => {
        const qty = Math.abs(Number(e.quantity) || 0);
        const name = e.item || 'Item';
        const avgCost = itemCostByName.get(name.toLowerCase()) || 0;
        return {
          id: e.id,
          item: name,
          quantity: qty,
          unit: e.unit || 'pcs',
          reason: reasonFromDetails(e.details),
          cost: Math.round(qty * avgCost),
          date: String(e.timestamp || '').slice(0, 10),
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [events, itemCostByName]);

  const totalWaste = wasteLog.reduce((s, w) => s + w.cost, 0);
  const [wasteAnalysis, setWasteAnalysis] = useState<AiResult<WasteAnalysis> | null>(null);
  // AI analysis fires ONCE on mount (fresh login) and on the explicit Refresh
  // button — never on the 5-minute events poll (which re-creates wasteLog and
  // used to re-fire an LLM call each time). The backend cache absorbs repeats.
  const [wasteAiRefreshKey, setWasteAiRefreshKey] = useState(0);
  const [wasteAiLoading, setWasteAiLoading] = useState(false);
  useEffect(() => {
    setWasteAiLoading(true);
    analyzeWaste(wasteLog)
      .then(setWasteAnalysis)
      .catch(() => setWasteAnalysis(null))
      .finally(() => setWasteAiLoading(false));
  }, [wasteAiRefreshKey]); // mount + explicit refresh only

  const handleSubmit = async () => {
    const item = items.find(i => i.name === formItem);
    if (!item || !formQty || parseFloat(formQty) <= 0) {
      notify('Select an item and enter quantity', 'warning');
      return;
    }
    const qtyNum = parseFloat(formQty);
    const detail = formReason === 'other'
      ? `${item.name} discarded`
      : `${formReason} ${item.name} discarded`;
    // The stock engine handles stock deduction + InventoryEvent (type waste) +
    // AuditLog server-side — then we re-fetch the feed so the log below shows
    // the freshly persisted record (single source of truth = MongoDB).
    await removeStock(item.name, qtyNum, { type: 'waste', details: detail, reason: formReason });
    await refreshEvents();
    notify(`${formQty} ${item.unit} ${item.name} logged as waste`, 'success');
    setFormItem('');
    setFormQty('');
    setShowForm(false);
  };

  const reasonIcons: Record<string, string> = { spoiled: '🧊', burnt: '🔥', expired: '⏰', dropped: '💔', other: '📦' };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Waste Log</h1>
          <p className="text-xs text-gray-400 mt-0.5">{wasteLog.length} entries · ₹{Number(totalWaste || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-red-600-solid)] text-white rounded-2xl text-sm font-bold hover:bg-[var(--color-red-700-solid)] transition-all cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" /> Log Waste
        </button>
      </div>

      {/* Add waste form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-[var(--color-bg-white)] rounded-2xl border border-red-200 p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold">Log Waste</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item</label>
                <select value={formItem} onChange={e => setFormItem(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                >
                  <option value="">Select...</option>
                  {items.map(i => <option key={i.id} value={i.name}>{i.name} ({i.currentStock} {i.unit})</option>)}
                </select>
              </div>
              <div className="w-full sm:w-28">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                <input type="number" value={formQty} onChange={e => setFormQty(e.target.value)} placeholder="0"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Reason</label>
                <div className="flex gap-1.5 flex-wrap">
                  {WASTE_REASONS.map(r => (
                    <button key={r} onClick={() => setFormReason(r)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer capitalize ${
                        formReason === r ? 'bg-[var(--color-red-600-solid)] text-white shadow-sm' : 'bg-gray-50 border border-[var(--color-border-default)] text-gray-600 hover:border-red-300'
                      }`}
                    >
                      {reasonIcons[r]} {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={handleSubmit}
                className="px-6 py-2.5 bg-[var(--color-red-600-solid)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-red-700-solid)] transition-all cursor-pointer shadow-sm"
              >
                <Trash2 className="w-4 h-4 inline mr-1.5" />Log Waste
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Waste Analysis */}
      {moduleSettings?.enableAIWasteAnalysis !== false && wasteLog.length > 0 && wasteAnalysis && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--color-bg-white)] rounded-2xl border border-purple-200 shadow-sm overflow-hidden"
        >
          <div className="px-5 py-3.5 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-[var(--color-purple-500-solid)] flex items-center justify-center">
              <Lightbulb className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-800">AI Waste Analysis</span>
            <RefreshButton
              onRefresh={() => { setWasteAiRefreshKey(k => k + 1); return Promise.resolve(); }}
              busy={wasteAiLoading}
              title="Refresh AI analysis (calls the AI once)"
              className="ml-auto gap-1 text-[9px] font-semibold text-purple-600 hover:text-purple-800 hover:bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 transition-colors"
              iconClassName="w-2.5 h-2.5"
            >
              Refresh
            </RefreshButton>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
              wasteAnalysis.source === 'live'
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-amber-50 text-amber-600'
            }`}>
              {wasteAnalysis.source === 'live' ? '● AI live' : '● Offline estimate'}
            </span>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
              wasteAnalysis.data.trend === 'increasing' ? 'bg-red-50 text-red-700' :
              wasteAnalysis.data.trend === 'decreasing' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
            }`}>
              {wasteAnalysis.data.trend === 'increasing' ? '📈 Increasing' : wasteAnalysis.data.trend === 'decreasing' ? '📉 Decreasing' : '➡️ Stable'}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Top waste items */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Top Waste Items</p>
                <div className="space-y-2">
                  {wasteAnalysis.data.topWasteItems.map(item => (
                    <div key={item.name} className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-red-500">₹{Number(item.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-red-400" style={{ width: `${item.percentage}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">By Reason</p>
                <div className="space-y-2">
                  {wasteAnalysis.data.wasteByReason.map(r => (
                    <div key={r.reason} className="flex items-center justify-between">
                      <span className="text-xs capitalize font-semibold text-gray-700">{r.reason}</span>
                      <span className="text-[10px] font-bold text-gray-500">{r.count}x · ₹{Number(r.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actionable advice */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5" /> Actionable Advice
              </p>
              <ul className="space-y-1.5">
                {wasteAnalysis.data.actionableAdvice.map((advice, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-900">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber-500-solid)] mt-1 shrink-0" />
                    {advice}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      )}

      {/* Waste entries as cards — every row comes from the backend feed */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        className="space-y-3"
      >
        {wasteLog.length === 0 ? (
          <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-10 text-center shadow-sm">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <p className="text-sm font-semibold text-gray-600">No waste logged yet</p>
            <p className="text-xs text-gray-400 mt-1">
              {events === null
                ? 'Offline — waste activity is unavailable until the connection is back.'
                : 'Logged waste entries will appear here, synced from your database.'}
            </p>
          </div>
        ) : (
          wasteLog.map((w, i) => (
            <motion.div key={w.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}
              className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-lg">
                    {reasonIcons[w.reason] || '📦'}
                  </div>
                  <div>
                    <p className="text-sm font-bold">{w.item}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{w.reason} · {w.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold font-mono text-red-600">-{w.quantity} {w.unit}</p>
                  <p className="text-xs text-gray-500">₹{Number(w.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </motion.div>
    </div>
  );
}
