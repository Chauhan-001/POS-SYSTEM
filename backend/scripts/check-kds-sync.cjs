/**
 * Live E2E verification of the KDS/order-adjustment sync path.
 * 1. Find/create an online order with a KOT record.
 * 2. GET /api/orders (list) — do kotRecords come back?
 * 3. GET /api/orders/:id — do kotRecords come back?
 * 4. POST /orders/:id/adjust (REMOVE + markUnavailable).
 * 5. After adjust: check order items (soft-deleted?), KOTRecord collection
 *    (stale?), availability (flipped?), and whether a socket event would fire.
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

  // --- find the JWT restaurant + public token ---
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const rid = payload.restaurantId;
  const rest = await db.collection('restaurants').findOne({ _id: new mongoose.Types.ObjectId(rid) });
  const publicToken = rest.publicToken || rest.storeToken || rest.token;
  console.log(`✓ restaurant ${rest.name} (${rid})`);

  // --- existing KOT records in DB? ---
  const kotCount = await db.collection('kotrecords').countDocuments({});
  console.log(`✓ KOTRecord docs in DB: ${kotCount}`);
  const kots = await db.collection('kotrecords').find({}).limit(3).toArray();
  kots.forEach(k => console.log(`  KOT orderId=${k.orderId} kotNumber=${k.kotNumber} items=${JSON.stringify(k.items)}`));

  // --- create a fresh online order via public-store ---
  const menu = await fetch(`${BASE}/api/public-store/${publicToken}/menu`).then(r => r.json());
  const items = [];
  for (const c of menu.categories || []) for (const it of c.items) { items.push(it); if (items.length === 2) break; }
  if (items.length < 2) { console.log('NEED 2 MENU ITEMS'); process.exit(0); }
  const clientRef = `kds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const created = await fetch(`${BASE}/api/public-store/${publicToken}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchId: undefined,
      items: [{ productId: items[0].id, quantity: 1 }, { productId: items[1].id, quantity: 1 }],
      customer: { name: 'KDS Test', phone: '9000000001' },
      mode: 'PICKUP',
      clientRef,
    }),
  }).then(r => r.json());
  const order = created.order || created;
  const orderId = order._id || order.id;
  console.log(`✓ online order created: #${order.orderNumber} (${orderId}) items=${(created.items || []).length}`);
  console.log(`  menu: ${items[0].name} (${items[0].id}) + ${items[1].name} (${items[1].id})`);

  // --- simulate a KOT being sent (as the POS would via updateOrder with kotRecords) ---
  const kotRecord = {
    orderId,
    kotNumber: 1,
    type: 'Original',
    items: [
      { itemName: items[0].name, quantity: 1 },
      { itemName: items[1].name, quantity: 1 },
    ],
    printedBy: 'KDS Test',
  };
  await db.collection('kotrecords').insertOne(kotRecord);
  console.log('✓ inserted KOT record directly into kotrecords collection');

  // --- GET /api/orders list: kotRecords present? ---
  const listRes = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json());
  const listArr = listRes.data || [];
  const listOrder = listArr.find(o => String(o._id) === orderId);
  console.log(`✓ GET /api/orders list: found order → kotRecords=${JSON.stringify((listOrder || {}).kotRecords)} (items array len=${((listOrder || {}).items || []).length})`);

  // --- GET /api/orders/:id: kotRecords present? ---
  const singleRes = await fetch(`${BASE}/api/orders/${orderId}`, { headers: H }).then(r => r.json());
  const singleOrder = singleRes.data || singleRes;
  console.log(`✓ GET /api/orders/:id: kotRecords=${(singleOrder.kotRecords || []).length} → ${JSON.stringify((singleOrder.kotRecords || []).map(k => ({ kotNumber: k.kotNumber, items: k.items })))}`);

  // --- ADJUST: remove item[1] + markUnavailable ---
  const itemToRemove = (created.items || []).find(i => i.productId === items[1].id);
  console.log(`\n▶ ADJUST: REMOVE ${items[1].name} + markUnavailable`);
  const adj = await fetch(`${BASE}/api/orders/${orderId}/adjust`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      adjustmentId: `adj_kds_${Date.now()}`,
      action: 'REMOVE',
      items: [{ productId: items[1].id, quantity: 1 }],
      reason: 'Sold out in kitchen (KDS test)',
      markUnavailable: true,
    }),
  }).then(async r => ({ status: r.status, body: await r.json() }));
  console.log(`✓ adjust → HTTP ${adj.status} ${adj.body?.error || 'ok'} newTotal=${adj.body?.data?.adjustment?.newTotal} refund=${adj.body?.data?.adjustment?.refundRequired}`);

  // --- after adjust: order items (soft-deleted?), KOT stale? ---
  const afterItems = await db.collection('orderitems').find({ orderId: new mongoose.Types.ObjectId(orderId) }).toArray();
  console.log(`✓ orderitems in DB: ${afterItems.length}`);
  afterItems.forEach(i => console.log(`  - ${i.productName} qty=${i.quantity} isDeleted=${!!i.isDeleted}`));

  const afterKot = await db.collection('kotrecords').find({ orderId: new mongoose.Types.ObjectId(orderId) }).toArray();
  console.log(`✓ kotrecords after adjust: ${afterKot.length}`);
  afterKot.forEach(k => console.log(`  - KOT#${k.kotNumber} items=${JSON.stringify(k.items)} ← STILL SHOWS REMOVED ITEM IF PRESENT`));

  // --- availability flipped? ---
  const avail = await fetch(`${BASE}/api/availability`, { headers: H }).then(r => r.json());
  const aRow = (avail.data || []).find(r => r.productId === items[1].id);
  console.log(`✓ availability after adjust: ${items[1].name} → status=${aRow?.status} reason="${aRow?.reason}" (expect UNAVAILABLE, source order_adjustment)`);

  // --- cleanup: restore availability + soft-delete test order + kot ---
  await fetch(`${BASE}/api/availability/bulk`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ items: [{ productId: items[1].id, status: 'AVAILABLE' }] }),
  }).then(r => r.json());
  await db.collection('orders').updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $set: { isDeleted: true, deletedAt: new Date() } });
  await db.collection('orderitems').deleteMany({ orderId: new mongoose.Types.ObjectId(orderId) });
  await db.collection('kotrecords').deleteMany({ orderId: new mongoose.Types.ObjectId(orderId) });
  await db.collection('orderadjustments').deleteMany({ orderId: new mongoose.Types.ObjectId(orderId) });
  console.log('\n✓ cleanup done (availability restored, test order soft-deleted, kot/items/adjustments removed)');

  await mongoose.disconnect();
  console.log('\nE2E CHECK COMPLETE');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
