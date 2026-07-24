import { Trash2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WASTE_ENTRIES, INVENTORY_ITEMS } from '../data';
import { useNotify, useInventory } from '../InventoryManager';

const WASTE_REASONS = ['spoiled', 'burnt', 'expired', 'dropped', 'other'] as const;

export default function WasteManagement() {
  const notify = useNotify();
  const { removeStock } = useInventory();
  const [wasteLog, setWasteLog] = useState(WASTE_ENTRIES);
  const [showForm, setShowForm] = useState(false);
  const [formItem, setFormItem] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formReason, setFormReason] = useState('spoiled');

  const totalWaste = wasteLog.reduce((s, w) => s + w.cost, 0);

  const handleSubmit = () => {
    const item = INVENTORY_ITEMS.find(i => i.name === formItem);
    if (!item || !formQty || parseFloat(formQty) <= 0) {
      notify('Select an item and enter quantity', 'warning');
      return;
    }
    const cost = parseFloat(formQty) * item.averageCost;
    removeStock(item.name, parseFloat(formQty));
    setWasteLog(prev => [{
      id: `wst_${Date.now()}`, item: item.name, quantity: parseFloat(formQty),
      unit: item.unit, reason: formReason as any, cost: Math.round(cost), date: new Date().toISOString().slice(0, 10)
    }, ...prev]);
    notify(`${formQty} ${item.unit} ${item.name} logged as waste`, 'warning');
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
                  {INVENTORY_ITEMS.map(i => <option key={i.id} value={i.name}>{i.name} ({i.currentStock} {i.unit})</option>)}
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