/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ================================================================
 * DATA ARCHITECTURE — CLOUD vs LOCAL STORAGE STRATEGY
 * ================================================================
 *
 * Cloud-side data (stored on backend server / API):
 *   → Products, Customers, Employees, Settings, Rewards, Branches
 *   → Bills, Orders, Expenses, Reservations, Waiting List
 *   → These are THE SOURCE OF TRUTH. The backend API (routes in
 *     /backend/src/routes/*) handles all CRUD for these.
 *
 * Local-first data (stored in localStorage, synced periodically):
 *   → Cart items, active order, modal states — ephemeral session state
 *   → Category colors, cart width — pure UI preferences
 *   → Current employee session, held orders — local-only for offline use
 *
 * Hybrid — local cache with cloud sync:
 *   → Products: The menu is downloaded once per session and cached locally.
 *     For single-branch setups, the full menu can live entirely in
 *     localStorage after initial fetch. Multi-branch fetches per branch.
 *   → Bills: Written to cloud on checkout; cached locally for offline
 *     fallback and quick dashboard stats.
 *
 * When the backend is fully connected:
 *   1. All useState initializers should call BACKEND APIs instead of
 *      localStorage (e.g., fetch('/api/products') instead of getDBData).
 *   2. All setDBData calls should POST/PUT changes to the backend.
 *   3. localStorage remains a write-through cache for resilience.
 *   4. SyncEngine (src/lib/syncEngine.ts) handles queue + retry.
 *
 * The // BACKEND: comments below mark every site that needs to be
 * converted from localStorage to API calls.
 *
 * SEED DATA: Default products, customers, employees, and rewards are now
 * seeded by the Backend MongoDB seed script (Backend/src/seed.ts) on first
 * database connection. The frontend initializes localStorage from the
 * backend API on first load.
 * ================================================================
 */

import { Product, Customer, LoyaltyReward, Employee, SystemSettings, Bill, VisitMilestone, CartItem, DailySales, ActivityEntry, ExpenseEntry, Reservation, WaitingEntry, Branch, TableInfo } from './types';

// ============================================================
// FALLBACK DEFAULTS — Minimal safe values for UI rendering
// All real data is fetched from the backend API on startup.
// ============================================================

/** Fallback system settings (empty defaults — real data comes from API) */
export const DEFAULT_SETTINGS: SystemSettings = {
  restaurantName: '',
  gstin: '',
  address: '',
  phone: '',
  currency: 'INR',
  currencySymbol: '₹',
  defaultTaxRate: 0,
  loyaltyPointsPerDollar: 0,
  pointsNeededForOneUnitCurrency: 0,
  visitThresholdForBonus: 0,
  bonusPointsPerVisit: 0,
  printSize: '80mm',
  brandingColor: '#004ac6',
  autoPrintReceipt: false,
  otpSimulationEnabled: true,
  visitMilestones: [],
  invoicePrefix: 'INV',
  invoiceStartingNumber: 1001,
  receiptFooterMessage: '',
  // Business day starts at 08:00 local and closes at 23:59 by default —
  // everything before 08:00 belongs to the previous business day.
  openingTime: '08:00',
  closingTime: '23:59',
};

// ============================================================
// UTILITY FUNCTIONS — localStorage helpers and data computations
// ============================================================

/** Safe localStorage wrapper with JSON parsing and error handling */
export function safeStorage() {
  return {
    getItem(key: string): string | null {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem(key: string, value: string): void {
      try { localStorage.setItem(key, value); } catch { /* quota exceeded */ }
    },
    removeItem(key: string): void {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

/** Get strongly-typed data from localStorage */
export function getDBData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch (err) {
    // Corruption detected — log warning and return fallback
    console.warn('[DB] Corrupted localStorage entry for key "' + key + '":', err instanceof Error ? err.message : String(err));
    // Remove corrupted data to prevent repeated failures
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

/** Set strongly-typed data to localStorage */
export function setDBData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage quota exceeded or unavailable
  }
}

// ============================================================
// CACHE MANAGEMENT — TTL-based caching for API-synced data
// ============================================================
// Uses a separate meta key (pos_cache_meta) to store timestamps
// for each cached data key. If the timestamp is missing or
// expired, the data is considered stale and re-fetched from API.

const CACHE_META_KEY = 'pos_cache_meta';

function getCacheMeta(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CACHE_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setCacheMeta(meta: Record<string, number>): void {
  try { localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta)); } catch { /* quota */ }
}

/** Default TTLs for different data categories (in milliseconds) */
export const CACHE_TTL = {
  // 1 hour — products, employees, branches, settings, rewards. Kept short so a
  // change made on another terminal/restart is picked up within the hour
  // instead of lingering for a day (writes already trigger an immediate
  // refresh on the terminal that made them via syncEngine.markStale).
  SLOW: 60 * 60 * 1000,
  MEDIUM: 5 * 60 * 1000,            // 5 minutes — customers, expenses
  FAST: 30 * 1000,                  // 30 seconds — orders, tables, takeaway
  LIVE: 10 * 1000,                  // 10 seconds — reservations, waiting list
} as const;

/** Check if cached data for a key is still within its TTL */
export function isCacheFresh(key: string, maxAgeMs: number): boolean {
  try {
    const meta = getCacheMeta();
    const cachedAt = meta[key];
    return !!cachedAt && (Date.now() - cachedAt) < maxAgeMs;
  } catch {
    return false;
  }
}

/** Get data from localStorage if cache is fresh, otherwise return fallback (triggers re-fetch) */
export function getCachedData<T>(key: string, fallback: T, maxAgeMs: number): T {
  if (isCacheFresh(key, maxAgeMs)) {
    return getDBData(key, fallback);
  }
  return fallback;
}

/** Save data to localStorage and record the current timestamp */
export function setCachedData<T>(key: string, data: T): void {
  setDBData(key, data);
  try {
    const meta = getCacheMeta();
    meta[key] = Date.now();
    setCacheMeta(meta);
  } catch { /* quota */ }
}

/** Mark a cache key as stale — next getCachedData will return fallback */
export function invalidateCache(key: string): void {
  try {
    const meta = getCacheMeta();
    delete meta[key];
    setCacheMeta(meta);
  } catch { /* ignore */ }
}

/**
 * Session/auth/device keys that must survive a cache wipe. These identify the
 * CURRENT login (tokens + current employee), the device itself, or the cache
 * schema migration marker — they are NOT restaurant data and must never be
 * dropped when switching restaurants on the same device.
 */
const SESSION_PRESERVED_KEYS = new Set([
  'pos_access_token',
  'pos_auth_token',
  'pos_refresh_token',
  'pos_session_mode',
  'pos_current_employee',
  'pos_device_id',
  'pos_cache_schema_version',
  'pos_saved_accounts', // persisted across logout/switch for fast re-login
]);

/**
 * Remove ALL cached restaurant data from localStorage — data rows AND their
 * TTL stamps — so a device switching restaurants can never hydrate the new
 * restaurant's screens (bills, orders, menu, employees, tables, settings,
 * sync queue, report caches) from the previous restaurant's cache.
 *
 * Session/auth/device keys are preserved (see SESSION_PRESERVED_KEYS): the
 * caller has just written the fresh tokens + current employee, and the device
 * id must survive restarts. Call this when the LOGGED-IN RESTAURANT changes
 * (and on logout).
 */
export function clearAllCache(): void {
  try {
    const doomed: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pos_') && !SESSION_PRESERVED_KEYS.has(key)) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ============================================================
// ONE-TIME CACHE SCHEMA MIGRATION
// ============================================================
// The menu catalog (+ per-branch price and variant maps) is cached in
// localStorage for offline-first UX. When the product/variant data SHAPE
// changes — or a stale/incorrect menu was cached by an older build — the old
// rows must not keep rendering (e.g. Menu Availability showing wrong
// products/variants instead of the restaurant's real MongoDB menu).
//
// On the FIRST launch after this counter is bumped, the product-family keys
// are purged (data + TTL stamps) exactly once, forcing a fresh fetch from the
// backend DB. On the second launch the version matches and normal caching
// resumes. This runs at import time — BEFORE any useState initializer reads
// the cached catalog — so the app can never hydrate from soon-deleted rows.
const CACHE_SCHEMA_VERSION = 'products_variants_v2';
const CACHE_VERSION_KEY = 'pos_cache_schema_version';

// Product-family cache keys that must be re-pulled when the schema changes.
const SCHEMA_MIGRATED_KEYS = [
  'pos_products',                       // menu catalog (+ embedded variants)
  'pos_branch_product_prices',          // branchId → productId → price
  'pos_branch_variant_prices',          // branchId → productId → variant → price
];

function runCacheSchemaMigration(): void {
  try {
    if (localStorage.getItem(CACHE_VERSION_KEY) === CACHE_SCHEMA_VERSION) return;
    const meta = getCacheMeta();
    for (const key of SCHEMA_MIGRATED_KEYS) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      delete meta[key];
    }
    setCacheMeta(meta);
    try { localStorage.setItem(CACHE_VERSION_KEY, CACHE_SCHEMA_VERSION); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.info('[DB] Cache schema migration — product/variant caches cleared (one-time).');
  } catch { /* ignore */ }
}

runCacheSchemaMigration();

/** 
 * Compute a DailySales object from an array of bills.
 * Used by Dashboard and Reports for KPI aggregation.
 */
/** Local calendar date (YYYY-MM-DD) for a given instant. Bills and daily
 *  summaries must use the restaurant's LOCAL day, not UTC: in IST (UTC+5:30)
 *  the UTC date lags the local date between midnight and 05:29, so a
 *  UTC-based "today" would label early-morning sales as yesterday. */
export function localDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD calendar date by N days (pure calendar math, TZ-safe). */
export function shiftDateKey(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The BUSINESS day a bill belongs to. The business day runs from opening time
 * (HH:mm, e.g. 08:00) until the next day's opening time — a bill stamped at
 * 03:00 belongs to the PREVIOUS calendar day's business day, not "today".
 * Returns the YYYY-MM-DD of the business day's start date.
 */
export function businessDateKey(dateStr: string, timeStr: string | undefined, openingTime?: string): string {
  const t = (timeStr || '00:00').slice(0, 5);
  const open = (openingTime || '08:00').slice(0, 5);
  if (t < open) return shiftDateKey(dateStr, -1);
  return dateStr;
}

/** The business day currently in progress (YYYY-MM-DD of its start date). */
export function todayBusinessKey(openingTime?: string): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return businessDateKey(localDateKey(now), timeStr, openingTime);
}

/** True when a bill falls inside the given business-day start date. */
export function isInBusinessDay(b: Bill, businessDayStart: string, openingTime?: string): boolean {
  return businessDateKey(b.date, b.time, openingTime) === businessDayStart;
}

export function computeDailySales(bills: Bill[], currencySymbol: string, openingTime?: string): DailySales {
  const today = todayBusinessKey(openingTime);
  const todayBills = bills.filter(b => isInBusinessDay(b, today, openingTime));

  const totalRevenue = todayBills.reduce((s, b) => s + b.grandTotal, 0);
  const totalOrders = todayBills.length;
  // Count items by QUANTITY (not just line-item count) — a bill with 3 lines
  // of qty 2 each has 6 items sold, not 3. When items array is empty (API-fetched
  // bills where BillItem join failed), fall back to 0 and let the backend summary
  // endpoint provide the authoritative count.
  const totalItemsSold = todayBills.reduce((s, b) => {
    const items = b.items || [];
    if (items.length === 0) return s; // empty items — backend summary is authoritative
    return s + items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }, 0);
  const totalDiscount = todayBills.reduce((s, b) => s + b.discount, 0);
  const totalGst = todayBills.reduce((s, b) => s + b.gst, 0);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  // Data integrity flag: revenue exists but no items could be counted locally.
  // The dashboard uses the backend summary's itemsSold as the authoritative
  // source when this happens.
  const itemsSoldFromBackend = totalRevenue > 0 && totalItemsSold === 0;

  // Payment method breakdown
  const paymentMap = new Map<string, { amount: number; count: number }>();
  for (const bill of todayBills) {
    const pm = bill.paymentMethod || 'Cash';
    const entry = paymentMap.get(pm) || { amount: 0, count: 0 };
    entry.amount += bill.grandTotal;
    entry.count++;
    paymentMap.set(pm, entry);
  }
  const paymentBreakdown = Array.from(paymentMap.entries()).map(([method, v]) => ({
    method, amount: v.amount, count: v.count,
  }));

  // Category breakdown from bill items
  const catMap = new Map<string, { qty: number; revenue: number }>();
  for (const bill of todayBills) {
    for (const item of (bill.items || [])) {
      const cat = item.product?.category || 'General';
      const entry = catMap.get(cat) || { qty: 0, revenue: 0 };
      entry.qty += item.quantity;
      entry.revenue += item.price * item.quantity;
      catMap.set(cat, entry);
    }
  }
  const categoryBreakdown = Array.from(catMap.entries()).map(([category, v]) => ({
    category, qty: v.qty, revenue: v.revenue,
  }));

  // Top items by quantity sold
  const itemMap = new Map<string, { qty: number; revenue: number }>();
  for (const bill of todayBills) {
    for (const item of (bill.items || [])) {
      const name = item.product?.name || item.product?.code || 'Unknown';
      const entry = itemMap.get(name) || { qty: 0, revenue: 0 };
      entry.qty += item.quantity;
      entry.revenue += item.price * item.quantity;
      itemMap.set(name, entry);
    }
  }
  const topItems = Array.from(itemMap.entries())
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // Cashier performance
  const cashierMap = new Map<string, { orders: number; revenue: number }>();
  for (const bill of todayBills) {
    const name = bill.cashierName || 'Unknown';
    const entry = cashierMap.get(name) || { orders: 0, revenue: 0 };
    entry.orders++;
    entry.revenue += bill.grandTotal;
    cashierMap.set(name, entry);
  }
  const cashierPerformance = Array.from(cashierMap.entries())
    .map(([name, v]) => ({ name, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    date: today,
    totalRevenue,
    totalOrders,
    totalItemsSold,
    totalDiscount,
    totalGst,
    averageOrderValue,
    paymentBreakdown,
    categoryBreakdown,
    topItems,
    cashierPerformance,
  };
}

/** Build an activity feed from bills (newest first) */
export function buildActivityFeed(bills: Bill[], maxEntries: number = 20): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const bill of bills.slice(0, maxEntries)) {
    entries.push({
      id: `act_${bill.id}`,
      timestamp: `${bill.date}T${bill.time || '00:00'}`,
      type: 'payment',
      title: `Payment of ${bill.grandTotal}`,
      description: `${bill.paymentMethod} — ${bill.orderType || 'Dine In'}`,  
      amount: bill.grandTotal,
      currencySymbol: '₹',
      invoiceNumber: bill.invoiceNumber,
      cashierName: bill.cashierName,
      paymentMethod: bill.paymentMethod,
    });
  }
  return entries;
}

const ACTIVITY_FEED_KEY = 'pos_activity_feed';

/** Get activity feed from localStorage */
export function getActivityFeed(): ActivityEntry[] {
  return getDBData<ActivityEntry[]>(ACTIVITY_FEED_KEY, []);
}

/** Save activity feed to localStorage */
export function saveActivityFeed(feed: ActivityEntry[]): void {
  setDBData(ACTIVITY_FEED_KEY, feed);
}

// initializeDB() removed — all data is fetched from the backend API on startup.
// localStorage is used as a write-through cache, not a seed source.
