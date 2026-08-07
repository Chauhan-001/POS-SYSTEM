import { Trash2, Plus, X, BarChart3, TrendingUp, AlertTriangle, Lightbulb, Loader2 } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WASTE_ENTRIES } from '../data';
import { useNotify, useInventory } from '../InventoryManager';
import { analyzeWaste, type WasteAnalysis } from '../../../src/ai/aiData';

const WASTE_REASONS = ['spoiled', 'burnt', 'expired', 'dropped', 'other'] as const;

export default function WasteManagement({ moduleSettings }: { moduleSettings?: Record<string, boolean> }) {
  const notify = useNotify();
  const { items, removeStock } = useInventory();
  const [wasteLog, setWasteLog] = useState(WASTE_ENTRIES);
  const [showForm, setShowForm] = useState(false);
  const [formItem, setFormItem] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formReason, setFormReason] = useState('spoiled');

  const totalWaste = wasteLog.reduce((s, w) => s + w.cost, 0);
  const [wasteAnalysis, setWasteAnalysis] = useState<WasteAnalysis | null>(null);
  useEffect(() => {
    analyzeWaste(wasteLog).then(setWasteAnalysis).catch(() => setWasteAnalysis(null));
  }, [wasteLog]);

  const handleSubmit = async () => {
    const item = items.find(i => i.name === formItem);
    if (!item || !formQty || parseFloat(formQty) <= 0) {
      notify('Select an item and enter quantity', 'warning');
      return;
    }
    const qtyNum = parseFloat(formQty);
    const cost = qtyNum * item.averageCost;
    // The stock engine handles stock deduction + InventoryEvent (type waste) +
    // AuditLog server-side — no separate addEvent call needed.
    const detail = formReason === 'other'
      ? `${item.name} discarded`
      : `${formReason} ${item.name} discarded`;
    await removeStock(item.name, qtyNum, { type: 'waste', details: detail, reason: formReason });
    setWasteLog(prev => [{
      id: `wst_${Date.now()}`, item: item.name, quantity: qtyNum,
      unit: item.unit, reason: formReason as any, cost: Math.round(cost), date: new Date().toISOString().slice(0, 10)
    }, ...prev]);
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
          <p className="text-xs text-gray-400 mt-0.5">{wasteLog.length} entries · ₹{totalWaste} total</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-2xl text-sm font-bold hover:bg-red-700 transition-all cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" /> Log Waste
        </button>
      </div>

      {/* Add waste form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-2xl border border-red-200 p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold">Log Waste</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item</label>
                <select value={formItem} onChange={e => setFormItem(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                >
                  <option value="">Select...</option>
                  {items.map(i => <option key={i.id} value={i.name}>{i.name} ({i.currentStock} {i.unit})</option>)}
                </select>
              </div>
              <div className="w-full sm:w-28">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                <input type="number" value={formQty} onChange={e => setFormQty(e.target.value)} placeholder="0"
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Reason</label>
                <div className="flex gap-1.5 flex-wrap">
                  {WASTE_REASONS.map(r => (
                    <button key={r} onClick={() => setFormReason(r)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer capitalize ${
                        formReason === r ? 'bg-red-600 text-white shadow-sm' : 'bg-gray-50 border border-[#e1e2ed] text-gray-600 hover:border-red-300'
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
                className="px-6 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all cursor-pointer shadow-sm"
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
          className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden"
        >
          <div className="px-5 py-3.5 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-purple-500 flex items-center justify-center">
              <Lightbulb className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-800">AI Waste Analysis</span>
            <span className={`ml-auto text-[9px] font-semibold px-2 py-0.5 rounded-full ${
              wasteAnalysis.trend === 'increasing' ? 'bg-red-50 text-red-700' :
              wasteAnalysis.trend === 'decreasing' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
            }`}>
              {wasteAnalysis.trend === 'increasing' ? '📈 Increasing' : wasteAnalysis.trend === 'decreasing' ? '📉 Decreasing' : '➡️ Stable'}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Top waste items */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Top Waste Items</p>
                <div className="space-y-2">
                  {wasteAnalysis.topWasteItems.map(item => (
                    <div key={item.name} className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-red-500">₹{item.cost}</span>
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
                  {wasteAnalysis.wasteByReason.map(r => (
                    <div key={r.reason} className="flex items-center justify-between">
                      <span className="text-xs capitalize font-semibold text-gray-700">{r.reason}</span>
                      <span className="text-[10px] font-bold text-gray-500">{r.count}x · ₹{r.cost}</span>
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
                {wasteAnalysis.actionableAdvice.map((advice, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-900">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1 shrink-0" />
                    {advice}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      )}

      {/* Waste entries as cards */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        className="space-y-3"
      >
        {wasteLog.map((w, i) => (
          <motion.div key={w.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}
            className="bg-white rounded-2xl border border-[#e1e2ed] p-4 hover:shadow-md transition-all"
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
                <p className="text-xs text-gray-500">₹{w.cost}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}