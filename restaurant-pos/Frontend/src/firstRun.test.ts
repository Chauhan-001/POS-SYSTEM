/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: when the server reports NO Owner exists (fresh install or
 * DB reset), a device that previously logged in must clear its stale cached
 * Owner session and land on the registration wizard — NOT keep trusting the
 * cache and show a phantom login screen.
 *
 * Covers all branches of decideFirstRun:
 *   - owner exists            → login, no cache clearing
 *   - no owner + stale cache  → REGISTER + clearCache (the regression)
 *   - offline + cached owner  → open straight in (offline fallback)
 *   - offline + no cache      → register (or setup when authenticated)
 */
import { describe, it, expect } from 'vitest';
import { decideFirstRun, type OwnerExistsResult } from './firstRun';

const CACHED_OWNER = JSON.stringify({ id: 'e1', name: 'Old Owner', role: 'Owner', status: 'Active' });
const CACHED_CASHIER = JSON.stringify({ id: 'e2', name: 'Old Cashier', role: 'Cashier', status: 'Active' });

function decide(storedEmployee: string | null, ownerExists: OwnerExistsResult, isAuthenticated = false) {
  return decideFirstRun({ storedEmployee, ownerExists, isAuthenticated });
}

describe('decideFirstRun — boot first-run gate', () => {
  it('REGISTRATION + cache clear when no owner exists, even with a stale cached Owner session (the regression)', () => {
    // Device previously logged in as Owner; the DB has since been wiped.
    const decision = decide(CACHED_OWNER, false);

    expect(decision.setupState).toBe('ready');
    expect(decision.firstRunChoice).toBe('register');
    expect(decision.clearCache).toBe(true);
  });

  it('REGISTRATION + cache clear when no owner exists and no session is cached', () => {
    const decision = decide(null, false);

    expect(decision.firstRunChoice).toBe('register');
    expect(decision.clearCache).toBe(true);
  });

  it('REGISTRATION + cache clear when a stale non-owner cache exists (cashier from a wiped tenant)', () => {
    const decision = decide(CACHED_CASHIER, false);

    expect(decision.firstRunChoice).toBe('register');
    expect(decision.clearCache).toBe(true);
  });

  it('REGISTRATION + cache clear when the cached employee is malformed JSON', () => {
    const decision = decide('{not-json', false);

    expect(decision.firstRunChoice).toBe('register');
    expect(decision.clearCache).toBe(true);
  });

  it('LOGIN, no cache clear, when an Owner exists on the server', () => {
    const decision = decide(CACHED_OWNER, true);

    expect(decision.setupState).toBe('ready');
    expect(decision.firstRunChoice).toBe('login');
    expect(decision.clearCache).toBeUndefined();
  });

  it('LOGIN, no cache clear, when an Owner exists and nothing is cached', () => {
    const decision = decide(null, true);

    expect(decision.firstRunChoice).toBe('login');
    expect(decision.clearCache).toBeUndefined();
  });

  it('opens straight in (offline) when a valid Owner session is cached and the server is unreachable', () => {
    const decision = decide(CACHED_OWNER, null);

    expect(decision.setupState).toBe('ready');
    expect(decision.firstRunChoice).toBeUndefined();
    expect(decision.clearCache).toBeUndefined();
  });

  it('REGISTER when offline, no cached owner, and unauthenticated', () => {
    const decision = decide(null, null, false);

    expect(decision.setupState).toBe('ready');
    expect(decision.firstRunChoice).toBe('register');
  });

  it('SETUP (wizard) when offline, no cached owner, but a session token exists', () => {
    const decision = decide(null, null, true);

    expect(decision.setupState).toBe('setup');
    expect(decision.firstRunChoice).toBeUndefined();
  });

  it('offline + cached non-owner does NOT count as a cached Owner session', () => {
    const decision = decide(CACHED_CASHIER, null, false);

    expect(decision.setupState).toBe('ready');
    expect(decision.firstRunChoice).toBe('register');
  });
});
