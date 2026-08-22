import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus, Package, Edit2, Trash2, Search, X, History, ShoppingCart,
  Truck, Tag, Hourglass, Activity as ActivityIcon, AlertTriangle, Check, PackageX, Loader2, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import ImageInput from '../../common/ImageInput';
import ReceiptLoader from '../../ReceiptLoader';
import type { InventoryItem, Purchase, TimelineEntry } from '../types';
import { daysUntilExpiry } from '../expiryUtils';
import { useNotify, useInventory, usePurchasesCtx, useInventoryEventsCtx } from '../InventoryManager';
import { createPurchase, fetchSuppliers, createSupplier, adjustProductStock } from '../../../src/api/client';

type ItemForm = {
  name: string; category: string; unit: string; currentStock: string;
  minStock: string; maxStock: string; averageCost: string; image: string;
};

const EMPTY_FORM: ItemForm = {
  name: '', category: 'Dairy', unit: 'kg', currentStock: '0',
  minStock: '0', maxStock: '100', averageCost: '0', image: ''
};

function computeStatus(item: { currentStock: number; minStock: number }): InventoryItem['status'] {
  if (item.currentStock === 0) return 'critical';
  if (item.currentStock <= item.minStock * 0.5) return 'critical';
  if (item.currentStock <= item.minStock) return 'low';
  if (item.currentStock <= item.minStock * 1.5) return 'normal';
  return 'healthy';
}

function generateId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const statusGradient = (s: string) => {
  switch (s) {
    case 'healthy': return 'from-emerald-500 to-emerald-600';
    case 'normal': return 'from-blue-500 to-blue-600';
    case 'low': return 'from-amber-500 to-amber-600';
    case 'critical': return 'from-red-500 to-red-600';
    default: return 'from-gray-400 to-gray-500';
  }
};

type ExpiryView = 'all' | 'expiring' | 'expired';

/** Suppliers that carry no real name — the UI omits them ("don't mention"). */
const BLANK_SUPPLIERS = new Set(['', '—', '-', 'Voice', 'Unknown', 'unknown', 'N/A', 'n/a', 'None', 'none']);

const hasSupplier = (s?: string): boolean => !!s && !BLANK_SUPPLIERS.has(s.trim());

