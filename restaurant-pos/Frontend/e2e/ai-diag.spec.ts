import { test } from '@playwright/test';

test('minimal load', async ({ page }) => {
  console.log('Starting test...');
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE_ERROR:', msg.text());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Page loaded, URL:', page.url());
  await page.waitForTimeout(2000);
  const title = await page.title().catch(() => 'N/A');
  console.log('Title:', title);
  const loginVisible = await page.locator('#login_screen_container').isVisible().catch(() => false);
  console.log('Login visible:', loginVisible);
  
  // Check body for anything
  const text = await page.locator('body').innerText().catch(() => '');
  console.log('Body text starts:', text.slice(0, 200));
});
