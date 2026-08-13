// Live e2e (clean) — place a TABLE-mode QR order on a FRESH table and verify:
// order stores tableId, auto-KOT #1 (Original, Accepted, all items),
// order items kotPrinted=true, and the table becomes occupied (not Available).
const mongoose = require('mongoose');
const BASE = 'http://localhost:3002';

async function jsonFetch(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, json: j };
}

(async () => {
  const login = await jsonFetch('/api/auth/login', { method: 'POST', body: { username: 'mfe_owner', password: '1008' } });
  const token = login.json?.accessToken;
  if (!token) { console.log('LOGIN FAILED', login.status); process.exit(1); }

  await mongoose.connect('mongodb://localhost:27017/pos');
  const db = mongoose.connection.db;

  const tok = await db.collection('qrtokens').findOne({ active: true });
  const publicToken = (tok.url || '').match(/pbl_[A-Za-z0-9]{10,64}/)?.[0];
  const rid = tok.restaurantId.toString();
  if (!publicToken) { console.log('NO pbl token'); process.exit(1); }
  console.log('public token:', publicToken);

  // Fresh test table (never used by any flow) — unique number per run
  const tableNumber = 900 + (Date.now() % 99);
  const fresh = await db.collection('tables').insertOne({
    number: tableNumber, capacity: 2, section: 'E2E', status: 'Available',
    restaurantId: new mongoose.Types.ObjectId(rid),
    branchId: tok.branchId || null, isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
  });
  const tableId = String(fresh.insertedId);
  console.log('fresh table:', tableId);

  // Menu → first available product
  const menu = await jsonFetch(`/api/public-store/${publicToken}/menu`);
  const prod = (menu.json?.categories || []).flatMap(c => c.items || []).find(i => i.available);
  if (!prod) { console.log('NO AVAILABLE PRODUCT'); process.exit(1); }
  console.log('product:', prod.name, '@', prod.price);

  const clientRef = `e2e_clean_${Date.now()}`;
  const orderRes = await jsonFetch(`/api/public-store/${publicToken}/orders`, {
    method: 'POST',
    body: {
      items: [{ productId: prod.id, quantity: 2 }],
      mode: 'TABLE',
      tableId,
      tableNumber,
      customer: { name: 'E2E', phone: '9000000000' },
      clientRef,
    },
  });
  console.log('order create status:', orderRes.status, orderRes.json?.error || 'ok');
  const orderId = String(orderRes.json?.order?._id || orderRes.json?.order?.id);
  if (!orderId) process.exit(1);

  // RAW side-effect checks
  const order = await db.collection('orders').findOne({ _id: new mongoose.Types.ObjectId(orderId) });
  const kots = await db.collection('kotrecords').find({ orderId: new mongoose.Types.ObjectId(orderId) }).sort({ kotNumber: 1 }).toArray();
  const items = await db.collection('orderitems').find({ orderId: new mongoose.Types.ObjectId(orderId) }).toArray();
  const tableAfter = await db.collection('tables').findOne({ _id: new mongoose.Types.ObjectId(tableId) });

  // Replay the same clientRef → must NOT create a duplicate KOT (heal path
  // is idempotent).
  const replay = await jsonFetch(`/api/public-store/${publicToken}/orders`, {
    method: 'POST',
    body: {
      items: [{ productId: prod.id, quantity: 2 }],
      mode: 'TABLE',
      tableId,
      tableNumber,
      customer: { name: 'E2E', phone: '9000000000' },
      clientRef,
    },
  });
  const kotsAfterReplay = await db.collection('kotrecords').countDocuments({ orderId: new mongoose.Types.ObjectId(orderId) });
  console.log('replay idempotent:', replay.json?.idempotent, '| KOT count after replay:', kotsAfterReplay);

  console.log('--- VERIFY ---');
  console.log('order.mode:', order.mode, '| type:', order.type, '| status:', order.status, '| tableId:', String(order.tableId), '===', tableId);
  console.log('KOT:', kots.length ? `${kots[0].type} #${kots[0].kotNumber} ${kots[0].status} items=${kots[0].items.length} by=${kots[0].printedBy} note=${kots[0].note}` : 'NONE');
  console.log('orderitems count:', items.length, '| kotPrinted:', items.map(i => i.kotPrinted), '| first:', items[0]?.productName);
  console.log('table status:', tableAfter?.status, '| occupiedSince:', tableAfter?.occupiedSince);

  const pass =
    order && order.mode === 'TABLE' && String(order.tableId) === tableId &&
    kots.length === 1 && kots[0].type === 'Original' && kots[0].status === 'Accepted' &&
    kots[0].items.length === 1 && kots[0].items[0].productId === prod.id &&
    items.length === 1 && items[0].kotPrinted === true &&
    tableAfter && tableAfter.status !== 'Available' &&
    kotsAfterReplay === 1 && replay.json?.idempotent === true;
  console.log(pass ? '✅ E2E PASS' : '❌ E2E FAIL');

  // Cleanup this run's artifacts (order + its KOT/items/timeline + table)
  await db.collection('orders').deleteOne({ _id: new mongoose.Types.ObjectId(orderId) });
  await db.collection('kotrecords').deleteMany({ orderId: new mongoose.Types.ObjectId(orderId) });
  await db.collection('orderitems').deleteMany({ orderId: new mongoose.Types.ObjectId(orderId) });
  await db.collection('timelineevents').deleteMany({ orderId: orderId });
  await db.collection('tables').deleteOne({ _id: new mongoose.Types.ObjectId(tableId) });
  console.log('cleanup done');

  await mongoose.disconnect();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
