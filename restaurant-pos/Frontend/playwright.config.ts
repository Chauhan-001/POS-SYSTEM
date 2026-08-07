import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for POS Terminal E2E tests.
 * Uses the Vite dev server (runs at port 5173).
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Run sequentially to avoid DB/localStorage conflicts
  // Phase 1.10: generous per-test timeout — the FIRST page load after a clean
  // install triggers a full Vite cold-compile of the large POS bundle, which
  // can exceed the default 30s on slower machines (later tests reuse the
  // module cache and finish in seconds).
  timeout: 60_000,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  /* Shared settings for all projects */
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Simulate a typical POS terminal viewport (1280×720) */
    viewport: { width: 1280, height: 720 },
  },

  /* Web server — starts Vite dev server before tests */
  webServer: {
    command: 'npx vite --port 5173',
    cwd: '.',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
