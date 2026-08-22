import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Phone, MapPin, Package as PackageIcon, ShoppingCart, ChevronRight, Plus, Edit2, Trash2 } from 'lucide-react';
import { fetchSuppliers, createSupplier as apiCreateSupplier, updateSupplier as apiUpdateSupplier, deleteSupplier as apiDeleteSupplier, CACHE_INVALIDATED_EVENT } from '../../../src/api/client';
import type { Supplier } from '../types';
import Modal from '../components/Modal';
import { useNotify, useInventory } from '../InventoryManager';

const supplierGradients = [
  'from-blue-500 to-blue-600', 'from-emerald-500 to-emerald-600', 'from-purple-500 to-purple-600',
  'from-amber-500 to-amber-600', 'from-rose-500 to-rose-600', 'from-cyan-500 to-cyan-600',
  'from-indigo-500 to-indigo-600',
];

type SupplierForm = {
  name: string; phone: string; email: string; address: string; items: string[];
};

const EMPTY_FORM: SupplierForm = { name: '', phone: '', email: '', address: '', items: [] };

function generateId() {
  return `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

export default function SupplierManagement({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const notify = useNotify();
  const { items: invItems } = useInventory();
  // Backend-driven supplier list — real collection, restaurant-scoped.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);

  const suppliersLoadSeq = useRef(0);
  const loadSuppliers = useCallback(async () => {
    const seq = ++suppliersLoadSeq.current;
    try {
      const data = await fetchSuppliers({ limit: 200 });
      if (seq !== suppliersLoadSeq.current) return;
      if (Array.isArray(data)) {
        setSuppliers(data.map((s: any) => ({
          id: s.id, name: s.name, phone: s.phone || '', email: s.email || '',
          address: s.address || '', items: Array.isArray(s.items) ? s.items : [],
          lastPurchase: '-', averageCost: 0, status: s.status || 'active', totalPurchases: 0,
        })));
      }
    } catch { /* offline — keep empty list */ }
  }, []);

  useEffect(() => { void loadSuppliers(); }, [loadSuppliers]);

  // Re-fetch when a supplier write (create/edit/delete here or on another
  // screen) invalidates the cache — fetchSuppliers is TTL-gated (1h), so this
  // only hits the network when the cache was just cleared.
  useEffect(() => {
    const onInvalidated = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'pos_suppliers') void loadSuppliers();
    };
    window.addEventListener(CACHE_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(CACHE_INVALIDATED_EVENT, onInvalidated);
  }, [loadSuppliers]);
  const [modalMode, setModalMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const allItemNames = invItems.map(i => i.name).sort();

  const openAdd = () => {
    setModalMode('add');
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const openEdit = (s: Supplier) => {
    setModalMode('edit');
    setEditingId(s.id);
    setForm({ name: s.name, phone: s.phone, email: s.email, address: s.address, items: [...s.items] });
  };

  const closeModal = () => {
    setModalMode('closed');
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const toggleItem = (item: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.includes(item) ? prev.items.filter(i => i !== item) : [...prev.items, item]
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { notify('Supplier name is required', 'warning'); return; }
    if (!form.phone.trim()) { notify('Phone number is required', 'warning'); return; }

    if (modalMode === 'edit' && editingId) {
      const ok = await apiUpdateSupplier(editingId, {
        name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        address: form.address.trim(), items: form.items,
      });
      if (!ok) { notify('Could not update supplier — try again', 'warning'); return; }
      setSuppliers(prev => prev.map(s =>
        s.id === editingId ? { ...s, name: form.name, phone: form.phone, email: form.email, address: form.address, items: form.items } : s
      ));
      if (selected?.id === editingId) setSelected(prev => prev ? { ...prev, name: form.name, phone: form.phone, email: form.email, address: form.address, items: form.items } : null);
      notify(`${form.name} updated`, 'success');
    } else {
      const created = await apiCreateSupplier({
        name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        address: form.address.trim(), items: form.items, status: 'active',
      });
      if (!created) { notify('Could not add supplier — try again', 'warning'); return; }
      const newSup: Supplier = {
        id: created._id || created.id || generateId(), name: form.name, phone: form.phone, email: form.email,
        address: form.address, items: form.items, lastPurchase: '-', averageCost: 0,
        status: 'active', totalPurchases: 0
      };
      setSuppliers(prev => [newSup, ...prev]);
      notify(`${form.name} added`, 'success');
    }
    closeModal();
  };

  const confirmDelete = (s: Supplier) => {
    setDeleteTarget(s);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (/^[a-fA-F0-9]{24}$/.test(deleteTarget.id)) {
      const ok = await apiDeleteSupplier(deleteTarget.id);
      if (!ok) { notify('Could not delete supplier — try again', 'warning'); setDeleteTarget(null); return; }
    }
    setSuppliers(prev => prev.filter(s => s.id !== deleteTarget.id));
    if (selected?.id === deleteTarget.id) setSelected(null);
    notify(`${deleteTarget.name} removed`, 'warning');
    setDeleteTarget(null);
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Suppliers</h1>
          <p className="text-xs text-gray-400 mt-0.5">{suppliers.length} suppliers</p>
        </div>
        <button onClick={openAdd}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {/* Supplier cards */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {suppliers.map((supplier, i) => {
          const initials = supplier.name.split(' ').map(n => n[0]).slice(0, 2).join('');
          const grad = supplierGradients[i % supplierGradients.length];
          const isActive = supplier.status === 'active';
          return (
            <motion.div key={supplier.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.04 }}
              className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 hover:shadow-lg hover:border-[var(--brand-color)]/20 transition-all group"
            >
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{supplier.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[var(--color-emerald-500-solid)]' : 'bg-gray-400'}`} />
                    <span className="text-[10px] text-gray-400 capitalize">{supplier.status}</span>
                  </div>
                </div>
                <button onClick={() => setSelected(supplier)} className="p-1 text-gray-300 hover:text-[var(--brand-color)] transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4 min-h-[28px]">
                {supplier.items.slice(0, 4).map(item => (
                  <span key={item} className="px-2.5 py-1 bg-gray-50 border border-[var(--color-border-default)] rounded-full text-[10px] font-semibold text-gray-500">{item}</span>
                ))}
                {supplier.items.length > 4 && (
                  <span className="px-2.5 py-1 bg-gray-50 border border-[var(--color-border-default)] rounded-full text-[10px] font-semibold text-gray-400">+{supplier.items.length - 4}</span>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border-default)]">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Phone className="w-3 h-3" />
                  <span>{supplier.phone}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(supplier); }}
                    className="p-1.5 text-gray-300 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); confirmDelete(supplier); }}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Detail panel */}
      <AnimatePresence>
        {selected && (
          <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelected(null)}>
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-sm bg-[var(--color-bg-white)] border-l border-[var(--color-border-default)] overflow-y-auto" onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] px-5 py-4 flex items-center justify-between z-10">
                <h2 className="font-bold text-base">{selected.name}</h2>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setSelected(null); openEdit(selected); }} className="text-gray-400 hover:text-[var(--brand-color)] p-1 cursor-pointer"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                    {selected.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <p className="font-bold text-base">{selected.name}</p>
                    <p className="text-xs text-gray-500">{selected.totalPurchases} orders · {selected.status}</p>
                  </div>
                </div>

                <div className="space-y-3 bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-center gap-3 text-sm"><Phone className="w-4 h-4 text-gray-400" />{selected.phone}</div>
                  {selected.email && <div className="flex items-center gap-3 text-sm"><MapPin className="w-4 h-4 text-gray-400" />{selected.email}</div>}
                  <div className="flex items-center gap-3 text-sm"><MapPin className="w-4 h-4 text-gray-400" />{selected.address}</div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Items Supplied</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.items.map(item => (
                      <span key={item} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-700">
                        <PackageIcon className="w-3 h-3" />{item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--color-bg-white)] rounded-xl p-4 border border-[var(--color-border-default)]">
                    <p className="text-[10px] text-gray-400 uppercase font-semibold">Avg Cost</p>
                    <p className="text-xl font-bold font-mono">₹{Number(selected.averageCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-[var(--color-bg-white)] rounded-xl p-4 border border-[var(--color-border-default)]">
                    <p className="text-[10px] text-gray-400 uppercase font-semibold">Last Order</p>
                    <p className="text-sm font-bold">{selected.lastPurchase}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setSelected(null); onNavigate?.('items'); }}
                    className="flex-1 py-3 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2">
                    <ShoppingCart className="w-4 h-4" /> New Order
                  </button>
                  <button onClick={() => { setSelected(null); openEdit(selected); }}
                    className="flex-1 py-3 border border-[var(--color-border-default)] text-gray-600 rounded-2xl text-sm font-bold hover:border-[var(--brand-color)]/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" /> Edit
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add / Edit Supplier Modal */}
      <Modal isOpen={modalMode !== 'closed'} onClose={closeModal} title={modalMode === 'edit' ? 'Edit Supplier' : 'Add Supplier'} size="md">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Supplier Name</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                placeholder="e.g. Amul Dairy" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                placeholder="+91 98765 43210" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Email</label>
              <input type="text" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                placeholder="email@example.com" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Address</label>
              <input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                placeholder="City, State" />
            </div>
          </div>

          {/* Items supplied - multi-select */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">Items Supplied</label>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded-xl border border-[var(--color-border-default)]">
              {allItemNames.map(item => {
                const selected = form.items.includes(item);
                return (
                  <button key={item} onClick={() => toggleItem(item)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      selected ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-[var(--brand-color)]/30'
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            {form.items.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.items.map(i => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-xl text-[10px] font-semibold text-blue-700">
                    {i}
                    <button onClick={() => toggleItem(i)} className="text-blue-400 hover:text-blue-600 ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-[var(--color-border-default)]">
            <button onClick={closeModal} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-primary-hover)] cursor-pointer shadow-sm transition-all">
              {modalMode === 'edit' ? 'Save Changes' : 'Add Supplier'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Remove Supplier" size="sm">
        <div className="text-center py-6">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-base font-bold mb-1">Remove {deleteTarget?.name}?</p>
          <p className="text-sm text-gray-500">This supplier and their records will be removed.</p>
        </div>
        <div className="flex gap-3 justify-center pt-4 border-t border-[var(--color-border-default)]">
          <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all">Cancel</button>
          <button onClick={handleDelete} className="px-5 py-2.5 bg-[var(--color-red-600-solid)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-red-700-solid)] cursor-pointer shadow-sm transition-all">Delete</button>
        </div>
      </Modal>
    </div>
  );
}