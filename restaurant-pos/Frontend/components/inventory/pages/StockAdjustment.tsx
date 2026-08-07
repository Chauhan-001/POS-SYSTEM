import { useState } from 'react';
import { Plus, Minus, CheckCircle, AlertTriangle, X, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotify, useInventory } from '../InventoryManager';

interface Adjustment {
  id: string;
  itemName: string;
  type: 'add' | 'remove';
  qty: number;
  reason: string;
}

export default function StockAdjustment() {
  const notify = useNotify();
  const { items, addStock, removeStock } = useInventory();
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formItem, setFormItem] = useState('');
  const [formType, setFormType] = useState<'add' | 'remove'>('add');
  const [formQty, setFormQty] = useState('');

  const actionItems = items.filter(i => i.status === 'low' || i.status === 'critical');

  const handleSubmit = async () => {
    const item = items.find(i => i.id === formItem);
    if (!item || !formQty || parseFloat(formQty) <= 0) {
      notify('Select an item and enter quantity', 'warning');
      return;
    }
    const qtyNum = parseFloat(formQty);
    // The centralized stock engine handles the stock change + InventoryEvent +
    // AuditLog server-side. addStock/removeStock persist via the engine.
    if (formType === 'add') {
      await addStock(item.name, qtyNum, item.unit, { type: 'adjustment', details: 'Manual addition', reason: 'Manual addition' });
    } else {
      await removeStock(item.name, qtyNum, { type: 'adjustment', details: 'Manual removal', reason: 'Manual removal' });
    }
    setAdjustments(prev => [{
      id: `${item.id}_${Date.now()}`, itemName: item.name, type: formType,
      qty: qtyNum, reason: formType === 'add' ? 'Manual addition' : 'Manual removal'
    }, ...prev]);
    notify(`${formType === 'add' ? 'Added' : 'Removed'} ${formQty} ${item.unit} ${item.name}`, 'success');
    setFormItem('');
    setFormQty('');
    setShowForm(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Adjust Stock</h1>
          <p className="text-xs text-gray-400 mt-0.5">Add or remove stock manually</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#004ac6] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Adjustment
        </button>
      </div>

      {/* Low stock alert */}
      {actionItems.length > 0 && !showForm && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">{actionItems.length} items need restocking</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {actionItems.slice(0, 5).map(i => (
                <span key={i.id} className="text-[10px] px-2.5 py-1 bg-white rounded-full text-amber-700 border border-amber-200 font-semibold">
                  {i.name} ({i.currentStock} {i.unit})
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Adjustment form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold">New Adjustment</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item</label>
                <select value={formItem} onChange={e => setFormItem(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                >
                  <option value="">Select item...</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit})</option>)}
                </select>
              </div>
              <div className="w-full sm:w-28">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                <input type="number" value={formQty} onChange={e => setFormQty(e.target.value)} placeholder="0"
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Type</label>
                <div className="flex gap-1.5 h-full items-end">
                  <button onClick={() => setFormType('add')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${formType === 'add' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-gray-50 border border-[#e1e2ed] text-gray-500 hover:border-emerald-300'}`}
                  ><Plus className="w-4 h-4 inline mr-1" /> Add</button>
                  <button onClick={() => setFormType('remove')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${formType === 'remove' ? 'bg-red-600 text-white shadow-sm' : 'bg-gray-50 border border-[#e1e2ed] text-gray-500 hover:border-red-300'}`}
                  ><Minus className="w-4 h-4 inline mr-1" /> Remove</button>
                </div>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={handleSubmit}
                className="px-6 py-2.5 bg-[#004ac6] text-white rounded-xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm"
              >
                <CheckCircle className="w-4 h-4 inline mr-1.5" />Save Adjustment
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold">History</h2>
        </div>
        {adjustments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No adjustments yet</p>
        ) : (
          <div className="space-y-2">
            {adjustments.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full ${a.type === 'add' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="text-sm font-semibold">{a.itemName}</span>
                  <span className="text-xs text-gray-400">{a.reason}</span>
                </div>
                <span className={`text-sm font-bold font-mono ${a.type === 'add' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {a.type === 'add' ? '+' : '-'}{a.qty}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}