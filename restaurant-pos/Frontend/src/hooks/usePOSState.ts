/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Core POS state — all useState declarations + localStorage persistence + derived state
 *
 * Data sourcing strategy (API-first with localStorage fallback):
 *   1. On mount: read from localStorage instantly for fast initial render.
 *   2. In background: fetch from API → if success, update state + overwrite localStorage cache.
 *   3. If API is offline: keep localStorage data (no visible change).
 *   4. On mutations: write to both localStorage (fast) and API (async).
 *
 * Re-render optimization:
 *   - currentTime is NOT stored here — use the useCurrentTime() hook in individual
 *     components instead. This prevents the entire component tree from re-rendering
 *     every second.
 *   - The return value is wrapped in useMemo so that consumers get a stable object
 *     reference unless one of their dependencies actually changes.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Product, Customer, LoyaltyReward, Employee, SystemSettings, Bill, Order, TableInfo, TakeawayOrder, TimelineEvent, ActivityEntry, ExpenseEntry, Reservation, WaitingEntry, Branch, RolePermissions, Floor } from '../types';
import { DEFAULT_ROLE_PERMISSIONS } from '../types';
import { getDBData, setDBData, setCachedData, isCacheFresh, CACHE_TTL, DEFAULT_SETTINGS, computeDailySales, buildActivityFeed, getActivityFeed, saveActivityFeed } from '../data';
import { syncEngine } from '../lib/syncEngine';
import * as api from '../api/client';
import { WORKSPACE_PATHS } from '../routes';

const voidReasons = [
  { id: 'wrong_item', label: 'Wrong item ordered' },
  { id: 'customer_changed', label: 'Customer changed mind' },
  { id: 'prep_error', label: 'Preparation error' },
  { id: 'duplicate', label: 'Duplicate entry' },
  { id: 'quality_issue', label: 'Quality issue' },
  { id: 'order_cancelled', label: 'Order cancelled' },
  { id: 'other', label: 'Other' },
];

/**
 * All subscription feature keys.
 * The 7-day free trial unlocks ALL of them — feature restrictions apply
 * only after a paid plan is selected.
 */
const ALL_FEATURES = [
  'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty',
  'reservations', 'multi_branch', 'analytics', 'custom_branding',
  'advanced_reports', 'expense_tracking', 'api_access', 'priority_support',
];

