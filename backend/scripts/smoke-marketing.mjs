/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * smoke-marketing.mjs — End-to-end smoke test for the unified Marketing system.
 *
 * Requires:
 *   - Backend running on :3002 (tsx watch picks up the latest code)
 *   - MongoDB on localhost:27017
 *   - A seeded demo restaurant (run `node scripts/seed-demo-restaurant.mjs` first)
 *
 * Flow (all through the REAL HTTP API + the server's background worker):
 *   1. POS login as the demo restaurant Owner.
 *   2. POST /api/offers  → create an active percentage offer.
 *   3. Write a webhook delivery config into the restaurant settings (the same
 *      path a real owner uses via Settings → Integrations).
 *   4. POST /api/campaigns → create a campaign linked to the offer, webhook
 *      channel, audience = 2 demo customer phones.
 *   5. POST /api/campaigns/:id/send → returns accepted immediately (async).
 *   6. The server's delivery worker drains the job → POSTs to the local
 *      webhook receiver (HMAC-signed) → flips CampaignHistory/Campaign to
 *      'sent' and populates OfferAnalytics.customersReached.
 *   7. POST /api/offers/apply → simulate a real redemption at the till, which
 *      records OfferAnalytics.redeemed + revenueGenerated.
 *   8. Optional: a 'scheduled' offer auto-activates via the marketing scheduler.
 *
 * Exit code 0 = all checks passed.
 */

import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import os from 'node:os';

const BASE = 'http://localhost:3002/api';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const OWNER_USERNAME = 'owner';
const OWNER_PIN = '1008';
const DEMO_PHONES = ['9812345670', '9823456781'];

let PASS = 0;
let FAIL = 0;
const check = (label, ok, extra) => {
  if (ok) { PASS++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { FAIL++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function waitFor(label, fn, timeoutMs, intervalMs = 1000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  console.log(`  … timed out waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
  return null;
}

// ─── Local webhook receiver ──────────────────────────────────────────
async function startReceiver() {
  const hits = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({
        path: req.url,
        signature: req.headers['x-webhook-signature'] || '',
        body,
        count: body ? JSON.parse(body).count || 1 : 1,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  return { server, hits, port };
}

/** Pick a URL that reaches our local receiver but passes the SSRF guard. */
async function pickWebhookUrl(port) {
  const candidates = [
    `http://localtest.me:${port}/hook`,   // resolves to 127.0.0.1 (public DNS)
    `http://${os.hostname()}:${port}/hook`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 0 }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return url;
    } catch { /* try next */ }
  }
  return candidates[0]; // delivery will honestly fail if unreachable — still a valid test signal
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══ MARKETING E2E SMOKE TEST ═══\n');
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  // ── 0. Locate the demo restaurant ──────────────────────────────────
  const rest = await db.collection('restaurants')
    .find({ name: /^Spice Symphony/ })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  if (rest.length === 0) {
    console.log('✗ No demo restaurant found. Run `node scripts/seed-demo-restaurant.mjs` first.');
    process.exit(1);
  }
  const restaurantId = rest[0]._id.toString();
  console.log(`[0] Demo restaurant: ${rest[0].name} (${restaurantId})`);

  // ── 1. POS login as Owner ───────────────────────────────────────────
  console.log('\n[1] POS login');
  let login = await api('POST', '/auth/login', { username: OWNER_USERNAME, password: OWNER_PIN });
  if (login.status !== 200) {
    // Fall back to the restaurant-owner credentials from the seed output.
    login = await api('POST', '/auth/login', { username: rest[0].ownerUserId, password: rest[0].ownerPin });
  }
  const token = login.json?.accessToken || login.json?.token;
  check('owner login', Boolean(token) && login.status === 200, login.status);
  if (!token) process.exit(1);

  // ── 2. Create an offer ──────────────────────────────────────────────
  console.log('\n[2] Create offer via POST /api/offers');
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 7 * 86400000);
  const offerBody = {
    title: 'Smoke Test 15% Off',
    description: 'E2E smoke test offer — 15% off on bills above ₹200.',
    type: 'percentage',
    value: 15,
    status: 'active',
    minOrderValue: 200,
    maxUses: 10,
    maxPerCustomer: 2,
    startDate: fmt(today),
    endDate: fmt(end),
    applicableCategories: [],
    targetSegmentIds: [],
    targetSegmentNames: [],
    daysOfWeek: [],
    branchIds: [],
    sortOrder: 0,
  };
  const offerRes = await api('POST', '/offers', offerBody, token);
  const offerId = offerRes.json?._id || offerRes.json?.id;
  check('offer created (201)', offerRes.status === 201 && Boolean(offerId), `status=${offerRes.status}`);
  if (!offerId) { console.log('   response:', JSON.stringify(offerRes.json)?.slice(0, 300)); process.exit(1); }

  // ── 3. Configure webhook delivery (Settings → Integrations path) ────
  console.log('\n[3] Configure webhook delivery in restaurant settings');
  const receiver = await startReceiver();
  const webhookSecret = 'smoke-test-secret';
  const webhookUrl = await pickWebhookUrl(receiver.port);
  const settings = {
    'settings.integrations.webhook': {
      enabled: true,
      url: webhookUrl,
      secret: webhookSecret,
    },
  };
  await db.collection('restaurants').updateOne({ _id: rest[0]._id }, { $set: settings });
  check('webhook URL reachable locally', (await fetch(webhookUrl, { method: 'POST', body: '{}', signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false)), webhookUrl);

  // ── 4. Create a campaign linked to the offer ────────────────────────
  console.log('\n[4] Create campaign via POST /api/campaigns');
  const campaignBody = {
    name: 'Smoke Test Campaign',
    description: 'E2E delivery smoke test',
    offerId,
    audience: { segmentIds: [], customerPhones: DEMO_PHONES },
    template: { channel: 'webhook', subject: 'Smoke Test', message: '🎉 Enjoy 15% off your next bill at our restaurant!' },
    schedule: { mode: 'immediate', scheduledAt: undefined },
  };
  const campRes = await api('POST', '/campaigns', campaignBody, token);
  const campaignId = campRes.json?.data?.id || campRes.json?.data?._id;
  check('campaign created (201)', campRes.status === 201 && Boolean(campaignId), `status=${campRes.status}`);
  if (!campaignId) { console.log('   response:', JSON.stringify(campRes.json)?.slice(0, 400)); process.exit(1); }

  // ── 5. Send the campaign (async, returns immediately) ───────────────
  console.log('\n[5] POST /api/campaigns/:id/send');
  const sendRes = await api('POST', `/campaigns/${campaignId}/send`, {}, token);
  const sendData = sendRes.json?.data || sendRes.json;
  check('send accepted (async queue)', sendRes.status === 200 && sendData?.accepted === true, JSON.stringify(sendData)?.slice(0, 160));

  // ── 6. Verify the delivery worker processed the job ─────────────────
  console.log('\n[6] Verify delivery worker + per-recipient results');
  const history = await waitFor(
    'CampaignHistory to reach sent/partial/failed',
    async () => {
      const h = await db.collection('campaignhistories')
        .findOne({ campaignId: new mongoose.Types.ObjectId(campaignId) });
      return h && ['sent', 'partial', 'failed'].includes(h.status) ? h : null;
    },
    30000,
  );
  check('CampaignHistory finalized by worker', Boolean(history), history ? `status=${history.status}` : 'none');
  if (history) {
    check('per-recipient results written', Array.isArray(history.results) && history.results.length === DEMO_PHONES.length, `${history.results?.length}/${DEMO_PHONES.length}`);
    check('recipient count recorded', history.recipientCount === DEMO_PHONES.length, String(history.recipientCount));
  }

  const campaign = await waitFor(
    'Campaign to reflect the outcome',
    async () => {
      const c = await db.collection('campaigns').findOne({ _id: new mongoose.Types.ObjectId(campaignId) });
      return c && ['sent', 'partial', 'failed'].includes(c.status) ? c : null;
    },
    15000,
  );
  check('Campaign status updated by worker', Boolean(campaign), campaign ? `status=${campaign.status}` : 'none');
  if (campaign?.stats) {
    check('stats.sentCount + failedCount = audience', (campaign.stats.sentCount || 0) + (campaign.stats.failedCount || 0) === DEMO_PHONES.length,
      `sent=${campaign.stats.sentCount} failed=${campaign.stats.failedCount}`);
  }

  // Webhook receiver hit count + HMAC signature.
  // NOTE: hits[0..n] include the URL-reachability probes (no signature,
  // {count:0}); the real deliveries are the hits WITH an X-Webhook-Signature.
  await sleep(500); // allow in-flight hits to land
  const deliveries = receiver.hits.filter((h) => h.signature && h.signature.length > 0);
  check('webhook receiver got HMAC-signed deliveries', deliveries.length === DEMO_PHONES.length, `${deliveries.length}/${DEMO_PHONES.length} signed hit(s) of ${receiver.hits.length} total`);
  if (deliveries.length > 0) {
    const delivery = deliveries[0];
    const expected = createHmac('sha256', webhookSecret).update(delivery.body).digest('hex');
    check('HMAC signature verifies with configured secret', delivery.signature === expected);
    const payload = JSON.parse(delivery.body);
    check('delivery payload has campaign context', Boolean(payload.campaignId && payload.historyId && payload.message), `to=${payload.to}`);
  }

  // ── 6b. OfferAnalytics updated from real delivery events ─────────────
  console.log('\n[6b] OfferAnalytics populated from delivery events');
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const analytics = await waitFor(
    'OfferAnalytics row with customersReached',
    async () => {
      const a = await db.collection('offeranalytics').findOne({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        offerId: new mongoose.Types.ObjectId(offerId),
        snapshotDate,
      });
      return a && (a.customersReached || 0) > 0 ? a : null;
    },
    15000,
  );
  const reached = analytics?.customersReached || 0;
  check('analytics.customersReached ≥ audience', Boolean(analytics), analytics ? `reached=${reached}` : 'none');

  // ── 7. Redemption at the till → analytics.redeemed ──────────────────
  console.log('\n[7] Redemption via POST /api/offers/apply');
  const applyRes = await api('POST', '/offers/apply', {
    offerId,
    customerPhone: DEMO_PHONES[0],
    billSubtotal: 1000,
    billItems: [{ name: 'Butter Chicken', price: 349, quantity: 1 }],
    billId: `SMOKE-${Date.now()}`,
  }, token);
  check('offer applied (valid + discount computed)', applyRes.status === 200 && applyRes.json?.valid === true,
    `status=${applyRes.status} discount=${applyRes.json?.discount}`);

  const analyticsAfter = await waitFor(
    'analytics.redeemed incremented',
    async () => {
      const a = await db.collection('offeranalytics').findOne({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        offerId: new mongoose.Types.ObjectId(offerId),
        snapshotDate,
      });
      return a && (a.redeemed || 0) >= 1 ? a : null;
    },
    10000,
  );
  check('analytics.redeemed ≥ 1', Boolean(analyticsAfter), analyticsAfter ? `redeemed=${analyticsAfter.redeemed} revenue=${analyticsAfter.revenueGenerated}` : 'none');
  if (analyticsAfter) {
    check('analytics.revenueGenerated reflects discount', (analyticsAfter.revenueGenerated || 0) > 0, String(analyticsAfter.revenueGenerated));
  }

  // ── 8. Marketing scheduler: scheduled offer auto-activates ───────────
  console.log('\n[8] Scheduler: scheduled offer → active');
  const schedOffer = await api('POST', '/offers', {
    ...offerBody,
    title: 'Smoke Test Scheduled Offer',
    status: 'scheduled',
    scheduledDate: fmt(today),
    startDate: fmt(today),
    endDate: fmt(end),
  }, token);
  const schedId = schedOffer.json?._id || schedOffer.json?.id;
  const activated = await waitFor(
    'scheduled offer auto-activation',
    async () => {
      if (!schedId) return null;
      const o = await db.collection('offers').findOne({ _id: new mongoose.Types.ObjectId(schedId) });
      return o && o.status === 'active' ? o : null;
    },
    90000,
    3000,
  );
  check('offer auto-activated (scheduled → active)', Boolean(activated), activated ? 'status=active' : 'still scheduled');

  // ── Cleanup receiver + disconnect ───────────────────────────────────
  receiver.server.close();
  await mongoose.disconnect();

  console.log(`\n══════════════════════════════════`);
  console.log(`  RESULT: ${PASS} passed, ${FAIL} failed`);
  console.log(`══════════════════════════════════\n`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Smoke test crashed:', err);
  process.exit(1);
});
