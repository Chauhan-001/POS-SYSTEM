import { useState } from 'react';
import { ShoppingCart, Check, X, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PURCHASES } from '../data';
import { useNotify, useInventory } from '../InventoryManager';

const QUICK_ITEMS = [
  { name: 'Milk', unit: 'L', defaultPrice: 56, defaultSupplier: 'Amul Dairy', emoji: '🥛' },
  { name: 'Bread', unit: 'pcs', defaultPrice: 35, defaultSupplier: 'Modern Bakery', emoji: '🍞' },
  { name: 'Tea Powder', unit: 'kg', defaultPrice: 340, defaultSupplier: 'Tata Consumer', emoji: '🫖' },
  { name: 'Sugar', unit: 'kg', defaultPrice: 42, defaultSupplier: 'Local Vendor', emoji: '🍚' },
  { name: 'Cooking Oil', unit: 'L', defaultPrice: 195, defaultSupplier: 'Fortune Oil', emoji: '🫒' },
  { name: 'Potato', unit: 'kg', defaultPrice: 28, defaultSupplier: 'Local Vendor', emoji: '🥔' },
  { name: 'Lemon', unit: 'pcs', defaultPrice: 5, defaultSupplier: 'Local Vendor', emoji: '🍋' },
  { name: 'Chicken', unit: 'kg', defaultPrice: 220, defaultSupplier: 'Poultry Farm', emoji: '🍗' },
];

export default function PurchaseEntry() {
  const notify = useNotify();
  const { addStock } = useInventory();
  const [selectedItem, setSelectedItem] = useState<typeof QUICK_ITEMS[0] | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [saved, setSaved] = useState<{ item: string; qty: string; unit: string }[]>([]);

  const handleQuickTap = (item: typeof QUICK_ITEMS[0]) => {
    setSelectedItem(item);
    setPrice(String(item.defaultPrice));
    setQty('');
  };

  const handleSave = () => {
    if (!qty || parseFloat(qty) <= 0) {
      notify('Enter a quantity', 'warning');
      return;
    }
    const name = selectedItem?.name || '';
    const qtyNum = parseFloat(qty);
    addStock(name, qtyNum);
    setSaved(prev => [{ item: name, qty, unit: selectedItem?.unit || '' }, ...prev]);
    notify(`${qty} ${selectedItem?.unit} ${name} added`, 'success');
    setSelectedItem(null);
    setQty('');
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Add Stock</h1>
        <p className="text-xs text-gray-400 mt-0.5">Tap what you received, enter quantity, done.</p>
      </div>

      {/* Quick items — large tappable buttons */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {QUICK_ITEMS.map((item, i) => {
            const isSelected = selectedItem?.name === item.name;
            return (
              <motion.button key={item.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}
                onClick={() => handleQuickTap(item)}
                className={`relative rounded-2xl border-2 p-5 text-left transition-all cursor-pointer ${
                  isSelected ? 'border-[#004ac6] bg-[#004ac6]/5 shadow-md' : 'border-[#e1e2ed] bg-white hover:border-[#004ac6]/30 hover:shadow-md'
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-2 -right-2 w-7 h-7 bg-[#004ac6] rounded-full flex items-center justify-center shadow-sm">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="text-2xl mb-2">{item.emoji}</div>
                <p className="text-base font-bold">{item.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">₹{item.defaultPrice}/{item.unit}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{item.defaultSupplier}</p>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Quick form */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl border border-[#004ac6]/20 shadow-lg overflow-hidden"
          >
            <div className="p-5 bg-gradient-to-r from-[#004ac6]/5 to-blue-50 border-b border-[#004ac6]/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{selectedItem.emoji}</div>
                  <div>
                    <p className="text-base font-bold">{selectedItem.name}</p>
                    <p className="text-xs text-gray-500">{selectedItem.defaultSupplier}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-white/50 rounded-xl cursor-pointer transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-5">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1 w-full">
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity ({selectedItem.unit})</label>
                  <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="e.g. 20" autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                  />
                </div>
                <div className="flex-1 w-full">
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Price per {selectedItem.unit} (₹)</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                  />
                </div>
                <button onClick={handleSave}
                  className="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <ShoppingCart className="w-5 h-5" />
                  Save {qty && price ? `₹${(parseFloat(qty) * parseFloat(price)).toFixed(0)}` : ''}
                </button>
              </div>
              {qty && price && (
                <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                  Total: <span className="text-emerald-600 font-bold font-mono text-base">₹{(parseFloat(qty) * parseFloat(price)).toFixed(2)}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent purchases */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold">Recent Purchases</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PURCHASES.slice(0, 6).map(p => (
            <div key={p.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold">{p.item}</span>
                <span className="text-xs text-gray-400">×{p.quantity} {p.unit}</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold font-mono">₹{p.total}</span>
                <p className="text-[10px] text-gray-400">{p.supplier}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Just saved indicator */}
      {saved.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs text-emerald-600 font-semibold">
          <Check className="w-4 h-4" />
          Last saved: {saved[0].qty} {saved[0].unit} {saved[0].item}
        </motion.div>
      )}
    </div>
  );
}