/**
 * Seed real inventory data for the Mega Feast House restaurant.
 *
 * Adds:
 *   - expiryDate + batchNumber on perishable menu products (Expiry screen)
 *   - lower currentStock on a few products so Low-Stock alerts are real
 *   - Purchase history (last 30 days) → Purchase collection + 'purchase'
 *     InventoryEvents (PurchaseEntry feed, Activity timeline, Reports)
 *   - Waste events → InventoryEvent type 'waste' (Waste Log page, Reports)
 *   - Suppliers (Suppliers page)
 *
 * Idempotent: re-running replaces the restaurant's purchases, inventory
 * events and suppliers and re-applies the product field updates.
 *
 * ⚠ DESTRUCTIVE: it deleteMany()s the restaurant's purchases, suppliers and
 * inventory events first — run only on a demo/seed database, never on a live
 * restaurant that has real POS-entered history.
 *
 * Run: node scripts/seed-inventory-data.mjs
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pos';
const RESTAURANT_MATCH = /Mega Feast House/;

// ─── Date helpers (YYYY-MM-DD, UTC — same convention as the stock engine) ──
const dateFromNow = (daysOffset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
};

// ─── Suppliers ──────────────────────────────────────────────────────────────
const SUPPLIERS = [
  { name: 'FreshMart Supplies', phone: '+91 98450 12345', email: 'orders@freshmart.in', address: 'Whitefield, Bengaluru', gstin: '29AAACF1234A1Z5', items: ['Margherita Pizza', 'Pepperoni Pizza', 'Cheese Burst Pizza', 'Chicken Tikka', 'Tandoori Wings', 'Fish Amritsari'], status: 'active' },
  { name: 'Metro Wholesale', phone: '+91 98765 00011', email: 'b2b@metrowholesale.in', address: 'Yeshwanthpur, Bengaluru', gstin: '29AAACM5678B1Z9', items: ['Farmhouse Pizza', 'BBQ Chicken Pizza', 'Butter Chicken', 'Chicken Stroganoff', 'Chicken Biryani'], status: 'active' },
  { name: 'Karnataka Agro', phone: '+91 87654 99887', email: 'supply@karnatakaagro.com', address: 'Hosur Road, Bengaluru', gstin: '29AAACK9012C1Z3', items: ['Hara Bhara Kebab', 'Spring Rolls', 'Veg Biryani', 'Dal Makhani', 'Masala Dosa', 'Idli Sambar', 'Medu Vada'], status: 'active' },
  { name: 'Spice Junction', phone: '+91 76543 55664', email: 'sales@spicejunction.in', address: 'Koramangala, Bengaluru', gstin: '29AAACS3456D1Z1', items: ['Paneer Tikka', 'Chilli Paneer Dry', 'Palak Paneer', 'Paneer Butter Masala', 'Rogan Josh', 'Mutton Biryani', 'Hyderabadi Dum Biryani'], status: 'active' },
  { name: 'Daily Fresh Foods', phone: '+91 65432 22119', email: 'contact@dailyfresh.in', address: 'Hennur, Bengaluru', gstin: '29AAACD7890E1Z7', items: ['Chicken Fried Rice', 'Chilli Chicken', 'Veg Hakka Noodles', 'Gobi Manchurian', 'Prawn Biryani', 'Gulab Jamun', 'Chocolate Brownie'], status: 'active' },
  { name: 'Golden Crust Bakers', phone: '+91 54321 88990', email: 'orders@goldencrust.in', address: 'Indiranagar, Bengaluru', gstin: '29AAACG1122F1Z4', items: ['Butter Naan', 'Garlic Naan', 'Cheese Garlic Naan', 'Tandoori Roti'], status: 'active' },
  { name: 'Ocean Catch Seafood', phone: '+91 43210 77881', email: 'fresh@oceancatch.in', address: 'Mangaluru', gstin: '29AAACO3344G1Z2', items: ['Prawn Biryani', 'Fish Amritsari', 'Grilled Fish in Lemon Butter'], status: 'active' },
];

// ─── Product updates: expiry dates + batch numbers (perishable menu items) ──
// daysFromNow: negative = already expired, positive = expiring in N days.
const EXPIRY_UPDATES = [
  { name: 'Cheese Burst Pizza', daysFromNow: -2, batch: 'B-2026-08-05' },
  { name: 'Fish Amritsari', daysFromNow: -1, batch: 'B-2026-08-06' },
  { name: 'Gulab Jamun', daysFromNow: -3, batch: 'B-2026-08-04' },
  { name: 'Paneer Tikka', daysFromNow: 2, batch: 'B-2026-08-09' },
  { name: 'Butter Chicken', daysFromNow: 3, batch: 'B-2026-08-10' },
  { name: 'Chicken Tikka', daysFromNow: 4, batch: 'B-2026-08-11' },
  { name: 'Prawn Biryani', daysFromNow: 5, batch: 'B-2026-08-12' },
  { name: 'Tandoori Wings', daysFromNow: 6, batch: 'B-2026-08-13' },
  { name: 'Paneer Butter Masala', daysFromNow: 7, batch: 'B-2026-08-10' },
  { name: 'Grilled Fish in Lemon Butter', daysFromNow: 12, batch: 'B-2026-08-15' },
  { name: 'Palak Paneer', daysFromNow: 15, batch: 'B-2026-08-18' },
  { name: 'Chicken Biryani', daysFromNow: 20, batch: 'B-2026-08-25' },
  { name: 'Kadai Chicken', daysFromNow: 25, batch: 'B-2026-08-30' },
  { name: 'Chicken Stroganoff', daysFromNow: 28, batch: 'B-2026-09-02' },
];

// ─── Low-stock tweaks: push currentStock below minStock + reorderLevel so the
// ─── Dashboard alerts + Low Stock report show real items. ──────────────────
const STOCK_TWEAKS = [
  { name: 'Cheese Burst Pizza', currentStock: 6 },
  { name: 'Tandoori Wings', currentStock: 12 },
  { name: 'Fish Amritsari', currentStock: 5 },
];

// ─── Purchases (last 30 days) — item must match a product name. ────────────
const PURCHASES = [
  { item: 'Margherita Pizza', supplier: 'FreshMart Supplies', qty: 25, daysAgo: 1 },
  { item: 'Butter Chicken', supplier: 'Metro Wholesale', qty: 26, daysAgo: 1 },
  { item: 'Butter Naan', supplier: 'Golden Crust Bakers', qty: 50, daysAgo: 1 },
  { item: 'Paneer Tikka', supplier: 'Spice Junction', qty: 30, daysAgo: 2 },
  { item: 'Tandoori Wings', supplier: 'FreshMart Supplies', qty: 35, daysAgo: 2 },
  { item: 'Garlic Naan', supplier: 'Golden Crust Bakers', qty: 60, daysAgo: 2 },
  { item: 'Pepperoni Pizza', supplier: 'Daily Fresh Foods', qty: 20, daysAgo: 3 },
  { item: 'Chicken Biryani', supplier: 'Metro Wholesale', qty: 32, daysAgo: 3 },
  { item: 'Gulab Jamun', supplier: 'Daily Fresh Foods', qty: 45, daysAgo: 3 },
  { item: 'Cheese Burst Pizza', supplier: 'FreshMart Supplies', qty: 15, daysAgo: 4 },
  { item: 'Paneer Butter Masala', supplier: 'Spice Junction', qty: 20, daysAgo: 4 },
  { item: 'Chicken Tikka', supplier: 'FreshMart Supplies', qty: 28, daysAgo: 5 },
  { item: 'Masala Dosa', supplier: 'Karnataka Agro', qty: 40, daysAgo: 5 },
  { item: 'BBQ Chicken Pizza', supplier: 'Metro Wholesale', qty: 18, daysAgo: 6 },
  { item: 'Veg Biryani', supplier: 'Karnataka Agro', qty: 20, daysAgo: 6 },
  { item: 'Fish Amritsari', supplier: 'Ocean Catch Seafood', qty: 12, daysAgo: 7 },
  { item: 'Palak Paneer', supplier: 'Spice Junction', qty: 22, daysAgo: 8 },
  { item: 'Chocolate Brownie', supplier: 'Daily Fresh Foods', qty: 30, daysAgo: 9 },
  { item: 'Rogan Josh', supplier: 'Spice Junction', qty: 15, daysAgo: 9 },
  { item: 'Dal Makhani', supplier: 'Karnataka Agro', qty: 18, daysAgo: 10 },
  { item: 'Chicken Fried Rice', supplier: 'Daily Fresh Foods', qty: 24, daysAgo: 11 },
  { item: 'Mutton Biryani', supplier: 'Spice Junction', qty: 12, daysAgo: 12 },
];

// ─── Waste events (InventoryEvent type 'waste', signed NEGATIVE quantity — the
// ─── stock engine convention; details embed the reason keyword the UI parses) ─
const WASTE_EVENTS = [
  { item: 'Cheese Burst Pizza', qty: -3, reason: 'expired', daysAgo: 2 },
  { item: 'Fish Amritsari', qty: -2, reason: 'expired', daysAgo: 4 },
  { item: 'Gulab Jamun', qty: -4, reason: 'spoiled', daysAgo: 3 },
  { item: 'Butter Chicken', qty: -2, reason: 'burnt', daysAgo: 1 },
  { item: 'Paneer Tikka', qty: -3, reason: 'spoiled', daysAgo: 5 },
  { item: 'Tandoori Wings', qty: -4, reason: 'dropped', daysAgo: 3 },
  { item: 'Masala Dosa', qty: -2, reason: 'burnt', daysAgo: 6 },
  { item: 'Chicken Biryani', qty: -2, reason: 'expired', daysAgo: 2 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
const log = (msg) => console.log(msg);

(async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;

  const restaurant = await db.collection('restaurants').findOne({ name: RESTAURANT_MATCH });
  if (!restaurant) throw new Error('Mega Feast House restaurant not found');
  const restId = restaurant._id;
  const branch = await db.collection('branches').findOne({ restaurantId: restId });
  const branchId = branch ? branch._id : null;
  log(`Restaurant: ${restaurant.name} (${restId})`);
  log(`Branch: ${branch ? branch.name : 'none'} (${branchId})`);

  // ── Products: expiry + batch + low-stock tweaks ─────────────────────────
  let expUpdated = 0;
  for (const u of EXPIRY_UPDATES) {
    const res = await db.collection('products').updateOne(
      { restaurantId: restId, name: u.name },
      { $set: { expiryDate: dateFromNow(u.daysFromNow), batchNumber: u.batch } }
    );
    if (res.matchedCount) expUpdated++;
  }
  let stockTweaked = 0;
  for (const t of STOCK_TWEAKS) {
    const res = await db.collection('products').updateOne(
      { restaurantId: restId, name: t.name },
      { $set: { currentStock: t.currentStock } }
    );
    if (res.matchedCount) stockTweaked++;
  }
  log(`Products updated: ${expUpdated} with expiry dates, ${stockTweaked} with low-stock levels`);

  // ── Suppliers (replace) ────────────────────────────────────────────────
  await db.collection('suppliers').deleteMany({ restaurantId: restId });
  if (SUPPLIERS.length) {
    await db.collection('suppliers').insertMany(
      SUPPLIERS.map((s) => ({
        restaurantId: restId,
        branchId: branchId || undefined,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        gstin: s.gstin,
        items: s.items,
        status: s.status,
        notes: '',
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  }
  log(`Suppliers seeded: ${SUPPLIERS.length}`);

  // ── Purchases + purchase events (replace) ──────────────────────────────
  const products = await db.collection('products').find({ restaurantId: restId }).toArray();
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));

  await db.collection('purchases').deleteMany({ restaurantId: restId });
  const purchaseDocs = [];
  const purchaseEvents = [];
  for (const p of PURCHASES) {
    const prod = byName.get(p.item.toLowerCase());
    if (!prod) { log(`  ✗ skip purchase: no product named "${p.item}"`); continue; }
    const price = Math.round((Number(prod.averageCost) || 0) * 100) / 100;
    const total = Math.round(price * p.qty * 100) / 100;
    const date = dateFromNow(-p.daysAgo);
    purchaseDocs.push({
      restaurantId: restId,
      branchId: branchId || undefined,
      supplier: p.supplier,
      item: p.item,
      category: prod.category || '',
      quantity: p.qty,
      unit: prod.unit || 'pcs',
      price,
      total,
      date,
      status: 'completed',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    purchaseEvents.push({
      restaurantId: restId,
      branchId: branchId || undefined,
      type: 'purchase',
      item: p.item,
      quantity: p.qty,
      unit: prod.unit || 'pcs',
      operator: 'System',
      details: `Purchase from ${p.supplier}`,
      eventDate: date,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  if (purchaseDocs.length) await db.collection('purchases').insertMany(purchaseDocs);
  log(`Purchases seeded: ${purchaseDocs.length}`);

  // ── Inventory events (replace — both purchase + waste so re-runs never
  // ── duplicate; other event types like 'sold'/'adjusted' are left intact) ──
  await db.collection('inventoryevents').deleteMany({ restaurantId: restId, type: { $in: ['waste', 'purchase'] } });
  const wasteDocs = WASTE_EVENTS.map((w) => {
    const prod = byName.get(w.item.toLowerCase());
    const unit = (prod && prod.unit) || 'pcs';
    return {
      restaurantId: restId,
      branchId: branchId || undefined,
      type: 'waste',
      item: w.item,
      quantity: w.qty,
      unit,
      operator: 'System',
      details: `${w.reason} ${Math.abs(w.qty)} ${unit} ${w.item} discarded`,
      eventDate: dateFromNow(-w.daysAgo),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  if (wasteDocs.length) await db.collection('inventoryevents').insertMany(wasteDocs);
  log(`Waste events seeded: ${wasteDocs.length}`);

  if (purchaseEvents.length) await db.collection('inventoryevents').insertMany(purchaseEvents);
  log(`Purchase events seeded: ${purchaseEvents.length}`);

  // ── Summary ────────────────────────────────────────────────────────────
  const purchases = await db.collection('purchases').find({ restaurantId: restId }).toArray();
  const totalSpend = purchases.reduce((s, p) => s + (p.total || 0), 0);
  const wasteCount = await db.collection('inventoryevents').countDocuments({ restaurantId: restId, type: 'waste' });
  const withExp = await db.collection('products').countDocuments({ restaurantId: restId, expiryDate: { $ne: '' } });
  const suppliers = await db.collection('suppliers').countDocuments({ restaurantId: restId });
  log('─'.repeat(50));
  log(`SUMMARY — ${restaurant.name}`);
  log(`  Products with expiry dates : ${withExp}`);
  log(`  Purchases (30d)            : ${purchases.length} · ₹${Math.round(totalSpend).toLocaleString()}`);
  log(`  Waste events               : ${wasteCount}`);
  log(`  Suppliers                  : ${suppliers}`);
  log(`  Low-stock products         : ${STOCK_TWEAKS.length}`);

  await mongoose.disconnect();
  log('Seed complete ✓');
})().catch((e) => { console.error('SEED ERROR:', e.message); process.exit(1); });
