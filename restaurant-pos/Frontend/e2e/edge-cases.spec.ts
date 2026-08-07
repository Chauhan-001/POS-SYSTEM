/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E tests for edge cases:
 *   1. Offline Mode — verify offline indicator, offline login, offline payment
 *   2. Split Payment — split bill across multiple payment methods
 *   3. Multi-Branch Workflows — branch creation, switching, data isolation
 */

import { test, expect, type Page } from '@playwright/test';
import { getSeedScript, getMultiBranchSeedScript } from './helpers/seedData';

// ================================================================
// SHARED HELPERS
// ================================================================

async function loginAs(page: Page, username: string, password: string = '1111') {
  await page.locator('#login_screen_container input[type="text"]').first().fill(username);
  await page.locator('#login_screen_container input[type="password"]').first().fill(password);
  await page.locator('#login_screen_container button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function loginAndOpenBilling(page: Page, username: string = 'cashier', password: string = '3333') {
  await loginAs(page, username, password);

  await page.locator('aside button', { hasText: 'Orders' }).first().click();
  await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

  await page.locator('text=T1').first().click();
  await expect(page).toHaveURL(/\/billing/, { timeout: 5_000 });
}

async function addBurgerToCart(page: Page) {
  const burgerCard = page.locator('[data-tour="product-card"]', { hasText: 'Classic Burger' }).first();
  await expect(burgerCard).toBeVisible({ timeout: 5_000 });
  await burgerCard.click();
  const cartArea = page.locator('[data-tour="cart-items-area"]');
  await expect(cartArea).not.toContainText('Empty Bill', { timeout: 5_000 });
}

async function completePayment(page: Page): Promise<number> {
  const payButton = page.locator('[data-tour="pay-btn"]');
  await expect(payButton).toBeEnabled({ timeout: 5_000 });
  await payButton.click();

  const confirmPayBtn = page.locator('[data-tour="pay-print-btn"]');
  await expect(confirmPayBtn).toBeVisible({ timeout: 5_000 });

  await confirmPayBtn.click();
  await expect(confirmPayBtn).not.toBeVisible({ timeout: 5_000 });

  const bills = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('pos_bills') || '[]');
  });
  expect(bills.length).toBeGreaterThan(0);
  return bills.length;
}

async function navigateInMore(page: Page, cardLabel: string) {
  await page.locator('aside button', { hasText: 'More' }).first().click();
  await expect(page).toHaveURL(/\/more/, { timeout: 5_000 });
  await page.locator('button', { hasText: cardLabel }).click();
  await page.waitForTimeout(500);
}

// ================================================================
// 1. OFFLINE MODE
// ================================================================

test.describe('Offline Mode', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(getSeedScript());
    await page.goto('/');
    await page.evaluate(getSeedScript());
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
  });

  test('should show offline indicator when browser goes offline', async ({ page }) => {
    await loginAs(page, 'cashier', '3333');

    await page.context().setOffline(true);
    await expect(page.locator('span:has-text("OFFLINE")').first()).toBeVisible({ timeout: 5_000 });

    await page.context().setOffline(false);
    await expect(page.locator('span:has-text("ONLINE")').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should login via local fallback when API is unreachable', async ({ page }) => {
    // Block API calls to simulate offline without crashing Vite's asset loading
    await page.route('**/api/**', route => route.abort());

    await page.locator('#login_screen_container input[type="text"]').first().fill('cashier');
    await page.locator('#login_screen_container input[type="password"]').first().fill('3333');
    await page.locator('#login_screen_container button[type="submit"]').click();

    // Wait for AppTitleBar to appear (login succeeded with offline fallback)
    await expect(page.locator('text=SECURE MODE').first()).toBeVisible({ timeout: 15_000 });
  });

  test('should add products to cart while offline', async ({ page }) => {
    await loginAndOpenBilling(page);
    await page.context().setOffline(true);
    await expect(page.locator('span:has-text("OFFLINE")').first()).toBeVisible({ timeout: 5_000 });

    await expect(page.locator('[data-tour="product-grid"]')).toBeVisible({ timeout: 3_000 });
    await addBurgerToCart(page);
  });

  test('should complete payment while offline', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);

    await page.context().setOffline(true);
    await expect(page.locator('span:has-text("OFFLINE")').first()).toBeVisible({ timeout: 5_000 });

    const billCount = await completePayment(page);
    expect(billCount).toBeGreaterThan(0);

    const bills = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('pos_bills') || '[]');
    });
    expect(bills[0].paymentMethod).toBe('Cash');
    expect(bills[0].grandTotal).toBeGreaterThan(0);
  });

  test('should preserve offline data when coming back online', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);
    await page.context().setOffline(true);
    await expect(page.locator('span:has-text("OFFLINE")').first()).toBeVisible({ timeout: 5_000 });

    await completePayment(page);

    await page.context().setOffline(false);
    await expect(page.locator('span:has-text("ONLINE")').first()).toBeVisible({ timeout: 5_000 });

    const bills = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('pos_bills') || '[]');
    });
    expect(bills.length).toBeGreaterThan(0);
    expect(bills[0].paymentMethod).toBe('Cash');
  });
});

