/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E tests for the "tap card → open billing → close order → redirect back to
 * the previous Orders view" flow, for BOTH table (dine-in) and takeaway cards.
 *
 * Verified behaviors:
 *   1. Tapping an Available table card opens Billing (product grid + cart).
 *   2. Closing the order redirects back to /orders and the table is freed.
 *   3. All OTHER table cards keep their correct state (not corrupted by close).
 *   4. Tapping a takeaway card opens Billing for that order.
 *   5. Closing a takeaway order redirects back to /orders AND restores the
 *      Takeaway tab the operator came from, with the row cleaned up.
 *   6. The table view mode (grid vs floor plan) is restored after close.
 *
 * Screenshots are captured at each critical step under e2e/screenshots/.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { getSeedScript } from './helpers/seedData';

const SHOT_DIR = 'e2e/screenshots/close-redirect';
mkdirSync(SHOT_DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(getSeedScript());
  await page.goto('/');
  await page.evaluate(getSeedScript());
  // The app boots to the login screen (same as the existing ordering-flow spec).
  await page.waitForSelector('#login_screen_container', { timeout: 30_000 });
});

/** Log in via the form as the seeded Owner (offline fallback matches by username). */
async function loginAsOwner(page: Page) {
  await page.locator('#login_screen_container input[type="text"]').first().fill('owner');
  await page.locator('#login_screen_container input[type="password"]').first().fill('1111');
  await page.locator('#login_screen_container button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

/** Navigate to the Orders workspace — from the dashboard use the sidebar; from
 * the Billing screen (where the sidebar is hidden) use the "Back to Orders"
 * button in the billing header. */
async function goToOrders(page: Page) {
  if (page.url().includes('/billing')) {
    // Icon-only button (title="Back to Orders", no text content).
    await page.locator('button[title="Back to Orders"]').first().click();
  } else {
    await page.locator('aside button', { hasText: 'Orders' }).first().click();
  }
  await expect(page).toHaveURL(/\/orders/, { timeout: 8_000 });
}

/** Open a table card and land on the Billing screen with product grid + cart.
 * When the previous cart still holds items, starting a new order prompts
 * "Start a new order?" — confirm it (items stay saved on the prior order). */
async function openTableOrder(page: Page, tableLabel: string) {
  const card = page.locator('[data-tour="table-card"]', { hasText: tableLabel }).first();
  await expect(card).toBeVisible({ timeout: 8_000 });
  await card.click();
  const startDlg = page.getByText('Start a new order?');
  try {
    await startDlg.waitFor({ state: 'visible', timeout: 3_000 });
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  } catch {
    /* no confirmation needed — cart was empty */
  }
  await expect(page).toHaveURL(/\/billing/, { timeout: 8_000 });
  await expect(page.locator('[data-tour="product-grid"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-tour="cart-items-area"]')).toBeVisible({ timeout: 8_000 });
}

/** Add Classic Burger (category "Burgers" — no add-on modal) to the cart. */
async function addBurger(page: Page) {
  const burger = page.locator('[data-tour="product-card"]', { hasText: 'Classic Burger' }).first();
  await expect(burger).toBeVisible({ timeout: 8_000 });
  await burger.click();
  await expect(page.locator('[data-tour="cart-items-area"]')).toContainText('Classic Burger', { timeout: 5_000 });
}

/** Click the Close button and confirm in the dialog. */
async function closeOrderAndConfirm(page: Page) {
  const closeBtn = page.locator('[data-tour="close-order-btn"]');
  await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  await closeBtn.click();
  // Confirmation dialog ("Close this order?") → Confirm
  await expect(page.getByText('Close this order?')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  // Redirect back to Orders
  await expect(page).toHaveURL(/\/orders/, { timeout: 8_000 });
}

test.describe('Close-order redirect + card state integrity', () => {

  test('table card: tap → billing → close → redirect + all cards stay correct', async ({ page }) => {
    await loginAsOwner(page);
    await goToOrders(page);

    // Baseline: all 8 seeded tables visible and Available.
    for (let n = 1; n <= 8; n++) {
      await expect(page.locator('[data-tour="table-card"]', { hasText: `T${n}` }).first()).toBeVisible({ timeout: 5_000 });
    }

    await openTableOrder(page, 'T1');
    await addBurger(page);
    await shot(page, '01-billing-open-after-tap-T1');

    await closeOrderAndConfirm(page);
    await shot(page, '02-after-close-redirected-to-orders');

    // T1 must be freed again (Available).
    const t1 = page.locator('[data-tour="table-card"]', { hasText: 'T1' }).first();
    await expect(t1).toBeVisible({ timeout: 5_000 });
    await expect(t1).toContainText('Available', { timeout: 5_000 });

    // All other cards must still be present and Available (states not corrupted).
    for (let n = 2; n <= 8; n++) {
      const card = page.locator('[data-tour="table-card"]', { hasText: `T${n}` }).first();
      await expect(card).toBeVisible({ timeout: 5_000 });
      await expect(card).toContainText('Available', { timeout: 5_000 });
    }
    await shot(page, '03-all-table-cards-available');
  });

  test('takeaway: create → tap card → billing → close → redirect to Takeaway tab, row cleaned up', async ({ page }) => {
    await loginAsOwner(page);
    await goToOrders(page);

    // Switch to the Takeaway tab (exact role name — avoids the "Manage Tables"
    // header button which also contains the word "Tables").
    await page.getByRole('button', { name: /^Takeaway/ }).click();
    await expect(page.getByText('No takeaway orders')).toBeVisible({ timeout: 5_000 });

    // Create a takeaway order → lands on Billing.
    await page.locator('button', { hasText: 'New Takeaway' }).first().click();
    await expect(page).toHaveURL(/\/billing/, { timeout: 8_000 });
    await expect(page.locator('[data-tour="product-grid"]')).toBeVisible({ timeout: 8_000 });
    await addBurger(page);
    await shot(page, '10-takeaway-billing-open');

    // Go back to Orders → Takeaway tab and TAP the takeaway card — it must open
    // the SAME order in Billing (cart visible with the burger).
    await goToOrders(page);
    await page.getByRole('button', { name: /^Takeaway/ }).click();
    const twCard = page.locator('div.rounded-xl').filter({ hasText: 'Preparing' }).first();
    await expect(twCard).toBeVisible({ timeout: 5_000 });
    await shot(page, '11-takeaway-card-visible');

    await twCard.click();
    await expect(page).toHaveURL(/\/billing/, { timeout: 8_000 });
    await expect(page.locator('[data-tour="cart-items-area"]')).toContainText('Classic Burger', { timeout: 5_000 });
    await shot(page, '12-takeaway-card-opened-billing');

    // Close the takeaway order → back to Orders with the Takeaway tab restored.
    await closeOrderAndConfirm(page);
    await shot(page, '13-after-close-redirected-to-orders');

    // The Takeaway tab must still be active (restored) and the row removed.
    await expect(page.locator('button', { hasText: 'New Takeaway' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No takeaway orders')).toBeVisible({ timeout: 5_000 });

    // Tables tab unaffected — all still Available.
    await page.getByRole('button', { name: /^Tables/ }).click();
    for (let n = 1; n <= 8; n++) {
      await expect(page.locator('[data-tour="table-card"]', { hasText: `T${n}` }).first()).toBeVisible({ timeout: 5_000 });
    }
    await shot(page, '14-tables-intact-after-takeaway-close');
  });

  test('closing one occupied table does not disturb another occupied table', async ({ page }) => {
    await loginAsOwner(page);
    await goToOrders(page);

    // Occupy T1 and T2 (two separate orders).
    await openTableOrder(page, 'T1');
    await addBurger(page);
    await goToOrders(page);
    await openTableOrder(page, 'T2');
    await addBurger(page);
    await shot(page, '30-two-tables-occupied-billing');

    // Close ONLY the T2 order.
    await closeOrderAndConfirm(page);
    await shot(page, '31-after-closing-T2-only');

    // T2 freed again.
    const t2 = page.locator('[data-tour="table-card"]', { hasText: 'T2' }).first();
    await expect(t2).toContainText('Available', { timeout: 5_000 });

    // T1 must STILL be occupied (its order untouched). Occupied cards show the
    // live timer in the status pill (not the word "Occupied") plus the "Order"
    // CTA — assert on those, and that it's NOT Available.
    const t1 = page.locator('[data-tour="table-card"]', { hasText: 'T1' }).first();
    await expect(t1).not.toContainText('Available', { timeout: 5_000 });
    await expect(t1).toContainText('Order', { timeout: 5_000 });
    await t1.click();
    await expect(page).toHaveURL(/\/billing/, { timeout: 8_000 });
    await expect(page.locator('[data-tour="cart-items-area"]')).toContainText('Classic Burger', { timeout: 5_000 });
    await shot(page, '32-T1-order-intact-after-T2-close');
  });

  test('view mode (floor plan) restored after close', async ({ page }) => {
    await loginAsOwner(page);
    await goToOrders(page);

    // Switch to floor plan view.
    await page.locator('button[title="Floor plan view"]').click();

    // Tap the first available table inside the floor plan (seats a guest).
    // force: the auto-laid-out floor cards are small and their inner label
    // span can intercept the pointer during Playwright's actionability check.
    await page.locator('[data-tour="table-card"]').first().click({ force: true });
    await expect(page).toHaveURL(/\/billing/, { timeout: 8_000 });
    await expect(page.locator('[data-tour="product-grid"]')).toBeVisible({ timeout: 8_000 });

    await closeOrderAndConfirm(page);

    // Floor plan view must still be active (its toggle keeps the active style).
    const floorToggle = page.locator('button[title="Floor plan view"]');
    await expect(floorToggle).toBeVisible({ timeout: 5_000 });
    const cls = await floorToggle.getAttribute('class');
    expect(cls).toContain('bg-emerald-700');
    await shot(page, '20-floorplan-restored-after-close');
  });
});
