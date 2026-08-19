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
import { getDBData, setDBData, setCachedData, isCacheFresh, CACHE_TTL, DEFAULT_SETTINGS, computeDailySales, buildActivityFeed, getActivityFeed, saveActivityFeed, todayBusinessKey, isInBusinessDay } from '../data';
import { syncEngine } from '../lib/syncEngine';
import * as api from '../api/client';
import { mergeOrdersWithServer } from '../utils/orderMerge';
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
  'core_pos', 'table_service', 'takeaway', 'delivery', 'online_ordering',
  'qr_ordering', 'waiter_management', 'kitchen_display', 'products', 'staff',
  'discounts', 'guest_checkout', 'order_notes', 'offers', 'loyalty', 'crm',
  'reservations', 'inventory', 'expense_tracking', 'finance', 'analytics',
  'basic_reports', 'advanced_reports', 'multi_branch', 'multi_device',
  'ai', 'voice_ordering', 'offline_mode', 'customer_display', 'marketing',
  'integrations', 'api_access', 'custom_branding', 'priority_support',
];

/**
 * Maps each module toggle (Settings → Modules) to the subscription-plan
 * feature keys that enable it (OR semantics — any one unlocks the module).
 * Single source of truth shared by the POS runtime clamp (usePOSState) and
 * the Settings Modules tab (which disables toggles the plan excludes).
 */
export const MODULE_FEATURE_MAP: Record<string, string[]> = {
  enableOnlineOrders: ['online_ordering'],
  enableQROrdering: ['qr_ordering'],
  enableMenuAvailability: ['online_ordering', 'qr_ordering'],
  autoMarkSoldOutFromOrder: ['online_ordering', 'qr_ordering'],
  enableTakeawayModule: ['takeaway'],
  enableDeliveryModule: ['delivery'],
  enableTableService: ['table_service'],
  enableDineInModule: ['table_service'],
  enableWaiterManagement: ['waiter_management'],
  enableDiscountOnBilling: ['discounts'],
  enableGuestCheckout: ['guest_checkout'],
  enableOrderNotes: ['order_notes'],
  enableKitchenDisplay: ['kitchen_display'],
  enableLoyalty: ['loyalty'],
  enableReservations: ['reservations'],
  enableMultiBranch: ['multi_branch'],
  enableExpenseManagement: ['expense_tracking'],
  enableOffers: ['offers', 'marketing'],
  enableOffersPopup: ['offers', 'marketing'],
  enableProducts: ['products'],
  enableStaff: ['staff'],
  enableAISummary: ['ai'],
  enableAIInventoryHealth: ['ai'],
  enableAIPurchaseRecs: ['ai'],
  enableAILowStock: ['ai'],
  enableAIWasteAnalysis: ['ai'],
  enableAIVoiceEntry: ['ai', 'voice_ordering'],
  enableAIWeather: ['ai'],
  enableAIClosingAssistant: ['ai'],
};

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
 * STATUS RECONCILIATION (permanent fix for "all tables show Occupied"):
 * The backend is the authoritative source for lifecycle status (it runs
 * tableStateService.reconcileTable on every order/reservation change). The
 * old rule preserved ANY local non-Available status forever, so a table whose
 * order was paid/voided/cleared server-side — or whose local cache went stale
 * (e.g. offline-queue replay ghosts) — stayed Occupied indefinitely, across
 * every refresh, on every terminal.
 *
 * New rule, mirroring the backend's reconcileTable:
 *   - Manual states (Cleaning/Disabled/Merged) are always preserved.
 *   - A table bound to a LIVE local order keeps its local lifecycle status
 *     (protects the just-seated case and local-only tables the backend can't
 *     reconcile because they have no Mongo id).
 *   - Otherwise the backend status wins, so stale Occupied/Reserved/…
 *     self-heals to Available as soon as the real order is gone.
 *
 * When the server returns a NON-EMPTY list it is treated as authoritative —
 * local-only rows (deleted tables, duplicates from other restaurants, or
 * orphaned seed rows cached from an unscoped fetch) are dropped so the floor
 * plan can't accumulate ghosts. When the server returns an empty list the
 * local floor plan is kept (offline-first seeding; an occupied table is never
 * auto-freed by an empty backend status).
 */
const MANUAL_TABLE_STATUSES = ['Cleaning', 'Disabled', 'Merged'];
const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];

