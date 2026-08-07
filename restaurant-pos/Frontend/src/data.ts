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
  SLOW: 24 * 60 * 60 * 1000,       // 24 hours — products, employees, branches, settings, rewards
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

/** Remove all cache timestamps (forces full re-fetch on next load) */
export function clearAllCache(): void {
  try { localStorage.removeItem(CACHE_META_KEY); } catch { /* ignore */ }
}

/** 
 * Compute a DailySales object from an array of bills.
 * Used by Dashboard and Reports for KPI aggregation.
 */
export function computeDailySales(bills: Bill[], currencySymbol: string): DailySales {
  const today = new Date().toISOString().split('T')[0];
  const todayBills = bills.filter(b => b.date === today);

  const totalRevenue = todayBills.reduce((s, b) => s + b.grandTotal, 0);
  const totalOrders = todayBills.length;
  const totalItemsSold = todayBills.reduce((s, b) => s + (b.items || []).length, 0);
  const totalDiscount = todayBills.reduce((s, b) => s + b.discount, 0);
  const totalGst = todayBills.reduce((s, b) => s + b.gst, 0);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
  const cashierPerformance = Array.from(cashierMap.entries()).map(([name, v]) => ({
    name, orders: v.orders, revenue: v.revenue,
  }));

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
