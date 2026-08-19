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
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { normalizeRole, type Order, type Bill, type LoyaltyReward } from './types';
import { setDBData, getDBData, localDateKey, clearAllCache } from './data';
import { decideFirstRun } from './firstRun';
import { syncEngine } from './lib/syncEngine';
import { workspaceToPath, pathToWorkspace, DEFAULT_WORKSPACE, type WorkspaceName } from './routes';
import * as api from './api/client';
import { setOnApiError, setAuthToken, getAuthToken } from './api/client';
import { getOrCreateDeviceId } from './api/axios';
import { setAiAuth, setAiToken } from './ai/aiClient';
import { debugWarn } from './utils/debugLog';
import { computeKOTDelta } from './utils/kotDelta';
import { mergeOrdersWithServer } from './utils/orderMerge';
import { computeRunningBillTotals } from './utils/runningBill';
import { printKOT } from './utils/printKOT';
import { isKotAlertEnabled, playKotAlertSound } from './lib/alertSound';

import { useAuth } from './hooks/useAuth';
// Eagerly loaded workspace components (core POS flow — needed offline)
import FirstTimeSetup from '../components/FirstTimeSetup';
import LoginScreen from '../components/LoginScreen';
import PinLoginScreen from '../components/PinLoginScreen';
import { useAutoLock } from './hooks/useAutoLock';
import ReceiptModal from '../components/ReceiptModal';
import ShortcutsGuide from '../components/ShortcutsGuide';
import KOTModal from '../components/KOTModal';
import OrderTimeline from '../components/OrderTimeline';
import AddOnModal, { hasCustomizationOptions, getAddOnsForCategory } from '../components/AddOnModal';
import ConfiguredItemModal from '../components/ConfiguredItemModal';
import { hasConfigSelection } from './lib/configSelection';
import { useConfigCatalog } from './hooks/useConfigCatalog';
import type { ResolvedProductConfig } from './types';
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
import ReceiptLoader from '../components/ReceiptLoader';
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
const MenuAvailabilityPage = safeLazy(() => import('../components/MenuAvailabilityPage'));
const QrStudioPage = safeLazy(() => import('../components/QrStudioPage'));
const CustomerCallsPanel = safeLazy(() => import('../components/CustomerCallsPanel'));
const LegalAcceptanceGate = safeLazy(() => import('../components/LegalAcceptanceGate'));
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
const FeedbackPanel = safeLazy(() => import('../components/marketing/FeedbackPanel'));
const GuidedTour = safeLazy(() => import('../components/GuidedTour'));

// Hooks
import { useNotifications } from './hooks/useNotifications';
import { usePOSState } from './hooks/usePOSState';
import { useBilling } from './hooks/useBilling';
import { useOrders } from './hooks/useOrders';
import { useLoyalty } from './hooks/useLoyalty';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePOSLiveEvents } from './hooks/usePOSLiveEvents';
import { useKotAlertSound } from './hooks/useKotAlertSound';
import { isOrderResolvedStatus, type PendingCall } from '../components/CustomerCallsPanel';
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

