/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized API Client — all backend calls go through here.
 * Each function is marked with "// BACKEND CALLED — <reason>" so
 * you can quickly find every place the frontend talks to the server.
 *
 * Architecture:
 * - Every fetch() call has a .catch() fallback to null / empty array
 *   so the app doesn't crash when the backend is offline.
 * - The sync engine (src/lib/syncEngine.ts) queues failed writes
 *   and replays them when connectivity returns.
 * - localStorage remains the source of truth for offline mode.
 */

const BASE = '/api';

import { debugWarn } from '../utils/debugLog';
import { getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './axios';
import { syncEngine } from '../lib/syncEngine';
import { getDBData } from '../data';

// ─── Auth token (JWT) — synced with Axios instance ──────────────
let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
  setAccessToken(token);
}

export function getAuthToken(): string | null {
  return _authToken;
}

// Init sync from localStorage (support both old and new keys)
const storedToken = localStorage.getItem('pos_access_token') || localStorage.getItem('pos_auth_token');
if (storedToken) {
  _authToken = storedToken;
  setAccessToken(storedToken);
  localStorage.setItem('pos_access_token', storedToken);
}
const storedRefreshToken = localStorage.getItem('pos_refresh_token');
if (storedRefreshToken) {
  setRefreshToken(storedRefreshToken);
}

// ─── Global error callback for user-facing notifications ───────────
let _onApiError: ((method: string, path: string, status: number | null) => void) | null = null;

/**
 * Register a callback that fires on API errors so the UI can show toasts.
 * Set from App.tsx during initialization.
 */
export function setOnApiError(handler: ((method: string, path: string, status: number | null) => void) | null) {
  _onApiError = handler;
}

/**
 * Build headers for an API request, including auth token if available.
 * Phase 1.10: a stable per-terminal device id is attached so the backend's
 * request logger + audit trail can attribute mutations to a specific device.
 */
let _deviceId: string | null = null;
function getOrCreateDeviceId(): string {
  if (_deviceId) return _deviceId;
  let id = localStorage.getItem('pos_device_id');
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    try { localStorage.setItem('pos_device_id', id); } catch { /* storage full */ }
  }
  _deviceId = id;
  return id;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getOrCreateDeviceId(),
    ...extra,
  };
  if (_authToken) {
    headers['Authorization'] = `Bearer ${_authToken}`;
  }
  return headers;
}

// ─── Token refresh (401 self-healing) ───────────────────────────

let _isRefreshingToken = false;
let _refreshTokenWaiters: Array<(ok: boolean) => void> = [];
let _lastRefreshResult = false;

/**
 * Refresh the access token using the stored refresh token.
 * Returns true when a fresh access token is available.
 * Concurrent callers share a single in-flight refresh.
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken =
    localStorage.getItem('pos_refresh_token') || getRefreshToken();
  if (!refreshToken) return false;

  if (_isRefreshingToken) {
    return new Promise<boolean>((resolve) => _refreshTokenWaiters.push(resolve));
  }

  _isRefreshingToken = true;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      _lastRefreshResult = false;
      return false;
    }
    const json = await res.json();
    const newAccess = json.accessToken;
    const newRefresh = json.refreshToken;
    if (!newAccess) {
      _lastRefreshResult = false;
      return false;
    }
    setAuthToken(newAccess);
    setRefreshToken(newRefresh);
    localStorage.setItem('pos_access_token', newAccess);
    localStorage.setItem('pos_auth_token', newAccess);
    if (newRefresh) {
      localStorage.setItem('pos_refresh_token', newRefresh);
    }
    _lastRefreshResult = true;
    return true;
  } catch {
    _lastRefreshResult = false;
    return false;
  } finally {
    _isRefreshingToken = false;
    _refreshTokenWaiters.forEach((cb) => cb(_lastRefreshResult));
    _refreshTokenWaiters = [];
  }
}

/**
 * Generic request helper used by get/post/put/patch/del.
 * On a 401 (expired access token) it refreshes the token once and retries,
 * so an expired session self-heals instead of surfacing fetch errors.
 */
async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: any } | null> {
  let retried = false;
  for (;;) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: buildHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 && !retried) {
        retried = true;
        const refreshed = await refreshAccessToken();
        if (refreshed) continue;
      }
      const json = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      apiLog(method, path, null, err);
      return null;
    }
  }
}

// ─── Generic helpers ───────────────────────────────────────────────

function apiLog(method: string, path: string, status: number | null, err?: unknown) {
  if (err) {
    debugWarn('API', `${method} ${path} failed:`, err);
    _onApiError?.(method, path, null);
  } else if (status !== null && (status < 200 || status >= 300)) {
    debugWarn('API', `${method} ${path} returned ${status}`);
    _onApiError?.(method, path, status);
  }
}

// ─── Offline write queue ─────────────────────────────────────────
// Writes that fail because the network is down are queued in the sync engine
// and replayed when connectivity returns, so optimistic local-first mutations
// aren't lost. HTTP errors (4xx/5xx) are NOT queued — the backend saw and
// rejected them, so replaying won't help.

type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function enqueueOffline(method: WriteMethod, path: string, body?: unknown): void {
  try {
    syncEngine.enqueue({ method, path, body });
  } catch (err) {
    debugWarn('API', 'Failed to enqueue offline operation:', err);
  }
}

/** Skip the network call when the browser already knows it's offline. */
async function writeOfflineAware<T>(method: WriteMethod, path: string, body: unknown): Promise<T | null> {
  if (isBrowserOffline()) {
    enqueueOffline(method, path, body);
    return null;
  }
  const result = await request(method, path, body);
  if (!result) {
    enqueueOffline(method, path, body);
    return null;
  }
  if (!result.ok) { apiLog(method, path, result.status); return null; }
  return result.json?.data ?? result.json;
}

async function get<T>(path: string): Promise<T | null> {
  // BACKEND CALLED — GET data from server
  const result = await request('GET', path);
  if (!result) return null;
  if (!result.ok) { apiLog('GET', path, result.status); return null; }
  return result.json?.data ?? result.json;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  // BACKEND CALLED — POST data to server
  return writeOfflineAware<T>('POST', path, body);
}

async function put<T>(path: string, body: unknown): Promise<T | null> {
  // BACKEND CALLED — PUT (update) data on server
  return writeOfflineAware<T>('PUT', path, body);
}

async function patch<T>(path: string, body: unknown): Promise<T | null> {
  return writeOfflineAware<T>('PATCH', path, body);
}

async function del<T>(path: string, body?: unknown): Promise<T | null> {
  // BACKEND CALLED — DELETE data from server (optional body for void/refund reasons)
  return writeOfflineAware<T>('DELETE', path, body);
}

/** GET raw text (CSV export responses). */
async function getText(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    if (!res.ok) { apiLog('GET', path, res.status); return null; }
    return await res.text();
  } catch (err) {
    apiLog('GET', path, null, err);
    return null;
  }
}

// ─── Auth ──────────────────────────────────────────────────────────

/** GET /api/auth/owner-exists — Check if any Owner is registered */
export async function checkOwnerExists(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/owner-exists`);
    if (!res.ok) return true; // Assume owner exists if API is unreachable (safety)
    const json = await res.json();
    return json.exists === true;
  } catch (err) {
    debugWarn('API', 'checkOwnerExists failed:', err);
    return true; // Assume owner exists if API is unreachable
  }
}

/** POST /api/auth/register-owner — Register the first Owner (first-time setup) */
export async function registerOwner(data: {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  confirmPassword: string;
  restaurantName: string;
}) {
  try {
    const res = await fetch(`${BASE}/auth/register-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Registration failed' };
    }
    if (json.token) {
      setAuthToken(json.token);
      localStorage.setItem('pos_auth_token', json.token);
      localStorage.setItem('pos_access_token', json.token);
    }
    return { success: true, employee: json.employee, token: json.token };
  } catch (err) {
    debugWarn('API', 'registerOwner failed:', err);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/** POST /api/auth/login — Verify employee/owner credentials and return session + JWT */
export async function login(username: string, password: string) {
  // BACKEND CALLED — authenticate user via username and password/PIN
  try {
    const body: Record<string, string> = { username, password };
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Try to extract the error message from the backend response
      try {
        const errBody = await res.json();
        return { error: errBody.error || 'Invalid username or password' };
      } catch {
        return { error: 'Invalid username or password' };
      }
    }
    const json = await res.json();
    // Auto-store the JWT token on successful login
    if (json.token) {
      setAuthToken(json.token);
      localStorage.setItem('pos_auth_token', json.token);
      localStorage.setItem('pos_access_token', json.token);
    }
    if (json.accessToken) {
      setAuthToken(json.accessToken);
      localStorage.setItem('pos_access_token', json.accessToken);
      localStorage.setItem('pos_auth_token', json.accessToken);
    }
    return { data: json };
  } catch (err) {
    apiLog('POST', '/auth/login', null, err);
    return { error: 'Network error. Please check your connection.' };
  }
}

// ─── Products ──────────────────────────────────────────────────────

/** GET /api/products — Fetch all menu products (optional category/availability filters) */
export async function fetchProducts(params?: { category?: string; availability?: string }) {
  // BACKEND CALLED — load menu items from cloud
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.availability) qs.set('availability', params.availability);
  const query = qs.toString();
  return get<any[]>(`/products${query ? '?' + query : ''}`);
}

/**
 * POST /api/products/:id/stock — Apply a manual stock adjustment (or waste)
 * through the centralized stock movement engine. delta is signed (+ in, − out).
 */
