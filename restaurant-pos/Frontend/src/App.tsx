/**
 * ============================================================================
 * FEATURE / COMPONENT: Main Application Composition Container (App.tsx)
 * ============================================================================
 * Purpose:
 * Root application component for the POS terminal. Composes all custom hooks,
 * handles workspace routing, manages active modal dialogs, and initializes
 * offline sync processes.
 *
 * Key Responsibilities:
 * - Employee session lifecycle & auth check (Login / First Time Setup)
 * - Navigation between POS Workspaces (Billing, Orders, Kitchen, Inventory, etc.)
 * - Keyboard shortcut event orchestration (F1 Search, F2 Phone, F8 Hold, F9 Pay)
 * - Offline sync buffer loop initialization
 *
 * Dependencies:
 * - useAuth (src/hooks/useAuth.ts)
 * - usePOSState (src/hooks/usePOSState.ts)
 * - useBilling (src/hooks/useBilling.ts)
 * - syncEngine (src/lib/syncEngine.ts)
 *
 * Developer Notes:
 * - DO NOT MODIFY: Viewport height container bindings (uses 100% flex height)
 * - SAFE TO EXTEND: Add new workspace tab cases inside the workspace router switch
 * ============================================================================
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { normalizeRole, type Order, type Bill, type LoyaltyReward } from './types';
import { setDBData, getDBData } from './data';
import { syncEngine } from './lib/syncEngine';
import { workspaceToPath, pathToWorkspace, DEFAULT_WORKSPACE, type WorkspaceName } from './routes';
import * as api from './api/client';
import { setOnApiError, setAuthToken, getAuthToken } from './api/client';
import { getOrCreateDeviceId } from './api/axios';
import { setAiAuth, setAiToken } from './ai/aiClient';
import { debugWarn } from './utils/debugLog';
import { computeKOTDelta } from './utils/kotDelta';
import { computeRunningBillTotals } from './utils/runningBill';

import { useAuth } from './hooks/useAuth';
// Eagerly loaded workspace components (core POS flow — needed offline)
import FirstTimeSetup from '../components/FirstTimeSetup';
import LoginScreen from '../components/LoginScreen';
import PinLoginScreen from '../components/PinLoginScreen';
import ReceiptModal from '../components/ReceiptModal';
import ShortcutsGuide from '../components/ShortcutsGuide';
import KOTModal from '../components/KOTModal';
import OrderTimeline from '../components/OrderTimeline';
import AddOnModal, { hasCustomizationOptions, getAddOnsForCategory } from '../components/AddOnModal';
import AppTitleBar from '../components/AppTitleBar';
import AppSidebar from '../components/AppSidebar';
import ErrorBoundary from './components/ErrorBoundary';
import CustomerSearchPopup from './components/CustomerSearchPopup';
import DashboardWorkspace from '../components/DashboardWorkspace';
import OrderManager from '../components/OrderManager';
import BillingProductGrid from '../components/BillingProductGrid';
import CartPanel from '../components/CartPanel';
import KitchenDisplay from '../components/KitchenDisplay';
import MoreWorkspace from '../components/MoreWorkspace';
import PlanSelectionPage from '../components/PlanSelectionPage';
// Type-only import for TourActions (used in tourActions object)
import type { TourActions } from '../components/GuidedTour';

// Lazy-loaded admin/settings workspace components (rarely used, heavy dependencies).
// Phase 1.10: every lazy import is wrapped in `safeLazy` so a chunk that fails to
// fetch (e.g. device just went offline before the chunk was cached) resolves to a
// harmless placeholder instead of rejecting and unmounting the entire POS tree.
const safeLazy = (loader: () => Promise<{ default: React.ComponentType<any> }>) =>
  React.lazy(() =>
    loader().catch(() => ({
      default: (() => (
        <div className="flex items-center justify-center h-40 text-sm text-gray-400">
          This section is unavailable while offline. Reconnect and try again.
        </div>
      )) as unknown as React.ComponentType<any>,
    })),
  );

const ProductManager = safeLazy(() => import('../components/ProductManager'));
const CustomerManager = safeLazy(() => import('../components/CustomerManager'));
const OffersManager = safeLazy(() => import('../components/OffersManager'));
const ReportsManager = safeLazy(() => import('../components/ReportsManager'));
const StaffManager = safeLazy(() => import('../components/StaffManager'));
const SettingsManager = safeLazy(() => import('../components/SettingsManager'));
const BranchManager = safeLazy(() => import('../components/BranchManager'));
const ReceiptHistory = safeLazy(() => import('../components/ReceiptHistory'));
const ExpenseManager = safeLazy(() => import('../components/ExpenseManager'));
const ReservationWorkspace = safeLazy(() => import('../components/ReservationWorkspace'));
const AnalyticsWorkspace = safeLazy(() => import('../components/AnalyticsWorkspace'));
const FinanceWorkspace = safeLazy(() => import('../components/FinanceWorkspace'));
const InventoryManager = safeLazy(() => import('../components/inventory/InventoryManager'));
const GuidedTour = safeLazy(() => import('../components/GuidedTour'));

// Hooks
import { useNotifications } from './hooks/useNotifications';
import { usePOSState } from './hooks/usePOSState';
import { useBilling } from './hooks/useBilling';
import { useOrders } from './hooks/useOrders';
import { useLoyalty } from './hooks/useLoyalty';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
// Modal components
import ConfirmationDialog from './components/modals/ConfirmationDialog';
import PaymentConfirmModal from './components/modals/PaymentConfirmModal';
import KOTPreviewModal from './components/modals/KOTPreviewModal';
import OffersPopup from './components/modals/OffersPopup';
import SplitPaymentModal from './components/modals/SplitPaymentModal';
import OTPVerificationModal from './components/modals/OTPVerificationModal';
import HeldOrdersDrawer from './components/modals/HeldOrdersDrawer';
import DailySalesModal from './components/modals/DailySalesModal';
import ActivityFeedModal from './components/modals/ActivityFeedModal';
import ZReportModal from './components/modals/ZReportModal';
import SyncPanelModal from './components/modals/SyncPanelModal';
import VoidReasonModal from './components/modals/VoidReasonModal';
import BillActionModal from './components/modals/BillActionModal';
import LayoutDiagnostic from './components/LayoutDiagnostic';

export default function App() {
  // Toast/notifications
  const { toasts, showToast } = useNotifications();

  // Core POS state — everything comes from here
  const pos = usePOSState();
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = React.useState(false);
  // Position + PIN switch-user screen (opened from the Exit button)
  const [isPinSwitchOpen, setIsPinSwitchOpen] = React.useState(false);

  // ─── Auth integration ───────────────────────────────────────
  const auth = useAuth();

  // ─── First-time setup check ──────────────────────────────────
  // On mount, check if an Owner exists. If not, show FirstTimeSetup.
  // Uses a 'loading' tri-state to avoid flashing the wrong screen.
  const [setupState, setSetupState] = React.useState<'loading' | 'setup' | 'ready'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.isAuthenticated) {
        if (!cancelled) setSetupState('ready');
        return;
      }
      // If a current employee is stored in localStorage, skip the check
      const storedEmployee = localStorage.getItem('pos_current_employee');
      if (storedEmployee && JSON.parse(storedEmployee)?.role === 'Owner') {
        if (!cancelled) setSetupState('ready');
        return;
      }
      const exists = await api.checkOwnerExists();
      if (!cancelled) {
        setSetupState(exists ? 'ready' : 'setup');
      }
    })();
    return () => { cancelled = true; };
  }, [auth.isAuthenticated]);

  // ─── Token sync: API client ↔ AI client ───────────────────────
  // Restore JWT from localStorage on mount
  React.useEffect(() => {
    const storedToken = localStorage.getItem('pos_access_token') || localStorage.getItem('pos_auth_token');
    if (storedToken) {
      setAuthToken(storedToken);
      setAiToken(storedToken);
    }
  }, []);

  // Register API error handler + auth headers when employee changes
  React.useEffect(() => {
    if (pos.currentEmployee) {
      setAiAuth(pos.currentEmployee.id, pos.currentEmployee.role);
      // Sync the JWT token from API client to AI client
      const token = getAuthToken();
      if (token) setAiToken(token);
      // No user-facing API error toast: reads fall back to the local cache and
      // failed writes are queued by the sync engine for replay on reconnect,
      // so surfacing a toast for every offline request is pure noise.
      setOnApiError(null);
    }
    return () => { setOnApiError(null); setAiAuth(null, null); setAiToken(null); };
  }, [pos.currentEmployee]);

  // Clear JWT token on logout (when currentEmployee becomes null)
  React.useEffect(() => {
    if (!pos.currentEmployee) {
      setAuthToken(null);
      setAiToken(null);
      localStorage.removeItem('pos_auth_token');
      localStorage.removeItem('pos_access_token');
      localStorage.removeItem('pos_refresh_token');
    }
  }, [pos.currentEmployee]);
  // ─── Device Registration ───────────────────────────────────
  // Register this device after successful login
  React.useEffect(() => {
    if (!pos.currentEmployee) return;
    const token = getAuthToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        // Shared stable device ID helper (also used by login/refresh) —
        // keeps the login-time deviceInfo and registerDevice in sync.
        const deviceId = getOrCreateDeviceId();
        await api.registerDevice({
          deviceId,
          deviceName: navigator.platform || 'Unknown',
          os: navigator.platform || '',
          osVersion: navigator.userAgent || '',
          appVersion: '1.0.0',
        });
      } catch {
        // Device registration is best-effort — don't block the user
      }
    })();
    return () => { cancelled = true; };
  }, [pos.currentEmployee]);

  // ─── Subscription / Plan selection check ─────────────────
  const [needsPlanSelection, setNeedsPlanSelection] = React.useState<'loading' | 'yes' | 'no'>('loading');
  const [trialInfo, setTrialInfo] = React.useState<{ trialEnd: string; daysRemaining: number } | null>(null);

  // After login, check if subscription is active
  React.useEffect(() => {
    if (!pos.currentEmployee) {
      setNeedsPlanSelection('loading');
      setTrialInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sub = await api.fetchSubscriptionStatus();
        if (!cancelled) {
          if (sub && (sub as any).status === 'suspended') {
            setNeedsPlanSelection('yes');
            setTrialInfo(null);
          } else {
            setNeedsPlanSelection('no');
            // Check if in trial mode
            if (sub && (sub as any).status === 'trial' && (sub as any).trialEnd) {
              const trialEnd = new Date((sub as any).trialEnd);
              const now = new Date();
              const daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
              setTrialInfo({ trialEnd: (sub as any).trialEnd, daysRemaining });
            } else {
              setTrialInfo(null);
            }
          }
        }
      } catch {
        if (!cancelled) setNeedsPlanSelection('no');
      }
    })();
    return () => { cancelled = true; };
  }, [pos.currentEmployee]);

  const [receiptAutoPrint, setReceiptAutoPrint] = React.useState(false);

  // ─── Bill action (refund / void) modal state ─────────────────
  // Refund/Void require an Owner/Manager PIN — verified server-side.
  const [billAction, setBillAction] = React.useState<{ mode: 'refund' | 'void'; bill: Bill } | null>(null);
  const [isBillActionProcessing, setIsBillActionProcessing] = React.useState(false);

  // ============ ROUTING SYNC ============
  const navigate = useNavigate();
  const location = useLocation();

  // URL → workspace: browser nav (back/forward) or login reads the URL
  // If workspace already matches, setActiveWorkspace is a no-op (no loop)
  useEffect(() => {
    if (!pos.currentEmployee || location.pathname === '/') return;
    const ws = pathToWorkspace(location.pathname);
    if (ws !== pos.activeWorkspace) {
      pos.setActiveWorkspace(ws);
    }
  }, [location.pathname, pos.currentEmployee]);

  // workspace → URL: internal navigation keeps URL in sync
  useEffect(() => {
    if (!pos.currentEmployee) return;
    const targetPath = workspaceToPath(pos.activeWorkspace);
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [pos.activeWorkspace, pos.currentEmployee]);

  // ============ ROLE-BASED WORKSPACE GUARD ============
  // Map each workspace to the permission toggles that gate it.
  // 'Owner' can access everything. 'Manager' and 'Cashier' access depends on
  // the Owner-configured rolePermissions toggles; operational base modules
  // (Dashboard, Orders, Billing, Kitchen, More, Receipt History) are always open.
  const WORKSPACE_ACCESS: Record<string, { manager?: keyof typeof pos.rolePermissions; cashier?: keyof typeof pos.rolePermissions }> = {
    Dashboard: {},
    Orders: {},
    Billing: {},
    Kitchen: {},
    More: {},
    ReceiptHistory: {},
    // Manager + Cashier restricted (require the matching permission toggle)
    Products: { manager: 'managerCanManageProducts', cashier: 'cashierCanManageProducts' },
    Customers: { manager: 'managerCanManageCustomers', cashier: 'cashierCanManageCustomers' },
    Offers: { manager: 'managerCanManageOffers', cashier: 'cashierCanManageOffers' },
    Reports: { manager: 'managerCanAccessReports', cashier: 'cashierCanAccessReports' },
    Staff: { manager: 'managerCanManageStaff', cashier: 'cashierCanManageStaff' },
    Branches: { manager: 'managerCanAccessBranches', cashier: 'cashierCanAccessBranches' },
    Settings: { manager: 'managerCanAccessSettings', cashier: 'cashierCanAccessSettings' },
    Expenses: { manager: 'managerCanManageExpenses', cashier: 'cashierCanManageExpenses' },
    Reservations: { manager: 'managerCanAccessReservations', cashier: 'cashierCanAccessReservations' },
    Analytics: { manager: 'managerCanAccessAnalytics', cashier: 'cashierCanAccessAnalytics' },
    Finance: { manager: 'managerCanAccessFinance', cashier: 'cashierCanAccessFinance' },
    Inventory: { manager: 'managerCanAccessInventory', cashier: 'cashierCanAccessInventory' },
    InventoryDashboard: { manager: 'managerCanAccessInventory', cashier: 'cashierCanAccessInventory' },
  };

  // Base operational modules every role can always use.
  const BASE_WORKSPACES = ['Dashboard', 'Orders', 'Billing', 'Kitchen', 'More', 'ReceiptHistory'];

  const canAccessWorkspace = useCallback((ws: string): boolean => {
    const employee = pos.currentEmployee;
    if (!employee) return true; // Allow during login
    if (employee.role === 'Owner') return true; // Owner always has full access

    const access = WORKSPACE_ACCESS[ws];
    if (!access) return true; // Unknown workspace — allow (fallback open)

    if (employee.role === 'Cashier') {
      // Base operational modules are always available to Cashier
      if (BASE_WORKSPACES.includes(ws)) return true;
      // Everything else follows the Owner-configured cashier toggles
      if (access.cashier) return pos.rolePermissions[access.cashier] === true;
      return false;
    }

    if (employee.role === 'Manager') {
      // Manager: check the specific permission toggle
      if (access.manager) {
        return pos.rolePermissions[access.manager] === true;
      }
      return true; // No permission gate = accessible
    }

    return true;
  }, [pos.currentEmployee, pos.rolePermissions]);

  // Whether the current employee may apply manual discounts on bills.
  // Owner always can; Manager/Cashier depend on the Owner-configured toggles.
  const canApplyDiscount = (() => {
    const role = pos.currentEmployee?.role;
    if (role === 'Owner') return true;
    if (role === 'Manager') return pos.rolePermissions.managerCanApplyDiscounts === true;
    if (role === 'Cashier') return pos.rolePermissions.cashierCanApplyDiscounts === true;
    return true;
  })();

  // Watch activeWorkspace — if the user somehow lands on an unauthorized page, redirect to Dashboard
  useEffect(() => {
    if (!pos.currentEmployee || !pos.activeWorkspace) return;
    if (!canAccessWorkspace(pos.activeWorkspace as string)) {
      showToast('Access denied. Redirected to Dashboard.', 'warning');
      pos.setActiveWorkspace('Dashboard');
    }
  }, [pos.activeWorkspace, pos.currentEmployee, canAccessWorkspace]);

  // ============ BILLING HOOK ============
  const billing = useBilling({
    cartItems: pos.cartItems,
    setCartItems: pos.setCartItems,
    activeOrder: pos.activeOrder,
    setActiveOrder: pos.setActiveOrder,
    orders: pos.orders,
    setOrders: pos.setOrders,
    customers: pos.customers,
    setCustomers: pos.setCustomers,
    bills: pos.bills,
    setBills: pos.setBills,
    searchedCustomer: pos.searchedCustomer,
    setSearchedCustomer: pos.setSearchedCustomer,
    customerPhone: pos.customerPhone,
    setCustomerPhone: pos.setCustomerPhone,
    appliedReward: pos.appliedReward,
    setAppliedReward: pos.setAppliedReward,
    paymentMethod: pos.paymentMethod,
    setPaymentMethod: pos.setPaymentMethod,
    orderType: pos.orderType,
    setOrderType: pos.setOrderType,
    splitDetails: pos.splitDetails,
    setSplitDetails: pos.setSplitDetails,
    settings: pos.settings,
    currentEmployee: pos.currentEmployee,
    products: pos.products,
    heldOrders: pos.heldOrders,
    setHeldOrders: pos.setHeldOrders,
    tables: pos.tables,
    setTables: pos.setTables,
    takeawayOrders: pos.takeawayOrders,
    setTakeawayOrders: pos.setTakeawayOrders,
    refreshDailyStats: pos.refreshDailyStats,
    showToast,
  });

  // Ask confirmation helper — must be defined BEFORE useOrders
  const askConfirmation = useCallback((title: string, message: string, onConfirm: () => void) => {
    pos.setConfirmState({
      isOpen: true, title, message,
      onConfirm: () => { onConfirm(); pos.setConfirmState(prev => ({ ...prev, isOpen: false })); },
    });
  }, [pos.setConfirmState]);

  // ============ ORDERS HOOK ============
  const orderMgmt = useOrders({
    orders: pos.orders,
    setOrders: pos.setOrders,
    customers: pos.customers,
    setCustomers: pos.setCustomers,
    bills: pos.bills,
    setBills: pos.setBills,
    tables: pos.tables,
    setTables: pos.setTables,
    takeawayOrders: pos.takeawayOrders,
    setTakeawayOrders: pos.setTakeawayOrders,
    activeOrder: pos.activeOrder,
    setActiveOrder: pos.setActiveOrder,
    cartItems: pos.cartItems,
    setCartItems: pos.setCartItems,
    customerPhone: pos.customerPhone,
    setCustomerPhone: pos.setCustomerPhone,
    searchedCustomer: pos.searchedCustomer,
    setSearchedCustomer: pos.setSearchedCustomer,
    appliedReward: pos.appliedReward,
    setAppliedReward: pos.setAppliedReward,
    orderType: pos.orderType,
    setOrderType: pos.setOrderType,
    paymentMethod: pos.paymentMethod,
    setPaymentMethod: pos.setPaymentMethod,
    splitDetails: pos.splitDetails,
    setSplitDetails: pos.setSplitDetails,
    settings: pos.settings,
    moduleSettings: pos.moduleSettings,
    currentEmployee: pos.currentEmployee,
    products: pos.products,
    refreshDailyStats: pos.refreshDailyStats,
    showToast,
    askConfirmation,
    setIsKOTOpen: pos.setIsKOTOpen,
    setKotOrder: pos.setKotOrder,
    setIsKOTPreviewOpen: pos.setIsKOTPreviewOpen,
    setActiveWorkspace: pos.setActiveWorkspace as (ws: string) => void,
  });

  // ============ LOYALTY HOOK ============
  const loyalty = useLoyalty({
    customers: pos.customers,
    setCustomers: pos.setCustomers,
    products: pos.products,
    cartItems: pos.cartItems,
    setCartItems: pos.setCartItems,
    searchedCustomer: pos.searchedCustomer,
    setSearchedCustomer: pos.setSearchedCustomer,
    customerPhone: pos.customerPhone,
    setCustomerPhone: pos.setCustomerPhone,
    appliedReward: pos.appliedReward,
    setAppliedReward: pos.setAppliedReward,
    rewards: pos.rewards,
    settings: pos.settings,
    showToast,
    // Phase 1.6 — share the OTP modal state so the reward flow and the modal
    // read the same instance (previously two disconnected states existed).
    otpVerificationState: pos.otpVerificationState,
    setOtpVerificationState: pos.setOtpVerificationState,
  });

  // ============ KITCHEN CANCEL ITEM HANDLER ============
  const handleCancelOrderItem = useCallback((orderId: string, itemId: string, reason: string) => {
    const now = new Date().toISOString();
    const actor = pos.currentEmployee?.name || 'Kitchen';
    // Mark item as cancelled in order.items and kotRecords, add timeline event
    pos.setOrders((prev: any[]) => prev.map((o: any) => {
      if (o.id !== orderId) return o;
      const updatedItems = (o.items || []).map((item: any) =>
        item.id === itemId ? { ...item, cancelled: true, cancelReason: reason, cancelledAt: now, cancelledBy: actor } : item
      );
      const updatedKotRecords = (o.kotRecords || []).map((kot: any) => ({
        ...kot,
        items: (kot.items || []).map((item: any) =>
          item.id === itemId ? { ...item, cancelled: true, cancelReason: reason, cancelledAt: now, cancelledBy: actor } : item
        ),
      }));
      const timelineEvent = {
        id: `te_cancel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        timestamp: now,
        type: 'item_removed' as const,
        description: `Item cancelled: ${reason}`,
        actor,
      };
      return {
        ...o,
        items: updatedItems,
        kotRecords: updatedKotRecords,
        timeline: [...(o.timeline || []), timelineEvent],
        updatedAt: now,
      };
    }));
    // If the cancelled item is in the active cart, remove it and warn
    if (pos.activeOrder?.id === orderId) {
      const cancelledItem = pos.cartItems?.find((ci: any) => ci.id === itemId);
      if (cancelledItem) {
        pos.setCartItems((prev: any[]) => prev.filter((ci: any) => ci.id !== itemId));
        showToast(`Item "${cancelledItem.product?.name || ''}" was cancelled by kitchen. Removed from bill.`, 'warning');
      }
    }
    // BACKEND CALLED — sync cancelled order to cloud
    const updatedOrder = pos.orders.find((o: any) => o.id === orderId);
    if (updatedOrder) {
      const syncedOrder = {
        ...updatedOrder,
        items: (updatedOrder.items || []).map((item: any) =>
          item.id === itemId ? { ...item, cancelled: true, cancelReason: reason, cancelledAt: now, cancelledBy: actor } : item
        ),
        kotRecords: (updatedOrder.kotRecords || []).map((kot: any) => ({
          ...kot,
          items: (kot.items || []).map((item: any) =>
            item.id === itemId ? { ...item, cancelled: true, cancelReason: reason, cancelledAt: now, cancelledBy: actor } : item
          ),
        })),
      };
      api.updateOrder(orderId, syncedOrder).catch((err: any) => debugWarn('App', 'updateOrder (cancel item) failed:', err));
    }
  }, [pos.setOrders, pos.activeOrder, pos.setActiveOrder, pos.cartItems, pos.setCartItems, pos.currentEmployee, showToast]);

  // ============ KEYBOARD SHORTCUTS ============
  useKeyboardShortcuts({
    currentEmployee: pos.currentEmployee,
    activeOrder: pos.activeOrder,
    cartItems: pos.cartItems,
    customerPhone: pos.customerPhone,
    searchedCustomer: pos.searchedCustomer,
    orderType: pos.orderType,
    paymentMethod: pos.paymentMethod,
    appliedReward: pos.appliedReward,
    splitDetails: pos.splitDetails,
    isQuickFireActive: pos.isQuickFireActive,
    activeWorkspace: pos.activeWorkspace as string,
    setActiveWorkspace: pos.setActiveWorkspace as any,
    setBillingSearch: pos.setBillingSearch,
    setCustomerPhone: pos.setCustomerPhone,
    setSearchedCustomer: pos.setSearchedCustomer,
    setAppliedReward: pos.setAppliedReward,
    setIsHeldDrawerOpen: pos.setIsHeldDrawerOpen,
    setIsShortcutOpen: pos.setIsShortcutOpen,
    setIsSyncPanelOpen: pos.setIsSyncPanelOpen,
    setIsDailySalesOpen: pos.setIsDailySalesOpen,
    setIsHistoryFeedOpen: pos.setIsHistoryFeedOpen,
    setIsKOTOpen: pos.setIsKOTOpen,
    setIsTimelineOpen: pos.setIsTimelineOpen,
    setIsOffersPopupOpen: pos.setIsOffersPopupOpen,
    setIsSplitPopupOpen: pos.setIsSplitPopupOpen,
    setIsPaymentConfirmOpen: pos.setIsPaymentConfirmOpen,
    setIsZReportOpen: pos.setIsZReportOpen,
    setIsVoidReasonOpen: pos.setIsVoidReasonOpen,
    setIsAddOnModalOpen: pos.setIsAddOnModalOpen,
    setActiveOrder: pos.setActiveOrder,
    setCartItems: pos.setCartItems,
    setIsQuickFireActive: pos.setIsQuickFireActive,
    setQuickFireInput: pos.setQuickFireInput,
    showToast,
    showPaymentConfirm: () => {
      if (pos.cartItems.length === 0) {
        showToast('Please add products to checkout.', 'warning');
        return;
      }
      pos.setIsPaymentConfirmOpen(true);
    },
    handleHoldCurrentOrder: () => {
      if (pos.cartItems.length === 0) {
        showToast('Cannot hold an empty cart.', 'warning');
        return;
      }
      const newHold = {
        id: `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        timestamp: new Date().toLocaleTimeString(),
        items: pos.cartItems,
        customer: pos.searchedCustomer,
        type: pos.orderType,
        orderId: pos.activeOrder?.id,
      };
      pos.setHeldOrders([newHold, ...pos.heldOrders]);
      // BACKEND CALLED — persist the held order to /api/held-orders.
      api.createHeldOrder(newHold).catch((err: any) => debugWarn('App', 'createHeldOrder failed:', err));
      pos.setCartItems([]);
      pos.setCustomerPhone('');
      pos.setSearchedCustomer(null);
      pos.setAppliedReward(null);
      billing.setManualDiscount(0);
      pos.setActiveOrder(null);
      showToast('Active billing held successfully.', 'success');
    },
    billingSearchRef: pos.billingSearchRef,
    loyaltyPhoneRef: pos.loyaltyPhoneRef,
    quickFireRef: pos.quickFireRef,
  });


  // Calls the backend (manager PIN verified server-side), then updates the
  // local bills ledger so the UI reflects the refunded/voided state.
  // ─── Refund / Void submission handler ────────────────────────
  const handleBillActionSubmit = useCallback(async (payload: { items?: any[]; reason: string; managerPin: string }) => {
    if (!billAction) return;
    const { mode, bill } = billAction;
    setIsBillActionProcessing(true);
    try {
      let ok = false;
      if (mode === 'refund') {
        const res = await api.refundBill(bill.id, {
          items: payload.items,
          reason: payload.reason,
          refundedBy: pos.currentEmployee?.name || 'System',
          managerPin: payload.managerPin,
        });
        ok = !!res;
      } else {
        const res = await api.deleteBill(bill.id, {
          reason: payload.reason,
          voidedBy: pos.currentEmployee?.name || 'System',
          managerPin: payload.managerPin,
        });
        ok = !!res;
      }
      if (ok) {
        // Update the local ledger to reflect the correction.
        if (mode === 'refund') {
          pos.setBills((prev: Bill[]) => prev.map((b: Bill) =>
            b.id === bill.id ? { ...b, isRefunded: true, refundReason: payload.reason, refundedBy: pos.currentEmployee?.name } : b
          ));
        } else {
          pos.setBills((prev: Bill[]) => prev.map((b: Bill) =>
            b.id === bill.id ? { ...b, isVoided: true, voidReason: payload.reason, voidedBy: pos.currentEmployee?.name } : b
          ));
        }
        setBillAction(null);
        showToast(mode === 'refund' ? 'Bill refunded successfully.' : 'Bill voided successfully.', 'success');
      } else {
        showToast(mode === 'refund' ? 'Refund failed — check PIN and try again.' : 'Void failed — check PIN and try again.', 'warning');
      }
    } catch (err: any) {
      debugWarn('App', 'bill action failed:', err);
      showToast(err?.message || 'Action failed. Please try again.', 'warning');
    } finally {
      setIsBillActionProcessing(false);
    }
  }, [billAction, pos.currentEmployee, pos.setBills, showToast]);

  // ============ ADD-ON MODAL HANDLERS ============
  const handleOpenAddOnModal = useCallback((product: any, variant?: any) => {
    if (!product.variants && !hasCustomizationOptions(product)) {
      billing.handleAddProductToCart(product, variant);
      return;
    }
    pos.setAddOnModalProduct(product);
    pos.setAddOnModalVariant(variant);
    pos.setIsAddOnModalOpen(true);
  }, [billing.handleAddProductToCart, pos.setAddOnModalProduct, pos.setAddOnModalVariant, pos.setIsAddOnModalOpen]);

  const handleAddOnModalConfirm = useCallback((product: any, variant: any, quantity: number, notes: string, addOns: string[]) => {
    pos.setIsAddOnModalOpen(false);
    pos.setAddOnModalProduct(null);
    pos.setAddOnModalVariant(undefined);
    const rowId = variant ? `${product.id}_${variant.name}` : `${product.id}_none`;
    const productAddOns = getAddOnsForCategory(product.category);
    const addOnTotal = addOns.reduce((sum, id) => {
      const found = productAddOns.find((o: any) => o.id === id);
      return sum + (found?.price || 0);
    }, 0);
    const finalPrice = (variant ? variant.price : product.price) + addOnTotal;
    const existingIdx = pos.cartItems.findIndex((item: any) => item.id === rowId);
    if (existingIdx > -1) {
      const updated = [...pos.cartItems];
      updated[existingIdx].quantity += quantity;
      if (notes) updated[existingIdx].notes = notes;
      pos.setCartItems(updated);
    } else {
      pos.setCartItems([...pos.cartItems, {
        id: rowId, product, selectedVariant: variant,
        quantity, price: finalPrice, notes: notes || undefined,
      } as any]);
    }
    showToast(`${product.name} added to current bill.`, 'success');
  }, [pos.cartItems, pos.setCartItems, showToast,
      pos.setIsAddOnModalOpen, pos.setAddOnModalProduct, pos.setAddOnModalVariant]);

  // ============ KOT PREVIEW ============
  const showKOTPreview = useCallback(() => {
    if (!pos.activeOrder) { showToast('No active order', 'warning'); return; }
    const hasPrev = (pos.activeOrder.kotRecords || []).length > 0;
    const delta = computeKOTDelta(pos.cartItems, pos.activeOrder.lastKotSnapshot);
    if (delta.toPrint.length === 0) {
      if (hasPrev) {
        showToast('All items already sent to kitchen. Use Reprint to print again.', 'info');
        pos.setKotOrder(pos.activeOrder);
        pos.setIsKOTOpen(true);
      } else {
        showToast('No items in this order to send to kitchen', 'warning');
      }
      return;
    }
    const pendingItems: any[] = delta.toPrint.map(d => ({
      id: d.id, product: d.product, selectedVariant: d.selectedVariant,
      quantity: d.printQty, notes: d.notes, price: d.price,
    }));
    pos.setKotPreviewData({
      items: pendingItems,
      allItems: hasPrev ? (pos.activeOrder.kotRecords || []).flatMap((kot: any) => kot.items) : undefined,
      kotType: hasPrev ? 'Additional' as const : 'Original' as const,
      onConfirm: () => orderMgmt.handleConfirmKOT(pendingItems, hasPrev ? 'Additional' : 'Original'),
      onConfirmMerge: undefined,
    });
    pos.setIsKOTPreviewOpen(true);
  }, [pos.activeOrder, pos.currentEmployee, pos.orders,
      pos.cartItems, pos.setOrders, pos.setActiveOrder,
      pos.setKotOrder, pos.setKotPreviewData,
      pos.setIsKOTPreviewOpen, pos.setIsKOTOpen,
      orderMgmt.handleConfirmKOT, showToast]);

  // ============ HOLD / RECALL ============
  const handleHoldCurrentOrder = useCallback(() => {
    if (pos.cartItems.length === 0) {
      showToast('Cannot hold an empty cart.', 'warning');
      return;
    }
    askConfirmation(
      'Hold Current Order?',
      `This will suspend ${pos.cartItems.reduce((s: any, i: any) => s + i.quantity, 0)} items currently in the cart.`,
      () => {
        const newHold = {
          id: `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          timestamp: new Date().toLocaleTimeString(),
          items: pos.cartItems, customer: pos.searchedCustomer,
          type: pos.orderType, orderId: pos.activeOrder?.id,
        };
        pos.setHeldOrders([newHold, ...pos.heldOrders]);
        pos.setCartItems([]);
        pos.setCustomerPhone('');
        pos.setSearchedCustomer(null);
        pos.setAppliedReward(null);
        billing.setManualDiscount(0);
        pos.setActiveOrder(null);
        showToast('Active billing held successfully.', 'success');
      }
    );
  }, [pos.cartItems, pos.searchedCustomer, pos.orderType, pos.activeOrder,
      pos.heldOrders, pos.setHeldOrders, pos.setCartItems,
      pos.setCustomerPhone, pos.setSearchedCustomer, pos.setAppliedReward,
      pos.setActiveOrder, billing.setManualDiscount, askConfirmation, showToast]);

  const handleUpdateItemNotes = useCallback((itemId: string, notes: string) => {
    pos.setCartItems((prev: any[]) => prev.map((item: any) =>
      item.id === itemId ? { ...item, notes: notes || undefined } : item
    ));
  }, [pos.setCartItems]);

  const handleRecallHeldOrder = useCallback((holdId: string) => {
    const found = pos.heldOrders.find((h: any) => h.id === holdId);
    if (found) {
      if (found.orderId) {
        const existingOrder = pos.orders.find((o: any) => o.id === found.orderId);
        if (existingOrder) {
          // Merge held items into the existing order — rebuild cart from held items
          // but keep the existing order's KOT snapshot for delta detection
          const mergedOrder: Order = {
            ...existingOrder,
            items: found.items,
            timeline: [...(existingOrder.timeline || []), {
              id: `te_recall_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              timestamp: new Date().toISOString(),
              type: 'order_resumed' as const,
              description: `Order #${existingOrder.orderNumber} resumed from hold`,
              actor: pos.currentEmployee?.name,
            }],
            updatedAt: new Date().toISOString(),
          };
          // Update the order in the orders array
          pos.setOrders(prev => prev.map(o => o.id === found.orderId ? mergedOrder : o));
          pos.setActiveOrder(mergedOrder);
        } else {
          const fresh: Order = {
            id: found.orderId, orderNumber: pos.orders.length + 1001,
            type: found.type || 'Takeaway', status: 'New',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            items: found.items, kotRecords: [], timeline: [{
              id: `te_recall_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              timestamp: new Date().toISOString(),
              type: 'order_resumed' as const,
              description: `Order resumed from hold (was ${found.orderId})`,
              actor: pos.currentEmployee?.name,
            }],
            interimBillPrinted: false, finalBillPrinted: false,
            subtotal: 0, discount: 0, gst: 0, grandTotal: 0,
          };
          pos.setOrders([fresh, ...pos.orders]);
          pos.setActiveOrder(fresh);
        }
      }
      pos.setCartItems(found.items);
      pos.setOrderType(found.type);
      if (found.customer) {
        pos.setSearchedCustomer(found.customer);
        pos.setCustomerPhone(found.customer.phone);
      } else {
        pos.setSearchedCustomer(null);
        pos.setCustomerPhone('');
      }
      pos.setHeldOrders(pos.heldOrders.filter((h: any) => h.id !== holdId));
      // BACKEND CALLED — the hold is consumed on recall; remove it server-side.
      const serverId = found?.serverId;
      if (serverId && /^[a-fA-F0-9]{24}$/.test(serverId)) {
        api.deleteHeldOrder(serverId).catch((err: any) => debugWarn('App', 'deleteHeldOrder (recall) failed:', err));
      }
      pos.setIsHeldDrawerOpen(false);
      showToast('Suspended billing successfully recalled.', 'success');
    }
  }, [pos.heldOrders, pos.orders, pos.setHeldOrders, pos.setOrders,
      pos.setActiveOrder, pos.setCartItems, pos.setCustomerPhone,
      pos.setSearchedCustomer, pos.setOrderType, pos.setIsHeldDrawerOpen,
      pos.currentEmployee, showToast]);

  // ============ RECEIPT PREVIEW (LIVE BILL) ============
  const handleOpenReceiptPreview = useCallback((order: Order) => {
    const now = new Date();
    // Live source of truth: if this order is the currently active order, its
    // freshest items live in the cart (items just added but not yet KOT'd
    // included). Otherwise fall back to the order's own items array.
    const isActive = pos.activeOrder?.id === order.id;
    const liveItems = (isActive && pos.cartItems.length > 0 ? pos.cartItems : (order.items || []))
      .map((item: any) => ({ ...item }));
    const totals = computeRunningBillTotals(liveItems);
    const previewBill: Bill = {
      id: `preview_${order.id}`,
      invoiceNumber: `PREVIEW-${order.orderNumber}`,
      ticketNumber: `#${order.orderNumber}`,
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cashierName: pos.currentEmployee?.name || 'POS',
      cashierRole: pos.currentEmployee?.role || 'Staff',
      items: liveItems,
      subtotal: totals.subtotal, discount: totals.discount,
      gst: totals.gst, grandTotal: totals.grandTotal,
      paymentMethod: (order.paymentMethod as any) || 'Cash',
      orderType: order.type,
      customerPhone: order.customerPhone,
      customerName: order.customerName,
      pointsEarned: order.loyaltyPointsEarned || 0,
      pointsRedeemed: order.loyaltyPointsRedeemed || 0,
      redeemedRewardTitle: order.appliedRewardTitle,
      milestoneRewardAwarded: '',
      tableNumber: order.tableNumber,
      createdAt: order.createdAt,
    };
    pos.setIsLiveReceiptPreview(true);
    pos.setPreviewReceipt(previewBill);
  }, [pos.activeOrder, pos.cartItems, pos.currentEmployee, pos.setPreviewReceipt, pos.setIsLiveReceiptPreview]);

  // ============ TOUR ACTIONS ============
  const tourActions: TourActions = {
    navigateTo: async (ws: string) => { pos.setActiveWorkspace(ws as any); await new Promise(r => setTimeout(r, 150)); },
    createDineInOrder: async () => {
      const firstAvailable = pos.tables.find((t: any) => t.status === 'Available');
      pos.tourArtifactRef.current.ordersCount = pos.orders.length;
      if (firstAvailable) {
        const newOrder = orderMgmt.handleCreateOrder('Dine In', firstAvailable.id);
        if (newOrder) pos.tourArtifactRef.current.tourOrderIds = [...(pos.tourArtifactRef.current.tourOrderIds || []), newOrder.id];
        pos.tourArtifactRef.current.tableId = firstAvailable.id;
      } else if (pos.tables.length > 0) {
        const newOrder = orderMgmt.handleCreateOrder('Dine In', pos.tables[0].id);
        if (newOrder) pos.tourArtifactRef.current.tourOrderIds = [...(pos.tourArtifactRef.current.tourOrderIds || []), newOrder.id];
        pos.tourArtifactRef.current.tableId = pos.tables[0].id;
      } else {
        const newOrder = orderMgmt.handleCreateOrder('Takeaway');
        if (newOrder) pos.tourArtifactRef.current.tourOrderIds = [...(pos.tourArtifactRef.current.tourOrderIds || []), newOrder.id];
      }
    },
    addProductById: async (id: string) => {
      const p = pos.products.find((x: any) => x.id === id);
      if (p) billing.handleAddProductToCart(p);
    },
    addFirstProducts: async () => {
      const available = pos.products.filter((p: any) => p.availability);
      if (available.length > 0) {
        billing.handleAddProductToCart(available[0]);
        if (available.length > 1) billing.handleAddProductToCart(available[1]);
      } else {
        // Demo fallback: inject hardcoded products + cart items so the tour works without backend
        const demoProducts = [
          { id: 'demo_prod_1', name: 'Grilled Chicken Burger', price: 12.99, category: 'Main Course', image: '', gstPercent: 5, availability: true, code: 'B001' },
          { id: 'demo_prod_2', name: 'Classic Margherita Pizza', price: 14.99, category: 'Main Course', image: '', gstPercent: 5, availability: true, code: 'P001' },
        ];
        // Inject products so product cards render (needed for [data-tour="product-card"] target)
        pos.setProducts(demoProducts);
        // Inject cart items so billing/KOT/hold/pay steps work
        const demoItems = demoProducts.map(p => ({ id: `${p.id}_none`, product: p, quantity: p.id === 'demo_prod_1' ? 2 : 1, price: p.price }));
        pos.setCartItems(demoItems);
      }
    },
    setCustomerPhone: async (phone: string) => {
      const exists = pos.customers.find((c: any) => c.phone === phone);
      if (!exists) {
        // Inject demo loyalty customer
        const demoCustomer: any = {
          phone: '9876543210', name: 'Aarav Mehta', isNew: false, visits: 12, points: 450,
          email: 'aarav@example.com', lastVisit: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
          purchaseHistory: [],
        };
        pos.setCustomers([demoCustomer, ...pos.customers]);
      }
      loyalty.handleCustomerPhoneChange(phone);
    },
    openOffersPopup: async () => pos.setIsOffersPopupOpen(true),
    closeOffersPopup: async () => pos.setIsOffersPopupOpen(false),
    openKOTPreview: async () => showKOTPreview(),
    confirmKOT: async () => {
      if (!pos.activeOrder) return;
      const printedQty = new Map<string, number>();
      (pos.activeOrder.kotRecords || []).forEach((kot: any) =>
        kot.items.forEach((item: any) =>
          printedQty.set(item.id, (printedQty.get(item.id) || 0) + item.quantity)
        )
      );
      const pending: any[] = [];
      pos.cartItems.forEach((item: any) => {
        const printed = printedQty.get(item.id) || 0;
        const rem = item.quantity - printed;
        if (rem > 0) pending.push({ ...item, quantity: rem });
      });
      if (pending.length === 0) return;
      orderMgmt.handleConfirmKOT(pending);
    },
    holdOrder: async () => {
      if (pos.cartItems.length === 0) return;
      const holdId = `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      pos.setHeldOrders((prev: any) => {
        const next = [{
          id: holdId,          timestamp: new Date().toLocaleTimeString(),
          items: [...pos.cartItems], customer: pos.searchedCustomer,
          type: pos.orderType, orderId: pos.activeOrder?.id,
        }, ...prev];
        // BACKEND CALLED — persist the held order to /api/held-orders so it
        // can be resumed on any terminal. Best-effort; local copy is the fallback.
        api.createHeldOrder(next[0]).catch((err: any) => debugWarn('App', 'createHeldOrder failed:', err));
        setDBData('pos_held_orders', next);
        return next;
      });
      pos.tourArtifactRef.current.heldOrderIds = [...(pos.tourArtifactRef.current.heldOrderIds || []), holdId];
      pos.setCartItems([]);
      pos.setCustomerPhone('');
      pos.setSearchedCustomer(null);
      pos.setAppliedReward(null);
      pos.setActiveOrder(null);
    },
    recallOrder: async () => {
      if (pos.heldOrders.length > 0) handleRecallHeldOrder(pos.heldOrders[0].id);
    },
    openPayment: async () => pos.setIsPaymentConfirmOpen(true),
    closePayment: async () => pos.setIsPaymentConfirmOpen(false),
    closeKOTModal: async () => pos.setIsKOTOpen(false),
    toggleMoreBilling: async () => pos.setIsMoreBillingOpen(true),
    openHeldDrawer: async () => pos.setIsHeldDrawerOpen(true),
    closeHeldDrawer: async () => pos.setIsHeldDrawerOpen(false),
    onTourEnd: async () => {
      const { ordersCount, tableId, heldOrderIds, tourOrderIds } = pos.tourArtifactRef.current;
      // Remove tour-created orders by specific ID (more precise than slicing by count)
      if (tourOrderIds && tourOrderIds.length > 0) {
        pos.setOrders((prev: any[]) => prev.filter((o: any) => !tourOrderIds.includes(o.id)));
        // BACKEND CALLED — delete each tour-created order server-side so they
        // don't persist in /api/orders and resurface on the next fetch.
        tourOrderIds.forEach((id: string) => {
          api.deleteOrder(id).catch((err: any) => debugWarn('App', 'deleteOrder (tour cleanup) failed:', err));
        });
      } else if (typeof ordersCount === 'number') {
        pos.setOrders(pos.orders.slice(0, ordersCount));
      }
      pos.setActiveOrder(null);
      if (tableId) {
        pos.setTables(pos.tables.map((t: any) =>
          t.id === tableId
            ? { ...t, status: 'Available' as const, orderSince: undefined, orderId: undefined, guestCount: undefined, waiterId: undefined, waiterName: undefined }
            : t
        ));
      }
      if (heldOrderIds && heldOrderIds.length > 0) {
        const removedHolds = pos.heldOrders.filter((h: any) => heldOrderIds.includes(h.id));
        pos.setHeldOrders(pos.heldOrders.filter((h: any) => !heldOrderIds.includes(h.id)));
        // BACKEND CALLED — remove tour-created holds server-side.
        removedHolds.forEach((h: any) => {
          const serverId = h?.serverId;
          if (serverId && /^[a-fA-F0-9]{24}$/.test(serverId)) {
            api.deleteHeldOrder(serverId).catch((err: any) => debugWarn('App', 'deleteHeldOrder (tour cleanup) failed:', err));
          }
        });
      }
      pos.setCartItems([]);
      pos.setCustomerPhone('');
      pos.setSearchedCustomer(null);
      pos.setAppliedReward(null);
      pos.setIsMoreBillingOpen(false);
      pos.setIsHeldDrawerOpen(false);
      pos.tourArtifactRef.current = {};
    },
    closeAllModals: async () => {
      pos.setIsKOTOpen(false);
      pos.setIsKOTPreviewOpen(false);
      pos.setIsPaymentConfirmOpen(false);
      pos.setIsOffersPopupOpen(false);
      pos.setIsSplitPopupOpen(false);
      pos.setIsHeldDrawerOpen(false);
      pos.setIsAddOnModalOpen(false);
      pos.setIsMoreBillingOpen(false);
    },
  };

  // ─── Sync auth.employee → pos.currentEmployee when auth restores ──
  React.useEffect(() => {
    if (auth.isAuthenticated && auth.employee && !pos.currentEmployee) {
      pos.setCurrentEmployee({
        id: auth.employee.id,
        name: auth.employee.name,
        role: auth.employee.role,
        username: auth.employee.username,
        branchId: auth.employee.branchId,
        status: auth.employee.status,
      } as any);
    }
  }, [auth.isAuthenticated, auth.employee, pos.currentEmployee]);

// ─── First-time / main login ───────────────────────────────────────
  // The first login uses the User ID + Password provided by the admin. On
  // success we cache the employee WITH their PIN so the Position + PIN
  // switch screen can verify offline every time; new employees added via the
  // Staff screen sync into the same local list.
  // NOTE: these hooks are declared BEFORE any early return so Rules of Hooks
  // stay satisfied across loading/auth state transitions.
  const upsertLocalEmployee = useCallback((employee: any, pin?: string) => {
    if (!employee) return;
    const employees = getDBData<any[]>('pos_employees', []) || [];
    const existing = employees.find((e: any) =>
      e.username?.toLowerCase() === String(employee.username || '').toLowerCase() ||
      (e.id && employee.id && e.id === employee.id)
    );
    // Only store a PIN that the 4-digit pad can actually enter (StaffManager
    // enforces 4 digits; the first-time-setup password is a longer password,
    // not a PIN). Preserve any existing PIN otherwise.
    const pinToStore = pin && /^\d{4}$/.test(pin) ? pin : (existing?.pin || '');
    const record = {
      id: employee.id || existing?.id || `emp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      username: employee.username || existing?.username || '',
      name: employee.name || existing?.name || 'Staff',
      role: normalizeRole(employee.role ?? existing?.role ?? 'Cashier'),
      pin: pinToStore,
      status: employee.status ?? existing?.status ?? 'Active',
      branchId: employee.branchId ?? existing?.branchId,
    };
    const next = existing
      ? employees.map((e: any) => (e === existing ? { ...e, ...record } : e))
      : [record, ...employees];
    setDBData('pos_employees', next);
    pos.setEmployees(next as any);
    return record;
  }, [pos]);

  // First-time / main login (User ID + Password). The entered credential is
  // cached as the employee's local PIN so Position + PIN switching verifies
  // offline from the saved list; new employees added in Staff sync in too.
  const handleFirstLogin = useCallback((employee: any, pin?: string) => {
    if (!employee) return;
    upsertLocalEmployee(employee, pin);
    // Sync the JWT to the AI client synchronously BEFORE the Dashboard mounts.
    // Child effects (WeatherWidget, AI summary) run before App's
    // [pos.currentEmployee] effect, so without this the first AI calls would
    // fire with a null token and 401. getAuthToken() is already populated by
    // api.client.login().
    const token = getAuthToken();
    if (token) setAiToken(token);
    // Normalize role so every POS role check (Owner/Manager/Cashier) works
    // even when the backend returns lowercase roles.
    pos.setCurrentEmployee({ ...employee, role: normalizeRole(employee.role) });
    pos.setActiveWorkspace('Dashboard');
  }, [upsertLocalEmployee, pos]);

  // Handle first-time setup owner creation — persist the owner record locally.
  // Note: the setup password (>=6 chars) is NOT cached as a 4-digit PIN, so the
  // Owner must set a 4-digit PIN in Staff before Position + PIN switching works.
  const handleSetupComplete = useCallback((employee: any, pin?: string) => {
    const emp = {
      id: employee.id,
      name: employee.name,
      role: normalizeRole(employee.role),
      branchId: employee.branchId,
      username: employee.username,
      status: 'Active',
    };
    upsertLocalEmployee(emp, pin);
    // Same token-sync as handleFirstLogin — registerOwner already stored the
    // JWT via setAuthToken(), so make it available to the AI client before the
    // dashboard's weather/summary child effects fire.
    const token = getAuthToken();
    if (token) setAiToken(token);
    pos.setCurrentEmployee(emp as any);
    pos.setActiveWorkspace('Dashboard');
  }, [upsertLocalEmployee, pos.setCurrentEmployee, pos.setActiveWorkspace]);

  // Position + PIN switch success — keep the terminal session, swap the
  // active employee and end the previous shift (clear cart/order). Full
  // backend logout lives in Settings → Logout.
  const handlePinSwitchSuccess = useCallback((employee: any) => {
    pos.setCurrentEmployee(employee);
    pos.setCartItems([]);
    pos.setCustomerPhone('');
    pos.setSearchedCustomer(null);
    pos.setAppliedReward(null);
    pos.setActiveOrder(null);
    setIsPinSwitchOpen(false);
    showToast(`Signed in as ${employee.name} (${normalizeRole(employee.role)})`, 'success');
  }, [pos, showToast]);

  // Full logout used by Settings → Logout — returns to the main User ID login.
  const handleFullLogout = useCallback(() => {
    auth.logout();
    pos.setCurrentEmployee(null as any);
    pos.setCartItems([]);
    pos.setCustomerPhone('');
    pos.setSearchedCustomer(null);
    pos.setAppliedReward(null);
    pos.setActiveOrder(null);
    setIsPinSwitchOpen(false);
    showToast('Logged out successfully.', 'info');
  }, [auth, pos, showToast]);

  // Show loading screen while checking auth
  if (auth.isLoading || setupState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center bg-[#faf8ff]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#004ac6] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Initializing POS Terminal...</p>
        </div>
      </div>
    );
  }

  // Show LoginScreen if not authenticated
  if (!auth.isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleFirstLogin} settings={pos.settings} />;
  }

  // Show first-time setup if no Owner exists
  if (setupState === 'setup') {
    return (
      <FirstTimeSetup onSetupComplete={handleSetupComplete} />
    );
  }

  // Show main POS if authenticated and setup is complete
  if (!pos.currentEmployee) {
    // If we have an auth.employee but no pos.currentEmployee, sync them
    if (auth.employee) {
      pos.setCurrentEmployee({
        id: auth.employee.id,
        name: auth.employee.name,
        role: auth.employee.role,
        username: auth.employee.username,
        branchId: auth.employee.branchId,
        status: auth.employee.status,
      } as any);
    }
  }

  // If subscription is suspended, show plan selection page instead of POS
  if (needsPlanSelection === 'loading') {
    return (
      <div className="h-full flex items-center justify-center bg-[#faf8ff]">
        <div className="w-8 h-8 border-2 border-[#004ac6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsPlanSelection === 'yes') {
    return <PlanSelectionPage onPlanSelected={() => { setNeedsPlanSelection('no'); window.location.reload(); }} />;
  }

  return (
    <div className="h-full overflow-hidden bg-[#faf8ff] text-[#191b23] flex flex-col font-sans">
      {!pos.currentEmployee ? (
        <LoginScreen onLoginSuccess={handleFirstLogin} settings={pos.settings} />
      ) : (
        <>
          {/* Trial countdown banner */}
          {trialInfo && (
            <div className={`shrink-0 px-4 py-2 flex items-center justify-between text-xs font-medium ${
              trialInfo.daysRemaining <= 3
                ? 'bg-red-50 text-red-700 border-b border-red-200'
                : trialInfo.daysRemaining <= 7
                  ? 'bg-amber-50 text-amber-700 border-b border-amber-200'
                  : 'bg-blue-50 text-blue-700 border-b border-blue-200'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-base">{trialInfo.daysRemaining <= 3 ? '🔥' : trialInfo.daysRemaining <= 7 ? '⏰' : '🎯'}</span>
                <span>
                  <strong>Free Trial:</strong> {trialInfo.daysRemaining} day{trialInfo.daysRemaining !== 1 ? 's' : ''} remaining
                  {trialInfo.daysRemaining <= 3 && (
                    <span className="ml-1.5 font-bold">— Select a plan to continue after trial!</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-white/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      trialInfo.daysRemaining <= 3 ? 'bg-red-500' : trialInfo.daysRemaining <= 7 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.max(5, Math.min(100, (trialInfo.daysRemaining / 7) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] opacity-75">Expires {new Date(trialInfo.trialEnd).toLocaleDateString()}</span>
              </div>
            </div>
          )}
          <AppTitleBar restaurantName={pos.settings.restaurantName} isOnline={pos.isOnline} branches={pos.branches} currentBranchId={pos.currentBranchId} onSetCurrentBranch={pos.setCurrentBranchId} showBranchSelector={pos.isMultiBranchEnabled && (pos.currentEmployee?.role === 'Owner' || pos.currentEmployee?.role === 'Manager')} />
          <div className="flex flex-1 min-h-0 overflow-hidden w-full" style={{ direction: 'ltr' }}>
            {pos.activeWorkspace !== 'Billing' && (
              <AppSidebar
                activeWorkspace={pos.activeWorkspace as string}
                onNavigate={(ws) => pos.setActiveWorkspace(ws as any)}
                showKitchen={pos.moduleSettings.enableKitchenDisplay !== false}
                role={pos.currentEmployee?.role}
                rolePermissions={pos.rolePermissions}
                onLogout={() => setIsPinSwitchOpen(true)}
                onTour={() => { pos.setIsOnboardingOpen(true); localStorage.removeItem('pos_onboarding_done'); }}
                onKeys={() => pos.setIsShortcutOpen(true)}
              />
            )}
            <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#faf8ff]">
              <React.Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <div className="w-6 h-6 border-2 border-[#004ac6] border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-gray-500">Loading...</span>
                </div>
              }>
              <ErrorBoundary key={pos.activeWorkspace}>
              {pos.activeWorkspace === 'Dashboard' && (
                <DashboardWorkspace
                  dailySales={pos.dailySales}
                  bills={pos.bills}
                  orders={pos.orders}
                  tables={pos.tables}
                  customers={pos.customers}
                  employees={pos.employees}
                  products={pos.products}
                  currentEmployee={pos.currentEmployee!}
                  settings={pos.settings}
                  currencySymbol={pos.settings.currencySymbol}
                  totalExpensesToday={(() => {
                    const todayStr = new Date().toISOString().slice(0, 10);
                    return pos.expenses.filter((e: any) => e.date === todayStr).reduce((s: number, e: any) => s + e.amount, 0);
                  })()}
                  totalExpensesThisMonth={(() => {
                    const thisMonth = new Date().toISOString().slice(0, 7);
                    return pos.expenses.filter((e: any) => e.date.startsWith(thisMonth)).reduce((s: number, e: any) => s + e.amount, 0);
                  })()}
                  currentBranchName={pos.currentBranch?.name}
                  showBranchIndicator={pos.isMultiBranchEnabled && !!pos.currentBranch}
                  onNavigate={(ws) => pos.setActiveWorkspace(ws as any)}
                  onOpenDailySales={() => pos.setIsDailySalesOpen(true)}
                  onOpenZReport={() => pos.setIsZReportOpen(true)}
                  onOpenSyncPanel={() => pos.setIsSyncPanelOpen(true)}
                  moduleSettings={pos.moduleSettings}
                />
              )}
              {pos.activeWorkspace === 'Orders' && (
                <OrderManager
                  orders={pos.orders}
                  tables={pos.tables}
                  takeawayOrders={pos.takeawayOrders}
                  onOpenOrder={orderMgmt.handleOpenOrder}
                  onCreateOrder={orderMgmt.handleCreateOrder}
                  onCreateTakeawayOrder={orderMgmt.handleCreateTakeawayOrder}
                  onUpdateTakeawayOrder={orderMgmt.handleUpdateTakeawayOrder}
                  onClearCompletedTakeaways={orderMgmt.handleClearCompletedTakeaways}
                  onOpenBilling={orderMgmt.handleOpenOrder}
                  onOpenReceiptPreview={handleOpenReceiptPreview}
                  employees={pos.employees}
                  settings={pos.settings}
                  currentEmployee={pos.currentEmployee!}
                  showToast={showToast}
                  onAddTable={orderMgmt.handleAddTable}
                  onUpdateTable={orderMgmt.handleUpdateTable}
                  onDeleteTable={orderMgmt.handleDeleteTable}
                  floors={pos.floors}
                />
              )}
              {pos.activeWorkspace === 'Billing' && (
                <div className="flex flex-1 min-h-0 overflow-hidden w-full">
                  <BillingProductGrid
                    categories={pos.categories}
                    billingCategory={pos.billingCategory}
                    onSetCategory={pos.setBillingCategory}
                    billingSearch={pos.billingSearch}
                    onSetSearch={pos.setBillingSearch}
                    billingSearchRef={pos.billingSearchRef}
                    onBackToOrders={() => pos.setActiveWorkspace('Orders')}
                    showFavoritesOnly={pos.showFavoritesOnly}
                    onToggleFavorites={() => pos.setShowFavoritesOnly(!pos.showFavoritesOnly)}
                    products={pos.products}
                    categoryColors={pos.categoryColors}
                    moduleSettings={pos.moduleSettings}
                    currencySymbol={pos.settings.currencySymbol}
                    onAddProduct={handleOpenAddOnModal}
                  />
                  <CartPanel
                    cartWidth={pos.cartWidth}
                    startResizeCart={pos.startResizeCart}
                    cartItems={pos.cartItems}
                    activeOrder={pos.activeOrder}
                    heldOrders={pos.heldOrders}
                    onOpenHeldDrawer={() => pos.setIsHeldDrawerOpen(true)}
                    settings={pos.settings}
                    onPaymentChange={(v) => pos.setPaymentMethod(v)}
                    onOrderTypeChange={(v) => pos.setOrderType(v)}
                    paymentMethod={pos.paymentMethod}
                    orderType={pos.orderType}
                    calculateCartSubtotal={billing.calculateCartSubtotal}
                    calculateCartDiscount={billing.calculateCartDiscount}
                    calculateCartTaxes={billing.calculateCartTaxes}
                    calculateCartGrandTotal={billing.calculateCartGrandTotal}
                    onAdjustQuantity={billing.handleAdjustQuantity}
                    onDeleteItem={billing.handleDeleteCartItem}
                    onShowKOT={showKOTPreview}
                    onShowPayment={() => pos.setIsPaymentConfirmOpen(true)}
                    onHoldOrder={handleHoldCurrentOrder}
                    products={pos.products}
                    quickFireInput={pos.quickFireInput}
                    onQuickFireChange={pos.setQuickFireInput}
                    quickFireSessionCount={pos.quickFireSessionCount}
                    quickFireFlash={pos.quickFireFlash}
                    onQuickFireKeyDown={(e: any) => {
                      if (e.key === 'Enter' && pos.quickFireInput.trim()) {
                        const query = pos.quickFireInput.trim();
                        const ql = query.toLowerCase();
                        // Prioritize barcode (hardware scanners type digits + Enter),
                        // then exact code, exact name, then partial code/name.
                        let found = pos.products.find((p: any) =>
                          p.barcode && String(p.barcode).toLowerCase() === ql
                        );
                        if (!found) found = pos.products.find((p: any) => p.code === query);
                        if (!found) found = pos.products.find((p: any) => p.name.toLowerCase() === ql);
                        if (!found) found = pos.products.find((p: any) =>
                          p.code.toLowerCase().startsWith(ql)
                        );
                        if (!found) found = pos.products.find((p: any) =>
                          p.name.toLowerCase().includes(ql)
                        );
                        if (found) {
                          billing.handleAddProductToCart(found);
                          pos.setQuickFireInput('');
                          pos.setQuickFireFlash('success');
                          pos.setQuickFireSessionCount(p => p + 1);
                          showToast(`Quick added: ${found.name}`, 'success');
                        } else {
                          pos.setQuickFireFlash('error');
                          pos.setQuickFireInput('');
                          showToast('Item not found', 'warning');
                        }
                        setTimeout(() => pos.setQuickFireFlash(null), 400);
                      }
                    }}
                    isQuickFireActive={pos.isQuickFireActive}
                    onToggleQuickFire={() => {
                      pos.setIsQuickFireActive(!pos.isQuickFireActive);
                      pos.setQuickFireInput('');
                      pos.setQuickFireSessionCount(0);
                    }}
                    isMoreBillingOpen={pos.isMoreBillingOpen}
                    onToggleMoreBilling={() => pos.setIsMoreBillingOpen(!pos.isMoreBillingOpen)}
                    searchedCustomer={pos.searchedCustomer}
                    customerPhone={pos.customerPhone}
                    onCustomerPhoneChange={loyalty.handleCustomerPhoneChange as any}
                    onOpenOffers={() => pos.setIsOffersPopupOpen(true)}
                    loyaltyPhoneRef={pos.loyaltyPhoneRef}
                    quickFireRef={pos.quickFireRef}
                    appliedReward={pos.appliedReward}
                    splitDetails={pos.splitDetails}
                    onOpenSplitPopup={() => pos.setIsSplitPopupOpen(true)}
                    onOpenCustomerSearch={() => setIsCustomerSearchOpen(true)}
                    onUpdateItemNotes={handleUpdateItemNotes}
                    moduleSettings={pos.moduleSettings}
                    currencySymbol={pos.settings.currencySymbol}
                    onOpenAddOnModal={handleOpenAddOnModal}
                    showToast={showToast}
                    manualDiscount={billing.manualDiscount}
                    onManualDiscountChange={billing.setManualDiscount}
                    canApplyDiscount={canApplyDiscount}
                  />
                </div>
              )}
              {pos.activeWorkspace === 'Products' && (
                 <div className="flex flex-col flex-1 min-h-0">
                   <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                     <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                     <span className="text-sm font-bold text-[#191b23]">Products</span>
                     <span className="text-[10px] text-gray-400 ml-auto">Catalog Management</span>
                   </div>
                   <div className="flex-1 min-h-0 overflow-hidden">
                    <ProductManager products={pos.products} onUpdateProducts={pos.setProducts} currencySymbol={pos.settings.currencySymbol} categories={pos.categories} onUpdateCategories={pos.setCategories} categoryColors={pos.categoryColors} onUpdateCategoryColors={pos.setCategoryColors} branches={pos.branches} branchProductPrices={pos.branchProductPrices} onSetBranchProductPrices={pos.setBranchProductPrices} branchVariantPrices={pos.branchVariantPrices} onSetBranchVariantPrices={pos.setBranchVariantPrices} />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Customers' && (
                 <div className="flex flex-col flex-1 min-h-0">
                   <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                     <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
                     <span className="text-sm font-bold text-[#191b23]">Customers</span>
                     <span className="text-[10px] text-gray-400 ml-auto">Loyalty Management</span>
                   </div>
                   <div className="flex-1 min-h-0 overflow-hidden"><CustomerManager customers={pos.customers} onUpdateCustomers={pos.setCustomers} currencySymbol={pos.settings.currencySymbol} showToast={showToast} /></div>
                 </div>
               )}
               {pos.activeWorkspace === 'Offers' && (
                 <div className="flex flex-col flex-1 min-h-0">
                   <OffersManager onBack={() => pos.setActiveWorkspace('More')} rewards={pos.rewards} onUpdateRewards={pos.setRewards} currencySymbol={pos.settings.currencySymbol} settings={pos.settings} onUpdateSettings={pos.setSettings} products={pos.products} />
                 </div>
              )}
              {pos.activeWorkspace === 'Reports' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('Dashboard')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to Dashboard"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Reports & Analytics</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Sales analytics & intelligence</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ReportsManager bills={pos.bills} customers={pos.customers} products={pos.products} currencySymbol={pos.settings.currencySymbol} moduleSettings={pos.moduleSettings} onViewBill={(bill) => pos.setActiveReceipt(bill)} onRefresh={() => { 
                      // BACKEND: Refresh from API: fetch('/api/bills').then(r => r.json()).then(setBills)
                      setDBData('pos_bills', pos.bills); showToast('Data refreshed', 'info'); 
                    }} />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Staff' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Staff</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Employee Management</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden"><StaffManager employees={pos.employees} onUpdateEmployees={pos.setEmployees} currentEmployee={pos.currentEmployee!} branches={pos.branches} /></div>
                </div>
              )}
              {pos.activeWorkspace === 'Branches' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Branch Management</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Multi-location management</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <BranchManager
                      branches={pos.branches}
                      employees={pos.allEmployees}
                      currentBranchId={pos.currentBranchId}
                      branchSettings={pos.branchSettings}
                      onSetBranches={pos.setBranches}
                      onSetCurrentBranch={pos.setCurrentBranchId}
                      onSetBranchSettings={pos.setBranchSettings}
                      branchTables={pos.branchTables}
                      onSetBranchTables={pos.setBranchTables}
                      currencySymbol={pos.settings.currencySymbol}
                      allBills={pos.allBills}
                      allOrders={pos.allOrders}
                      allExpenses={pos.allExpenses}
                    />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Settings' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <SettingsManager settings={pos.settings} onUpdateSettings={pos.setSettings} currentBranchId={pos.currentBranchId} subscriptionFeatures={pos.subscriptionFeatures} />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'ReceiptHistory' && (
                <ReceiptHistory
                  bills={pos.bills}
                  currencySymbol={pos.settings.currencySymbol}
                  onReprint={(bill) => pos.setActiveReceipt(bill)}
                  onBack={() => pos.setActiveWorkspace('More')}
                  canManageBills={pos.currentEmployee?.role === 'Owner' || pos.currentEmployee?.role === 'Manager'}
                  onRefund={(bill) => setBillAction({ mode: 'refund', bill })}
                  onVoid={(bill) => setBillAction({ mode: 'void', bill })}
                />
              )}
              {pos.activeWorkspace === 'Expenses' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Expenses</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Expense tracking & management</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ExpenseManager
                      expenses={pos.expenses}
                      onUpdateExpenses={pos.setExpenses}
                      currencySymbol={pos.settings.currencySymbol}
                      currentEmployeeName={pos.currentEmployee?.name}
                    />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Reservations' && pos.moduleSettings.enableReservations !== false && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Reservations</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Table booking & guest queue</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ReservationWorkspace
                      reservations={pos.reservations}
                      onUpdateReservations={pos.setReservations}
                      waitingList={pos.waitingList}
                      onUpdateWaitingList={pos.setWaitingList}
                      tables={pos.tables}
                      onCreateOrder={(type: any, tableId) => {
                        orderMgmt.handleCreateOrder(type as Order['type'], tableId);
                        showToast?.(`Reservation seated — order created`, 'success');
                      }}
                      showToast={showToast}
                    />
                  </div>
                </div>
              )}

              {pos.activeWorkspace === 'Analytics' && pos.hasAnalytics && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Analytics</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Business intelligence & trends</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <AnalyticsWorkspace
                      bills={pos.bills}
                      expenses={pos.expenses}
                      currencySymbol={pos.settings.currencySymbol}
                    />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Finance' && pos.hasAnalytics && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Finance</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Profit & Loss statement</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <FinanceWorkspace
                      bills={pos.bills}
                      expenses={pos.expenses}
                      currencySymbol={pos.settings.currencySymbol}
                    />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Inventory' && pos.hasInventory && (
                <div className="flex flex-col flex-1 min-h-0"><InventoryManager onBack={() => pos.setActiveWorkspace('More')} moduleSettings={pos.moduleSettings} /></div>
              )}
              {pos.activeWorkspace === 'Kitchen' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-[#e1e2ed] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('Dashboard')} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to Dashboard"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[#191b23]">Kitchen Display</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Live order status</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <KitchenDisplay
                      orders={pos.orders}
                      onUpdateKOTStatus={orderMgmt.handleUpdateKOTStatus}
                      onCancelOrderItem={handleCancelOrderItem}
                      showToast={showToast}
                      settings={pos.settings}
                    />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'More' && (
                <MoreWorkspace
                  onNavigate={(ws) => pos.setActiveWorkspace(ws as any)}
                  onOpenDailySales={() => pos.setIsDailySalesOpen(true)}
                  onOpenActivityFeed={() => pos.setIsHistoryFeedOpen(true)}
                  onOpenZReport={() => pos.setIsZReportOpen(true)}
                  onOpenSyncPanel={() => pos.setIsSyncPanelOpen(true)}
                  moduleSettings={pos.moduleSettings}
                  subscriptionFeatures={pos.subscriptionFeatures}
                  role={pos.currentEmployee?.role}
                  rolePermissions={pos.rolePermissions}
                />
              )}
              </ErrorBoundary>
              </React.Suspense>
            </main>
          </div>
        </>
      )}

      {/* ========== MODALS ========== */}
      {isPinSwitchOpen && (
        <PinLoginScreen
          employees={pos.allEmployees}
          currentEmployee={pos.currentEmployee}
          onLoginSuccess={handlePinSwitchSuccess}
          onCancel={() => setIsPinSwitchOpen(false)}
        />
      )}
      {pos.previewReceipt && (
        <ReceiptModal bill={pos.previewReceipt} settings={pos.settings} autoPrint={receiptAutoPrint} isPreview={pos.isLiveReceiptPreview} onOpenBilling={() => { const previewId = pos.previewReceipt?.id; const orderId = typeof previewId === 'string' ? previewId.replace('preview_', '') : undefined; const existing = orderId ? pos.orders.find((o: any) => o.id === orderId) : undefined; setReceiptAutoPrint(false); pos.setIsLiveReceiptPreview(false); pos.setPreviewReceipt(null); pos.setActiveReceipt(null); if (existing) orderMgmt.handleOpenOrder(existing); else pos.setActiveWorkspace('Orders'); }} onClose={() => { setReceiptAutoPrint(false); pos.setIsLiveReceiptPreview(false); pos.setPreviewReceipt(null); pos.setActiveReceipt(null); pos.setActiveWorkspace('Orders'); }} onNewOrder={() => { setReceiptAutoPrint(false); pos.setIsLiveReceiptPreview(false); pos.setPreviewReceipt(null); pos.setActiveReceipt(null); pos.setActiveWorkspace('Orders'); }} />
      )}
      {pos.activeReceipt && pos.activeReceipt !== pos.previewReceipt && (
        <ReceiptModal bill={pos.activeReceipt} settings={pos.settings} onClose={() => { pos.setActiveReceipt(null); pos.setActiveWorkspace('Orders'); }} onNewOrder={() => { pos.setActiveReceipt(null); pos.setActiveWorkspace('Orders'); }} />
      )}

      {isCustomerSearchOpen && (
        <CustomerSearchPopup
          customers={pos.customers}
          currencySymbol={pos.settings.currencySymbol}
          onSelect={(cust) => {
            if (cust.isBlocked) {
              showToast(`⚠ ${cust.name} is BLOCKED. Cannot apply loyalty or rewards.`, 'warning');
              return;
            }
            pos.setSearchedCustomer(cust);
            pos.setCustomerPhone(cust.phone);
            showToast(`Selected: ${cust.name}`, 'success');
          }}
          onClose={() => setIsCustomerSearchOpen(false)}
        />
      )}

      <ConfirmationDialog confirmState={pos.confirmState} onClose={() => pos.setConfirmState(prev => ({ ...prev, isOpen: false }))} />

      <HeldOrdersDrawer isOpen={pos.isHeldDrawerOpen} heldOrders={pos.heldOrders} onClose={() => pos.setIsHeldDrawerOpen(false)} onRecall={handleRecallHeldOrder} />

      <OTPVerificationModal
        state={pos.otpVerificationState}
        onTypedCodeChange={(c) => pos.setOtpVerificationState(prev => ({ ...prev, typedCode: c }))}
        onVerify={async (e) => {
          e.preventDefault();
          const s = pos.otpVerificationState;
          const closeOtp = () => pos.setOtpVerificationState({ isOpen: false, code: '', typedCode: '', reward: null, phone: undefined, isServerOtp: undefined });
          if (!s.typedCode) {
            showToast('Please enter the OTP code.', 'warning');
            return;
          }
          let verified = false;
          // Phase 1.6 — server-issued OTPs verify against /api/otp/verify
          // (single-use, hashed, expiring, attempt-bounded). Local fallback only
          // when the OTP was generated locally (offline mode).
          if (s.isServerOtp && s.phone) {
            try {
              const res = await api.verifyOtp(s.phone, s.typedCode, 'reward_redemption');
              const valid = res?.valid ?? res?.data?.valid;
              if (valid === true) {
                verified = true;
              } else {
                showToast('Invalid OTP entered. Try again or request a new code.', 'warning');
              }
            } catch (err) {
              debugWarn('App', 'verifyOtp failed:', err);
              showToast('Could not verify OTP — check connection and try again.', 'warning');
            }
          } else {
            verified = s.typedCode === s.code; // local offline fallback — no backdoor codes
            if (!verified) showToast('Invalid OTP entered. Try again.', 'warning');
          }
          if (verified) {
            if (s.reward) loyalty.applyRewardStateAndCheckCart(s.reward, true);
            closeOtp();
          }
        }}
        onClose={() => pos.setOtpVerificationState({ isOpen: false, code: '', typedCode: '', reward: null, phone: undefined, isServerOtp: undefined })}
      />

      <DailySalesModal isOpen={pos.isDailySalesOpen} dailySales={pos.dailySales} settings={pos.settings} onClose={() => pos.setIsDailySalesOpen(false)} />
      <ActivityFeedModal isOpen={pos.isHistoryFeedOpen} activityFeed={pos.activityFeed} onClose={() => pos.setIsHistoryFeedOpen(false)} />

<PaymentConfirmModal
        isOpen={pos.isPaymentConfirmOpen}
        cartItems={pos.cartItems}
        activeOrder={pos.activeOrder}
        currentEmployee={pos.currentEmployee}
        settings={pos.settings}
        orderType={pos.orderType}
        paymentMethod={pos.paymentMethod}
        searchedCustomer={pos.searchedCustomer}
        appliedReward={pos.appliedReward}
        splitDetails={pos.splitDetails}
        totals={{
          subtotal: billing.calculateCartSubtotal(),
          discount: billing.calculateCartDiscount(),
          gst: billing.calculateCartTaxes(),
          grandTotal: billing.calculateCartGrandTotal(),
        }}
        isProcessing={billing.getIsProcessingPayment()}
        onClose={() => {
          if (!billing.getIsProcessingPayment()) {
            pos.setIsPaymentConfirmOpen(false);
          }
        }}
        onConfirmPayment={async () => {
          const bill = await billing.handleCheckoutPayment();
          if (bill) {
            setReceiptAutoPrint(pos.settings.autoPrintReceipt === true);
            pos.setIsLiveReceiptPreview(false);
            pos.setPreviewReceipt(bill);
            pos.setIsPaymentConfirmOpen(false);
          }
          // If bill is undefined (guard blocked by another in-flight payment),
          // modal stays open — user can try again or cancel.
        }}
        onBackToOrders={() => { pos.setIsPaymentConfirmOpen(false); pos.setActiveWorkspace('Orders'); }}
      />

      <KOTPreviewModal
        isOpen={pos.isKOTPreviewOpen}
        data={pos.kotPreviewData}
        onClose={() => { pos.setIsKOTPreviewOpen(false); pos.setKotPreviewData(null); }}
      />

      <OffersPopup
        isOpen={pos.isOffersPopupOpen}
        searchedCustomer={pos.searchedCustomer}
        rewards={pos.rewards}
        settings={pos.settings}
        appliedReward={pos.appliedReward}
        onClose={() => pos.setIsOffersPopupOpen(false)}
        onApplyReward={loyalty.handleRedeemRewardTier}
      />

      <SplitPaymentModal
        isOpen={pos.isSplitPopupOpen}
        splitDetails={pos.splitDetails}
        grandTotal={billing.calculateCartGrandTotal()}
        currencySymbol={pos.settings.currencySymbol}
        onSplitChange={pos.setSplitDetails}
        onClose={() => pos.setIsSplitPopupOpen(false)}
        onProceed={() => {
          pos.setIsSplitPopupOpen(false);
          pos.setPaymentMethod('Split');
          showToast('Split payment details set. Complete with Pay (F9)', 'info');
        }}
      />

      <SyncPanelModal isOpen={pos.isSyncPanelOpen} syncState={pos.syncState} onClose={() => pos.setIsSyncPanelOpen(false)} onSync={() => {
        pos.runPullSync().then((ok: boolean) => {
          syncEngine.sync();
          showToast(ok ? 'Data synced successfully' : 'Sync failed — check connection and try again', ok ? 'success' : 'warning');
        });
      }} />

      <ZReportModal isOpen={pos.isZReportOpen} zReportData={pos.zReportData} settings={pos.settings} moduleSettings={pos.moduleSettings} onClose={() => pos.setIsZReportOpen(false)} />

      <VoidReasonModal isOpen={pos.isVoidReasonOpen} voidReasons={pos.voidReasons} onSelect={(id) => {
        const reasonLabel = pos.voidReasons.find(r => r.id === id)?.label || 'Unknown';
        // Actually void the current bill: clear cart, reset state, record activity
        if (pos.cartItems.length > 0) {
          const voidedItems = [...pos.cartItems];
          pos.setCartItems([]);
          pos.setCustomerPhone('');
          pos.setSearchedCustomer(null);
          pos.setAppliedReward(null);
          pos.setActiveOrder(null);
          // Record void in activity feed
          const activityFeed = getDBData<any[]>('pos_activity_feed', []);
          activityFeed.unshift({
            id: `act_void_${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: 'void',
            title: `Bill voided (${reasonLabel})`,
            description: `${voidedItems.length} items voided by ${pos.currentEmployee?.name || 'System'}`,
          });
          setDBData('pos_activity_feed', activityFeed.slice(0, 100));
          showToast(`Bill voided: ${reasonLabel}`, 'warning');
        } else {
          showToast('No bill to void. Add items first.', 'info');
        }
      }} onClose={() => pos.setIsVoidReasonOpen(false)} />

      <BillActionModal
        isOpen={!!billAction}
        mode={billAction?.mode || 'refund'}
        bill={billAction?.bill || null}
        currencySymbol={pos.settings.currencySymbol}
        onClose={() => setBillAction(null)}
        onSubmit={handleBillActionSubmit}
        isProcessing={isBillActionProcessing}
      />

      {pos.isShortcutOpen && <ShortcutsGuide onClose={() => pos.setIsShortcutOpen(false)} />}

      {pos.currentEmployee && pos.kotOrder && (
        <KOTModal
          isOpen={pos.isKOTOpen}
          onClose={() => pos.setIsKOTOpen(false)}
          order={pos.kotOrder}
          kotRecords={pos.kotOrder.kotRecords}
          cartItems={pos.cartItems}
          onPrintKOT={(type) => orderMgmt.handlePrintKOT(type)}
          onReprintKOT={() => orderMgmt.handlePrintKOT('Reprint')}
          onPrintPaperKOT={(kotId) => orderMgmt.handlePrintPaperKOT(kotId)}
          settings={pos.settings}
          currentEmployee={pos.currentEmployee!}
        />
      )}

      {pos.isAddOnModalOpen && pos.addOnModalProduct && (
        <AddOnModal
          product={pos.addOnModalProduct}
          selectedVariant={pos.addOnModalVariant}
          currencySymbol={pos.settings.currencySymbol}
          onConfirm={handleAddOnModalConfirm}
          onCancel={() => { pos.setIsAddOnModalOpen(false); pos.setAddOnModalProduct(null); pos.setAddOnModalVariant(undefined); }}
        />
      )}

      {pos.isTimelineOpen && pos.currentEmployee && (
        <OrderTimeline events={pos.timelineEvents} isOpen={pos.isTimelineOpen} onClose={() => pos.setIsTimelineOpen(false)} />
      )}

      <GuidedTour isOpen={pos.isOnboardingOpen} onClose={() => { pos.setIsOnboardingOpen(false); localStorage.setItem('pos_onboarding_done', 'true'); }} tourActions={tourActions} />

      {/* Toasts */}
      <div className="fixed top-14 right-4 z-[200] space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`px-4 py-2 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 animate-[popIn_0.3s_ease-out] ${
            t.type === 'success' ? 'bg-green-600 text-white' :
            t.type === 'warning' ? 'bg-amber-500 text-white' :
            'bg-[#191b23] text-white'
          }`}>
            {t.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {t.type === 'warning' && <AlertCircle className="w-4 h-4" />}
            {t.message}
          </div>
        ))}
      </div>

      {/* Layout diagnostic overlay — Ctrl+Shift+D */}
      <LayoutDiagnostic />
    </div>
  );
}
