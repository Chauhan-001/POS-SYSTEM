/**
 * =============================================================================
 * backfill-demo-restaurant.mjs — Fill every empty data collection for the
 * EXISTING Spice Symphony demo restaurant.
 * =============================================================================
 *
 * Why not re-run seed-demo-restaurant.mjs?  That script DELETES every previous
 * 'Spice Symphony *' restaurant and creates a NEW one with NEW credentials.
 * The user already has login credentials for the existing restaurant, so this
 * script finds the most recently created Spice Symphony restaurant and fills
 * the gaps in place:
 *
 *   1. Products  → stamp restaurantId on the demo products (so the catalog is
 *                  owned by this account; listProducts returns own + global)
 *   2. KOTRecords → 1 Original KOT per order (from orderitems)
 *   3. TimelineEvents → ORDER_CREATED / KOT_SENT / status events per order
 *   4. CustomerVisits → visit history for each demo customer (from bills)
 *   5. OfferAnalytics → snapshot rows per offer
 *   6. CustomerSegments → auto segments for the restaurant
 *   7. License → one active subscription license
 *   8. DeviceActivities → registered/login/heartbeat events per device
 *   9. WebhookEvents → payment.captured webhooks for the subscription payments
 *  10. CampaignHistories → a campaign per offer
 *  11. Purchases → ~8 weeks of supplier purchase history (new collection)
 *  12. InventoryEvents → activity feed for the Inventory Timeline:
 *      - sold    derived from the restaurant's REAL bill line items
 *      - closing derived from the restaurant's REAL DailySummary snapshots
 *      - adjusted / waste realistic generated entries (no source collection)
 *
 * Run from backend/ :  node scripts/backfill-demo-restaurant.mjs
 * Idempotent: re-runs clean up only THIS restaurant's backfilled rows.
 * =============================================================================
 */

import mongoose from 'mongoose';

