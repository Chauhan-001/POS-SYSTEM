/**
 * savedAccounts.ts — Persistent saved-account list for fast switching.
 *
 * Previously authenticated accounts are persisted to localStorage so the
 * login screen can offer "Continue as …" tiles.  Each entry holds only the
 * information needed for identification and offline PIN verification —
 * never raw JWTs or refresh tokens.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface SavedAccount {
  /** Employee _id (or restaurant _id for owner-identity login). */
  userId: string;
  /** Restaurant MongoDB _id — used to scope every API call. */
  restaurantId: string;
  /** Human-readable restaurant name (e.g. "The Royal Bistro"). */
  restaurantName: string;
  /** Employee display name (e.g. "Vikram Singh"). */
  displayName: string;
  /** Login username / User ID (e.g. "vksingh"). */
  username: string;
  /** Employee role — used for offline role-based gate. */
  role: string;
  /** Branch the employee primarily belongs to (null for owner/global). */
  branchId: string | null;
  /** Absolute URL to restaurant logo or employee avatar, if any. */
  avatar: string | null;
  /** Epoch-ms of the last successful login via this account. */
  lastUsedAt: number;
  /** True when this account has been used at least once while online
   *  (meaning the backend has verified the credentials). */
  offlineAuthorized: boolean;
}

// ── Storage key ─────────────────────────────────────────────────────

const STORAGE_KEY = 'pos_saved_accounts';
const MAX_SAVED = 8;

// ── Helpers ─────────────────────────────────────────────────────────

function readRaw(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeRaw(accounts: SavedAccount[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch { /* quota exceeded — non-fatal */ }
}

// ── Public API ──────────────────────────────────────────────────────

/** Return the current saved-account list (newest first). */
export function getSavedAccounts(): SavedAccount[] {
  return readRaw().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Upsert an account into the saved list after a successful login.
 * If the account already exists (matched by userId + restaurantId),
 * its metadata is refreshed.  Otherwise a new entry is prepended.
 * The list is capped at MAX_SAVED; oldest entries are evicted.
 */
export function saveAccount(entry: Omit<SavedAccount, 'lastUsedAt'>): void {
  const accounts = readRaw();
  const idx = accounts.findIndex(
    (a) => a.userId === entry.userId && a.restaurantId === entry.restaurantId,
  );

  const updated: SavedAccount = {
    ...entry,
    lastUsedAt: Date.now(),
    offlineAuthorized: true,
  };

  if (idx >= 0) {
    accounts[idx] = updated;
  } else {
    accounts.unshift(updated);
  }

  // Evict oldest beyond cap
  while (accounts.length > MAX_SAVED) {
    accounts.pop();
  }

  writeRaw(accounts);
}

/** Touch the lastUsedAt timestamp (called on each successful login). */
export function touchAccount(userId: string, restaurantId: string): void {
  const accounts = readRaw();
  const idx = accounts.findIndex(
    (a) => a.userId === userId && a.restaurantId === restaurantId,
  );
  if (idx >= 0) {
    accounts[idx].lastUsedAt = Date.now();
    accounts[idx].offlineAuthorized = true;
    writeRaw(accounts);
  }
}

/** Remove a single account (e.g. on explicit logout / "forget"). */
export function removeAccount(userId: string, restaurantId: string): void {
  const accounts = readRaw().filter(
    (a) => !(a.userId === userId && a.restaurantId === restaurantId),
  );
  writeRaw(accounts);
}

/** Remove ALL saved accounts (e.g. "log out of all accounts"). */
export function clearAllSavedAccounts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * Check whether a given userId+restaurantId pair is in the saved list
 * and was previously authorized online (offline-eligible).
 */
export function isOfflineAuthorized(userId: string, restaurantId: string): boolean {
  const accounts = readRaw();
  return accounts.some(
    (a) =>
      a.userId === userId &&
      a.restaurantId === restaurantId &&
      a.offlineAuthorized,
  );
}