/** Fetch data from API and update state + timestamped cache. Returns true if API was reachable. */
async function fetchAndCache<T>(
  fetcher: () => Promise<T | null>,
  setter: (data: T) => void,
  cacheKey: string,
): Promise<boolean> {
  try {
    const data = await fetcher();
    if (data && Array.isArray(data)) {
      setter(data as T);
      setCachedData(cacheKey, data);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Fetch only if cache is stale — otherwise skip the API call entirely */
async function fetchIfStale<T>(
  fetcher: () => Promise<T | null>,
  setter: (data: T) => void,
  cacheKey: string,
  ttl: number,
): Promise<void> {
  if (!isCacheFresh(cacheKey, ttl)) {
    await fetchAndCache(fetcher, setter, cacheKey);
  }
}

/** Cache keys used across the hook */
const CK = {
  PRODUCTS: 'pos_products',
  CUSTOMERS: 'pos_customers',
  EMPLOYEES: 'pos_employees',
  BILLS: 'pos_bills',
  EXPENSES: 'pos_expenses',
  BRANCHES: 'pos_branches',
  SETTINGS: 'pos_settings',
  REWARDS: 'pos_rewards',
  ORDERS: 'pos_orders',
  TABLES: 'pos_tables',
  TAKEAWAY: 'pos_takeaway_orders',
  RESERVATIONS: 'pos_reservations',
  WAITING: 'pos_waiting_list',
  FLOORS: 'pos_floors',
} as const;

/**
 * Merge backend tables into the local floor plan.
 * The backend Table model doesn't store occupancy (orderSince/orderId/waiter/
 * guest), so we never replace wholesale: for rows the server returns, local
 * occupancy/layout fields are preserved. Backend rows drive identity/layout.
 *
 * When the server returns a NON-EMPTY list it is treated as authoritative —
 * local-only rows (deleted tables, duplicates from other restaurants, or
 * orphaned seed rows cached from an unscoped fetch) are dropped so the floor
 * plan can't accumulate ghosts. When the server returns an empty list the
 * local floor plan is kept (offline-first seeding; an occupied table is never
 * auto-freed by an empty backend status).
 */
function mergeTablesById(local: TableInfo[], incoming: any[]): TableInfo[] {
  const localById = new Map(local.map((t: TableInfo) => [t.id, t]));
  const merged = incoming.map((bt: any): TableInfo => {
    const localT = localById.get(bt.id);
    if (!localT) return bt as TableInfo;
    return {
      ...localT,
      number: bt.number ?? localT.number,
      capacity: bt.capacity ?? localT.capacity,
      section: bt.section ?? localT.section,
      status: localT.status && localT.status !== 'Available' ? localT.status : (bt.status || 'Available'),
      branchId: bt.branchId ?? localT.branchId,
    };
  });
  if (incoming.length > 0) {
    // Server has the authoritative table list — drop stale local-only rows.
    return merged;
  }
  const mergedIds = new Set(merged.map((t) => t.id));
  for (const t of local) if (!mergedIds.has(t.id)) merged.push(t);
  return merged;
}

/**
 * Merge backend takeaway orders into local state. The backend list is
 * authoritative on a successful fetch: local-only rows are dropped while the
 * local elapsedTime is preserved on matching rows (keyed by id, then
 * orderNumber so a local temp id and its server _id aren't duplicated).
 */
function mergeTakeawayById(local: TakeawayOrder[], incoming: TakeawayOrder[]): TakeawayOrder[] {
  const localById = new Map(local.map((t) => [t.id, t]));
  const localByNumber = new Map(local.map((t) => [t.orderNumber, t]));
  const out: TakeawayOrder[] = [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<number>();
  for (const inc of incoming) {
    if (seenIds.has(inc.id) || seenNumbers.has(inc.orderNumber)) continue;
    const localT = localById.get(inc.id) || localByNumber.get(inc.orderNumber);
    out.push(localT ? { ...inc, elapsedTime: localT.elapsedTime } : inc);
    seenIds.add(inc.id);
    seenNumbers.add(inc.orderNumber);
  }
  return out;
}

/**
 * Merge backend menu products into the local catalog. The backend list is
 * authoritative on a successful fetch: local-only rows (ghosts from a prior
 * sync, products deleted server-side) are dropped, and local-only fields on
 * matching rows are preserved. Rows are keyed by id, then (name+category).
 */
function mergeProductsById(local: Product[], incoming: any[]): Product[] {
  const nameKey = (name?: string, category?: string) =>
    `${(name || '').toLowerCase()}|${(category || '').toLowerCase()}`;
  const localById = new Map(local.filter((p) => p.id).map((p) => [p.id, p]));
  const localByName = new Map(local.map((p) => [nameKey(p.name, p.category), p]));
  const merged: Product[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const bp of incoming) {
    const id = bp._id || bp.id;
    const key = nameKey(bp.name, bp.category);
    if ((id && seenIds.has(id)) || seenNames.has(key)) continue;
    const localP = (id && localById.get(id)) || localByName.get(key);
    merged.push({
      ...(localP || {}),
      id: id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      code: bp.code ?? localP?.code ?? '',
      name: bp.name ?? localP?.name ?? '',
      price: bp.price ?? localP?.price ?? 0,
      category: bp.category ?? localP?.category,
      image: bp.image || localP?.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
      gstPercent: bp.gstPercent ?? localP?.gstPercent ?? 0,
      availability: bp.availability ?? localP?.availability ?? true,
      favorite: bp.favorite ?? localP?.favorite,
      variants: bp.variants ?? localP?.variants,
      branchId: bp.branchId ?? localP?.branchId,
    });
    if (id) seenIds.add(id);
    seenNames.add(key);
  }
  return merged;
}


/**
 * Merge backend staff into the local employee list. The backend list is
 * authoritative on a successful fetch: local-only rows are dropped while the
 * local PIN (never returned by the backend) is preserved on matching rows
 * (keyed by id, then username).
 */
function mergeEmployeesById(local: Employee[], incoming: any[]): Employee[] {
  const localById = new Map(local.filter((e) => e.id).map((e) => [e.id, e]));
  const localByUsername = new Map(local.map((e) => [e.username.toLowerCase(), e]));
  const merged: Employee[] = [];
  const seenIds = new Set<string>();
  const seenUsernames = new Set<string>();
  for (const be of incoming) {
    const id = be._id || be.id;
    const username = String(be.username || '');
    const ukey = username.toLowerCase();
    if ((id && seenIds.has(id)) || (username && seenUsernames.has(ukey))) continue;
    const localE = (id && localById.get(id)) || localByUsername.get(ukey);
    merged.push({
      ...(localE || {}),
      id: id || `emp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      username,
      name: be.name || localE?.name || 'Staff',
      role: (be.role as Employee['role']) || localE?.role || 'Cashier',
      pin: localE?.pin || '',
      status: be.status || localE?.status || 'Active',
      branchId: be.branchId ?? localE?.branchId,
      lastLogin: be.lastLogin ?? localE?.lastLogin,
    });
    if (id) seenIds.add(id);
    if (username) seenUsernames.add(ukey);
  }
  return merged;
}

/**
 * Merge backend branches into the local list. The backend list is
 * authoritative on a successful fetch: local-only rows (deleted branches,
 * ghosts from a prior sync) are dropped while local-only fields on matching
 * rows are preserved (keyed by id, then name).
 */
function mergeBranchesById(local: Branch[], incoming: any[]): Branch[] {
  const localById = new Map(local.filter((b) => b.id).map((b) => [b.id, b]));
  const localByName = new Map(local.map((b) => [b.name.toLowerCase(), b]));
  const merged: Branch[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const bb of incoming) {
    const id = bb._id || bb.id;
    const name = String(bb.name || '');
    if ((id && seenIds.has(id)) || (name && seenNames.has(name.toLowerCase()))) continue;
    const localB = (id && localById.get(id)) || localByName.get(name.toLowerCase());
    merged.push({
      ...(localB || {}),
      id: id || `branch_${Date.now()}`,
      name,
      address: bb.address ?? localB?.address,
      phone: bb.phone ?? localB?.phone,
      isHeadBranch: bb.isHeadBranch ?? localB?.isHeadBranch ?? false,
      isActive: bb.isActive ?? localB?.isActive ?? true,
      createdAt: bb.createdAt ? String(bb.createdAt) : (localB?.createdAt || new Date().toISOString()),
    });
    if (id) seenIds.add(id);
    if (name) seenNames.add(name.toLowerCase());
  }
  return merged;
}

/**
 * Merge backend expense records into local state. The backend list is
 * authoritative on a successful fetch: local-only rows are dropped while
 * local-only fields on matching rows are preserved (keyed by id).
 */
function mergeExpensesById(local: ExpenseEntry[], incoming: any[]): ExpenseEntry[] {
  const localById = new Map(local.filter((e) => e.id).map((e) => [e.id, e]));
  const merged: ExpenseEntry[] = [];
  const seenIds = new Set<string>();
  for (const be of incoming) {
    const id = be._id || be.id;
    if (id && seenIds.has(id)) continue;
    const localE = id ? localById.get(id) : undefined;
    merged.push({
      ...(localE || {}),
      id: id || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      date: be.date || localE?.date || (be.createdAt ? String(be.createdAt).slice(0, 10) : ''),
      category: be.category || localE?.category || 'Miscellaneous',
      description: be.description || localE?.description || '',
      amount: be.amount ?? localE?.amount ?? 0,
      paymentMethod: be.paymentMethod || localE?.paymentMethod || 'Cash',
      vendor: be.vendor ?? localE?.vendor,
      notes: be.notes ?? localE?.notes,
      isRecurring: be.isRecurring ?? localE?.isRecurring,
      branchId: be.branchId ?? localE?.branchId,
      createdAt: be.createdAt ? String(be.createdAt) : (localE?.createdAt || new Date().toISOString()),
      createdBy: be.createdBy ?? localE?.createdBy,
    });
    if (id) seenIds.add(id);
  }
  return merged;
}

/**
 * Merge backend reservations into local state. The backend list is
 * authoritative on a successful fetch: local-only rows are dropped while
 * local-only fields on matching rows are preserved (keyed by id).
 */
function mergeReservationsById(local: Reservation[], incoming: any[]): Reservation[] {
  const localById = new Map(local.filter((r) => r.id).map((r) => [r.id, r]));
  const merged: Reservation[] = [];
  const seenIds = new Set<string>();
  for (const br of incoming) {
    const id = br._id || br.id;
    if (id && seenIds.has(id)) continue;
    const localR = id ? localById.get(id) : undefined;
    merged.push({
      ...(localR || {}),
      id: id || `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      customerName: br.customerName || localR?.customerName || 'Guest',
      customerPhone: String(br.customerPhone || localR?.customerPhone || ''),
      guestCount: br.guestCount ?? localR?.guestCount ?? 1,
      date: br.date || localR?.date || '',
      time: br.time || localR?.time || '00:00',
      tableId: br.tableId ?? localR?.tableId,
      tableNumber: br.tableNumber ?? localR?.tableNumber,
      status: br.status || localR?.status || 'Confirmed',
      branchId: br.branchId ?? localR?.branchId,
      notes: br.notes ?? localR?.notes,
      occasion: br.occasion ?? localR?.occasion,
      createdAt: br.createdAt ? String(br.createdAt) : (localR?.createdAt || new Date().toISOString()),
      createdBy: br.createdBy ?? localR?.createdBy,
    });
    if (id) seenIds.add(id);
  }
  return merged;
}

/**
 * Merge backend reward tiers into the local catalog. The backend list is
 * authoritative on a successful fetch: local-only rows are dropped while
 * local-only UI fields on matching rows are preserved (keyed by id).
 */
function mergeRewardsById(local: LoyaltyReward[], incoming: any[]): LoyaltyReward[] {
  const localById = new Map(local.filter((r) => r.id).map((r) => [r.id, r]));
  const merged: LoyaltyReward[] = [];
  const seenIds = new Set<string>();
  for (const br of incoming) {
    const id = br._id || br.id;
    if (id && seenIds.has(id)) continue;
    const localR = id ? localById.get(id) : undefined;
    merged.push({
      ...(localR || {}),
      id: id || `r_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: br.title || localR?.title || '',
      pointsRequired: br.pointsRequired ?? localR?.pointsRequired ?? 0,
      type: br.type || localR?.type || 'flat',
      value: br.value ?? localR?.value ?? 0,
      minBillAmount: br.minBillAmount ?? localR?.minBillAmount ?? 0,
      isLargeReward: br.isLargeReward ?? localR?.isLargeReward ?? false,
      rewardItemId: br.rewardItemId ?? localR?.rewardItemId,
      rewardItemName: br.rewardItemName ?? localR?.rewardItemName,
    });
    if (id) seenIds.add(id);
  }
  return merged;
}

/**
 * Merge backend held (suspended) order snapshots into local state. The backend
 * list is authoritative on a successful fetch: local-only rows are dropped
 * while local-only fields on matching rows are preserved (keyed by id).
 * serverId (the Mongo _id) is kept so recall/completion can delete the row
 * server-side.
 */
function mergeHeldOrdersById(local: any[], incoming: any[]): any[] {
  const localById = new Map(local.filter((h) => h.id).map((h) => [h.id, h]));
  const merged: any[] = [];
  const seenIds = new Set<string>();
  for (const bh of incoming) {
    const id = bh.id || bh.clientId || bh._id;
    if (id && seenIds.has(id)) continue;
    const localH = id ? localById.get(id) : undefined;
    merged.push({
      ...(localH || {}),
      id: id || `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      serverId: bh.serverId || bh._id || bh.id,
      timestamp: bh.timestamp || localH?.timestamp || new Date().toLocaleTimeString(),
      items: Array.isArray(bh.items) ? bh.items : (localH?.items || []),
      customer: bh.customer ?? localH?.customer ?? null,
      type: bh.type || localH?.type || 'Takeaway',
      orderId: bh.orderId ?? localH?.orderId,
    });
    if (id) seenIds.add(id);
  }
  return merged;
}

/**
 * Reconcile backend customer profiles with local state. The backend list is
 * authoritative: local-only rows (ghosts from a prior sync, customers deleted
 * server-side) are dropped — even when the backend returns an empty list after
 * a data cleanup. Local-only fields the backend never returns (purchaseHistory,
 * notes, isNew) are preserved on matching phones. On fetch failure the local
 * list is kept untouched (offline-first).
 */
function mergeCustomersAuthoritative(local: Customer[], incoming: any[]): Customer[] {
  const localByPhone = new Map(local.map((c) => [c.phone, c]));
  const merged: Customer[] = [];
  const seen = new Set<string>();
  for (const bc of incoming) {
    const phone = String(bc.phone || '').trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const localC = localByPhone.get(phone);
    merged.push({
      ...(localC || {}),
      phone,
      name: bc.name || localC?.name || 'Guest',
      email: bc.email ?? localC?.email,
      isNew: localC?.isNew ?? false,
      visits: bc.visits ?? localC?.visits ?? 0,
      points: bc.points ?? localC?.points ?? 0,
      birthday: bc.birthday ?? localC?.birthday,
      lastVisit: bc.lastVisit || localC?.lastVisit || 'Never',
      notes: bc.notes ?? localC?.notes,
      isBlocked: bc.isBlocked ?? localC?.isBlocked,
      purchaseHistory: localC?.purchaseHistory || [],
    });
  }
  return merged;
}

export function usePOSState() {
  // ============ BRANCH STATE ============
  const [branches, setBranches] = useState<Branch[]>(() => getDBData<Branch[]>('pos_branches', []));
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(() => getDBData<string | null>('pos_current_branch_id', 'branch_main'));
  const [branchSettings, setBranchSettings] = useState<Record<string, Partial<SystemSettings>>>(() => 
    getDBData<Record<string, Partial<SystemSettings>>>('pos_branch_settings', {})
  );
  const [branchProductPrices, setBranchProductPrices] = useState<Record<string, Record<string, number>>>(() =>
    getDBData<Record<string, Record<string, number>>>('pos_branch_product_prices', {})
  );
  const [branchTables, setBranchTables] = useState<Record<string, TableInfo[]>>(() =>
    getDBData<Record<string, TableInfo[]>>('pos_branch_tables', {})
  );
  const [branchVariantPrices, setBranchVariantPrices] = useState<Record<string, Record<string, Record<string, number>>>>(() =>
    getDBData<Record<string, Record<string, Record<string, number>>>>('pos_branch_variant_prices', {})
  );

  // ============ CORE DATA ============
  // Init from localStorage for instant render; API fetch runs below in useEffect
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => getDBData('pos_current_employee', null));
  const [products, setProducts] = useState<Product[]>(() => getDBData<Product[]>('pos_products', []));
  const [customers, setCustomers] = useState<Customer[]>(() => getDBData<Customer[]>('pos_customers', []));
  const [rewards, setRewards] = useState<LoyaltyReward[]>(() => getDBData<LoyaltyReward[]>('pos_rewards', []));
  const [employees, setEmployees] = useState<Employee[]>(() => getDBData<Employee[]>('pos_employees', []));
  const [settings, setSettings] = useState<SystemSettings>(() => getDBData('pos_settings', DEFAULT_SETTINGS));
  // Normalize cached bills/orders on hydration: localStorage may hold data
  // written before the list endpoints guaranteed items/kotRecords/timeline
  // arrays, and dashboard/reports/analytics read .length on those fields.
  const [bills, setBills] = useState<Bill[]>(() =>
    (getDBData<Bill[]>('pos_bills', [])).map((b: any) => ({
      ...b,
      items: Array.isArray(b.items) ? b.items : [],
    }))
  );
  const [expenses, setExpenses] = useState<ExpenseEntry[]>(() => getDBData<ExpenseEntry[]>('pos_expenses', []));
  const [reservations, setReservations] = useState<Reservation[]>(() => getDBData<Reservation[]>('pos_reservations', []));
  const [waitingList, setWaitingList] = useState<WaitingEntry[]>(() => getDBData<WaitingEntry[]>('pos_waiting_list', []));
  const [floors, setFloors] = useState<Floor[]>(() => getDBData<Floor[]>('pos_floors', []));
  const [categories, setCategories] = useState<string[]>(() => getDBData<string[]>('pos_categories', []));
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(() => getDBData<Record<string, string>>('pos_category_colors', {}));

  // ============ ORDER STATE ============
  const [tables, setTables] = useState<TableInfo[]>(() => {
    const saved = getDBData<TableInfo[]>('pos_tables', []);
    // PRESERVE saved status/occupancy (orderSince/orderId) so tables stay occupied
    // across navigation/re-renders. Previously every table was force-reset to
    // 'Available' on mount, which made tables appear free after sending a KOT.
    return saved.map(t => ({
      ...t,
      status: t.status || ('Available' as const),
      orderSince: t.orderSince || undefined,
      orderId: t.orderId || undefined,
    }));
  });
  const [orders, setOrders] = useState<Order[]>(() =>
    (getDBData<Order[]>('pos_orders', [])).map((o: any) => ({
      ...o,
      items: Array.isArray(o.items) ? o.items : [],
      kotRecords: Array.isArray(o.kotRecords) ? o.kotRecords : [],
      timeline: Array.isArray(o.timeline) ? o.timeline : [],
    }))
  );
  const [takeawayOrders, setTakeawayOrders] = useState<TakeawayOrder[]>(() =>
    (getDBData<TakeawayOrder[]>('pos_takeaway_orders', [])).map((o: any) => ({
      ...o,
      items: Array.isArray(o.items) ? o.items : [],
    }))
  );
  const [heldOrders, setHeldOrders] = useState<any[]>(() => getDBData<any[]>('pos_held_orders', []));
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isKOTOpen, setIsKOTOpen] = useState(false);
  const [kotOrder, setKotOrder] = useState<Order | null>(null);
  const [isKOTPreviewOpen, setIsKOTPreviewOpen] = useState(false);
  const [kotPreviewData, setKotPreviewData] = useState<any>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  // ============ BILLING STATE ============
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [customerPhone, setCustomerPhone] = useState('');
  const [searchedCustomer, setSearchedCustomer] = useState<any>(null);
  const [orderType, setOrderType] = useState<any>('Dine In');
  const [paymentMethod, setPaymentMethod] = useState<any>('Cash');
  const [splitDetails, setSplitDetails] = useState({ cashAmount: 0, cardAmount: 0, upiAmount: 0, walletAmount: 0 });
  const [appliedReward, setAppliedReward] = useState<any>(null);

  // ============ UI STATE ============
  // Restore the last workspace on cold boot (session restore). Only accept
  // values that map to a real workspace path; otherwise fall back to Dashboard.
  const [activeWorkspace, setActiveWorkspace] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('pos_active_workspace');
      if (saved && WORKSPACE_PATHS[saved as keyof typeof WORKSPACE_PATHS]) return saved;
    } catch { /* ignore */ }
    return 'Dashboard';
  });
  const [billingCategory, setBillingCategory] = useState('All');
  const [billingSearch, setBillingSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [cartWidth, setCartWidth] = useState<number>(() => { try { const s = localStorage.getItem('pos_cart_width'); return s ? parseInt(s, 10) : 380; } catch { return 380; } });
  const [isHeldDrawerOpen, setIsHeldDrawerOpen] = useState(false);
  const [isShortcutOpen, setIsShortcutOpen] = useState(false);
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);
  const [isDailySalesOpen, setIsDailySalesOpen] = useState(false);
  const [isHistoryFeedOpen, setIsHistoryFeedOpen] = useState(false);
  const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false);
  const [isOffersPopupOpen, setIsOffersPopupOpen] = useState(false);
  const [isSplitPopupOpen, setIsSplitPopupOpen] = useState(false);
  const [isZReportOpen, setIsZReportOpen] = useState(false);
  const [isVoidReasonOpen, setIsVoidReasonOpen] = useState(false);
  const [isAddOnModalOpen, setIsAddOnModalOpen] = useState(false);
  const [isMoreBillingOpen, setIsMoreBillingOpen] = useState(false);
  const [isQuickFireActive, setIsQuickFireActive] = useState(false);
  const [quickFireInput, setQuickFireInput] = useState('');
  const [quickFireSessionCount, setQuickFireSessionCount] = useState(0);
  const [quickFireFlash, setQuickFireFlash] = useState<any>(null);
  const [activeReceipt, setActiveReceipt] = useState<any>(null);
  const [previewReceipt, setPreviewReceipt] = useState<any>(null);
  const [isLiveReceiptPreview, setIsLiveReceiptPreview] = useState(false);
  const [otpVerificationState, setOtpVerificationState] = useState<any>({ isOpen: false, code: '', typedCode: '', reward: null });
  const [addOnModalProduct, setAddOnModalProduct] = useState<any>(null);
  const [addOnModalVariant, setAddOnModalVariant] = useState<any>(undefined);
  const [confirmState, setConfirmState] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Refs
  const billingSearchRef = useRef<any>(null);
  const loyaltyPhoneRef = useRef<any>(null);
  const quickFireRef = useRef<any>(null);
  const tourArtifactRef = useRef<any>({});

  // ============ TABLE / TAKEAWAY REFRESH (merge, never replace) ============
  // These two collections hold frontend-only fields (table occupancy + layout,
  // takeaway status) that the backend models partially. A plain fetchAndCache
  // replace would clobber them, so refreshTables/refreshTakeaway merge server
  // rows into the current local state and persist the merged result.
  const refreshTables = useCallback(() => {
    return api.fetchTables().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setTables((prev: any[]) => {
        const merged = mergeTablesById(prev, incoming);
        setCachedData(CK.TABLES, merged);
        return merged;
      });
      // Multi-branch mode renders the grid from the per-branch cache
      // (branchTables[bid]) which is only written by local mutations and can
      // go stale — e.g. ghost/duplicate tables cached before a data cleanup.
      // Heal it from the authoritative backend list on every successful fetch
      // (scoped to this branch) so stale layouts don't linger forever.
      if (currentBranchId) {
        setBranchTables((prevBt: Record<string, TableInfo[]>) => {
          const existing = prevBt[currentBranchId];
          if (!existing) return prevBt; // nothing cached to heal
          const branchRows = incoming.filter(
            (t: any) => !t.branchId || t.branchId === currentBranchId,
          );
          const healed = mergeTablesById(existing, branchRows);
          // Id-based (not length-only) no-op guard: a stale cache whose ghost
          // count coincidentally equals the healed count must still be healed,
          // and equal-id caches must not churn a state update every poll.
          const unchanged =
            healed.length === existing.length &&
            healed.every((t, i) => t.id === existing[i].id);
          if (unchanged) return prevBt;
          return { ...prevBt, [currentBranchId]: healed };
        });
      }
    }).catch(() => undefined);
  }, [setTables, setBranchTables, currentBranchId]);

  const refreshTakeaway = useCallback(() => {
    return api.fetchTakeawayOrders().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setTakeawayOrders((prev: TakeawayOrder[]) => {
        const merged = mergeTakeawayById(prev, incoming);
        setCachedData(CK.TAKEAWAY, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setTakeawayOrders]);

  // Products/customers use the same merge-not-replace rule: the local catalog
  // is authoritative and backend rows are appended for anything new.
  const refreshProducts = useCallback(() => {
    return api.fetchProducts().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setProducts((prev: Product[]) => {
        const merged = mergeProductsById(prev, incoming);
        setCachedData(CK.PRODUCTS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setProducts]);

  const refreshCustomers = useCallback(() => {
    // Reconcile against the authoritative backend list (requesting the max the
    // API allows) so stale ghost customers from before a data cleanup are
    // dropped — even when the backend is now empty — while local-only fields
    // (purchaseHistory, notes) on customers that still exist are preserved.
    // On error the local list is kept (offline-first).
    return api.fetchCustomers({ limit: 100 }).then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setCustomers((prev: Customer[]) => {
        const merged = mergeCustomersAuthoritative(prev, incoming);
        setCachedData(CK.CUSTOMERS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setCustomers]);

  const refreshEmployees = useCallback(() => {
    return api.fetchEmployees().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setEmployees((prev: Employee[]) => {
        const merged = mergeEmployeesById(prev, incoming);
        setCachedData(CK.EMPLOYEES, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setEmployees]);

  const refreshBranches = useCallback(() => {
    return api.fetchBranches().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setBranches((prev: Branch[]) => {
        const merged = mergeBranchesById(prev, incoming);
        setCachedData(CK.BRANCHES, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setBranches]);

  const refreshExpenses = useCallback(() => {
    // The expenses endpoint is paginated (max 200) — request the full snapshot
    // so the authoritative merge never truncates the cache.
    return api.fetchExpenses({ limit: 200 }).then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setExpenses((prev: ExpenseEntry[]) => {
        const merged = mergeExpensesById(prev, incoming);
        setCachedData(CK.EXPENSES, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setExpenses]);

  const refreshReservations = useCallback(() => {
    return api.fetchReservations().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setReservations((prev: Reservation[]) => {
        const merged = mergeReservationsById(prev, incoming);
        setCachedData(CK.RESERVATIONS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setReservations]);

  // Waiting list refreshes from the server (server-computed wait estimates),
  // merged by id so local optimistic rows are never clobbered away.
  const refreshWaiting = useCallback(() => {
    return api.fetchWaiting().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setWaitingList((prev: WaitingEntry[]) => {
        // Backend list is authoritative on a successful fetch — local-only
        // rows are dropped so ghosts from a prior sync can't accumulate.
        const localById = new Map(prev.map((w: any) => [w.id, w]));
        const merged = incoming.map((bw: any) => {
          const local = localById.get(bw._id || bw.id);
          return {
            ...(local || {}),
            ...bw,
            id: local?.id || bw._id || bw.id,
          } as WaitingEntry;
        });
        setCachedData(CK.WAITING, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setWaitingList]);

  // Floors refresh from the server, merged by id (backward compatible — floors
  // are optional; tables without a floorId belong to the branch default view).
  const refreshFloors = useCallback(() => {
    return api.fetchFloors().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setFloors((prev: Floor[]) => {
        // Backend list is authoritative on a successful fetch — local-only
        // rows are dropped so stale/ghost floors don't linger.
        const localById = new Map(prev.map((f: any) => [f.id, f]));
        const merged = incoming.map((bf: any) => ({
          ...(localById.get(bf.id) || {}),
          ...bf,
          id: bf.id,
        }));
        setCachedData(CK.FLOORS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setFloors]);

  const refreshRewards = useCallback(() => {
    return api.fetchRewards().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setRewards((prev: LoyaltyReward[]) => {
        const merged = mergeRewardsById(prev, incoming);
        setDBData(CK.REWARDS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setRewards]);

  const refreshHeldOrders = useCallback(() => {
    return api.fetchHeldOrders().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      setHeldOrders((prev: any[]) => {
        const merged = mergeHeldOrdersById(prev, incoming);
        setDBData('pos_held_orders', merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setHeldOrders]);

  // ============ MANUAL FULL SYNC (pull) ============
  // One round-trip to GET /api/sync. Collections that have merge helpers are
  // merged into local state (never replaced — an empty backend can't wipe
  // seeded/local data); orders/bills re-fetch through their normalized,
  // cache-aware paths. Resolves true on success so the SyncPanel can toast.
  const runPullSync = useCallback(() => {
    return api.pullSync()
      .then((res: any) => {
        const data = res?.data || res;
        if (!data || typeof data !== 'object') return false;
        if (Array.isArray(data.products)) {
          setProducts(prev => {
            const m = mergeProductsById(prev, data.products);
            setCachedData(CK.PRODUCTS, m);
            return m;
          });
        }
        if (Array.isArray(data.customers)) {
          setCustomers(prev => {
            const m = mergeCustomersAuthoritative(prev, data.customers);
            setCachedData(CK.CUSTOMERS, m);
            return m;
          });
        }
        if (Array.isArray(data.employees)) {
          setEmployees(prev => {
            const m = mergeEmployeesById(prev, data.employees);
            setCachedData(CK.EMPLOYEES, m);
            return m;
          });
        }
        if (Array.isArray(data.branches)) {
          setBranches(prev => {
            const m = mergeBranchesById(prev, data.branches);
            setCachedData(CK.BRANCHES, m);
            return m;
          });
        }
        if (Array.isArray(data.expenses)) {
          setExpenses(prev => {
            const m = mergeExpensesById(prev, data.expenses);
            setCachedData(CK.EXPENSES, m);
            return m;
          });
        }
        if (Array.isArray(data.orders) && data.orders.length > 0) {
          fetchAndCache(api.fetchOrders, setOrders as any, CK.ORDERS);
        }
        if (Array.isArray(data.bills) && data.bills.length > 0) {
          fetchAndCache(api.fetchBills, setBills as any, CK.BILLS);
        }
        syncEngine.sync();
        return true;
      })
      .catch(() => false);
  }, [setProducts, setCustomers, setEmployees, setBranches, setExpenses, setOrders, setBills]);

  // ============ TTL-AWARE API DATA HYDRATION ============
  // Only re-fetch data whose cache TTL has expired. Cache timestamps survive
  // page reloads via pos_cache_meta, so fetchIfStale is cheap and idempotent.
  const hydrateFromApi = useCallback((force = false) => {
    // force=true bypasses the TTL check. Needed after LOGIN on a fresh device:
    // the mount-time persistence effects stamp the empty initial state as
    // "fresh" in pos_cache_meta, so a TTL-aware refetch would skip every call
    // and the dashboard would stay empty (orders would only appear after the
    // 30s poll; products/bills for up to 24h/5min).
    const h = <T>(fetcher: () => Promise<T | null>, setter: (d: T) => void, key: string, ttl: number) => {
      if (force) fetchAndCache(fetcher, setter, key);
      else fetchIfStale(fetcher, setter, key, ttl);
    };
    if (force) refreshProducts();
    else if (!isCacheFresh(CK.PRODUCTS, CACHE_TTL.SLOW)) refreshProducts();
    if (force) refreshCustomers();
    else if (!isCacheFresh(CK.CUSTOMERS, CACHE_TTL.MEDIUM)) refreshCustomers();
    if (force) refreshEmployees();
    else if (!isCacheFresh(CK.EMPLOYEES, CACHE_TTL.SLOW)) refreshEmployees();
    h(api.fetchBills, setBills as any, CK.BILLS, CACHE_TTL.MEDIUM);
    if (force) refreshExpenses();
    else if (!isCacheFresh(CK.EXPENSES, CACHE_TTL.SLOW)) refreshExpenses();
    if (force) refreshBranches();
    else if (!isCacheFresh(CK.BRANCHES, CACHE_TTL.SLOW)) refreshBranches();
    h(api.fetchOrders, setOrders as any, CK.ORDERS, CACHE_TTL.FAST);
    // Tables/takeaway merge into local state rather than replacing it so an
    // empty backend collection can't wipe floor plans or takeaway rows.
    if (force) refreshTables();
    else if (!isCacheFresh(CK.TABLES, CACHE_TTL.FAST)) refreshTables();
    if (force) refreshTakeaway();
    else if (!isCacheFresh(CK.TAKEAWAY, CACHE_TTL.FAST)) refreshTakeaway();
    if (force) refreshReservations();
    else if (!isCacheFresh(CK.RESERVATIONS, CACHE_TTL.LIVE)) refreshReservations();
    if (force) refreshRewards();
    else if (!isCacheFresh(CK.REWARDS, CACHE_TTL.SLOW)) refreshRewards();
    if (force) refreshHeldOrders();
    else if (!isCacheFresh('pos_held_orders', CACHE_TTL.SLOW)) refreshHeldOrders();
  }, [refreshProducts, refreshCustomers, refreshEmployees, refreshBranches, refreshTables, refreshTakeaway, refreshExpenses, refreshReservations, refreshRewards, refreshHeldOrders]);

  // Hydrate on mount (covers warm reloads — token restored from localStorage
  // before these effects run, so the fetches succeed).
  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  // Re-hydrate after LOGIN. On a fresh session the mount effect fires before a
  // JWT exists, so every fetch 401s and bills/orders/products stay empty; the
  // 30s poll only covers orders/tables/takeaway. Firing again once an employee
  // is set (guarded by ref so it runs once per login) lets the seeded data
  // populate the dashboard immediately. fetchIfStale's TTL check makes this a
  // no-op when data is already fresh.
  const hydratedEmployeeRef = useRef<Employee | null>(currentEmployee);
  useEffect(() => {
    if (currentEmployee && hydratedEmployeeRef.current !== currentEmployee) {
      hydratedEmployeeRef.current = currentEmployee;
      // force=true: a fresh login means the mount-time fetches 401'd and the
      // empty cache may be stamped fresh — bypass TTL so real data loads now.
      hydrateFromApi(true);
    }
  }, [currentEmployee, hydrateFromApi]);

  // Replay any offline write queue left over from a previous session once we
  // have an authenticated session. Covers warm reloads (token restored before
  // mount) and fresh logins alike — the existing reconnect path only replays
  // on an offline→online transition, which never fires when the app reloads
  // while online.
  useEffect(() => {
    if (currentEmployee && syncEngine.getQueue().length > 0) {
      syncEngine.replayQueue(api.executePendingOperation);
    }
  }, [currentEmployee]);

  // ============ BACKGROUND POLLING FOR LIVE DATA ============
  // Orders, tables, and takeaway refresh every 30s while online
  // Skips poll when there's an active order to avoid overwriting pending local mutations
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine && !activeOrder) {
        fetchAndCache(api.fetchOrders, setOrders as any, CK.ORDERS);
        refreshTables();
        refreshTakeaway();
        refreshReservations();
        refreshWaiting();
        refreshFloors();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [activeOrder, refreshTables, refreshTakeaway, refreshReservations, refreshWaiting, refreshFloors]);

  // ============ SUBSCRIPTION FEATURES (from plan) ============
  // Cache keys are namespaced per restaurant (from the JWT) so switching
  // accounts on the same device never shows another restaurant's cached
  // (e.g. trial) features. When no restaurant is known, start conservative.
  const [subscriptionFeatures, setSubscriptionFeatures] = useState<string[]>(
    () => {
      try {
        // Phase 1.10: read the (possibly legacy, non-namespaced) feature cache
        // even when no JWT is present yet. A device that synced its plan once
        // keeps its features before login (offline-first), and E2E seeds that
        // preload the legacy key render plan-gated UI deterministically.
        const cached = localStorage.getItem(api.getSubscriptionCacheKeys().features);
        return cached ? JSON.parse(cached) : [];
      } catch { return []; }
    }
  );
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(api.getSubscriptionCacheKeys().status);
      } catch { return null; }
    }
  );

  // Fetch subscription status + features (determines which features the plan allows).
  // Runs on mount and re-runs whenever a subscription mutation happens
  // (clearSubscriptionCache dispatches 'pos:subscription-changed') so both the
  // in-memory state and the offline cache stay in sync after plan changes/payments.
  const refreshSubscriptionStatus = useCallback(() => {
    api.fetchSubscriptionStatus().then((sub: any) => {
      if (!sub) return;
      const keys = api.getSubscriptionCacheKeys();
      setSubscriptionStatus(sub.status || null);
      try { localStorage.setItem(keys.status, sub.status || ''); } catch {}
      // The 7-day free trial unlocks every feature — ignore a partial feature list.
      const features: string[] = sub.status === 'trial' ? ALL_FEATURES : (sub.features || []);
      setSubscriptionFeatures(features);
      try { localStorage.setItem(keys.features, JSON.stringify(features)); } catch {}
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSubscriptionStatus();
  }, [refreshSubscriptionStatus]);

  // Keep features/status fresh after any subscription change (plan change, payment, renew)
  useEffect(() => {
    const onChange = () => refreshSubscriptionStatus();
    window.addEventListener('pos:subscription-changed', onChange);
    return () => window.removeEventListener('pos:subscription-changed', onChange);
  }, [refreshSubscriptionStatus]);

  // Reset subscription state when the logged-in account (restaurant) changes.
  // The POS hook lives at App level and does not remount between logins, and
  // refreshSubscriptionStatus is a stable useCallback — so this effect runs on
  // EVERY render (no dep array) and compares the JWT restaurantId against the
  // ref, firing only when the account actually changes. Without this, the
  // previous account's cached (e.g. trial) features would stay in memory when a
  // different restaurant logs in on the same device.
  const prevRestaurantIdRef = useRef<string | null>(api.getCurrentRestaurantId());
  useEffect(() => {
    const rid = api.getCurrentRestaurantId();
    if (rid !== prevRestaurantIdRef.current) {
      prevRestaurantIdRef.current = rid;
      // Drop any in-memory + cached features from the previous account immediately.
      setSubscriptionFeatures([]);
      setSubscriptionStatus(null);
      try {
        const keys = api.getSubscriptionCacheKeys();
        localStorage.removeItem(keys.features);
        localStorage.removeItem(keys.status);
      } catch { /* ignore */ }
      refreshSubscriptionStatus();
    }
  });

  // ─── Helper to check if a feature is allowed by the subscription plan ──
  const hasPlanFeature = useCallback((feature: string): boolean => {
    return subscriptionFeatures.includes(feature);
  }, [subscriptionFeatures]);

  // ============ PLAN-CONSTRAINED MODULE SETTINGS ============
  // These start with the user's configured moduleSettings, then override
  // any feature that the subscription plan doesn't include → force it OFF.
  // This ensures unchecked plan features are truly disabled in the POS.
  const moduleSettings = useMemo(() => {
    const userSettings: Record<string, boolean> = {
      enableTableService: true, enableWaiterManagement: true, enableReservations: false,
      enableQROrdering: false, enableDeliveryModule: true, enableOnlineOrders: true,
      enableKitchenDisplay: true, enableLoyalty: true, showImagesInBilling: true,
      enableOffersPopup: true, enableAutoPrintKOT: false, enableQuickSoundAlerts: false,
      showItemCodeOnCard: false, enableGuestCheckout: true, enableOrderNotes: true,
      enableTakeawayModule: true, enableDineInModule: true, enableExpenseManagement: true,
      enableDiscountOnBilling: false,
      // ─── AI Feature Toggles ──────────────────────────────
      enableAISummary: true,
      enableAIInventoryHealth: true,
      enableAIPurchaseRecs: true,
      enableAILowStock: true,
      enableAIWasteAnalysis: true,
      enableAIVoiceEntry: true,
      enableAIWeather: true,
      enableAIClosingAssistant: true,
      ...(settings.moduleSettings || {}),
    };

    // Override with plan constraints — if the plan doesn't include a feature, force it OFF
    const planHas = (f: string) => subscriptionFeatures.includes(f);

    if (!planHas('ai')) {
      userSettings.enableAISummary = false;
      userSettings.enableAIInventoryHealth = false;
      userSettings.enableAIPurchaseRecs = false;
      userSettings.enableAILowStock = false;
      userSettings.enableAIWasteAnalysis = false;
      userSettings.enableAIVoiceEntry = false;
      userSettings.enableAIWeather = false;
      userSettings.enableAIClosingAssistant = false;
    }
    if (!planHas('loyalty')) userSettings.enableLoyalty = false;
    if (!planHas('reservations')) userSettings.enableReservations = false;
    if (!planHas('multi_branch')) userSettings.enableMultiBranch = false;
    if (!planHas('expense_tracking')) userSettings.enableExpenseManagement = false;

    // During the free trial every module is unlocked — force the add-on module
    // toggles ON so ALL options are visible in the POS (full product showcase).
    // Outside trial these follow the user's own Settings toggles.
    if (subscriptionStatus === 'trial') {
      userSettings.enableReservations = true;
      userSettings.enableMultiBranch = true;
    }

    return userSettings;
  }, [settings.moduleSettings, subscriptionFeatures, subscriptionStatus]);

  // ============ DERIVED PLAN-AWARE FLAGS ============
  const hasInventory = useMemo(() => hasPlanFeature('inventory'), [hasPlanFeature]);
  const hasAnalytics = useMemo(() => hasPlanFeature('analytics'), [hasPlanFeature]);
  const hasAdvancedReports = useMemo(() => hasPlanFeature('advanced_reports'), [hasPlanFeature]);

  // ============ BRANCH-AWARE FILTERING ============
  const isMultiBranchEnabled = moduleSettings?.enableMultiBranch === true;
  const currentBranch = useMemo(() => branches.find(b => b.id === currentBranchId) || null, [branches, currentBranchId]);
  const isHeadBranch = currentBranch?.isHeadBranch === true;
  const isOwnerRole = currentEmployee?.role === 'Owner';
  const shouldFilterByBranch = isMultiBranchEnabled && currentBranchId && !(isHeadBranch && isOwnerRole);
  
  const filterByBranch = <T extends { branchId?: string }>(items: T[]): T[] => {
    if (!shouldFilterByBranch) return items;
    return items.filter(item => !item.branchId || item.branchId === currentBranchId);
  };

  // ============ PER-BRANCH SETTINGS MERGE ============
  const effectiveSettings = useMemo<SystemSettings>(() => {
    if (!isMultiBranchEnabled || !currentBranchId || !branchSettings[currentBranchId]) {
      return settings;
    }
    return { ...settings, ...branchSettings[currentBranchId] };
  }, [settings, branchSettings, currentBranchId, isMultiBranchEnabled]);

  // ============ SYNC ============
  const [syncState, setSyncState] = useState(() => syncEngine.getSyncState());
  // Derive isOnline from syncState to avoid double re-renders on online/offline events.
  // syncState.online and setIsOnline were previously two separate state variables
  // that both updated on the same event, causing 2 re-renders per transition.
  const isOnline = syncState.online;

  useEffect(() => {
    const goOnline = () => syncEngine.setOnline(true);
    const goOffline = () => syncEngine.setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  useEffect(() => {
    /**
     * Debounce sync notifications using a microtask queue.
     * Multiple rapid markStale/markPending calls from different parts of the
     * app are coalesced into a single batch, preventing cascading re-renders
     * and duplicate API re-fetches (e.g. syncing orders + tables together).
     */
    let debounceScheduled = false;
    let cancelled = false;
    const unsubscribe = syncEngine.subscribe(() => {
      if (debounceScheduled) return; // already queued
      debounceScheduled = true;
      queueMicrotask(() => {
        if (cancelled) return;
        debounceScheduled = false;
        setSyncState(syncEngine.getSyncState());
        // Re-fetch only what's stale — consumer calls syncEngine.sync() or markStale()
        const staleKeys = syncEngine.consumeStaleKeys();
        if (staleKeys.length === 0) {
          // Manual "Sync All" — re-fetch everything
          refreshProducts();
          refreshCustomers();
          fetchAndCache(api.fetchBills, setBills as any, CK.BILLS);
          refreshExpenses();
          refreshBranches();
          fetchAndCache(api.fetchOrders, setOrders as any, CK.ORDERS);
          refreshTables();
          refreshTakeaway();
          refreshEmployees();
          refreshReservations();
        } else {
          // Targeted re-fetch for specific stale keys
          if (staleKeys.includes(CK.PRODUCTS)) refreshProducts();
          if (staleKeys.includes(CK.CUSTOMERS)) refreshCustomers();
          if (staleKeys.includes(CK.EMPLOYEES)) refreshEmployees();
          if (staleKeys.includes(CK.BILLS)) fetchAndCache(api.fetchBills, setBills as any, CK.BILLS);
          if (staleKeys.includes(CK.EXPENSES)) refreshExpenses();
          if (staleKeys.includes(CK.BRANCHES)) refreshBranches();
          if (staleKeys.includes(CK.ORDERS)) fetchAndCache(api.fetchOrders, setOrders as any, CK.ORDERS);
          if (staleKeys.includes(CK.TABLES)) refreshTables();
          if (staleKeys.includes(CK.TAKEAWAY)) refreshTakeaway();
          if (staleKeys.includes(CK.RESERVATIONS)) refreshReservations();
        }
        // Auto-replay offline queue when coming back online
        if (syncEngine.consumePendingReplay()) {
          syncEngine.replayQueue(api.executePendingOperation);
        }

        // Read-through from localStorage for API-less data
        setRewards(getDBData<LoyaltyReward[]>(CK.REWARDS, []));
        setSettings(getDBData(CK.SETTINGS, DEFAULT_SETTINGS)); // keep DEFAULT_SETTINGS as fallback
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  // ============ BACKEND-FIRST SETTINGS LOAD (Phase 1.9) ============
  // The backend (RestaurantSettings) is the source of truth. On mount and on
  // reconnect, fetch the effective settings and merge server-known keys over
  // the local snapshot. Local-only keys are preserved for backward
  // compatibility until the next save pushes them to the server.
  useEffect(() => {
    let cancelled = false;
    const loadServerSettings = async () => {
      const effective = await api.fetchEffectiveSettings(currentBranchId || undefined, undefined);
      if (cancelled || !effective || !effective.settings) return;
      const server = effective.settings;
      setSettings((prev) => {
        // Only apply keys the server actually knows about.
        const hasRealKeys = Object.keys(server).some((k) => server[k] !== undefined && server[k] !== null);
        if (!hasRealKeys) return prev;
        const merged: SystemSettings = { ...prev };
        for (const k of Object.keys(server)) {
          const sv = server[k];
          if (sv === undefined || sv === null) continue;
          const pv = (prev as any)[k];
          if (pv && typeof pv === 'object' && !Array.isArray(pv) && typeof sv === 'object' && !Array.isArray(sv)) {
            (merged as any)[k] = { ...pv, ...sv };
          } else {
            (merged as any)[k] = sv;
          }
        }
        return merged;
      });
    };
    void loadServerSettings();
    const goOnline = () => { void loadServerSettings(); };
    window.addEventListener('online', goOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
    };
  }, [currentBranchId]);

  // ============ LOCALSTORAGE PERSISTENCE (timestamped cache) ============
  // Slow-changing data: re-write timestamp on every change (so TTL extends)
  useEffect(() => { setCachedData(CK.BRANCHES, branches); }, [branches]);
  useEffect(() => { setDBData('pos_current_branch_id', currentBranchId); }, [currentBranchId]);
  useEffect(() => { setDBData('pos_branch_settings', branchSettings); }, [branchSettings]);
  useEffect(() => { setDBData('pos_branch_product_prices', branchProductPrices); }, [branchProductPrices]);
  useEffect(() => { setDBData('pos_branch_tables', branchTables); }, [branchTables]);
  useEffect(() => { setDBData('pos_branch_variant_prices', branchVariantPrices); }, [branchVariantPrices]);
  useEffect(() => { setCachedData(CK.PRODUCTS, products); }, [products]);
  useEffect(() => { setCachedData(CK.CUSTOMERS, customers); }, [customers]);
  useEffect(() => { setDBData(CK.REWARDS, rewards); }, [rewards]);
  useEffect(() => { setCachedData(CK.EMPLOYEES, employees); }, [employees]);
  useEffect(() => { setDBData(CK.SETTINGS, settings); }, [settings]);
  // Bills: only keep last 50 in localStorage to cap storage usage
  useEffect(() => { setCachedData(CK.BILLS, bills.slice(0, 50)); }, [bills]);
  useEffect(() => { setCachedData(CK.EXPENSES, expenses); }, [expenses]);
  useEffect(() => { setDBData(CK.RESERVATIONS, reservations); }, [reservations]);
  useEffect(() => { setDBData(CK.WAITING, waitingList); }, [waitingList]);
  useEffect(() => { setDBData(CK.FLOORS, floors); }, [floors]);
  useEffect(() => { setDBData('pos_current_employee', currentEmployee); }, [currentEmployee]);
  useEffect(() => { setDBData('pos_categories', categories); }, [categories]);
  useEffect(() => { setDBData('pos_category_colors', categoryColors); }, [categoryColors]);
  useEffect(() => { setDBData('pos_held_orders', heldOrders); }, [heldOrders]);
  useEffect(() => { try { localStorage.setItem('pos_cart_width', cartWidth.toString()); } catch {} }, [cartWidth]);
  // Persist the current workspace so a restart restores the exact previous screen.
  useEffect(() => {
    try { localStorage.setItem('pos_active_workspace', String(activeWorkspace)); } catch { /* ignore */ }
  }, [activeWorkspace]);

  // ============ DERIVED STATE ============
  const dailySales = useMemo(() => computeDailySales(bills, settings.currencySymbol), [bills, settings.currencySymbol]);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>(() => getActivityFeed());

  // ============ ROLE PERMISSIONS ============
  const rolePermissions: RolePermissions = useMemo(() => ({
    ...DEFAULT_ROLE_PERMISSIONS,
    ...(settings.rolePermissions || {}),
  }), [settings.rolePermissions]);

  const refreshDailyStats = useCallback((newBill?: Bill) => {
    const currentBills = newBill ? [newBill, ...bills] : bills;
    const feed = buildActivityFeed(currentBills, 20);
    setActivityFeed(feed);
    saveActivityFeed(feed);
  }, [bills]);

  const zReportData = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayBills = bills.filter(b => b.date === today);
    return {
      totalSales: todayBills.reduce((s, b) => s + b.grandTotal, 0),
      totalDiscounts: todayBills.reduce((s, b) => s + b.discount, 0),
      totalTax: todayBills.reduce((s, b) => s + b.gst, 0),
      orderCount: todayBills.length,
      itemCount: todayBills.reduce((s, b) => s + (b.items || []).length, 0),
      avgOrderValue: todayBills.length > 0 ? todayBills.reduce((s, b) => s + b.grandTotal, 0) / todayBills.length : 0,
      paymentMethods: todayBills.reduce<Record<string, { count: number; amount: number }>>((acc, b) => {
        const m = b.paymentMethod || 'Cash';
        if (!acc[m]) acc[m] = { count: 0, amount: 0 };
        acc[m].count++;
        acc[m].amount += b.grandTotal;
        return acc;
      }, {}),
      cashiers: todayBills.reduce<Record<string, { orders: number; revenue: number }>>((acc, b) => {
        const n = b.cashierName || 'Unknown';
        if (!acc[n]) acc[n] = { orders: 0, revenue: 0 };
        acc[n].orders++;
        acc[n].revenue += b.grandTotal;
        return acc;
      }, {}),
    };
  }, [bills]);

  // ============ RESIZE CART ============
  const startResizeCart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cartWidth;
    const doDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setCartWidth(Math.max(300, Math.min(650, startWidth - deltaX)));
    };
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  // ============ PERSIST ORDERS / TABLES / TAKEAWAYS ============
  useEffect(() => { setCachedData(CK.ORDERS, orders); }, [orders]);
  useEffect(() => { setCachedData(CK.TABLES, tables); }, [tables]);
  useEffect(() => { setCachedData(CK.TAKEAWAY, takeawayOrders); }, [takeawayOrders]);

  // Sync active order items to orders array when cart changes
  useEffect(() => {
    if (activeOrder) {
      setOrders((prev: any[]) => prev.map((o: any) =>
        o.id === activeOrder.id ? { ...o, items: cartItems, updatedAt: new Date().toISOString() } : o
      ));
    }
  }, [cartItems]);

  // ============ DERIVED FILTERED DATA ============
  const filteredBills = useMemo(() => filterByBranch(bills), [bills, shouldFilterByBranch, currentBranchId]);
  const filteredOrders = useMemo(() => filterByBranch(orders), [orders, shouldFilterByBranch, currentBranchId]);
  const filteredTables = useMemo(() => filterByBranch(tables), [tables, shouldFilterByBranch, currentBranchId]);
  const filteredExpenses = useMemo(() => filterByBranch(expenses), [expenses, shouldFilterByBranch, currentBranchId]);
  const filteredReservations = useMemo(() => filterByBranch(reservations), [reservations, shouldFilterByBranch, currentBranchId]);
  const filteredWaitingList = useMemo(() => filterByBranch(waitingList), [waitingList, shouldFilterByBranch, currentBranchId]);
  const filteredFloors = useMemo(() => filterByBranch(floors), [floors, shouldFilterByBranch, currentBranchId]);
  const filteredTakeawayOrders = useMemo(() => filterByBranch(takeawayOrders), [takeawayOrders, shouldFilterByBranch, currentBranchId]);
  const filteredProducts = useMemo(() => filterByBranch(products), [products, shouldFilterByBranch, currentBranchId]);
  const filteredEmployees = useMemo(() => filterByBranch(employees), [employees, shouldFilterByBranch, currentBranchId]);

  // ============ PER-BRANCH PRODUCT PRICES MERGE ============
  const effectiveProducts = useMemo(() => {
    return filteredProducts.map(p => {
      let updated = { ...p };
      if (currentBranchId && branchProductPrices[currentBranchId]?.[p.id] !== undefined) {
        updated.price = branchProductPrices[currentBranchId][p.id];
      }
      if (currentBranchId && branchVariantPrices[currentBranchId]?.[p.id] && p.variants && p.variants.length > 0) {
        const variantOverrides = branchVariantPrices[currentBranchId][p.id];
        updated.variants = p.variants.map(v => ({
          ...v,
          price: variantOverrides[v.name] !== undefined ? variantOverrides[v.name] : v.price,
        }));
      }
      return updated;
    });
  }, [filteredProducts, currentBranchId, branchProductPrices, branchVariantPrices]);

  // ============ PER-BRANCH TABLE LAYOUTS MERGE ============
  const effectiveTables = useMemo(() => {
    if (isMultiBranchEnabled && currentBranchId && branchTables[currentBranchId]) {
      return branchTables[currentBranchId];
    }
    return filteredTables;
  }, [isMultiBranchEnabled, currentBranchId, branchTables, filteredTables]);

  const handleSetTables = useCallback((valueOrFn: any) => {
    if (isMultiBranchEnabled && currentBranchId) {
      setTables((prevGlobal: any[]) => {
        const resolved = typeof valueOrFn === 'function' 
          ? valueOrFn(branchTables[currentBranchId] || prevGlobal)
          : valueOrFn;
        setBranchTables((prevBt: Record<string, any[]>) => ({
          ...prevBt,
          [currentBranchId]: resolved,
        }));
        return prevGlobal;
      });
    } else {
      setTables(valueOrFn);
    }
  }, [isMultiBranchEnabled, currentBranchId, branchTables, setTables, setBranchTables]);

  // ═══════════════════════════════════════════════════════════════
  // MEMOIZED RETURN VALUE
  // ═══════════════════════════════════════════════════════════════
  // Wrap in useMemo so consumers get a stable reference unless a
  // dependency they care about actually changes.  Without this,
  // every useState setter call triggers a fresh object → all
  // React.memo consumers re-render.
  // ═══════════════════════════════════════════════════════════════
  return useMemo(() => ({
    // Core data
    currentEmployee, setCurrentEmployee,
    branches, setBranches,
    currentBranchId, setCurrentBranchId,
    currentBranch,
    isHeadBranch,
    isMultiBranchEnabled,
    branchSettings, setBranchSettings,
    branchProductPrices, setBranchProductPrices,
    branchVariantPrices, setBranchVariantPrices,
    branchTables, setBranchTables,
    effectiveSettings,
    products: effectiveProducts, setProducts,
    customers, setCustomers,
    rewards, setRewards,
    employees: filteredEmployees, setEmployees,
    settings, setSettings,
    bills: filteredBills, setBills,
    expenses: filteredExpenses, setExpenses,
    reservations: filteredReservations, setReservations,
    waitingList: filteredWaitingList, setWaitingList,
    floors: filteredFloors, setFloors,
    allBills: bills,
    allOrders: orders,
    allEmployees: employees,
    allExpenses: expenses,
    categories, setCategories,
    categoryColors, setCategoryColors,

    // Order state
    tables: effectiveTables, setTables: handleSetTables,
    orders: filteredOrders, setOrders,
    takeawayOrders: filteredTakeawayOrders, setTakeawayOrders,
    heldOrders, setHeldOrders,
    activeOrder, setActiveOrder,
    isKOTOpen, setIsKOTOpen,
    kotOrder, setKotOrder,
    isKOTPreviewOpen, setIsKOTPreviewOpen,
    kotPreviewData, setKotPreviewData,
    isTimelineOpen, setIsTimelineOpen,
    timelineEvents, setTimelineEvents,

    // Billing state
    cartItems, setCartItems,
    customerPhone, setCustomerPhone,
    searchedCustomer, setSearchedCustomer,
    orderType, setOrderType,
    paymentMethod, setPaymentMethod,
    splitDetails, setSplitDetails,
    appliedReward, setAppliedReward,

    // UI state
    activeWorkspace, setActiveWorkspace,
    billingCategory, setBillingCategory,
    billingSearch, setBillingSearch,
    showFavoritesOnly, setShowFavoritesOnly,
    cartWidth, setCartWidth,
    isHeldDrawerOpen, setIsHeldDrawerOpen,
    isShortcutOpen, setIsShortcutOpen,
    isSyncPanelOpen, setIsSyncPanelOpen,
    isDailySalesOpen, setIsDailySalesOpen,
    isHistoryFeedOpen, setIsHistoryFeedOpen,
    isPaymentConfirmOpen, setIsPaymentConfirmOpen,
    isOffersPopupOpen, setIsOffersPopupOpen,
    isSplitPopupOpen, setIsSplitPopupOpen,
    isZReportOpen, setIsZReportOpen,
    isVoidReasonOpen, setIsVoidReasonOpen,
    isAddOnModalOpen, setIsAddOnModalOpen,
    isMoreBillingOpen, setIsMoreBillingOpen,
    isQuickFireActive, setIsQuickFireActive,
    quickFireInput, setQuickFireInput,
    quickFireSessionCount, setQuickFireSessionCount,
    quickFireFlash, setQuickFireFlash,
    activeReceipt, setActiveReceipt,
    previewReceipt, setPreviewReceipt,
    isLiveReceiptPreview, setIsLiveReceiptPreview,
    otpVerificationState, setOtpVerificationState,
    addOnModalProduct, setAddOnModalProduct,
    addOnModalVariant, setAddOnModalVariant,
    confirmState, setConfirmState,
    isOnboardingOpen, setIsOnboardingOpen,

    moduleSettings,
    subscriptionFeatures,
    hasInventory,
    hasAnalytics,
    hasAdvancedReports,
    syncState,
    isOnline,
    voidReasons,
    rolePermissions,

    billingSearchRef,
    loyaltyPhoneRef,
    quickFireRef,
    tourArtifactRef,

    dailySales,
    activityFeed,
    zReportData,
    refreshDailyStats,

    startResizeCart,

    // Sync
    runPullSync, refreshRewards, refreshHeldOrders, refreshWaiting, refreshFloors,
  }), [
    // Core data
    currentEmployee, branches, currentBranchId, currentBranch, isHeadBranch, isMultiBranchEnabled,
    branchSettings, branchProductPrices, branchVariantPrices, branchTables,
    effectiveSettings, effectiveProducts, setProducts,
    customers, setCustomers,
    rewards, setRewards,
    filteredEmployees, setEmployees,
    settings, setSettings,
    filteredBills, setBills,
    filteredExpenses, setExpenses,
    filteredReservations, setReservations,
    filteredWaitingList, setWaitingList,
    filteredFloors, setFloors,
    bills, orders, employees, expenses,
    categories, setCategories,
    categoryColors, setCategoryColors,

    // Order state
    effectiveTables, handleSetTables,
    filteredOrders, setOrders,
    filteredTakeawayOrders, setTakeawayOrders,
    heldOrders, setHeldOrders,
    activeOrder, setActiveOrder,
    isKOTOpen, setIsKOTOpen,
    kotOrder, setKotOrder,
    isKOTPreviewOpen, setIsKOTPreviewOpen,
    kotPreviewData, setKotPreviewData,
    isTimelineOpen, setIsTimelineOpen,
    timelineEvents, setTimelineEvents,

    // Billing state
    cartItems, setCartItems,
    customerPhone, setCustomerPhone,
    searchedCustomer, setSearchedCustomer,
    orderType, setOrderType,
    paymentMethod, setPaymentMethod,
    splitDetails, setSplitDetails,
    appliedReward, setAppliedReward,

    // UI state
    activeWorkspace, setActiveWorkspace,
    billingCategory, setBillingCategory,
    billingSearch, setBillingSearch,
    showFavoritesOnly, setShowFavoritesOnly,
    cartWidth, setCartWidth,
    isHeldDrawerOpen, setIsHeldDrawerOpen,
    isShortcutOpen, setIsShortcutOpen,
    isSyncPanelOpen, setIsSyncPanelOpen,
    isDailySalesOpen, setIsDailySalesOpen,
    isHistoryFeedOpen, setIsHistoryFeedOpen,
    isPaymentConfirmOpen, setIsPaymentConfirmOpen,
    isOffersPopupOpen, setIsOffersPopupOpen,
    isSplitPopupOpen, setIsSplitPopupOpen,
    isZReportOpen, setIsZReportOpen,
    isVoidReasonOpen, setIsVoidReasonOpen,
    isAddOnModalOpen, setIsAddOnModalOpen,
    isMoreBillingOpen, setIsMoreBillingOpen,
    isQuickFireActive, setIsQuickFireActive,
    quickFireInput, setQuickFireInput,
    quickFireSessionCount, setQuickFireSessionCount,
    quickFireFlash, setQuickFireFlash,
    activeReceipt, setActiveReceipt,
    previewReceipt, setPreviewReceipt,
    isLiveReceiptPreview, setIsLiveReceiptPreview,
    otpVerificationState, setOtpVerificationState,
    addOnModalProduct, setAddOnModalProduct,
    addOnModalVariant, setAddOnModalVariant,
    confirmState, setConfirmState,
    isOnboardingOpen, setIsOnboardingOpen,

    moduleSettings, subscriptionFeatures, hasInventory, hasAnalytics, hasAdvancedReports,
    syncState, isOnline, voidReasons, rolePermissions,

    billingSearchRef, loyaltyPhoneRef, quickFireRef, tourArtifactRef,

    dailySales, activityFeed, zReportData, refreshDailyStats, startResizeCart,

    // Sync
    runPullSync, refreshRewards, refreshHeldOrders, refreshWaiting, refreshFloors,
  ]);
}