export async function adjustProductStock(id: string, body: {
  delta: number;
  type?: 'purchase' | 'sale' | 'waste' | 'adjustment' | 'opening' | 'closing' | 'correction' | 'return';
  reason?: string;
  details?: string;
  unit?: string;
  branchId?: string;
  purchasePrice?: number;
}) {
  // BACKEND CALLED — move stock via the stock movement engine
  return post<any>(`/products/${id}/stock`, body);
}

/** GET /api/products/:id — Fetch single product */
export async function fetchProduct(id: string) {
  // BACKEND CALLED — get single product detail
  return get<any>(`/products/${id}`);
}

/** POST /api/products — Create a new product */
export async function createProduct(product: any) {
  // BACKEND CALLED — save new menu item to cloud
  return post<any>('/products', product);
}

/** PUT /api/products/:id — Update a product */
export async function updateProduct(id: string, product: any) {
  // BACKEND CALLED — push menu item changes to cloud
  return put<any>(`/products/${id}`, product);
}

/** DELETE /api/products/:id — Delete a product */
export async function deleteProduct(id: string) {
  // BACKEND CALLED — remove menu item from cloud
  return del<any>(`/products/${id}`);
}

// ─── Suppliers (inventory vendors) ───────────────────────────────

/** GET /api/suppliers — Fetch suppliers for this restaurant */
export async function fetchSuppliers(params?: { search?: string; status?: string; limit?: number }) {
  // BACKEND CALLED — load vendor list from cloud
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const suppliers = await get<any[]>(`/suppliers${query ? '?' + query : ''}`);
  if (!suppliers) return null;
  return suppliers.map((s: any) => ({
    id: s._id || s.id,
    name: s.name || 'Supplier',
    phone: s.phone || '',
    email: s.email || '',
    address: s.address || '',
    gstin: s.gstin || '',
    items: Array.isArray(s.items) ? s.items : [],
    status: s.status || 'active',
    notes: s.notes || '',
  }));
}

/** POST /api/suppliers — Create a supplier */
export async function createSupplier(supplier: any) {
  // BACKEND CALLED — save new vendor to cloud
  return post<any>('/suppliers', supplier);
}

/** PUT /api/suppliers/:id — Update a supplier */
export async function updateSupplier(id: string, supplier: any) {
  // BACKEND CALLED — push vendor edits to cloud
  return put<any>(`/suppliers/${id}`, supplier);
}

/** DELETE /api/suppliers/:id — Delete a supplier */
export async function deleteSupplier(id: string) {
  // BACKEND CALLED — remove vendor from cloud
  return del<any>(`/suppliers/${id}`);
}

// ─── Customers ─────────────────────────────────────────────────────

/**
 * GET /api/customers?search=&phone= — Search/fetch customers.
 * The Phase 1.6 backend returns a paginated envelope { data, total, page, ... };
 * this legacy helper unwraps it to a plain array so existing callers (phone
 * lookup, loyalty search) keep working unchanged. Returns null when offline.
 */
export async function fetchCustomers(params?: { search?: string; phone?: string; limit?: number }) {
  // BACKEND CALLED — load customer profiles from cloud
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.phone) qs.set('phone', params.phone);
  // Explicit limit wins; otherwise default to 50 when listing broadly (the
  // backend caps the list endpoint at 100, so 100 is the full snapshot).
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  else if (!params?.phone && !params?.search) qs.set('limit', '50');
  const query = qs.toString();
  const res = await get<any>(`/customers${query ? '?' + query : ''}`);
  if (!res) return null;
  // Envelope (new) vs legacy array (very old backend) — unwrap both to an array.
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

/** POST /api/customers — Create a new customer */
/** Reduce a local Customer (extra fields like purchaseHistory/isNew/id) to the
 *  fields the backend's strict Zod schemas accept, so loyalty sync doesn't 400. */
function toBackendCustomer(customer: any) {
  const { phone, name, email, points, visits, birthday, lastVisit, notes, isBlocked } = customer || {};
  return { phone, name, email, points, visits, birthday, lastVisit, notes, isBlocked };
}

export async function createCustomer(customer: any) {
  // BACKEND CALLED — enroll new loyalty customer in cloud
  return post<any>('/customers', toBackendCustomer(customer));
}

/** PUT /api/customers/:phone — Update a customer (by phone) */
export async function updateCustomer(phone: string, customer: any) {
  // BACKEND CALLED — update loyalty points, visits, history
  return put<any>(`/customers/${encodeURIComponent(phone)}`, toBackendCustomer(customer));
}

/** DELETE /api/customers/:id — Delete (soft) a customer */
export async function deleteCustomer(id: string) {
  // BACKEND CALLED — remove customer profile
  return del<any>(`/customers/${id}`);
}

/** POST /api/customers/:id/restore — Restore a soft-deleted customer */
export async function restoreCustomer(id: string) {
  // BACKEND CALLED — undo a soft-delete
  return post<any>(`/customers/${id}/restore`, {});
}

/**
 * GET /api/customers — Paginated, multi-field search (Phase 1.6).
 * Returns the paginated envelope { data, total, page, limit, totalPages, nextPage, previousPage }.
 * Searchable by phone/name/email/GST/referralCode/tag; filterable by tier/status/isVip.
 */
export async function fetchCustomersPaged(params?: {
  search?: string; phone?: string; email?: string; gstNumber?: string;
  referralCode?: string; tag?: string; tier?: string; status?: string;
  isVip?: boolean; page?: number; limit?: number; sortBy?: string; sortDir?: 'asc' | 'desc';
}) {
  // BACKEND CALLED — paginated customer search (server-side)
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.phone) qs.set('phone', params.phone);
  if (params?.email) qs.set('email', params.email);
  if (params?.gstNumber) qs.set('gstNumber', params.gstNumber);
  if (params?.referralCode) qs.set('referralCode', params.referralCode);
  if (params?.tag) qs.set('tag', params.tag);
  if (params?.tier) qs.set('tier', params.tier);
  if (params?.status) qs.set('status', params.status);
  if (params?.isVip !== undefined) qs.set('isVip', String(params.isVip));
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.sortBy) qs.set('sortBy', params.sortBy);
  if (params?.sortDir) qs.set('sortDir', params.sortDir);
  const query = qs.toString();
  const res = await get<any>(`/customers${query ? '?' + query : ''}`);
  if (!res) return null;
  // Envelope already has { data, total, page, ... }; normalize data rows (_id→id).
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1, nextPage: null, previousPage: null };
  return {
    ...res,
    data: Array.isArray(res.data) ? res.data.map((c: any) => ({ id: c._id || c.id, ...c })) : [],
  };
}

/** GET /api/customers/:id — Fetch a single customer by id */
export async function fetchCustomer(id: string) {
  // BACKEND CALLED — get single customer detail
  return get<any>(`/customers/${id}`);
}

/** GET /api/customers/:id/profile — Full CRM profile (orders, ledger, timeline, offers, segments, referral, audit) */
export async function fetchCustomerProfile(id: string) {
  // BACKEND CALLED — load the full CRM profile bundle
  return get<any>(`/customers/${id}/profile`);
}

/** GET /api/customers/:id/timeline — Customer activity feed */
export async function fetchCustomerTimeline(id: string, params?: { page?: number; limit?: number }) {
  // BACKEND CALLED — load customer activity timeline
  const qs = new URLSearchParams();
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return get<any>(`/customers/${id}/timeline${query ? '?' + query : ''}`);
}

/** GET /api/customers/:id/transactions — Loyalty ledger for a customer */
export async function fetchCustomerTransactions(id: string, params?: { page?: number; limit?: number; type?: string }) {
  // BACKEND CALLED — load points/wallet ledger
  const qs = new URLSearchParams();
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.type) qs.set('type', params.type);
  const query = qs.toString();
  return get<any>(`/customers/${id}/transactions${query ? '?' + query : ''}`);
}

/** POST /api/customers/merge — Merge duplicate customers (Owner/Manager) */
export async function mergeCustomers(primaryId: string, duplicateId: string) {
  // BACKEND CALLED — merge duplicate profiles server-side
  return post<any>('/customers/merge', { primaryId, duplicateId });
}

/** POST /api/customers/import — Bulk import customers (Owner/Manager) */
export async function importCustomers(customers: any[], mode: 'skip' | 'update' | 'error' = 'skip') {
  // BACKEND CALLED — bulk enroll customers
  return post<any>('/customers/import', { customers, mode });
}

/** GET /api/customers/export — Export customers as CSV (or JSON) */
export async function exportCustomers(params?: { search?: string; tier?: string; segment?: string; format?: 'csv' | 'json'; limit?: number }) {
  // BACKEND CALLED — export customer list
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.tier) qs.set('tier', params.tier);
  if (params?.segment) qs.set('segment', params.segment);
  if (params?.format) qs.set('format', params.format);
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  try {
    const res = await fetch(`${BASE}/customers/export${query ? '?' + query : ''}`, { headers: buildHeaders() });
    if (!res.ok) return null;
    if (params?.format === 'json') {
      const json = await res.json();
      return json;
    }
    return await res.text();
  } catch (err) {
    debugWarn('API', 'exportCustomers failed:', err);
    return null;
  }
}

/** POST /api/customers/:id/block — Block/unblock a customer with a reason */
export async function blockCustomer(id: string, block: boolean, reason?: string) {
  // BACKEND CALLED — block/unblock customer (fraud / abuse)
  return post<any>(`/customers/${id}/block`, { block, reason });
}

/** POST /api/customers/:id/referral-code — Generate a fresh referral code */
export async function generateCustomerReferralCode(id: string) {
  // BACKEND CALLED — mint a new referral code for the customer
  return post<any>(`/customers/${id}/referral-code`, {});
}

// ─── Loyalty Engine (Phase 1.6) ──────────────────────────────