const DEMO_NAME_PREFIX = 'Spice Symphony';
const DEMO_PRODUCT_CODES = [
  'PZ001','PZ002','ST001','ST002','ST003','ST004','MC001','MC002','MC003','MC004',
  'BY001','BY002','BY003','BD001','BD002','SI001','SI002','CN001','CN002',
  'DS001','DS002','BV001','BV002','BV003','BV004',
];
const DEMO_PHONES = ['9812345670','9823456781','9834567892','9845678903','9856789014','9867890125','9878901236','9889012347','9890123458','9801234569'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260801);
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateOffset(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (msg) => console.log(msg);

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos');
  const db = mongoose.connection.db;
  const oid = mongoose.Types.ObjectId;

  // ─── Locate the existing demo restaurant ──────────────────────
  const rest = await db.collection('restaurants')
    .find({ name: { $regex: `^${DEMO_NAME_PREFIX}` }, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 }).limit(1).next();
  if (!rest) {
    log('✗ No Spice Symphony restaurant found. Run seed-demo-restaurant.mjs first.');
    process.exit(1);
  }
  const restId = rest._id;
  log(`\nTargeting restaurant: ${rest.name} (${String(restId)})\n`);

  const branches = await db.collection('branches').find({ restaurantId: restId }).toArray();
  const branchIds = branches.map((b) => b._id);
  const headBranch = branches.find((b) => b.isHeadBranch) || branches[0];
  log(`  branches: ${branches.map((b) => b.name).join(' | ')}`);

  // ─── 1) Products — stamp ownership (only unscoped demo products) ─
  // NOTE: stamping is intentionally one-way. Re-runs clean up the backfilled
  // rows but deliberately keep products owned by this restaurant (un-stamping
  // would put other restaurants' catalogs at risk).
  const prodRes = await db.collection('products').updateMany(
    { code: { $in: DEMO_PRODUCT_CODES }, $or: [{ restaurantId: null }, { restaurantId: { $exists: false } }] },
    { $set: { restaurantId: restId } }
  );
  log(`  products stamped with restaurantId: ${prodRes.modifiedCount}`);

  // ─── 1b) Global fallback catalog — keep the shared menu non-empty ───
  // listProducts returns own + global (restaurantId null). Once the demo
  // catalog is owned by this restaurant, OTHER accounts would see an empty
  // menu. Ensure a small set of global products always exists so every
  // account (including fresh ones) has something to sell.
  const GLOBAL_FALLBACK_PRODUCTS = [
    { code: 'GLB001', name: 'Masala Chai', category: 'Beverages', price: 25, gstPercent: 5, unit: 'pcs', currentStock: 120, minStock: 20, maxStock: 300, availability: true },
    { code: 'GLB002', name: 'Filter Coffee', category: 'Beverages', price: 30, gstPercent: 5, unit: 'pcs', currentStock: 90, minStock: 15, maxStock: 250, availability: true },
    { code: 'GLB003', name: 'Lemonade', category: 'Beverages', price: 40, gstPercent: 5, unit: 'pcs', currentStock: 60, minStock: 10, maxStock: 200, availability: true },
    { code: 'GLB004', name: 'Garlic Bread', category: 'Starters', price: 120, gstPercent: 5, unit: 'pcs', currentStock: 40, minStock: 8, maxStock: 120, availability: true },
    { code: 'GLB005', name: 'Masala Papad', category: 'Starters', price: 50, gstPercent: 5, unit: 'pcs', currentStock: 70, minStock: 12, maxStock: 180, availability: true },
    { code: 'GLB006', name: 'Mineral Water', category: 'Beverages', price: 20, gstPercent: 5, unit: 'pcs', currentStock: 200, minStock: 40, maxStock: 500, availability: true },
  ];
  const globalCount = await db.collection('products').countDocuments({ restaurantId: null });
  if (globalCount === 0) {
    const glbDocs = GLOBAL_FALLBACK_PRODUCTS.map((p) => ({ ...p, restaurantId: null, favorite: false, branchPrice: {}, isDeleted: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }));
    const glbR = await db.collection('products').insertMany(glbDocs);
    log(`  global fallback catalog: inserted ${glbR.insertedCount} shared products`);
  } else {
    log(`  global fallback catalog: ${globalCount} global products already exist`);
  }

  // ─── Load reference data ───────────────────────────────────────
  const orders = await db.collection('orders').find({ branchId: { $in: branchIds }, isDeleted: { $ne: true } }).toArray();
  const orderIds = orders.map((o) => o._id);
  log(`  orders: ${orderIds.length}`);

  const orderItems = await db.collection('orderitems').find({ orderId: { $in: orderIds } }).toArray();
  const customers = await db.collection('customers').find({ phone: { $in: DEMO_PHONES } }).toArray();
  const custByPhone = {};
  customers.forEach((c) => { custByPhone[c.phone] = c; });
  const offers = await db.collection('offers').find({ restaurantId: restId, isDeleted: { $ne: true } }).toArray();
  const devices = await db.collection('devices').find({ restaurantId: restId }).toArray();
  const payments = await db.collection('payments').find({ restaurantId: restId }).toArray();
  const bills = await db.collection('bills').find({ branchId: { $in: branchIds }, isVoided: { $ne: true } }).toArray();

  // ═══ Cleanup — only THIS restaurant's backfilled rows ══════════
  log('\n[cleanup]');
  const delScoped = async (c, filter, label) => {
    const r = await db.collection(c).deleteMany(filter);
    log(`  ${label}: removed ${r.deletedCount}`);
  };
  await delScoped('kotrecords', { orderId: { $in: orderIds } }, 'kotrecords');
  await delScoped('timelineevents', { orderId: { $in: orderIds } }, 'timelineevents');
  await delScoped('customervisits', { customerId: { $in: customers.map((c) => c._id) } }, 'customervisits');
  await delScoped('offeranalytics', { restaurantId: restId }, 'offeranalytics');
  await delScoped('customersegments', { restaurantId: restId }, 'customersegments');
  await delScoped('licenses', { restaurantId: restId }, 'licenses');
  await delScoped('deviceactivities', { restaurantId: restId }, 'deviceactivities');
  await delScoped('webhookevents', { eventId: { $regex: '^evt_ss_' } }, 'webhookevents');
  await delScoped('campaignhistories', { restaurantId: restId }, 'campaignhistories');
  await delScoped('purchases', { restaurantId: restId }, 'purchases');
  await delScoped('inventoryevents', { restaurantId: restId }, 'inventoryevents');

  // ═══ 2) KOT records (1 Original per order) ═════════════════════
  log('\n[2] KOT records');
  let kotCount = 0;
  const kots = [];
  for (const o of orders) {
    const items = orderItems
      .filter((i) => String(i.orderId) === String(o._id) && !i.isDeleted)
      .map((i) => ({
        itemName: i.productName || 'Item',
        quantity: i.quantity || 1,
        notes: i.notes || '',
        variantName: i.variantName || undefined,
      }));
    if (items.length === 0) continue;
    kots.push({
      orderId: o._id,
      kotNumber: 1,
      type: 'Original',
      items,
      printedBy: o.updatedBy || o.cashierName || 'Aarav Sharma',
      note: o.status === 'New' ? 'New order' : undefined,
      createdAt: o.createdAt || new Date(),
    });
  }
  if (kots.length) {
    const r = await db.collection('kotrecords').insertMany(kots);
    kotCount = r.insertedCount;
  }
  log(`  inserted ${kotCount} KOTs`);

  // ═══ 3) Timeline events per order ══════════════════════════════
  log('[3] Timeline events');
  const timeline = [];
  for (const o of orders) {
    const base = new Date(o.createdAt || Date.now()).getTime();
    const actor = o.cashierName || 'Aarav Sharma';
    timeline.push({
      orderId: o._id,
      type: 'ORDER_CREATED',
      description: `Order #${o.orderNumber} created (${o.type})`,
      actor,
      createdAt: new Date(base),
    });
    timeline.push({
      orderId: o._id,
      type: 'KOT_SENT',
      description: `KOT sent to kitchen for order #${o.orderNumber}`,
      actor,
      createdAt: new Date(base + 2 * 60000),
    });
    timeline.push({
      orderId: o._id,
      type: 'STATUS_UPDATED',
      description: `Status updated to ${o.status}`,
      actor,
      createdAt: new Date(base + 4 * 60000),
    });
  }
  if (timeline.length) {
    const r = await db.collection('timelineevents').insertMany(timeline);
    log(`  inserted ${r.insertedCount} timeline events`);
  } else log('  none');

  // ═══ 4) Customer visits (from bills) ═══════════════════════════
  log('[4] Customer visits');
  const visits = [];
  for (const b of bills) {
    const cust = b.customerPhone ? custByPhone[b.customerPhone] : null;
    if (!cust) continue;
    visits.push({
      customerId: cust._id,
      visitDate: b.date,
      billAmount: b.grandTotal || 0,
      pointsEarned: b.pointsEarned || 0,
      pointsRedeemed: b.pointsRedeemed || 0,
      redeemedRewardTitle: b.pointsRedeemed ? 'Loyalty redemption' : undefined,
    });
  }
  if (visits.length) {
    const r = await db.collection('customervisits').insertMany(visits);
    log(`  inserted ${r.insertedCount} customer visits`);
  } else log('  none (no bills matched demo customers)');

  // ═══ 5) Offer analytics snapshots ══════════════════════════════
  log('[5] Offer analytics');
  const offerSnaps = [];
  const todayStr = localDateStr(new Date());
  const weekAgo = localDateStr(dateOffset(7));
  for (const ofr of offers) {
    for (const snap of [weekAgo, todayStr]) {
      const targeted = randInt(40, 150);
      const reached = Math.round(targeted * 0.7);
      const opened = Math.round(reached * 0.6);
      const redeemed = Math.round(opened * 0.35);
      offerSnaps.push({
        offerId: ofr._id,
        restaurantId: restId,
        customersTargeted: targeted,
        customersReached: reached,
        opened,
        redeemed,
        revenueGenerated: redeemed * randInt(400, 1200),
        repeatVisits: Math.round(redeemed * 0.3),
        averageBillIncrease: randInt(5, 30),
        roi: randInt(120, 450),
        campaignCost: randInt(800, 3500),
        snapshotDate: snap,
      });
    }
  }
  if (offerSnaps.length) {
    const r = await db.collection('offeranalytics').insertMany(offerSnaps);
    log(`  inserted ${r.insertedCount} offer analytics snapshots`);
  } else log('  none');

  // ═══ 6) Customer segments ══════════════════════════════════════
  log('[6] Customer segments');
  const avgBill = bills.length ? bills.reduce((s, b) => s + (b.grandTotal || 0), 0) / bills.length : 600;
  const segments = [
    { name: 'Visit Today', type: 'visit_today', desc: 'Customers who visited today', phones: bills.filter((b) => b.date === todayStr && b.customerPhone).map((b) => b.customerPhone) },
    { name: 'Visit This Week', type: 'visit_this_week', desc: 'Customers who visited in the last 7 days', phones: bills.filter((b) => b.date >= weekAgo && b.customerPhone).map((b) => b.customerPhone) },
    { name: 'Frequent Customers', type: 'frequent_customer', desc: 'Most loyal repeat diners', phones: customers.filter((c) => c.visits >= 10).map((c) => c.phone) },
    { name: 'VIP Customers', type: 'vip_customer', desc: 'High-value regulars', phones: customers.filter((c) => c.points >= 150).map((c) => c.phone) },
    { name: 'High Spending', type: 'high_spending', desc: 'Above-average order value', phones: customers.filter((c) => c.points >= 100).map((c) => c.phone) },
    { name: 'Returning Customers', type: 'returning_customer', desc: 'Visited more than once', phones: customers.filter((c) => c.visits >= 2).map((c) => c.phone) },
    { name: 'New Customers', type: 'new_customer', desc: 'First-time visitors', phones: customers.filter((c) => c.visits <= 1).map((c) => c.phone) },
    { name: 'Loyalty Members', type: 'loyalty_member', desc: 'Enrolled in loyalty program', phones: customers.map((c) => c.phone) },
    { name: 'Reward Redeemers', type: 'reward_redeemer', desc: 'Have redeemed rewards', phones: customers.filter((c) => c.visits >= 15).map((c) => c.phone) },
    { name: 'Dinner Customers', type: 'dinner_customer', desc: 'Prefer evening dining', phones: customers.slice(0, 7).map((c) => c.phone) },
    { name: 'Cash Customers', type: 'cash_customer', desc: 'Settle bills in cash', phones: customers.slice(0, 5).map((c) => c.phone) },
    { name: 'UPI Customers', type: 'upi_customer', desc: 'Pay via UPI', phones: customers.slice(3, 9).map((c) => c.phone) },
  ];
  const segDocs = segments.map((s) => {
    const phones = [...new Set(s.phones)].filter(Boolean);
    return {
      restaurantId: restId,
      name: s.name,
      type: s.type,
      description: s.desc,
      customerPhones: phones,
      customerCount: phones.length,
      averageSpend: Math.round(avgBill),
      averageVisitFrequency: randInt(3, 14),
      isAutoGenerated: true,
      isDeleted: false,
    };
  });
  if (segDocs.length) {
    const r = await db.collection('customersegments').insertMany(segDocs);
    log(`  inserted ${r.insertedCount} customer segments`);
  }

  // ═══ 7) License ════════════════════════════════════════════════
  log('[7] License');
  const license = {
    restaurantId: restId,
    licenseKey: `SS-DEMO-${String(restId).slice(-8).toUpperCase()}`,
    type: 'subscription',
    issuedAt: new Date(),
    expiresAt: dateOffset(-365),
    isActive: true,
  };
  const licR = await db.collection('licenses').insertOne(license);
  log(`  inserted 1 license (${licR.insertedId})`);

  // ═══ 8) Device activities ══════════════════════════════════════
  log('[8] Device activities');
  const devActs = [];
  for (const d of devices) {
    devActs.push({ deviceId: d._id, restaurantId: restId, event: 'device_registered', description: `Device "${d.deviceName || 'POS'}" registered`, metadata: { appVersion: d.appVersion, os: d.os }, ipAddress: '127.0.0.1', createdAt: d.createdAt || new Date() });
    devActs.push({ deviceId: d._id, restaurantId: restId, event: 'device_login', description: `Device logged in (${d.deviceName || 'POS'})`, metadata: {}, ipAddress: '127.0.0.1', createdAt: d.lastLoginAt || new Date() });
    devActs.push({ deviceId: d._id, restaurantId: restId, event: 'heartbeat', description: 'Heartbeat received', metadata: {}, ipAddress: '127.0.0.1', createdAt: new Date() });
  }
  if (devActs.length) {
    const r = await db.collection('deviceactivities').insertMany(devActs);
    log(`  inserted ${r.insertedCount} device activities`);
  } else log('  none (no devices)');

  // ═══ 9) Webhook events (payment.captured) ══════════════════════
  log('[9] Webhook events');
  const webhooks = [];
  for (const p of payments) {
    webhooks.push({
      eventId: `evt_ss_${String(p._id).slice(-12)}`,
      eventType: 'payment.captured',
      gateway: 'razorpay',
      payload: JSON.stringify({ payment_id: String(p.razorpayOrderId || p._id), amount: p.amount, status: p.status }),
      status: 'processed',
      processedAt: p.createdAt || new Date(),
    });
  }
  if (webhooks.length) {
    const r = await db.collection('webhookevents').insertMany(webhooks);
    log(`  inserted ${r.insertedCount} webhook events`);
  } else log('  none');

  // ═══ 10) Campaign histories (1 per offer) ══════════════════════
  log('[10] Campaign histories');
  const campaigns = [];
  const channels = ['whatsapp', 'sms', 'email', 'app_notification'];
  for (const ofr of offers) {
    const phones = DEMO_PHONES.slice(0, randInt(5, 10));
    campaigns.push({
      offerId: ofr._id,
      restaurantId: restId,
      channel: pick(channels),
      recipientPhones: phones,
      recipientCount: phones.length,
      openedCount: Math.round(phones.length * 0.6),
      redeemedCount: Math.round(phones.length * 0.25),
      messageContent: `${ofr.title} — ${ofr.description || 'Limited-time offer at Spice Symphony!'}`,
      isScheduled: false,
      sentDate: localDateStr(dateOffset(randInt(1, 6))),
      campaignCost: randInt(300, 1500),
      status: 'sent',
    });
  }
  if (campaigns.length) {
    const r = await db.collection('campaignhistories').insertMany(campaigns);
    log(`  inserted ${r.insertedCount} campaign histories`);
  } else log('  none');

  // ═══ 11) Purchases (new collection — supplier stock-in history) ═
  log('[11] Purchases (8 weeks of supplier history)');
  const purchaseTemplates = [
    { item: 'Milk', category: 'Dairy', supplier: 'Amul Dairy', qty: [15, 40], unit: 'L', price: [50, 60] },
    { item: 'Paneer', category: 'Dairy', supplier: 'Amul Dairy', qty: [8, 20], unit: 'kg', price: [340, 380] },
    { item: 'Butter', category: 'Dairy', supplier: 'Amul Dairy', qty: [3, 8], unit: 'kg', price: [480, 520] },
    { item: 'Tea Powder', category: 'Beverages', supplier: 'Tata Consumer', qty: [4, 10], unit: 'kg', price: [320, 360] },
    { item: 'Basmati Rice', category: 'Grains', supplier: 'Ashirwad', qty: [20, 50], unit: 'kg', price: [90, 120] },
    { item: 'Wheat Flour', category: 'Grains', supplier: 'Ashirwad', qty: [15, 40], unit: 'kg', price: [32, 45] },
    { item: 'Chicken', category: 'Meat', supplier: 'Poultry Farm', qty: [10, 30], unit: 'kg', price: [200, 240] },
    { item: 'Vegetables', category: 'Produce', supplier: 'Local Vendor', qty: [20, 60], unit: 'kg', price: [28, 60] },
    { item: 'Potato', category: 'Produce', supplier: 'Local Vendor', qty: [15, 50], unit: 'kg', price: [24, 35] },
    { item: 'Onion', category: 'Produce', supplier: 'Local Vendor', qty: [10, 40], unit: 'kg', price: [28, 42] },
    { item: 'Tomato', category: 'Produce', supplier: 'Local Vendor', qty: [10, 35], unit: 'kg', price: [32, 55] },
    { item: 'Cooking Oil', category: 'Pantry', supplier: 'Fortune Oil', qty: [10, 25], unit: 'L', price: [150, 195] },
    { item: 'Sugar', category: 'Pantry', supplier: 'Local Vendor', qty: [8, 20], unit: 'kg', price: [40, 48] },
    { item: 'Spices', category: 'Pantry', supplier: 'Local Vendor', qty: [3, 10], unit: 'kg', price: [180, 420] },
    { item: 'Bread', category: 'Bakery', supplier: 'Modern Bakery', qty: [15, 40], unit: 'pcs', price: [30, 40] },
    { item: 'Cheese', category: 'Dairy', supplier: 'Amul Dairy', qty: [4, 12], unit: 'kg', price: [420, 460] },
  ];
  const purchases = [];
  const nDays = 56; // 8 weeks
  for (let back = nDays - 1; back >= 0; back--) {
    const date = localDateStr(dateOffset(back));
    // 1-3 purchases on weekdays, 2-4 on weekends
    const dow = dateOffset(back).getDay();
    const n = (dow === 0 || dow === 6) ? randInt(2, 4) : randInt(1, 3);
    for (let i = 0; i < n; i++) {
      const t = pick(purchaseTemplates);
      const qty = randInt(t.qty[0], t.qty[1]);
      const price = randInt(t.price[0], t.price[1]);
      purchases.push({
        restaurantId: restId,
        branchId: rng() < 0.8 ? headBranch._id : (branches[1] || headBranch)._id,
        supplier: t.supplier,
        item: t.item,
        category: t.category,
        quantity: qty,
        unit: t.unit,
        price,
        total: Math.round(qty * price),
        date,
        status: 'completed',
        notes: `Stock-in: ${t.item}`,
        createdAt: new Date(dateOffset(back)),
        updatedAt: new Date(dateOffset(back)),
      });
    }
  }
  if (purchases.length) {
    const r = await db.collection('purchases').insertMany(purchases);
    log(`  inserted ${r.insertedCount} purchases`);
  }

  // ═══ 12) Inventory events (sold from REAL bills, closing from REAL
  //         DailySummary snapshots, adjusted/waste generated) ════════
  log('[12] Inventory events (Activity timeline)');
  const billItems = await db.collection('billitems')
    .find({ billId: { $in: bills.map((b) => b._id) } })
    .toArray();
  const billById = {};
  bills.forEach((b) => { billById[String(b._id)] = b; });

  // sold — aggregate REAL line items per (date, itemName) so the feed reflects
  // actual consumption instead of made-up numbers.
  const soldByDayItem = new Map(); // `${date}|${itemName}` -> { qty, cashier }
  for (const bi of billItems) {
    const bill = billById[String(bi.billId)];
    if (!bill || !bi.itemName) continue;
    const key = `${bill.date}|${bi.itemName}`;
    const cur = soldByDayItem.get(key) || { qty: 0, cashier: bill.cashierName || 'System' };
    cur.qty += Number(bi.quantity) || 0;
    soldByDayItem.set(key, cur);
  }
  // Cap sold events: keep the top ~6 items per day so the feed stays readable.
  const soldEvents = [];
  const soldByDay = new Map();
  for (const [key, v] of soldByDayItem) {
    const [date, itemName] = key.split('|');
    if (!soldByDay.has(date)) soldByDay.set(date, []);
    soldByDay.get(date).push({ date, itemName, qty: v.qty, cashier: v.cashier });
  }
  for (const [date, items] of soldByDay) {
    items.sort((a, b) => b.qty - a.qty);
    for (const it of items.slice(0, 6)) {
      soldEvents.push({
        restaurantId: restId,
        branchId: headBranch._id,
        type: 'sold',
        item: it.itemName,
        quantity: it.qty,
        unit: 'pcs',
        operator: it.cashier,
        details: 'Sales consumption',
        eventDate: it.date,
        createdAt: new Date(it.date + 'T' + (randInt(10, 20)) + ':00:00'),
        updatedAt: new Date(it.date + 'T' + (randInt(10, 20)) + ':00:00'),
      });
    }
  }
  log(`  sold events derived: ${soldEvents.length}`);

  // closing — derived from the REAL DailySummary snapshots (top items by qty).
  const dailySummaries = await db.collection('dailysummaries')
    .find({ branchId: { $in: branchIds } })
    .toArray();
  const closingEvents = [];
  for (const ds of dailySummaries) {
    const top = (ds.topItems || []).slice(0, 3);
    for (const t of top) {
      closingEvents.push({
        restaurantId: restId,
        branchId: ds.branchId || headBranch._id,
        type: 'closing',
        item: t.name,
        quantity: t.qty,
        unit: 'pcs',
        operator: 'System',
        details: 'Closing stock count',
        eventDate: ds.date,
        createdAt: new Date(ds.date + 'T23:00:00'),
        updatedAt: new Date(ds.date + 'T23:00:00'),
      });
    }
  }
  log(`  closing events derived: ${closingEvents.length}`);

  // adjusted / waste — realistic generated entries (no source collection).
  const STAFF = ['Ravi Singh', 'Priya Sharma', 'Aarav Sharma', 'Meera Iyer', 'Kabir Verma'];
  const ADJUST_TEMPLATES = [
    { item: 'Cooking Oil', unit: 'L', qty: [1, 4], detail: 'Staff consumption adjustment' },
    { item: 'Milk', unit: 'L', qty: [2, 8], detail: 'Inventory count correction' },
    { item: 'Sugar', unit: 'kg', qty: [1, 3], detail: 'Staff consumption adjustment' },
    { item: 'Basmati Rice', unit: 'kg', qty: [2, 5], detail: 'Inventory count correction' },
  ];
  const WASTE_TEMPLATES = [
    { item: 'Bread', unit: 'pcs', qty: [2, 6], detail: 'Expired bread discarded' },
    { item: 'Vegetables', unit: 'kg', qty: [1, 4], detail: 'Spoiled vegetables discarded' },
    { item: 'Milk', unit: 'L', qty: [1, 3], detail: 'Milk past expiry discarded' },
    { item: 'Tomato', unit: 'kg', qty: [1, 3], detail: 'Spoiled tomatoes discarded' },
  ];
  const otherEvents = [];
  const nActivityDays = 30;
  for (let back = nActivityDays - 1; back >= 0; back--) {
    const date = localDateStr(dateOffset(back));
    const hour = randInt(8, 21);
    // 0-2 adjustments and 0-2 waste events per day
    for (let i = 0; i < randInt(0, 2); i++) {
      const t = pick(ADJUST_TEMPLATES);
      otherEvents.push({
        restaurantId: restId,
        branchId: headBranch._id,
        type: 'adjusted',
        item: t.item,
        quantity: -randInt(t.qty[0], t.qty[1]),
        unit: t.unit,
        operator: pick(STAFF),
        details: t.detail,
        eventDate: date,
        createdAt: new Date(date + 'T' + String(hour).padStart(2, '0') + ':30:00'),
        updatedAt: new Date(date + 'T' + String(hour).padStart(2, '0') + ':30:00'),
      });
    }
    for (let i = 0; i < randInt(0, 2); i++) {
      const t = pick(WASTE_TEMPLATES);
      otherEvents.push({
        restaurantId: restId,
        branchId: headBranch._id,
        type: 'waste',
        item: t.item,
        quantity: -randInt(t.qty[0], t.qty[1]),
        unit: t.unit,
        operator: pick(STAFF),
        details: t.detail,
        eventDate: date,
        createdAt: new Date(date + 'T' + String(hour).padStart(2, '0') + ':45:00'),
        updatedAt: new Date(date + 'T' + String(hour).padStart(2, '0') + ':45:00'),
      });
    }
  }
  const allEvents = [...soldEvents, ...closingEvents, ...otherEvents];
  if (allEvents.length) {
    const r = await db.collection('inventoryevents').insertMany(allEvents);
    log(`  inserted ${r.insertedCount} inventory events (${soldEvents.length} sold, ${closingEvents.length} closing, ${otherEvents.length} adjusted/waste)`);
  } else {
    log('  none');
  }

  // ═══ Verify ════════════════════════════════════════════════════
  log('\n=== VERIFICATION (Spice Symphony scoped) ===');
  const branchOids = branchIds;
  const check = async (c, filter, label) => {
    const n = await db.collection(c).countDocuments(filter);
    log(`  ${label}: ${n}`);
    return n;
  };
  await check('products', { restaurantId: restId }, 'products (owned)');
  await check('kotrecords', { orderId: { $in: orderIds } }, 'kotrecords');
  await check('timelineevents', { orderId: { $in: orderIds } }, 'timelineevents');
  await check('customervisits', { customerId: { $in: customers.map((c) => c._id) } }, 'customervisits');
  await check('offeranalytics', { restaurantId: restId }, 'offeranalytics');
  await check('customersegments', { restaurantId: restId }, 'customersegments');
  await check('licenses', { restaurantId: restId }, 'licenses');
  await check('deviceactivities', { restaurantId: restId }, 'deviceactivities');
  await check('webhookevents', { eventId: { $regex: '^evt_ss_' } }, 'webhookevents');
  await check('campaignhistories', { restaurantId: restId }, 'campaignhistories');
  await check('purchases', { restaurantId: restId }, 'purchases');
  await check('inventoryevents', { restaurantId: restId }, 'inventoryevents');
  await check('orders', { branchId: { $in: branchOids } }, 'orders');
  await check('bills', { branchId: { $in: branchOids } }, 'bills');
  await check('expenses', { branchId: { $in: branchOids } }, 'expenses');

  log('\n✅ Backfill complete.');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ Backfill failed:', e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
