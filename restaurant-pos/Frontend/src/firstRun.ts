/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * firstRun.ts — Pure decision logic for the POS boot screen.
 *
 * Decides whether the terminal should show first-time registration (wizard),
 * the login screen, or open straight to the dashboard, based on:
 *   - whether the server says an Owner exists (source of truth), and
 *   - whether this device has a cached Owner session (offline fallback only).
 *
 * The regression this guards: after the DB is wiped/reset, a device that
 * previously logged in must NOT keep trusting its cached Owner session and
 * show a phantom login screen — it must clear the stale cache and land on the
 * registration wizard.
 *
 * Pure on purpose — no localStorage/network here, so it is trivially testable.
 */

/** `null` means the server could not be reached (offline). */
export type OwnerExistsResult = boolean | null;

export interface FirstRunDecision {
  /** Which top-level screen state the app should adopt. */
  setupState: 'loading' | 'setup' | 'ready';
  /**
   * The sign-in gate: 'register' = show the wizard, 'login' = show login.
   * Absent when the decision doesn't touch it.
   */
  firstRunChoice?: 'login' | 'register';
  /**
   * True when the device holds a stale Owner session that must be wiped
   * (clearAllCache + auth keys) before rendering the wizard.
   */
  clearCache?: boolean;
}

export function decideFirstRun(opts: {
  /** Raw value of localStorage 'pos_current_employee' (or null). */
  storedEmployee: string | null;
  /** Server answer to "does an Owner exist?" — null when offline. */
  ownerExists: OwnerExistsResult;
  /** Whether the auth context currently holds a valid session. */
  isAuthenticated: boolean;
}): FirstRunDecision {
  const { storedEmployee, ownerExists, isAuthenticated } = opts;

  // A cached Owner session only counts when the server is unreachable — the
  // server is the source of truth for whether an Owner actually exists.
  let hasCachedOwner = false;
  if (storedEmployee) {
    try {
      hasCachedOwner = JSON.parse(storedEmployee)?.role === 'Owner';
    } catch { /* malformed cache — treat as absent */ }
  }

  // Offline: trust the cached Owner session so the terminal still opens.
  if (ownerExists === null) {
    if (hasCachedOwner) {
      return { setupState: 'ready' };
    }
    // Server unreachable + no cached owner. An authenticated session opens
    // straight in. Otherwise the registration wizard needs the server (it
    // creates the owner), so showing it while offline is pointless — fall
    // back to the login screen. Registration is ONLY offered when the server
    // explicitly answers "no owner exists" (fresh DB).
    return {
      setupState: 'ready',
      ...(isAuthenticated ? {} : { firstRunChoice: 'login' as const }),
    };
  }

  if (ownerExists) {
    return { setupState: 'ready', firstRunChoice: 'login' };
  }

  // No owner on the server — the DB is empty (fresh install or reset). Any
  // locally cached Owner session is stale and must be cleared so the terminal
  // reliably lands on first-time registration instead of a phantom login.
  return { setupState: 'ready', firstRunChoice: 'register', clearCache: true };
}
