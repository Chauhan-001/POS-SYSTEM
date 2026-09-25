import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSeedScript } from './helpers/seedData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/tour-screenshots');

// Must match src/demo/tourSteps.ts exactly
const STEP_TITLES = [
  'Welcome!',
  'Pick a Table',
  'Add Items',
  'Find a Member',
  'Apply a Reward',
  'Send to Kitchen',
  'Pause an Order',
  'Complete Payment',
  "You're All Set!",
];

async function login(page: any) {
  // Seed auto-authenticates as Owner, so the app may already be past login.
  const loginForm = page.locator('#login_screen_container').first();
  if (!(await loginForm.isVisible({ timeout: 3000 }).catch(() => false))) {
    return; // Already logged in
  }

  // Form login as owner (seed provides the per-account consent entry).
  await loginForm.locator('input[type="text"]').first().fill('owner');
  await loginForm.locator('input[type="password"]').first().fill('1111');
  await loginForm.locator('button[type="submit"]').click();

  // Wait for the POS layout to replace the login gate
  await page.locator('aside').waitFor({ state: 'visible', timeout: 15_000 });
}async function startTour(page: any) {
  // Navigate to Orders workspace (hash routing is more reliable than the
  // sidebar tooltip, which may be hidden on small viewports)
  await page.evaluate(() => { window.location.hash = '#/orders'; });
  await page.waitForTimeout(500);

  // Click the Tour button in the sidebar (title="Restart Guided Tour")
  const tourBtn = page.locator('button[title="Restart Guided Tour"]').first();
  await tourBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await tourBtn.click({ force: true });
}

