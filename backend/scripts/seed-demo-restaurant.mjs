/**
 * =============================================================================
 * seed-demo-restaurant.mjs — End-to-end demo restaurant + full data seeding
 * =============================================================================
 *
 * What it does (all through the real HTTP API, so everything lands in MongoDB):
 *   1. Admin login  → create an ALL-FEATURES subscription plan
 *   2. Create a restaurant on that plan (cash onboarding → Payment + Invoice)
 *   3. POS login as the new Owner (ownerUserId / ownerPin)
 *   4. Populate EVERY data area: branches, products, customers, employees,
 *      tables, orders, takeaway orders, reservations, waiting list, expenses,
 *      rewards, offers, bills, device, voice-inventory aliases, branch settings
 *   5. Verify with direct MongoDB counts (mongoose)
 *
 * Run from backend/ :  node scripts/seed-demo-restaurant.mjs
 * Prereqs: backend running on :3002 with MongoDB connected.
 * =============================================================================
 */

import mongoose from 'mongoose';

const BASE = 'http://localhost:3002/api';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1008';

// Demo data markers used by cleanup so re-runs never leave stale/duplicate data.
const DEMO_NAME_PREFIX = 'Spice Symphony';
const DEMO_PHONES = ['9812345670','9823456781','9834567892','9845678903','9856789014','9867890125','9878901236','9889012347','9890123458','9801234569'];
const DEMO_REWARD_TITLES = ['10% Off Your Bill', '₹50 Off', 'Free Dessert', '20% Off (Large Bills)', 'Free Starter'];
const DEMO_EMPLOYEE_USERNAMES = ['owner', 'manager', 'cashier1', 'cashier2'];
// Product codes used by this script. Products are a GLOBAL collection (the
// Product model has no restaurantId), so previous runs' products can only be
// identified by code — every product with these codes was created by this
// script (no pre-existing data used them).
const DEMO_PRODUCT_CODES = [
  'PZ001','PZ002','ST001','ST002','ST003','ST004','MC001','MC002','MC003','MC004',
  'BY001','BY002','BY003','BD001','BD002','SI001','SI002','CN001','CN002',
  'DS001','DS002','BV001','BV002','BV003','BV004',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Deterministic PRNG + local date helpers (30-day history) ─
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260731);
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

const TIME_SLOTS = [
  '10:15','10:40','11:05','11:30','11:55','12:20','12:45','13:10','13:35','14:00',
  '14:25','14:50','15:15','15:40','16:05','16:30','16:55','17:20','17:45','18:10',
  '18:35','19:00','19:25','19:50','20:15','20:40','21:05','21:30','21:55','22:20',
];

async function ensureMongo() {
  if (!mongoose.connection.readyState) {
    await mongoose.connect('mongodb://localhost:27017/pos');
  }
}

/**
 * Remove every previous demo restaurant ('Spice Symphony *') and ALL of its
 * data, plus the demo customers/rewards (global collections — identified by
 * the exact demo phone numbers / titles) and the NULL-restaurantId demo
 * employees (created by older runs before the restaurantId fix). Other
 * restaurants' data is never touched.
 */
async function cleanupDemoData() {
  log(`\n[0] Cleanup — removing previous demo data (${DEMO_NAME_PREFIX} *)`);
  await ensureMongo();
  const db = mongoose.connection.db;
  let removed = 0;

  const demoRests = await db.collection('restaurants').find({ name: { $regex: `^${DEMO_NAME_PREFIX}` } }).toArray();
  const ids = demoRests.map((r) => r._id);

  // Global collections (no restaurantId on the model) — always remove leftover
  // demo docs from prior runs, identified by exact phone / title / username /
  // code. These run even if no demo restaurant currently exists.
  const cDel = await db.collection('customers').deleteMany({ phone: { $in: DEMO_PHONES } });
  removed += cDel.deletedCount || 0;
  const rDel = await db.collection('rewards').deleteMany({ title: { $in: DEMO_REWARD_TITLES } });
  removed += rDel.deletedCount || 0;
  // Employees created before the restaurantId fix have NULL restaurantId —
  // remove them by username ONLY when they have no restaurantId or belong to a
  // demo restaurant, so another restaurant's employee sharing a username is
  // never touched (usernames are globally unique, so this is belt-and-suspenders).
  const eDel = await db.collection('employees').deleteMany({
    username: { $in: DEMO_EMPLOYEE_USERNAMES },
    $or: [{ restaurantId: null }, { restaurantId: { $in: ids } }],
  });
  removed += eDel.deletedCount || 0;
  // Products are global (no restaurantId) — remove the demo product codes
  const pDel = await db.collection('products').deleteMany({ code: { $in: DEMO_PRODUCT_CODES } });
  removed += pDel.deletedCount || 0;

  // Orphaned demo leftovers from ABORTED runs. If a previous run was killed
  // mid-seed, its restaurant may already be gone while its scoped rows remain
  // (cleanup above only matches restaurants that still exist). Snapshot ALL
  // live branches + restaurants first: orphan rows are only deleted when they
  // carry a script-only marker (^SS-INV- / ^SUB-2026-HIST-) AND point at a
  // branch / restaurant that no longer exists — so no live restaurant's data
  // (demo or otherwise) can ever be touched. Current demo restaurants' rows
  // are handled by the scoped cleanup below.
  const allBranches = await db.collection('branches').find({}, { projection: { _id: 1 } }).toArray();
  const allBranchIds = allBranches.map((b) => b._id);
  const allRests = await db.collection('restaurants').find({}, { projection: { _id: 1 } }).toArray();
  const allRestIds = allRests.map((r) => r._id);

  const histPayDel = allRestIds.length
    ? await db.collection('payments').deleteMany({
        invoiceNumber: { $regex: '^SUB-2026-HIST-' },
        $or: [{ restaurantId: { $nin: allRestIds } }, { restaurantId: { $exists: false } }],
      })
    : await db.collection('payments').deleteMany({ invoiceNumber: { $regex: '^SUB-2026-HIST-' } });
  removed += histPayDel.deletedCount || 0;

  const markerBillScope = {
    invoiceNumber: { $regex: '^SS-INV-' },
    $or: [{ branchId: { $nin: allBranchIds } }, { branchId: { $exists: false } }],
  };
  const markerBillDel = allBranchIds.length
    ? await db.collection('bills').deleteMany(markerBillScope)
    : await db.collection('bills').deleteMany({ invoiceNumber: { $regex: '^SS-INV-' } });
  removed += markerBillDel.deletedCount || 0;

  // Daily summaries whose branch no longer exists (orphaned by an aborted run).
  // Note: $nin compares against the ObjectId snapshot above; every doc this
  // script writes stores branchId/restaurantId as ObjectId (API-created bills
  // and direct Mongo inserts use new mongoose.Types.ObjectId()), so string
  // leftovers would not match — none exist today.
  const orphanDs = allBranchIds.length
    ? await db.collection('dailysummaries').deleteMany({ branchId: { $nin: allBranchIds } })
    : await db.collection('dailysummaries').deleteMany({});
  removed += orphanDs.deletedCount || 0;

  if (ids.length > 0) {
    const branches = await db.collection('branches').find({ restaurantId: { $in: ids } }, { projection: { _id: 1 } }).toArray();
    const branchIds = branches.map((b) => b._id);

    // userId clause catches pre-fix device/refresh-token docs that were written
    // with userId = restaurant _id (owner login) but no restaurantId field.
    const scope = { $or: [{ restaurantId: { $in: ids } }, { branchId: { $in: branchIds } }, { userId: { $in: ids } }] };
    const scopedCollections = [
      'subscriptions', 'payments', 'invoices', 'branches', 'branchsettings',
      'users', 'employees', 'products', 'tables', 'orders', 'takeawayorders',
      'reservations', 'expenses', 'bills', 'offers', 'devices', 'itemaliases',
      'dailysummaries',
    ];
    for (const c of scopedCollections) {
      try {
        const r = await db.collection(c).deleteMany(scope);
        removed += r.deletedCount || 0;
      } catch (e) {
        log(`  ⚠ ${c} cleanup skipped: ${e.message}`);
      }
    }
    // Stale refresh tokens reference the owner login (userId = restaurant _id)
    await db.collection('refreshTokens').deleteMany({ userId: { $in: ids } }).catch(() => {});
    // Demo audit logs: BILL_CREATED entries carry our invoice prefix, and
    // backfilled LOGIN entries carry the demo restaurant code in details.restaurantId
    await db.collection('auditlogs').deleteMany({
      $or: [
        { action: 'BILL_CREATED', 'details.invoiceNumber': { $regex: '^SS-INV-' } },
        { action: 'LOGIN', 'details.restaurantId': { $regex: '^SPICE_SYMPHONY_' } },
      ],
    }).catch(() => {});
    // Finally the restaurants themselves
    const restDel = await db.collection('restaurants').deleteMany({ _id: { $in: ids } });
    removed += restDel.deletedCount || 0;
    log(`  Removed ${removed} documents across ${demoRests.length} demo restaurant(s).`);
  } else {
    log(`  Removed ${removed} leftover demo documents (no demo restaurants found).`);
  }
  await mongoose.disconnect();
}
let _last = 0;
async function req(method, path, body, token) {
  // Pace at ~1.1s/call (~55/min) — safely under the backend's 120 req/min per-IP
  // apiLimiter. On 429, back off and retry (sliding window may still be full).
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, 1000 - (Date.now() - _last));
    if (wait > 0) await sleep(wait);
    _last = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 429 && attempt < 8) {
      log(`  … rate-limited (${path}), backing off 6s (retry ${attempt + 1}/8)`);
      await sleep(6000);
      continue;
    }
    return { status: res.status, json };
  }
}

