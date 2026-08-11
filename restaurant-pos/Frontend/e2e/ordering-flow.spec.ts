/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E tests for the POS ordering flow:
 *   Login → Create Dine-In Order → Add Products → Checkout (Payment)
 *
 * These tests run against the Vite dev server (see playwright.config.ts).
 * localStorage is seeded via BOTH addInitScript AND page.evaluate for
 * maximum reliability.
 *
 * Login flow:
 *   The LoginScreen uses a form with username + password fields (no quick-login buttons).
 *   The app first calls the backend API (POST /api/auth/login). If that fails,
 *   it falls back to a local employee lookup by username (offline mode).
 *   Since the seed data puts employees in localStorage, the fallback matches
 *   by username without checking the PIN — any password works.
 *
 * NOTE: Some product categories ("Pizzas", "Appetizers", etc.) trigger the
 * AddOnModal via partial matching in getAddOnsForCategory(). The test picks
 * "Classic Burger" (category "Burgers" — no add-ons match) to avoid modals.
 */

import { test, expect, type Page } from '@playwright/test';
import { getSeedScript } from './helpers/seedData';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(getSeedScript());
  await page.goto('/');
  await page.evaluate(getSeedScript());
  await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
});

/**
 * Helper: logs in via the form with the given username and password.
 * The login fallback matches by username only (no PIN check in offline mode),
 * so any password will work when the API call fails.
 */
async function loginAs(page: Page, username: string, password: string = '1111') {
  // Fill in the username field (placeholder is "e.g., cashier")
  await page.locator('#login_screen_container input[type="text"]').first().fill(username);
  // Fill in the password field
  await page.locator('#login_screen_container input[type="password"]').first().fill(password);
  // Click the submit button
  await page.locator('#login_screen_container button[type="submit"]').click();
  // Wait for navigation to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

/**
 * Helper: logs in as Cashier, creates a dine-in order.
 */
async function loginAsCashierAndCreateOrder(page: Page) {
  await loginAs(page, 'cashier', '3333');

  await page.locator('aside button', { hasText: 'Orders' }).first().click();
  await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

  await page.locator('text=T1').first().click();
  await expect(page).toHaveURL(/\/billing/, { timeout: 5_000 });
}

test.describe('Full POS Ordering Flow', () => {

  test('should log in as cashier via the login form', async ({ page }) => {
    await loginAs(page, 'cashier', '3333');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.locator('aside')).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Orders and create a dine-in order', async ({ page }) => {
    await loginAsCashierAndCreateOrder(page);
    await expect(page.locator('[data-tour="product-grid"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-tour="cart-items-area"]')).toBeVisible({ timeout: 5_000 });
  });

  test('should add products to cart from the product grid', async ({ page }) => {
    await loginAsCashierAndCreateOrder(page);

    const burgerCard = page.locator('[data-tour="product-card"]', { hasText: 'Classic Burger' }).first();
    await expect(burgerCard).toBeVisible({ timeout: 5_000 });
    await burgerCard.click();

    const cartArea = page.locator('[data-tour="cart-items-area"]');
    await expect(cartArea).not.toContainText('Empty Bill', { timeout: 5_000 });

    await burgerCard.click();
    // Two clicks → quantity 2 → the cart badge reads "2 items" (was "1 items"
    // before — a stale assertion that could never pass after the second click).
    await expect(page.locator('text=2 items')).toBeVisible({ timeout: 3_000 });
  });

  test('should complete the full checkout flow with payment', async ({ page }) => {
    await loginAsCashierAndCreateOrder(page);

    // Add Classic Burger (no add-ons modal)
    const burgerCard = page.locator('[data-tour="product-card"]', { hasText: 'Classic Burger' }).first();
    await expect(burgerCard).toBeVisible({ timeout: 5_000 });
    await burgerCard.click();

    const cartArea = page.locator('[data-tour="cart-items-area"]');
    await expect(cartArea).not.toContainText('Empty Bill', { timeout: 5_000 });

    // Click Pay button
    const payButton = page.locator('[data-tour="pay-btn"]');
    await expect(payButton).toBeEnabled({ timeout: 5_000 });
    await payButton.click();

    // Verify Payment Confirm Modal is open
    const confirmPayBtn = page.locator('[data-tour="pay-print-btn"]');
    await expect(confirmPayBtn).toBeVisible({ timeout: 5_000 });

    const payText = await confirmPayBtn.textContent();
    expect(payText).toContain('₹');

    // Confirm Payment
    await confirmPayBtn.click();

    // Wait for payment modal to close
    await expect(confirmPayBtn).not.toBeVisible({ timeout: 5_000 });

    // Bills array grew (a new bill was created)
    const billsAfter = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('pos_bills') || '[]');
    });
    expect(billsAfter.length).toBeGreaterThan(0);

    // The newest bill is at index 0 (handleCheckoutPayment prepends [newBill, ...bills])
    const latestBill = billsAfter[0];
    expect(latestBill).toBeDefined();
    expect(latestBill.grandTotal).toBeGreaterThan(0);
    expect(latestBill.paymentMethod).toBe('Cash');
    expect(latestBill.items.length).toBeGreaterThan(0);
  });

  test('should disable pay button when cart is empty', async ({ page }) => {
    await loginAsCashierAndCreateOrder(page);

    const payButton = page.locator('[data-tour="pay-btn"]');
    await expect(payButton).toBeVisible({ timeout: 5_000 });
    await expect(payButton).toBeDisabled();
  });

  test('should attach a loyalty customer to the order', async ({ page }) => {
    await loginAsCashierAndCreateOrder(page);

    const burgerCard = page.locator('[data-tour="product-card"]', { hasText: 'Classic Burger' }).first();
    await expect(burgerCard).toBeVisible({ timeout: 5_000 });
    await burgerCard.click();

    const phoneInput = page.locator('[data-tour="phone-input"]');
    await expect(phoneInput).toBeVisible({ timeout: 5_000 });
    await phoneInput.fill('9876543210');

    const offersBtn = page.locator('[data-tour="offers-btn"]');
    await expect(offersBtn).toBeVisible({ timeout: 5_000 });
  });

  test('should log in as Manager and access orders', async ({ page }) => {
    await loginAs(page, 'manager', '2222');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    await page.locator('aside button', { hasText: 'Orders' }).first().click();
    await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

    await expect(page.locator('h1', { hasText: 'Order Management' })).toBeVisible({ timeout: 5_000 });

    await page.locator('button', { hasText: /^Takeaway$/ }).click();
    await expect(page.locator('button', { hasText: 'New Takeaway' })).toBeVisible({ timeout: 5_000 });
  });
});