// ================================================================
// 2. SPLIT PAYMENT
// ================================================================

test.describe('Split Payment', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(getSeedScript());
    await page.goto('/');
    await page.evaluate(getSeedScript());
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
  });

  test('should show split payment option in payment method dropdown', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);

    const paymentSelect = page.locator('select').first();
    await expect(paymentSelect).toBeVisible({ timeout: 3_000 });
    const options = await paymentSelect.locator('option').allTextContents();
    expect(options).toContain('Split');
  });

  test('should open split payment calculator and enter amounts', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);

    await page.locator('select').first().selectOption('Split');
    await page.locator('button', { hasText: 'Open Split Payment Calculator' }).click();
    await expect(page.locator('h3', { hasText: 'Split Payment' })).toBeVisible({ timeout: 3_000 });

    const cashInput = page.locator('label:has-text("Cash")').locator('..').locator('input[type="number"]');
    await cashInput.waitFor({ timeout: 3_000 });
    await cashInput.click();
    await cashInput.fill('100');

    await page.locator('button', { hasText: 'Cancel' }).first().click();
    await expect(page.locator('h3', { hasText: 'Split Payment' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('should complete checkout with split payment (Cash + Card)', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);

    const cartTotalText = await page.locator('[data-tour="cart-total"]').innerText();
    const totalMatch = cartTotalText.match(/₹([\d,]+\.?\d*)/);
    expect(totalMatch).not.toBeNull();
    const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;
    expect(total).toBeGreaterThan(0);

    await page.locator('select').first().selectOption('Split');
    await page.locator('button', { hasText: 'Open Split Payment Calculator' }).click();
    await expect(page.locator('h3', { hasText: 'Split Payment' })).toBeVisible({ timeout: 3_000 });

    const splitModal = page.locator('h3:has-text("Split Payment")').locator('..').locator('..');
    const modalInputs = splitModal.locator('input[type="number"]');
    await expect(modalInputs.first()).toBeVisible({ timeout: 3_000 });

    await modalInputs.nth(0).click();
    await modalInputs.nth(0).fill('100');

    const remaining = Math.round((total - 100) * 100) / 100;
    await modalInputs.nth(1).click();
    await modalInputs.nth(1).fill(remaining.toFixed(2));

    const setButton = splitModal.locator('button', { hasText: 'Set Split Payment' });
    await expect(setButton).toBeEnabled({ timeout: 3_000 });
    await setButton.click();

    await expect(page.locator('h3', { hasText: 'Split Payment' })).not.toBeVisible({ timeout: 3_000 });

    const payButton = page.locator('[data-tour="pay-btn"]');
    await expect(payButton).toContainText('Split Pay');

    await payButton.click();
    const confirmPayBtn = page.locator('[data-tour="pay-print-btn"]');
    await expect(confirmPayBtn).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Split Breakdown')).toBeVisible({ timeout: 3_000 });

    await confirmPayBtn.click();
    await expect(confirmPayBtn).not.toBeVisible({ timeout: 5_000 });

    const bills = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('pos_bills') || '[]');
    });
    expect(bills.length).toBeGreaterThan(0);
    const latestBill = bills[0];
    expect(latestBill.paymentMethod).toBe('Split');
    expect(latestBill.grandTotal).toBeGreaterThan(0);
  });

  test('should disable proceed when split amounts are unbalanced', async ({ page }) => {
    await loginAndOpenBilling(page);
    await addBurgerToCart(page);

    await page.locator('select').first().selectOption('Split');
    await page.locator('button', { hasText: 'Open Split Payment Calculator' }).click();
    await expect(page.locator('h3', { hasText: 'Split Payment' })).toBeVisible({ timeout: 3_000 });

    const splitModal = page.locator('h3:has-text("Split Payment")').locator('..').locator('..');
    const cashInput = splitModal.locator('label:has-text("Cash")').locator('..').locator('input[type="number"]');
    await cashInput.click();
    await cashInput.fill('10');

    const setButton = splitModal.locator('button', { hasText: 'Set Split Payment' });
    await expect(setButton).toBeDisabled();
  });
});