const log = (msg) => console.log(msg);
const ok = (label, r, extra) => {
  if (r.status >= 200 && r.status < 300) log(`  ✓ ${label}`);
  else log(`  ✗ ${label} → HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 300)}`);
  return r.status >= 200 && r.status < 300;
};

// ─────────────────────────────────────────────────────────────
// 1) ADMIN LOGIN
// ─────────────────────────────────────────────────────────────
async function adminLogin() {
  log('\n[1] Admin login');
  const r = await req('POST', '/auth/admin/login', { userId: ADMIN_USER, password: ADMIN_PASS });
  if (!ok('admin login', r)) throw new Error('Admin login failed');
  return r.json.token;
}

// ─────────────────────────────────────────────────────────────
// 2) CREATE ALL-FEATURES PLAN
// ─────────────────────────────────────────────────────────────
const ALL_FEATURES = [
  'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty',
  'reservations', 'multi_branch', 'analytics', 'custom_branding',
  'advanced_reports', 'expense_tracking', 'api_access', 'priority_support',
];

async function createPlan(adminToken) {
  log('\n[2] Create all-features subscription plan');
  const body = {
    planId: 'premium_all',
    name: 'Premium — All Features',
    description: 'Every POS feature unlocked: inventory, analytics, loyalty, AI, reservations, multi-branch, expenses & more.',
    price: 4999,
    maxUsers: 100,
    maxDevices: 20,
    features: ALL_FEATURES,
    aiEnabled: true,
    trialDays: 7,
    sortOrder: 1,
    isActive: true,
    isDefault: false,
    limits: { maxBranches: 10, maxDevices: 20, maxEmployees: 100 },
  };
  let r = await req('POST', '/admin/subscription-plans', body, adminToken);
  if (r.status === 409) {
    log('  Plan already exists — reusing it.');
    const list = await req('GET', '/admin/subscription-plans?active=true', undefined, adminToken);
    const found = (list.json?.data || []).find((p) => p.planId === 'premium_all');
    if (found) return found.planId; // NOTE: must return the planId STRING (used in restaurant body.plan)
    throw new Error('Plan exists but could not be found');
  }
  if (!ok('create plan', r)) throw new Error('Plan creation failed');
  return r.json.planId; // NOTE: must return the planId STRING (used in restaurant body.plan)
}

// ─────────────────────────────────────────────────────────────
// 3) CREATE RESTAURANT (cash onboarding → Payment + Invoice)
// ─────────────────────────────────────────────────────────────
async function createRestaurant(adminToken, planId) {
  log('\n[3] Create restaurant on the all-features plan');
  const suffix = Date.now().toString(36).slice(-4);
  const body = {
    name: `Spice Symphony ${suffix}`,
    restaurantType: 'Casual Dining',
    cuisineType: 'North Indian, Chinese, South Indian',
    phone: '9876543210',
    altPhone: '9123456780',
    email: `spice${suffix}@demo.com`,
    website: 'https://spicesymphony.example',
    description: 'Full-service restaurant seeded with complete demo data.',
    address: '42 MG Road, Indiranagar',
    area: 'Indiranagar',
    city: 'Bengaluru',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    country: 'India',
    pinCode: '560038',
    gst: '29ABCDE1234F1Z5',
    fssai: '11223344556677',
    pan: 'ABCDE1234F',
    ownerName: 'Aarav Sharma',
    ownerEmail: `aarav${suffix}@demo.com`,
    plan: planId,
    onboardingMode: 'cash', // immediate activation → active subscription + Payment + Invoice
  };
  const r = await req('POST', '/admin/restaurants', body, adminToken);
  if (!ok('create restaurant', r)) throw new Error('Restaurant creation failed');
  return r.json;
}

// ─────────────────────────────────────────────────────────────
// 4) POS LOGIN AS OWNER
// ─────────────────────────────────────────────────────────────
async function ownerLogin(restaurant) {
  log('\n[4] POS login as Owner');
  const r = await req('POST', '/auth/login', { username: restaurant.ownerUserId, password: restaurant.ownerPin });
  if (!ok('owner login', r)) throw new Error('Owner POS login failed');
  return r.json.accessToken;
}