export function mergeTablesById(local: TableInfo[], incoming: any[], liveOrderTableIds?: Set<string>): TableInfo[] {
  const localById = new Map(local.map((t: TableInfo) => [t.id, t]));
  const merged = incoming.map((bt: any): TableInfo => {
    const localT = localById.get(bt.id);
    if (!localT) return bt as TableInfo;
    const localStatus = String(localT.status || '');
    let status = bt.status || 'Available';
    if (MANUAL_TABLE_STATUSES.includes(localStatus)) {
      status = localStatus;
    } else if (liveOrderTableIds?.has(localT.id) && localStatus && localStatus !== 'Available') {
      status = localStatus;
    }
    return {
      ...localT,
      number: bt.number ?? localT.number,
      capacity: bt.capacity ?? localT.capacity,
      section: bt.section ?? localT.section,
      status,
      branchId: bt.branchId ?? localT.branchId,
      // Carry the server-authoritative occupancy timestamp through the merge:
      // a table that already exists locally must not lose occupiedSince when
      // an online/QR order flips it to Occupied (the floor plan + table grid
      // use it to show how long the table has been seated).
      occupiedSince: bt.occupiedSince ?? localT.occupiedSince,
      // Same for the customer's ACTIVE seat session — a table held by a QR
      // scan must keep its session info (End-session button + countdown)
      // across refreshes instead of dropping it on the first merge.
      activeSession: bt.activeSession !== undefined ? bt.activeSession : (localT.activeSession ?? null),
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
 * Seed the per-branch price cache (branchId → productId → price) from the
 * server-authoritative `branchPrice` map on each product row. This is a
 * RECONCILIATION, not a merge: entries the backend no longer lists (an
 * override cleared via ProductManager on another terminal) are removed so a
 * cleared price propagates everywhere — a stale local override must never
 * keep a dine-in order priced at the old value. Products whose backend row
 * has NO `branchPrice` field at all are left untouched (their local overrides
 * may still be mid-save / offline-pending).
 */
function seedBranchProductPrices(prev: Record<string, Record<string, number>>, incoming: any[]): Record<string, Record<string, number>> {
  let next = prev;
  for (const bp of incoming) {
    const pid = bp._id || bp.id;
    const map = bp.branchPrice;
    if (!pid || map == null || typeof map !== 'object') continue;
    // 1) Drop stale local overrides for this product that the backend no
    //    longer has (handles both partial and full clears).
    for (const [branchId, localPrices] of Object.entries(next)) {
      if (localPrices[pid] === undefined) continue;
      if (map[branchId] === undefined) {
        const rest = { ...localPrices };
        delete rest[pid];
        next = { ...next, [branchId]: rest };
      }
    }
    // 2) Add/update the overrides the backend currently has.
    for (const [branchId, price] of Object.entries(map)) {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0) continue;
      if (!next[branchId] || next[branchId][pid] !== p) {
        next = { ...next, [branchId]: { ...(next[branchId] || {}), [pid]: p } };
      }
    }
  }
  return next;
}

/**
 * Seed the per-branch VARIANT price cache (branchId → productId → variantName
 * → price) from the server-authoritative `variants[].branchPrice` maps on each
 * product row. Same reconciliation contract as seedBranchProductPrices: entries
 * the backend no longer lists (a cleared override) are removed so a cleared
 * variant price propagates everywhere; products whose backend row has NO
 * `variants` array are left untouched (their local overrides may still be
 * mid-save / offline-pending).
 */
function seedBranchVariantPrices(prev: Record<string, Record<string, Record<string, number>>>, incoming: any[]): Record<string, Record<string, Record<string, number>>> {
  let next = prev;
  for (const bp of incoming) {
    const pid = bp._id || bp.id;
    if (!pid) continue;
    const variants = bp.variants;
    if (!Array.isArray(variants)) continue; // unknown state — leave local
    // Authoritative per-branch variant maps for this product.
    const authoritative: Record<string, Record<string, number>> = {};
    for (const v of variants) {
      const map = v && typeof v === 'object' ? v.branchPrice : null;
      if (!map || typeof map !== 'object') continue;
      for (const [branchId, price] of Object.entries(map)) {
        const p = Number(price);
        if (!Number.isFinite(p) || p <= 0) continue;
        if (!authoritative[branchId]) authoritative[branchId] = {};
        authoritative[branchId][v.name] = p;
      }
    }
    // Reconcile every branch that has (or should have) an entry for this
    // product: set it exactly to the authoritative map, or drop it when empty.
    const branches = new Set([
      ...Object.keys(authoritative),
      ...Object.keys(next).filter((b) => next[b] && next[b][pid] !== undefined),
    ]);
    for (const branchId of branches) {
      const target = authoritative[branchId] || {};
      const localBranch = next[branchId];
      const localMap = localBranch && localBranch[pid];
      const same =
        !!localMap &&
        Object.keys(target).length === Object.keys(localMap).length &&
        Object.keys(target).every((k) => localMap[k] === target[k]);
      if (same) continue;
      if (Object.keys(target).length === 0) {
        // Cleared — drop this product's entry for this branch.
        if (!localBranch || localBranch[pid] === undefined) continue;
        const rest = { ...localBranch };
        delete rest[pid];
        next = { ...next, [branchId]: rest };
      } else {
        next = { ...next, [branchId]: { ...(localBranch || {}), [pid]: target } };
      }
    }
  }
  return next;
}

/**
 * Merge backend menu products into the local catalog. The backend list is
 * authoritative on a successful fetch: local-only rows (ghosts from a prior
 * sync, products deleted server-side) are dropped, and local-only fields on
 * matching rows are preserved. Rows are keyed by id, then (name+category).
 */
/** Drop legacy hardcoded demo rows that a previous GuidedTour fallback may
 *  have written into the product cache. The catalog must only ever contain
 *  DB-backed menu items (Menu Availability renders these rows — a hardcoded
 *  product here would leak a fake item + fake category into the "More" page).
 */
const LEGACY_PRODUCT_PLACEHOLDER = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80';

function sanitizeProductCache(list: Product[] | null | undefined): Product[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p: any) => !String(p?.id || '').startsWith('demo_prod_'))
    // Legacy installs have the old injected stock photo baked into the offline
    // cache — treat it as "no image" so the billing grid shows the product
    // initial placeholder instead of the same unrelated photo for every item.
    .map((p: any) => (p?.image === LEGACY_PRODUCT_PLACEHOLDER ? { ...p, image: '' } : p));
}

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
      // Keep the image EMPTY when the product has none — consumers (billing
      // grid, catalog, cart) render their own placeholder. Injecting a generic
      // stock photo here made every product in billing look like the same
      // unrelated dish. The legacy placeholder URL this code used to inject is
      // treated as "no image" so cached installs stop showing the stock photo.
      image: bp.image || (localP?.image && localP.image !== LEGACY_PRODUCT_PLACEHOLDER ? localP.image : ''),
      gstPercent: bp.gstPercent ?? localP?.gstPercent ?? 0,
      availability: bp.availability ?? localP?.availability ?? true,
      favorite: bp.favorite ?? localP?.favorite,
      // Backend variants are authoritative, but an EMPTY array from a product
      // with no server variants must not clobber local-only variant definitions
      // (e.g. a product still mid-sync) — keep the local list in that case.
      variants: bp.variants && bp.variants.length ? bp.variants : (localP?.variants || []),
      branchId: bp.branchId ?? localP?.branchId,
      branchPrice: bp.branchPrice ?? localP?.branchPrice,
      // Meal combo fields (server-authoritative; the POS resolves components
      // against the current menu at add time).
      isCombo: bp.isCombo ?? localP?.isCombo ?? false,
      comboComponentIds: bp.comboComponentIds ?? localP?.comboComponentIds,
      comboPrice: bp.comboPrice ?? localP?.comboPrice,
      comboBranchPrice: bp.comboBranchPrice ?? localP?.comboBranchPrice,
      linkedComboOfferId: bp.linkedComboOfferId ?? localP?.linkedComboOfferId,
      // Reusable menu configuration refs (Phase 1/2) — server-authoritative;
      // keeps the POS grid able to route configured products to the dynamic
      // configuration modal instead of the legacy category add-on modal.
      menuConfig: bp.menuConfig ?? localP?.menuConfig,
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
  const [products, setProducts] = useState<Product[]>(() => sanitizeProductCache(getDBData<Product[]>('pos_products', [])));
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
  // Table whose billing workspace is open but whose order has NOT been created
  // yet — tapping an available table must not occupy it. The order (and the
  // Occupied state) is born lazily on the first KOT with items.
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
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
  // Server-validated offer/coupon applied to the current bill.
  // Shape: { offer: {id,title,type,value,couponCode,...}, discount: number, code?: string }
  // The discount amount is ALWAYS computed by the backend (/offers/validate).
  const [appliedOffer, setAppliedOffer] = useState<any>(null);

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
  // Last active tab inside the Orders workspace ('tables' | 'takeaway' | 'online' | 'all').
  // Lifted out of OrderManager (which unmounts when navigating to Billing) so that
  // closing an order — which redirects back to Orders — restores the EXACT tab the
  // user was on instead of resetting to the default 'tables' view.
  const [ordersActiveTab, setOrdersActiveTab] = useState<'tables' | 'takeaway' | 'online' | 'all'>(() => {
    try {
      const saved = localStorage.getItem('pos_orders_active_tab');
      if (saved && ['tables', 'takeaway', 'online', 'all'].includes(saved)) return saved as 'tables' | 'takeaway' | 'online' | 'all';
    } catch { /* ignore */ }
    return 'tables';
  });
  // Last view mode inside the Orders Tables tab ('grid' | 'floorplan'). Lifted
  // out of OrderManager (which unmounts when navigating to Billing) so closing
  // an order restores the exact table view the operator was using.
  const [ordersViewMode, setOrdersViewMode] = useState<'grid' | 'floorplan'>(() => {
    try {
      const saved = localStorage.getItem('pos_orders_view_mode');
      if (saved === 'floorplan' || saved === 'grid') return saved;
    } catch { /* ignore */ }
    return 'grid';
  });
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
  // Live snapshots of orders/tables for stable callbacks (refreshTables must
  // NOT list them in deps — the 30s poll effect re-creates its interval on
  // every dep identity change, which would double the poll cadence).
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  // ============ TABLE / TAKEAWAY REFRESH (merge, never replace) ============
  // These two collections hold frontend-only fields (table occupancy + layout,
  // takeaway status) that the backend models partially. A plain fetchAndCache
  // replace would clobber them, so refreshTables/refreshTakeaway merge server
  // rows into the current local state and persist the merged result.
  const refreshTables = useCallback(() => {
    return api.fetchTables().then((incoming: any) => {
      if (!incoming || !Array.isArray(incoming)) return;
      // Table ids bound to a live (non-terminal) local order. Tables with a
      // live order keep their local lifecycle status; every other table is
      // reconciled against the authoritative backend status so stale
      // Occupied/Reserved states self-heal on refresh. Read via refs so this
      // callback stays stable (see ordersRef comment above).
      const ordersNow = ordersRef.current;
      const liveOrderTableIds = new Set<string>();
      for (const o of ordersNow) {
        if (TERMINAL_ORDER_STATUSES.includes(o.status)) continue;
        if (o.tableId) liveOrderTableIds.add(String(o.tableId));
      }
      // Bind via table.orderId as well (mirrors the real order id after the
      // local temp id is swapped for the server _id on create success).
      for (const t of tablesRef.current) {
        if (t.orderId && ordersNow.some(o => o.id === t.orderId && !TERMINAL_ORDER_STATUSES.includes(o.status))) {
          liveOrderTableIds.add(t.id);
        }
      }
      setTables((prev: any[]) => {
        const merged = mergeTablesById(prev, incoming, liveOrderTableIds);
        setCachedData(CK.TABLES, merged);
        return merged;
      });
      // Multi-branch mode renders the grid from the per-branch cache
      // (branchTables[bid]) which is only written by local mutations and can
      // go stale — e.g. ghost/duplicate tables cached before a data cleanup.
      // Seed/HEAL every branch's cache from the authoritative backend list on
      // each successful fetch. Previously this only healed an EXISTING entry
      // and skipped the seed when nothing was cached, so a fresh device (or a
      // branch selected for the first time) showed 0 tables in multi-branch
      // mode. Seeding all branches makes switching branches instantly show
      // that branch's floor plan. No-op guard compares the MERGED result (not
      // the raw rows) so it only skips the write when the cache is truly
      // identical: equal ids AND equal reconciled status/capacity/section.
      // Comparing ids alone would miss server-side status changes — e.g.
      // another terminal seating a guest flips a table to Occupied — leaving
      // the per-branch grid stale until a local mutation. Protected statuses
      // (manual Cleaning/Disabled/Merged, tables with a live local order)
      // that mergeTablesById deliberately preserved come back identical and
      // still skip the write, so there's no churn every poll. A stale cache
      // whose ghost count coincidentally equals the healed count must still
      // be healed (ids differ → write).
      setBranchTables((prevBt: Record<string, TableInfo[]>) => {
        const byBranch = new Map<string, any[]>();
        for (const t of incoming) {
          const bid = t.branchId;
          if (!bid) continue;
          const arr = byBranch.get(bid) || [];
          arr.push(t);
          byBranch.set(bid, arr);
        }
        if (byBranch.size === 0) return prevBt;
        let next = prevBt;
        let changed = false;
        for (const [bid, rows] of byBranch) {
          const existing = next[bid];
          const healed = mergeTablesById(existing || [], rows, liveOrderTableIds);
          if (
            existing &&
            healed.length === existing.length &&
            healed.every((t, i) =>
              t.id === existing[i].id &&
              t.status === existing[i].status &&
              t.capacity === existing[i].capacity &&
              t.section === existing[i].section
            )
          ) continue;
          next = { ...next, [bid]: healed };
          changed = true;
        }
        return changed ? next : prevBt;
      });
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
      // Read path for branch pricing: mirror the server-authoritative
      // `branchPrice` map (branchId → price) into the local per-branch price
      // cache so dine-in POS orders price items exactly like the customer
      // site. Reconciliation (not merge) so cleared overrides propagate too.
      setBranchProductPrices((prev) => seedBranchProductPrices(prev, incoming));
      // Same read path for variant branch prices (variants[].branchPrice),
      // which live in a separate backend collection embedded by /products.
      setBranchVariantPrices((prev) => seedBranchVariantPrices(prev, incoming));
      setProducts((prev: Product[]) => {
        const merged = mergeProductsById(prev, incoming);
        setCachedData(CK.PRODUCTS, merged);
        return merged;
      });
    }).catch(() => undefined);
  }, [setProducts, setBranchProductPrices, setBranchVariantPrices]);

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
          // Keep the per-branch price caches in sync on full sync too.
          setBranchProductPrices((prev) => seedBranchProductPrices(prev, data.products));
          setBranchVariantPrices((prev) => seedBranchVariantPrices(prev, data.products));
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
  }, [setProducts, setCustomers, setEmployees, setBranches, setExpenses, setOrders, setBills, setBranchProductPrices, setBranchVariantPrices]);

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

  // ============ FORCE FULL REFRESH (Dashboard Refresh / auto-refresh) ============
  // The Dashboard's Refresh button and auto-refresh timer call this to re-pull
  // every collection from the backend unconditionally (bypassing TTL caches) so
  // the KPI cards and charts never show stale figures. Every fetcher is
  // offline-safe (catch → keep the local copy), so a failed refresh is a
  // silent no-op that leaves the current data on screen.
  const refreshAllFromApi = useCallback(() => {
    hydrateFromApi(true);
  }, [hydrateFromApi]);

  /** Force a server refetch of orders (Kitchen Display manual refresh). */
  const refreshOrders = useCallback(() => {
    return fetchAndCache(api.fetchOrders, setOrders as any, CK.ORDERS);
  }, []);

  // Branch switch = force a full backend re-pull (bypass the localStorage
  // cache). State is hydrated from the cache at boot, so switching branches
  // without this would render the new branch's views from stale cached rows
  // until a TTL/poll refresh. Firing refreshAllFromApi on an ACTUAL branch
  // change pulls the new branch's live orders, tables/floor plan, products
  // and prices from the backend immediately. Idempotent + offline-safe
  // (every fetcher keeps the local copy on failure).
  const currentBranchIdRef = useRef<string | null>(currentBranchId);
  const handleSetCurrentBranch = useCallback(
    (id: string | null) => {
      const prev = currentBranchIdRef.current;
      currentBranchIdRef.current = id;
      setCurrentBranchId(id);
      if (id !== prev) refreshAllFromApi();
    },
    [setCurrentBranchId, refreshAllFromApi],
  );

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
  // Orders, tables, and takeaway refresh every 30s while online.
  // Skips poll when there's an active order to avoid overwriting pending local
  // mutations. The orders merge is MONOTONIC: a snapshot fetched before an
  // in-flight KOT status PUT commits must never regress a Served KOT back to
  // Accepted (the KDS would re-show the order under New Orders). The cache is
  // still stamped with the raw server list (a same-shape, next-poll source).
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine && !activeOrder) {
        api.fetchOrders()
          .then((list: any) => {
            if (!Array.isArray(list) || list.length === 0) return;
            setOrders((prev: any[]) => mergeOrdersWithServer(prev, list));
            setCachedData(CK.ORDERS, list);
          })
          .catch(() => undefined);
        refreshTakeaway();
        refreshReservations();
        refreshWaiting();
        refreshFloors();
      }
      // Tables ALWAYS refresh while online — even when a billing workspace is
      // open. A cashier mid-bill must still see a table flip to Occupied the
      // moment a customer's QR/online order lands (the socket covers the
      // happy path; this closes the window when the socket is down). Safe by
      // design: refreshTables merges (never replaces) and mergeTablesById
      // preserves manual states + tables bound to live local orders.
      if (navigator.onLine) {
        refreshTables();
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
  //
  // STRICT gating: the subscription plan is the hard gate for EVERY role —
  // the Owner included. A module stays ON only while at least one of its
  // enabling plan features is present AND the saved toggle is ON. Before the
  // plan has loaded (fresh device / offline) nothing is clamped so the UI
  // never flashes empty; once features arrive the toggles settle to the plan.
  const moduleSettings = useMemo(() => {
    const saved = settings.moduleSettings || {};

    // Built-in defaults: most modules ON by default. Add-on modules
    // (reservations / multi-branch / expenses / loyalty) default ON so a fresh
    // restaurant never loses an included feature — but an explicit saved value
    // overrides the default either way (ON or OFF).
    const userSettings: Record<string, boolean> = {
      enableTableService: true, enableWaiterManagement: true, enableReservations: true,
      enableQROrdering: true, enableDeliveryModule: true, enableOnlineOrders: true,
      enableKitchenDisplay: true, enableLoyalty: true, showImagesInBilling: true,
      enableOffersPopup: true, enableAutoPrintKOT: false, enableQuickSoundAlerts: true,
      showItemCodeOnCard: false, enableGuestCheckout: true, enableOrderNotes: true,
      enableTakeawayModule: true, enableDineInModule: true, enableExpenseManagement: true,
      enableDiscountOnBilling: false, enableMultiBranch: true,
      enableProducts: true, enableStaff: true, enableOffers: true,
      // ─── Online Ordering ─────────────────────────────────
      autoMarkSoldOutFromOrder: false, enableMenuAvailability: true,
      // ─── AI Feature Toggles ──────────────────────────────
      enableAISummary: true,
      enableAIInventoryHealth: true,
      enableAIPurchaseRecs: true,
      enableAILowStock: true,
      enableAIWasteAnalysis: true,
      enableAIVoiceEntry: true,
      enableAIWeather: true,
      enableAIClosingAssistant: true,
      ...saved,
    };

    // ─── STRICT PLAN ENFORCEMENT (all roles, Owner included) ──
    // The subscription plan is the hard gate: any feature NOT included in the
    // plan forces its module toggles OFF for every role. A module stays ON only
    // when at least one of its enabling features is present (OR semantics), so
    // e.g. Menu Availability stays available when EITHER online_ordering OR
    // qr_ordering is in the plan. When no plan info has loaded yet (fresh
    // device, offline), nothing is clamped so the UI never flashes empty.
    if (subscriptionFeatures.length > 0) {
      const planHas = (f: string) => subscriptionFeatures.includes(f);
      Object.entries(MODULE_FEATURE_MAP).forEach(([moduleKey, enablingFeatures]) => {
        if (!enablingFeatures.some((f) => planHas(f))) {
          (userSettings as Record<string, boolean>)[moduleKey] = false;
        }
      });
    }

    return userSettings;
  }, [settings.moduleSettings, subscriptionFeatures, currentEmployee]);

  // ============ DERIVED PLAN-AWARE FLAGS ============
  // Strict plan gating for every role — a feature not in the plan is disabled
  // for the Owner too (the plan the Owner selected is the hard gate).
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

  // Auto-select a valid branch when the stored currentBranchId is stale — e.g.
  // the legacy single-branch default 'branch_main' (which matches no real
  // branch ObjectId) or a branch deleted server-side. Without this,
  // multi-branch filtering zeroes every collection (tables, products, orders,
  // bills) because no row carries 'branch_main', so the Orders grid and other
  // sections appear empty until the user manually picks a branch. Prefer the
  // head branch (matches BranchManager's delete fallback); otherwise the first
  // branch. Never overrides an explicit, still-valid selection.
  useEffect(() => {
    if (branches.length === 0) return;
    if (branches.some((b) => b.id === currentBranchId)) return;
    const head = branches.find((b) => b.isHeadBranch) || branches[0];
    if (head) handleSetCurrentBranch(head.id);
  }, [branches, currentBranchId, handleSetCurrentBranch]);

  // ============ PER-BRANCH SETTINGS MERGE ============
  const effectiveSettings = useMemo<SystemSettings>(() => {
    if (!isMultiBranchEnabled || !currentBranchId || !branchSettings[currentBranchId]) {
      return settings;
    }
    return { ...settings, ...branchSettings[currentBranchId] };
  }, [settings, branchSettings, currentBranchId, isMultiBranchEnabled]);

  // ============ SYNC ============
  const [syncState, setSyncState] = useState(() => syncEngine.getSyncState());
  // Phase 5 — live view of the persisted offline queue so the Sync panel can
  // surface stalled (max-retry) operations for manual Retry/Clear.
  const [syncOperations, setSyncOperations] = useState<ReadonlyArray<import('../lib/syncEngine').PendingOperation>>(() => syncEngine.getQueue());
  // Derive isOnline from syncState to avoid double re-renders on online/offline events.
  // syncState.online and setIsOnline were previously two separate state variables
  // that both updated on the same event, causing 2 re-renders per transition.
  const isOnline = syncState.online;

  const retrySyncOperation = useCallback((id: string) => {
    syncEngine.retryNow(id);
    setSyncOperations(syncEngine.getQueue());
    // Replay immediately so the operator sees the result right away.
    syncEngine.replayQueue(api.executePendingOperation).catch(() => {});
  }, []);

  const clearSyncOperation = useCallback((id: string) => {
    syncEngine.clearOperation(id);
    setSyncOperations(syncEngine.getQueue());
  }, []);

  useEffect(() => {
    // Sync the engine with the browser's actual network state on mount.
    // navigator.onLine can be false when the page loads while already offline
    // (the 'offline' event only fires on *transitions*, not on initial state).
    if (!navigator.onLine) syncEngine.setOnline(false);

    const goOnline = () => syncEngine.setOnline(true);
    const goOffline = () => syncEngine.setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // ─── Active backend connectivity probe ────────────────────────
  // navigator.onLine is unreliable — it reports true when connected to WiFi
  // without internet access (common on POS terminals). Periodically ping the
  // backend to derive the real online state. A failed probe transitions to
  // offline; a successful probe transitions back to online.
  useEffect(() => {
    let mounted = true;
    const PROBE_INTERVAL_MS = 15_000;
    const probe = async () => {
      if (!mounted) return;
      try {
        const res = await fetch('/api/health', { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
        if (mounted && res.ok && !syncEngine.getSyncState().online) {
          syncEngine.setOnline(true);
        }
      } catch {
        if (mounted && navigator.onLine && syncEngine.getSyncState().online) {
          syncEngine.setOnline(false);
        }
      }
    };
    probe(); // immediate check on mount
    const id = setInterval(probe, PROBE_INTERVAL_MS);
    return () => { mounted = false; clearInterval(id); };
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
        setSyncOperations(syncEngine.getQueue());
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
          if (staleKeys.includes(CK.REWARDS)) refreshRewards();
          if (staleKeys.includes('pos_held_orders')) refreshHeldOrders();
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
  // The backend (RestaurantSettings) is the source of truth. Fetch the
  // effective settings and merge server-known keys over the local snapshot.
  // Local-only keys are preserved for backward compatibility until the next
  // save pushes them to the server. Exposed as a callback so it also runs
  // after resetSessionData() (restaurant switch) — otherwise the new tenant's
  // real settings would never load and DEFAULT_SETTINGS would stick.
  const refreshServerSettings = useCallback(async () => {
    const effective = await api.fetchEffectiveSettings(currentBranchId || undefined, undefined);
    if (!effective || !effective.settings) return;
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
  }, [currentBranchId, setSettings]);

  // On mount and on reconnect, pull the effective settings from the backend.
  useEffect(() => {
    let cancelled = false;
    const loadServerSettings = async () => {
      const effective = await api.fetchEffectiveSettings(currentBranchId || undefined, undefined);
      if (cancelled || !effective || !effective.settings) return;
      const server = effective.settings;
      setSettings((prev) => {
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
  // Bills: cache up to 500 for offline history/dashboard — the previous cap
  // of 50 meant a reload while the cache was fresh showed an incomplete ledger.
  useEffect(() => { setCachedData(CK.BILLS, bills.slice(0, 500)); }, [bills]);
  useEffect(() => { setCachedData(CK.EXPENSES, expenses); }, [expenses]);
  // Orders/takeaway: persist so an offline reload never loses recently
  // created/updated orders, but with a TRAILING DEBOUNCE — order state mutates
  // on nearly every interaction (add item, KOT, status), and a synchronous
  // JSON.stringify of hundreds of orders on every change would jank the main
  // thread. The write fires ~2s after the last change; the 30s poll keeps the
  // authoritative server list in sync regardless.
  useEffect(() => {
    const timer = setTimeout(() => {
      setCachedData(CK.ORDERS, orders.slice(0, 300));
      setCachedData(CK.TAKEAWAY, takeawayOrders.slice(0, 300));
    }, 2000);
    return () => clearTimeout(timer);
  }, [orders, takeawayOrders]);
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
  // Persist the last Orders tab so returning to Orders (e.g. after closing an
  // order) restores the same sub-view the operator was working in.
  useEffect(() => {
    try { localStorage.setItem('pos_orders_active_tab', ordersActiveTab); } catch { /* ignore */ }
  }, [ordersActiveTab]);
  // Persist the last Orders view mode (grid vs floor plan) the same way.
  useEffect(() => {
    try { localStorage.setItem('pos_orders_view_mode', ordersViewMode); } catch { /* ignore */ }
  }, [ordersViewMode]);

  // ============ DERIVED STATE ============
  const dailySales = useMemo(() => computeDailySales(bills, settings.currencySymbol, settings.openingTime), [bills, settings.currencySymbol, settings.openingTime]);
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

  // Rebuild the activity feed whenever bills change (e.g. after restaurant
  // switch or API fetch). This ensures the feed always reflects the CURRENT
  // restaurant's data, not a stale in-memory state from the previous tenant.
  useEffect(() => {
    const feed = buildActivityFeed(bills, 20);
    setActivityFeed(feed);
    saveActivityFeed(feed);
  }, [bills]);

  const zReportData = useMemo(() => {
    const today = todayBusinessKey(settings.openingTime);
    const todayBills = bills.filter(b => isInBusinessDay(b, today, settings.openingTime));
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
      // Meal-combo pricing: a combo's sell price IS its comboPrice — derive
      // the tile price from it everywhere, applying the per-branch override
      // when present (the backing offer carries comboBranchPrices so the
      // server resolves the same number at billing).
      if (p.isCombo) {
        let combo = Number(p.comboPrice) || 0;
        if (currentBranchId) {
          const branchCombo = (p as any).comboBranchPrice?.[currentBranchId];
          if (branchCombo !== undefined && Number(branchCombo) > 0) combo = Number(branchCombo);
        }
        updated.comboPrice = combo;
        updated.price = combo;
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
  // SESSION RESET — called when the LOGGED-IN RESTAURANT changes
  // ═══════════════════════════════════════════════════════════════
  // The hook lives at App level and does NOT remount between logins, so every
  // collection below would otherwise keep the PREVIOUS restaurant's data in
  // memory (and re-persist it to localStorage via the persist effects below).
  // Clearing all in-memory state here — right before the employee-change
  // effect fires hydrateFromApi(true) — guarantees a device switching
  // restaurants never renders or re-caches the previous tenant's data.
  const resetSessionData = useCallback(() => {
    // Branch state
    setBranches([]);
    setCurrentBranchId('branch_main');
    setBranchSettings({});
    setBranchProductPrices({});
    setBranchTables({});
    setBranchVariantPrices({});
    // Core data
    setProducts([]);
    setCustomers([]);
    setRewards([]);
    setEmployees([]);
    setSettings(DEFAULT_SETTINGS);
    setBills([]);
    setExpenses([]);
    setReservations([]);
    setWaitingList([]);
    setFloors([]);
    setCategories([]);
    setCategoryColors({});
    // Order state
    setTables([]);
    setOrders([]);
    setTakeawayOrders([]);
    setHeldOrders([]);
    setActiveOrder(null);
    setPendingTableId(null);
    // Billing state
    setCartItems([]);
    setCustomerPhone('');
    // Activity feed — must be cleared on restaurant switch so the previous
    // tenant's transaction history never appears in the new tenant's feed.
    setActivityFeed([]);
    setSearchedCustomer(null);
    setAppliedReward(null);
    setAppliedOffer(null);
    // Pull the NEW restaurant's real settings (resetSessionData sets
    // DEFAULT_SETTINGS; without this the merged settings would never load and
    // the dashboard/settings would show empty defaults until a reconnect).
    void refreshServerSettings();
  }, [
    setBranches, setCurrentBranchId, setBranchSettings, setBranchProductPrices, setBranchTables, setBranchVariantPrices,
    setProducts, setCustomers, setRewards, setEmployees, setSettings, setBills, setExpenses,
    setReservations, setWaitingList, setFloors, setCategories, setCategoryColors,
    setTables, setOrders, setTakeawayOrders, setHeldOrders, setActiveOrder, setPendingTableId,
    setCartItems, setCustomerPhone, setSearchedCustomer, setAppliedReward, setAppliedOffer,
    refreshServerSettings,
  ]);

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
    currentBranchId, setCurrentBranchId: handleSetCurrentBranch,
    currentBranch,
    isHeadBranch,
    isMultiBranchEnabled,
    shouldFilterByBranch,
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
    pendingTableId, setPendingTableId,
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
    appliedOffer, setAppliedOffer,

    // UI state
    activeWorkspace, setActiveWorkspace,
    billingCategory, setBillingCategory,
    billingSearch, setBillingSearch,
    showFavoritesOnly, setShowFavoritesOnly,
    ordersActiveTab, setOrdersActiveTab,
    ordersViewMode, setOrdersViewMode,
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
    syncOperations,
    retrySyncOperation,
    clearSyncOperation,
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
    refreshAllFromApi,
    refreshOrders,
    refreshProducts,

    startResizeCart,

    // Sync
    runPullSync, refreshRewards, refreshHeldOrders, refreshWaiting, refreshFloors, refreshTables,
    resetSessionData,
  }), [
    // Core data
    currentEmployee, branches, currentBranchId, currentBranch, isHeadBranch, isMultiBranchEnabled, shouldFilterByBranch,
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
    pendingTableId, setPendingTableId,
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
    appliedOffer, setAppliedOffer,

    // UI state
    activeWorkspace, setActiveWorkspace,
    billingCategory, setBillingCategory,
    billingSearch, setBillingSearch,
    showFavoritesOnly, setShowFavoritesOnly,
    ordersActiveTab, setOrdersActiveTab,
    ordersViewMode, setOrdersViewMode,
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
    syncState, syncOperations, retrySyncOperation, clearSyncOperation, isOnline, voidReasons, rolePermissions,

    billingSearchRef, loyaltyPhoneRef, quickFireRef, tourArtifactRef,

    dailySales, activityFeed, zReportData, refreshDailyStats, refreshAllFromApi, refreshOrders, startResizeCart,

    // Sync
    runPullSync, refreshRewards, refreshHeldOrders, refreshWaiting, refreshFloors, refreshTables,
    resetSessionData,
  ]);
}