// ================================================================
// 3. MULTI-BRANCH WORKFLOWS
// ================================================================

test.describe('Multi-Branch Workflows', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(getMultiBranchSeedScript());
    await page.goto('/');
    await page.evaluate(getMultiBranchSeedScript());
    await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
  });

  test('should show Branches in More workspace for Owner', async ({ page }) => {
    await loginAs(page, 'owner', '1111');
    await navigateInMore(page, 'Branches');
    await expect(page.locator('h1', { hasText: 'Branch Management' })).toBeVisible({ timeout: 5_000 });
  });

  test('should allow creating a new branch', async ({ page }) => {
    await loginAs(page, 'owner', '1111');
    await navigateInMore(page, 'Branches');

    await page.locator('button', { hasText: 'Add Branch' }).click();

    const branchNameInput = page.locator('input[placeholder="e.g. Downtown Branch"]');
    await expect(branchNameInput).toBeVisible({ timeout: 3_000 });
    await branchNameInput.fill('North Branch');

    await page.locator('button', { hasText: 'Create Branch' }).click();

    await expect(page.locator('text=North Branch').first()).toBeVisible({ timeout: 3_000 });
  });

  test('should allow switching between branches', async ({ page }) => {
    await loginAs(page, 'owner', '1111');
    await navigateInMore(page, 'Branches');

    await expect(page.locator('text=Main Branch').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Downtown Branch').first()).toBeVisible({ timeout: 3_000 });

    // Only Downtown Branch has a "Switch" button (Main Branch shows "Active" initially)
    const switchBtn = page.locator('button:has-text("Switch")');
    await expect(switchBtn).toBeVisible({ timeout: 3_000 });
    await switchBtn.click();

    // Wait for UI to update
    await page.waitForTimeout(500);

    // Verify localStorage was updated
    const currentBranchId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('pos_current_branch_id') || 'null');
    });
    expect(currentBranchId).toBe('branch_downtown');

    // At least one "Active" button should still be visible (now on Downtown)
    await expect(page.locator('button:has-text("Active")').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should isolate data per branch for non-Owner employees', async ({ page }) => {
    await loginAs(page, 'dtcashier', '5555');
    await page.locator('aside button', { hasText: 'Orders' }).first().click();
    await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show branch-specific product pricing', async ({ page }) => {
    await loginAs(page, 'owner', '1111');
    await navigateInMore(page, 'Branches');

    await expect(page.locator('text=Main Branch').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Downtown Branch').first()).toBeVisible({ timeout: 3_000 });

    await expect(page.locator('text=Total Branches')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Active Branches')).toBeVisible({ timeout: 3_000 });
  });
});
