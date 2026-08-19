import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated Playwright config for the Owner → Recommendation → Offer → Customer
 * E2E suite (operational-confidence audit).
 *
 * NOTE on ports: the POS app dev server runs on :5178 in this workspace
 * (:5173 is the admin dashboard, :5177 the customer site). This config targets
 * the POS app and reuses the already-running dev server when present
 * (reuseExistingServer) — in CI it starts its own Vite instance.
 */
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://localhost:5178';

export default defineConfig({
  testDir: './e2e',
  testMatch: /owner-recommendation-flow\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // The suite shares one backend dataset — must run sequentially.
  timeout: 90_000,
  reporter: [
    ['html', { outputFolder: 'playwright-report-owner-recommendation', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 5178',
    cwd: '.',
    url: FRONTEND_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
