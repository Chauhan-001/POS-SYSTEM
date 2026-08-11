/**
 * v2 — verify how the KDS actually receives KOT records:
 * 1. Find a REAL order that has KOT records (from kotrecords collection).
 * 2. GET /api/orders list — does it include kotRecords? (KDS source!)
 * 3. GET /api/orders/:id — does getById assemble kotRecords?
 * 4. Insert a proper ObjectId-linked KOT for a fresh online order, confirm
 *    getById returns it, then run an adjustment and confirm the KOT stays stale.
 */
const BASE = 'http://localhost:3002';
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos', { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: '1008' }),
  }).then(r => r.json());
  const token = login.accessToken;
  if (!token) { console.log('LOGIN FAILED'); process.exit(1); }
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('✓ logged in');

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const rid = payload.restaurantId;

  // ── A REAL order that has KOT records ──
  const realKot = await db.collection('kotrecords').findOne({ orderId: { $type: 'objectId' } });
  if (realKot) {
    const realOrderId = realKot.orderId.toString();
    // Is that order still alive + does it belong to this restaurant?
    const realOrder = await db.collection('orders').findOne({ _id: realKot.orderId, isDeleted: { $ne: true } });
    console.log(`\nREAL order with KOT: ${realOrder ? realOrder.orderNumber : 'order missing'} (${realOrderId})`);
    if (realOrder) {
      const listRes = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json());
      const listArr = listRes.data || [];
      const lo = listArr.find(o => String(o._id) === realOrderId);
      console.log(`  GET /api/orders list → kotRecords=${JSON.stringify((lo || {}).kotRecords)} (present=${lo ? 'kotRecords' in lo : 'order not in list'})`);
      const singleRes = await fetch(`${BASE}/api/orders/${realOrderId}`, { headers: H }).then(r => r.json());
      const so = singleRes.data || singleRes;
      console.log(`  GET /api/orders/:id → kotRecords=${(so.kotRecords || []).length} ${JSON.stringify((so.kotRecords || []).map(k => `KOT#${k.kotNumber} [${(k.items || []).map(i => `${i.itemName}x${i.quantity}`).join(', ')}]`))}`);
    }
  } else {
    console.log('no real ObjectId-linked KOT rows found');
  }

  // ── Fresh online order + PROPER ObjectId KOT + adjustment ──
  const rest = await db.collection('restaurants').findOne({ _id: new mongoose.Types.ObjectId(rid) });
  const publicToken = rest.publicToken || rest.storeToken || rest.token;
  const menu = await fetch(`${BASE}/api/public-store/${publicToken}/menu`).then(r => r.json());
  const items = [];
  for (const c of menu.categories || []) for (const it of c.items) { items.push(it); if (items.length === 2) break; }
  if (items.length < 2) { console.log('NEED 2 MENU ITEMS'); process.exit(0); }
  const clientRef = `kds2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const created = await fetch(`${BASE}/api/public-store/${publicToken}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: items[0].id, quantity: 1 }, { productId: items[1].id, quantity: 1 }],
      customer: { name: 'KDS2', phone: '9000000002' },
      mode: 'PICKUP', clientRef,
    }),
  }).then(r => r.json());
  const orderId = (created.order || created)._id || (created.order || created).id;
  const oid = new mongoose.Types.ObjectId(orderId);
  console.log(`\nFRESH online order: #${(created.order || created).orderNumber} (${orderId})`);

  // Insert KOT with proper ObjectId orderId
  await db.collection('kotrecords').insertOne({
    orderId: oid,
    kotNumber: 1,
    type: 'Original',
    items: [{ itemName: items[0].name, quantity: 1 }, { itemName: items[1].name, quantity: 1 }],
    printedBy: 'KDS2 Test',
    createdAt: new Date(),
  });
  console.log(`✓ inserted KOT (ObjectId orderId) for ${items[0].name} + ${items[1].name}`);

  const singleRes = await fetch(`${BASE}/api/orders/${orderId}`, { headers: H }).then(r => r.json());
  const so = singleRes.data || singleRes;
  console.log(`✓ GET /orders/:id → kotRecords=${(so.kotRecords || []).length} → ${JSON.stringify((so.kotRecords || []).map(k => `KOT#${k.kotNumber} [${(k.items || []).map(i => `${i.itemName}x${i.quantity}`).join(', ')}]`))}`);

  // List: is the fresh order + kotRecords in the list?
  const listRes = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json());
  const lo = (listRes.data || []).find(o => String(o._id) === orderId);
  console.log(`✓ GET /orders list → kotRecords=${JSON.stringify((lo || {}).kotRecords)} (this is what the KDS's pos.orders poll would receive)`);

  // ADJUST: remove items[1], markUnavailable
  console.log(`\n▶ ADJUST: REMOVE ${items[1].name} + markUnavailable`);
  const adj = await fetch(`${BASE}/api/orders/${orderId}/adjust`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      adjustmentId: `adj_kds2_${Date.now()}`,
      action: 'REMOVE',
      items: [{ productId: items[1].id, quantity: 1 }],
      reason: 'Sold out (KDS2)',
      markUnavailable: true,
    }),
  }).then(async r => ({ status: r.status, body: await r.json() }));
  console.log(`✓ adjust → HTTP ${adj.status} ${adj.body?.error || 'ok'}`);

  const afterKot = await db.collection('kotrecords').find({ orderId: oid }).toArray();
  afterKot.forEach(k => console.log(`✓ kotrecords AFTER adjust: KOT#${k.kotNumber} items=${JSON.stringify(k.items)} ← removed item still listed = STALE`));
  const afterItems = await db.collection('orderitems').find({ orderId: oid }).toArray();
  afterItems.forEach(i => console.log(`  orderitem: ${i.productName} isDeleted=${!!i.isDeleted}`));

  const singleAfter = await fetch(`${BASE}/api/orders/${orderId}`, { headers: H }).then(r => r.json());
  const soAfter = singleAfter.data || singleAfter;
  console.log(`✓ GET /orders/:id after adjust → kotRecords still ${(soAfter.kotRecords || []).length} → ${JSON.stringify((soAfter.kotRecords || []).map(k => `KOT#${k.kotNumber} [${(k.items || []).map(i => `${i.itemName}x${i.quantity}`).join(', ')}]`))} (KDS card would still show removed item)`);

  const avail = await fetch(`${BASE}/api/availability`, { headers: H }).then(r => r.json());
  const aRow = (avail.data || []).find(r => r.productId === items[1].id);
  console.log(`✓ availability: ${items[1].name} → ${aRow?.status} (${aRow?.reason})`);

  // cleanup
  await fetch(`${BASE}/api/availability/bulk`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ items: [{ productId: items[1].id, status: 'AVAILABLE' }] }),
  }).then(r => r.json());
  await db.collection('orders').updateOne({ _id: oid }, { $set: { isDeleted: true, deletedAt: new Date() } });
  await db.collection('orderitems').deleteMany({ orderId: oid });
  await db.collection('kotrecords').deleteMany({ orderId: oid });
  await db.collection('orderadjustments').deleteMany({ orderId: oid });
  console.log('\n✓ cleanup done');

  await mongoose.disconnect();
  console.log('\nE2E CHECK COMPLETE');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
