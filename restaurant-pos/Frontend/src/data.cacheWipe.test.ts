/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * clearAllCache() must remove EVERY cached restaurant data row from
 * localStorage (not just TTL stamps) while preserving the session/auth/device
 * keys that identify the CURRENT login — otherwise a device switching
 * restaurants can hydrate the new tenant's screens from the old tenant's
 * cached bills/orders/menu, and a fresh login would wipe its own token.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllCache, getDBData, setDBData, setCachedData, DEFAULT_SETTINGS } from './data';
import { syncEngine, type PendingOperation } from './lib/syncEngine';

function seedLocalStorage(): void {
  // Restaurant data rows (must be wiped)
  setDBData('pos_products', [{ id: 'p1', name: 'Old Pizza' }]);
  setDBData('pos_bills', [{ id: 'b1', grandTotal: 999 }]);
  setDBData('pos_orders', [{ id: 'o1' }]);
  setDBData('pos_employees', [{ id: 'e1', name: 'Old Staff' }]);
  setDBData('pos_tables', [{ id: 't1' }]);
  setCachedData('pos_customers', [{ id: 'c1' }]); // data row + TTL stamp
  setDBData('pos_sync_queue', [{ id: 'op1' }]); // queued offline writes
  setDBData('pos_config_catalog', { version: 1 }); // offline menu catalog
  setDBData('pos_report_cache_v1_daily', { revenue: 999 });
  setDBData('pos_settings', { ...DEFAULT_SETTINGS, restaurantName: 'Old Restaurant' });
  setDBData('pos_next_invoice_number', 5555);

  // Session/auth/device keys (must SURVIVE)
  localStorage.setItem('pos_access_token', 'jwt-old-restaurant');
  localStorage.setItem('pos_auth_token', 'jwt-legacy');
  localStorage.setItem('pos_refresh_token', 'refresh-old');
  localStorage.setItem('pos_session_mode', 'persisted');
  localStorage.setItem('pos_current_employee', JSON.stringify({ id: 'e1', name: 'New Cashier' }));
  localStorage.setItem('pos_device_id', 'device-abc-123');
  localStorage.setItem('pos_cache_schema_version', 'products_variants_v2');
  localStorage.setItem('pos_saved_accounts', JSON.stringify([
    { userId: 'u1', restaurantId: 'r1', displayName: 'Alice', username: 'alice', role: 'Owner', restaurantName: 'Cafe A' },
    { userId: 'u2', restaurantId: 'r2', displayName: 'Bob', username: 'bob', role: 'Manager', restaurantName: 'Cafe B' },
  ]));
}

describe('clearAllCache — restaurant-switch cache hygiene', () => {
  beforeEach(() => {
    localStorage.clear();
    seedLocalStorage();
  });

  it('removes every cached restaurant data row (products, bills, orders, employees, tables, sync queue, catalog, report caches, settings, sequences)', () => {
    clearAllCache();

    expect(getDBData('pos_products', null as any)).toBeNull();
    expect(getDBData('pos_bills', null as any)).toBeNull();
    expect(getDBData('pos_orders', null as any)).toBeNull();
    expect(getDBData('pos_employees', null as any)).toBeNull();
    expect(getDBData('pos_tables', null as any)).toBeNull();
    expect(getDBData('pos_customers', null as any)).toBeNull();
    expect(getDBData('pos_sync_queue', null as any)).toBeNull();
    expect(getDBData('pos_config_catalog', null as any)).toBeNull();
    expect(getDBData('pos_report_cache_v1_daily', null as any)).toBeNull();
    expect(getDBData('pos_settings', null as any)).toBeNull();
    expect(getDBData('pos_next_invoice_number', null as any)).toBeNull();
  });

  it('removes the TTL metadata so cached rows are re-fetched, not served', () => {
    clearAllCache();
    expect(localStorage.getItem('pos_cache_meta')).toBeNull();
  });

  it('preserves session/auth/device keys (fresh token, current employee, device id)', () => {
    clearAllCache();

    expect(localStorage.getItem('pos_access_token')).toBe('jwt-old-restaurant');
    expect(localStorage.getItem('pos_auth_token')).toBe('jwt-legacy');
    expect(localStorage.getItem('pos_refresh_token')).toBe('refresh-old');
    expect(localStorage.getItem('pos_session_mode')).toBe('persisted');
    expect(localStorage.getItem('pos_current_employee')).toBe(JSON.stringify({ id: 'e1', name: 'New Cashier' }));
    expect(localStorage.getItem('pos_device_id')).toBe('device-abc-123');
    expect(localStorage.getItem('pos_cache_schema_version')).toBe('products_variants_v2');
    // Saved accounts must survive so fast-switch between restaurants works
    const saved = JSON.parse(localStorage.getItem('pos_saved_accounts') || '[]');
    expect(saved).toHaveLength(2);
    expect(saved[0].username).toBe('alice');
    expect(saved[1].username).toBe('bob');
  });
});

describe('syncEngine.clearQueue — offline writes must not replay across tenants', () => {
  beforeEach(() => {
    localStorage.clear();
    syncEngine.clearQueue();
  });

  it('drops queued operations from memory and storage', () => {
    syncEngine.enqueue({ method: 'POST', path: '/bills', body: { restaurantId: 'tenant-A' } });
    expect(syncEngine.getQueue().length).toBe(1);

    syncEngine.clearQueue();

    expect(syncEngine.getQueue().length).toBe(0);
    const raw = localStorage.getItem('pos_sync_queue');
    expect(raw === null || JSON.parse(raw as string).length === 0).toBe(true);
  });

  it('queued ops survive an enqueue after clear (queue usable for the new tenant)', () => {
    syncEngine.enqueue({ method: 'POST', path: '/bills', body: { restaurantId: 'tenant-A' } });
    syncEngine.clearQueue();
    syncEngine.enqueue({ method: 'POST', path: '/bills', body: { restaurantId: 'tenant-B' } } as Omit<PendingOperation, 'id' | 'createdAt' | 'retries' | 'maxRetries'>);

    expect(syncEngine.getQueue()).toHaveLength(1);
    expect((syncEngine.getQueue()[0] as any).body.restaurantId).toBe('tenant-B');
  });
});
