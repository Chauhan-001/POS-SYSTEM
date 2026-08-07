/**
 * Quick diagnostic — checks app state on load and takes screenshots
 */
import { test } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/ai-qa-screenshots');

test('Diagnose app state', async ({ page }) => {
  // Capture console errors
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/diagnostic-initial.png`, fullPage: true });

  // Log what we see
  const bodyText = await page.locator('body').innerText().catch(() => 'N/A');
  const url = page.url();
  const loginVisible = await page.locator('#login_screen_container').isVisible().catch(() => false);
  const sidebarVisible = await page.locator('aside').isVisible().catch(() => false);
  const html = await page.locator('html').innerHTML().catch(() => '');

  console.log('URL:', url);
  console.log('Login screen visible:', loginVisible);
  console.log('Sidebar visible:', sidebarVisible);
  console.log('Page errors:', JSON.stringify(errors.slice(0, 5)));
  console.log('Body text (first 300 chars):', bodyText.slice(0, 300));
  console.log('HTML length:', html.length);
});
