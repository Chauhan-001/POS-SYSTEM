import { useState, useCallback, createContext, useContext } from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, Trash2, BarChart3,
  CalendarX, Settings as SettingsIcon, ArrowLeft, CheckCircle, AlertCircle, Info,
  Mic, Activity,
} from 'lucide-react';
import type { InventoryPage, InventoryItem } from './types';
import { INVENTORY_ITEMS } from './data';
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

type InventoryCtxType = {
  items: InventoryItem[];
  updateItem: (id: string, updates: Partial<InventoryItem>) => void;
  addItem: (item: InventoryItem) => void;
  removeItem: (id: string) => void;
  addStock: (itemName: string, qty: number, unit?: string) => void;
  removeStock: (itemName: string, qty: number) => void;
};

const InventoryCtx = createContext<InventoryCtxType>(null!);
export const useInventory = () => useContext(InventoryCtx);

interface InventoryManagerProps {
  onBack: () => void;
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

export default function InventoryManager({ onBack }: InventoryManagerProps) {
  const [page, setPage] = useState<InventoryPage>('dashboard');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [items, setItems] = useState<InventoryItem[]>(INVENTORY_ITEMS);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<InventoryItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }, []);

  const addItem = useCallback((item: InventoryItem) => {
    setItems(prev => [...prev, item]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const addStock = useCallback((itemName: string, qty: number) => {
    setItems(prev => prev.map(i =>
      i.name === itemName ? { ...i, currentStock: i.currentStock + qty, lastUpdated: new Date().toISOString().slice(0, 10) } : i
    ));
  }, []);

  const removeStock = useCallback((itemName: string, qty: number) => {
    setItems(prev => prev.map(i =>
      i.name === itemName ? { ...i, currentStock: Math.max(0, i.currentStock - qty), lastUpdated: new Date().toISOString().slice(0, 10) } : i
    ));
  }, []);

  const inventoryCtx: InventoryCtxType = { items, updateItem, addItem, removeItem, addStock, removeStock };

  return (
    <InventoryCtx.Provider value={inventoryCtx}>
    <ToastCtx.Provider value={showToast}>
      <div className="flex flex-col h-full">
        {/* Slim header bar */}
        <div className="bg-white border-b border-[#e1e2ed] px-5 py-2.5 flex items-center gap-3 shrink-0">
          <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to POS">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#004ac6] to-blue-500 flex items-center justify-center shadow-sm">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-6">
              <span className="text-sm font-bold tracking-tight">Inventory</span>
              <nav className="flex items-center gap-0.5">
                {NAV_ITEMS.map(item => {
                  const Icon = item.icon;
                  const isActive = page === item.id;
                  return (
                    <button key={item.id} onClick={() => setPage(item.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isActive ? 'bg-[#004ac6] text-white shadow-sm' : 'text-gray-500 hover:text-[#004ac6] hover:bg-blue-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setPage('settings')}
            className="p-1.5 text-gray-400 hover:text-[#004ac6] rounded-lg transition-all cursor-pointer"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[#faf8ff]">
          <motion.div key={page} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
            {page === 'items' && <ItemsPage />}
            {page === 'purchase' && <PurchaseEntry />}
            {page === 'waste' && <WasteManagement />}
              {page === 'suppliers' && <SupplierManagement onNavigate={(p) => setPage(p as InventoryPage)} />}
              {page === 'analytics' && <InventoryAnalytics />}
              {page === 'expiry' && <ExpiryManagement />}
              {page === 'settings' && <SettingsPage />}
              {page === 'voice' && <VoicePage />}
              {page === 'timeline' && <InventoryTimeline />}
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
    </InventoryCtx.Provider>
  );
}