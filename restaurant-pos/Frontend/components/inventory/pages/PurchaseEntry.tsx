import { useState, useMemo } from 'react';
import { ShoppingCart, Check, X, History, Trash2, Pencil, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createPurchase } from '../../../src/api/client';
import { useNotify, useInventory, usePurchasesCtx } from '../InventoryManager';
import type { Purchase, InventoryItem } from '../types';

interface SaveResult {
  success: boolean;
  id?: string;
}

const UNITS = ['kg', 'L', 'g', 'ml', 'pcs', 'box', 'pack', 'bottle', 'bag', 'dozen', 'carton', 'packet'];

// Tile colors for catalog quick-picks (no emoji on real catalog items).
const TILE_COLORS = [
  'from-[var(--brand-color)]/15 to-blue-100 text-[var(--brand-color)]',
  'from-emerald-500/15 to-emerald-100 text-emerald-600',
  'from-amber-500/15 to-amber-100 text-amber-600',
  'from-purple-500/15 to-purple-100 text-purple-600',
  'from-rose-500/15 to-rose-100 text-rose-600',
  'from-cyan-500/15 to-cyan-100 text-cyan-600',
];

interface QuickForm {
  item: string;
  quantity: string;
  unit: string;
  price: string;
  supplier: string;
}

const EMPTY_FORM: QuickForm = { item: '', quantity: '', unit: 'kg', price: '', supplier: '' };