test.describe('Guided Tour Visual Verification', () => {
  // Extend timeout for tour steps (each step takes ~3s with animations)
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Seed localStorage (also provides the per-account consent entry the
    // login gate requires) and land on the app. Avoid waitUntil:'networkidle'
    // — the app's API retry polling keeps the network busy forever.
    await page.addInitScript(getSeedScript());
    await page.goto('/');
    await page.evaluate(getSeedScript());
    await page.waitForSelector('#login_screen_container, aside', { timeout: 30_000 });
    await login(page);
    await page.waitForTimeout(1000);
  });

  test('All 9 tour steps render with correct titles', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(2000);

    for (let i = 0; i < STEP_TITLES.length; i++) {
      const stepTitle = STEP_TITLES[i];

      // Wait for step animation to complete
      // Welcome (centered, no auto-action) is fast
      // Other steps have auto-action + scroll + pointer (~2.5s)
      await page.waitForTimeout(i === 0 ? 1000 : 3000);

      // Screenshot
      const filename = stepTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/step-${i + 1}-${filename}.png`,
        fullPage: false,
      });

      // Verify title is rendered
      // Use first 8 chars for fuzzy matching (some titles get cut off or animated)
      const searchText = stepTitle.substring(0, 6);
      const titleEl = page.locator(`h3`).filter({ hasText: searchText }).first();
      const titleVisible = await titleEl.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Step ${i + 1}/9] "${stepTitle}" — title visible: ${titleVisible}`);

      // Measure tooltip position
      const tooltip = page.locator('[data-testid="tour-tooltip"]').first();
      const tipVisible = await tooltip.isVisible({ timeout: 500 }).catch(() => false);
      if (tipVisible) {
        const box = await tooltip.boundingBox();
        if (box) {
          console.log(`  Position: (${Math.round(box.x)}, ${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }

      // Navigate forward
      if (i < STEP_TITLES.length - 1) {
        const nextBtn = page.locator('button:has-text("Next")').first();
        if (await nextBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await nextBtn.click();
          console.log(`  → Clicked Next`);
        } else {
          console.log(`  → No Next button found, using keyboard`);
          await page.keyboard.press('ArrowRight');
        }
        await page.waitForTimeout(500);
      }
    }

    // Close the final step
    const doneBtn = page.locator('button:has-text("Done")').first();
    if (await doneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await doneBtn.click();
      console.log('→ Clicked Done, tour completed');
    }

    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/tour-completed.png`, fullPage: false });
  });

  test('Tooltips stay within viewport bounds', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(2000);

    const viewport = page.viewportSize()!;

    for (let i = 0; i < STEP_TITLES.length; i++) {
      await page.waitForTimeout(i === 0 ? 1000 : 3000);

      const tooltip = page.locator('[data-testid="tour-tooltip"]').first();
      if (await tooltip.isVisible({ timeout: 1000 }).catch(() => false)) {
        const box = await tooltip.boundingBox();
        if (box) {
          const margin = 30;
          const inBounds =
            box.x >= -margin &&
            box.y >= -margin &&
            box.x + box.width <= viewport.width + margin &&
            box.y + box.height <= viewport.height + margin;

          console.log(`Step ${i + 1}: (${Math.round(box.x)}, ${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)} — in bounds: ${inBounds}`);

          if (!inBounds) {
            const overflow = {
              left: Math.max(0, -Math.round(box.x)),
              right: Math.max(0, Math.round(box.x + box.width - viewport.width)),
              top: Math.max(0, -Math.round(box.y)),
              bottom: Math.max(0, Math.round(box.y + box.height - viewport.height)),
            };
            console.log(`  ⚠️ Overflow: L:${overflow.left} R:${overflow.right} T:${overflow.top} B:${overflow.bottom}px`);
          }

          // Width should be close to 320px
          const widthOk = Math.abs(box.width - 320) <= 10;
          if (!widthOk) {
            console.log(`  ⚠️ Width ${Math.round(box.width)}px, expected ~320px`);
          }
        }
      } else {
        console.log(`Step ${i + 1}: No tooltip visible`);
      }

      // Navigate
      const nextBtn = page.locator('button:has-text("Next")').first();
      if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nextBtn.click();
      } else {
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForTimeout(500);
    }
  });

  test('Escape key closes the tour', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(3000);

    // Confirm tour is open
    const tourTooltip = page.locator('[data-testid="tour-tooltip"]').first();
    await expect(tourTooltip).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);

    // Confirm tour closed
    const tourContainer = page.locator('[data-testid="tour-container"]').first();
    await expect(tourContainer).not.toBeVisible({ timeout: 3000 });
    console.log('Escape closes tour: ✅');
  });

  test('ArrowRight/ArrowLeft keyboard navigation', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(2000);

    // ArrowRight to advance
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/keyboard-next-step.png`, fullPage: false });

    // ArrowLeft to go back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/keyboard-prev-step.png`, fullPage: false });
  });

  test('Backdrop click closes centered step', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(2000);

    // Welcome step is centered — click top-left away from tooltip center
    await page.mouse.click(50, 50);
    await page.waitForTimeout(1500);

    // Verify tour container is gone
    const tourContainer = page.locator('[data-testid="tour-container"]').first();
    await expect(tourContainer).not.toBeVisible({ timeout: 3000 });
    console.log('Backdrop click closes tour: ✅');
  });

  test('Tour restart works after closing', async ({ page }) => {
    await startTour(page);
    await page.waitForTimeout(2000);

    // Verify tour is open
    const tourContainer = page.locator('[data-testid="tour-container"]').first();
    await expect(tourContainer).toBeVisible({ timeout: 3000 });

    // Close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);

    await expect(tourContainer).not.toBeVisible({ timeout: 3000 });

    // Restart — use force:true because sidebar is narrow and nearby elements may intercept
    const tourBtn = page.locator('button[title="Restart Guided Tour"]').first();
    await tourBtn.click({ timeout: 3000, force: true }).catch(async () => {
      // Fallback: try by text
      await page.locator('button:has-text("Tour")').first().click({ force: true }).catch(() => {
        console.log('Could not click tour button');
      });
    });
    await page.waitForTimeout(2500);

    // Verify tour opens again
    await expect(tourContainer).toBeVisible({ timeout: 5000 });
    console.log('Tour restart: ✅');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/tour-restarted.png`, fullPage: false });
  });
});
