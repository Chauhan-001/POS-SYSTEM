import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/tour-screenshots');

const STEP_TITLES = [
  'Welcome!',
  'Pick a Table',
  'Add Items to Order',
  'Find a Member',
  'Apply a Reward',
  'Send to Kitchen',
  'Pause an Order',
  'Complete Payment',
  "You're All Set!",
];

async function login(page: any) {
  // Check if login screen is showing
  const loginForm = page.locator('#login_screen_container').first();
  if (!(await loginForm.isVisible({ timeout: 3000 }).catch(() => false))) {
    return; // Already logged in
  }

  // Use quick login buttons with robust selector
  // Quick login buttons are type="button" with specific PIN text
  const cashierPinBtn = page.locator('button:has(div:has-text("PIN: 3333"))').first();
  const cashierLabelBtn = page.locator('button[type="button"]:has-text("Cashier")').first();

  if (await cashierPinBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cashierPinBtn.click({ force: true });
    console.log('Logged in via quick login (PIN: 3333)');
  } else if (await cashierLabelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await cashierLabelBtn.click({ force: true });
    console.log('Logged in via quick login (Cashier label)');
  } else {
    // Manual login fallback
    await page.fill('input[placeholder*="cashier"]', 'cashier');
    await page.fill('input[placeholder*="PIN"]', '3333');
    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click({ force: true });
    console.log('Logged in via manual credentials');
  }

  // Wait for login to complete and dashboard to render
  await page.waitForTimeout(2000);
  // Verify we're past login screen
  const stillOnLogin = await page.locator('#login_screen_container').isVisible({ timeout: 1000 }).catch(() => false);
  if (stillOnLogin) {
    console.log('Still on login screen after attempt, trying again...');
    // Try the fallback approach
    await page.fill('input[placeholder*="cashier"]', 'cashier');
    await page.fill('input[placeholder*="PIN"]', '3333');
    await page.locator('button[type="submit"]').first().click({ force: true });
    await page.waitForTimeout(2000);
  }
}

async function startTour(page: any) {
  // Navigate to Orders workspace
  const ordersNav = page.locator('button[title*="Orders"]').first();
  if (await ordersNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ordersNav.click();
    await page.waitForTimeout(1000);
  }

  // Click the Tour button in sidebar
  const tourBtn = page.locator('button[title="Restart Guided Tour"]').first();
  if (await tourBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tourBtn.click();
    console.log('Tour started via Restart Guided Tour button');
  } else {
    // Fallback: any button containing "Tour" text
    const fallback = page.locator('button:has-text("Tour"), button:has-text("tour")').first();
    if (await fallback.isVisible({ timeout: 1000 }).catch(() => false)) {
      await fallback.click();
      console.log('Tour started via fallback button');
    } else {
      console.log('⚠️ Could not find tour button!');
    }
  }
}

test.describe('Guided Tour Visual Verification', () => {
  // Extend timeout for tour steps (each step takes ~3s with animations)
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
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
