import { useState } from 'react';
import { ShoppingCart, Check, X, History, Trash2, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PURCHASES } from '../data';
import { createPurchase } from '../../../src/api/client';
import { useNotify, useInventory, usePurchasesCtx } from '../InventoryManager';
import type { Purchase } from '../types';

interface SaveResult {
  success: boolean;
  id?: string;
}

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
  const { refreshItems } = useInventory();
  const { purchases, synced, addPurchase, updatePurchase, removePurchase } = usePurchasesCtx();
  const [selectedItem, setSelectedItem] = useState<typeof QUICK_ITEMS[0] | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [saved, setSaved] = useState<{ item: string; qty: string; unit: string }[]>([]);

  // Edit modal state
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [editForm, setEditForm] = useState({ item: '', supplier: '', quantity: '', unit: '', price: '' });

  // Real history comes from the shared purchases context (loaded once by
  // InventoryManager). Falls back to the static demo list when offline — a
  // successful-but-empty result shows the empty state instead.
  const recentPurchases: Purchase[] = purchases ?? PURCHASES;

  const handleQuickTap = (item: typeof QUICK_ITEMS[0]) => {
    setSelectedItem(item);
    setPrice(String(item.defaultPrice));
    setQty('');
  };

  const handleSave = async () => {
    if (!qty || parseFloat(qty) <= 0) {
      notify('Enter a quantity', 'warning');
      return;
    }
    const name = selectedItem?.name || '';
    const qtyNum = parseFloat(qty);
    const unit = selectedItem?.unit || 'kg';
    const priceNum = parseFloat(price) || 0;

    // Persist to the backend. The backend purchase service now increases stock
    // through the centralized stock engine (stock + avg cost + event + audit),
    // so we do NOT mutate stock locally here — after a successful save we
    // refresh the item catalog so the UI shows the updated stock.
    let result: SaveResult = { success: false };
    try {
      const created = await createPurchase({
        item: name,
        quantity: qtyNum,
        unit,
        price: priceNum,
        supplier: selectedItem?.defaultSupplier || 'Local Vendor',
        date: new Date().toISOString().slice(0, 10),
        status: 'completed',
      });
      result = { success: true, id: created?._id };
      if (created && created._id) {
        addPurchase({
          id: created._id,
          supplier: created.supplier || 'Local Vendor',
          item: created.item || name,
          quantity: created.quantity ?? qtyNum,
          unit: created.unit || unit,
          price: created.price ?? priceNum,
          total: created.total ?? qtyNum * priceNum,
          date: created.date || new Date().toISOString().slice(0, 10),
          status: created.status || 'completed',
        });
        // Pull the latest product stock from the backend so the Items page and
        // every other consumer reflect the new quantity immediately.
        await refreshItems();
      }
    } catch {
      result = { success: false };
    }

    if (result.success) {
      setSaved(prev => [{ item: name, qty, unit }, ...prev]);
      notify(`${qty} ${unit} ${name} added`, 'success');
    } else {
      notify('Purchase saved locally — could not sync to server', 'warning');
    }
    setSelectedItem(null);
    setQty('');
    setPrice('');
  };

  const openEdit = (p: Purchase) => {
    setEditing(p);
    setEditForm({
      item: p.item,
      supplier: p.supplier === '—' ? '' : p.supplier,
      quantity: String(p.quantity),
      unit: p.unit,
      price: String(p.price),
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const qtyNum = parseFloat(editForm.quantity);
    const priceNum = parseFloat(editForm.price);
    if (!editForm.item.trim()) {
      notify('Item name is required', 'warning');
      return;
    }
    if (Number.isNaN(qtyNum) || qtyNum <= 0) {
      notify('Enter a valid quantity', 'warning');
      return;
    }
    if (Number.isNaN(priceNum) || priceNum < 0) {
      notify('Enter a valid price', 'warning');
      return;
    }
    const ok = await updatePurchase(editing.id, {
      item: editForm.item.trim(),
      supplier: editForm.supplier.trim() || 'Local Vendor',
      quantity: qtyNum,
      unit: editForm.unit.trim() || 'kg',
      price: priceNum,
    });
    notify(ok ? 'Purchase updated' : 'Could not update purchase — try again', ok ? 'success' : 'warning');
    if (ok) setEditing(null);
  };

  const handleDelete = async (id: string, item: string) => {
    if (!window.confirm(`Delete this ${item} purchase?`)) return;
    const ok = await removePurchase(id);
    notify(ok ? `${item} purchase removed` : `Could not delete ${item} — try again`, ok ? 'info' : 'warning');
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
          {synced ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">Synced</span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold">Offline demo</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {recentPurchases.slice(0, 8).map(p => (
            <div key={p.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-sm font-semibold truncate">{p.item}</span>
                <span className="text-xs text-gray-400">×{p.quantity} {p.unit}</span>
              </div>
              <div className="flex items-center gap-1 text-right shrink-0">
                <div className="mr-1.5">
                  <span className="text-sm font-bold font-mono">₹{p.total}</span>
                  <p className="text-[10px] text-gray-400">{p.supplier}</p>
                </div>
                <button onClick={() => openEdit(p)}
                  title="Edit purchase"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 transition-all cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(p.id, p.item)}
                  title="Delete purchase"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {recentPurchases.length === 0 && (
            <p className="text-xs text-gray-400 col-span-full py-3 text-center">No purchases recorded yet.</p>
          )}
        </div>
      </motion.div>

      {/* Just saved indicator */}
      {saved.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs text-emerald-600 font-semibold">
          <Check className="w-4 h-4" />
          Last saved: {saved[0].qty} {saved[0].unit} {saved[0].item}
        </motion.div>
      )}

      {/* Edit purchase modal */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
          >
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ duration: 0.18 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-5 py-4 bg-gradient-to-r from-[#004ac6]/5 to-blue-50 border-b border-[#004ac6]/10 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold">Edit Purchase</h3>
                  <p className="text-xs text-gray-500">Correct the details — the total updates automatically.</p>
                </div>
                <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-white/50 rounded-xl cursor-pointer transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item</label>
                  <input type="text" value={editForm.item} onChange={e => setEditForm(f => ({ ...f, item: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Supplier</label>
                  <input type="text" value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                    <input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Unit</label>
                    <input type="text" value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Price per unit (₹)</label>
                  <input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                    onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                  />
                </div>
                {editForm.quantity && editForm.price && (
                  <p className="text-sm text-gray-500">
                    New total:{' '}
                    <span className="text-emerald-600 font-bold font-mono">₹{(parseFloat(editForm.quantity) * parseFloat(editForm.price)).toFixed(2)}</span>
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setEditing(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button onClick={handleSaveEdit}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#004ac6] hover:bg-[#003da6] text-white text-sm font-bold transition-all cursor-pointer shadow-sm"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
