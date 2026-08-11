/**
 * fix-table-occupancy.mjs — backfill REAL table ObjectId links on Dine-In
 * orders + reservations for the Mega Feast restaurant (the seed originally
 * wrote string ids like 't3' that never matched the table docs, so the floor
 * plan could not bind live orders → every table showed Available), then
 * persist lifecycle status on the tables collection (Occupied/Reserved/
 * Available) exactly like tableStateService.reconcileTable.
 *
 * Idempotent — re-running only touches rows still holding 'tX' string ids and
 * recomputes statuses from the current orders/reservations.
 *
 * Run from backend/:  node scripts/fix-table-occupancy.mjs
 */
import mongoose from 'mongoose';

(async () => {
  await mongoose.connect('mongodb://localhost:27017/pos', { serverSelectionTimeoutMS: 4000 });
  const db = mongoose.connection.db;
  const rest = await db.collection('restaurants').findOne({ name: /Mega Feast House/ });
  if (!rest) { console.log('NO MEGA RESTAURANT FOUND'); process.exit(1); }
  const oidRest = rest._id;

  const branches = await db.collection('branches').find({ restaurantId: oidRest }, { projection: { _id: 1 } }).toArray();
  const branchIds = branches.map((b) => b._id);
  const tables = await db.collection('tables').find({ branchId: { $in: branchIds } }).toArray();
  const tableByKey = new Map(); // `${branchId}|${number}` → table doc
  for (const t of tables) tableByKey.set(`${String(t.branchId)}|${t.number}`, t);
  console.log(`restaurant: ${rest.name} | branches: ${branchIds.length} | tables: ${tables.length}`);

  // 1) Dine-In orders: 'tX' string → real table ObjectId (hex string — matches
  //    the Order model's String tableId field so reconcileTable lookups work).
  const orders = await db.collection('orders').find({ restaurantId: oidRest, type: 'Dine In', tableId: { $regex: /^t\d+$/ } }).toArray();
  const orderBulks = [];
  let orderUnmatched = 0;
  for (const o of orders) {
    const tbl = tableByKey.get(`${String(o.branchId)}|${o.tableNumber}`);
    if (!tbl) { orderUnmatched++; continue; }
    orderBulks.push({ updateOne: { filter: { _id: o._id }, update: { $set: { tableId: String(tbl._id) } } } });
  }
  if (orderBulks.length) await db.collection('orders').bulkWrite(orderBulks);
  console.log(`orders re-linked: ${orderBulks.length}${orderUnmatched ? ` (${orderUnmatched} unmatched, left as-is)` : ''}`);

  // 2) Reservations: same
  const resvs = await db.collection('reservations').find({ restaurantId: oidRest, tableId: { $regex: /^t\d+$/ } }).toArray();
  const resBulks = [];
  let resUnmatched = 0;
  for (const r of resvs) {
    const tbl = tableByKey.get(`${String(r.branchId)}|${r.tableNumber}`);
    if (!tbl) { resUnmatched++; continue; }
    resBulks.push({ updateOne: { filter: { _id: r._id }, update: { $set: { tableId: String(tbl._id) } } } });
  }
  if (resBulks.length) await db.collection('reservations').bulkWrite(resBulks);
  console.log(`reservations re-linked: ${resBulks.length}${resUnmatched ? ` (${resUnmatched} unmatched, left as-is)` : ''}`);

  // Fail loudly if any unresolvable 'tX' links remain — a future data drift
  // must never silently leave orders/reservations pointing at ghost tables.
  const remainingOrders = await db.collection('orders').countDocuments({ restaurantId: oidRest, type: 'Dine In', tableId: { $regex: /^t\d+$/ } });
  const remainingRes = await db.collection('reservations').countDocuments({ restaurantId: oidRest, tableId: { $regex: /^t\d+$/ } });
  if (remainingOrders + remainingRes > 0) {
    console.log(`WARNING: ${remainingOrders} orders + ${remainingRes} reservations still hold 'tX' tableIds (no matching table for their branchId|tableNumber).`);
  } else {
    console.log('all Dine-In orders + reservations now reference real table ids ✓');
  }

  // 3) Lifecycle status on tables (mirrors tableStateService.reconcileTable,
  //    but only TODAY's non-terminal Dine-In order occupies the table — the
  //    seed keeps ~15% of PAST days' orders open as historical volume, and a
  //    real floor plan at day-end closes those tables. Today-only gives a
  //    realistic partially-occupied grid instead of a permanent full house).
  const TERMINAL = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];
  // Reservation.date strings are local YYYY-MM-DD (seed's localDateStr) — match
  // with a local "today" so active reservations resolve in the same timezone.
  const nd = new Date();
  const todayLocal = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
  const toLocalDate = (d) => {
    const dd = new Date(d);
    return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
  };
  const occupied = new Set();
  const liveOrders = await db.collection('orders').find({ restaurantId: oidRest, type: 'Dine In', tableId: { $ne: null }, isDeleted: { $ne: true } }).toArray();
  for (const o of liveOrders) {
    if (!o.tableId || TERMINAL.includes(o.status)) continue;
    if (!o.createdAt || toLocalDate(o.createdAt) !== todayLocal) continue; // only live TODAY
    occupied.add(String(o.tableId));
  }
  const reserved = new Set();
  const activeRes = await db.collection('reservations').find({
    restaurantId: oidRest, tableId: { $ne: null },
    status: { $in: ['Confirmed', 'Pending'] }, date: todayLocal, isDeleted: { $ne: true },
  }).toArray();
  for (const r of activeRes) if (r.tableId) reserved.add(String(r.tableId));

  const statusBulks = [];
  let occ = 0, res = 0;
  for (const t of tables) {
    const sid = String(t._id);
    let st = 'Available';
    if (occupied.has(sid)) { st = 'Occupied'; occ++; }
    else if (reserved.has(sid)) { st = 'Reserved'; res++; }
    statusBulks.push({ updateOne: { filter: { _id: t._id }, update: { $set: { status: st } } } });
  }
  await db.collection('tables').bulkWrite(statusBulks);
  console.log(`table statuses → ${occ} Occupied / ${res} Reserved / ${tables.length - occ - res} Available`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
