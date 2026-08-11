import { Layers, Users, Award, Shield, DollarSign, Activity, FileText, RefreshCw, TrendingDown, BarChart3, CalendarClock, Building2, Receipt, TrendingUp, Monitor, ToggleLeft, QrCode } from 'lucide-react';

import { useState, useEffect } from 'react';
import type { RolePermissions } from '../src/types';

// ─── Electron API type declaration ───────────────────────────────
// When running inside Electron, window.electronAPI is exposed via
// the preload script's contextBridge. This declaration makes
// TypeScript aware of it without needing to import Electron types.
declare global {
  interface Window {
    electronAPI?: {
      toggleFrame: () => void;
      getFrameState: () => Promise<boolean>;
      getVersion: () => Promise<string>;
      getEnvironment: () => Promise<any>;
      reload: () => void;
      toggleFullScreen: () => void;
      onShowMessage: (cb: (msg: string) => void) => void;
      platform: string;
    };
  }
}

interface MoreWorkspaceProps {
  onNavigate: (ws: string) => void;
  onOpenDailySales: () => void;
  onOpenActivityFeed: () => void;
  onOpenZReport: () => void;
  onOpenSyncPanel: () => void;
  moduleSettings?: Record<string, boolean>;
  subscriptionFeatures?: string[];
  role?: string;
  rolePermissions?: RolePermissions;
}

