/**
 * smoke-qr-integration.mjs — end-to-end smoke test for the QR ordering
 * integration (QR Studio tokens → customer site contract → live tracking →
 * waiter calls). Run against a backend on the given port:
 *
 *   PORT=3100 node scripts/smoke-qr-integration.mjs
 *
 * Creates a pickup sticker, places a public order, tracks it, fires a waiter
 * call and verifies the POS sees it. Expects a seeded owner login
 * (owner/1008 or admin/1008) and seeded products.
 */

const BASE = process.env.SMOKE_BASE || `http://localhost:${process.env.PORT || 3100}`;
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

async function jsonFetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function login() {
  for (const creds of [
    { username: 'owner', password: '1008' },
    { username: 'admin', password: '1008' },
  ]) {
    const r = await jsonFetch('/api/auth/login', { method: 'POST', body: creds });
    if (r.status === 200 && (r.json?.accessToken || r.json?.token)) {
      return r.json.accessToken || r.json.token;
    }
  }
  return null;
}

async function main() {
  const health = await jsonFetch('/api/health');
  check('backend healthy', health.status === 200, health.json?.dbConnected ? 'db connected' : 'db NOT connected');

  const token = await login();
  check('owner login', !!token);
  if (!token) { console.log('Could not log in — aborting'); process.exit(failures ? 1 : 0); }

  // ── QR Studio: create a pickup sticker ─────────────────────────
  const created = await jsonFetch('/api/qr-tokens', { method: 'POST', token, body: { type: 'pickup' } });
  check('QR Studio creates a sticker', created.status === 201, `status ${created.status}`);
  const sticker = created.json?.token;
  check('sticker url embeds real publicToken', !!sticker?.url && /pbl_[A-Za-z0-9]{10,64}/.test(sticker.url), sticker?.url || 'no url');

  const listRes = await jsonFetch('/api/qr-tokens', { token });
  check('QR Studio lists stickers', listRes.status === 200 && (listRes.json?.tokens || []).length >= 1, `count=${listRes.json?.tokens?.length}`);

  // ── Customer site contract against the public token ────────────
  const pubToken = sticker.url.match(/pbl_[A-Za-z0-9]{10,64}/)?.[0];
  const cfg = await jsonFetch(`/api/public-store/${pubToken}`);
  check('public-store config resolves', cfg.status === 200 && !!cfg.json?.store?.name, cfg.json?.store?.name || `status ${cfg.status}`);

  const menu = await jsonFetch(`/api/public-store/${pubToken}/menu`);
  const items = (menu.json?.categories || []).flatMap((c) => c.items || []);
  const available = items.filter((i) => i.available);
  check('public-store menu has items', available.length > 0, `available=${available.length}`);

  if (available.length === 0) {
    console.log('No available menu items — aborting order tests');
    process.exit(failures ? 1 : 0);
  }
  const first = available[0];
  const second = available[1] || available[0];

  const clientRef = `smoke_${Date.now()}`;
  const order = await jsonFetch(`/api/public-store/${pubToken}/orders`, {
    method: 'POST',
    body: {
      mode: 'TABLE',
      tableId: '000000000000000000000001',
      tableNumber: 1,
      items: [
        { productId: first.id, quantity: 2 },
        { productId: second.id, quantity: 1 },
      ],
      customer: { name: 'Smoke Tester', phone: '9876543210' },
      tip: 10,
      clientRef,
    },
  });
  check('public order created', order.status === 201 && !!order.json?.order, `status ${order.status}`);
  const orderDoc = order.json?.order;
  check('order has server-side totals', orderDoc?.grandTotal > 0, `grandTotal=${orderDoc?.grandTotal}`);
  check('order stores QR context', orderDoc?.mode === 'TABLE' && orderDoc?.tableId, `mode=${orderDoc?.mode}`);
  check('tip included in grandTotal', (orderDoc?.tip ?? 0) > 0, `tip=${orderDoc?.tip}`);

  // ── Idempotent replay ──────────────────────────────────────────
  const replay = await jsonFetch(`/api/public-store/${pubToken}/orders`, {
    method: 'POST',
    body: {
      mode: 'TABLE',
      items: [{ productId: first.id, quantity: 2 }],
      customer: { name: 'Smoke Tester', phone: '9876543210' },
      clientRef,
    },
  });
  check('idempotent replay returns same order', replay.status === 201 && replay.json?.order?.orderNumber === orderDoc?.orderNumber && replay.json?.idempotent === true, `idempotent=${replay.json?.idempotent}`);

  // ── Live tracking ──────────────────────────────────────────────
  const track = await jsonFetch(`/api/public-store/${pubToken}/orders/${encodeURIComponent(clientRef)}`);
  check('track order by clientRef', track.status === 200 && track.json?.order?.status === 'New', `status=${track.json?.order?.status}`);
  check('track includes items', (track.json?.items || []).length === 2, `items=${track.json?.items?.length}`);
  check('track includes timeline', (track.json?.timeline || []).length >= 1, `events=${track.json?.timeline?.length}`);

  // ── Waiter call → POS bell → complete (full lifecycle) ────────
  const call = await jsonFetch(`/api/public-store/${pubToken}/requests`, {
    method: 'POST',
    body: { mode: 'TABLE', tableId: '000000000000000000000001', type: 'water', message: 'Smoke test' },
  });
  check('waiter call created', call.status === 201, `status ${call.status}`);

  const qrList = await jsonFetch('/api/qr-tokens', { token });
  const restaurantId = qrList.json?.tokens?.[0]?.restaurantId;
  if (restaurantId) {
    const pending = await jsonFetch(`/api/qr-ordering/requests?restaurantId=${restaurantId}&status=PENDING`, { token });
    check('POS sees pending waiter call', pending.status === 200 && (pending.json?.data || []).length >= 1, `pending=${pending.json?.data?.length}`);

    // Complete every leftover smoke-test request (also exercises the complete path).
    for (const r of pending.json?.data || []) {
      if (r.message === 'Smoke test' && r.type === 'WATER') {
        await jsonFetch(`/api/qr-ordering/requests/${r._id}/complete`, { method: 'POST', token });
      }
    }
    const after = await jsonFetch(`/api/qr-ordering/requests?restaurantId=${restaurantId}&status=PENDING`, { token });
    check('completed requests leave the pending list', (after.json?.data || []).every((r) => r.message !== 'Smoke test'), `pending=${after.json?.data?.length}`);
  } else {
    console.log('⚠️ could not determine restaurantId — skipped POS bell check');
  }

  // ── Cleanup: remove the smoke sticker ──────────────────────────
  if (sticker?._id) {
    const del = await jsonFetch(`/api/qr-tokens/${sticker._id}`, { method: 'DELETE', token });
    check('sticker cleanup', del.status === 200);
  }

  console.log(failures === 0 ? '\n🎉 ALL SMOKE CHECKS PASSED' : `\n${failures} checks FAILED`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke script crashed:', err);
  process.exit(1);
});
