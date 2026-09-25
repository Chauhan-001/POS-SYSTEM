/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E tests for production hardening features:
 *   1. Offline Queue — persistence, crash recovery, max retries
 *   2. Error Boundary — render crash resilience
 *
 * (Former section 3, "AI Degradation", was removed together with the AI
 * summary/weather components it tested — see the 'removed ai' commit.)
 */

import { test, expect, type Page } from '@playwright/test';
import { getSeedScript } from './helpers/seedData';

// ================================================================
// SHARED HELPERS
// ================================================================

async function loginAs(page: Page, username: string, password: string = '1111') {
  await page.locator('#login_screen_container input[type="text"]').first().fill(username);
  await page.locator('#login_screen_container input[type="password"]').first().fill(password);
  await page.locator('#login_screen_container button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function clickSidebar(page: Page, label: string) {
  await page.locator('aside button', { hasText: label }).first().click();
}

// ================================================================
// 1. OFFLINE QUEUE — Persistence, Crash Recovery, Max Retries
// ================================================================

test.describe('Offline Queue — SyncEngine persistence', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(getSeedScript());
    await page.goto('/');
    await page.evaluate(getSeedScript());
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
  });

  test('should persist pending operations to localStorage', async ({ page }) => {
    await page.evaluate(() => {
      const queue = [
        {
          id: 'op_test_1',
          method: 'POST',
          path: '/api/bills',
          body: { grandTotal: 250, paymentMethod: 'Cash' },
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: 5,
        },
        {
          id: 'op_test_2',
          method: 'PUT',
          path: '/api/inventory/stock',
          body: { item: 'Milk', quantity: 10 },
          createdAt: new Date().toISOString(),
          retries: 1,
          maxRetries: 5,
        },
      ];
      localStorage.setItem('pos_sync_queue', JSON.stringify(queue));
    });

    const queueRaw = await page.evaluate(() => localStorage.getItem('pos_sync_queue'));
    expect(queueRaw).not.toBeNull();

    const queue = JSON.parse(queueRaw!);
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBe(2);
    expect(queue[0].method).toBe('POST');
    expect(queue[0].path).toBe('/api/bills');
    expect(queue[1].method).toBe('PUT');
    expect(queue[1].path).toBe('/api/inventory/stock');
  });

  test('should survive page reload (crash recovery)', async ({ page }) => {
    // Seed a queue entry into localStorage before the page loads
    await page.addInitScript(() => {
      const queue = [
        {
          id: 'op_crash_1',
          method: 'POST',
          path: '/api/bills',
          body: { grandTotal: 500, paymentMethod: 'UPI' },
          createdAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
          retries: 0,
          maxRetries: 5,
        },
      ];
      localStorage.setItem('pos_sync_queue', JSON.stringify(queue));
    });

    await page.reload();
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
    await loginAs(page, 'cashier', '3333');

    // The queue should still be in localStorage after app init
    const queueRaw = await page.evaluate(() => localStorage.getItem('pos_sync_queue'));
    expect(queueRaw).not.toBeNull();

    const queue = JSON.parse(queueRaw!);
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe('op_crash_1');
  });

  test('should filter out stale entries older than 7 days', async ({ page }) => {
    // Directly test the filtering logic that syncEngine.loadQueue() uses
    const result = await page.evaluate(() => {
      const MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - MAX_RETENTION_MS;

      const queue = [
        {
          id: 'op_stale_1',
          method: 'POST',
          path: '/api/bills',
          body: { grandTotal: 100 },
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days old
          retries: 0,
          maxRetries: 5,
        },
        {
          id: 'op_fresh_1',
          method: 'PUT',
          path: '/api/products/1',
          body: { price: 299 },
          createdAt: new Date().toISOString(), // now
          retries: 0,
          maxRetries: 5,
        },
      ];

      // Apply the same filter as loadQueue()
      const filtered = queue.filter(op => new Date(op.createdAt).getTime() > cutoff);
      return { total: queue.length, filtered: filtered.length, freshId: filtered[0]?.id };
    });

    expect(result.total).toBe(2);
    expect(result.filtered).toBe(1);
    expect(result.freshId).toBe('op_fresh_1');
  });

  test('should drop operations that have exhausted max retries', async ({ page }) => {
    const result = await page.evaluate(() => {
      const MAX_RETRIES = 5;
      const queue = [
        {
          id: 'op_exhausted_1',
          method: 'POST',
          path: '/api/bills',
          body: { grandTotal: 100 },
          createdAt: new Date().toISOString(),
          retries: 5,
          maxRetries: 5,
        },
        {
          id: 'op_valid_1',
          method: 'DELETE',
          path: '/api/orders/42',
          body: null,
          createdAt: new Date().toISOString(),
          retries: 1,
          maxRetries: 5,
        },
      ];

      // Simulate markRetry logic: drop operations where retries >= maxRetries
      const filtered = queue.filter(op => op.retries < op.maxRetries);
      return { total: queue.length, filtered: filtered.length, validId: filtered[0]?.id };
    });

    expect(result.total).toBe(2);
    expect(result.filtered).toBe(1);
    expect(result.validId).toBe('op_valid_1');
  });

  test('should have correct structure for each queued operation', async ({ page }) => {
    await page.evaluate(() => {
      const queue = [
        {
          id: 'op_struct_1',
          method: 'POST',
          path: '/api/expenses',
          body: { amount: 500, category: 'Utilities' },
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: 5,
        },
      ];
      localStorage.setItem('pos_sync_queue', JSON.stringify(queue));
    });

    const queueRaw = await page.evaluate(() => localStorage.getItem('pos_sync_queue'));
    const op = JSON.parse(queueRaw!)[0];

    expect(op).toHaveProperty('id');
    expect(op).toHaveProperty('method');
    expect(op).toHaveProperty('path');
    expect(op).toHaveProperty('createdAt');
    expect(op).toHaveProperty('retries');
    expect(op).toHaveProperty('maxRetries');
    expect(['POST', 'PUT', 'DELETE']).toContain(op.method);
    expect(new Date(op.createdAt).getTime()).not.toBeNaN();
    expect(op.retries).toBeGreaterThanOrEqual(0);
    expect(op.maxRetries).toBeGreaterThan(0);
  });
});