export default function App() {
  // Toast/notifications
  const { toasts, showToast } = useNotifications();

  // Core POS state — everything comes from here
  const pos = usePOSState();
  // Phase 3 — offline-capable menu catalog (config resolutions for the POS).
  const configCatalog = useConfigCatalog();
  // Quick Sound Alerts: beep on new KOTs from ANY workspace (not just KDS).
  useKotAlertSound(pos.orders, pos.settings);
  // Live socket: refetch orders after an adjustment so this terminal's KDS
  // shows cancelled KOT lines immediately (not on the next 30s poll).
  const handleOrderAdjusted = useCallback(() => {
    if (!navigator.onLine) return;
    api.fetchOrders()
      .then((list: any) => {
        if (!Array.isArray(list) || list.length === 0) return;
        // Monotonic merge: a snapshot fetched before an in-flight KOT status
        // PUT commits must never regress a locally Served KOT back to
        // Accepted (the KDS would re-show the order under New Orders).
        pos.setOrders((prev: any[]) => mergeOrdersWithServer(prev, list));
      })
      .catch(() => undefined);
  }, [pos.setOrders]);
  // A brand-new online/QR order: refetch orders AND tables so the floor plan
  // turns Occupied (server-side reconcileTable) and the KDS shows the
  // auto-KOT immediately — no 30s wait, on every terminal.
  // Orders already auto-printed this session (per terminal) — the customer's
  // KOT is created server-side, so the cashier never taps Send-KOT and the
  // paper ticket must fire from here when Auto Print KOT is enabled.
  const autoPrintedOnlineOrdersRef = React.useRef<Set<string>>(new Set());
  const refreshOrdersAndTables = useCallback(() => {
    if (!navigator.onLine) return;
    api.fetchOrders()
      .then((list: any) => {
        if (!Array.isArray(list) || list.length === 0) return;
        // Auto-print the paper KOT for NEW customer-placed (Website) orders —
        // same gate as the cashier flow: Auto Print KOT on + output mode
        // includes a printer (not KDS-only). One ticket per order per terminal.
        const shouldAutoPrint =
          (pos.moduleSettings?.enableAutoPrintKOT ?? false) &&
          (pos.settings?.kotOutputMode ?? 'both') !== 'kds';
        if (shouldAutoPrint) {
          for (const fresh of list) {
            const id = fresh._id || fresh.id;
            if (!id || autoPrintedOnlineOrdersRef.current.has(id)) continue;
            if (String(fresh.type || '').toLowerCase() !== 'website') continue;
            const kots = Array.isArray(fresh.kotRecords) ? fresh.kotRecords : [];
            if (kots.length === 0) continue;
            autoPrintedOnlineOrdersRef.current.add(id);
            printKOT({ ...fresh, id } as any, kots[0] as any, pos.settings);
          }
        }
        // Monotonic merge — never regress a locally Served KOT (see above).
        pos.setOrders((prev: any[]) => mergeOrdersWithServer(prev, list));
      })
      .catch(() => undefined);
    pos.refreshTables().catch(() => undefined);
  }, [pos.setOrders, pos.refreshTables, pos.moduleSettings?.enableAutoPrintKOT, pos.settings?.kotOutputMode, pos.settings]);

  // ─── Customer service calls (bell) — live badge + Calls page ───
  // The transient toast can be missed; the sidebar 'Calls' badge and the Calls
  // page show every pending call (table / car / pickup) LIVE until each is
  // acknowledged — socket push updates the list without any refresh.
  const normalizeCall = useCallback((r: any): PendingCall => ({
    id: String(r._id || r.id || ''),
    type: r.type || 'CALL_WAITER',
    orderType: r.orderType || 'TABLE',
    tableId: r.tableId ? String(r.tableId) : undefined,
    carId: r.carId || r.parkingSlot || r.carPlate || undefined,
    message: r.message || undefined,
    branchId: r.branchId ? String(r.branchId) : null,
    createdAt: r.createdAt,
    // Lifecycle — kept on acknowledged calls so the panel can show timestamps.
    status: r.status || undefined,
    seenAt: r.seenAt || undefined,
    seenBy: r.seenBy || undefined,
    completedAt: r.completedAt || undefined,
    completedBy: r.completedBy || undefined,
    // ONLINE_ORDER rows carry the order so staff can open it straight away.
    orderId: r.orderId ? String(r.orderId) : undefined,
    orderNumber: r.orderNumber ?? undefined,
    tableNumber: r.tableNumber ?? undefined,
    grandTotal: typeof r.grandTotal === 'number' ? r.grandTotal : undefined,
    itemsCount: typeof r.itemsCount === 'number' ? r.itemsCount : undefined,
  }), []);
  const [pendingCalls, setPendingCalls] = React.useState<PendingCall[]>([]);
  const [acknowledgedCalls, setAcknowledgedCalls] = React.useState<PendingCall[]>([]);
  const refreshPendingCalls = useCallback(() => {
    if (!pos.currentEmployee || !navigator.onLine) return Promise.resolve();
    // Branch isolation — pass the active branchId to the server (defense in
    // depth) AND re-filter locally; branchless calls are kept, other branches'
    // calls are hidden in multi-branch mode.
    const scoped = (list: any[]) =>
      (list.map(normalizeCall) as PendingCall[]).filter(
        (c) => !pos.shouldFilterByBranch || !pos.currentBranchId || !c.branchId || c.branchId === pos.currentBranchId,
      );
    const params: { status: string; branchId?: string } = { status: 'PENDING' };
    if (pos.shouldFilterByBranch && pos.currentBranchId) params.branchId = pos.currentBranchId;
    // Silenced online-order notifications are SEEN but still live — the card
    // stays visible (no sound) until the order's bill closes, when
    // orderService auto-completes them. Only ONLINE_ORDER SEEN rows are
    // merged back into the pending list (assigned SEEN bell rows stay hidden).
    const seenParams: { status: string; branchId?: string } = { status: 'SEEN' };
    if (pos.shouldFilterByBranch && pos.currentBranchId) seenParams.branchId = pos.currentBranchId;
    // Acknowledged calls stay on screen as a record (last 50, newest first).
    const doneParams: { status: string; branchId?: string; limit: number } = { status: 'COMPLETED', limit: 50 };
    if (pos.shouldFilterByBranch && pos.currentBranchId) doneParams.branchId = pos.currentBranchId;
    return Promise.all([
      Promise.all([api.fetchWaiterRequests(params), api.fetchWaiterRequests(seenParams)])
        .then(([ringing, silenced]) => {
          // Pending list = PENDING calls + SEEN online-order cards (silenced
          // reminders that stay live until their bill closes). Merge once to
          // avoid the two fetches racing each other and dropping a card.
          const merged = [
            ...(Array.isArray(ringing) ? scoped(ringing) : []),
            ...(Array.isArray(silenced) ? scoped(silenced).filter((c) => c.type === 'ONLINE_ORDER') : []),
          ];
          const byId = new Map<string, PendingCall>();
          for (const c of merged) if (c.id) byId.set(c.id, c);
          setPendingCalls([...byId.values()].sort((a, b) =>
            String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
          ));
        })
        .catch(() => undefined),
      api.fetchWaiterRequests(doneParams as any)
        .then((list: any) => { if (Array.isArray(list)) setAcknowledgedCalls(scoped(list)); })
        .catch(() => undefined),
    ]).then(() => undefined);
  }, [pos.currentEmployee, pos.shouldFilterByBranch, pos.currentBranchId, normalizeCall]);
  React.useEffect(() => {
    refreshPendingCalls();
    const t = setInterval(refreshPendingCalls, 15000);
    return () => clearInterval(t);
  }, [refreshPendingCalls]);
  // Socket push: a new bell lands in the list instantly (no refresh needed).
  // Branch isolation mirrors refreshPendingCalls: the socket room is
  // restaurant-wide, so a branch-scoped terminal filters out other branches'
  // calls here too (otherwise they'd flash in the badge until the next poll).
  const handleWaiterCall = useCallback((payload: any) => {
    const call = normalizeCall(payload);
    if (!call.id) return;
    if (pos.shouldFilterByBranch && pos.currentBranchId && call.branchId && call.branchId !== pos.currentBranchId) return;
    setPendingCalls((prev) => (prev.some((c) => c.id === call.id) ? prev : [call, ...prev]));
  }, [normalizeCall, pos.shouldFilterByBranch, pos.currentBranchId]);
  // Acknowledged calls are NOT removed from the panel — they move to the
  // "Acknowledged" section (with completedAt + who did it) so the cashier
  // still has the record. Only PENDING calls ring reminders / bump the badge.
  /** Order status map (orderId → status) — used to decide whether an online
   *  order's notification should be silenced (bill open) or completed (bill
   *  closed). Live via the polled/socket-pushed order list. */
  const orderStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of pos.orders) {
      const id = String(o.id || '');
      if (id) m.set(id, o.status || '');
    }
    return m;
  }, [pos.orders]);

  const handleAcknowledgeCall = useCallback((id: string) => {
    const who = pos.currentEmployee?.name || '';
    const call = pendingCalls.find((c) => c.id === id);
    // Online order with an open bill: Acknowledge silences the repeating
    // sound reminder but the notification card STAYS live (SEEN) until the
    // order's bill closes — then orderService auto-completes it.
    if (call?.type === 'ONLINE_ORDER' && call.orderId && !isOrderResolvedStatus(orderStatusById.get(call.orderId))) {
      setPendingCalls((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'SEEN', seenAt: new Date().toISOString(), seenBy: who } : c)),
      );
      api.markWaiterRequestSeen(id, who).catch(() => {
        showToast('Could not silence — re-syncing', 'warning');
        refreshPendingCalls();
      });
      return;
    }
    // Everything else (or online order whose bill already closed): complete.
    if (call) {
      setAcknowledgedCalls((prev) => [
        { ...call, status: 'COMPLETED', completedAt: new Date().toISOString(), completedBy: who },
        ...prev.filter((c) => c.id !== id),
      ]);
    }
    setPendingCalls((prev) => prev.filter((c) => c.id !== id));
    api.completeWaiterRequest(id, who).catch(() => {
      showToast('Could not acknowledge — re-syncing', 'warning');
      if (call) setAcknowledgedCalls((prev) => prev.filter((c) => c.id !== id));
      refreshPendingCalls();
    });
  }, [pendingCalls, refreshPendingCalls, showToast, pos.currentEmployee?.name, orderStatusById]);

  const handleAcknowledgeAll = useCallback(() => {
    // Bulk action: online orders with an open bill get their reminder silenced
    // (SEEN — the card stays live until the bill closes); everything else is
    // completed immediately.
    const who = pos.currentEmployee?.name || '';
    const now = new Date().toISOString();
    const toSilence: PendingCall[] = [];
    const toComplete: PendingCall[] = [];
    for (const c of pendingCalls) {
      if (c.type === 'ONLINE_ORDER' && c.orderId && !isOrderResolvedStatus(orderStatusById.get(c.orderId))) {
        toSilence.push(c);
      } else {
        toComplete.push(c);
      }
    }
    if (toSilence.length > 0) {
      setPendingCalls((prev) => {
        const silencedIds = new Set(toSilence.map((c) => c.id));
        return prev.map((c) => (silencedIds.has(c.id) ? { ...c, status: 'SEEN', seenAt: now, seenBy: who } : c));
      });
      Promise.all(toSilence.map((c) => api.markWaiterRequestSeen(c.id, who).catch(() => null)));
    }
    if (toComplete.length > 0) {
      setAcknowledgedCalls((prev) => [
        ...toComplete.map((c) => ({ ...c, status: 'COMPLETED', completedAt: now, completedBy: who })),
        ...prev,
      ]);
      setPendingCalls((prev) => prev.filter((c) => !toComplete.some((t) => t.id === c.id)));
      Promise.all(toComplete.map((c) => api.completeWaiterRequest(c.id, who).catch(() => null)));
    }
    if (toSilence.length > 0 || toComplete.length > 0) refreshPendingCalls();
  }, [pendingCalls, refreshPendingCalls, pos.currentEmployee?.name, orderStatusById]);

  // Socket push: ANOTHER terminal silenced (SEEN) a call — mirror it here so
  // this terminal's repeating reminder stops at the same instant. The card
  // stays live (SEEN) until the bill closes, exactly like a local click.
  const handleRemoteCallSeen = useCallback((payload: any) => {
    const id = String(payload?.id || '');
    if (!id) return;
    if (pos.shouldFilterByBranch && pos.currentBranchId && payload?.branchId && String(payload.branchId) !== pos.currentBranchId) return;
    const seenAt = payload?.seenAt || new Date().toISOString();
    const seenBy = payload?.seenBy || '';
    setPendingCalls((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'SEEN', seenAt, seenBy } : c)),
    );
  }, [pos.shouldFilterByBranch, pos.currentBranchId]);

  // Socket push: ANOTHER terminal completed a call — remove it from this
  // terminal's pending list and show it in Acknowledged (with the actor +
  // timestamp from the remote terminal) without waiting for the 15s poll.
  const handleRemoteCallCompleted = useCallback((payload: any) => {
    const id = String(payload?.id || '');
    if (!id) return;
    if (pos.shouldFilterByBranch && pos.currentBranchId && payload?.branchId && String(payload.branchId) !== pos.currentBranchId) return;
    const completedAt = payload?.completedAt || new Date().toISOString();
    const completedBy = payload?.completedBy || '';
    setPendingCalls((prev) => {
      const call = prev.find((c) => c.id === id);
      if (!call) return prev;
      setAcknowledgedCalls((ackPrev) => [
        { ...call, status: 'COMPLETED', completedAt, completedBy },
        ...ackPrev.filter((c) => c.id !== id),
      ]);
      return prev.filter((c) => c.id !== id);
    });
  }, [pos.shouldFilterByBranch, pos.currentBranchId]);

  // Socket push: a COMPLETED online-order call was re-activated because its
  // order was reopened (the bill is open again). Move the card from this
  // terminal's Acknowledged section back to Pending — the reminder re-rings
  // and acknowledgment is re-gated (silence keeps it live until the bill
  // closes again), mirroring the terminal that reopened the order.
  const handleRemoteCallReactivated = useCallback((payload: any) => {
    const id = String(payload?.id || '');
    if (!id) return;
    if (pos.shouldFilterByBranch && pos.currentBranchId && payload?.branchId && String(payload.branchId) !== pos.currentBranchId) return;
    const call = normalizeCall(payload);
    setAcknowledgedCalls((prev) => prev.filter((c) => c.id !== id));
    setPendingCalls((prev) => {
      const existing = prev.find((c) => c.id === id);
      // Already live on this terminal — nothing to do (a local reopen or an
      // earlier poll already restored it).
      if (existing) {
        return prev.map((c) => (c.id === id ? { ...c, status: 'PENDING' } : c));
      }
      // Card is in Acknowledged (or missing entirely) — restore it to Pending.
      return [call, ...prev];
    });
  }, [pos.shouldFilterByBranch, pos.currentBranchId, normalizeCall]);

  // Live resolution: the moment an online order's bill closes (Paid/Closed/
  // Cancelled/Refunded), its silenced notification card clears immediately —
  // move it to the Acknowledged section and complete it server-side (which
  // orderService.update also does; this just makes the flip instant here).
  React.useEffect(() => {
    if (pendingCalls.length === 0) return;
    const resolved = pendingCalls.filter(
      (c) => c.type === 'ONLINE_ORDER' && c.orderId && isOrderResolvedStatus(orderStatusById.get(c.orderId)),
    );
    if (resolved.length === 0) return;
    const who = pos.currentEmployee?.name || 'System';
    const now = new Date().toISOString();
    const ids = resolved.map((c) => c.id).filter(Boolean);
    setAcknowledgedCalls((prev) => [
      ...resolved.map((c) => ({ ...c, status: 'COMPLETED', completedAt: now, completedBy: who })),
      ...prev,
    ]);
    setPendingCalls((prev) => prev.filter((c) => !ids.includes(c.id)));
    ids.forEach((id) => api.completeWaiterRequest(id, who).catch(() => null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCalls, orderStatusById]);

  // ─── Call reminder: re-notify unacknowledged calls ─────────────
  // A pending call (waiter bell / online order) that isn't acknowledged
  // within the configured interval rings again — toast + alert sound — so a
  // missed bell is never silently forgotten. Interval comes from Settings →
  // Modules → "Customer Call Reminders" (0 disables). Respects the Quick
  // Sound Alerts toggle and the kitchen mute button like the KOT beep.
  // (Read from the raw settings record — it is typed ModuleSettings; the
  // merged pos.moduleSettings record is boolean-only by design.)
  const callReminderIntervalSec = Number(pos.settings?.moduleSettings?.callReminderIntervalSec ?? 15);
  const lastCallRemindRef = React.useRef<Record<string, number>>({});
  // Restaurant id of the last successful login — used to detect a restaurant
  // SWITCH on this device so every cached collection can be dropped before the
  // new tenant's data hydrates. Same-restaurant logins (incl. the offline PIN
  // fallback, which keeps the previous token) must NOT wipe: offline login
  // authenticates against the cached employee list.
  const lastLoginRestaurantRef = React.useRef<string | null>(api.getCurrentRestaurantId());
  React.useEffect(() => {
    if (!(callReminderIntervalSec > 0) || pendingCalls.length === 0) return;
    const intervalMs = callReminderIntervalSec * 1000;
    const tick = () => {
      const now = Date.now();
      for (const c of pendingCalls) {
        if (!c.id) continue;
        // Silenced (SEEN) online orders never ring again — the card stays
        // live but the sound/toast reminder is muted until the bill closes.
        if (c.status === 'SEEN') continue;
        const created = c.createdAt ? new Date(c.createdAt).getTime() : now;
        const last = lastCallRemindRef.current[c.id] || 0;
        // First reminder once the call is older than the interval; later
        // reminders repeat every interval until it is acknowledged.
        if (now - created >= intervalMs && now - last >= intervalMs) {
          lastCallRemindRef.current[c.id] = now;
          if (pos.moduleSettings?.enableQuickSoundAlerts !== false && isKotAlertEnabled()) {
            playKotAlertSound();
          }
          const where =
            c.type === 'ONLINE_ORDER'
              ? `Order #${c.orderNumber ?? ''}`.trim()
              : c.orderType === 'TABLE'
                ? `Table ${c.tableNumber ?? ''}`.trim()
                : c.orderType === 'CAR'
                  ? `Car ${c.carId ?? ''}`.trim()
                  : 'Pickup';
          showToast(`⏰ Still pending — ${where}${c.message ? ` (${c.message})` : ''}`, 'warning');
        }
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [callReminderIntervalSec, pendingCalls, showToast, pos.moduleSettings?.enableQuickSoundAlerts]);

  // Live QR-ordering events (new online orders, ready alerts, waiter calls).
  // Best-effort socket — falls back to existing polling when unavailable.
  usePOSLiveEvents(
    showToast,
    handleOrderAdjusted,
    pos.currentBranchId,
    pos.shouldFilterByBranch,
    refreshOrdersAndTables,
    handleWaiterCall,
    handleRemoteCallSeen,
    handleRemoteCallCompleted,
    handleRemoteCallReactivated,
    // Live product/table/settings/bill updates from other terminals
    pos.refreshProducts,
    pos.refreshTables,
    undefined, // settings refresh handled by useServerSettings
    pos.refreshAllFromApi,
  );
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = React.useState(false);
  // Position + PIN switch-user screen (opened from the Exit button)
  const [isPinSwitchOpen, setIsPinSwitchOpen] = React.useState(false);

  // Auto-lock: after the configured idle timeout, require the sign-in method to
  // resume. Reads autoLockMinutes from the store's security settings.
  useAutoLock(
    Number(pos.settings?.security?.autoLockMinutes) || 0,
    () => {
      if (pos.currentEmployee) setIsPinSwitchOpen(true);
    },
  );

  // ─── Auth integration ───────────────────────────────────────
  const auth = useAuth();

  // ─── First-time setup check ──────────────────────────────────
  // On mount, check if an Owner exists. If not, show FirstTimeSetup.
  // Uses a 'loading' tri-state to avoid flashing the wrong screen.
  const [setupState, setSetupState] = React.useState<'loading' | 'setup' | 'ready'>('loading');
  // First-run sign-in gate: 'login' = "I already have admin credentials",
  // 'register' = "I don't — register this restaurant as Owner".
  const [firstRunChoice, setFirstRunChoice] = React.useState<'login' | 'register'>('login');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // The server is the source of truth for whether an Owner exists. A
      // locally cached owner session is ONLY a fallback when we're offline —
      // otherwise a device that previously logged in would skip the wizard
      // forever after the DB is reset (stale cache).
      const storedEmployee = localStorage.getItem('pos_current_employee');
      let exists: boolean | null = null;
      try {
        exists = await api.checkOwnerExists();
      } catch { /* offline — fall back to the cached session below */ }

      if (cancelled) return;

      const decision = decideFirstRun({
        storedEmployee,
        ownerExists: exists,
        isAuthenticated: auth.isAuthenticated,
      });

      if (decision.clearCache) {
        // No owner on the server — the DB is empty (fresh install or reset).
        // Clear any stale cached session/auth so the terminal reliably lands on
        // first-time registration instead of a phantom login screen.
        clearAllCache();
        const staleKeys = ['pos_current_employee', 'pos_access_token', 'pos_auth_token', 'pos_refresh_token', 'pos_session_mode'];
        for (const k of staleKeys) {
          try { localStorage.removeItem(k); } catch { /* ignore */ }
        }
      }
      setSetupState(decision.setupState);
      if (decision.firstRunChoice) setFirstRunChoice(decision.firstRunChoice);
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
          // Backend schema caps osVersion at 80 chars — a full userAgent string
          // (100-200+ chars) makes /api/devices/register 400 and the device
          // never registers, so the subscription device count stays at 0.
          osVersion: (navigator.userAgent || '').slice(0, 80),
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
  const [graceInfo, setGraceInfo] = React.useState<{ graceEnd: string; daysRemaining: number } | null>(null);
  const [isFreePlan, setIsFreePlan] = React.useState(false);

  // Apply a subscription-status payload to the banner + plan-selection state.
  // Shared by the mount effect and the plan-selection completion handler so a
  // plan change is reflected immediately — no page reload needed.
  const applySubscriptionStatus = useCallback((sub: any) => {
    if (sub && sub.status === 'suspended') {
      setNeedsPlanSelection('yes');
      setTrialInfo(null);
      setGraceInfo(null);
      setIsFreePlan(false);
      return;
    }
    setNeedsPlanSelection('no');
    const now = new Date();
    // Free trial countdown
    if (sub && sub.status === 'trial' && sub.trialEnd) {
      const trialEnd = new Date(sub.trialEnd);
      const daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      setTrialInfo({ trialEnd: sub.trialEnd, daysRemaining });
      setGraceInfo(null);
      setIsFreePlan(false);
    } else if (sub && sub.status === 'grace' && sub.graceEnd) {
      // Subscription expired — 2-day warning before auto-downgrade to Free.
      const graceEnd = new Date(sub.graceEnd);
      const daysRemaining = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      setTrialInfo(null);
      setGraceInfo({ graceEnd: sub.graceEnd, daysRemaining });
      setIsFreePlan(false);
    } else {
      setTrialInfo(null);
      setGraceInfo(null);
      // Free tier fallback — core POS only.
      setIsFreePlan(sub && sub.status === 'active' && sub.plan === 'free');
    }
  }, []);

  // Re-fetch subscription status and refresh the banners / plan-selection gate.
  // Used after plan selection so the UI reflects the new plan immediately.
  const refreshSubscriptionStatus = useCallback(async () => {
    try {
      const sub = await api.fetchSubscriptionStatus();
      applySubscriptionStatus(sub);
    } catch {
      setNeedsPlanSelection('no');
    }
  }, [applySubscriptionStatus]);

  // After login, check if subscription is active
  React.useEffect(() => {
    if (!pos.currentEmployee) {
      setNeedsPlanSelection('loading');
      setTrialInfo(null);
      setGraceInfo(null);
      setIsFreePlan(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const sub = await api.fetchSubscriptionStatus();
      if (!cancelled) applySubscriptionStatus(sub);
    })().catch(() => { if (!cancelled) setNeedsPlanSelection('no'); });
    return () => { cancelled = true; };
  }, [pos.currentEmployee, applySubscriptionStatus]);

  // ─── Online/Offline transition toasts ────────────────────────
  // Fires a toast when the POS loses or regains connectivity so the cashier
  // knows immediately — not just from the title-bar pill change.
  const wasOnlineRef = React.useRef(pos.isOnline);
  React.useEffect(() => {
    const prev = wasOnlineRef.current;
    const next = pos.isOnline;
    if (prev !== next) {
      wasOnlineRef.current = next;
      if (!next) {
        showToast('⚠️ You are offline — changes will sync when connection is restored', 'warning');
      } else if (prev === false) {
        showToast('✅ Back online — syncing pending changes', 'success');
      }
    }
  }, [pos.isOnline, showToast]);

  const [receiptAutoPrint, setReceiptAutoPrint] = React.useState(false);

  // ─── Phase 3 — configured-item modal state ────────────────────
  // Opens for products with reusable configuration (variants/modifiers/add-ons).
  // `existing` is the cart row being edited (reopens with its selections).
  const [configModal, setConfigModal] = React.useState<{
    product: any;
    resolved: ResolvedProductConfig;
    existing?: any | null;
  } | null>(null);
  /** Cart row id being edited through the config modal (null = new item). */
  const [configModalEditingId, setConfigModalEditingId] = React.useState<string | null>(null);

  // ─── Bill action (void) modal state ──────────────────────────
  // Void requires an Owner/Manager PIN — verified server-side.
  const [billAction, setBillAction] = React.useState<{ bill: Bill } | null>(null);
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

  // ============ GLOBAL THEME APPLICATION ============
  // Applies the saved Settings → Theme to <html> on every load and whenever it
  // changes (brand/accent tokens tint the UI via --brand-color / --accent-color).
  // This runs app-wide regardless of which workspace is open, so the theme
  // persists across navigation and reloads (not just while Settings is open).
  useEffect(() => {
    const root = document.documentElement;
    const saved = pos.settings?.theme;
    root.style.setProperty('--brand-color', saved?.brandColor || '#004ac6');
    root.style.setProperty('--accent-color', saved?.accentColor || '#10b981');
    // 'system' mode follows the OS color-scheme preference (and live changes).
    const applyMode = () => {
      const dark = saved?.mode === 'dark'
        || (saved?.mode === 'system' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('pos-dark', dark);
    };
    applyMode();
    if (saved?.mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', applyMode);
      return () => mq.removeEventListener?.('change', applyMode);
    }
  }, [pos.settings?.theme]);

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
    Calls: {},
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
  const BASE_WORKSPACES = ['Dashboard', 'Orders', 'Billing', 'Kitchen', 'Calls', 'More', 'ReceiptHistory'];

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
    appliedOffer: pos.appliedOffer,
    setAppliedOffer: pos.setAppliedOffer,
    paymentMethod: pos.paymentMethod,
    setPaymentMethod: pos.setPaymentMethod,
    orderType: pos.orderType,
    setOrderType: pos.setOrderType,
    splitDetails: pos.splitDetails,
    setSplitDetails: pos.setSplitDetails,
    settings: pos.settings,
    currentBranchId: pos.currentBranchId,
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
    pendingTableId: pos.pendingTableId,
    setPendingTableId: pos.setPendingTableId,
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

  // ─── Calls → table deep-link ───────────────────────────────────
  // 'View' on a table call behaves exactly like tapping the table card in
  // Orders: opens the running bill when the table already has an order,
  // otherwise creates a fresh Dine-In order on that table (cart + products
  // ready). Kept after orderMgmt so it can reuse the open/create handlers.
  const handleViewCallTable = useCallback((tableId: string) => {
    if (!tableId) return;
    pos.setActiveWorkspace('Orders');
    // Terminal order statuses mirror usePOSState's TERMINAL_ORDER_STATUSES
    // (Paid/Closed/Cancelled/Refunded/Held) — a table whose order is finished
    // gets a fresh Dine-In order instead of reopening a dead bill.
    const terminal = ['Paid', 'Completed', 'Cancelled', 'Voided', 'Closed', 'Refunded', 'Held'];
    const tableOrder = pos.orders.find(
      (o: any) =>
        String(o.tableId || '') === String(tableId) &&
        !terminal.includes(o.status),
    );
    if (tableOrder) {
      orderMgmt.handleOpenOrder(tableOrder);
    } else {
      // No order yet — open the table's billing workspace WITHOUT creating an
      // order or occupying the table. The order is born on the first KOT.
      pos.setPendingTableId(tableId);
      pos.setCartItems([]);
      pos.setActiveOrder(null);
      pos.setActiveWorkspace('Billing');
    }
  }, [pos.setActiveWorkspace, pos.orders, orderMgmt.handleOpenOrder, pos.setPendingTableId, pos.setCartItems, pos.setActiveOrder]);

  // ─── Table card click (Orders floor plan / grid) ─────────────────────
  // Tapping an AVAILABLE table opens its billing workspace with an empty cart
  // but does NOT create an order — accidental taps must never occupy a table.
  // The order (and the table's Occupied state) is created lazily when the
  // first KOT with items is sent.
  const handleOpenTableBilling = useCallback((tableId: string) => {
    if (!tableId) return;
    pos.setPendingTableId(tableId);
    pos.setCartItems([]);
    pos.setActiveOrder(null);
    pos.setActiveWorkspace('Billing');
  }, [pos.setPendingTableId, pos.setCartItems, pos.setActiveOrder, pos.setActiveWorkspace]);
  // ─── End a customer's QR seat-session (table occupied by a scan) ────
  // The guest scanned the table QR but hasn't ordered yet. The restaurant
  // can end the SESSION (the QR code stays valid — the guest may re-scan).
  // With a live order the table stays occupied regardless.
  const handleExpireTableSession = useCallback((tableId: string) => {
    if (!tableId) return;
    const table = pos.tables.find((t) => t.id === tableId);
    const label = table ? `#${table.number} ` : '';
    // Check if there's an active order for this table (in KDS / kitchen)
    const liveOrder = pos.orders.find(
      (o: any) => String(o.tableId || '') === String(tableId) &&
        !['Paid', 'Cancelled', 'Returned'].includes(o.status)
    );
    if (liveOrder) {
      // Live order exists — show a stronger warning and ask for a reason
      pos.setConfirmState({
        isOpen: true,
        title: `⚠️ Table ${label}has a live order!`,
        message: `This table has an active order (#${liveOrder.orderNumber || liveOrder.id || '—'}) that is ${liveOrder.status || 'in progress'}. Ending the QR session will NOT cancel the order — it stays in the kitchen. Only the seat-session is released. Are you sure you want to proceed?`,
        confirmLabel: 'End session anyway',
        onConfirm: async () => {
          // Close the dialog immediately so the user sees feedback
          pos.setConfirmState(prev => ({ ...prev, isOpen: false }));
          try {
            await api.expireTableSession(tableId);
            await pos.refreshTables();
            showToast(`Table ${label}QR session ended — order #${liveOrder.orderNumber || liveOrder.id || '—'} is still active in kitchen`, 'warning');
          } catch (err: any) {
            showToast(err?.message || 'Could not end the session — try again.', 'warning');
          }
        },
      });
    } else {
      // No live order — normal confirmation
      pos.setConfirmState({
        isOpen: true,
        title: 'End this QR session?',
        message: `Table ${label}is held by a customer who scanned its QR code but hasn't ordered yet. Ending the session frees the table for reuse. The QR code itself stays valid — the customer can re-scan it.`,
        onConfirm: async () => {
          // Close the dialog immediately so the user sees feedback
          pos.setConfirmState(prev => ({ ...prev, isOpen: false }));
          try {
            await api.expireTableSession(tableId);
            await pos.refreshTables();
            showToast(`Table ${label}QR session ended — table is free`, 'success');
          } catch (err: any) {
            showToast(err?.message || 'Could not end the session — try again.', 'warning');
          }
        },
      });
    }
  }, [pos.tables, pos.orders, pos.refreshTables, pos.setConfirmState, showToast]);

  // ─── Calls → online order deep-link ─────────────────────────────
  // 'View' on an ONLINE_ORDER call opens that customer order in Billing so
  // staff can see the bill, KOT status and take payment — nothing missed.
  const handleViewOnlineOrder = useCallback((orderId: string) => {
    if (!orderId) return;
    const order = pos.orders.find((o: any) => String(o._id || o.id || '') === String(orderId));
    if (order) {
      pos.setActiveWorkspace('Orders');
      orderMgmt.handleOpenOrder(order);
    } else {
      showToast('Order not loaded on this terminal yet — pull up Orders and search for it.', 'warning');
    }
  }, [pos.orders, pos.setActiveWorkspace, orderMgmt.handleOpenOrder, showToast]);

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

  // ============ ORDER ADJUSTMENT → KDS SYNC ============
  // The adjustment modal returns the server-refreshed order (new totals +
  // KOT lines marked cancelled). Swap it into pos.orders immediately so the
  // Kitchen Display shows the cancelled item without waiting for the poll.
  const handleOrderUpdated = useCallback((order: any) => {
    if (!order) return;
    const serverId = order._id || order.id;
    if (!serverId) return;
    const normalized = {
      ...order,
      id: serverId,
      items: Array.isArray(order.items) ? order.items : [],
      kotRecords: Array.isArray(order.kotRecords) ? order.kotRecords : [],
      timeline: Array.isArray(order.timeline) ? order.timeline : [],
    };
    pos.setOrders((prev: any[]) => {
      const idx = prev.findIndex((o: any) => (o.id === serverId || o._id === serverId));
      if (idx === -1) return prev;
      const next = [...prev];
      const prevOrder = next[idx];
      // The adjustment response assembles kotRecords but order items/timeline
      // live in separate collections — preserve the local copies when absent.
      next[idx] = {
        ...normalized,
        ...(prevOrder.id && !normalized.items?.length ? { items: prevOrder.items } : {}),
        ...(prevOrder.id && !normalized.timeline?.length ? { timeline: prevOrder.timeline } : {}),
      };
      return next;
    });
    // If the adjusted order is the one on screen (active), refresh it too.
    pos.setActiveOrder((prev: any) =>
      prev && (prev.id === serverId || prev._id === serverId) ? { ...prev, ...normalized } : prev
    );
  }, [pos.setOrders, pos.setActiveOrder]);

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
  // local bills ledger so the UI reflects the voided state.
  // ─── Void submission handler ─────────────────────────────────
  const handleBillActionSubmit = useCallback(async (payload: { reason: string; managerPin: string }) => {
    if (!billAction) return;
    const { bill } = billAction;
    setIsBillActionProcessing(true);
    try {
      const res = await api.deleteBill(bill.id, {
        reason: payload.reason,
        voidedBy: pos.currentEmployee?.name || 'System',
        managerPin: payload.managerPin,
      });
      if (res) {
        // Update the local ledger to reflect the correction.
        pos.setBills((prev: Bill[]) => prev.map((b: Bill) =>
          b.id === bill.id ? { ...b, isVoided: true, voidReason: payload.reason, voidedBy: pos.currentEmployee?.name } : b
        ));
        setBillAction(null);
        showToast('Bill voided successfully.', 'success');
      } else {
        showToast('Void failed — check PIN and try again.', 'warning');
      }
    } catch (err: any) {
      debugWarn('App', 'bill action failed:', err);
      showToast(err?.message || 'Action failed. Please try again.', 'warning');
    } finally {
      setIsBillActionProcessing(false);
    }
  }, [billAction, pos.currentEmployee, pos.setBills, showToast]);

  // ============ ADD-ON / CONFIGURED-ITEM MODAL HANDLERS ============
  // Phase 3: products with REUSABLE configuration (menuConfig refs) open the
  // dynamic ConfiguredItemModal (variants/customizations/add-ons from the
  // resolved configuration). Legacy products keep the old fast path: instant
  // add (simple) or the hardcoded AddOnModal (category add-ons).
  const handleOpenAddOnModal = useCallback((product: any, variant?: any) => {
    // Meal combos add their components directly — no modal, since the combo
    // product itself never becomes a cart row.
    if (product.isCombo || (!product.variants && !hasCustomizationOptions(product))) {
      billing.handleAddProductToCart(product, variant);
      return;
    }
    // Reusable configuration wins over the legacy category add-on modal.
    if (hasConfigSelection(product)) {
      const productId = product.id;
      const fromCatalog = configCatalog.resolveFromCatalog(productId);
      if (fromCatalog) {
        setConfigModal({ product, resolved: fromCatalog });
        return;
      }
      // Not in the local catalog (e.g. configured after last snapshot) — fetch
      // the per-product resolution; fall back to the legacy modal on failure.
      api.resolveProductConfig(productId)
        .then((resolved: any) => {
          if (resolved) setConfigModal({ product, resolved });
          else {
            pos.setAddOnModalProduct(product);
            pos.setAddOnModalVariant(variant);
            pos.setIsAddOnModalOpen(true);
          }
        })
        .catch(() => {
          pos.setAddOnModalProduct(product);
          pos.setAddOnModalVariant(variant);
          pos.setIsAddOnModalOpen(true);
        });
      return;
    }
    pos.setAddOnModalProduct(product);
    pos.setAddOnModalVariant(variant);
    pos.setIsAddOnModalOpen(true);
  }, [billing.handleAddProductToCart, pos.setAddOnModalProduct, pos.setAddOnModalVariant, pos.setIsAddOnModalOpen, configCatalog]);

  // Reopen the configuration modal for an existing cart row (edit mode).
  const handleEditCartItem = useCallback((item: any) => {
    if (!item?.configuration?.selections?.length) return;
    const product = item.product;
    const resolved = configCatalog.resolveFromCatalog(product.id)
      || (item as any).resolvedSnapshot; // kept on the row for offline editing
    if (resolved) {
      setConfigModalEditingId(item.id);
      setConfigModal({
        product,
        resolved,
        existing: {
          quantity: item.quantity,
          notes: item.notes,
          configuration: item.configuration,
        },
      });
    }
  }, [configCatalog]);

  // Add a configured item to the cart (or replace the edited row).
  const handleConfiguredItemConfirm = useCallback((item: any) => {
    setConfigModal(null);
    setConfigModalEditingId(null);
    const editingId = configModalEditingId;
    if (editingId) {
      // Editing: the configuration may have changed (e.g. Large → Small), so
      // the item's deterministic fingerprint id may differ from the edited
      // row's. Drop the old row, then merge-or-insert under the new id so
      // identical configured items never split into duplicate rows.
      const rest = pos.cartItems.filter((i: any) => i.id !== editingId);
      const idx = rest.findIndex((i: any) => i.id === item.id);
      if (idx > -1) {
        const updated = [...rest];
        updated[idx] = {
          ...updated[idx],
          quantity: updated[idx].quantity + item.quantity,
          notes: item.notes || updated[idx].notes,
        };
        pos.setCartItems(updated);
      } else {
        pos.setCartItems([...rest, item]);
      }
      showToast(`${item.product?.name || 'Item'} updated.`, 'success');
      return;
    }
    const rowId = item.id;
    const existingIdx = pos.cartItems.findIndex((i: any) => i.id === rowId);
    if (existingIdx > -1) {
      const updated = [...pos.cartItems];
      updated[existingIdx].quantity += item.quantity;
      if (item.notes) updated[existingIdx].notes = item.notes;
      pos.setCartItems(updated);
    } else {
      pos.setCartItems([...pos.cartItems, item]);
    }
    showToast(`${item.product?.name || 'Item'} added to current bill.`, 'success');
  }, [pos.cartItems, pos.setCartItems, showToast, configModalEditingId]);

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
    const activeOrder = pos.activeOrder;
    // No active order is allowed here — tapping an available table opens an
    // empty billing workspace without creating an order, so the FIRST KOT is
    // what births the order. handleConfirmKOT creates it at confirm time.
    if (!activeOrder && pos.cartItems.length === 0) {
      showToast('No items in this order to send to kitchen', 'warning');
      return;
    }
    const hasPrev = (activeOrder?.kotRecords || []).length > 0;
    const delta = computeKOTDelta(pos.cartItems, activeOrder?.lastKotSnapshot);
    if (delta.toPrint.length === 0) {
      if (hasPrev) {
        showToast('All items already sent to kitchen. Use Reprint to print again.', 'info');
        pos.setKotOrder(activeOrder);
        pos.setIsKOTOpen(true);
      } else {
        showToast('No items in this order to send to kitchen', 'warning');
      }
      return;
    }
    // Keep the configured selections so the FIRST KOT shows the full line
    // ("Large • Cheese Burst") — previously only the additional-KOT path
    // preserved configuration/configSummary.
    const pendingItems: any[] = delta.toPrint.map(d => ({
      id: d.id, product: d.product, selectedVariant: d.selectedVariant,
      quantity: d.printQty, notes: d.notes, price: d.price,
      configuration: d.configuration, configSummary: d.configSummary,
    }));
    pos.setKotPreviewData({
      items: pendingItems,
      allItems: hasPrev ? (activeOrder?.kotRecords || []).flatMap((kot: any) => kot.items) : undefined,
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

  const handleRecallHeldOrder = useCallback(async (holdId: string) => {
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
            id: found.orderId, orderNumber: await orderMgmt.getNextOrderNumber(),
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
      pos.currentEmployee, showToast, orderMgmt.getNextOrderNumber]);

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
        const newOrder = await orderMgmt.handleCreateOrder('Dine In', firstAvailable.id);
        if (newOrder) pos.tourArtifactRef.current.tourOrderIds = [...(pos.tourArtifactRef.current.tourOrderIds || []), newOrder.id];
        pos.tourArtifactRef.current.tableId = firstAvailable.id;
      } else if (pos.tables.length > 0) {
        const newOrder = await orderMgmt.handleCreateOrder('Dine In', pos.tables[0].id);
        if (newOrder) pos.tourArtifactRef.current.tourOrderIds = [...(pos.tourArtifactRef.current.tourOrderIds || []), newOrder.id];
        pos.tourArtifactRef.current.tableId = pos.tables[0].id;
      } else {
        const newOrder = await orderMgmt.handleCreateOrder('Takeaway');
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
        // No catalog yet — the tour never injects hardcoded products into the
        // product catalog (pos.products and its localStorage cache must stay
        // DB-backed only, or Menu Availability would show fake items). Demo
        // items are cart-only and transient: nothing is persisted to the
        // catalog or any DB-backed collection. The "Add Items" tour step is
        // skipped automatically because there is no product-card target.
        const demoItems = [
          { id: 'demo_cart_1', product: { id: 'demo_cart_1', name: 'Cart Demo Item', price: 12.99, category: '', image: '', gstPercent: 5, availability: true, code: '' }, quantity: 2, price: 12.99 },
          { id: 'demo_cart_2', product: { id: 'demo_cart_2', name: 'Cart Practice Item', price: 14.99, category: '', image: '', gstPercent: 5, availability: true, code: '' }, quantity: 1, price: 14.99 },
        ];
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
    openOffersPopup: async () => pos.moduleSettings.enableOffersPopup !== false && pos.setIsOffersPopupOpen(true),
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

  // Drop EVERY cached collection when a DIFFERENT restaurant logs in on this
  // device: localStorage rows + TTL stamps (clearAllCache), the offline sync
  // queue (a previous tenant's pending writes must never replay into a new
  // tenant), in-memory POS state (persist effects would otherwise re-write the
  // old tenant's data right back), and the config catalog. The employee-change
  // effect then fires hydrateFromApi(true) to re-pull the new tenant's data.
  const wipeForRestaurantSwitch = useCallback(() => {
    const rid = api.getCurrentRestaurantId();
    if (!rid) return; // offline login (no token) — keep employee cache for auth
    const prev = lastLoginRestaurantRef.current;
    if (rid === prev) return; // same restaurant — keep offline employee cache
    lastLoginRestaurantRef.current = rid;
    clearAllCache();
    syncEngine.clearQueue();
    pos.resetSessionData();
    configCatalog.clear();
    // Fetch the NEW restaurant's catalog immediately (the mount/reconnect
    // subscription may not fire on a same-session login).
    void configCatalog.refresh();
  }, [pos, configCatalog]);

  // First-time / main login (User ID + Password). The entered credential is
  // cached as the employee's local PIN so Position + PIN switching verifies
  // offline from the saved list; new employees added in Staff sync in too.
  const handleFirstLogin = useCallback((employee: any, pin?: string) => {
    if (!employee) return;
    // Restaurant switch on this device → wipe all cached collections BEFORE
    // upsertLocalEmployee reads pos_employees (it must start from an empty
    // list, not the previous tenant's staff).
    wipeForRestaurantSwitch();
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
  }, [upsertLocalEmployee, pos, wipeForRestaurantSwitch]);

  // Handle first-time setup owner creation — persist the owner record locally.
  // Note: the setup password (>=6 chars) is NOT cached as a 4-digit PIN, so the
  // Owner must set a 4-digit PIN in Staff before Position + PIN switching works.
  const handleSetupComplete = useCallback((employee: any, pin?: string) => {
    // A newly registered restaurant is a different tenant than whatever may be
    // cached on this device — drop stale caches before persisting the owner.
    wipeForRestaurantSwitch();
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
  }, [upsertLocalEmployee, pos.setCurrentEmployee, pos.setActiveWorkspace, wipeForRestaurantSwitch]);

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
    // Drop every cached collection — a logout must never leak the previous
    // restaurant's bills/orders/menu from localStorage into the next login.
    clearAllCache();
    showToast('Logged out successfully.', 'info');
  }, [auth, pos, showToast]);

  // Show loading screen while checking auth
  const isFirstRun = setupState === 'setup';
  if (auth.isLoading || setupState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--color-bg-page)]">
        <ReceiptLoader label="Initializing POS Terminal…" />
      </div>
    );
  }

  // Show LoginScreen if not authenticated
  if (!auth.isAuthenticated) {
    if (firstRunChoice === 'register') {
      return (
        <FirstTimeSetup
          onSetupComplete={(emp, pin) => {
            setFirstRunChoice('login');
            handleSetupComplete(emp, pin);
          }}
          onAlreadyHaveAccount={() => setFirstRunChoice('login')}
        />
      );
    }
    return (
      <LoginScreen
        onLoginSuccess={handleFirstLogin}
        settings={pos.settings}
        employees={pos.employees}
        isFirstRun={isFirstRun}
        onRegister={() => setFirstRunChoice('register')}
      />
    );
  }

  // Show first-time setup if no Owner exists
  if (setupState === 'setup') {
    return (
      <FirstTimeSetup
        onSetupComplete={handleSetupComplete}
        onAlreadyHaveAccount={() => { setFirstRunChoice('login'); setSetupState('ready'); }}
      />
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
      <div className="h-full flex items-center justify-center bg-[var(--color-bg-page)]">
        <ReceiptLoader label="Checking plan status…" />
      </div>
    );
  }

  if (needsPlanSelection === 'yes') {
    return <PlanSelectionPage onPlanSelected={() => { refreshSubscriptionStatus(); }} />;
  }

  return (
    <div className="h-full overflow-hidden bg-[var(--color-bg-page)] text-[var(--color-text-primary)] flex flex-col font-sans">
      {!pos.currentEmployee ? (
        <LoginScreen onLoginSuccess={handleFirstLogin} settings={pos.settings} employees={pos.employees} isFirstRun={isFirstRun} onRegister={() => setFirstRunChoice('register')} />
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
                      trialInfo.daysRemaining <= 3 ? 'bg-[var(--color-red-500-solid)]' : trialInfo.daysRemaining <= 7 ? 'bg-[var(--color-amber-500-solid)]' : 'bg-[var(--color-blue-500-solid)]'
                    }`}
                    style={{ width: `${Math.max(5, Math.min(100, (trialInfo.daysRemaining / 7) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] opacity-75">Expires {new Date(trialInfo.trialEnd).toLocaleDateString()}</span>
              </div>
            </div>
          )}
          {/* Subscription expired — 2-day warning before auto-downgrade to Free */}
          {graceInfo && (
            <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-3 text-xs font-medium bg-red-50 text-red-700 border-b border-red-200">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base shrink-0">⚠️</span>
                <span className="truncate">
                  <strong>Subscription expired:</strong> moving to the <strong>Free plan</strong> (core POS only) in {graceInfo.daysRemaining} day{graceInfo.daysRemaining !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setNeedsPlanSelection('yes')}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white font-semibold transition-colors cursor-pointer"
              >
                Choose a Plan
              </button>
            </div>
          )}
          {/* Free tier notice — core POS only, upgrade to unlock more */}
          {isFreePlan && (
            <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-3 text-xs font-medium bg-blue-50 text-blue-700 border-b border-blue-200">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base shrink-0">🎯</span>
                <span className="truncate">
                  You're on the <strong>Free plan</strong> — core POS only. Upgrade to unlock AI, inventory, reports &amp; more.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setNeedsPlanSelection('yes')}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white font-semibold transition-colors cursor-pointer"
              >
                Upgrade
              </button>
            </div>
          )}
          <AppTitleBar restaurantName={pos.settings.restaurantName} isOnline={pos.isOnline} pendingSyncCount={pos.syncState?.pendingChanges ?? 0} branches={pos.branches} currentBranchId={pos.currentBranchId} onSetCurrentBranch={pos.setCurrentBranchId} showBranchSelector={pos.isMultiBranchEnabled && (pos.currentEmployee?.role === 'Owner' || pos.currentEmployee?.role === 'Manager')} />
          <div className="flex flex-1 min-h-0 overflow-hidden w-full" style={{ direction: 'ltr' }}>
            {pos.activeWorkspace !== 'Billing' && (
              <AppSidebar
                activeWorkspace={pos.activeWorkspace as string}
                onNavigate={(ws) => pos.setActiveWorkspace(ws as any)}
                showKitchen={pos.moduleSettings.enableKitchenDisplay !== false && (pos.settings.kotOutputMode ?? 'both') !== 'print'}
                role={pos.currentEmployee?.role}
                rolePermissions={pos.rolePermissions}
                onLogout={handleFullLogout}
                onTour={() => { pos.setIsOnboardingOpen(true); localStorage.removeItem('pos_onboarding_done'); }}
                onKeys={() => pos.setIsShortcutOpen(true)}
                pendingCalls={pendingCalls.length}
                showCalls={pos.moduleSettings.enableQROrdering !== false}
              />
            )}
            <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-bg-page)]">
              <React.Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <ReceiptLoader label="Loading…" />
                </div>
              }>
              <ErrorBoundary key={pos.activeWorkspace}>
              {pos.activeWorkspace === 'Dashboard' && (
                <DashboardWorkspace
                  dailySales={pos.dailySales}
                  bills={pos.bills}
                  orders={pos.orders}
                  tables={pos.tables}
                  employees={pos.employees}
                  reservations={pos.reservations}
                  products={pos.products}
                  currentEmployee={pos.currentEmployee!}
                  settings={pos.settings}
                  currencySymbol={pos.settings.currencySymbol}
                  totalExpensesToday={(() => {
                    const todayStr = localDateKey();
                    return pos.expenses.filter((e: any) => e.date === todayStr).reduce((s: number, e: any) => s + e.amount, 0);
                  })()}
                  totalExpensesThisMonth={(() => {
                    const thisMonth = localDateKey().slice(0, 7);
                    return pos.expenses.filter((e: any) => e.date.startsWith(thisMonth)).reduce((s: number, e: any) => s + e.amount, 0);
                  })()}
                  currentBranchName={pos.currentBranch?.name}
                  showBranchIndicator={pos.isMultiBranchEnabled && !!pos.currentBranch}
                  onNavigate={(ws) => pos.setActiveWorkspace(ws as any)}
                  onOpenDailySales={() => pos.setIsDailySalesOpen(true)}
                  onOpenZReport={() => pos.setIsZReportOpen(true)}
                  moduleSettings={pos.moduleSettings}
                  hasInventory={pos.hasInventory}
                  onRefreshData={pos.refreshAllFromApi}
                />
              )}
              {pos.activeWorkspace === 'Orders' && (
                <OrderManager
                  orders={pos.orders}
                  tables={pos.tables}
                  takeawayOrders={pos.takeawayOrders}
                  onOpenOrder={orderMgmt.handleOpenOrder}
                  onCreateOrder={orderMgmt.handleCreateOrder}
                  onOpenTableBilling={handleOpenTableBilling}
                  onExpireSession={handleExpireTableSession}
                  onCreateTakeawayOrder={orderMgmt.handleCreateTakeawayOrder}
                  onUpdateTakeawayOrder={orderMgmt.handleUpdateTakeawayOrder}
                  onClearCompletedTakeaways={orderMgmt.handleClearCompletedTakeaways}
                  onOpenBilling={orderMgmt.handleOpenOrder}
                  onOpenReceiptPreview={handleOpenReceiptPreview}
                  employees={pos.employees}
                  settings={pos.settings}
                  moduleSettings={pos.moduleSettings}
                  currentEmployee={pos.currentEmployee!}
                  showToast={showToast}
                  onAddTable={orderMgmt.handleAddTable}
                  onUpdateTable={orderMgmt.handleUpdateTable}
                  onDeleteTable={orderMgmt.handleDeleteTable}
                  floors={pos.floors}
                  products={pos.products}
                  role={pos.currentEmployee?.role}
                  activeTab={pos.ordersActiveTab}
                  onActiveTabChange={pos.setOrdersActiveTab}
                  viewMode={pos.ordersViewMode}
                  onViewModeChange={pos.setOrdersViewMode}
                  onOrderUpdated={handleOrderUpdated}
                  onRefresh={() => { refreshOrdersAndTables(); showToast('Orders refreshed', 'info'); }}
                />
              )}
              {pos.activeWorkspace === 'Calls' && pos.moduleSettings.enableQROrdering !== false && (
                <CustomerCallsPanel
                  calls={pendingCalls}
                  acknowledgedCalls={acknowledgedCalls}
                  tables={pos.tables}
                  orders={pos.orders}
                  onBack={() => pos.setActiveWorkspace('Dashboard')}
                  onRefresh={refreshPendingCalls}
                  onAcknowledge={handleAcknowledgeCall}
                  onAcknowledgeAll={handleAcknowledgeAll}
                  onViewTable={handleViewCallTable}
                  onViewOrder={handleViewOnlineOrder}
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
                    appliedOffer={pos.appliedOffer}
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
                    onClearCart={() => { if (billing.handleClearCart()) pos.setPendingTableId(null); }}
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
                    onOpenOffers={() => pos.moduleSettings.enableOffersPopup !== false && pos.setIsOffersPopupOpen(true)}
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
                    onEditConfiguredItem={handleEditCartItem}
                    showToast={showToast}
                    manualDiscount={billing.manualDiscount}
                    onManualDiscountChange={billing.setManualDiscount}
                    canApplyDiscount={canApplyDiscount}
                    unservedKotSummary={billing.getUnservedKotSummary(pos.activeOrder)}
                    onForceCloseBill={() => billing.handleCheckoutPayment(true)}
                  />
                </div>
              )}
              {pos.activeWorkspace === 'Products' && (
                 <div className="flex flex-col flex-1 min-h-0">
                   <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                     <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                     <span className="text-sm font-bold text-[var(--color-text-primary)]">Products</span>
                     <span className="text-[10px] text-gray-400 ml-auto">Catalog Management</span>
                   </div>
                   <div className="flex-1 min-h-0 overflow-hidden">
                    <ProductManager products={pos.products} onUpdateProducts={pos.setProducts} currencySymbol={pos.settings.currencySymbol} categories={pos.categories} onUpdateCategories={pos.setCategories} categoryColors={pos.categoryColors} onUpdateCategoryColors={pos.setCategoryColors} branches={pos.branches} branchProductPrices={pos.branchProductPrices} onSetBranchProductPrices={pos.setBranchProductPrices} branchVariantPrices={pos.branchVariantPrices} onSetBranchVariantPrices={pos.setBranchVariantPrices} defaultTaxRate={pos.settings.defaultTaxRate} taxRules={pos.settings.taxRules} />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'MenuAvailability' && pos.moduleSettings.enableMenuAvailability !== false && (
                <MenuAvailabilityPage
                  products={pos.products}
                  branches={pos.branches}
                  currencySymbol={pos.settings.currencySymbol}
                  onBack={() => pos.setActiveWorkspace('More')}
                />
              )}
              {pos.activeWorkspace === 'QrStudio' && pos.moduleSettings.enableQROrdering !== false && (
                <QrStudioPage
                  currencySymbol={pos.settings.currencySymbol}
                  currentBranchId={pos.currentBranchId}
                  isMultiBranch={pos.isMultiBranchEnabled}
                  branchName={pos.currentBranch?.name}
                  onBack={() => pos.setActiveWorkspace('More')}
                />
              )}
              {pos.activeWorkspace === 'Customers' && (
                 <div className="flex flex-col flex-1 min-h-0">
                   <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                     <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
                     <span className="text-sm font-bold text-[var(--color-text-primary)]">Customers</span>
                     <span className="text-[10px] text-gray-400 ml-auto">Loyalty Management</span>
                     <button onClick={() => { pos.refreshAllFromApi(); showToast('Refreshing customers…'); }} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Refresh customer data">
                       <RefreshCw className="w-4 h-4" />
                     </button>
                   </div>
                   <div className="flex-1 min-h-0 overflow-hidden"><CustomerManager customers={pos.customers} onUpdateCustomers={pos.setCustomers} currencySymbol={pos.settings.currencySymbol} showToast={showToast} /></div>
                 </div>
               )}
               {pos.activeWorkspace === 'Offers' && (
                 <div className="flex flex-col flex-1 min-h-0">                    <OffersManager onBack={() => pos.setActiveWorkspace('More')} rewards={pos.rewards} onUpdateRewards={pos.setRewards} currencySymbol={pos.settings.currencySymbol} settings={pos.settings} onUpdateSettings={pos.setSettings} products={pos.products} branches={pos.branches} />
                 </div>
              )}
              {pos.activeWorkspace === 'Reports' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('Dashboard')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to Dashboard"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Reports & Analytics</span>
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
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Staff</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Employee Management</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden"><StaffManager employees={pos.employees} onUpdateEmployees={pos.setEmployees} currentEmployee={pos.currentEmployee!} branches={pos.branches} /></div>
                </div>
              )}
              {pos.activeWorkspace === 'Branches' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Branch Management</span>
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
                    <SettingsManager settings={pos.settings} onUpdateSettings={pos.setSettings} currentBranchId={pos.currentBranchId} subscriptionFeatures={pos.subscriptionFeatures} isOwner={pos.currentEmployee?.role === 'Owner' || pos.currentEmployee?.role === 'Manager'} />
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
                  onVoid={(bill) => setBillAction({ bill })}
                />
              )}
              {pos.activeWorkspace === 'Expenses' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Expenses</span>
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
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Reservations</span>
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
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Analytics</span>
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
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('More')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to More"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Finance</span>
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
              {pos.activeWorkspace === 'Feedback' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-white)] border-b border-[var(--color-border-default)] shrink-0">
                    <button onClick={() => pos.setActiveWorkspace('Dashboard')} className="p-1.5 text-gray-400 hover:text-[var(--brand-color)] hover:bg-blue-50 rounded-lg transition-all cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">Customer Feedback</span>
                    <span className="text-[10px] text-gray-400 ml-auto">Reviews from receipt QR scans</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
                    <FeedbackPanel />
                  </div>
                </div>
              )}
              {pos.activeWorkspace === 'Kitchen' && pos.moduleSettings.enableKitchenDisplay !== false && (pos.settings.kotOutputMode ?? 'both') !== 'print' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <KitchenDisplay
                      orders={pos.orders}
                      onUpdateKOTStatus={orderMgmt.handleUpdateKOTStatus}
                      onCancelOrderItem={handleCancelOrderItem}
                      showToast={showToast}
                      settings={pos.settings}
                      onRefreshOrders={pos.refreshOrders}
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
      <React.Suspense fallback={null}>
        <LegalAcceptanceGate />
      </React.Suspense>
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
        appliedOffer={pos.appliedOffer}
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
        isOpen={pos.isOffersPopupOpen && pos.moduleSettings.enableOffersPopup !== false}
        searchedCustomer={pos.searchedCustomer}
        rewards={pos.rewards}
        settings={pos.settings}
        appliedReward={pos.appliedReward}
        appliedOffer={pos.appliedOffer}
        cartItems={pos.cartItems}
        subtotal={billing.calculateCartSubtotal()}
        onClose={() => pos.setIsOffersPopupOpen(false)}
        onApplyReward={loyalty.handleRedeemRewardTier}
        onApplyOffer={(applied) => {
          pos.setAppliedOffer(applied);
          showToast(`Offer applied: ${applied.offer?.title || 'Promotion'}`, 'success');
        }}
        onRemoveOffer={() => {
          pos.setAppliedOffer(null);
          showToast('Offer removed from this bill.', 'info');
        }}
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

      <SyncPanelModal isOpen={pos.isSyncPanelOpen} syncState={pos.syncState} operations={pos.syncOperations} onClose={() => pos.setIsSyncPanelOpen(false)} onSync={() => {
        pos.runPullSync().then((ok: boolean) => {
          syncEngine.sync();
          showToast(ok ? 'Data synced successfully' : 'Sync failed — check connection and try again', ok ? 'success' : 'warning');
        });
      }} onRetry={(id) => pos.retrySyncOperation(id)} onClear={(id) => pos.clearSyncOperation(id)} />

      <ZReportModal isOpen={pos.isZReportOpen} zReportData={pos.zReportData} settings={pos.settings} moduleSettings={pos.moduleSettings} products={pos.products} onClose={() => pos.setIsZReportOpen(false)} />

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

      {configModal && (
        <ConfiguredItemModal
          product={configModal.product}
          resolved={configModal.resolved}
          currencySymbol={pos.settings.currencySymbol}
          origin={pos.syncState?.online === false ? 'offline' : 'online'}
          existing={configModal.existing}
          onConfirm={handleConfiguredItemConfirm}
          onCancel={() => { setConfigModal(null); setConfigModalEditingId(null); }}
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
            t.type === 'success' ? 'bg-[var(--color-green-600-solid)] text-white' :
            t.type === 'warning' ? 'bg-[var(--color-amber-500-solid)] text-white' :
            'bg-[var(--color-sidebar-bg)] text-white'
          }`}>
            {t.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {t.type === 'warning' && <AlertCircle className="w-4 h-4" />}
            {t.message}
          </div>
        ))}
      </div>

    </div>
  );
}
