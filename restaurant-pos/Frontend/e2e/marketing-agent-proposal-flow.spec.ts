/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing agent LOOP E2E — run the agent, save its plan as a proposal,
 * submit it, and approve it, through the real UI and real backend
 * (no mocks, no injected auth, no DB inserts for the journey itself).
 *
 * Covers: RecommendationsPage (Run agent / Save as proposal) →
 *         ProposalsInbox (Submit for approval / Approve) →
 *         persisted approval status verified over the API afterwards.
 *
 * Prerequisites:
 *   - Backend running on :3002 with the sim tenant seeded
 *     (login sim_urban_tadka / 246810, ML segments + context synced —
 *     otherwise the agent returns NONE and "Save as proposal" is disabled)
 *   - Playwright's webServer starts the POS dev server on :5175 (auto)
 *
 * Setup/cleanup: same-day agent proposals are swept first via
 * backend/scripts/reset-agent-proposals.mjs so reruns never trip the
 * duplicate-name gate (an 'approved' same-day proposal cannot be rejected).
 *
 * Run (from restaurant-pos/Frontend/):
 *   npx playwright test e2e/marketing-agent-proposal-flow.spec.ts
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(E2E_DIR, '..', '..', '..', 'backend');
const API_BASE = 'http://localhost:3002';

const OWNER = { username: 'sim_urban_tadka', password: '246810' };
// One stable terminal id for the whole suite — a fresh-context login registers
// a device and the tenant caps at 20; reusing one id keeps reruns free of the
// device limit (same strategy as owner-recommendation-flow.spec.ts).
const STABLE_DEVICE_ID = 'dev_e2e_marketing_agent_flow';

/** Proposal names end with the UTC date (agent naming) — same clock here. */
const TODAY_UTC = new Date().toISOString().slice(0, 10);

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: OWNER });
  expect(res.ok(), `backend login failed (${res.status()}) — is the backend running on :3002?`).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string };
  expect(body.accessToken, 'login response missing accessToken').toBeTruthy();
  return body.accessToken as string;
}

async function loginAsOwner(page: Page) {
  await page.addInitScript((deviceId) => {
    try { window.localStorage.setItem('pos_device_id', deviceId); } catch { /* ignore */ }
  }, STABLE_DEVICE_ID);
  await page.goto('/');
  await expect(page.locator('#login_screen_container')).toBeVisible({ timeout: 20_000 });
  await page.locator('#login_screen_container input[type="text"]').fill(OWNER.username);
  await page.locator('#login_screen_container input[type="password"]').fill(OWNER.password);
  // Sign In stays disabled until the T&C box is ticked.
  await page.getByRole('checkbox', { name: /I agree to the Terms/i }).click();
  await expect(page.getByRole('button', { name: 'Sign In to POS' })).toBeEnabled({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Sign In to POS' }).click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 25_000 });
}

test.describe.serial('Marketing agent → proposal → approval (loop E2E)', () => {
  test('runs the agent, saves a proposal and approves it', async ({ page, request }) => {
    test.setTimeout(120_000); // cold Vite compile + agent call + lifecycle steps

    const token = await apiLogin(request);

    // ── Setup: clean same-day agent proposals (rerun-safe, no duplicates) ──
    try {
      execFileSync('node', ['scripts/reset-agent-proposals.mjs'], { cwd: BACKEND_DIR, stdio: 'pipe' });
    } catch (e: any) {
      throw new Error(`same-day proposal cleanup failed: ${String(e?.stderr || e?.message)}`);
    }

    // ── 1. Real owner login → Marketing → Recommendations ──
    await loginAsOwner(page);
    await page.goto('/#/offers');
    await expect(page.getByRole('navigation', { name: 'Marketing sections' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('navigation', { name: 'Marketing sections' }).getByRole('button', { name: /Recommendations/ }).click();
    await expect(page.getByText(/Opportunities for you/i)).toBeVisible({ timeout: 20_000 });

    // ── 2. Run the agent — targeting plan with evidence must render ──
    await page.getByRole('button', { name: 'Run agent' }).click();
    await expect(page.getByText('Why:')).toBeVisible({ timeout: 30_000 });          // targetingReason
    await expect(page.getByText('ML segments')).toBeVisible();                       // targetingSource badge (ML_SEGMENTS)
    await expect(page.getByRole('button', { name: 'Save as proposal' })).toBeEnabled();
    // Evidence lines (festival / competition / basket context) — the agent's
    // context must be visible, not just the targeting labels.
    await expect(page.locator('li').filter({ hasText: /context:/i }).first()).toBeVisible();

    // ── 3. Save the plan as a proposal ──
    await page.getByRole('button', { name: 'Save as proposal' }).click();
    await expect(page.getByText('Proposal sent to your approvals.')).toBeVisible({ timeout: 30_000 });

    // ── 4. Jump to Approvals and find OUR card ──
    // The h4 is a friendly title; the raw `OBJECTIVE • SOURCE • date` receipt
    // line inside the card carries today's UTC date — scope the card by it.
    await page.getByRole('button', { name: 'Review it →' }).click();
    const card = page.locator('div.rounded-2xl').filter({ hasText: new RegExp(TODAY_UTC) }).first();
    const heading = card.getByRole('heading', { level: 4 });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Draft', { exact: true })).toBeVisible();           // approvalStatus: pending

    // ── 4b. Click the card → the "Why this recommendation" panel reveals the
    // humanized evidence (audience pick explained, no jargon). ──
    await card.getByRole('button', { name: 'Why this recommendation' }).click();
    await expect(card.getByText(/audience was picked using/i).first()).toBeVisible({ timeout: 10_000 });

    // ── 5. Submit for approval → validated server-side ──
    await card.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(card.getByText('Ready for approval')).toBeVisible({ timeout: 30_000 });

    // ── 6. Approve — closes the loop ──
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card.getByText(/Approved — hand off to Promote/)).toBeVisible({ timeout: 30_000 });

    // ── 7. Server-side truth: the approval persisted, not just the UI ──
    const inbox = await request.get(`${API_BASE}/api/campaigns/proposals?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(inbox.ok()).toBeTruthy();
    const body = (await inbox.json()) as {
      proposals?: Array<{ name: string; approvalStatus: string; source?: string }>;
    };
    const approved = (body.proposals ?? []).filter(
      (p) => p.name.includes(TODAY_UTC) && p.source === 'agent' && p.approvalStatus === 'approved',
    );
    expect(approved.length, 'expected an approved same-day agent proposal on the server').toBeGreaterThan(0);
  });
});