// ─────────────────────────────────────────────────────────────
// 5) SEED ALL DATA AREAS
// ─────────────────────────────────────────────────────────────
async function seedData(token, restaurantId) {
  const created = {};
  const branchIds = { head: null, second: null };

  log('\n[5] Seeding data areas');

  // ─── Branches ─────────────────────────────────────────────
  log('  · Branches');
  let r = await req('POST', '/branches', { name: 'Spice Symphony — Head Office', address: '42 MG Road, Bengaluru', phone: '9876543210', isHeadBranch: true, isActive: true }, token);
  if (ok('head branch', r)) branchIds.head = r.json?.data?._id || r.json?.data?.id || r.json?._id;
  else log(`    response: ${JSON.stringify(r.json)?.slice(0, 300)}`);
  r = await req('POST', '/branches', { name: 'Spice Symphony — Koramangala', address: '17 100 Feet Road, Koramangala', phone: '9123456780', isHeadBranch: false, isActive: true }, token);
  if (ok('second branch', r)) branchIds.second = r.json?.data?._id || r.json?.data?.id || r.json?._id;
  else log(`    response: ${JSON.stringify(r.json)?.slice(0, 300)}`);
  created.branches = [branchIds.head, branchIds.second].filter(Boolean).length;

  // ─── Branch settings (currency etc.) ──────────────────────
  if (branchIds.head) {
    const bs = await req('PUT', `/branches/${branchIds.head}/settings`, {
      restaurantName: 'Spice Symphony',
      currency: 'INR',
      currencySymbol: '₹',
      defaultTaxRate: 5,
      printSize: '80mm',
      invoicePrefix: 'SS',
      invoiceStartingNumber: 1001,
      receiptFooterMessage: 'Thank you for dining with us!',
    }, token);
    ok('branch settings (head)', bs);
  }

  // ─── Products (menu) ──────────────────────────────────────
  log('  · Products');
  const products = [
    { name: 'Margherita Pizza', code: 'PZ001', price: 299, category: 'Pizza', gstPercent: 5, availability: true, favorite: true, variants: [{ name: 'Small', price: 249 }, { name: 'Medium', price: 299 }, { name: 'Large', price: 399 }] },
    { name: 'Pepperoni Pizza', code: 'PZ002', price: 399, category: 'Pizza', gstPercent: 5, availability: true, variants: [{ name: 'Small', price: 349 }, { name: 'Large', price: 499 }] },
    { name: 'Paneer Tikka', code: 'ST001', price: 249, category: 'Starters', gstPercent: 12, availability: true, favorite: true },
    { name: 'Chicken Tikka', code: 'ST002', price: 289, category: 'Starters', gstPercent: 12, availability: true },
    { name: 'Spring Rolls', code: 'ST003', price: 179, category: 'Starters', gstPercent: 12, availability: true },
    { name: 'Chicken 65', code: 'ST004', price: 269, category: 'Starters', gstPercent: 12, availability: true },
    { name: 'Butter Chicken', code: 'MC001', price: 349, category: 'Main Course', gstPercent: 12, availability: true, favorite: true },
    { name: 'Paneer Butter Masala', code: 'MC002', price: 299, category: 'Main Course', gstPercent: 12, availability: true },
    { name: 'Dal Makhani', code: 'MC003', price: 229, category: 'Main Course', gstPercent: 12, availability: true },
    { name: 'Fish Curry', code: 'MC004', price: 329, category: 'Main Course', gstPercent: 12, availability: true },
    { name: 'Veg Biryani', code: 'BY001', price: 249, category: 'Biryani', gstPercent: 5, availability: true, variants: [{ name: 'Half', price: 149 }, { name: 'Full', price: 249 }] },
    { name: 'Chicken Biryani', code: 'BY002', price: 299, category: 'Biryani', gstPercent: 5, availability: true, favorite: true, variants: [{ name: 'Half', price: 179 }, { name: 'Full', price: 299 }] },
    { name: 'Mutton Biryani', code: 'BY003', price: 379, category: 'Biryani', gstPercent: 5, availability: true },
    { name: 'Garlic Naan', code: 'BD001', price: 59, category: 'Breads', gstPercent: 5, availability: true },
    { name: 'Tandoori Roti', code: 'BD002', price: 39, category: 'Breads', gstPercent: 5, availability: true },
    { name: 'Masala Dosa', code: 'SI001', price: 129, category: 'South Indian', gstPercent: 5, availability: true, favorite: true },
    { name: 'Idli Sambar', code: 'SI002', price: 99, category: 'South Indian', gstPercent: 5, availability: true },
    { name: 'Veg Fried Rice', code: 'CN001', price: 199, category: 'Chinese', gstPercent: 12, availability: true },
    { name: 'Chicken Hakka Noodles', code: 'CN002', price: 229, category: 'Chinese', gstPercent: 12, availability: true },
    { name: 'Chocolate Brownie', code: 'DS001', price: 149, category: 'Desserts', gstPercent: 18, availability: true, favorite: true },
    { name: 'Gulab Jamun', code: 'DS002', price: 89, category: 'Desserts', gstPercent: 18, availability: true },
    { name: 'Masala Chai', code: 'BV001', price: 49, category: 'Beverages', gstPercent: 5, availability: true },
    { name: 'Fresh Lime Soda', code: 'BV002', price: 79, category: 'Beverages', gstPercent: 5, availability: true },
    { name: 'Mango Lassi', code: 'BV003', price: 119, category: 'Beverages', gstPercent: 5, availability: true },
    { name: 'Cold Coffee', code: 'BV004', price: 139, category: 'Beverages', gstPercent: 5, availability: true },
  ];
  let prodCount = 0;
  for (const p of products) {
    const pr = await req('POST', '/products', p, token);
    if (ok(`product ${p.code}`, pr)) prodCount++;
  }
  created.products = prodCount;

  // Fetch created products to map code → _id (for orders/bills + stock update)
  const prodList = await req('GET', '/products', undefined, token);
  const prodById = {};
  (prodList.json?.data || []).forEach((p) => { prodById[p.code] = p; });

  // ─── Product stock levels (inventory on Product model) ────
  const stockMap = {
    PZ001: { currentStock: 25, unit: 'pcs', minStock: 10, maxStock: 60 },
    PZ002: { currentStock: 14, unit: 'pcs', minStock: 8, maxStock: 40 },
    ST001: { currentStock: 40, unit: 'plates', minStock: 15, maxStock: 80 },
    ST002: { currentStock: 35, unit: 'plates', minStock: 15, maxStock: 80 },
    ST003: { currentStock: 8, unit: 'plates', minStock: 12, maxStock: 60 },
    ST004: { currentStock: 6, unit: 'plates', minStock: 12, maxStock: 60 },
    MC001: { currentStock: 30, unit: 'bowls', minStock: 10, maxStock: 70 },
    MC002: { currentStock: 28, unit: 'bowls', minStock: 10, maxStock: 70 },
    MC003: { currentStock: 5, unit: 'bowls', minStock: 12, maxStock: 70 },
    MC004: { currentStock: 18, unit: 'bowls', minStock: 8, maxStock: 50 },
    BY001: { currentStock: 32, unit: 'servings', minStock: 15, maxStock: 80 },
    BY002: { currentStock: 26, unit: 'servings', minStock: 15, maxStock: 80 },
    BY003: { currentStock: 3, unit: 'servings', minStock: 8, maxStock: 40 },
    BD001: { currentStock: 60, unit: 'pcs', minStock: 20, maxStock: 150 },
    BD002: { currentStock: 80, unit: 'pcs', minStock: 20, maxStock: 200 },
    SI001: { currentStock: 45, unit: 'plates', minStock: 15, maxStock: 100 },
    SI002: { currentStock: 50, unit: 'plates', minStock: 15, maxStock: 100 },
    CN001: { currentStock: 22, unit: 'plates', minStock: 10, maxStock: 60 },
    CN002: { currentStock: 4, unit: 'plates', minStock: 10, maxStock: 60 },
    DS001: { currentStock: 24, unit: 'pcs', minStock: 12, maxStock: 60 },
    DS002: { currentStock: 36, unit: 'pcs', minStock: 12, maxStock: 80 },
    BV001: { currentStock: 0, unit: 'cups', minStock: 20, maxStock: 100 },
    BV002: { currentStock: 90, unit: 'glasses', minStock: 20, maxStock: 150 },
    BV003: { currentStock: 15, unit: 'glasses', minStock: 15, maxStock: 100 },
    BV004: { currentStock: 30, unit: 'glasses', minStock: 15, maxStock: 100 },
  };

  // ─── Customers (loyalty) ──────────────────────────────────
  log('  · Customers');
  const customers = [
    { phone: '9812345670', name: 'Priya Mehta', points: 120, visits: 14, birthday: '1990-03-12', lastVisit: '2026-07-28', email: 'priya@example.com' },
    { phone: '9823456781', name: 'Rahul Verma', points: 85, visits: 9, birthday: '1988-11-02', lastVisit: '2026-07-30' },
    { phone: '9834567892', name: 'Ananya Iyer', points: 240, visits: 22, birthday: '1995-06-21', lastVisit: '2026-07-31', email: 'ananya@example.com' },
    { phone: '9845678903', name: 'Vikram Singh', points: 40, visits: 4, birthday: '1985-01-15', lastVisit: '2026-07-25' },
    { phone: '9856789014', name: 'Sneha Kulkarni', points: 175, visits: 17, birthday: '1992-09-09', lastVisit: '2026-07-29' },
    { phone: '9867890125', name: 'Arjun Nair', points: 65, visits: 7, birthday: '1987-04-30', lastVisit: '2026-07-27' },
    { phone: '9878901236', name: 'Divya Reddy', points: 300, visits: 28, birthday: '1998-12-25', lastVisit: '2026-07-31', email: 'divya@example.com' },
    { phone: '9889012347', name: 'Karan Malhotra', points: 10, visits: 1, birthday: '1993-07-19', lastVisit: '2026-07-31' },
    { phone: '9890123458', name: 'Meera Pillai', points: 130, visits: 12, birthday: '1991-02-14', lastVisit: '2026-07-26' },
    { phone: '9801234569', name: 'Rohan Gupta', points: 55, visits: 6, birthday: '1989-08-08', lastVisit: '2026-07-24' },
  ];
  let custCount = 0;
  for (const c of customers) {
    const cr = await req('POST', '/customers', c, token);
    if (ok(`customer ${c.phone}`, cr)) custCount++;
  }
  created.customers = custCount;

  // ─── Employees (staff) ─────────────────────────────────────
  log('  · Employees');
  const employees = [
    { username: 'owner', name: 'Aarav Sharma', role: 'Owner', pin: '1008', branchId: branchIds.head },
    { username: 'manager', name: 'Neha Kapoor', role: 'Manager', pin: '2009', branchId: branchIds.head },
    { username: 'cashier1', name: 'Suresh Kumar', role: 'Cashier', pin: '1234', branchId: branchIds.head },
    { username: 'cashier2', name: 'Lakshmi Rao', role: 'Cashier', pin: '2345', branchId: branchIds.second },
  ];
  let empCount = 0;
  for (const e of employees) {
    const er = await req('POST', '/employees', e, token);
    if (ok(`employee ${e.username}`, er)) empCount++;
  }
  created.employees = empCount;

  // ─── Tables (floor plan) ───────────────────────────────────
  log('  · Tables');
  const tables = [
    { number: 1, capacity: 2, section: 'Window', branchId: branchIds.head, shape: 'circle', x: 120, y: 80 },
    { number: 2, capacity: 2, section: 'Window', branchId: branchIds.head, shape: 'circle', x: 240, y: 80 },
    { number: 3, capacity: 4, section: 'Main Hall', branchId: branchIds.head, shape: 'square', x: 120, y: 200 },
    { number: 4, capacity: 4, section: 'Main Hall', branchId: branchIds.head, shape: 'square', x: 260, y: 200 },
    { number: 5, capacity: 4, section: 'Main Hall', branchId: branchIds.head, shape: 'square', x: 400, y: 200 },
    { number: 6, capacity: 6, section: 'Main Hall', branchId: branchIds.head, shape: 'rectangle', x: 140, y: 340 },
    { number: 7, capacity: 6, section: 'Main Hall', branchId: branchIds.head, shape: 'rectangle', x: 340, y: 340 },
    { number: 8, capacity: 8, section: 'VIP', branchId: branchIds.head, shape: 'rectangle', x: 200, y: 480 },
    { number: 9, capacity: 4, section: 'VIP', branchId: branchIds.head, shape: 'square', x: 420, y: 480 },
    { number: 10, capacity: 2, section: 'Outdoor', branchId: branchIds.head, shape: 'circle', x: 120, y: 620 },
    { number: 11, capacity: 4, section: 'Outdoor', branchId: branchIds.head, shape: 'square', x: 280, y: 620 },
    { number: 12, capacity: 10, section: 'Family', branchId: branchIds.head, shape: 'rectangle', x: 440, y: 620 },
    { number: 1, capacity: 4, section: 'Main Hall', branchId: branchIds.second, shape: 'square', x: 120, y: 100 },
    { number: 2, capacity: 6, section: 'Main Hall', branchId: branchIds.second, shape: 'rectangle', x: 300, y: 100 },
  ];
  let tableCount = 0;
  for (const t of tables) {
    const tr = await req('POST', '/tables', t, token);
    if (ok(`table ${t.branchId === branchIds.second ? 'Kor' : 'Head'}-${t.number}`, tr)) tableCount++;
  }
  created.tables = tableCount;

  // ─── Orders ────────────────────────────────────────────────
  log('  · Orders');
  const orderTypes = ['Dine In', 'Takeaway', 'Delivery', 'Swiggy', 'Zomato'];
  const orderStatuses = ['New', 'Accepted', 'Preparing', 'Ready', 'Served', 'Waiting Payment', 'Paid', 'Closed'];
  const orders = [
    { orderNumber: 1001, type: 'Dine In', tableNumber: 3, guestCount: 4, items: [
      { id: 'i1', product: prodById['PZ001'] || { name: 'Margherita Pizza' }, productName: 'Margherita Pizza', quantity: 1, price: 299, notes: 'extra cheese' },
      { id: 'i2', product: prodById['MC001'] || { name: 'Butter Chicken' }, productName: 'Butter Chicken', quantity: 1, price: 349 },
      { id: 'i3', product: prodById['BD001'] || { name: 'Garlic Naan' }, productName: 'Garlic Naan', quantity: 4, price: 59 },
    ] },
    { orderNumber: 1002, type: 'Dine In', tableNumber: 6, guestCount: 6, items: [
      { id: 'i1', product: prodById['BY002'] || { name: 'Chicken Biryani' }, productName: 'Chicken Biryani', quantity: 3, price: 299 },
      { id: 'i2', product: prodById['ST002'] || { name: 'Chicken Tikka' }, productName: 'Chicken Tikka', quantity: 2, price: 289 },
    ] },
    { orderNumber: 1003, type: 'Takeaway', customerName: 'Rahul Verma', customerPhone: '9823456781', items: [
      { id: 'i1', product: prodById['CN001'] || { name: 'Veg Fried Rice' }, productName: 'Veg Fried Rice', quantity: 1, price: 199 },
      { id: 'i2', product: prodById['CN002'] || { name: 'Chicken Hakka Noodles' }, productName: 'Chicken Hakka Noodles', quantity: 1, price: 229 },
    ] },
    { orderNumber: 1004, type: 'Swiggy', customerName: 'Ananya Iyer', customerPhone: '9834567892', items: [
      { id: 'i1', product: prodById['PZ002'] || { name: 'Pepperoni Pizza' }, productName: 'Pepperoni Pizza', quantity: 1, price: 399 },
      { id: 'i2', product: prodById['DS001'] || { name: 'Chocolate Brownie' }, productName: 'Chocolate Brownie', quantity: 2, price: 149 },
    ] },
    { orderNumber: 1005, type: 'Dine In', tableNumber: 8, guestCount: 8, items: [
      { id: 'i1', product: prodById['BY003'] || { name: 'Mutton Biryani' }, productName: 'Mutton Biryani', quantity: 2, price: 379 },
      { id: 'i2', product: prodById['MC002'] || { name: 'Paneer Butter Masala' }, productName: 'Paneer Butter Masala', quantity: 1, price: 299 },
      { id: 'i3', product: prodById['SI001'] || { name: 'Masala Dosa' }, productName: 'Masala Dosa', quantity: 2, price: 129 },
    ] },
    { orderNumber: 1006, type: 'Zomato', customerName: 'Divya Reddy', customerPhone: '9878901236', items: [
      { id: 'i1', product: prodById['MC003'] || { name: 'Dal Makhani' }, productName: 'Dal Makhani', quantity: 1, price: 229 },
      { id: 'i2', product: prodById['BD002'] || { name: 'Tandoori Roti' }, productName: 'Tandoori Roti', quantity: 3, price: 39 },
    ] },
  ];
  let orderCount = 0;
  for (const o of orders) {
    const payload = {
      ...o,
      status: orderStatuses[orderCount % orderStatuses.length],
      branchId: branchIds.head,
    };
    const or = await req('POST', '/orders', payload, token);
    if (ok(`order ${o.orderNumber}`, or)) orderCount++;
  }
  // Extra live orders (floor plan / kitchen display richness)
  const extraOrders = [
    { orderNumber: 1007, type: 'Dine In', tableNumber: 5, guestCount: 4, status: 'Preparing', items: [
      { id: 'e1', product: prodById['BY001'] || { name: 'Veg Biryani' }, productName: 'Veg Biryani', quantity: 1, price: 249 },
      { id: 'e2', product: prodById['ST001'] || { name: 'Paneer Tikka' }, productName: 'Paneer Tikka', quantity: 1, price: 249 },
    ] },
    { orderNumber: 1008, type: 'Dine In', tableNumber: 10, guestCount: 2, status: 'Served', items: [
      { id: 'e1', product: prodById['SI001'] || { name: 'Masala Dosa' }, productName: 'Masala Dosa', quantity: 2, price: 129 },
      { id: 'e2', product: prodById['BV002'] || { name: 'Fresh Lime Soda' }, productName: 'Fresh Lime Soda', quantity: 2, price: 79 },
    ] },
    { orderNumber: 1009, type: 'Dine In', tableNumber: 12, guestCount: 8, status: 'Ready', items: [
      { id: 'e1', product: prodById['BY002'] || { name: 'Chicken Biryani' }, productName: 'Chicken Biryani', quantity: 2, price: 299 },
      { id: 'e2', product: prodById['MC001'] || { name: 'Butter Chicken' }, productName: 'Butter Chicken', quantity: 1, price: 349 },
      { id: 'e3', product: prodById['DS001'] || { name: 'Chocolate Brownie' }, productName: 'Chocolate Brownie', quantity: 2, price: 149 },
    ] },
    { orderNumber: 1010, type: 'Delivery', customerName: 'Priya Mehta', customerPhone: '9812345670', guestCount: 3, status: 'Accepted', items: [
      { id: 'e1', product: prodById['CN001'] || { name: 'Veg Fried Rice' }, productName: 'Veg Fried Rice', quantity: 1, price: 199 },
      { id: 'e2', product: prodById['CN002'] || { name: 'Chicken Hakka Noodles' }, productName: 'Chicken Hakka Noodles', quantity: 1, price: 229 },
      { id: 'e3', product: prodById['BV003'] || { name: 'Mango Lassi' }, productName: 'Mango Lassi', quantity: 2, price: 119 },
    ] },
  ];
  for (const o of extraOrders) {
    const or = await req('POST', '/orders', { ...o, branchId: branchIds.head }, token);
    if (ok(`order ${o.orderNumber}`, or)) orderCount++;
  }
  created.orders = orderCount;

  // ─── Takeaway orders ───────────────────────────────────────
  log('  · Takeaway orders');
  const takeaways = [
    { orderNumber: 2001, customerName: 'Priya Mehta', customerPhone: '9812345670', amount: 597, paymentStatus: 'Paid', status: 'Collected', items: [{ itemName: 'Butter Chicken', quantity: 1, price: 349 }, { itemName: 'Garlic Naan', quantity: 2, price: 59 }, { itemName: 'Gulab Jamun', quantity: 2, price: 89 }] },
    { orderNumber: 2002, customerName: 'Sneha Kulkarni', customerPhone: '9856789014', amount: 448, paymentStatus: 'Paid', status: 'Ready', items: [{ itemName: 'Chicken Biryani', quantity: 1, price: 299 }, { itemName: 'Spring Rolls', quantity: 1, price: 179 }] },
    { orderNumber: 2003, customerName: 'Karan Malhotra', customerPhone: '9889012347', amount: 398, paymentStatus: 'Pending', status: 'Preparing', items: [{ itemName: 'Pepperoni Pizza', quantity: 1, price: 399 }] },
    { orderNumber: 2004, customerName: 'Meera Pillai', customerPhone: '9890123458', amount: 288, paymentStatus: 'Paid', status: 'Completed', items: [{ itemName: 'Masala Dosa', quantity: 1, price: 129 }, { itemName: 'Mango Lassi', quantity: 1, price: 119 }, { itemName: 'Cold Coffee', quantity: 1, price: 139 }] },
    { orderNumber: 2005, customerName: 'Rohan Gupta', customerPhone: '9801234569', amount: 249, paymentStatus: 'Paid', status: 'Collected', items: [{ itemName: 'Veg Biryani', quantity: 1, price: 249 }] },
    { orderNumber: 2006, customerName: 'Arjun Nair', customerPhone: '9867890125', amount: 758, paymentStatus: 'Paid', status: 'Completed', items: [{ itemName: 'Mutton Biryani', quantity: 2, price: 379 }] },
  ];
  let tkCount = 0;
  for (const t of takeaways) {
    const tr = await req('POST', '/takeaway-orders', { ...t, branchId: branchIds.head }, token);
    if (ok(`takeaway ${t.orderNumber}`, tr)) tkCount++;
  }
  // Extra takeaway orders (live queue richness)
  const extraTakeaways = [
    { orderNumber: 2007, customerName: 'Divya Reddy', customerPhone: '9878901236', amount: 548, paymentStatus: 'Paid', status: 'Ready', items: [{ itemName: 'Butter Chicken', quantity: 1, price: 349 }, { itemName: 'Tandoori Roti', quantity: 3, price: 39 }, { itemName: 'Gulab Jamun', quantity: 2, price: 89 }] },
    { orderNumber: 2008, customerName: 'Vikram Singh', customerPhone: '9845678903', amount: 249, paymentStatus: 'Paid', status: 'Collected', items: [{ itemName: 'Veg Biryani', quantity: 1, price: 249 }] },
    { orderNumber: 2009, customerName: 'Ananya Iyer', customerPhone: '9834567892', amount: 396, paymentStatus: 'Paid', status: 'Completed', items: [{ itemName: 'Pepperoni Pizza', quantity: 1, price: 399 }] },
    { orderNumber: 2010, customerName: 'Rahul Verma', customerPhone: '9823456781', amount: 358, paymentStatus: 'Pending', status: 'Preparing', items: [{ itemName: 'Paneer Tikka', quantity: 1, price: 249 }, { itemName: 'Garlic Naan', quantity: 2, price: 59 }] },
    { orderNumber: 2011, customerName: 'Sneha Kulkarni', customerPhone: '9856789014', amount: 597, paymentStatus: 'Paid', status: 'Preparing', items: [{ itemName: 'Chicken Biryani', quantity: 1, price: 299 }, { itemName: 'Mango Lassi', quantity: 1, price: 119 }, { itemName: 'Spring Rolls', quantity: 1, price: 179 }] },
    { orderNumber: 2012, customerName: 'Meera Pillai', customerPhone: '9890123458', amount: 228, paymentStatus: 'Paid', status: 'Ready', items: [{ itemName: 'Chicken Hakka Noodles', quantity: 1, price: 229 }] },
  ];
  for (const t of extraTakeaways) {
    const tr = await req('POST', '/takeaway-orders', { ...t, branchId: branchIds.head }, token);
    if (ok(`takeaway ${t.orderNumber}`, tr)) tkCount++;
  }
  created.takeawayOrders = tkCount;

  // ─── Reservations ──────────────────────────────────────────
  log('  · Reservations');
  const reservations = [
    { customerName: 'Divya Reddy', customerPhone: '9878901236', guestCount: 5, date: '2026-08-01', time: '19:30', status: 'Confirmed', tableNumber: 6, occasion: 'Birthday', notes: 'Window seat preferred' },
    { customerName: 'Rahul Verma', customerPhone: '9823456781', guestCount: 2, date: '2026-08-01', time: '20:00', status: 'Confirmed', tableNumber: 1, notes: 'Anniversary dinner' },
    { customerName: 'Meera Pillai', customerPhone: '9890123458', guestCount: 4, date: '2026-08-02', time: '13:00', status: 'Confirmed', tableNumber: 3, notes: 'Business lunch' },
    { customerName: 'Vikram Singh', customerPhone: '9845678903', guestCount: 8, date: '2026-08-02', time: '19:00', status: 'Confirmed', tableNumber: 8, occasion: 'Team dinner' },
    { customerName: 'Ananya Iyer', customerPhone: '9834567892', guestCount: 3, date: '2026-08-03', time: '18:30', status: 'Confirmed', tableNumber: 4, notes: 'Vegetarian' },
    { customerName: 'Sneha Kulkarni', customerPhone: '9856789014', guestCount: 6, date: '2026-08-03', time: '20:30', status: 'Seated', tableNumber: 7 },
  ];
  let resCount = 0;
  for (const rv of reservations) {
    const rr = await req('POST', '/reservations', { ...rv, branchId: branchIds.head }, token);
    if (ok(`reservation ${rv.customerName}`, rr)) resCount++;
  }
  created.reservations = resCount;

  // ─── Waiting list ──────────────────────────────────────────
  log('  · Waiting list');
  const waiting = [
    { customerName: 'Karan Malhotra', customerPhone: '9889012347', guestCount: 2, estimatedWaitMinutes: 15, status: 'Waiting', partyType: 'adult' },
    { customerName: 'Priya Mehta', customerPhone: '9812345670', guestCount: 4, estimatedWaitMinutes: 25, status: 'Waiting', partyType: 'family' },
    { customerName: 'Rohan Gupta', customerPhone: '9801234569', guestCount: 6, estimatedWaitMinutes: 30, status: 'Waiting', partyType: 'business' },
    { customerName: 'Arjun Nair', customerPhone: '9867890125', guestCount: 3, estimatedWaitMinutes: 10, status: 'Waiting', partyType: 'adult' },
  ];
  let waitCount = 0;
  for (const w of waiting) {
    const wr = await req('POST', '/reservations/waiting', { ...w, branchId: branchIds.head }, token);
    if (ok(`waiting ${w.customerName}`, wr)) waitCount++;
  }
  created.waiting = waitCount;

  // ─── Expenses (30 days of P&L history) ─────────────────────
  await seedExpenses(token, created, branchIds);

  // ─── Rewards (loyalty) ─────────────────────────────────────
  log('  · Rewards');
  const rewards = [
    { title: '10% Off Your Bill', pointsRequired: 100, type: 'percentage', value: 10, minBillAmount: 500, isActive: true },
    { title: '₹50 Off', pointsRequired: 150, type: 'flat', value: 50, minBillAmount: 400, isActive: true },
    { title: 'Free Dessert', pointsRequired: 200, type: 'item', value: 0, rewardItemName: 'Chocolate Brownie', isActive: true },
    { title: '20% Off (Large Bills)', pointsRequired: 400, type: 'percentage', value: 20, minBillAmount: 1500, isLargeReward: true, isActive: true },
    { title: 'Free Starter', pointsRequired: 300, type: 'item', value: 0, rewardItemName: 'Paneer Tikka', isActive: true },
  ];
  let rewCount = 0;
  for (const rw of rewards) {
    const rr = await req('POST', '/rewards', rw, token);
    if (ok(`reward ${rw.title}`, rr)) rewCount++;
  }
  created.rewards = rewCount;

  // ─── Offers ────────────────────────────────────────────────
  log('  · Offers');
  const offers = [
    { title: 'Monsoon Special — 15% Off', description: '15% off on all Main Course items this week.', type: 'percentage', value: 15, status: 'active', minOrderValue: 500, startDate: '2026-07-25', endDate: '2026-08-05' },
    { title: 'Flat ₹100 Off', description: 'Flat ₹100 off on orders above ₹999.', type: 'flat', value: 100, status: 'active', minOrderValue: 999 },
    { title: 'Buy 1 Get 1 Pizza', description: 'Buy any large pizza, get a small Margherita free.', type: 'bogo', value: 0, status: 'active', freeItemName: 'Margherita Pizza', freeItemQty: 1 },
    { title: 'Weekend Biryani Combo', description: 'Biryani + drink combo at a special price.', type: 'combo', value: 80, status: 'scheduled', comboProductIds: ['BY002', 'BV003'], comboPrice: 339, scheduledDate: '2026-08-08' },
    { title: 'Welcome10 Coupon', description: '₹10 off for first-time customers.', type: 'coupon', value: 10, status: 'draft' },
    { title: 'Cashback Offer', description: '₹50 cashback on bills above ₹1500.', type: 'cashback', value: 50, status: 'active', cashbackValue: 50, minOrderValue: 1500 },
    { title: 'Diwali Festival Feast', description: 'Special festive discount for the Diwali week.', type: 'festival', value: 25, status: 'scheduled', scheduledDate: '2026-11-09' },
  ];
  let offCount = 0;
  for (const ofr of offers) {
    const or = await req('POST', '/offers', ofr, token);
    if (ok(`offer ${ofr.title}`, or)) offCount++;
  }
  created.offers = offCount;

  // ─── Bills (30 days of sales history) ──────────────────────
  const billResult = await seedBills(token, created, prodById, branchIds, customers);

  // ─── Device registration ───────────────────────────────────
  log('  · Device registration');
  const dev = await req('POST', '/devices/register', {
    deviceId: `dev_demo_${Date.now()}`,
    deviceName: 'Front Counter POS',
    os: 'Windows',
    osVersion: '11',
    appVersion: '1.0.0',
  }, token);
  if (ok('register device', dev)) created.devices = 1;
  else log(`    response: ${JSON.stringify(dev.json)?.slice(0, 300)}`);

  // ─── Voice-inventory aliases ───────────────────────────────
  log('  · Voice-inventory aliases');
  const aliases = [
    { canonicalName: 'Paneer', aliases: ['paneer', 'chenna', 'cottage cheese'], unit: 'kg' },
    { canonicalName: 'Tomato', aliases: ['tomato', 'tamatar'], unit: 'kg' },
    { canonicalName: 'Chicken', aliases: ['chicken', 'murga'], unit: 'kg' },
    { canonicalName: 'Cooking Oil', aliases: ['oil', 'tel', 'refined oil'], unit: 'L' },
    { canonicalName: 'Basmati Rice', aliases: ['rice', 'chawal', 'basmati'], unit: 'kg' },
  ];
  let aliasCount = 0;
  for (const a of aliases) {
    const ar = await req('POST', '/voice-inventory/aliases', a, token);
    if (ok(`alias ${a.canonicalName}`, ar)) aliasCount++;
  }
  created.voiceAliases = aliasCount;

  return { created, prodById, stockMap, branchIds, generatedBills: billResult?.generated || [] };
}