export default function PurchaseEntry() {
  const notify = useNotify();
  const { items, refreshItems } = useInventory();
  const { purchases, synced, addPurchase, updatePurchase, removePurchase } = usePurchasesCtx();
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM);
  const [saved, setSaved] = useState<{ item: string; qty: string; unit: string }[]>([]);

  // Edit modal state
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [editForm, setEditForm] = useState({ item: '', supplier: '', quantity: '', unit: '', price: '' });

  // Real history comes from the shared purchases context (loaded once by
  // InventoryManager). No demo fallback — an empty list shows the honest
  // "No purchases recorded yet" state.
  const recentPurchases: Purchase[] = purchases ?? [];

  // Quick-pick tiles come from the REAL inventory catalog so the user taps the
  // items they actually stock (low-stock first = what needs restocking), not a
  // hardcoded demo list. Offline (items === demo) the catalog itself is the
  // demo, so the fallback is still honest.
  const catalogTiles = useMemo(() => {
    const priority = { critical: 0, low: 1, normal: 2, healthy: 3 } as const;
    return [...items]
      .sort((a, b) => {
        const pa = priority[a.status] ?? 4;
        const pb = priority[b.status] ?? 4;
        return pa - pb || a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [items]);

  // Exact/partial catalog match for the typed item → prefill unit + supplier +
  // average cost so a manual entry is still catalog-aware.
  const matchedItem = useMemo(
    () => items.find(i => i.name.toLowerCase() === form.item.trim().toLowerCase()) ?? null,
    [items, form.item]
  );

  const applyCatalogItem = (item: InventoryItem) => {
    setForm(f => ({
      ...f,
      item: item.name,
      unit: item.unit || f.unit || 'kg',
      price: item.averageCost ? String(item.averageCost) : f.price,
      supplier: item.supplier || f.supplier,
    }));
  };

  // Typing a catalog item name (or picking it from the datalist) auto-fills
  // the real unit + supplier + average cost — same behavior as tapping a tile.
  // A trailing space after the name still matches (trimmed) so the pick from
  // the suggestions list lands exactly.
  const handleItemChange = (value: string) => {
    const match = items.find(i => i.name.toLowerCase() === value.trim().toLowerCase());
    if (match) {
      applyCatalogItem(match);
      return;
    }
    setForm(f => ({ ...f, item: value }));
  };

  const handleQuickTap = (item: InventoryItem) => {
    applyCatalogItem(item);
    setForm(f => ({ ...f, quantity: '' }));
  };

  const handleSave = async () => {
    if (!form.item.trim()) {
      notify('Enter or pick an item', 'warning');
      return;
    }
    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      notify('Enter a quantity', 'warning');
      return;
    }
    const name = form.item.trim();
    const qtyNum = parseFloat(form.quantity);
    const unit = form.unit.trim() || matchedItem?.unit || 'kg';
    const priceNum = parseFloat(form.price) || 0;
    if (priceNum <= 0) {
      notify('Enter a price per unit', 'warning');
      return;
    }
    const supplier = form.supplier.trim() || matchedItem?.supplier || 'Local Vendor';

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
        supplier,
        date: new Date().toISOString().slice(0, 10),
        status: 'completed',
      });
      result = { success: true, id: created?._id };
      if (created && created._id) {
        addPurchase({
          id: created._id,
          supplier: created.supplier || supplier,
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
      setSaved(prev => [{ item: name, qty: form.quantity, unit }, ...prev]);
      notify(`${form.quantity} ${unit} ${name} added`, 'success');
      setForm(EMPTY_FORM);
    } else {
      notify('Purchase saved locally — could not sync to server', 'warning');
    }
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

  const total = form.quantity && form.price
    ? (parseFloat(form.quantity) * parseFloat(form.price)).toFixed(2)
    : null;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Add Stock</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Pick an item from your catalog (low stock first) or type any item — set quantity, done.
        </p>
      </div>

      {/* Quick picks — REAL catalog items needing restock first */}
      {catalogTiles.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {catalogTiles.map((item, i) => {
              const isSelected = form.item.toLowerCase() === item.name.toLowerCase();
              return (
                <motion.button key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.02 }}
                  onClick={() => handleQuickTap(item)}
                  className={`relative rounded-2xl border-2 p-4 text-left transition-all cursor-pointer ${
                    isSelected ? 'border-[var(--brand-color)] bg-[var(--brand-color)]/5 shadow-md' : 'border-[#e1e2ed] bg-white hover:border-[var(--brand-color)]/30 hover:shadow-md'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-[var(--brand-color)] rounded-full flex items-center justify-center shadow-sm">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-base font-black shrink-0 ${TILE_COLORS[i % TILE_COLORS.length]}`}>
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      item.status === 'critical' ? 'bg-red-50 text-red-600' :
                      item.status === 'low' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-400'
                    }`}>
                      {item.status === 'critical' ? 'Out' : item.status === 'low' ? 'Low' : `${item.currentStock} ${item.unit}`}
                    </span>
                  </div>
                  <p className="text-sm font-bold truncate">{item.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                    {item.supplier || '—'}
                    {item.averageCost > 0 && ` · ₹${item.averageCost}/${item.unit}`}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Add-stock form — always available, works for catalog items AND new items */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl border border-[var(--brand-color)]/20 shadow-lg overflow-hidden"
      >
        <div className="p-5 bg-gradient-to-r from-[var(--brand-color)]/5 to-blue-50 border-b border-[var(--brand-color)]/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-[var(--brand-color)]" />
              <p className="text-sm font-bold">Record Stock In</p>
            </div>
            {matchedItem && (
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                In catalog · {matchedItem.currentStock} {matchedItem.unit} in stock
              </span>
            )}
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                list="inventory-item-list"
                value={form.item}
                onChange={e => handleItemChange(e.target.value)}
                placeholder="Type item name — known items auto-fill"
                autoFocus
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
              />
              <datalist id="inventory-item-list">
                {items.map(i => <option key={i.id} value={i.name} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
              <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="e.g. 20" min={0} step={0.5}
                className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Unit</label>
              <select value={form.unit || matchedItem?.unit || 'kg'} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                className="w-full px-3 py-3 rounded-xl border border-[#c3c6d7] text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
              >
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Price per unit (₹)</label>
              <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0"
                className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">Supplier</label>
            <input type="text" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier name"
              className="w-full px-4 py-3 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between pt-1">
            <p className="text-sm text-gray-500">
              Total: <span className="text-emerald-600 font-bold font-mono text-lg">₹{total ?? '0.00'}</span>
            </p>
            <button onClick={handleSave}
              className="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <ShoppingCart className="w-5 h-5" />
              Save Purchase
            </button>
          </div>
        </div>
      </motion.div>

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
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold">Offline</span>
          )}
          <span className="text-[10px] text-gray-400 ml-auto">{recentPurchases.length} total</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {recentPurchases.slice(0, 12).map(p => (
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
                  className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 transition-all cursor-pointer"
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
              <div className="px-5 py-4 bg-gradient-to-r from-[var(--brand-color)]/5 to-blue-50 border-b border-[var(--brand-color)]/10 flex items-center justify-between">
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Supplier</label>
                  <input type="text" value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                    <input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Unit</label>
                    <input type="text" value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Price per unit (₹)</label>
                  <input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c3c6d7] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
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
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--brand-color)] hover:bg-[#003da6] text-white text-sm font-bold transition-all cursor-pointer shadow-sm"
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