export default function MoreWorkspace({ onNavigate, onOpenDailySales, onOpenActivityFeed, onOpenZReport, onOpenSyncPanel, moduleSettings = {}, subscriptionFeatures = [], role, rolePermissions }: MoreWorkspaceProps) {
  // ─── Kiosk Mode State ──────────────────────────────────────────
  // Detect if running inside Electron (has access to window.electronAPI)
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const [isKiosk, setIsKiosk] = useState(false);

  // Query initial kiosk state on mount
  useEffect(() => {
    if (isElectron) {
      window.electronAPI!.getFrameState().then(setIsKiosk);
    }
  }, [isElectron]);

  const handleToggleKiosk = () => {
    if (isElectron) {
      window.electronAPI!.toggleFrame();
      setIsKiosk(prev => !prev);
    }
  };
  const isOwner = role === 'Owner';
  const isManager = role === 'Manager';
  const isCashier = role === 'Cashier';
  const perms = rolePermissions;

  // ─── Strict Plan-Aware Feature Gates ─────────────────────────
  // Every tile checks BOTH the Settings module toggle AND the subscription
  // plan: a feature NOT included in the plan is hidden for EVERY role (Owner
  // included) — the plan is the hard gate. Settings toggles let the Owner
  // fine-tune visibility WITHIN the features the plan includes.
  const planHas = (f: string) => subscriptionFeatures.includes(f);
  const planHasAny = (...features: string[]) => features.some((f) => planHas(f));
  const ownerFullAccess = (moduleEnabled: boolean, feature: string): boolean =>
    moduleEnabled && planHas(feature);

  const isLoyaltyEnabled = ownerFullAccess(moduleSettings.enableLoyalty !== false, 'loyalty');
  const isReservationsEnabled = ownerFullAccess(moduleSettings.enableReservations !== false, 'reservations');
  const isMultiBranchEnabled = ownerFullAccess(moduleSettings.enableMultiBranch === true, 'multi_branch');
  const isExpensesEnabled = ownerFullAccess(moduleSettings.enableExpenseManagement !== false, 'expense_tracking');
  const isInventoryEnabled = ownerFullAccess(true, 'inventory');
  const isAnalyticsEnabled = ownerFullAccess(true, 'analytics');
  const isFinanceEnabled = ownerFullAccess(true, 'finance');
  const isProductsEnabled = ownerFullAccess(moduleSettings.enableProducts !== false, 'products');
  const isOffersEnabled = moduleSettings.enableOffers !== false && planHasAny('offers', 'marketing');
  const isStaffEnabled = ownerFullAccess(moduleSettings.enableStaff !== false, 'staff');
  const isMenuAvailabilityEnabled = moduleSettings.enableMenuAvailability !== false && planHasAny('online_ordering', 'qr_ordering');
  const isQrStudioEnabled = moduleSettings.enableQROrdering !== false && planHas('qr_ordering');

  // Check if a workspace item is accessible based on role
  const canAccess = (itemId: string): boolean => {
    if (isOwner) return true;
    if (isCashier) {
      // Base modules are always available; everything else follows the
      // Owner-configured cashier permission toggles.
      switch (itemId) {
        case 'Staff': return perms?.cashierCanManageStaff === true;
        case 'Products': return perms?.cashierCanManageProducts === true;
        case 'Menu Availability': return perms?.cashierCanManageProducts === true;
        case 'Expenses': return perms?.cashierCanManageExpenses === true;
        case 'Inventory': return perms?.cashierCanAccessInventory === true;
        case 'Customers': return perms?.cashierCanManageCustomers === true;
        case 'Offers': return perms?.cashierCanManageOffers === true;
        case 'Reports': return perms?.cashierCanAccessReports === true;
        case 'Analytics': return perms?.cashierCanAccessAnalytics === true;
        case 'Finance': return perms?.cashierCanAccessFinance === true;
        case 'Reservations': return perms?.cashierCanAccessReservations === true;
        case 'Branches': return perms?.cashierCanAccessBranches === true;
        default: return ['Daily Sales', 'Activity Feed', 'Sync Status', 'Receipt History'].includes(itemId);
      }
    }
    // Manager permissions are controlled by Owner toggles
    if (isManager) {
      switch (itemId) {
        case 'Staff': return perms?.managerCanManageStaff === true;
        case 'Products': return perms?.managerCanManageProducts === true;
        case 'Menu Availability': return perms?.managerCanManageProducts === true;
        case 'Expenses': return perms?.managerCanManageExpenses === true;
        case 'Inventory': return perms?.managerCanAccessInventory === true;
        case 'Customers': return perms?.managerCanManageCustomers === true;
        case 'Offers': return perms?.managerCanManageOffers === true;
        case 'Reports': return perms?.managerCanAccessReports === true;
        case 'Analytics': return perms?.managerCanAccessAnalytics === true;
        case 'Finance': return perms?.managerCanAccessFinance === true;
        case 'Reservations': return perms?.managerCanAccessReservations === true;
        case 'Branches': return perms?.managerCanAccessBranches === true;
        default: return true; // Daily Sales, Activity Feed, Z-Report, Sync, Receipt History always accessible
      }
    }
    return true;
  };

  const items = [
    ...(isInventoryEnabled ? [{ icon: Layers, label: 'Inventory', desc: 'Stock & purchase management', action: () => onNavigate('Inventory'), color: 'text-[var(--brand-color)]' as const }] : []),
    ...(isProductsEnabled ? [{ icon: Layers, label: 'Products', desc: 'Catalog management', action: () => onNavigate('Products'), color: 'text-orange-600' as const }] : []),
    ...(isMenuAvailabilityEnabled ? [{ icon: ToggleLeft, label: 'Menu Availability', desc: 'Online ordering availability', action: () => onNavigate('MenuAvailability'), color: 'text-teal-600' as const }] : []),
    ...(isQrStudioEnabled ? [{ icon: QrCode, label: 'QR Studio', desc: 'Print QR ordering stickers', action: () => onNavigate('QrStudio'), color: 'text-purple-600' as const }] : []),
    ...(isExpensesEnabled ? [{ icon: TrendingDown, label: 'Expenses', desc: 'Expense tracking', action: () => onNavigate('Expenses'), color: 'text-red-600' as const }] : []),
    ...(isReservationsEnabled ? [{ icon: CalendarClock, label: 'Reservations', desc: 'Table booking & waitlist', action: () => onNavigate('Reservations'), color: 'text-rose-600' as const }] : []),
    ...(isAnalyticsEnabled ? [{ icon: TrendingUp, label: 'Analytics', desc: 'Business intelligence & trends', action: () => onNavigate('Analytics'), color: 'text-indigo-600' as const }] : []),
    ...(isFinanceEnabled ? [{ icon: BarChart3, label: 'Finance', desc: 'Profit & Loss statement', action: () => onNavigate('Finance'), color: 'text-emerald-600' as const }] : []),
    ...(isLoyaltyEnabled ? [{ icon: Users, label: 'Customers', desc: 'Loyalty management', action: () => onNavigate('Customers'), color: 'text-green-600' as const }] : []),
    ...(isOffersEnabled ? [{ icon: Award, label: 'Offers', desc: 'Reward tiers', action: () => onNavigate('Offers'), color: 'text-amber-600' as const }] : []),
    ...(isStaffEnabled ? [{ icon: Shield, label: 'Staff', desc: 'Employee management', action: () => onNavigate('Staff'), color: 'text-blue-600' as const }] : []),
    ...(isMultiBranchEnabled ? [{ icon: Building2, label: 'Branches', desc: 'Multi-location management', action: () => onNavigate('Branches'), color: 'text-purple-600' as const }] : []),
    { icon: DollarSign, label: 'Daily Sales', desc: 'View today revenue', action: onOpenDailySales, color: 'text-green-600' },
    { icon: Activity, label: 'Activity Feed', desc: 'Transaction history', action: onOpenActivityFeed, color: 'text-blue-600' },
    { icon: FileText, label: 'Z-Report', desc: 'End of day report', action: onOpenZReport, color: 'text-purple-600' },
    { icon: Receipt, label: 'Receipt History', desc: 'Search & reprint receipts', action: () => onNavigate('ReceiptHistory'), color: 'text-amber-600' },
    { icon: RefreshCw, label: 'Sync Status', desc: 'Cloud sync panel', action: onOpenSyncPanel, color: 'text-[var(--brand-color)]' },
    ...(isElectron ? [{ icon: Monitor, label: 'Kiosk Mode', desc: isKiosk ? 'Full-screen (active)' : 'Enter full-screen kiosk', action: handleToggleKiosk, color: isKiosk ? 'text-[var(--brand-color)]' as const : 'text-gray-500' as const }] : []),
  ];

  const filteredItems = items.filter(item => canAccess(item.label));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 bg-[#faf8ff]">
      <h2 className="text-xl font-bold">More Options</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} onClick={item.action}
              className="p-6 bg-white rounded-xl border border-[#e1e2ed] hover:shadow-md hover:border-[var(--brand-color)]/30 transition-all text-left cursor-pointer">
              <Icon className={`w-8 h-8 ${item.color} mb-2`} />
              <p className="text-sm font-bold">{item.label}</p>
              <p className="text-xs text-gray-500">{item.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