const EVENT_META: Record<string, { label: string; color: string; sign: string }> = {
  purchased: { label: 'Purchased', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', sign: '+' },
  purchase: { label: 'Purchased', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', sign: '+' },
  sold: { label: 'Sold', color: 'bg-blue-50 text-blue-700 border-blue-100', sign: '−' },
  adjusted: { label: 'Adjusted', color: 'bg-amber-50 text-amber-700 border-amber-100', sign: '±' },
  waste: { label: 'Waste', color: 'bg-red-50 text-red-700 border-red-100', sign: '−' },
  closing: { label: 'Closing', color: 'bg-gray-50 text-gray-600 border-gray-100', sign: '±' },
  return: { label: 'Return', color: 'bg-purple-50 text-purple-700 border-purple-100', sign: '+' },
};

const eventMeta = (type: string) => EVENT_META[type] || { label: type, color: 'bg-gray-50 text-gray-600 border-gray-100', sign: '±' };

export default function ItemsPage({ initialSearch = '' }: { initialSearch?: string }) {
  const notify = useNotify();
  const { items, synced, addItem, updateItem, removeItem, removeStock, refreshItems } = useInventory();
  const purchasesCtx = usePurchasesCtx();
  const eventsCtx = useInventoryEventsCtx();
  // Add-stock popup (per item card) — records a purchase so the item's stock
  // rises through the stock engine and appears in the item's history.
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockQty, setStockQty] = useState('1');
  const [stockPrice, setStockPrice] = useState('');
  const [stockSupplier, setStockSupplier] = useState('');
  const [stockExpiry, setStockExpiry] = useState('');
  const [savingStock, setSavingStock] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [categoryFilter, setCategoryFilter] = useState('All');
  // Expiry view: 'all' (default grid) | 'expiring' (≤7 days) | 'expired' (past due).
  const [expiryView, setExpiryView] = useState<ExpiryView>('all');
  // Item currently awaiting the second tap of the two-step Discard confirm.
  const [armDiscardId, setArmDiscardId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the arm-timeout if the page unmounts mid-arm.
  useEffect(() => () => { if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current); }, []);
  const [modalMode, setModalMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ItemForm, string>>>({});
  // Categories come from the REAL inventory catalog (plus any the user adds) —
  // never a hardcoded list, so the filter only shows categories that exist.
  const [categories, setCategories] = useState<string[]>([]);
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  // Category being renamed from the filter row (null = none).
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Sync the category list with the live catalog whenever it loads/changes.
  useEffect(() => {
    setCategories(prev => {
      const fromItems = [...new Set(items.map(i => i.category).filter(Boolean))] as string[];
      return [...new Set([...fromItems, ...prev])];
    });
  }, [items]);

  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    setCategories(prev => [...prev, trimmed]);
    updateField('category', trimmed);
    setShowNewCatInput(false);
    setNewCatName('');
    notify(`Category "${trimmed}" created`, 'success');
  };

  /** Rename a category across every item that uses it (real catalog updates). */
  const renameCategory = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingCategory(null);
      setRenameValue('');
      return;
    }
    // Rename on every item in this category (optimistic local + backend push).
    items.filter(i => i.category === oldName).forEach(i => {
      updateItem(i.id, { category: trimmed, lastUpdated: new Date().toISOString().slice(0, 10) });
    });
    // Refresh the category filter list and re-target the active filter.
    setCategories(prev => [...new Set([...prev.map(c => c === oldName ? trimmed : c).filter(Boolean)])]);
    setCategoryFilter(prev => prev === oldName ? trimmed : prev);
    setRenamingCategory(null);
    setRenameValue('');
    notify(`Category renamed to "${trimmed}"`, 'success');
  };

  // Expiry buckets — computed from REAL product expiryDate (none = safe).
  const expiryBuckets = useMemo(() => {
    const withExpiry = items.filter(i => i.expiryDate);
    const expired = withExpiry.filter(i => daysUntilExpiry(i.expiryDate!) < 0);
    const expiring = withExpiry.filter(i => {
      const d = daysUntilExpiry(i.expiryDate!);
      return d >= 0 && d <= 7;
    });
    return { expired, expiring };
  }, [items]);

  const filtered = items.filter(i => {
    if (expiryView === 'expired' && !expiryBuckets.expired.some(e => e.id === i.id)) return false;
    if (expiryView === 'expiring' && !expiryBuckets.expiring.some(e => e.id === i.id)) return false;
    if (categoryFilter !== 'All' && i.category !== categoryFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q);
  });

  const openAdd = () => {
    setModalMode('add');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowNewCatInput(false);
    setNewCatName('');
  };

  const openEdit = (item: InventoryItem) => {
    setModalMode('edit');
    setEditingId(item.id);
    setForm({
      name: item.name, category: item.category, unit: item.unit, currentStock: String(item.currentStock),
      minStock: String(item.minStock),
      maxStock: String(item.maxStock), averageCost: String(item.averageCost),
      image: item.image
    });
    setFormErrors({});
    setShowNewCatInput(false);
    setNewCatName('');
  };

  const closeModal = () => {
    setModalMode('closed');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowNewCatInput(false);
    setNewCatName('');
  };

  const updateField = (field: keyof ItemForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setFormErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof ItemForm, string>> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    const stock = Number(form.currentStock);
    const min = Number(form.minStock);
    const cost = Number(form.averageCost);
    if (isNaN(stock) || stock < 0) errs.currentStock = 'Valid stock required';
    if (isNaN(min) || min < 0) errs.minStock = 'Valid min stock required';
    if (isNaN(cost) || cost < 0) errs.averageCost = 'Valid cost required';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const currentStock = Number(form.currentStock);
    const minStock = Number(form.minStock);
    const maxStock = Number(form.maxStock);
    const averageCost = Number(form.averageCost);
    const status = computeStatus({ currentStock, minStock });
    const today = new Date().toISOString().slice(0, 10);

    if (modalMode === 'edit' && editingId) {
      const existing = items.find(i => i.id === editingId);
      const delta = currentStock - (existing?.currentStock ?? 0);
      // Stock edits go through the stock ENGINE (delta) so FIFO batches + the
      // event ledger stay consistent — never a raw currentStock overwrite that
      // would desync batches[]. Adjust FIRST, then save the other fields.
      if (delta !== 0 && /^[a-fA-F0-9]{24}$/.test(editingId)) {
        try {
          await adjustProductStock(editingId, { delta, type: 'adjustment', reason: 'Manual stock edit' });
        } catch {
          notify('Stock edit failed — check your connection', 'warning');
          return;
        }
      }
      updateItem(editingId, { name: form.name, category: form.category, unit: form.unit, currentStock, minStock, maxStock, averageCost, image: form.image, status, lastUpdated: today });
      notify(`${form.name} updated`, 'success');
    } else {
      addItem({
        id: generateId(), name: form.name, category: form.category, unit: form.unit,
        image: form.image || '', currentStock, minStock, maxStock, averageCost,
        supplier: '', status, lastUpdated: today
      });
      notify(`${form.name} added`, 'success');
    }
    closeModal();
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    removeItem(deleteTarget.id);
    notify(`${deleteTarget.name} removed`, 'warning');
    setDeleteTarget(null);
  };

  const openAddStock = (item: InventoryItem) => {
    setStockItem(item);
    setStockQty('1');
    setStockPrice(item.averageCost > 0 ? String(item.averageCost) : '');
    setStockSupplier(item.supplier || '');
    setStockExpiry('');
  };

  /** Best-effort: if the entered supplier is a real name not yet in the
   *  Supplier module, create it there. Never fails the purchase. */
  const ensureSupplierCreated = async (name: string, itemName: string) => {
    const trimmed = name.trim();
    if (!trimmed || BLANK_SUPPLIERS.has(trimmed)) return;
    try {
      const existing = await fetchSuppliers({ limit: 200 });
      const list = Array.isArray(existing) ? existing : [];
      if (list.some((s: any) => String(s.name || '').trim().toLowerCase() === trimmed.toLowerCase())) return;
      await createSupplier({
        name: trimmed,
        phone: '',
        email: '',
        address: '',
        items: [itemName],
        status: 'active',
      });
    } catch {
      // offline / conflict — the purchase still stands; Suppliers refreshes later.
    }
  };

  const handleAddStock = async () => {
    if (!stockItem) return;
    const qty = Number(stockQty);
    if (!(qty > 0)) { notify('Enter a quantity', 'warning'); return; }
    const unit = stockItem.unit || 'pcs';
    const price = Number(stockPrice) || 0;
    const typedSupplier = stockSupplier.trim();
    const supplier = typedSupplier || 'Local Vendor';
    const expiry = stockExpiry.trim();
    setSavingStock(true);
    try {
      const created = await createPurchase({
        item: stockItem.name,
        quantity: qty,
        unit,
        price,
        supplier,
        expiryDate: expiry || undefined,
        date: new Date().toISOString().slice(0, 10),
        status: 'completed',
      });
      if (created && created._id) {
        purchasesCtx.addPurchase({
          id: created._id,
          supplier: created.supplier || supplier,
          item: created.item || stockItem.name,
          quantity: created.quantity ?? qty,
          unit: created.unit || unit,
          price: created.price ?? price,
          total: created.total ?? qty * price,
          date: created.date || new Date().toISOString().slice(0, 10),
          status: created.status || 'completed',
        });
      }
      // New supplier detected → add to the Supplier module.
      if (typedSupplier) void ensureSupplierCreated(typedSupplier, stockItem.name);
      // The stock engine has already persisted the batch expiry onto the server
      // product (derived from the earliest remaining batch), so refreshItems()
      // below re-fetches it and the Expiry view reflects it. Do NOT call
      // updateItem() here — it sends the full inventoryItemToProduct payload
      // (stale currentStock/averageCost from the render closure) and would
      // overwrite the stock engine's updates.
      await refreshItems();
      notify(`${qty} ${unit} ${stockItem.name} added`, 'success');
      setStockItem(null);
    } catch {
      notify('Could not add stock — check your connection', 'warning');
    } finally {
      setSavingStock(false);
    }
  };

  /** Two-step one-tap Discard: first tap arms the button, second tap executes.
   *  Uses the stock engine (type 'waste', reason 'expired') so the InventoryEvent
   *  + AuditLog land server-side, then clears the batch expiry from the item. */
  const handleDiscard = async (item: InventoryItem) => {
    if (armDiscardId !== item.id) {
      setArmDiscardId(item.id);
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = setTimeout(() => {
        setArmDiscardId(prev => prev === item.id ? null : prev);
        armTimeoutRef.current = null;
      }, 4000);
      return;
    }
    if (armTimeoutRef.current) { clearTimeout(armTimeoutRef.current); armTimeoutRef.current = null; }
    setArmDiscardId(null);
    setDiscardingId(item.id);
    try {
      if (item.currentStock > 0) {
        await removeStock(item.name, item.currentStock, {
          type: 'waste',
          reason: 'expired',
          details: `Expired batch discarded${item.expiryDate ? ` (exp ${item.expiryDate})` : ''}`,
        });
      }
      // Clear the batch expiry so the item leaves the Expired/Expiring views.
      updateItem(item.id, { expiryDate: undefined, batchNumber: undefined, lastUpdated: new Date().toISOString().slice(0, 10) });
      notify(`${item.name} discarded — stock written off`, 'success');
    } catch {
      notify(`Could not discard ${item.name}`, 'warning');
    } finally {
      setDiscardingId(null);
    }
  };

  const expiryChip = (item: InventoryItem) => {
    if (!item.expiryDate) return null;
    const d = daysUntilExpiry(item.expiryDate);
    if (d < 0) {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
          <AlertTriangle className="w-3 h-3" /> Expired {Math.abs(d)}d ago
        </span>
      );
    }
    if (d <= 7) {
      return (
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${d <= 1 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
          <Hourglass className="w-3 h-3" /> {d === 0 ? 'Expires today' : `${d}d left`}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200">
        <Hourglass className="w-3 h-3" /> {item.expiryDate}
      </span>
    );
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Items</h1>
          <p className="text-xs text-gray-400 mt-0.5">{items.length} items in inventory</p>
        </div>
        <button onClick={openAdd}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* Expiry view tabs — All / Expiring Soon / Expired (real product expiryDate) */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button onClick={() => setExpiryView('all')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${expiryView === 'all' ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-[var(--brand-color)]/30'}`}>
          <Package className="w-3.5 h-3.5" />
          All Items
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${expiryView === 'all' ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>{items.length}</span>
        </button>
        <button onClick={() => setExpiryView('expiring')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${expiryView === 'expiring' ? 'bg-[var(--color-amber-500-solid)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-amber-400/50'}`}>
          <Hourglass className="w-3.5 h-3.5" />
          Expiring Soon
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${expiryView === 'expiring' ? 'bg-white/20' : expiryBuckets.expiring.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>{expiryBuckets.expiring.length}</span>
        </button>
        <button onClick={() => setExpiryView('expired')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${expiryView === 'expired' ? 'bg-[var(--color-red-500-solid)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-red-400/50'}`}>
          <AlertTriangle className="w-3.5 h-3.5" />
          Expired
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${expiryView === 'expired' ? 'bg-white/20' : expiryBuckets.expired.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>{expiryBuckets.expired.length}</span>
        </button>

        {expiryView === 'expired' && expiryBuckets.expired.length > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto hidden sm:block">Tap <b>Discard</b> twice to write off an expired batch</span>
        )}
        {expiryView === 'expiring' && expiryBuckets.expiring.length > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto hidden sm:block">Items expiring within 7 days — use FIFO or discard</span>
        )}
      </div>

      {/* Search + Category filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all"
            placeholder="Search items..." />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <button onClick={() => setCategoryFilter('All')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${categoryFilter === 'All' ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-[var(--brand-color)]/30'}`}
          >All</button>
          {categories.map(c => (
            <div key={c} className="flex items-center gap-0.5">
              {renamingCategory === c ? (
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl border border-[var(--brand-color)] bg-[var(--color-bg-white)] shadow-sm">
                  <input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameCategory(c, renameValue);
                      if (e.key === 'Escape') { setRenamingCategory(null); setRenameValue(''); }
                    }}
                    className="w-24 text-xs outline-none"
                    placeholder={c}
                    autoFocus
                  />
                  <button onClick={() => renameCategory(c, renameValue)} className="text-emerald-600 hover:text-emerald-700 cursor-pointer" title="Save rename">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setRenamingCategory(null); setRenameValue(''); }} className="text-gray-400 hover:text-gray-600 cursor-pointer" title="Cancel">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setCategoryFilter(c)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${categoryFilter === c ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)] text-gray-600 hover:border-[var(--brand-color)]/30'}`}
                  title={`Filter by ${c} — click the pencil to rename`}
                >
                  {c}
                  <Edit2 onClick={e => { e.stopPropagation(); setRenamingCategory(c); setRenameValue(c); }}
                    className="w-3 h-3 opacity-50 hover:opacity-100 cursor-pointer" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => { setShowNewCatInput(true); setNewCatName(''); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--brand-color)] border border-dashed border-[var(--brand-color)]/30 hover:bg-blue-50 transition-all cursor-pointer"
          >+ New</button>
        </div>
      </div>

      {/* Inline new category input */}
      {showNewCatInput && (
        <div className="flex items-center gap-2 mb-6">
          <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
            className="flex-1 max-w-xs px-4 py-2.5 rounded-xl border border-[var(--brand-color)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
            placeholder="New category name..." autoFocus
            onKeyDown={e => { if (e.key === 'Enter') addCategory(newCatName); if (e.key === 'Escape') setShowNewCatInput(false); }} />
          <button onClick={() => addCategory(newCatName)}
            className="px-4 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer">Add</button>
          <button onClick={() => setShowNewCatInput(false)}
            className="px-4 py-2.5 border border-gray-300 rounded-xl text-xs font-semibold hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
        </div>
      )}

      {/* Card grid */}
      <AnimatePresence mode="wait">
        {filtered.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-center py-20 bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)]"
          >
            {!synced ? (
              <div className="py-12 flex flex-col items-center">
                <ReceiptLoader label="Loading inventory…" />
              </div>
            ) : expiryView === 'expired' ? (
              <>
                <AlertTriangle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">No expired items 🎉</p>
                <p className="text-xs text-gray-400 mt-1">Nothing past its expiry date — stock is fresh</p>
              </>
            ) : expiryView === 'expiring' ? (
              <>
                <Hourglass className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">No items expiring soon</p>
                <p className="text-xs text-gray-400 mt-1">Nothing expires within the next 7 days</p>
              </>
            ) : (
              <>
                <Package className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">No items found</p>
                <p className="text-xs text-gray-400 mt-1">Try a different search or category</p>
              </>
            )}
          </motion.div>
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {filtered.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}
                className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden hover:shadow-lg hover:border-[var(--brand-color)]/20 transition-all group"
              >
                {/* Color stripe */}
                <div className={`h-2 bg-gradient-to-r ${statusGradient(item.status)}`} />

                <div className="p-5">
                  {/* Top row: image + status */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gray-50 border border-[var(--color-border-default)] overflow-hidden flex items-center justify-center shrink-0">
                        {item.image ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" /> : <Package className="w-6 h-6 text-gray-300" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{item.name}</p>
                        <p className="text-[10px] text-gray-400">{item.supplier}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <StatusBadge status={item.status} />
                      {expiryChip(item)}
                    </div>
                  </div>

                  {/* Stock + Cost */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Stock</p>
                      <p className="text-lg font-bold font-mono">{item.currentStock} <span className="text-xs text-gray-400 font-normal">{item.unit}</span></p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Avg Cost</p>
                      <p className="text-lg font-bold font-mono">₹{Number(item.averageCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  {/* Min / Max bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-[9px] text-gray-400 mb-1">
                      <span>Min: {item.minStock}</span>
                      <span>Max: {item.maxStock}</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${
                        item.status === 'critical' ? 'bg-[var(--color-red-500-solid)]' :
                        item.status === 'low' ? 'bg-[var(--color-amber-500-solid)]' :
                        item.status === 'normal' ? 'bg-[var(--color-blue-500-solid)]' : 'bg-[var(--color-emerald-500-solid)]'
                      }`} style={{ width: `${Math.min(100, (item.currentStock / item.maxStock) * 100)}%` }} />
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="pt-3 border-t border-[var(--color-border-default)] space-y-2">
                    <button onClick={() => openAddStock(item)}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[var(--brand-color)] to-[var(--brand-color)]/90 text-white text-xs font-bold shadow-sm hover:shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2 group"
                    >
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
                      </span>
                      Add Stock
                      <span className="ml-auto text-[9px] font-mono bg-white/20 px-1.5 py-0.5 rounded-full">
                        {item.currentStock} {item.unit}
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(item)}
                        className="flex-1 py-2 border border-[var(--color-border-default)] rounded-xl text-[10px] font-semibold text-gray-500 hover:border-[var(--brand-color)]/30 hover:text-[var(--brand-color)] hover:bg-blue-50 transition-all cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => setHistoryItem(item)}
                        className="flex-1 py-2 border border-[var(--color-border-default)] rounded-xl text-[10px] font-semibold text-blue-500 hover:border-[var(--brand-color)]/30 hover:bg-blue-50 transition-all cursor-pointer flex items-center justify-center gap-1"
                        title={`View add & stock history of ${item.name}`}
                      >
                        <History className="w-3 h-3" /> History
                      </button>
                      {item.expiryDate && daysUntilExpiry(item.expiryDate) <= 7 && (
                        <button onClick={() => handleDiscard(item)} disabled={discardingId === item.id}
                          className={`py-2 px-2.5 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shrink-0 ${
                            armDiscardId === item.id
                              ? 'bg-[var(--color-red-600-solid)] text-white shadow-sm'
                              : daysUntilExpiry(item.expiryDate) < 0
                                ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                                : 'bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100'
                          }`}
                          title={armDiscardId === item.id ? 'Tap again to confirm discard' : 'Discard expired batch'}
                        >
                          {discardingId === item.id ? (
                            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : armDiscardId === item.id ? (
                            <><Check className="w-3 h-3" /> Confirm?</>
                          ) : (
                            <><PackageX className="w-3 h-3" /> Discard</>
                          )}
                        </button>
                      )}
                      <button onClick={() => setDeleteTarget(item)}
                        className="py-2 px-3 border border-[var(--color-border-default)] rounded-xl text-[10px] font-semibold text-red-400 hover:border-red-300 hover:bg-red-50 transition-all cursor-pointer shrink-0"
                        title="Remove item"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add / Edit Modal */}
      <Modal isOpen={modalMode !== 'closed'} onClose={closeModal} title={modalMode === 'edit' ? 'Edit Item' : 'Add Item'} size="md">
        <div className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Item Name</label>
              <input type="text" value={form.name} onChange={e => updateField('name', e.target.value)}
                className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all ${formErrors.name ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)] bg-[var(--color-bg-white)]'}`}
                placeholder="e.g. Milk, Tea Powder, Bread" />
              {formErrors.name && <p className="text-[10px] text-red-500 mt-1">{formErrors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Category</label>
                <select
                  value={form.category}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__new__') setShowNewCatInput(true);
                    else { updateField('category', v); setShowNewCatInput(false); }
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] bg-[var(--color-bg-white)]"
                >
                  {!form.category && <option value="" disabled>Select category…</option>}
                  {form.category && !categories.includes(form.category) && <option value={form.category}>{form.category}</option>}
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">➕ New category…</option>
                </select>
                {showNewCatInput && (
                  <div className="flex gap-2 mt-2">
                    <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-[var(--brand-color)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 bg-[var(--color-bg-white)]"
                      placeholder="New category name…" autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(newCatName); } if (e.key === 'Escape') setShowNewCatInput(false); }} />
                    <button onClick={() => addCategory(newCatName)}
                      className="px-3 py-2 bg-[var(--brand-color)] text-white rounded-lg text-[10px] font-bold hover:bg-[var(--color-primary-hover)] cursor-pointer">Add</button>
                  </div>
                )}
                {!showNewCatInput && (
                  <p className="text-[10px] text-gray-400 mt-1">Includes every category on your menu — pick one or add a new one.</p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Unit</label>
                <select value={form.unit} onChange={e => updateField('unit', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] bg-[var(--color-bg-white)]">
                  <option value="kg">kg</option><option value="L">L</option><option value="pcs">pcs</option>
                  <option value="g">g</option><option value="mL">mL</option><option value="dozen">dozen</option>
                  <option value="packet">packet</option><option value="bottle">bottle</option>
                </select>
              </div>
            </div>

            <div className={`grid ${modalMode === 'edit' ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
              {modalMode === 'edit' && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1.5">Current Stock</label>
                  <input type="number" min="0" step="any" value={form.currentStock} onChange={e => updateField('currentStock', e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all ${formErrors.currentStock ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)] bg-[var(--color-bg-white)]'}`} />
                  {formErrors.currentStock && <p className="text-[10px] text-red-500 mt-1">{formErrors.currentStock}</p>}
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Min Stock</label>
                <input type="number" min="0" value={form.minStock} onChange={e => updateField('minStock', e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all ${formErrors.minStock ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)] bg-[var(--color-bg-white)]'}`} />
                {formErrors.minStock && <p className="text-[10px] text-red-500 mt-1">{formErrors.minStock}</p>}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Max Stock</label>
                <input type="number" min="0" value={form.maxStock} onChange={e => updateField('maxStock', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Avg Cost (₹)</label>
              <input type="number" min="0" step="0.01" value={form.averageCost} onChange={e => updateField('averageCost', e.target.value)}
                className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all ${formErrors.averageCost ? 'border-red-300 bg-red-50' : 'border-[var(--color-border-input)] bg-[var(--color-bg-white)]'}`} />
              {formErrors.averageCost && <p className="text-[10px] text-red-500 mt-1">{formErrors.averageCost}</p>}
            </div>

            {modalMode === 'edit' ? (
              <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-3.5 py-2.5 text-[10px] text-amber-700 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Changing stock here applies a stock-engine adjustment (delta) so FIFO batches and the event ledger stay accurate.
              </div>
            ) : (
              <div className="bg-blue-50/60 border border-blue-100 rounded-xl px-3.5 py-2.5 text-[10px] text-blue-700 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 shrink-0" />
                Stock starts at 0 for new items — tap <b>Add Stock</b> on the item card to record a purchase.
              </div>
            )}

            <ImageInput
              value={form.image}
              onChange={v => updateField('image', v)}
              label="Item Image"
              hint="Upload a photo or paste an image link (optional)"
            />
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-[var(--color-border-default)]">
            <button onClick={closeModal} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-primary-hover)] cursor-pointer shadow-sm transition-all">
              {modalMode === 'edit' ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Stock Modal — records a purchase so stock + avg cost + history
          update through the stock engine (same as the removed Add Stock page). */}
      <Modal isOpen={stockItem !== null} onClose={() => { if (!savingStock) setStockItem(null); }} title={`Add Stock — ${stockItem?.name || ''}`} size="sm">
        {stockItem && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-[var(--color-border-default)]">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-color)]/15 to-blue-100 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5 text-[var(--brand-color)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{stockItem.name}</p>
                <p className="text-[11px] text-gray-500">{stockItem.currentStock} {stockItem.unit} in stock</p>
              </div>
              <StatusBadge status={stockItem.status} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Quantity</label>
                <input type="number" min="0" step="any" value={stockQty} onChange={e => setStockQty(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Unit</label>
                <select value={stockItem.unit || 'pcs'} onChange={e => setStockItem({ ...stockItem, unit: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] bg-[var(--color-bg-white)]">
                  <option value="kg">kg</option><option value="L">L</option><option value="pcs">pcs</option>
                  <option value="g">g</option><option value="mL">mL</option><option value="dozen">dozen</option>
                  <option value="packet">packet</option><option value="bottle">bottle</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Cost per {stockItem.unit} (₹)</label>
                <input type="number" min="0" step="0.01" value={stockPrice} onChange={e => setStockPrice(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                  placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Supplier</label>
                <input type="text" value={stockSupplier} onChange={e => setStockSupplier(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                  placeholder="Local Vendor" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                Expiry date <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input type="date" value={stockExpiry} onChange={e => setStockExpiry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]" />
              <p className="text-[10px] text-gray-400 mt-1">Skip it if the batch has no expiry — you can add it later when editing the item.</p>
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t border-[var(--color-border-default)]">
              <button onClick={() => setStockItem(null)} disabled={savingStock}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all disabled:opacity-40">Cancel</button>
              <button onClick={handleAddStock} disabled={savingStock}
                className="px-5 py-2.5 bg-[var(--brand-color)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-primary-hover)] cursor-pointer shadow-sm transition-all flex items-center gap-2 disabled:opacity-50">
                {savingStock ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Stock
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Item History Modal — every purchase (with supplier + date) and
          activity event for this item, so the user can trace who supplied
          stock and when. Suppliers are omitted when none was recorded. */}
      <Modal isOpen={historyItem !== null} onClose={() => setHistoryItem(null)} title={`History — ${historyItem?.name || ''}`} size="lg">
        {(() => {
          const name = (historyItem?.name || '').toLowerCase();
          const itemPurchases: Purchase[] = (purchasesCtx.purchases || [])
            .filter(p => p.item.toLowerCase() === name);
          const itemEvents: TimelineEntry[] = (eventsCtx.events || [])
            .filter(e => e.item.toLowerCase() === name);
          const purchasesOffline = purchasesCtx.purchases === null;
          const eventsOffline = eventsCtx.events === null;

          return (
            <div className="space-y-5">
              {/* Item overview */}
              <div className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-2xl border border-[var(--color-border-default)]">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-color)]/15 to-blue-100 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-[var(--brand-color)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{historyItem?.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {historyItem?.currentStock} {historyItem?.unit} in stock
                    {historyItem && hasSupplier(historyItem.supplier) && (
                      <> · <span className="text-indigo-600 font-semibold">{historyItem.supplier}</span></>
                    )}
                  </p>
                </div>
                <StatusBadge status={historyItem?.status || 'normal'} />
              </div>

              {/* Stock in — purchases (supplier + date) */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-bold text-gray-900">Stock In — Purchases</h3>
                  {itemPurchases.length > 0 && (
                    <span className="text-[10px] text-gray-400 ml-auto bg-gray-50 px-1.5 py-0.5 rounded-full">{itemPurchases.length}</span>
                  )}
                </div>
                {purchasesOffline ? (
                  <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-[var(--color-border-default)]">
                    Offline — purchase history unavailable
                  </p>
                ) : itemPurchases.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-[var(--color-border-default)]">
                    No purchase records yet — add stock to see supplier & date here
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-border-default)] border border-[var(--color-border-default)] rounded-2xl overflow-hidden bg-[var(--color-bg-white)]">
                    {itemPurchases.map(p => (
                      <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-gray-50 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                          <Plus className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700">
                            +{p.quantity} {p.unit}
                            <span className="text-gray-400 font-normal ml-1.5">₹{Number(p.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/{p.unit}</span>
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {p.date}
                            {hasSupplier(p.supplier) && (
                              <span className="inline-flex items-center gap-1 text-indigo-600 font-semibold">
                                <Truck className="w-2.5 h-2.5" /> {p.supplier}
                              </span>
                            )}
                            {p.brand && (
                              <span className="inline-flex items-center gap-1 text-cyan-600 font-semibold">
                                <Tag className="w-2.5 h-2.5" /> {p.brand}
                              </span>
                            )}
                            {p.expiryDate && (
                              <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                                <Hourglass className="w-2.5 h-2.5" /> Expires {p.expiryDate}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-xs font-bold font-mono text-gray-700 shrink-0">₹{Number(p.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity feed — sold / waste / adjusted / return */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ActivityIcon className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-bold text-gray-900">Activity</h3>
                  {itemEvents.length > 0 && (
                    <span className="text-[10px] text-gray-400 ml-auto bg-gray-50 px-1.5 py-0.5 rounded-full">{itemEvents.length}</span>
                  )}
                </div>
                {eventsOffline ? (
                  <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-[var(--color-border-default)]">
                    Offline — activity history unavailable
                  </p>
                ) : itemEvents.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-[var(--color-border-default)]">
                    No activity recorded for this item yet
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-border-default)] border border-[var(--color-border-default)] rounded-2xl overflow-hidden bg-[var(--color-bg-white)]">
                    {itemEvents.map(e => {
                      const meta = eventMeta(e.type);
                      return (
                        <div key={e.id} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-gray-50 transition-colors">
                          <span className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[9px] font-black uppercase shrink-0 ${meta.color}`}>
                            {meta.sign}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-700">
                              {meta.label}
                              <span className="text-gray-400 font-normal ml-1.5">{Math.abs(e.quantity)} {e.unit}</span>
                            </p>
                            {e.details && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{e.details}</p>}
                          </div>
                          <span className="text-[10px] font-semibold text-gray-400 shrink-0">{e.timestamp}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Remove Item" size="sm">
        <div className="text-center py-6">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-base font-bold mb-1">Remove {deleteTarget?.name}?</p>
          <p className="text-sm text-gray-500">This will permanently remove it from your inventory.</p>
        </div>
        <div className="flex gap-3 justify-center pt-4 border-t border-[var(--color-border-default)]">
          <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all">Cancel</button>
          <button onClick={handleDelete} className="px-5 py-2.5 bg-[var(--color-red-600-solid)] text-white rounded-xl text-sm font-bold hover:bg-[var(--color-red-700-solid)] cursor-pointer shadow-sm transition-all">Delete</button>
        </div>
      </Modal>
    </div>
  );
}