// ─────────────────────────────────────────────────────────────
// 5b) EXPENSES — 30 days of realistic P&L history
// ─────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = {
  ingredients: 'Ingredients & Raw Materials',
  salaries: 'Salaries & Wages',
  utilities: 'Utilities',
  rent: 'Rent & Lease',
  equipment: 'Equipment & Maintenance',
  marketing: 'Marketing & Advertising',
  delivery: 'Delivery & Logistics',
  cleaning: 'Cleaning & Supplies',
  licenses: 'Licenses & Permits',
  misc: 'Miscellaneous',
};

async function seedExpenses(token, created, branchIds) {
  log('  · Expenses (30-day P&L history)');
  const plans = [
    // [daysBack, category, descs, amtMin, amtMax, method]
    { back: 0, cat: EXPENSE_CATEGORIES.rent, descs: ['Monthly rent — Head Office premises'], amt: () => 85000, method: 'Bank Transfer' },
    { back: 0, cat: EXPENSE_CATEGORIES.salaries, descs: ['Monthly staff salaries', 'Kitchen staff payroll'], amt: () => randInt(95000, 120000), method: 'Bank Transfer' },
    { back: 0, cat: EXPENSE_CATEGORIES.utilities, descs: ['Electricity bill (BESCOM)', 'Water & sewage charges', 'LPG gas cylinder refill'], amt: () => randInt(4200, 9800), method: 'UPI' },
    { back: 2, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 3, cat: EXPENSE_CATEGORIES.marketing, descs: ['Instagram & Swiggy ad boost', 'Local newspaper insert'], amt: () => randInt(1800, 6500), method: 'Card' },
    { back: 4, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 5, cat: EXPENSE_CATEGORIES.cleaning, descs: ['Detergents & cleaning supplies'], amt: () => randInt(900, 2600), method: 'Cash' },
    { back: 6, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 7, cat: EXPENSE_CATEGORIES.utilities, descs: ['Electricity bill (BESCOM)', 'Water & sewage charges'], amt: () => randInt(4200, 9800), method: 'UPI' },
    { back: 8, cat: EXPENSE_CATEGORIES.equipment, descs: ['Kitchen equipment servicing', 'POS terminal maintenance'], amt: () => randInt(1500, 5200), method: 'Card' },
    { back: 9, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 11, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 12, cat: EXPENSE_CATEGORIES.delivery, descs: ['Swiggy/Zomato delivery partner payouts'], amt: () => randInt(1200, 3400), method: 'UPI' },
    { back: 13, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 14, cat: EXPENSE_CATEGORIES.utilities, descs: ['Electricity bill (BESCOM)', 'LPG gas cylinder refill'], amt: () => randInt(4200, 9800), method: 'UPI' },
    { back: 15, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 16, cat: EXPENSE_CATEGORIES.marketing, descs: ['Festival banner & hoarding'], amt: () => randInt(2500, 8000), method: 'Card' },
    { back: 17, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 18, cat: EXPENSE_CATEGORIES.equipment, descs: ['Kitchen equipment servicing', 'Fryer & oven maintenance'], amt: () => randInt(1500, 5200), method: 'Card' },
    { back: 19, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 20, cat: EXPENSE_CATEGORIES.cleaning, descs: ['Uniforms & hygiene supplies'], amt: () => randInt(1100, 3000), method: 'Cash' },
    { back: 21, cat: EXPENSE_CATEGORIES.utilities, descs: ['Electricity bill (BESCOM)', 'Water & sewage charges'], amt: () => randInt(4200, 9800), method: 'UPI' },
    { back: 22, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 23, cat: EXPENSE_CATEGORIES.licenses, descs: ['Health & safety inspection fee'], amt: () => randInt(2200, 4800), method: 'Bank Transfer' },
    { back: 24, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 25, cat: EXPENSE_CATEGORIES.misc, descs: ['Miscellaneous operational expenses'], amt: () => randInt(700, 2400), method: 'Cash' },
    { back: 26, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Vegetables & spices — daily market', 'Rice, atta & cooking oil bulk buy'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 27, cat: EXPENSE_CATEGORIES.marketing, descs: ['Loyalty program promo materials'], amt: () => randInt(1500, 4500), method: 'Card' },
    { back: 28, cat: EXPENSE_CATEGORIES.ingredients, descs: ['Dairy, paneer & cream restock', 'Fresh meat & poultry order'], amt: () => randInt(5200, 14500), method: pick(['Cash', 'UPI']) },
    { back: 29, cat: EXPENSE_CATEGORIES.equipment, descs: ['Air conditioning servicing'], amt: () => randInt(1800, 6000), method: 'Card' },
  ];
  let expCount = 0;
  for (const p of plans) {
    const d = dateOffset(p.back);
    const body = {
      amount: p.amt(),
      category: p.cat,
      date: localDateStr(d),
      description: pick(p.descs),
      paymentMethod: p.method,
      isRecurring: p.cat === EXPENSE_CATEGORIES.rent || p.cat === EXPENSE_CATEGORIES.salaries || p.cat === EXPENSE_CATEGORIES.utilities,
      branchId: rng() < 0.7 ? branchIds.head : branchIds.second,
    };
    const er = await req('POST', '/expenses', body, token);
    if (ok(`expense ${body.date}`, er)) expCount++;
  }
  created.expenses = expCount;
}

// ─────────────────────────────────────────────────────────────
// 5c) BILLS — 30 days of sales history (via API, then embed
//     POS-shaped items so the POS Reports render charts).
// ─────────────────────────────────────────────────────────────
const CASHIERS = [
  { name: 'Aarav Sharma', role: 'Owner' },
  { name: 'Neha Kapoor', role: 'Manager' },
  { name: 'Suresh Kumar', role: 'Cashier' },
  { name: 'Lakshmi Rao', role: 'Cashier' },
];
const PAY_METHODS = ['Cash', 'UPI', 'Card', 'Wallet', 'Split'];
const BILL_ORDER_TYPES = ['Dine In', 'Takeaway', 'Delivery', 'Swiggy', 'Zomato'];

async function seedBills(token, created, prodById, branchIds, customers) {
  log('  · Bills (30 days of sales history)');
  const prodCodes = Object.keys(prodById);
  if (prodCodes.length === 0) {
    log('  ✗ no products mapped — skipping bill history');
    created.bills = 0;
    return { generated: [] };
  }
  const generated = []; // { date, time, branchId, items, subtotal, discount, gst, grandTotal }
  let billCount = 0;
  let seq = 1000;

  for (let back = 29; back >= 0; back--) {
    const d = dateOffset(back);
    const dateStr = localDateStr(d);
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6;
    // Weekday 6-9 bills, weekend 10-14 — realistic volume curve
    const nBills = weekend ? randInt(10, 14) : randInt(6, 9);

    for (let i = 0; i < nBills; i++) {
      const branchId = rng() < 0.7 ? branchIds.head : branchIds.second;
      const nItems = randInt(1, 4);
      const items = [];
      let subtotal = 0;
      let gst = 0;
      const usedCodes = new Set();
      for (let j = 0; j < nItems; j++) {
        let code = pick(prodCodes);
        let guard = 0;
        while (usedCodes.has(code) && guard++ < 8) code = pick(prodCodes);
        usedCodes.add(code);
        const p = prodById[code];
        const qty = randInt(1, 3);
        const price = p.price || 100;
        const rate = p.gstPercent || 5;
        const lineTotal = price * qty;
        subtotal += lineTotal;
        gst += (lineTotal * rate) / 100;
        items.push({
          id: `b${seq}i${j}`,
          product: { id: p._id || p.id, name: p.name, code: p.code, category: p.category, price, gstPercent: rate },
          productName: p.name,
          quantity: qty,
          price,
          subtotal: lineTotal,
          notes: rng() < 0.12 ? 'extra spicy' : undefined,
        });
      }
      const discount = rng() < 0.18 ? randInt(20, Math.max(30, Math.round(subtotal * 0.1))) : 0;
      // Round the components first so grandTotal is internally consistent with
      // the rounded subtotal/gst sent in the body (receipt ledger stays exact).
      const subtotalR = Math.round(subtotal * 100) / 100;
      const gstR = Math.round(gst * 100) / 100;
      const grandTotal = Math.round((subtotalR + gstR - discount) * 100) / 100;
      const cashier = pick(CASHIERS);
      const customer = rng() < 0.45 ? pick(customers) : null;
      const invoiceNumber = `SS-INV-${dateStr.replace(/-/g, '')}-${seq}`;
      const body = {
        invoiceNumber,
        ticketNumber: `T-${seq}`,
        date: dateStr,
        time: pick(TIME_SLOTS),
        cashierName: cashier.name,
        cashierRole: cashier.role,
        items,
        subtotal: subtotalR,
        discount,
        gst: gstR,
        grandTotal,
        paymentMethod: pick(PAY_METHODS),
        orderType: pick(BILL_ORDER_TYPES),
        branchId,
        customerPhone: customer?.phone || undefined,
        customerName: customer?.name || undefined,
        pointsEarned: Math.round(grandTotal / 100) * 10,
        pointsRedeemed: 0,
      };
      const br = await req('POST', '/bills', body, token);
      if (ok(`bill ${invoiceNumber}`, br)) {
        billCount++;
        // Capture the created bill's _id so we can embed items into THAT exact
        // bill doc later (never guess by date/branch ordering).
        const billId = br.json?.data?._id || br.json?.data?.id || br.json?._id;
        generated.push({ billId, date: dateStr, time: body.time, branchId, items, subtotal: body.subtotal, discount, gst: body.gst, grandTotal, cashierName: cashier.name, cashierRole: cashier.role, paymentMethod: body.paymentMethod, orderType: body.orderType });
        seq++;
      }
    }
  }
  created.bills = billCount;

  // Embed POS-shaped items into each bill doc so the POS Reports / Analytics
  // workspaces (which iterate bill.items) render Top Dishes, categories, etc.
  // The API stores items in the BillItem collection (not on the bill doc), so
  // we add them directly to the stored bill docs — matched by the _id we
  // captured from each creation response.
  log(`  · Embedding items into ${generated.length} bill docs (POS reports support)`);
  if (!mongoose.connection.readyState) await mongoose.connect('mongodb://localhost:27017/pos');
  const billsCol = mongoose.connection.db.collection('bills');
  let embedded = 0;
  for (const g of generated) {
    if (!g.billId) continue;
    await billsCol.updateOne({ _id: new mongoose.Types.ObjectId(g.billId) }, { $set: { items: g.items } });
    embedded++;
  }
  log(`  ✓ embedded items into ${embedded} bills`);
  return { generated };
}

// ─────────────────────────────────────────────────────────────
// 5d) ANALYTICS BACKFILL — DailySummary per day-branch + 30-day
//     LOGIN audit trail + historical subscription payments.
//     (Admin Analytics reads AuditLog LOGINs and Payments; DailySummary
//     is the per-day revenue snapshot used by reports.)
// ─────────────────────────────────────────────────────────────
async function backfillAnalytics(restaurantId, branchIds, generatedBills, restaurantCode) {
  log('  · Analytics backfill (DailySummary + LOGIN trail + payments)');
  if (!mongoose.connection.readyState) await mongoose.connect('mongodb://localhost:27017/pos');
  const db = mongoose.connection.db;

  // 1) DailySummary — one doc per (date, branchId), with real sub-breakdowns
  //    so the analytics store mirrors what the POS Reports would compute.
  const byDayBranch = new Map();
  for (const g of generatedBills) {
    const k = `${g.date}|${String(g.branchId)}`;
    if (!byDayBranch.has(k)) {
      byDayBranch.set(k, {
        date: g.date, branchId: g.branchId, revenue: 0, orders: 0, items: 0, discount: 0, gst: 0,
        payment: new Map(), category: new Map(), top: new Map(), cashiers: new Map(),
      });
    }
    const agg = byDayBranch.get(k);
    agg.revenue += g.grandTotal;
    agg.orders += 1;
    agg.items += (g.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
    agg.discount += g.discount || 0;
    agg.gst += g.gst || 0;
    // Payment breakdown
    const pm = agg.payment.get(g.paymentMethod) || { method: g.paymentMethod, amount: 0, count: 0 };
    pm.amount += g.grandTotal;
    pm.count += 1;
    agg.payment.set(g.paymentMethod, pm);
    // Category + top-item breakdowns
    for (const it of g.items || []) {
      const cat = it.product?.category || 'General';
      const c = agg.category.get(cat) || { category: cat, qty: 0, revenue: 0 };
      c.qty += it.quantity || 0;
      c.revenue += (it.price || 0) * (it.quantity || 0);
      agg.category.set(cat, c);
      const name = it.product?.name || it.productName || 'Unknown';
      const t = agg.top.get(name) || { name, qty: 0, revenue: 0 };
      t.qty += it.quantity || 0;
      t.revenue += (it.price || 0) * (it.quantity || 0);
      agg.top.set(name, t);
    }
    // Cashier performance
    const cashierKey = g.cashierName || 'Staff';
    const cw = agg.cashiers.get(cashierKey) || { name: cashierKey, orders: 0, revenue: 0 };
    cw.orders += 1;
    cw.revenue += g.grandTotal;
    agg.cashiers.set(cashierKey, cw);
  }
  let dsCount = 0;
  for (const agg of byDayBranch.values()) {
    const doc = {
      date: agg.date,
      branchId: new mongoose.Types.ObjectId(agg.branchId),
      totalRevenue: Math.round(agg.revenue * 100) / 100,
      totalOrders: agg.orders,
      totalItemsSold: agg.items,
      totalDiscount: Math.round(agg.discount * 100) / 100,
      totalGst: Math.round(agg.gst * 100) / 100,
      averageOrderValue: agg.orders > 0 ? Math.round((agg.revenue / agg.orders) * 100) / 100 : 0,
      paymentBreakdown: [...agg.payment.values()].map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 })),
      categoryBreakdown: [...agg.category.values()].map((c) => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 })),
      topItems: [...agg.top.values()].map((t) => ({ ...t, revenue: Math.round(t.revenue * 100) / 100 })).sort((a, b) => b.qty - a.qty).slice(0, 10),
      cashierPerformance: [...agg.cashiers.values()].map((c) => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 })),
      createdAt: new Date(`${agg.date}T19:00:00.000Z`),
      updatedAt: new Date(),
    };
    try {
      await db.collection('dailysummaries').updateOne(
        { date: agg.date, branchId: doc.branchId },
        { $setOnInsert: doc },
        { upsert: true }
      );
      dsCount++;
    } catch (e) {
      log(`  ⚠ dailysummary ${agg.date} skipped: ${e.message}`);
    }
  }
  log(`  ✓ ${dsCount} DailySummary docs (${byDayBranch.size} day-branch combos)`);

  // 2) LOGIN audit trail — ~2-3 logins/day over 30 days so the admin
  //    Analytics dailyLogins chart is populated. Marker details.restaurantId
  //    matches cleanup regex ^SPICE_SYMPHONY_ .
  const marker = `SPICE_SYMPHONY_${(restaurantCode || 'DEMO').replace(/[^A-Z0-9]/gi, '_').toUpperCase().slice(0, 12)}`;
  const loginDocs = [];
  for (let back = 29; back >= 0; back--) {
    const d = dateOffset(back);
    d.setHours(9 + randInt(0, 11), randInt(0, 59), randInt(0, 59), 0);
    const nLogins = randInt(2, 4);
    for (let i = 0; i < nLogins; i++) {
      const emp = pick(CASHIERS);
      const ts = new Date(d.getTime() + i * 3600 * 1000);
      loginDocs.push({
        action: 'LOGIN',
        entityType: 'user',
        entityId: `demo_${restaurantId}`,
        performedBy: emp.name,
        performedById: `demo_${restaurantId}`,
        details: { role: emp.role.toLowerCase(), restaurantId: marker },
        branchId: rng() < 0.7 ? new mongoose.Types.ObjectId(branchIds.head) : new mongoose.Types.ObjectId(branchIds.second),
        ipAddress: '127.0.0.1',
        createdAt: ts,
      });
    }
  }
  if (loginDocs.length) {
    await db.collection('auditlogs').insertMany(loginDocs).catch((e) => log(`  ⚠ auditlogs insert: ${e.message}`));
  }
  log(`  ✓ ${loginDocs.length} LOGIN audit entries (30 days)`);

  // 3) Historical subscription payments — 3 prior monthly payments so the
  //    admin SubscriptionRevenue monthly chart has history. Invoice numbers
  //    embed a code derived from the restaurant's Mongo _id (unique per
  //    restaurant CREATION — the sanitized name code is NOT: every Spice
  //    Symphony restaurant sanitizes to 'SPICES', which collided across
  //    overlapping runs via the unique invoiceNumber index). Cleanup removes
  //    every ^SUB-2026-HIST- marker, so leftovers can never collide with a
  //    fresh insert.
  const code = String(restaurantId).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-8) || 'DEMO';
  const subDoc = await db.collection('subscriptions').findOne({ restaurantId: new mongoose.Types.ObjectId(restaurantId) });
  const payDocs = [];
  for (let m = 3; m >= 1; m--) {
    const ts = new Date();
    ts.setMonth(ts.getMonth() - m, 1);
    ts.setHours(10, 30, 0, 0);
    payDocs.push({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      subscriptionId: subDoc?._id,
      razorpayOrderId: `order_demo_hist_${code}_${m}`,
      razorpayPaymentId: `pay_demo_hist_${code}_${m}`,
      amount: 4999,
      currency: 'INR',
      gateway: 'cash',
      paymentMethod: 'Cash',
      status: 'success',
      invoiceNumber: `SUB-2026-HIST-${code}-${m}`,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  if (payDocs.length) {
    await db.collection('payments').insertMany(payDocs).catch((e) => log(`  ⚠ payments insert: ${e.message}`));
  }
  log(`  ✓ ${payDocs.length} historical payments`);
}

// ─────────────────────────────────────────────────────────────
// 6) APPLY INVENTORY STOCK LEVELS (Product model)
//    The product create/update API schemas are .strict() and don't accept
//    currentStock/unit/minStock/maxStock, so we set them directly in Mongo.
// ─────────────────────────────────────────────────────────────
async function applyInventoryStock(prodById, stockMap) {
  log('\n[6] Applying inventory stock levels to products');
  if (!mongoose.connection.readyState) {
    await mongoose.connect('mongodb://localhost:27017/pos');
  }
  const products = mongoose.connection.db.collection('products');
  let updated = 0;
  for (const [code, s] of Object.entries(stockMap)) {
    const doc = prodById[code];
    const id = doc?._id || doc?.id;
    if (!id) { log(`  ✗ stock ${code} — product not found, skipped`); continue; }
    try {
      const res = await products.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { currentStock: s.currentStock, unit: s.unit, minStock: s.minStock, maxStock: s.maxStock } }
      );
      if (res.matchedCount) { updated++; log(`  ✓ ${code} → ${s.currentStock} ${s.unit} (min ${s.minStock})`); }
    } catch (e) {
      log(`  ✗ stock ${code} → ${e.message}`);
    }
  }
  return updated;
}