/** GET /api/loyalty/settings — Loyalty settings for this restaurant */
export async function fetchLoyaltySettings() {
  // BACKEND CALLED — load server-authoritative loyalty config
  return get<any>('/loyalty/settings');
}

/** PUT /api/loyalty/settings — Update loyalty settings (Owner/Manager) */
export async function updateLoyaltySettings(settings: any) {
  // BACKEND CALLED — persist loyalty engine config
  return put<any>('/loyalty/settings', settings);
}

/** GET /api/loyalty/tiers — Fetch tier configuration */
export async function fetchLoyaltyTiers() {
  // BACKEND CALLED — load loyalty tiers
  return get<any>('/loyalty/tiers');
}

/** POST /api/loyalty/tiers — Create a tier (Owner/Manager) */
export async function createLoyaltyTier(tier: any) {
  return post<any>('/loyalty/tiers', tier);
}

/** PUT /api/loyalty/tiers/:id — Update a tier (Owner/Manager) */
export async function updateLoyaltyTier(id: string, tier: any) {
  return put<any>(`/loyalty/tiers/${id}`, tier);
}

/** DELETE /api/loyalty/tiers/:id — Delete a tier (Owner/Manager) */
export async function deleteLoyaltyTier(id: string) {
  return del<any>(`/loyalty/tiers/${id}`);
}

/** POST /api/loyalty/expiry/run — Run the point-expiry engine (Owner/Manager) */
export async function runPointExpiry() {
  // BACKEND CALLED — expire points per configured mode
  return post<any>('/loyalty/expiry/run', {});
}

/** POST /api/loyalty/customers/:id/redeem — Redeem points against a bill (server-authoritative) */
export async function redeemPoints(customerId: string, body: { points: number; description?: string; refType?: string; refId?: string }) {
  // BACKEND CALLED — server-side points redemption with fraud checks
  return post<any>(`/loyalty/customers/${customerId}/redeem`, body);
}

/** POST /api/loyalty/customers/:id/redeem-reward — Redeem a catalog reward (OTP for large) */
export async function redeemReward(customerId: string, body: { rewardId: string; otpCode?: string }) {
  // BACKEND CALLED — reward redemption with OTP verification for large rewards
  return post<any>(`/loyalty/customers/${customerId}/redeem-reward`, body);
}

/** POST /api/loyalty/customers/:id/adjust — Manual point adjustment (Owner/Manager) */
export async function adjustCustomerPoints(customerId: string, body: { points: number; reason: string }) {
  // BACKEND CALLED — audit-trailed manual point adjustment
  return post<any>(`/loyalty/customers/${customerId}/adjust`, body);
}

/** POST /api/loyalty/customers/:id/wallet/credit — Credit wallet (Owner/Manager) */
export async function creditWallet(customerId: string, body: { amount: number; description?: string }) {
  return post<any>(`/loyalty/customers/${customerId}/wallet/credit`, body);
}

/** POST /api/loyalty/customers/:id/wallet/debit — Debit wallet (Owner/Manager) */
export async function debitWallet(customerId: string, body: { amount: number; description?: string }) {
  return post<any>(`/loyalty/customers/${customerId}/wallet/debit`, body);
}

// ─── OTP (Phase 1.6) ─────────────────────────────────────────

export type OtpPurpose = 'reward_redemption' | 'referral' | 'login' | 'general';

/** POST /api/otp/request — Request a server-generated OTP (rate-limited) */
export async function requestOtp(phone: string, purpose: OtpPurpose = 'general') {
  // BACKEND CALLED — mint + deliver an OTP (server-side hashing, expiry, attempts, rate limit)
  return post<any>('/otp/request', { phone, purpose });
}

/** POST /api/otp/verify — Verify an OTP (single-use, expiry + attempts enforced) */
export async function verifyOtp(phone: string, code: string, purpose: OtpPurpose = 'general') {
  // BACKEND CALLED — verify OTP server-side
  return post<any>('/otp/verify', { phone, code, purpose });
}

// ─── Referrals (Phase 1.6) ───────────────────────────────────

/** GET /api/referrals — Paginated referral list */
export async function fetchReferrals(params?: { status?: string; page?: number; limit?: number }) {
  // BACKEND CALLED — load referral records
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const res = await get<any>(`/referrals${query ? '?' + query : ''}`);
  if (!res) return null;
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1, nextPage: null, previousPage: null };
  return res;
}

/** GET /api/referrals/validate?code= — Validate a referral code */
export async function validateReferralCode(code: string) {
  // BACKEND CALLED — server-side referral code validation
  return get<any>(`/referrals/validate?code=${encodeURIComponent(code)}`);
}

/** POST /api/referrals — Register a referral (referee enrolls with code) */
export async function createReferral(data: { code: string; refereePhone: string; refereeName?: string }) {
  // BACKEND CALLED — record referral and mark pending
  return post<any>('/referrals', data);
}

/** POST /api/referrals/:id/complete — Complete + issue referral rewards (Owner/Manager) */
export async function completeReferral(id: string) {
  // BACKEND CALLED — reward both parties via the loyalty engine
  return post<any>(`/referrals/${id}/complete`, {});
}

/** GET /api/referrals/analytics — Referral performance analytics */
export async function fetchReferralAnalytics() {
  // BACKEND CALLED — referral funnel/performance numbers
  return get<any>('/referrals/analytics');
}

// ─── Campaigns (Phase 1.6) ───────────────────────────────────

/** GET /api/campaigns — List CRM campaigns (paged) */
export async function fetchCampaigns(params?: { status?: string; page?: number; limit?: number }) {
  // BACKEND CALLED — load campaign list
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const res = await get<any>(`/campaigns${query ? '?' + query : ''}`);
  if (!res) return null;
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1, nextPage: null, previousPage: null };
  return res;
}

/** GET /api/campaigns/:id — Fetch a single campaign */
export async function fetchCampaign(id: string) {
  return get<any>(`/campaigns/${id}`);
}

/** POST /api/campaigns/preview — Preview audience size for campaign criteria */
export async function previewCampaign(criteria: any) {
  // BACKEND CALLED — estimate audience before sending
  return post<any>('/campaigns/preview', criteria);
}

/** POST /api/campaigns — Create a campaign (Owner/Manager) */
export async function createCampaign(campaign: any) {
  return post<any>('/campaigns', campaign);
}

/** PUT /api/campaigns/:id — Update a campaign (Owner/Manager) */
export async function updateCampaign(id: string, campaign: any) {
  return put<any>(`/campaigns/${id}`, campaign);
}

/** PATCH /api/campaigns/:id/status — Set campaign status (draft/scheduled/active/paused/completed/cancelled) */
export async function setCampaignStatus(id: string, status: string) {
  return patch<any>(`/campaigns/${id}/status`, { status });
}

/** POST /api/campaigns/:id/send — Send a campaign (Owner/Manager) */
export async function sendCampaign(id: string) {
  // BACKEND CALLED — dispatch notifications to the audience
  return post<any>(`/campaigns/${id}/send`, {});
}

/** DELETE /api/campaigns/:id — Delete a campaign (Owner/Manager) */
export async function deleteCampaign(id: string) {
  return del<any>(`/campaigns/${id}`);
}

// ─── Customer CRM Reports (Phase 1.6) ────────────────────────

/** GET /api/customer-reports — Full CRM report bundle (JSON/CSV) */
export async function fetchCustomerReport(params?: { format?: 'json' | 'csv'; startDate?: string; endDate?: string }) {
  // BACKEND CALLED — load CRM analytics bundle
  const qs = new URLSearchParams();
  if (params?.format) qs.set('format', params.format);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  const query = qs.toString();
  const res = await get<any>(`/customer-reports${query ? '?' + query : ''}`);
  if (!res) return null;
  return res.report || res;
}

/** GET /api/customer-reports/segments — Segment distribution report */
export async function fetchSegmentReport() {
  // BACKEND CALLED — segment distribution + counts
  return get<any>('/customer-reports/segments');
}

/** GET /api/customer-reports/birthdays — Upcoming/today birthdays */
export async function fetchBirthdayReport() {
  // BACKEND CALLED — birthday list for campaigns/greetings
  return get<any>('/customer-reports/birthdays');
}

// ─── Orders ────────────────────────────────────────────────────────

/** GET /api/orders?status=&branchId=&date= — Fetch orders */
export async function fetchOrders(params?: { status?: string; branchId?: string; date?: string }) {
  // BACKEND CALLED — load active/completed orders from cloud
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.date) qs.set('date', params.date);
  const query = qs.toString();
  const orders = await get<any[]>(`/orders${query ? '?' + query : ''}`);
  if (!orders) return null;
  // The list endpoint returns raw order docs WITHOUT the assembled
  // items/kotRecords/timeline arrays (only GET /orders/:id assembles them).
  // Normalize so the dashboard/kitchen/reports never crash on undefined.length
  // for orders that have no KOTs/items yet.
  return orders.map((o: any) => ({
    ...o,
    items: Array.isArray(o.items) ? o.items : [],
    kotRecords: Array.isArray(o.kotRecords) ? o.kotRecords : [],
    timeline: Array.isArray(o.timeline) ? o.timeline : [],
  }));
}

/**
 * Reduce a frontend Order to the backend order schema fields only.
 * The create/update schemas are `.strict()` — sending kotRecords, timeline,
 * interimBillPrinted, id, createdAt etc. would 400 the whole request, silently
 * dropping the status transition. Only backend-known fields are sent; the
 * nested item objects are fine as-is (their inner schema strips unknowns).
 */