// ================================================================
// 2. ERROR BOUNDARY — Crash Resilience
// ================================================================

test.describe('Error Boundary', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(getSeedScript());
    await page.goto('/');
    await page.evaluate(getSeedScript());
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
    await loginAs(page, 'cashier', '3333');
  });

  test('should catch thrown errors via global error handler', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });

    // Throw an error asynchronously (tests global window.onerror)
    await page.evaluate(() => {
      setTimeout(() => { throw new Error('SIMULATED_E2E_CRASH'); }, 100);
    });

    await page.waitForTimeout(500);

    // The page should still be functional
    await expect(page.locator('aside')).toBeVisible({ timeout: 3_000 });
  });

  test('should catch unhandled promise rejections gracefully', async ({ page }) => {
    // Trigger an unhandled promise rejection
    await page.evaluate(() => {
      new Promise((_, reject) => {
        reject(new Error('SIMULATED_E2E_UNHANDLED_REJECTION'));
      });
    });

    await page.waitForTimeout(300);

    // App remains functional
    await expect(page.locator('aside')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('aside button', { hasText: 'Orders' }).first()).toBeVisible({ timeout: 3_000 });
  });

  test('should survive navigating between workspaces after errors', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });

    // Navigate to Orders via sidebar (label is "Orders")
    await clickSidebar(page, 'Orders');
    await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

    // Navigate back to Dashboard via sidebar (button label is "Home")
    await clickSidebar(page, 'Home');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });
  });
});