// ─────────────────────────────────────────────────────────────
// 7) VERIFY IN MONGODB (direct counts)
// ─────────────────────────────────────────────────────────────
async function verifyMongo(restaurantId, branchIds) {
  log('\n[7] MongoDB verification');
  if (!mongoose.connection.readyState) {
    await mongoose.connect('mongodb://localhost:27017/pos');
  }
  const db = mongoose.connection.db;
  const collections = [
    'restaurants', 'subscriptions', 'payments', 'invoices',
    'branches', 'branchsettings', 'products', 'customers',
    'employees', 'tables', 'orders', 'takeawayorders',
    'reservations', 'expenses', 'rewards', 'offers', 'bills',
    'devices', 'itemaliases', 'dailysummaries', 'auditlogs',
  ];
  const summary = {};
  for (const c of collections) {
    try {
      const count = await db.collection(c).countDocuments({});
      summary[c] = count;
    } catch (e) {
      summary[c] = `ERR: ${e.message}`;
    }
  }

  const oid = new mongoose.Types.ObjectId(restaurantId);
  const branchOids = [branchIds?.head, branchIds?.second].filter(Boolean).map((b) => new mongoose.Types.ObjectId(b));

  // Collections scoped directly by restaurantId. (customers & rewards are
  // global collections with no restaurantId — reported in the totals only.)
  const scoped = {};
  for (const c of ['subscriptions', 'payments', 'branches', 'employees', 'offers', 'devices', 'itemaliases']) {
    try {
      scoped[c] = await db.collection(c).countDocuments({ restaurantId: oid });
    } catch {
      try { scoped[c] = await db.collection(c).countDocuments({ restaurantId: restaurantId }); } catch (e) { scoped[c] = 'ERR'; }
    }
  }
  // Collections scoped by branchId (tables/orders/bills/reservations/expenses)
  for (const c of ['tables', 'orders', 'bills', 'reservations', 'expenses', 'dailysummaries']) {
    try {
      scoped[c] = branchOids.length
        ? await db.collection(c).countDocuments({ branchId: { $in: branchOids } })
        : 'N/A (no branch)'; 
    } catch (e) {
      scoped[c] = 'ERR'; 
    }
  }
  // 30-day LOGIN audit trail (marker prefix SPICE_SYMPHONY_)
  try {
    scoped.auditLogins = await db.collection('auditlogs').countDocuments({
      action: 'LOGIN',
      'details.restaurantId': { $regex: '^SPICE_SYMPHONY_' },
    });
  } catch { scoped.auditLogins = 'ERR'; }
  return { total: summary, scoped };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  try {
    await cleanupDemoData();
    const adminToken = await adminLogin();
    const planId = await createPlan(adminToken);
    const restaurant = await createRestaurant(adminToken, planId);
    log(`  → restaurantId (Mongo): ${restaurant.id}`);
    log(`  → ownerUserId:          ${restaurant.ownerUserId}`);
    log(`  → ownerPin:             ${restaurant.ownerPin}`);
    log(`  → plan:                 ${restaurant.plan} (${restaurant.status})`);

    const posToken = await ownerLogin(restaurant);

    const { created, prodById, stockMap, branchIds, generatedBills } = await seedData(posToken, restaurant.id);

    log('\n=== SEED SUMMARY (API-created) ===');
    Object.entries(created).forEach(([k, v]) => log(`  ${k}: ${v}`));

    const stockUpdated = await applyInventoryStock(prodById, stockMap);
    log(`  inventoryStockUpdates: ${stockUpdated}`);

    // Weekly-analytics backfill: DailySummary, 30-day LOGIN trail, historical payments
    await backfillAnalytics(restaurant.id, branchIds, generatedBills, restaurant.restaurantId);

    const { total, scoped } = await verifyMongo(restaurant.id, branchIds);
    log('\n=== MONGODB COLLECTION COUNTS (all documents) ===');
    Object.entries(total).forEach(([k, v]) => log(`  ${k}: ${v}`));
    log('\n=== RESTAURANT-SCOPED COUNTS ===');
    Object.entries(scoped).forEach(([k, v]) => log(`  ${k}: ${v}`));

    log('\n==============================================');
    log('  LOGIN CREDENTIALS (POS terminal)');
    log('==============================================');
    log(`  Restaurant:     ${restaurant.name}`);
    log(`  Owner username: ${restaurant.ownerUserId}`);
    log(`  Owner PIN:      ${restaurant.ownerPin}`);
    log('  (or Owner employee login: username "owner", PIN "1008")');
    log('  Manager:        manager / 2009');
    log('  Cashier:        cashier1 / 1234');
    log('==============================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error('\n❌ Seeding failed:', err.message);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