export function toBackendOrder(order: any): any {
  const phone = typeof order.customerPhone === 'string' && /^\d{10}$/.test(order.customerPhone) ? order.customerPhone : undefined;
  return {
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    tableId: order.tableId,
    tableNumber: order.tableNumber,
    platform: order.platform,
    branchId: typeof order.branchId === 'string' && /^[a-fA-F0-9]{24}$/.test(order.branchId) ? order.branchId : undefined,
    customerPhone: phone,
    customerName: order.customerName,
    waiterId: order.waiterId,
    waiterName: order.waiterName,
    guestCount: order.guestCount,
    specialInstructions: order.specialInstructions,
    deliveryAddress: order.deliveryAddress,
    deliveryEta: order.deliveryEta,
    subtotal: order.subtotal,
    discount: order.discount,
    gst: order.gst,
    grandTotal: order.grandTotal,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt,
    appliedRewardTitle: order.appliedRewardTitle,
    loyaltyPointsEarned: order.loyaltyPointsEarned,
    loyaltyPointsRedeemed: order.loyaltyPointsRedeemed,
    items: Array.isArray(order.items) ? order.items : undefined,
  };
}

/** POST /api/orders — Create a new order */
export async function createOrder(order: any) {
  // BACKEND CALLED — push new order to cloud for kitchen/management
  return post<any>('/orders', toBackendOrder(order));
}

/** PUT /api/orders/:id — Update an order (status, items, etc.) */
export async function updateOrder(id: string, order: any) {
  // BACKEND CALLED — sync order changes (status, KOT, timeline)
  return put<any>(`/orders/${id}`, toBackendOrder(order));
}

/** Map a local TakeawayOrder (tw_ panel row) to the /api/takeaway-orders create payload. */
function toBackendTakeawayOrder(t: any): any {
  return {
    orderNumber: t.orderNumber,
    customerName: t.customerName,
    customerPhone: t.customerPhone,
    status: t.status,
    amount: t.amount,
    paymentStatus: t.paymentStatus,
    branchId: typeof t.branchId === 'string' && /^[a-fA-F0-9]{24}$/.test(t.branchId) ? t.branchId : undefined,
    items: Array.isArray(t.items) ? t.items.map((it: any) => ({
      itemName: it.productName || (typeof it.product === 'string' ? it.product : undefined) || it.name || 'Item',
      quantity: it.quantity ?? 1,
      price: it.price ?? 0,
      variantName: it.selectedVariant,
    })) : undefined,
  };
}

/** DELETE /api/orders/:id — Cancel/delete an order */
export async function deleteOrder(id: string) {
  // BACKEND CALLED — remove/cancel order from cloud
  return del<any>(`/orders/${id}`);
}

// ─── Bills ─────────────────────────────────────────────────────────

/** GET /api/bills?date=&branchId=&paymentMethod= — Fetch bills */
export async function fetchBills(params?: { date?: string; branchId?: string; paymentMethod?: string }) {
  // BACKEND CALLED — load billing records for reporting/dashboard
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.paymentMethod) qs.set('paymentMethod', params.paymentMethod);
  const query = qs.toString();
  const bills = await get<any[]>(`/bills${query ? '?' + query : ''}`);
  if (!bills) return null;
  // Bill line items are stored in the BillItem collection — a bill doc may
  // arrive without an embedded items array. Always provide one so dashboard /
  // reports aggregation never reads .length on undefined.
  // Also normalize `id` (server sends `_id`) — the Reports ledger and reprint
  // flows key off bill.id, so without this every server bill gets key={undefined}.
  return bills.map((b: any) => ({
    ...b,
    id: b._id || b.id,
    items: Array.isArray(b.items) ? b.items : [],
  }));
}

/** POST /api/bills — Record a completed payment as a bill */
export async function createBill(bill: any) {
  // BACKEND CALLED — save finalized payment to cloud ledger
  return post<any>('/bills', bill);
}

/** GET /api/bills/next-invoice — Get the next atomic invoice number from server */
export async function fetchNextInvoiceNumber(): Promise<number | null> {
  // BACKEND CALLED — get atomic invoice counter from server
  try {
    const res = await fetch(`${BASE}/bills/next-invoice`, {
      headers: buildHeaders(),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.invoiceNumber ?? null;
  } catch (err) {
    debugWarn('API', 'fetchNextInvoiceNumber failed:', err);
    return null;
  }
}

/** DELETE /api/bills/:id — Void/delete a bill */
export async function deleteBill(id: string, voidData?: { reason?: string; voidedBy?: string; managerPin?: string }) {
  // BACKEND CALLED — void a bill entry in cloud (with audit trail)
  return del<any>(`/bills/${id}`, voidData);
}

/** POST /api/bills/:id/refund — Refund a bill (full or partial, manager PIN required) */
export async function refundBill(id: string, data: { items?: Array<{ menuItemId?: string; itemName?: string; quantity?: number }>; reason: string; refundedBy: string; managerPin: string }) {
  // BACKEND CALLED — process a full/partial refund with stock restore + audit
  return post<any>(`/bills/${id}/refund`, data);
}

// ─── Employees ─────────────────────────────────────────────────────

/** GET /api/employees?branchId=&role= — Fetch employees */
export async function fetchEmployees(params?: { branchId?: string; role?: string }) {
  // BACKEND CALLED — load staff list from cloud
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.role) qs.set('role', params.role);
  const query = qs.toString();
  return get<any[]>(`/employees${query ? '?' + query : ''}`);
}

/** POST /api/employees — Create an employee */
export async function createEmployee(employee: any) {
  // BACKEND CALLED — add new staff member to cloud
  return post<any>('/employees', employee);
}

/** PUT /api/employees/:id — Update an employee */
export async function updateEmployee(id: string, employee: any) {
  // BACKEND CALLED — update staff details, PIN, role, status
  return put<any>(`/employees/${id}`, employee);
}

/** DELETE /api/employees/:id — Delete an employee */
export async function deleteEmployee(id: string) {
  // BACKEND CALLED — remove staff member from cloud
  return del<any>(`/employees/${id}`);
}

// ─── Expenses (Phase 1.7) ───────────────────────────────────────

/** GET /api/expenses — paged + filterable (tenant-scoped). */
export async function fetchExpenses(params?: { branchId?: string; category?: string; vendorId?: string; paymentMethod?: string; startDate?: string; endDate?: string; search?: string; includeDeleted?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string }) {
  // BACKEND CALLED — load expense records for finance/reports
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.category) qs.set('category', params.category);
  if (params?.vendorId) qs.set('vendorId', params.vendorId);
  if (params?.paymentMethod) qs.set('paymentMethod', params.paymentMethod);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.search) qs.set('search', params.search);
  if (params?.includeDeleted) qs.set('includeDeleted', params.includeDeleted);
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const res = await get<any>(`/expenses${query ? '?' + query : ''}`);
  if (!res) return [];
  // Envelope-aware: return the array when possible (sync/legacy consumers).
  if (Array.isArray(res)) return res;
  return res.data || [];
}

/** POST /api/expenses — Create an expense entry */
export async function createExpense(expense: any) {
  // BACKEND CALLED — record operational expense in cloud
  return post<any>('/expenses', expense);
}

/** PATCH /api/expenses/:id — Update with optimistic versioning. */
export async function updateExpense(id: string, data: any) {
  // BACKEND CALLED — persist an edited expense (baseVersion enforces conflicts)
  return patch<any>(`/expenses/${id}`, data);
}

/** DELETE /api/expenses/:id — Delete (Owner/Manager, optional PIN). */
export async function deleteExpense(id: string, body?: { reason?: string; managerPin?: string }) {
  // BACKEND CALLED — remove expense entry from cloud
  return del<any>(`/expenses/${id}`, body);
}

/** POST /api/expenses/:id/restore — Restore a soft-deleted expense. */
export async function restoreExpense(id: string) {
  return post<any>(`/expenses/${id}/restore`, {});
}

/** GET /api/expenses/export — Server-generated CSV. */
export async function exportExpenses(params?: { startDate?: string; endDate?: string; category?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.category) qs.set('category', params.category);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString();
  return getText(`/expenses/export${query ? '?' + query : ''}`);
}

// ─── Expense Categories (Phase 1.7) ──────────────────────────────

export async function fetchExpenseCategories(): Promise<any[]> {
  const res = await get<any>(`/expense-categories`);
  if (!res) return [];
  return Array.isArray(res) ? res : res.data || [];
}

export async function createExpenseCategory(data: any) {
  return post<any>('/expense-categories', data);
}

export async function updateExpenseCategory(id: string, data: any) {
  return put<any>(`/expense-categories/${id}`, data);
}

export async function deleteExpenseCategory(id: string) {
  return del<any>(`/expense-categories/${id}`);
}

// ─── Vendors (Phase 1.7) ─────────────────────────────────────────

export async function fetchVendors(params?: { search?: string; status?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const res = await get<any>(`/vendors${query ? '?' + query : ''}`);
  if (!res) return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 };
  return Array.isArray(res) ? { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1 } : res;
}

export async function createVendor(data: any) {
  return post<any>('/vendors', data);
}

export async function updateVendor(id: string, data: any) {
  return put<any>(`/vendors/${id}`, data);
}

export async function deleteVendor(id: string) {
  return del<any>(`/vendors/${id}`);
}

export async function fetchVendorSummary(id: string) {
  const res = await get<any>(`/vendors/${id}/summary`);
  return res?.data || res;
}

// ─── Recurring Expenses (Phase 1.7) ──────────────────────────────

export async function fetchRecurringExpenses(params?: { page?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const res = await get<any>(`/recurring-expenses${query ? '?' + query : ''}`);
  if (!res) return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 };
  return Array.isArray(res) ? { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1 } : res;
}

export async function createRecurringExpense(data: any) {
  return post<any>('/recurring-expenses', data);
}

