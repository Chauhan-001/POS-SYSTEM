import { useState, useCallback, useEffect, useRef, useMemo, createContext, useContext, type Context } from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, Trash2, BarChart3,
  CalendarX, Settings as SettingsIcon, ArrowLeft, CheckCircle, AlertCircle, Info,
  Mic, Activity,
} from 'lucide-react';
import type { InventoryPage, InventoryItem, Purchase, TimelineEntry } from './types';
import { daysUntilExpiry } from './expiryUtils';
import {
  fetchProducts,
  createProduct as apiCreateProduct,
  updateProduct as apiUpdateProduct,
  deleteProduct as apiDeleteProduct,
  adjustProductStock as apiAdjustStock,
  fetchPurchases,
  updatePurchase as apiUpdatePurchase,
  deletePurchase,
  fetchInventoryEvents,
  createInventoryEvent as apiCreateInventoryEvent,
  CACHE_INVALIDATED_EVENT,
} from '../../src/api/client';

/** Map a backend Product document into the frontend InventoryItem shape. */
function productToInventoryItem(p: any): InventoryItem {
  const stock = Number(p?.currentStock) || 0;
  const min = Number(p?.minStock) || 0;
  let status: InventoryItem['status'] = 'healthy';
  if (min > 0 && stock <= 0) status = 'critical';
  else if (min > 0 && stock < min) status = 'low';
  else if (min > 0 && stock <= min * 1.2) status = 'normal';
  return {
    id: p?._id || p?.id,
    name: p?.name || 'Item',
    category: p?.category || 'Uncategorized',
    image: p?.image || '',
    currentStock: stock,
    unit: p?.unit || 'pcs',
    minStock: min,
    maxStock: Number(p?.maxStock) || 0,
    averageCost: Number(p?.averageCost) || 0,
    supplier: p?.supplier || '',
    status,
    expiryDate: p?.expiryDate || undefined,
    batchNumber: p?.batchNumber || undefined,
    lastUpdated: p?.updatedAt ? String(p.updatedAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

/** Convert an InventoryItem into the backend product payload (inventory-only). */
function inventoryItemToProduct(item: InventoryItem) {
  return {
    name: item.name,
    category: item.category || 'Uncategorized',
    image: item.image || '',
    code: (item as any).code || `INV-${Date.now().toString(36).toUpperCase()}`,
    price: 0,
    availability: false, // inventory-only item — hidden from the billing menu
    currentStock: Number(item.currentStock) || 0,
    unit: item.unit || 'pcs',
    minStock: Number(item.minStock) || 0,
    maxStock: Number(item.maxStock) || 0,
    reorderLevel: Number((item as any).reorderLevel) || 0,
    averageCost: Number(item.averageCost) || 0,
    supplier: item.supplier || '',
    storageLocation: (item as any).storageLocation || '',
    notes: (item as any).notes || '',
    barcode: (item as any).barcode || '',
    expiryDate: item.expiryDate || '',
    batchNumber: item.batchNumber || '',
  };
}
import Dashboard from './pages/Dashboard';
import ItemsPage from './pages/ItemsPage';
import PurchaseEntry from './pages/PurchaseEntry';
import WasteManagement from './pages/WasteManagement';
import SupplierManagement from './pages/SupplierManagement';
import InventoryAnalytics from './pages/InventoryAnalytics';
import ExpiryManagement from './pages/ExpiryManagement';
import SettingsPage from './pages/Settings';
import VoicePage from './pages/VoicePage';
import InventoryTimeline from './pages/InventoryTimeline';
import VoiceFAB from '../../src/ai/VoiceFAB';

type InventoryCtxType = {
  items: InventoryItem[];
  synced: boolean;
  updateItem: (id: string, updates: Partial<InventoryItem>) => void;
  addItem: (item: InventoryItem) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  /** Increase stock via the stock engine (type: 'adjustment' | 'purchase' | 'opening' ...). */
  addStock: (itemName: string, qty: number, unit?: string, opts?: { type?: string; details?: string; reason?: string }) => Promise<void>;
  /** Decrease stock via the stock engine (type: 'adjustment' | 'waste' | 'correction' ...). */
  removeStock: (itemName: string, qty: number, opts?: { type?: string; details?: string; reason?: string }) => Promise<void>;
  /** Re-fetch the item catalog from the backend (used after purchases). */
  refreshItems: () => Promise<void>;
};

/**
 * Guarded context access for the Inventory module.
 *
 * React contexts created at MODULE scope have a fatal interaction with Vite's
 * dev HMR: when any file in this module graph is edited, the dev server re-serves
 * the graph with a fresh `?t=` URL. A partially-updated window can end up holding
 * TWO instances of this module — and therefore two DIFFERENT InventoryCtx
 * objects. The <Provider> renders against one, consumers read the other,
 * useContext() falls back to the null default, and every page crashes with
 * "Cannot destructure property 'items' of useInventory(...) as it is null".
 *
 * Instead of that cryptic crash:
 *   1. Dev — trigger ONE full page reload (the reload rebuilds the module graph
 *      from the now-consistent server, restoring the single context instance).
 *      A sessionStorage flag guarantees the reload happens at most once, so a
 *      genuine wiring bug can never loop the page.
 *   2. Otherwise — throw a descriptive error so the error boundary shows an
 *      actionable message instead of a confusing destructure failure.
 */
const CONTEXT_AUTORELOAD_FLAG = 'pos_inv_ctx_autoreloaded';

/** Read/clear the auto-reload flag defensively — storage can throw in
 *  restricted sandboxes, and a StorageException here would mask the real
 *  error we are trying to surface. */
function hasAutoReloaded(): boolean {
  try {
    return sessionStorage.getItem(CONTEXT_AUTORELOAD_FLAG) === '1';
  } catch {
    return true; // storage unavailable → never auto-reload, just throw below
  }
}

function markAutoReloaded(): void {
  try {
    sessionStorage.setItem(CONTEXT_AUTORELOAD_FLAG, '1');
  } catch { /* storage unavailable — the reload below still fires */ }
}

function useStrictContext<T>(ctx: Context<T>, name: string): T {
  const value = useContext(ctx);
  if (value !== null && value !== undefined) return value;
  // NOTE: the setItem + reload below run during render. The sessionStorage
  // flag makes this idempotent under React StrictMode's double render, and
  // the throw (caught by the error boundary) prevents effects from running —
  // so exactly one reload is scheduled, deferred until React finishes the
  // erroring render pass.
  if (import.meta.env.DEV && !hasAutoReloaded()) {
    markAutoReloaded();
    // Rebuild the module graph from the now-consistent dev server.
    setTimeout(() => window.location.reload(), 0);
  }
  throw new Error(
    `${name}: inventory context is unavailable. Reloading the app to rebuild the module graph — if this persists, restart the app.`,
  );
}

// Force a full page reload instead of a partial hot update when this module
// graph is edited in dev. Partial HMR updates split the module into two
// instances (see useStrictContext above), which is exactly the crash reported
// as "useInventory(...) is null". Declining hot updates on the context-owning
// module makes Vite reload the page cleanly on every inventory edit.
if (import.meta.hot) {
  // decline() exists at runtime in Vite's HMR client, but the installed
  // ViteHotContext type is missing it — cast to the runtime shape.
  (import.meta.hot as unknown as { decline?: () => void }).decline?.();
}

const InventoryCtx = createContext<InventoryCtxType>(null!);
export const useInventory = () => useStrictContext(InventoryCtx, 'useInventory');

// ─── Shared purchase history (single source of truth across pages) ───
// Loaded once here so PurchaseEntry, Timeline, Analytics and Dashboard all
// reflect the same records, and a delete/add anywhere updates every view.
type PurchasesCtxType = {
  purchases: Purchase[] | null;
  synced: boolean;
  addPurchase: (p: Purchase) => void;
  /** Updates on the server; returns true only when the change persisted. */
  updatePurchase: (id: string, updates: Partial<Purchase>) => Promise<boolean>;
  /** Deletes on the server; returns true only when the delete persisted. */
  removePurchase: (id: string) => Promise<boolean>;
};

const PurchasesCtx = createContext<PurchasesCtxType>(null!);
export const usePurchasesCtx = () => useStrictContext(PurchasesCtx, 'usePurchasesCtx');

// ─── Shared inventory activity events (single source of truth) ───
// Loaded once so the Activity timeline and the Waste page share one feed — a
// waste/adjustment saved anywhere appears in the timeline immediately.
type InventoryEventsCtxType = {
  events: TimelineEntry[] | null;
  synced: boolean;
  /** Persists a waste/adjustment event; returns true only when saved. */
  addEvent: (data: { type: 'waste' | 'adjusted'; item: string; quantity: number; unit: string; details?: string }) => Promise<boolean>;
  /** Re-fetches the activity feed from the backend (used after a stock write). */
  refreshEvents: () => Promise<void>;
};

const InventoryEventsCtx = createContext<InventoryEventsCtxType>(null!);
export const useInventoryEventsCtx = () => useStrictContext(InventoryEventsCtx, 'useInventoryEventsCtx');

interface InventoryManagerProps {
  onBack: () => void;
  moduleSettings?: Record<string, boolean>;
}

type Toast = { id: string; message: string; type: 'success' | 'warning' | 'info' };

const ToastCtx = createContext<(msg: string, type?: Toast['type']) => void>(() => {});

export const useNotify = () => useContext(ToastCtx);

const NAV_ITEMS: { id: InventoryPage; icon: typeof LayoutDashboard; label: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
  { id: 'items', icon: Package, label: 'Items' },
  { id: 'purchase', icon: ShoppingCart, label: 'Add Stock' },
  { id: 'suppliers', icon: Truck, label: 'Suppliers' },
  { id: 'expiry', icon: CalendarX, label: 'Expiry' },
  { id: 'waste', icon: Trash2, label: 'Waste' },
  { id: 'analytics', icon: BarChart3, label: 'Reports' },
  { id: 'voice', icon: Mic, label: 'Voice' },
  { id: 'timeline', icon: Activity, label: 'Activity' },
];

export default function InventoryManager({ onBack, moduleSettings }: InventoryManagerProps) {
  const [page, setPage] = useState<InventoryPage>('dashboard');
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Backend-driven item catalog (single source of truth = Product collection).
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsSynced, setItemsSynced] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [purchasesSynced, setPurchasesSynced] = useState(false);
  const [events, setEvents] = useState<TimelineEntry[] | null>(null);
  const [eventsSynced, setEventsSynced] = useState(false);

  // Live expiry counts for the Items nav badge — computed from real product
  // expiryDate so staff see expiries without opening the page.
  const expiryBadge = useMemo(() => {
    let expiring = 0;
    let expired = 0;
    for (const i of items) {
      if (!i.expiryDate) continue;
      const d = daysUntilExpiry(i.expiryDate);
      if (d < 0) expired += 1;
      else if (d <= 7) expiring += 1;
    }
    return { expiring, expired };
  }, [items]);

  // Load the real inventory catalog once (products = items). No demo/seed
  // fallback: an empty array means the restaurant has no inventory products,
  // and null (API unreachable) leaves the catalog empty with synced=false so
  // pages show an honest offline state — never fabricated rows.
  const loadItems = useCallback(async () => {
    try {
      const data = await fetchProducts();
      if (Array.isArray(data)) {
        setItems(data.map(productToInventoryItem));
        setItemsSynced(true);
      } else {
        setItems([]);
        setItemsSynced(false);
      }
    } catch {
      setItems([]);
      setItemsSynced(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // The inventory context guard auto-reloads the page ONCE if a stale dev HMR
  // update ever splits this module into two instances. Re-arm the guard after a
  // successful mount so a future incident can self-heal again instead of
  // degrading to a one-shot-per-session recovery.
  useEffect(() => {
    try {
      sessionStorage.removeItem(CONTEXT_AUTORELOAD_FLAG);
    } catch { /* storage unavailable — guard stays tripped, harmless */ }
  }, []);

  // Load real purchase history once for the whole Inventory module. Null when
  // the API is unreachable (offline) so pages fall back to static demo data.
  // fetchPurchases is TTL-cached (5 min), so remounts are instant, a 5-min
  // interval re-checks the cache, and a write anywhere invalidates it and
  // triggers an immediate re-fetch via the cache-invalidated event. A sequence
  // guard ignores late/out-of-order responses when mount + event + interval
  // overlap.
  const purchasesLoadSeq = useRef(0);
  const loadPurchases = useCallback(() => {
    const seq = ++purchasesLoadSeq.current;
    return fetchPurchases({ limit: 500 }).then((data) => {
      if (seq !== purchasesLoadSeq.current) return;
      setPurchases(data);
      // synced = backend actually answered (non-null). Null (offline) keeps
      // the flag false so pages show the "Offline demo" badge + fallback data.
      setPurchasesSynced(data !== null);
    });
  }, []);

  useEffect(() => { void loadPurchases(); }, [loadPurchases]);

  // Load real activity events once for the whole Inventory module.
  const eventsLoadSeq = useRef(0);
  const loadEvents = useCallback(() => {
    const seq = ++eventsLoadSeq.current;
    return fetchInventoryEvents({ limit: 500 }).then((data) => {
      if (seq !== eventsLoadSeq.current) return;
      setEvents(data);
      setEventsSynced(data !== null);
    });
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  // Timely freshness while the Inventory module stays open: re-check the
  // TTL-gated caches every 5 minutes (purchases 5min / events 1h TTL — the
  // fetches only hit the network when a cache expired), and re-fetch
  // immediately when a write anywhere invalidates one of our collections.
  useEffect(() => {
    const onInvalidated = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === 'pos_purchases') void loadPurchases();
      else if (key === 'pos_inventory_events') void loadEvents();
    };
    window.addEventListener(CACHE_INVALIDATED_EVENT, onInvalidated);
    const interval = setInterval(() => { void loadPurchases(); void loadEvents(); }, 5 * 60 * 1000);
    return () => {
      window.removeEventListener(CACHE_INVALIDATED_EVENT, onInvalidated);
      clearInterval(interval);
    };
  }, [loadPurchases, loadEvents]);

  const addPurchase = useCallback((p: Purchase) => {
    setPurchases(prev => (prev ? [p, ...prev] : prev));
  }, []);

  const updatePurchase = useCallback(async (id: string, updates: Partial<Purchase>): Promise<boolean> => {
    // Persist to the backend first — only reflect the correction locally once
    // the server confirms, so offline devices never show un-persisted edits.
    try {
      const res = await apiUpdatePurchase(id, {
        item: updates.item,
        quantity: updates.quantity,
        unit: updates.unit,
        price: updates.price,
        supplier: updates.supplier,
        date: updates.date,
      });
      if (res) {
        setPurchases(prev => (prev ? prev.map(p => {
          if (p.id !== id) return p;
          // Merge the edits AND recompute the local total from the effective
          // quantity/price so the row never shows a stale ₹ amount (the server
          // response's total is authoritative when present).
          const merged = { ...p, ...updates };
          const qty = merged.quantity ?? p.quantity;
          const price = merged.price ?? p.price;
          return { ...merged, total: res?.total ?? Math.round(qty * price * 100) / 100 };
        }) : prev));
        return true;
      }
      console.warn('[Inventory] purchase update rejected by server:', id);
      return false;
    } catch (err) {
      console.warn('[Inventory] purchase update failed:', err);
      return false;
    }
  }, []);

  const removePurchase = useCallback(async (id: string): Promise<boolean> => {
    // Only drop the row locally once the server confirms the delete — otherwise
    // a failed (offline) delete would show the row disappearing, then silently
    // reappear on the next load.
    try {
      const res = await deletePurchase(id);
      if (res) {
        setPurchases(prev => (prev ? prev.filter(p => p.id !== id) : prev));
        return true;
      }
      console.warn('[Inventory] purchase delete rejected by server:', id);
      return false;
    } catch (err) {
      console.warn('[Inventory] purchase delete failed:', err);
      return false;
    }
  }, []);

  const addEvent = useCallback(async (data: { type: 'waste' | 'adjusted'; item: string; quantity: number; unit: string; details?: string }): Promise<boolean> => {
    // Persist first — only prepend to the shared feed once the server confirms,
    // so offline devices never show un-persisted activity.
    try {
      const res = await apiCreateInventoryEvent({
        type: data.type,
        item: data.item,
        quantity: data.quantity, // signed delta: negative = outflow (waste/removal)
        unit: data.unit,
        details: data.details,
        eventDate: new Date().toISOString().slice(0, 10),
      });
      if (res && res._id) {
        setEvents(prev => (prev ? [{
          id: res._id,
          type: res.type || data.type,
          item: res.item || data.item,
          quantity: res.quantity ?? data.quantity,
          unit: res.unit || data.unit,
          timestamp: res.eventDate || new Date().toISOString().slice(0, 10),
          operator: res.operator || 'System',
          details: res.details || data.details || `${data.type} recorded`,
        }, ...prev] : prev));
        return true;
      }
      console.warn('[Inventory] activity event rejected by server');
      return false;
    } catch (err) {
      console.warn('[Inventory] activity event create failed:', err);
      return false;
    }
  }, []);

  const purchasesCtx: PurchasesCtxType = {
    purchases,
    synced: purchasesSynced,
    addPurchase,
    updatePurchase,
    removePurchase,
  };

  const eventsCtx: InventoryEventsCtxType = {
    events,
    synced: eventsSynced,
    addEvent,
    refreshEvents: () => loadEvents(),
  };

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<InventoryItem>) => {
    // Optimistic local update for instant UI feedback.
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      const current = items.find(i => i.id === id);
      if (current) {
        apiUpdateProduct(id, inventoryItemToProduct({ ...current, ...updates })).catch(err =>
          console.warn('[Inventory] updateItem failed:', err)
        );
      }
    }
  }, [items]);

  const addItem = useCallback(async (item: InventoryItem) => {
    // Persist to the backend — on success replace with the server product
    // (real _id + normalized fields). On failure keep the local row (offline).
    const created = await apiCreateProduct(inventoryItemToProduct(item));
    if (created && (created._id || created.id)) {
      setItems(prev => [productToInventoryItem(created), ...prev]);
      return;
    }
    setItems(prev => [item, ...prev]);
  }, []);

  const removeItem = useCallback(async (id: string) => {
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      const ok = await apiDeleteProduct(id);
      if (!ok) return; // server rejected — don't drop the row locally
    }
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const addStock = useCallback(async (itemName: string, qty: number, unit?: string, opts?: { type?: string; details?: string; reason?: string }) => {
    const item = items.find(i => i.name === itemName);
    if (!item) return;
    if (/^[a-fA-F0-9]{24}$/.test(item.id)) {
      const res = await apiAdjustStock(item.id, {
        delta: qty,
        type: (opts?.type as any) || 'adjustment',
        details: opts?.details,
        reason: opts?.reason,
        unit: unit || item.unit,
      });
      if (res && typeof res.after === 'number') {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, currentStock: res.after, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
        return;
      }
    }
    // Offline/local fallback — the sync engine replays the queued write.
    setItems(prev => prev.map(i =>
      i.name === itemName ? { ...i, currentStock: i.currentStock + qty, lastUpdated: new Date().toISOString().slice(0, 10) } : i
    ));
  }, [items]);

  const removeStock = useCallback(async (itemName: string, qty: number, opts?: { type?: string; details?: string; reason?: string }) => {
    const item = items.find(i => i.name === itemName);
    if (!item) return;
    if (/^[a-fA-F0-9]{24}$/.test(item.id)) {
      const res = await apiAdjustStock(item.id, {
        delta: -qty,
        type: (opts?.type as any) || 'adjustment',
        details: opts?.details,
        reason: opts?.reason,
        unit: item.unit,
      });
      if (res && typeof res.after === 'number') {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, currentStock: res.after, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
        return;
      }
    }
    // Offline/local fallback (never below zero).
    setItems(prev => prev.map(i =>
      i.name === itemName ? { ...i, currentStock: Math.max(0, i.currentStock - qty), lastUpdated: new Date().toISOString().slice(0, 10) } : i
    ));
  }, [items]);

  const refreshItems = useCallback(async () => {
    await loadItems();
  }, [loadItems]);

  const inventoryCtx: InventoryCtxType = { items, synced: itemsSynced, updateItem, addItem, removeItem, addStock, removeStock, refreshItems };

  return (
    <InventoryCtx.Provider value={inventoryCtx}>
    <PurchasesCtx.Provider value={purchasesCtx}>
    <InventoryEventsCtx.Provider value={eventsCtx}>
    <ToastCtx.Provider value={showToast}>
      <div className="flex flex-col h-full">
        {/* Slim header bar */}
        <div className="bg-white border-b border-[#e1e2ed] px-5 py-2.5 flex items-center gap-3 shrink-0">
          <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to POS">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--brand-color)] to-blue-500 flex items-center justify-center shadow-sm">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-6">
              <span className="text-sm font-bold tracking-tight">Inventory</span>
              <nav className="flex items-center gap-0.5">
                {NAV_ITEMS.map(item => {
                  const Icon = item.icon;
                  const isActive = page === item.id;
                  const showBadge = item.id === 'items' && (expiryBadge.expiring > 0 || expiryBadge.expired > 0);
                  return (
                    <button key={item.id} onClick={() => setPage(item.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isActive ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'text-gray-500 hover:text-[var(--brand-color)] hover:bg-blue-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.label}
                      {showBadge && (
                        <span className="flex items-center gap-1 ml-0.5" aria-label={`${expiryBadge.expired} expired, ${expiryBadge.expiring} expiring soon`}>
                          {expiryBadge.expiring > 0 && (
                            <span className="min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full text-[9px] font-black bg-amber-400 text-amber-950" title={`${expiryBadge.expiring} item${expiryBadge.expiring === 1 ? '' : 's'} expiring soon`}>
                              {expiryBadge.expiring}
                            </span>
                          )}
                          {expiryBadge.expired > 0 && (
                            <span className="min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full text-[9px] font-black bg-red-500 text-white" title={`${expiryBadge.expired} item${expiryBadge.expired === 1 ? '' : 's'} expired`}>
                              {expiryBadge.expired}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setPage('settings')}
            className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] rounded-lg transition-all cursor-pointer"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[#faf8ff]">
          <motion.div key={page} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            {page === 'dashboard' && <Dashboard onNavigate={setPage} moduleSettings={moduleSettings} />}
            {page === 'items' && <ItemsPage />}
            {page === 'purchase' && <PurchaseEntry />}
            {page === 'waste' && <WasteManagement moduleSettings={moduleSettings} />}
              {page === 'suppliers' && <SupplierManagement onNavigate={(p) => setPage(p as InventoryPage)} />}
              {page === 'analytics' && <InventoryAnalytics />}
              {page === 'expiry' && <ExpiryManagement />}
              {page === 'settings' && <SettingsPage />}
              {page === 'voice' && <VoicePage />}
              {page === 'timeline' && <InventoryTimeline />}
              {/* Voice FAB — accessible from all inventory pages */}
              {moduleSettings?.enableAIVoiceEntry !== false && page !== 'voice' && <VoiceFAB />}
          </motion.div>
        </main>

        {/* Toast Notifications */}
        <div className="fixed top-4 right-4 z-[200] space-y-2 pointer-events-none">
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }}
              className={`px-5 py-3 rounded-2xl shadow-xl text-sm font-bold flex items-center gap-3 ${
                t.type === 'success' ? 'bg-emerald-600 text-white' :
                t.type === 'warning' ? 'bg-amber-500 text-white' : 'bg-[#191b23] text-white'
              }`}
            >
              {t.type === 'success' && <CheckCircle className="w-5 h-5 shrink-0" />}
              {t.type === 'warning' && <AlertCircle className="w-5 h-5 shrink-0" />}
              {t.type === 'info' && <Info className="w-5 h-5 shrink-0" />}
              {t.message}
            </motion.div>
          ))}
        </div>
      </div>
    </ToastCtx.Provider>
    </InventoryEventsCtx.Provider>
    </PurchasesCtx.Provider>
    </InventoryCtx.Provider>
  );
}