export async function updateRecurringExpense(id: string, data: any) {
  return put<any>(`/recurring-expenses/${id}`, data);
}

export async function pauseRecurringExpense(id: string) {
  return post<any>(`/recurring-expenses/${id}/pause`, {});
}

export async function resumeRecurringExpense(id: string) {
  return post<any>(`/recurring-expenses/${id}/resume`, {});
}

export async function deleteRecurringExpense(id: string) {
  return del<any>(`/recurring-expenses/${id}`);
}

export async function runRecurringExpenses() {
  return post<any>('/recurring-expenses/run', {});
}

// ─── Cash Ledger (Phase 1.7) ────────────────────────────────────

export async function fetchCashLedger(params?: { page?: number; limit?: number; startDate?: string; endDate?: string }) {
  const qs = new URLSearchParams();
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  const query = qs.toString();
  const res = await get<any>(`/cash-ledger${query ? '?' + query : ''}`);
  if (!res) return { data: [], total: 0, page: 1, limit: 20, totalPages: 1, balance: 0 };
  return Array.isArray(res) ? { data: res, total: res.length, page: 1, limit: params?.limit || 20, totalPages: 1, balance: 0 } : res;
}

export async function openCashDrawer(data: { amount: number; date?: string; note?: string }) {
  return post<any>('/cash-ledger/opening', data);
}

export async function addCashEntry(data: { type: string; amount: number; note?: string; date?: string }) {
  return post<any>('/cash-ledger/entries', data);
}

export async function closeCashShift(data: { countedCash: number; note?: string; date?: string }) {
  return post<any>('/cash-ledger/shift-close', data);
}

// ─── Reports (Phase 1.8) — backend-generated, cached for offline ──
// The backend is the single source of truth for every report. The client
// caches the last successful snapshot per report+range so offline users can
// still view previously computed data — React never recomputes money.

const REPORT_CACHE_PREFIX = 'pos_report_cache_v1';

function reportCacheKey(name: string, params: Record<string, string | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');
  return `${REPORT_CACHE_PREFIX}:${name}:${q}`;
}

function reportParams(startDate?: string, endDate?: string, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  // When neither bound is given the caller means "All Time" — the backend's
  // date range defaults to *today*, so substitute a wide range explicitly.
  const today = new Date().toISOString().slice(0, 10);
  const start = startDate || (!endDate ? '2000-01-01' : undefined);
  const end = endDate || (!startDate ? today : undefined);
  if (start) p.set('startDate', start);
  if (end) p.set('endDate', end);
  Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
  return p.toString();
}

async function getCached<T>(name: string, params: Record<string, string | undefined>, path: string): Promise<{ data: T; fromCache: boolean }> {
  try {
    const res = await get<any>(path);
    if (res && res.data !== undefined) {
      try { localStorage.setItem(reportCacheKey(name, params), JSON.stringify({ savedAt: Date.now(), data: res.data })); } catch { /* storage full */ }
      return { data: res.data, fromCache: false };
    }
  } catch { /* fall through to cache */ }
  try {
    const raw = localStorage.getItem(reportCacheKey(name, params));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data !== undefined) return { data: parsed.data, fromCache: true };
    }
  } catch { /* corrupted cache */ }
  return { data: null as any, fromCache: true };
}

export interface ReportFetchResult<T> { data: T; fromCache: boolean; }

export async function fetchSalesSummary(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-summary', { startDate, endDate }, `/reports/sales/summary?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesTrend(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-trend', { startDate, endDate }, `/reports/sales/trend?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesPayments(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-payments', { startDate, endDate }, `/reports/sales/payments?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesOrderTypes(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-ordertypes', { startDate, endDate }, `/reports/sales/order-types?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesCashiers(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-cashiers', { startDate, endDate }, `/reports/sales/cashiers?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesPeakHours(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('sales-peakhours', { startDate, endDate }, `/reports/sales/peak-hours?${reportParams(startDate, endDate)}`);
}
export async function fetchSalesTopDays(startDate?: string, endDate?: string, limit = 10): Promise<ReportFetchResult<any>> {
  return getCached('sales-topdays', { startDate, endDate }, `/reports/sales/top-days?${reportParams(startDate, endDate, { limit })}`);
}
export async function fetchProductTop(startDate?: string, endDate?: string, limit = 10): Promise<ReportFetchResult<any>> {
  return getCached('products-top', { startDate, endDate }, `/reports/products/top?${reportParams(startDate, endDate, { limit })}`);
}
export async function fetchProductLeast(startDate?: string, endDate?: string, limit = 10): Promise<ReportFetchResult<any>> {
  return getCached('products-least', { startDate, endDate }, `/reports/products/least?${reportParams(startDate, endDate, { limit })}`);
}
export async function fetchProductCategories(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('products-categories', { startDate, endDate }, `/reports/products/categories?${reportParams(startDate, endDate)}`);
}
export async function fetchProductMenuEngineering(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('products-menueng', { startDate, endDate }, `/reports/products/menu-engineering?${reportParams(startDate, endDate)}`);
}
export async function fetchInventoryStock(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('inventory-stock', { startDate, endDate }, `/reports/inventory/stock?${reportParams(startDate, endDate)}`);
}
export async function fetchInventoryValuation(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('inventory-valuation', { startDate, endDate }, `/reports/inventory/valuation?${reportParams(startDate, endDate)}`);
}
export async function fetchEmployeePerformance(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('employees-performance', { startDate, endDate }, `/reports/employees/performance?${reportParams(startDate, endDate)}`);
}
export async function fetchClosingZ(date?: string): Promise<ReportFetchResult<any>> {
  return getCached('closing-z', { date }, `/reports/closing/z?${reportParams(undefined, undefined, { date })}`);
}
export async function fetchSummariesMonthly(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('summaries-monthly', { startDate, endDate }, `/reports/summaries/monthly?${reportParams(startDate, endDate)}`);
}
export async function fetchBranchSummary(startDate?: string, endDate?: string): Promise<ReportFetchResult<any>> {
  return getCached('branch-summary', { startDate, endDate }, `/reports/branch-summary?${reportParams(startDate, endDate)}`);
}
export async function fetchReportExport(report: string, format: 'csv' | 'xlsx' | 'pdf', startDate?: string, endDate?: string): Promise<string | null> {
  const p = reportParams(startDate, endDate, { report, format });
  return getText(`/reports/export?${p}`);
}

// ─── Settings (Phase 1.9) — centralized, tenant-scoped, versioned ──
// The backend is the source of truth. The client caches the last effective
// snapshot for offline use and pushes changes with optimistic concurrency
// (baseVersion → 409 on conflict).

const SETTINGS_CACHE_KEY = 'pos_settings_effective_v1';

export interface EffectiveSettings {
  settings: Record<string, any>;
  meta: {
    version: number;
    scope: 'restaurant' | 'branch' | 'device';
    branchId?: string | null;
    deviceId?: string | null;
    updatedAt?: string | null;
    updatedBy?: string | null;
  };
  versions?: {
    restaurant: number;
    branch: number;
    device: number;
  };
}

export async function fetchEffectiveSettings(branchId?: string, deviceId?: string): Promise<EffectiveSettings | null> {
  const p = new URLSearchParams();
  if (branchId) p.set('branchId', branchId);
  if (deviceId) p.set('deviceId', deviceId);
  const qs = p.toString();
  try {
    const res = await get<any>(`/settings?${qs}`);
    if (res && res.settings) {
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), ...res })); } catch { /* storage full */ }
      return res as EffectiveSettings;
    }
  } catch { /* fall through to cache */ }
  const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.settings) return parsed as EffectiveSettings;
    } catch { /* corrupted cache */ }
  }
  return null;
}

export interface PatchSettingsResult {
  ok: boolean;
  status: number;
  data: { settings: Record<string, any>; settingsVersion: number; changedKeys: string[] } | null;
}

/**
 * Patch settings for a scope with status awareness (409 = concurrency conflict).
 * Uses request() directly so callers can distinguish a conflict from offline.
 */
export async function patchSettings(payload: {
  scope: 'restaurant' | 'branch' | 'device';
  branchId?: string;
  deviceId?: string;
  settings: Record<string, any>;
  baseVersion?: number;
  changeReason?: string;
}): Promise<PatchSettingsResult> {
  if (isBrowserOffline()) {
    enqueueOffline('PATCH', '/settings', payload);
    return { ok: false, status: 0, data: null };
  }
  const result = await request('PATCH', '/settings', payload);
  if (!result) {
    enqueueOffline('PATCH', '/settings', payload);
    return { ok: false, status: 0, data: null };
  }
  if (!result.ok) {
    apiLog('PATCH', '/settings', result.status);
    return { ok: false, status: result.status, data: null };
  }
  return { ok: true, status: result.status, data: result.json?.data ?? result.json };
}

export async function fetchSettingsHistory(scope: 'restaurant' | 'branch' | 'device' = 'restaurant', branchId?: string, deviceId?: string) {
  const p = new URLSearchParams({ scope });
  if (branchId) p.set('branchId', branchId);
  if (deviceId) p.set('deviceId', deviceId);
  return get<any>(`/settings/history?${p.toString()}`);
}

export async function rollbackSettings(payload: {
  scope: 'restaurant' | 'branch' | 'device';
  branchId?: string;
  deviceId?: string;
  toVersion: number;
  changeReason?: string;
}) {
  return post<any>('/settings/rollback', payload);
}

export async function fetchSettingsAudit(page = 1, limit = 50) {
  // NOTE: uses request() directly instead of get() because the audit endpoint
  // returns a { data, total, page, limit } envelope — get() unwraps .data and
  // would hand the Settings History & Audit tab a bare array, making
  // `audit.total` / `audit.data` undefined so the panel always looks empty.
  const result = await request('GET', `/settings/audit?page=${page}&limit=${limit}`);
  if (!result || !result.ok) return null;
  return result.json?.data !== undefined ? { data: result.json.data, total: result.json.total ?? (Array.isArray(result.json.data) ? result.json.data.length : 0), page: result.json.page ?? page, limit: result.json.limit ?? limit } : result.json;
}

// ─── Printers (Phase 1.9) — real registry, replaces fake IPs ──

export interface PrinterRecord {
  _id: string;
  restaurantId: string;
  branchId?: string | null;
  deviceId?: string | null;
  name: string;
  type: 'kitchen' | 'receipt' | 'bar' | 'dessert' | 'kds' | 'network' | 'usb' | 'bluetooth';
  connection: { kind: 'network' | 'usb' | 'bluetooth'; host?: string; port?: number; address?: string };
  paperSize: '58mm' | '80mm';
  copies: number;
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  encoding: string;
  receiptWidthChars?: number;
  isDefault: boolean;
  enabled: boolean;
  healthStatus: 'unknown' | 'online' | 'offline' | 'error';
  lastTestedAt?: string | null;
  lastError?: string | null;
}

export async function fetchPrinters(params: { branchId?: string; deviceId?: string; type?: string } = {}): Promise<PrinterRecord[]> {
  const p = new URLSearchParams();
  if (params.branchId) p.set('branchId', params.branchId);
  if (params.deviceId) p.set('deviceId', params.deviceId);
  if (params.type) p.set('type', params.type);
  const qs = p.toString();
  const res = await get<any>(`/settings/printers?${qs}`);
  return res?.data ?? [];
}

export async function createPrinter(input: Omit<PrinterRecord, '_id' | 'restaurantId' | 'healthStatus' | 'lastTestedAt' | 'lastError' | 'copies' | 'paperSize' | 'encoding' | 'enabled' | 'isDefault'> & Partial<Pick<PrinterRecord, 'copies' | 'paperSize' | 'encoding' | 'enabled' | 'isDefault'>>): Promise<PrinterRecord | null> {
  return post<PrinterRecord>('/settings/printers', input);
}

export async function updatePrinter(id: string, input: Partial<Omit<PrinterRecord, '_id' | 'restaurantId' | 'healthStatus' | 'lastTestedAt' | 'lastError'>>): Promise<PrinterRecord | null> {
  return patch<PrinterRecord>(`/settings/printers/${id}`, input);
}

export async function deletePrinter(id: string) {
  return del<any>(`/settings/printers/${id}`);
}

export async function testPrinter(id: string): Promise<{ id: string; name: string; healthStatus: string; ok: boolean; message: string; latencyMs?: number; testedAt: string } | null> {
  return post<any>(`/settings/printers/${id}/test`, {});
}

// ─── Finance (Phase 1.7) — backend-generated ────────────────────

export async function fetchFinanceSummary(period: 'today' | 'week' | 'month' | 'year' = 'month') {
  const res = await get<any>(`/finance/summary?period=${period}`);
  return res?.data || res;
}

export async function fetchFinancePnl(period: 'today' | 'week' | 'month' | 'year' | 'custom' = 'month', startDate?: string, endDate?: string) {
  const qs = new URLSearchParams({ period });
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);
  const res = await get<any>(`/finance/pnl?${qs.toString()}`);
  return res?.data || res;
}

export async function fetchFinanceCashFlow(startDate?: string, endDate?: string) {
  const qs = new URLSearchParams();
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);
  const query = qs.toString();
  const res = await get<any>(`/finance/cashflow${query ? '?' + query : ''}`);
  return res?.data || res;
}

export async function fetchFinanceGst(startDate?: string, endDate?: string) {
  const qs = new URLSearchParams();
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);
  const query = qs.toString();
  const res = await get<any>(`/finance/gst${query ? '?' + query : ''}`);
  return res?.data || res;
}

export async function fetchFinanceSettings() {
  const res = await get<any>(`/finance/settings`);
  return res?.data || res;
}

export async function updateFinanceSettings(patch: any) {
  return put<any>('/finance/settings', patch);
}

export async function fetchVendorDues() {
  const res = await get<any>(`/finance/vendor-dues`);
  return res?.data || res;
}

// ─── Purchases (inventory stock-in history) ────────────────────────

/** GET /api/purchases — Fetch inventory purchase history for this restaurant */
export async function fetchPurchases(params?: { branchId?: string; supplier?: string; item?: string; startDate?: string; endDate?: string; limit?: number }) {
  // BACKEND CALLED — load stock-in purchase history from cloud
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.supplier) qs.set('supplier', params.supplier);
  if (params?.item) qs.set('item', params.item);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const purchases = await get<any[]>(`/purchases${query ? '?' + query : ''}`);
  if (!purchases) return null;
  // Normalize Mongo docs into the frontend Purchase shape so the UI never
  // crashes on missing fields (supplier/item/unit defaults).
  return purchases.map((p: any) => ({
    id: p._id || p.id,
    supplier: p.supplier || '—',
    item: p.item || 'Item',
    quantity: p.quantity ?? 0,
    unit: p.unit || 'kg',
    price: p.price ?? 0,
    total: p.total ?? (p.quantity ?? 0) * (p.price ?? 0),
    date: p.date || (p.createdAt ? String(p.createdAt).slice(0, 10) : ''),
    status: p.status || 'completed',
  }));
}

/** POST /api/purchases — Record a new stock-in purchase */
export async function createPurchase(purchase: any) {
  // BACKEND CALLED — save a new inventory purchase to cloud
  return post<any>('/purchases', purchase);
}

/** POST /api/inventory-events — Record a waste/adjustment activity event */
export async function createInventoryEvent(event: any) {
  // BACKEND CALLED — persist a new waste/adjustment to the InventoryEvent collection
  return post<any>('/inventory-events', event);
}

/** PATCH /api/purchases/:id — Correct a mistaken purchase entry */
export async function updatePurchase(id: string, data: any) {
  // BACKEND CALLED — push corrected quantity/price/etc to cloud
  return patch<any>(`/purchases/${id}`, data);
}

/** DELETE /api/purchases/:id — Remove a mistaken purchase entry */
export async function deletePurchase(id: string) {
  // BACKEND CALLED — delete a purchase record from cloud
  return del<any>(`/purchases/${id}`);
}

// ─── Inventory activity events (sold/adjusted/waste/closing) ─────

/**
 * GET /api/inventory-events — Fetch the inventory activity feed.
 * Normalizes Mongo docs into the frontend TimelineEntry shape so the
 * Activity page never crashes on missing fields. Returns null when the
 * API is unreachable (offline) so callers fall back to static data.
 */
export async function fetchInventoryEvents(params?: { type?: string; startDate?: string; endDate?: string; limit?: number }) {
  // BACKEND CALLED — load real inventory activity (sold/adjusted/waste/closing)
  const qs = new URLSearchParams();
  if (params?.type) qs.set('type', params.type);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const events = await get<any[]>(`/inventory-events${query ? '?' + query : ''}`);
  if (!events) return null;
  return events.map((e: any) => ({
    id: e._id || e.id,
    type: e.type || 'sold',
    item: e.item || 'Item',
    quantity: e.quantity ?? 0,
    unit: e.unit || 'pcs',
    timestamp: e.eventDate || (e.createdAt ? String(e.createdAt).slice(0, 10) : ''),
    operator: e.operator || 'System',
    details: e.details || '',
  }));
}

// ─── Branches ──────────────────────────────────────────────────────

/** GET /api/branches — Fetch all branches */
export async function fetchBranches() {
  // BACKEND CALLED — load branch list for multi-branch mode
  return get<any[]>('/branches');
}

/** POST /api/branches — Create a new branch */
export async function createBranch(branch: any) {
  // BACKEND CALLED — add new restaurant location to cloud
  return post<any>('/branches', branch);
}

/** PUT /api/branches/:id — Update a branch */
export async function updateBranch(id: string, branch: any) {
  // BACKEND CALLED — update branch details, head branch status
  return put<any>(`/branches/${id}`, branch);
}

/** DELETE /api/branches/:id — Delete a branch */
export async function deleteBranch(id: string) {
  // BACKEND CALLED — remove branch from cloud
  return del<any>(`/branches/${id}`);
}

// ─── Sync ──────────────────────────────────────────────────────────

/** GET /api/sync — Pull latest data from server for all collections */
export async function pullSync() {
  // BACKEND CALLED — full data sync from cloud to local
  return get<Record<string, any[]>>('/sync');
}

// ─── Health ────────────────────────────────────────────────────────

// ─── Tables ─────────────────────────────────────────────────────

/** GET /api/tables — Fetch all tables */
export async function fetchTables(params?: { branchId?: string }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  const query = qs.toString();
  const tables = await get<any[]>(`/tables${query ? '?' + query : ''}`);
  if (!tables) return null;
  // Normalize Mongo docs → frontend TableInfo shape: map _id→id and keep the
  // optional layout fields (x/y/width/height/shape) the backend Table stores.
  return tables.map((t: any) => ({
    id: t._id || t.id,
    number: t.number ?? 0,
    capacity: t.capacity ?? 4,
    status: t.status || 'Available',
    section: t.section,
    branchId: t.branchId,
    floorId: t.floorId,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    rotation: t.rotation ?? 0,
    shape: t.shape,
    isLocked: t.isLocked ?? false,
    waiterId: t.waiterId,
    waiterName: t.waiterName,
    occupiedSince: t.occupiedSince,
    reservationName: t.reservationName,
    reservationTime: t.reservationTime,
  }));
}

/** POST /api/tables — Create a table (Owner/Manager) */
export async function createTable(table: any) {
  return post<any>('/tables', table);
}

/** PUT /api/tables/:id — Update a table (Owner/Manager) */
export async function updateTable(id: string, updates: any) {
  return put<any>(`/tables/${id}`, updates);
}

/** DELETE /api/tables/:id — Soft-delete a table (Owner/Manager) */
export async function deleteTable(id: string) {
  return del<any>(`/tables/${id}`);
}

/** POST /api/tables/bulk-replace/:branchId — Replace all tables for a branch (bulk, safe sync) */
export async function replaceTables(branchId: string, tables: any[]) {
  return post<any>(`/tables/bulk-replace/${encodeURIComponent(branchId)}`, { tables });
}

// ─── Table Operations (server-authoritative status) ─────────────

/** GET /api/tables/stats — Occupancy & operations report */
export async function fetchTableStats(params?: { branchId?: string; date?: string }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.date) qs.set('date', params.date);
  const query = qs.toString();
  return get<any>(`/tables/stats${query ? '?' + query : ''}`);
}

/** POST /api/tables/:id/release — Release a table (Owner/Manager) */
export async function releaseTable(id: string) {
  return post<any>(`/tables/${id}/release`, {});
}

/** POST /api/tables/:id/clean — Start cleaning a table (Owner/Manager) */
export async function startTableCleaning(id: string, reason?: string) {
  return post<any>(`/tables/${id}/clean`, { reason });
}

/** POST /api/tables/:id/clean-complete — Finish cleaning a table (Owner/Manager) */
export async function completeTableCleaning(id: string) {
  return post<any>(`/tables/${id}/clean-complete`, {});
}

/** POST /api/tables/:id/disable — Disable a table (Owner/Manager) */
export async function disableTable(id: string, reason: string) {
  return post<any>(`/tables/${id}/disable`, { reason });
}

/** POST /api/tables/:id/enable — Re-enable a disabled table (Owner/Manager) */
export async function enableTable(id: string) {
  return post<any>(`/tables/${id}/enable`, {});
}

/** POST /api/tables/:id/assign-waiter — Assign/transfer a waiter (Owner/Manager) */
export async function assignTableWaiter(id: string, data: { waiterId?: string; waiterName?: string }) {
  return post<any>(`/tables/${id}/assign-waiter`, data);
}

/** POST /api/tables/:id/move-order — Move a live order to another table (Owner/Manager) */
export async function moveTableOrder(id: string, toTableId: string, reason?: string) {
  return post<any>(`/tables/${id}/move-order`, { toTableId, reason });
}

/** POST /api/tables/merge — Merge two tables' live orders (Owner/Manager) */
export async function mergeTables(fromTableId: string, toTableId: string, reason?: string) {
  return post<any>('/tables/merge', { fromTableId, toTableId, reason });
}

// ─── Floors ─────────────────────────────────────────────────────

/** GET /api/floors — Fetch floors for a branch */
export async function fetchFloors(params?: { branchId?: string; active?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.active !== undefined) qs.set('active', String(params.active));
  const query = qs.toString();
  const floors = await get<any[]>(`/floors${query ? '?' + query : ''}`);
  if (!floors) return null;
  return floors.map((f: any) => ({
    id: f._id || f.id,
    name: f.name,
    branchId: f.branchId,
    sortOrder: f.sortOrder ?? 0,
    isActive: f.isActive !== false,
    theme: f.theme,
  }));
}

/** POST /api/floors — Create a floor (Owner/Manager) */
export async function createFloor(floor: any) {
  return post<any>('/floors', floor);
}

/** PUT /api/floors/:id — Update a floor (Owner/Manager) */
export async function updateFloor(id: string, floor: any) {
  return put<any>(`/floors/${id}`, floor);
}

/** DELETE /api/floors/:id — Soft-delete a floor (Owner) */
export async function deleteFloor(id: string) {
  return del<any>(`/floors/${id}`);
}

// ─── Takeaway Orders ────────────────────────────────────────────

/** GET /api/takeaway-orders — Fetch takeaway orders */
export async function fetchTakeawayOrders(params?: { branchId?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  const orders = await get<any[]>(`/takeaway-orders${query ? '?' + query : ''}`);
  if (!orders) return null;
  // Normalize Mongo docs → frontend TakeawayOrder shape: map _id→id and convert
  // the backend item shape ({itemName,quantity,price}) to the CartItem-like shape
  // TakeawayCard renders. Guarantees an items array (TakeawayCard reads .length).
  return orders.map((o: any) => ({
    id: o._id || o.id,
    orderId: o.orderId || o._id || o.id || '',
    orderNumber: o.orderNumber ?? 0,
    customerName: o.customerName || 'Guest',
    customerPhone: o.customerPhone,
    status: o.status || 'Preparing',
    amount: o.amount ?? 0,
    paymentStatus: o.paymentStatus || 'Pending',
    items: Array.isArray(o.items) ? o.items.map((it: any) => ({
      id: it._id || it.id || `${o._id || o.id}_${it.itemName}`,
      name: it.itemName || it.product || it.name || 'Item',
      product: it.itemName || it.product || it.name || 'Item',
      quantity: it.quantity ?? 1,
      price: it.price ?? 0,
      selectedVariant: it.variantName,
    })) : [],
    branchId: o.branchId,
    createdAt: o.createdAt ? String(o.createdAt) : new Date().toISOString(),
    elapsedTime: '',
  }));
}

/** POST /api/takeaway-orders — Create a takeaway order */
export async function createTakeawayOrder(order: any) {
  return post<any>('/takeaway-orders', order);
}

/** PUT /api/takeaway-orders/:id — Update a takeaway order */
export async function updateTakeawayOrder(id: string, order: any) {
  return put<any>(`/takeaway-orders/${id}`, order);
}

/** DELETE /api/takeaway-orders/:id — Delete a takeaway order */
export async function deleteTakeawayOrder(id: string) {
  return del<any>(`/takeaway-orders/${id}`);
}

// ─── Reservations ───────────────────────────────────────────────

/** GET /api/reservations — Fetch reservations */
export async function fetchReservations(params?: { branchId?: string; date?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.date) qs.set('date', params.date);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  return get<any[]>(`/reservations${query ? '?' + query : ''}`);
}

/** POST /api/reservations — Create a reservation */
export async function createReservation(reservation: any) {
  return post<any>('/reservations', reservation);
}

/** PUT /api/reservations/:id — Update a reservation */
export async function updateReservation(id: string, reservation: any) {
  return put<any>(`/reservations/${id}`, reservation);
}

/** DELETE /api/reservations/:id — Delete a reservation */
export async function deleteReservation(id: string) {
  return del<any>(`/reservations/${id}`);
}

/** GET /api/reservations/waiting — Fetch the waiting list (server wait estimate) */
export async function fetchWaiting(params?: { branchId?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  return get<any[]>(`/reservations/waiting${query ? '?' + query : ''}`);
}

/** POST /api/reservations/waiting — Add a guest to the waiting list */
export async function createWaiting(entry: any) {
  return post<any>('/reservations/waiting', entry);
}

/** PUT /api/reservations/waiting/:id — Update a waiting-list entry (status) */
export async function updateWaiting(id: string, entry: any) {
  return put<any>(`/reservations/waiting/${id}`, entry);
}

/** DELETE /api/reservations/waiting/:id — Remove a waiting-list entry */
export async function removeWaiting(id: string) {
  return del<any>(`/reservations/waiting/${id}`);
}

/** POST /api/reservations/:id/seat — Seat a reservation on a table */
export async function seatReservation(id: string, data: { tableId?: string }) {
  return post<any>(`/reservations/${id}/seat`, data);
}

/** POST /api/reservations/:id/no-show — Mark a reservation as No Show */
export async function markReservationNoShow(id: string) {
  return post<any>(`/reservations/${id}/no-show`, {});
}

// ─── Held Orders (suspended bills) ───────────────────────────────

/** GET /api/held-orders — Fetch all held (suspended) order snapshots */
export async function fetchHeldOrders(params?: { branchId?: string }) {
  // BACKEND CALLED — load suspended bills from cloud
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  const query = qs.toString();
  const orders = await get<any[]>(`/held-orders${query ? '?' + query : ''}`);
  if (!orders) return null;
  // Normalize Mongo docs → frontend held-order shape: keep the client cart id
  // as the primary key and stash the server _id for later delete/update.
  return orders.map((h: any) => ({
    id: h.clientId || h._id || h.id,
    serverId: h._id || h.id,
    orderId: h.orderId,
    customer: h.customer || null,
    items: Array.isArray(h.items) ? h.items : [],
    type: h.type || 'Takeaway',
    timestamp: h.timestamp || '',
  }));
}

/** POST /api/held-orders — Create a held order snapshot */
export async function createHeldOrder(order: any) {
  return post<any>('/held-orders', {
    clientId: order.id,
    orderId: order.orderId,
    customer: order.customer,
    items: order.items,
    type: order.type,
    timestamp: order.timestamp,
  });
}

/** PUT /api/held-orders/:id — Update a held order snapshot */
export async function updateHeldOrder(id: string, order: any) {
  return put<any>(`/held-orders/${id}`, order);
}

/** DELETE /api/held-orders/:id — Delete a held order snapshot */
export async function deleteHeldOrder(id: string) {
  return del<any>(`/held-orders/${id}`);
}

// ─── Sync Engine Replay Helper ─────────────────────────────────

/**
 * Execute a queued PendingOperation (from the offline sync queue)
 * against the backend. Returns true on HTTP 2xx success.
 * Used by the sync engine's auto-replay on reconnect.
 */
export async function executePendingOperation(op: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<boolean> {
  // Queued order creates carry a frozen snapshot from creation time. If the order
  // advanced locally while offline (items added, KOT sent, paid, closed), send the
  // latest persisted state instead — otherwise the backend order stays stuck at
  // "New" and the paid/closed transition never arrives.
  if (op.method === 'POST' && op.path === '/orders' && op.body && typeof (op.body as any).orderNumber === 'number') {
    const latest = getDBData<any[]>('pos_orders', []).find((o: any) => o.orderNumber === (op.body as any).orderNumber);
    if (latest) op.body = toBackendOrder(latest);
  }
  // Same reconcile for takeaway rows — queued creates carry the creation-time
  // snapshot (Preparing/$0/[]), which would otherwise overwrite later offline
  // status/payment/item changes when it replays.
  if (op.method === 'POST' && op.path === '/takeaway-orders' && op.body && typeof (op.body as any).orderNumber === 'number') {
    const latest = getDBData<any[]>('pos_takeaway_orders', []).find((t: any) => t.orderNumber === (op.body as any).orderNumber);
    if (latest) op.body = toBackendTakeawayOrder(latest);
  }
  try {
    const res = await fetch(`${BASE}${op.path}`, {
      method: op.method,
      headers: buildHeaders(),
      // Send the body whenever one exists — DELETE can carry void/refund
      // payloads (reason + manager PIN), and dropping it on replay would
      // silently bypass the backend's manager authorization check.
      body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Convenience Helpers ───────────────────────────────────────

// ─── Subscription & Plans ───────────────────────────────────────

/** GET /api/plans — Fetch all subscription plans */
export async function fetchPlans() {
  return get<any[]>('/plans');
}

/** GET /api/subscription/status — Get current subscription status */
export async function fetchSubscriptionStatus() {
  return get<any>('/subscription/status');
}

/** POST /api/subscription/create-order — Create a Razorpay order for payment */
export async function createSubscriptionOrder(planId: string) {
  return post<any>('/subscription/create-order', { planId });
}

// ─── Rewards (loyalty catalog) ───────────────────────────────────

/** GET /api/rewards — Fetch the reward tiers catalog */
export async function fetchRewards(params?: { isActive?: string }) {
  // BACKEND CALLED — load reward tiers from cloud
  const qs = new URLSearchParams();
  if (params?.isActive) qs.set('isActive', params.isActive);
  const query = qs.toString();
  const rewards = await get<any[]>(`/rewards${query ? '?' + query : ''}`);
  if (!rewards) return null;
  // Normalize Mongo docs → frontend LoyaltyReward shape (_id→id, fill defaults)
  // so the catalog render + merge never crash on missing fields.
  return rewards.map((r: any) => ({
    id: r._id || r.id,
    title: r.title,
    pointsRequired: r.pointsRequired ?? 0,
    type: r.type || 'flat',
    value: r.value ?? 0,
    minBillAmount: r.minBillAmount ?? 0,
    isLargeReward: r.isLargeReward ?? false,
    rewardItemId: r.rewardItemId,
    rewardItemName: r.rewardItemName,
    isActive: r.isActive,
  }));
}

/** POST /api/rewards — Create a reward tier (Owner/Manager) */
export async function createReward(reward: any) {
  return post<any>('/rewards', reward);
}

/** PUT /api/rewards/:id — Update a reward tier (Owner/Manager) */
export async function updateReward(id: string, reward: any) {
  return put<any>(`/rewards/${id}`, reward);
}

/** DELETE /api/rewards/:id — Delete a reward tier (Owner/Manager) */
export async function deleteReward(id: string) {
  return del<any>(`/rewards/${id}`);
}

// ─── Per-restaurant cache namespacing ─────────────────────────
// Subscription status/features are cached in localStorage. Keys are namespaced
// by the current restaurant (from the JWT) so that switching accounts on the
// same device never shows another restaurant's cached (e.g. trial) features.

/** Decode the payload of a JWT without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/**
 * Current restaurant ID taken from the JWT access token payload
 * (pos_access_token / pos_auth_token). Returns null when not logged in.
 */
export function getCurrentRestaurantId(): string | null {
  const token = localStorage.getItem('pos_access_token') || localStorage.getItem('pos_auth_token');
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload?.restaurantId === 'string' && payload.restaurantId ? payload.restaurantId : null;
}

/**
 * Build per-restaurant localStorage keys for subscription data.
 * When not logged in (no restaurant known) the keys fall back to the legacy
 * non-namespaced names — callers should treat a missing restaurant as "no cache".
 */
export function getSubscriptionCacheKeys(): { status: string; features: string; cache: string } {
  const rid = getCurrentRestaurantId();
  const suffix = rid ? `_${rid}` : '';
  return {
    status: `pos_subscription_status${suffix}`,
    features: `pos_subscription_features${suffix}`,
    cache: `pos_subscription_cache${suffix}`,
  };
}

/**
 * Invalidate cached subscription status/features in localStorage and notify
 * the app that the subscription may have changed. Called after any successful
 * subscription mutation (payment verified, manual renew, plan change) so
 * offline devices never show stale trial features from an earlier state.
 */
export function clearSubscriptionCache() {
  try {
    const k = getSubscriptionCacheKeys();
    localStorage.removeItem(k.status);
    localStorage.removeItem(k.features);
    localStorage.removeItem(k.cache);
    // Also remove legacy non-namespaced keys from before per-restaurant namespacing.
    localStorage.removeItem('pos_subscription_status');
    localStorage.removeItem('pos_subscription_features');
    localStorage.removeItem('pos_subscription_cache');
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('pos:subscription-changed'));
}

/** POST /api/payment/verify — Verify Razorpay payment signature */
export async function verifyPayment(data: { orderId: string; paymentId: string; signature: string }) {
  const result = await post<any>('/payment/verify', data);
  if (result) clearSubscriptionCache();
  return result;
}

/** GET /api/subscription/history — Get payment/invoice history */
export async function fetchSubscriptionHistory() {
  return get<any>('/subscription/history');
}

/** POST /api/subscription/manual-renew — Manually renew subscription (records cash/manual Payment + Invoice) */
export async function manualRenewSubscription(payload?: { amount?: number; notes?: string; paymentMethod?: string }) {
  const result = await post<any>('/subscription/manual-renew', payload || {});
  if (result) clearSubscriptionCache();
  return result;
}

/** PATCH /api/subscription/change-plan — Change subscription plan */
export async function changeSubscriptionPlan(planId: string) {
  const result = await patch<any>('/subscription/change-plan', { planId });
  if (result) clearSubscriptionCache();
  return result;
}

/** GET /api/subscription/branch-usage — Get branch usage for current restaurant */
export async function fetchBranchUsage() {
  return get<any>('/subscription/branch-usage');
}

/** GET /api/bills?date=today — Fetch only today's bills (lightweight) */
export async function fetchBillsToday(branchId?: string) {
  const today = new Date().toISOString().split('T')[0];
  return fetchBills({ date: today, branchId });
}

// ─── Device Registration ───────────────────────────────────

/** POST /api/devices/register — Register the current device after login */
export async function registerDevice(info: {
  deviceId: string;
  deviceName?: string;
  os?: string;
  osVersion?: string;
  appVersion?: string;
}) {
  return post<any>('/devices/register', info);
}

// ─── Offers & AI Recommendations ──────────────────────────────────

/** GET /api/offers — Fetch all offers (authenticated) */
export async function fetchOfferList() {
  // BACKEND CALLED — load offers from cloud
  return get<any>('/offers');
}

/** POST /api/offers/recommendations — Generate AI offer recommendations */
export async function fetchOfferRecommendations() {
  // BACKEND CALLED — request AI-powered offer suggestions
  const result = await post<any>('/offers/recommendations', {});
  if (!result) return null;
  // Normalize both shapes: { suggestions } (backend) or { data: { suggestions } }
  if (Array.isArray(result.suggestions)) return result;
  if (Array.isArray(result.data?.suggestions)) return { suggestions: result.data.suggestions };
  return result;
}

/** GET /api/offers/segments — Fetch customer segments */
export async function fetchOfferSegments() {
  // BACKEND CALLED — load loyalty segments from cloud
  return get<any>('/offers/segments');
}

/** POST /api/offers/segments/refresh — Recompute segments */
export async function refreshOfferSegments() {
  // BACKEND CALLED — refresh segment engine
  return post<any>('/offers/segments/refresh', {});
}

/** GET /api/offers/analytics — Fetch offer analytics */
export async function fetchOfferAnalytics() {
  // BACKEND CALLED — load offer performance data
  return get<any>('/offers/analytics');
}

/** POST /api/offers — Create a new offer */
export async function createOffer(offer: any) {
  // BACKEND CALLED — save new offer to cloud
  return post<any>('/offers', offer);
}

/** PUT /api/offers/:id — Update an offer */
export async function updateOffer(id: string, offer: any) {
  // BACKEND CALLED — push offer changes to cloud
  return put<any>(`/offers/${id}`, offer);
}

/** PATCH /api/offers/:id/status — Change offer status */
export async function updateOfferStatus(id: string, status: string) {
  // BACKEND CALLED — update offer status (activate/schedule/pause)
  return patch<any>(`/offers/${id}/status`, { status });
}

/** DELETE /api/offers/:id — Delete an offer */
export async function deleteOffer(id: string) {
  // BACKEND CALLED — remove offer from cloud
  return del<any>(`/offers/${id}`);
}

/** GET /api/health — Check if backend is live */
export async function checkHealth() {
  // BACKEND CALLED — verify backend connectivity (LoginScreen status indicator)
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch (err) {
    debugWarn('API', 'Health check failed:', err);
    return false;
  }
}
