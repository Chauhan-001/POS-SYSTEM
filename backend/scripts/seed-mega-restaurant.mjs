/**
 * =============================================================================
 * seed-mega-restaurant.mjs — "MEGA FEAST HOUSE" bulk data seeder
 * =============================================================================
 *
 * Creates ONE fully-wired restaurant (via the real HTTP API so auth, plan,
 * subscription, payment, invoice and owner credentials are all correct) and
 * then bulk-loads MASSIVE volumes of demo data directly into MongoDB across
 * 20+ collections (products, customers, bills + bill items, expenses,
 * cash ledger, orders + order items + KOTs + timeline, takeaway orders,
 * reservations, waiting list, held orders, rewards, offers, tables, devices,
 * item aliases, daily summaries, audit logs, customer visits/activities,
 * historical subscription payments).
 *
 * Why direct Mongo inserts for the bulk phase: the backend API rate-limits to
 * ~120 req/min, so 10,000+ bills through the API would take hours. Direct
 * inserts are schema-faithful (verified against the Mongoose models) and
 * complete in seconds.
 *
 * Run from backend/ :  node scripts/seed-mega-restaurant.mjs
 * Prereqs: backend running on :3002 with MongoDB connected (db "pos").
 * =============================================================================
 */

import mongoose from 'mongoose';

const BASE = 'http://localhost:3002/api';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1008';
const NAME_PREFIX = 'Mega Feast House';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(msg);
const logGreen = (msg) => console.log('  ✓ ' + msg);

// ─── Deterministic PRNG + date helpers ─────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260807);
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const weighted = (entries) => {
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of entries) { r -= e.w; if (r <= 0) return e.v; }
  return entries[entries.length - 1].v;
};

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
function dateAhead(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d;
}

const TIME_SLOTS = [
  '10:15','10:40','11:05','11:30','11:55','12:20','12:45','13:10','13:35','14:00',
  '14:25','14:50','15:15','15:40','16:05','16:30','16:55','17:20','17:45','18:10',
  '18:35','19:00','19:25','19:50','20:15','20:40','21:05','21:30','21:55','22:20',
];

// ─── HTTP helpers (paced for the API limiter) ───────────────────
let _last = 0;
async function req(method, path, body, token) {
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
const ok = (label, r, extra) => {
  if (r.status >= 200 && r.status < 300) { logGreen(label); return true; }
  log(`  ✗ ${label} → HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 300)}`);
  return false;
};

// ─── API PHASE ─────────────────────────────────────────────────
async function adminLogin() {
  log('\n[1] Admin login');
  const r = await req('POST', '/auth/admin/login', { userId: ADMIN_USER, password: ADMIN_PASS });
  if (!ok('admin login', r)) throw new Error('Admin login failed');
  return r.json.token;
}

const ALL_FEATURES = [
  'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty',
  'reservations', 'multi_branch', 'analytics', 'custom_branding',
  'advanced_reports', 'expense_tracking', 'api_access', 'priority_support',
];

async function ensurePlan(adminToken) {
  log('\n[2] Ensure all-features subscription plan');
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
    const list = await req('GET', '/admin/subscription-plans?active=true', undefined, adminToken);
    const found = (list.json?.data || []).find((p) => p.planId === 'premium_all');
    if (found) { log('  Plan exists — reusing.'); return found.planId; }
    throw new Error('Plan exists but not found');
  }
  if (!ok('create plan', r)) throw new Error('Plan creation failed');
  return r.json.planId;
}

async function createRestaurant(adminToken, planId) {
  log('\n[3] Create restaurant');
  const suffix = Date.now().toString(36).slice(-4);
  const body = {
    name: `${NAME_PREFIX} ${suffix}`,
    restaurantType: 'Fine Dining',
    cuisineType: 'North Indian, Italian, Continental, Chinese',
    phone: '9112233445',
    altPhone: '9223344556',
    email: `megafeast${suffix}@demo.com`,
    website: 'https://megafeast.example',
    description: 'Large multi-branch restaurant seeded with massive demo data.',
    address: '1 Ring Road, Indiranagar',
    area: 'Indiranagar',
    city: 'Bengaluru',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    country: 'India',
    pinCode: '560038',
    gst: '29ABCDE9999F1Z9',
    fssai: '99887766554433',
    pan: 'XYZDE9999F',
    ownerName: 'Kabir Malhotra',
    ownerEmail: `kabir${suffix}@demo.com`,
    plan: planId,
    onboardingMode: 'cash',
  };
  const r = await req('POST', '/admin/restaurants', body, adminToken);
  if (!ok('create restaurant', r)) throw new Error('Restaurant creation failed');
  return r.json;
}

async function ownerLogin(restaurant) {
  log('\n[4] POS login as Owner');
  const r = await req('POST', '/auth/login', { username: restaurant.ownerUserId, password: restaurant.ownerPin });
  if (!ok('owner login', r)) throw new Error('Owner POS login failed');
  return r.json.accessToken;
}

// ─── CLEANUP (scoped — never touches other restaurants) ────────
async function cleanupPrevious() {
  log('\n[0] Cleanup — removing previous Mega Feast data');
  if (!mongoose.connection.readyState) await mongoose.connect('mongodb://localhost:27017/pos');
  const db = mongoose.connection.db;
  let removed = 0;

  const oldRests = await db.collection('restaurants').find({ name: { $regex: `^${NAME_PREFIX}` } }).toArray();
  const ids = oldRests.map((r) => r._id);

  if (ids.length > 0) {
    const branches = await db.collection('branches').find({ restaurantId: { $in: ids } }, { projection: { _id: 1 } }).toArray();
    const branchIds = branches.map((b) => b._id);
    const scope = { $or: [{ restaurantId: { $in: ids } }, { branchId: { $in: branchIds } }, { userId: { $in: ids } }] };
    const scopedCollections = [
      'subscriptions', 'payments', 'invoices', 'branches', 'branchsettings',
      'users', 'employees', 'products', 'tables', 'orders', 'takeawayorders',
      'reservations', 'waitingentries', 'heldorders', 'expenses', 'bills',
      'billitems', 'offers', 'rewards', 'devices', 'itemaliases',
      'dailysummaries', 'cashledgers', 'customeractivities', 'customervisits',
      'loyaltytransactions', 'orderitems', 'kotrecords', 'timelineevents',
    ];
    for (const c of scopedCollections) {
      try {
        const r = await db.collection(c).deleteMany(scope);
        removed += r.deletedCount || 0;
      } catch (e) { log(`  ⚠ ${c} cleanup skipped: ${e.message}`); }
    }
    await db.collection('refreshTokens').deleteMany({ userId: { $in: ids } }).catch(() => {});
    await db.collection('auditlogs').deleteMany({
      $or: [
        { action: 'BILL_CREATED', 'details.invoiceNumber': { $regex: '^MF-INV-' } },
        { action: 'LOGIN', 'details.restaurantId': { $regex: '^MEGA_FEAST_' } },
      ],
    }).catch(() => {});
    await db.collection('customers').deleteMany({ restaurantId: { $in: ids } });
    const restDel = await db.collection('restaurants').deleteMany({ _id: { $in: ids } });
    removed += restDel.deletedCount || 0;
    log(`  Removed ${removed} documents across ${oldRests.length} old Mega restaurant(s).`);
  } else {
    log('  No previous Mega Feast data found.');
  }
}

// ─── MENU / NAME DATA ──────────────────────────────────────────
const PRODUCT_DEFS = [
  // [code, name, category, price, gst, favorite]
  ['MF001','Margherita Pizza','Pizza',299,5,1],
  ['MF002','Pepperoni Pizza','Pizza',429,5,0],
  ['MF003','Farmhouse Pizza','Pizza',379,5,0],
  ['MF004','BBQ Chicken Pizza','Pizza',449,5,1],
  ['MF005','Cheese Burst Pizza','Pizza',399,5,0],
  ['MF006','Paneer Tikka','Starters',269,12,1],
  ['MF007','Chicken Tikka','Starters',319,12,0],
  ['MF008','Tandoori Wings','Starters',299,12,0],
  ['MF009','Hara Bhara Kebab','Starters',229,12,0],
  ['MF010','Fish Amritsari','Starters',349,12,0],
  ['MF011','Spring Rolls','Starters',189,12,0],
  ['MF012','Chilli Paneer Dry','Starters',249,12,0],
  ['MF013','Butter Chicken','Main Course',389,12,1],
  ['MF014','Paneer Butter Masala','Main Course',329,12,0],
  ['MF015','Dal Makhani','Main Course',259,12,1],
  ['MF016','Kadai Chicken','Main Course',359,12,0],
  ['MF017','Palak Paneer','Main Course',299,12,0],
  ['MF018','Rogan Josh','Main Course',399,12,0],
  ['MF019','Grilled Fish in Lemon Butter','Main Course',429,12,0],
  ['MF020','Chicken Stroganoff','Main Course',379,12,0],
  ['MF021','Veg Biryani','Biryani',269,5,0],
  ['MF022','Chicken Biryani','Biryani',329,5,1],
  ['MF023','Mutton Biryani','Biryani',429,5,0],
  ['MF024','Hyderabadi Dum Biryani','Biryani',359,5,0],
  ['MF025','Prawn Biryani','Biryani',449,5,0],
  ['MF026','Garlic Naan','Breads',69,5,0],
  ['MF027','Butter Naan','Breads',59,5,0],
  ['MF028','Tandoori Roti','Breads',39,5,0],
  ['MF029','Cheese Garlic Naan','Breads',99,5,0],
  ['MF030','Masala Dosa','South Indian',139,5,1],
  ['MF031','Mysore Masala Dosa','South Indian',159,5,0],
  ['MF032','Idli Sambar','South Indian',109,5,0],
  ['MF033','Rava Dosa','South Indian',149,5,0],
  ['MF034','Medu Vada','South Indian',99,5,0],
  ['MF035','Chicken Fried Rice','Chinese',249,12,0],
  ['MF036','Veg Hakka Noodles','Chinese',219,12,0],
  ['MF037','Chilli Chicken','Chinese',289,12,1],
  ['MF038','Gobi Manchurian','Chinese',219,12,0],
  ['MF039','Chocolate Brownie','Desserts',179,18,1],
  ['MF040','Gulab Jamun','Desserts',99,18,0],
];

const FIRST_M = ['Aarav','Vivaan','Aditya','Vihaan','Arjun','Reyansh','Sai','Arnav','Ayaan','Krishna','Ishaan','Rohan','Kabir','Dev','Rahul','Vikram','Amit','Siddharth','Nikhil','Pranav','Adarsh','Kunal','Gaurav','Manish'];
const FIRST_F = ['Diya','Ananya','Aadhya','Kiara','Riya','Prisha','Ishita','Navya','Saanvi','Anika','Priya','Sneha','Meera','Anjali','Kavya','Nisha','Pooja','Divya','Tanvi','Shreya','Vaishnavi','Sakshi','Ritika','Simran'];
const LAST = ['Sharma','Verma','Gupta','Iyer','Nair','Reddy','Singh','Patel','Mehta','Kulkarni','Pillai','Rao','Kumar','Joshi','Menon','Chawla','Bhat','Desai','Kapoor','Malhotra','Banerjee','Chatterjee','Shetty','Hegde','Naidu','Acharya','Gowda','Pillai','Das','Bose'];
const CITIES = ['Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Pune','Kolkata','Jaipur','Ahmedabad','Kochi','Goa','Chandigarh','Indore','Lucknow','Nagpur','Surat','Vizag','Coimbatore'];
const TAGS = ['VIP','Regular','Vegetarian','Non-Veg','Corporate','Birthday Club','Weekend Diner','Foodie','New','Discount Hunter','Family','Fitness','Sweet Tooth','Spice Lover'];
const PREF_METHODS = ['Cash','UPI','Card','Wallet','Split'];

// ─── MAIN ──────────────────────────────────────────────────────
async function main() {
  try {
    await cleanupPrevious();

    const adminToken = await adminLogin();
    const planId = await ensurePlan(adminToken);
    const restaurant = await createRestaurant(adminToken, planId);
    const restId = restaurant.id;
    log(`  → restaurantId (Mongo): ${restId}`);
    log(`  → ownerUserId:          ${restaurant.ownerUserId}`);
    log(`  → ownerPin:             ${restaurant.ownerPin}`);
    log(`  → plan:                 ${restaurant.plan} (${restaurant.status})`);

    const posToken = await ownerLogin(restaurant);

    // ─── Branches via API (head branch is auto-created) ───────
    log('\n[5] Branches (API)');
    const branchResp = await req('GET', '/branches', undefined, posToken);
    let branches = (branchResp.json?.data || []);
    const branchIds = { head: null, second: null };
    if (branches.length > 0) branchIds.head = branches[0]._id || branches[0].id;
    if (!branchIds.head) {
      const r = await req('POST', '/branches', { name: `${NAME_PREFIX} — HQ`, address: '1 Ring Road, Bengaluru', phone: '9112233445', isHeadBranch: true, isActive: true }, posToken);
      if (ok('head branch', r)) branchIds.head = r.json?.data?._id || r.json?.data?.id || r.json?._id;
    }
    const r2 = await req('POST', '/branches', { name: `${NAME_PREFIX} — Koramangala`, address: '88 100 Feet Road, Koramangala', phone: '9223344556', isHeadBranch: false, isActive: true }, posToken);
    if (ok('second branch', r2)) branchIds.second = r2.json?.data?._id || r2.json?.data?.id || r2.json?._id;
    if (!branchIds.head || !branchIds.second) throw new Error('Could not resolve both branch ids');
    const headOid = new mongoose.Types.ObjectId(branchIds.head);
    const secondOid = new mongoose.Types.ObjectId(branchIds.second);

    // Branch settings (currency, receipt) for head branch
    await req('PUT', `/branches/${branchIds.head}/settings`, {
      restaurantName: 'Mega Feast House',
      currency: 'INR',
      currencySymbol: '₹',
      defaultTaxRate: 12,
      printSize: '80mm',
      invoicePrefix: 'MF',
      invoiceStartingNumber: 1001,
      receiptFooterMessage: 'Thank you for dining at Mega Feast House!',
    }, posToken);
    logGreen('branch settings (head)');

    // ─── Employees (direct Mongo — pins bcrypt-hashed, no rate-limit risk) ─
    log('\n[6] Employees (direct, hashed pins)');
    if (!mongoose.connection.readyState) await mongoose.connect('mongodb://localhost:27017/pos');
    const db0 = mongoose.connection.db;
    const bcrypt = (await import('bcrypt')).default;
    const now0 = new Date();
    const employeeDefs = [
      { username: 'mfe_owner', name: 'Kabir Malhotra', role: 'Owner', pin: '1008', branchId: branchIds.head },
      { username: 'mfe_manager', name: 'Simran Kaur', role: 'Manager', pin: '2009', branchId: branchIds.head },
      { username: 'mfe_cashier1', name: 'Ravi Shetty', role: 'Cashier', pin: '1234', branchId: branchIds.head },
      { username: 'mfe_cashier2', name: 'Anita Desai', role: 'Cashier', pin: '2345', branchId: branchIds.second },
    ];
    const createdEmployees = [];
    for (const e of employeeDefs) {
      const existing = await db0.collection('employees').findOne({ username: e.username });
      if (existing) {
        await db0.collection('employees').updateOne({ _id: existing._id }, { $set: { name: e.name, role: e.role, restaurantId: new mongoose.Types.ObjectId(restId), branchId: new mongoose.Types.ObjectId(e.branchId), isDeleted: false, updatedAt: now0 } });
        createdEmployees.push({ ...e, id: String(existing._id) });
      } else {
        const hash = await bcrypt.hash(e.pin, 10);
        const ins = await db0.collection('employees').insertOne({
          username: e.username, name: e.name, role: e.role, pin: hash,
          status: 'Active', restaurantId: new mongoose.Types.ObjectId(restId),
          branchId: new mongoose.Types.ObjectId(e.branchId),
          isDeleted: false, deletedAt: null, lastLogin: null, createdAt: now0, updatedAt: now0,
        });
        createdEmployees.push({ ...e, id: String(ins.insertedId) });
      }
    }
    logGreen(`${createdEmployees.length} employees (mfe_owner/1008, mfe_manager/2009, mfe_cashier1/1234, mfe_cashier2/2345)`);

    // ─── Devices (direct Mongo) ──────────────────────────────────
    log('\n[7] Devices (direct)');
    const deviceDefs = [
      { deviceId: `dev_mfe_counter_${Date.now()}`, deviceName: 'Front Counter POS', os: 'Windows', osVersion: '11', appVersion: '1.0.0' },
      { deviceId: `dev_mfe_kitchen_${Date.now()}`, deviceName: 'Kitchen Display', os: 'Windows', osVersion: '11', appVersion: '1.0.0' },
      { deviceId: `dev_mfe_floor_${Date.now()}`, deviceName: 'Floor Tablet', os: 'Android', osVersion: '13', appVersion: '1.0.0' },
    ];
    for (const d of deviceDefs) {
      const existing = await db0.collection('devices').findOne({ deviceName: d.deviceName });
      if (existing) {
        await db0.collection('devices').updateOne({ _id: existing._id }, { $set: { restaurantId: new mongoose.Types.ObjectId(restId), status: 'active', isActive: true, updatedAt: now0 } });
      } else {
        await db0.collection('devices').insertOne({
          ...d, restaurantId: new mongoose.Types.ObjectId(restId),
          status: 'active', isActive: true, createdAt: now0, updatedAt: now0,
        });
      }
    }
    logGreen(`${deviceDefs.length} devices registered`);

    // Set a memorable owner PIN (1008) so both logins are easy
    await db0.collection('restaurants').updateOne(
      { _id: new mongoose.Types.ObjectId(restId) },
      { $set: { ownerPin: await bcrypt.hash('1008', 10) } }
    );
    logGreen('owner PIN set to 1008 (hashed)');

    // ═══════════════════════════════════════════════════════════
    // BULK MONGO PHASE
    // ═══════════════════════════════════════════════════════════
    if (!mongoose.connection.readyState) await mongoose.connect('mongodb://localhost:27017/pos');
    const db = mongoose.connection.db;
    const O = () => new mongoose.Types.ObjectId();
    const counts = {};

    async function insertChunked(col, docs, batch = 1000) {
      if (!docs.length) return 0;
      let inserted = 0;
      for (let i = 0; i < docs.length; i += batch) {
        const chunk = docs.slice(i, i + batch);
        const r = await db.collection(col).insertMany(chunk, { ordered: false });
        inserted += (r.insertedCount ?? Object.keys(r.insertedIds).length);
      }
      counts[col] = (counts[col] || 0) + inserted;
      return inserted;
    }

    // ─── Products ─────────────────────────────────────────────
    log('\n[8] Bulk: products');
    const now = new Date();
    const productDocs = PRODUCT_DEFS.map(([code, name, category, price, gst, fav]) => ({
      name, code, price, category, gstPercent: gst, availability: true, favorite: !!fav,
      restaurantId: new mongoose.Types.ObjectId(restId),
      branchPrice: {}, currentStock: randInt(20, 400), unit: 'pcs',
      minStock: randInt(5, 20), maxStock: randInt(200, 800), reorderLevel: randInt(8, 30),
      averageCost: Math.round(price * 0.45 * 100) / 100,
      supplier: pick(['FreshMart Supplies','Metro Wholesale','Karnataka Agro','Spice Junction','Daily Fresh Foods']),
      storageLocation: pick(['Fridge A','Fridge B','Shelf 1','Shelf 2','Freezer','Dry Store']),
      notes: '', barcode: `890${randInt(100000000, 999999999)}`, expiryDate: '', batchNumber: '',
      voiceAliases: [], searchAliases: [name.toLowerCase()], learnedAliases: [],
      lastUsedAlias: null, aliasUsageCount: 0, isDeleted: false, deletedAt: null,
      createdAt: now, updatedAt: now,
    }));
    await insertChunked('products', productDocs);
    const productIds = (await db.collection('products').find({ restaurantId: new mongoose.Types.ObjectId(restId) }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
    logGreen(`${productDocs.length} products`);

    // ─── Customers ────────────────────────────────────────────
    log('[9] Bulk: customers');
    const customerDocs = [];
    const usedPhones = new Set();
    const customerNames = [];
    for (let i = 0; i < 600; i++) {
      let phone;
      do { phone = `99${String(randInt(10000000, 99999999))}`; } while (usedPhones.has(phone));
      usedPhones.add(phone);
      const female = rng() < 0.5;
      const name = `${female ? pick(FIRST_F) : pick(FIRST_M)} ${pick(LAST)}`;
      customerNames.push({ name, phone });
      const visits = randInt(1, 60);
      const totalSpend = visits * randInt(300, 1500);
      const points = Math.round(totalSpend / 20);
      const tier = points >= 8000 ? 'Diamond' : points >= 5000 ? 'Platinum' : points >= 2500 ? 'Gold' : points >= 900 ? 'Silver' : 'Bronze';
      const lastVisit = dateOffset(randInt(0, 90));
      const firstVisit = dateOffset(randInt(30, 720));
      const y = randInt(1965, 2005);
      const m = String(randInt(1, 12)).padStart(2, '0');
      const d = String(randInt(1, 28)).padStart(2, '0');
      const city = pick(CITIES);
      const nTags = randInt(1, 3);
      const tagSet = new Set();
      while (tagSet.size < nTags) tagSet.add(pick(TAGS));
      customerDocs.push({
        restaurantId: new mongoose.Types.ObjectId(restId),
        branchId: rng() < 0.7 ? headOid : secondOid,
        createdBy: 'mfe_owner', updatedBy: 'mfe_owner',
        phone, name,
        email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}${phone.slice(-3)}@example.com`,
        birthday: `${y}-${m}-${d}`,
        anniversary: rng() < 0.3 ? `${randInt(1995, 2015)}-${m}-${d}` : undefined,
        gender: female ? 'Female' : 'Male',
        address: `${randInt(1, 999)}, ${pick(['MG Road','Park Street','Lake View','Rose Garden','Central Ave','Market Road'])}`,
        city, state: 'Karnataka', country: 'India',
        gstNumber: rng() < 0.15 ? `29ABCDE${randInt(1000, 9999)}F1Z${randInt(1, 9)}` : undefined,
        notes: rng() < 0.2 ? pick(['Prefers window table','Allergic to peanuts','Loves extra spicy','Birthday regular','Corporate client','Likes quiet corner']) : undefined,
        tags: [...tagSet],
        preferredPaymentMethod: pick(PREF_METHODS),
        favoriteItems: productDocs.filter(() => rng() < 0.08).slice(0, randInt(1, 4)).map((p) => p.name),
        favoriteCategories: [...new Set(productDocs.filter(() => rng() < 0.15).map((p) => p.category))].slice(0, 3),
        marketingOptIn: rng() < 0.6,
        taxExemption: rng() < 0.05,
        isVip: rng() < 0.12,
        status: rng() < 0.9 ? 'active' : (rng() < 0.5 ? 'dormant' : 'blocked'),
        referralCode: `MF${phone.slice(-6)}`,
        referralCount: randInt(0, 12),
        points, lifetimePoints: points + randInt(0, 3000),
        walletBalance: rng() < 0.3 ? randInt(50, 800) : 0,
        tier,
        totalSpend, averageSpend: visits ? Math.round(totalSpend / visits) : 0,
        totalOrders: visits, visits,
        lastVisit, visitFrequency: randInt(3, 30),
        firstVisit,
        isNewCustomer: false, isBlocked: false, isDeleted: false, deletedAt: null,
        createdAt: firstVisit, updatedAt: lastVisit,
      });
    }
    await insertChunked('customers', customerDocs);
    const customers = await db.collection('customers').find({ restaurantId: new mongoose.Types.ObjectId(restId) }).toArray();
    logGreen(`${customerDocs.length} customers`);

    // ─── Rewards ──────────────────────────────────────────────
    log('[10] Bulk: rewards');
    const rewardDocs = [
      { title: '5% Off Your Bill', pointsRequired: 60, type: 'percentage', value: 5, minBillAmount: 300, isLargeReward: false, redeemedCount: randInt(50, 200), isActive: true },
      { title: '₹100 Off', pointsRequired: 150, type: 'flat', value: 100, minBillAmount: 600, isLargeReward: false, redeemedCount: randInt(30, 150), isActive: true },
      { title: 'Free Dessert', pointsRequired: 200, type: 'item', value: 0, rewardItemName: 'Chocolate Brownie', minBillAmount: 400, isLargeReward: false, redeemedCount: randInt(20, 120), isActive: true },
      { title: '20% Off (Large Bills)', pointsRequired: 400, type: 'percentage', value: 20, minBillAmount: 1500, isLargeReward: true, redeemedCount: randInt(5, 40), isActive: true },
      { title: 'Free Starter', pointsRequired: 300, type: 'item', value: 0, rewardItemName: 'Paneer Tikka', minBillAmount: 800, isLargeReward: false, redeemedCount: randInt(15, 90), isActive: true },
      { title: 'Free Chicken Biryani', pointsRequired: 350, type: 'item', value: 0, rewardItemName: 'Chicken Biryani', minBillAmount: 900, isLargeReward: false, redeemedCount: randInt(10, 70), isActive: true },
      { title: 'Buy 1 Get 1 Pizza', pointsRequired: 500, type: 'item', value: 0, rewardItemName: 'Margherita Pizza', minBillAmount: 1200, isLargeReward: true, redeemedCount: randInt(3, 25), isActive: true },
      { title: 'Weekend Family Feast 30%', pointsRequired: 800, type: 'percentage', value: 30, minBillAmount: 2500, isLargeReward: true, redeemedCount: randInt(2, 15), isActive: true },
    ].map((r) => ({
      ...r,
      restaurantId: new mongoose.Types.ObjectId(restId),
      isDeleted: false, deletedAt: null,
      createdAt: now, updatedAt: now,
    }));
    await insertChunked('rewards', rewardDocs);
    logGreen(`${rewardDocs.length} rewards`);

    // ─── Offers ───────────────────────────────────────────────
    log('[11] Bulk: offers');
    const offerDocs = [
      { title: 'Monsoon Special — 15% Off', description: '15% off on all Main Course items this week.', type: 'percentage', value: 15, status: 'active', minOrderValue: 500, startDate: '2026-07-25', endDate: '2026-08-15' },
      { title: 'Flat ₹150 Off', description: 'Flat ₹150 off on orders above ₹1499.', type: 'flat', value: 150, status: 'active', minOrderValue: 1499 },
      { title: 'Buy 1 Get 1 Pizza', description: 'Buy any large pizza, get a small Margherita free.', type: 'bogo', value: 0, status: 'active', freeItemName: 'Margherita Pizza', freeItemQty: 1 },
      { title: 'Weekend Biryani Combo', description: 'Biryani + drink combo at a special price.', type: 'combo', value: 100, status: 'scheduled', comboProductIds: ['MF022', 'BV003'], comboPrice: 399, scheduledDate: '2026-08-08' },
      { title: 'First Order 20% Off', description: '20% off for first-time customers.', type: 'percentage', value: 20, status: 'active', minOrderValue: 400 },
      { title: 'Cashback ₹100', description: '₹100 cashback on bills above ₹2000.', type: 'cashback', value: 100, status: 'active', cashbackValue: 100, minOrderValue: 2000 },
      { title: 'Diwali Festival Feast', description: 'Special festive discount for the Diwali week.', type: 'festival', value: 25, status: 'scheduled', scheduledDate: '2026-11-09' },
      { title: 'Happy Hours 10% Off', description: '10% off between 3-6 PM on weekdays.', type: 'percentage', value: 10, status: 'active', minOrderValue: 300 },
    ].map((o) => ({
      ...o,
      restaurantId: new mongoose.Types.ObjectId(restId),
      isActive: o.status === 'active', isDeleted: false, deletedAt: null,
      createdAt: now, updatedAt: now,
    }));
    await insertChunked('offers', offerDocs);
    logGreen(`${offerDocs.length} offers`);

    // ─── Tables ───────────────────────────────────────────────
    log('[12] Bulk: tables');
    const tableDocs = [];
    const sections = ['Window', 'Main Hall', 'VIP', 'Outdoor', 'Family'];
    const shapes = ['circle', 'square', 'rectangle'];
    let tno = 1;
    for (const b of [headOid, secondOid]) {
      for (let i = 1; i <= 16; i++) {
        tableDocs.push({
          number: i, capacity: [2, 4, 6, 8, 10][i % 5], section: pick(sections),
          branchId: b, shape: pick(shapes), x: randInt(40, 520), y: randInt(40, 640),
          isDeleted: false, deletedAt: null, createdAt: now, updatedAt: now,
        });
        tno++;
      }
    }
    await insertChunked('tables', tableDocs);
    logGreen(`${tableDocs.length} tables`);

    // ─── Item aliases (voice inventory) ───────────────────────
    log('[13] Bulk: item aliases');
    const aliasDocs = [
      { canonicalName: 'Paneer', aliases: ['paneer', 'chenna', 'cottage cheese'], unit: 'kg' },
      { canonicalName: 'Tomato', aliases: ['tomato', 'tamatar'], unit: 'kg' },
      { canonicalName: 'Chicken', aliases: ['chicken', 'murga'], unit: 'kg' },
      { canonicalName: 'Cooking Oil', aliases: ['oil', 'tel', 'refined oil'], unit: 'L' },
      { canonicalName: 'Basmati Rice', aliases: ['rice', 'chawal', 'basmati'], unit: 'kg' },
      { canonicalName: 'Mozzarella Cheese', aliases: ['cheese', 'mozzarella'], unit: 'kg' },
      { canonicalName: 'Mint', aliases: ['pudina', 'mint leaves'], unit: 'bunch' },
      { canonicalName: 'Curd', aliases: ['dahi', 'yogurt'], unit: 'kg' },
      { canonicalName: 'Green Chilli', aliases: ['chilli', 'mirchi'], unit: 'kg' },
      { canonicalName: 'Ginger Garlic Paste', aliases: ['gg paste', 'adrak lehsun'], unit: 'kg' },
    ].map((a) => ({ ...a, restaurantId: new mongoose.Types.ObjectId(restId), createdAt: now, updatedAt: now }));
    await insertChunked('itemaliases', aliasDocs);
    logGreen(`${aliasDocs.length} aliases`);

    // ─── Bills + BillItems + cash ledger + daily summaries ────
    log('[14] Bulk: bills (365 days × 2 branches)');
    const CASHIERS = createdEmployees.map((e) => ({ name: e.name, role: e.role, id: e.id }));
    if (CASHIERS.length < 4) {
      CASHIERS.push({ name: 'Kabir Malhotra', role: 'Owner' }, { name: 'Walk-in Guest', role: 'Cashier' });
    }
    const billDocs = [];
    const billInvoiceItems = new Map(); // invoiceNumber → items (for BillItem linking)
    const cashLedgerDocs = [];
    const visitDocs = [];
    const activityDocs = [];
    const auditDocs = [];
    const dsAgg = new Map(); // key date|branchId → aggregation
    const loyaltyTxDocs = [];   // append-only points ledger (earn / redeem / adjustment)
    const loyaltyPool = new Map(); // customerId → { balance, pool: [{ id, remaining }] } (FIFO)

    let seq = 1001;
    let balancePerBranch = { [branchIds.head]: 20000, [branchIds.second]: 15000 };

    const computeBill = (backDays, branchOid) => {
      const d = dateOffset(backDays);
      const dateStr = localDateStr(d);
      const dow = d.getDay();
      const weekend = dow === 0 || dow === 6;
      const nItems = randInt(1, 4);
      const items = [];
      const used = new Set();
      let subtotal = 0, gst = 0;
      for (let j = 0; j < nItems; j++) {
        let idx = randInt(0, productIds.length - 1);
        let guard = 0;
        while (used.has(idx) && guard++ < 8) idx = randInt(0, productIds.length - 1);
        used.add(idx);
        const prod = productDocs[idx];
        const qty = randInt(1, 3);
        const lineTotal = prod.price * qty;
        subtotal += lineTotal;
        gst += (lineTotal * prod.gstPercent) / 100;
        items.push({
          product: { id: String(productIds[idx]), name: prod.name, code: prod.code, category: prod.category, price: prod.price, gstPercent: prod.gstPercent },
          productName: prod.name,
          quantity: qty,
          price: prod.price,
          subtotal: lineTotal,
          notes: rng() < 0.12 ? pick(['extra spicy', 'no onions', 'less oil', 'well done', 'extra cheese']) : undefined,
        });
      }
      const discount = rng() < 0.18 ? randInt(20, Math.max(30, Math.round(subtotal * 0.1))) : 0;
      const subtotalR = Math.round(subtotal * 100) / 100;
      const gstR = Math.round(gst * 100) / 100;
      const grandTotal = Math.round((subtotalR + gstR - discount) * 100) / 100;
      const paymentMethod = weighted([
        { v: 'Cash', w: 45 }, { v: 'UPI', w: 25 }, { v: 'Card', w: 15 }, { v: 'Wallet', w: 10 }, { v: 'Split', w: 5 },
      ]);
      const orderType = weighted([
        { v: 'Dine In', w: 45 }, { v: 'Takeaway', w: 25 }, { v: 'Delivery', w: 12 }, { v: 'Swiggy', w: 10 }, { v: 'Zomato', w: 8 },
      ]);
      const cashier = pick(CASHIERS);
      const withCust = rng() < 0.5;
      const cust = withCust ? pick(customers) : null;
      const invoiceNumber = `MF-INV-${dateStr.replace(/-/g, '')}-${seq}`;
      const ticketNumber = `T-${seq}`;
      const splitDetails = paymentMethod === 'Split'
        ? {
            cashAmount: Math.round(grandTotal * randInt(2, 6) / 10 * 100) / 100,
            cardAmount: Math.round(grandTotal * randInt(1, 4) / 10 * 100) / 100,
            upiAmount: Math.round(grandTotal * randInt(1, 3) / 10 * 100) / 100,
            walletAmount: 0,
          }
        : undefined;
      const time = pick(TIME_SLOTS);
      const createdAt = new Date(`${dateStr}T${time}:00`);
      const pointsEarned = cust ? Math.round(grandTotal / 20) : 0;
      const pointsRedeemed = (cust && rng() < 0.08) ? randInt(50, Math.max(60, cust.points || 0)) : 0;
      const isVoided = rng() < 0.02;
      const isRefunded = !isVoided && rng() < 0.015;

      return {
        d, dateStr, time, items, subtotalR, gstR, discount, grandTotal,
        paymentMethod, orderType, cashier, cust, invoiceNumber, ticketNumber,
        splitDetails, createdAt, pointsEarned, pointsRedeemed, isVoided, isRefunded,
        branchOid, weekend,
      };
    };

    const makeBillDoc = (b, branchOid) => {
      seq++;
      return {
        invoiceNumber: b.invoiceNumber,
        ticketNumber: b.ticketNumber,
        date: b.dateStr,
        time: b.time,
        cashierName: b.cashier.name,
        cashierRole: b.cashier.role,
        subtotal: b.subtotalR,
        discount: b.discount,
        gst: b.gstR,
        grandTotal: b.grandTotal,
        paymentMethod: b.paymentMethod,
        splitDetails: b.splitDetails,
        orderType: b.orderType,
        restaurantId: new mongoose.Types.ObjectId(restId),
        branchId: branchOid,
        customerId: b.cust ? new mongoose.Types.ObjectId(b.cust._id) : null,
        customerPhone: b.cust ? b.cust.phone : undefined,
        customerName: b.cust ? b.cust.name : undefined,
        pointsEarned: b.pointsEarned,
        pointsRedeemed: b.pointsRedeemed,
        redeemedRewardTitle: b.pointsRedeemed > 0 ? pick(rewardDocs).title : undefined,
        isVoided: b.isVoided,
        voidReason: b.isVoided ? pick(['Customer changed mind', 'Wrong item', 'Duplicate bill', 'Order cancelled']) : undefined,
        voidedAt: b.isVoided ? b.createdAt : null,
        voidedBy: b.isVoided ? b.cashier.name : undefined,
        isRefunded: b.isRefunded,
        refundedAt: b.isRefunded ? b.createdAt : null,
        refundedBy: b.isRefunded ? b.cashier.name : undefined,
        refundReason: b.isRefunded ? 'Partial refund requested' : undefined,
        refundAmount: b.isRefunded ? Math.round(b.grandTotal * 0.3 * 100) / 100 : 0,
        createdAt: b.createdAt,
        updatedAt: b.createdAt,
      };
    };

    for (let back = 364; back >= 0; back--) {
      for (const [bkey, branchOid] of [['head', headOid], ['second', secondOid]]) {
        const d = dateOffset(back);
        const dow = d.getDay();
        const weekend = dow === 0 || dow === 6;
        const nBills = bkey === 'head' ? (weekend ? randInt(14, 22) : randInt(9, 15)) : (weekend ? randInt(8, 14) : randInt(5, 9));
        const dayBills = [];
        for (let i = 0; i < nBills; i++) {
          const b = computeBill(back, branchOid);
          dayBills.push(b);

          // Bill doc
          billDocs.push(makeBillDoc(b, branchOid));
          billInvoiceItems.set(b.invoiceNumber, b.items);


          // DailySummary aggregation
          const k = `${b.dateStr}|${String(branchOid)}`;
          if (!dsAgg.has(k)) {
            dsAgg.set(k, {
              date: b.dateStr, branchId: branchOid, revenue: 0, orders: 0, items: 0,
              discount: 0, gst: 0, payment: new Map(), category: new Map(), top: new Map(), cashiers: new Map(),
            });
          }
          const agg = dsAgg.get(k);
          agg.revenue += b.grandTotal;
          agg.orders += 1;
          agg.items += b.items.reduce((s, it) => s + it.quantity, 0);
          agg.discount += b.discount;
          agg.gst += b.gstR;
          const pm = agg.payment.get(b.paymentMethod) || { method: b.paymentMethod, amount: 0, count: 0 };
          pm.amount += b.grandTotal; pm.count += 1;
          agg.payment.set(b.paymentMethod, pm);
          for (const it of b.items) {
            const cat = it.product.category;
            const c = agg.category.get(cat) || { category: cat, qty: 0, revenue: 0 };
            c.qty += it.quantity; c.revenue += it.price * it.quantity;
            agg.category.set(cat, c);
            const t = agg.top.get(it.product.name) || { name: it.product.name, qty: 0, revenue: 0 };
            t.qty += it.quantity; t.revenue += it.price * it.quantity;
            agg.top.set(it.product.name, t);
          }
          const cw = agg.cashiers.get(b.cashier.name) || { name: b.cashier.name, orders: 0, revenue: 0 };
          cw.orders += 1; cw.revenue += b.grandTotal;
          agg.cashiers.set(b.cashier.name, cw);

          // Cash ledger (only Cash bills hit the drawer)
          if (b.paymentMethod === 'Cash') {
            balancePerBranch[bkey] = Math.round((balancePerBranch[bkey] + b.grandTotal) * 100) / 100;
            cashLedgerDocs.push({
              restaurantId: new mongoose.Types.ObjectId(restId),
              branchId: branchOid,
              date: b.dateStr,
              type: 'cash_in',
              amount: b.grandTotal,
              balanceAfter: balancePerBranch[bkey],
              refType: 'bill',
              refId: b.invoiceNumber,
              note: `Bill ${b.invoiceNumber}`,
              performedBy: b.cashier.name,
              isDeleted: false,
              createdAt: b.createdAt,
              updatedAt: b.createdAt,
            });
          }

          // Customer visit + activity
          if (b.cust) {
            visitDocs.push({
              restaurantId: new mongoose.Types.ObjectId(restId),
              customerId: new mongoose.Types.ObjectId(b.cust._id),
              visitDate: b.dateStr,
              billAmount: b.grandTotal,
              pointsEarned: b.pointsEarned,
              pointsRedeemed: b.pointsRedeemed,
              redeemedRewardTitle: b.pointsRedeemed > 0 ? b.redeemedRewardTitle : undefined,
              createdAt: b.createdAt,
            });
            activityDocs.push({
              restaurantId: new mongoose.Types.ObjectId(restId),
              customerId: new mongoose.Types.ObjectId(b.cust._id),
              customerPhone: b.cust.phone,
              type: 'visit_recorded',
              title: `Visited — ₹${b.grandTotal.toFixed(2)}`,
              description: `Bill ${b.invoiceNumber} · ${b.orderType}`,
              performedBy: b.cashier.name,
              createdAt: b.createdAt,
            });
            if (b.pointsEarned > 0) {
              activityDocs.push({
                restaurantId: new mongoose.Types.ObjectId(restId),
                customerId: new mongoose.Types.ObjectId(b.cust._id),
                customerPhone: b.cust.phone,
                type: 'points_earned',
                title: `${b.pointsEarned} points earned`,
                metadata: { points: b.pointsEarned, bill: b.invoiceNumber },
                performedBy: b.cashier.name,
                createdAt: b.createdAt,
              });
            }
          }

          // Loyalty ledger — append-only earn/redeem entries mirroring loyaltyService.
          // Earn rows carry `remaining`/`expiresAt` (FIFO pool); redeems consume the
          // pool in createdAt order and record `consumedFrom` — same contract as
          // getAvailablePoints()/redeemPoints().
          if (b.cust) {
            const cid = b.cust._id.toString();
            let st = loyaltyPool.get(cid);
            if (!st) { st = { balance: 0, pool: [] }; loyaltyPool.set(cid, st); }
            if (b.pointsEarned > 0) {
              const earnDoc = {
                _id: new mongoose.Types.ObjectId(),
                restaurantId: new mongoose.Types.ObjectId(restId),
                customerId: new mongoose.Types.ObjectId(b.cust._id),
                customerPhone: b.cust.phone,
                branchId: branchOid,
                type: 'earn',
                points: b.pointsEarned,
                wallet: 0,
                balanceAfter: st.balance + b.pointsEarned,
                walletBalanceAfter: 0,
                remaining: b.pointsEarned,
                expiresAt: null,
                description: `Points earned on bill ${b.invoiceNumber}`,
                refType: 'bill',
                refId: b.invoiceNumber,
                createdBy: b.cashier.name,
                createdAt: b.createdAt,
              };
              st.pool.push(earnDoc); // same reference — FIFO consumption mutates the doc
              st.balance += b.pointsEarned;
              loyaltyTxDocs.push(earnDoc);
            }
            if (b.pointsRedeemed > 0) {
              let toConsume = b.pointsRedeemed;
              const consumedFrom = [];
              while (toConsume > 0 && st.pool.length > 0) {
                const head = st.pool[0];
                const take = Math.min(head.remaining, toConsume);
                head.remaining -= take; // mutates the doc in loyaltyTxDocs (same ref)
                toConsume -= take;
                consumedFrom.push({ transactionId: head._id.toString(), points: take });
                if (head.remaining === 0) st.pool.shift();
              }
              const actual = b.pointsRedeemed - toConsume; // only what the pool could cover
              st.balance -= actual;
              if (actual > 0) {
                loyaltyTxDocs.push({
                  restaurantId: new mongoose.Types.ObjectId(restId),
                  customerId: new mongoose.Types.ObjectId(b.cust._id),
                  customerPhone: b.cust.phone,
                  branchId: branchOid,
                  type: 'redeem',
                  points: -actual,
                  wallet: 0,
                  balanceAfter: st.balance,
                  walletBalanceAfter: 0,
                  description: `Points redeemed for ${b.redeemedRewardTitle || 'reward'}`,
                  refType: 'bill',
                  refId: b.invoiceNumber,
                  consumedFrom,
                  createdBy: b.cashier.name,
                  createdAt: b.createdAt,
                });
              }
            }

            // Refunded bills — billService.refundBill → reverseBillPoints appends
            // a proportional reversal redeem entry (pointsEarned × refundAmount /
            // grandTotal), so the ledger shows the earn → reversal pair, matching
            // the real append-only audit trail.
            if (b.isRefunded && b.pointsEarned > 0) {
              const refundAmount = Math.round(b.grandTotal * 0.3 * 100) / 100;
              const reversal = Math.min(
                b.pointsEarned,
                Math.round((b.pointsEarned * refundAmount) / b.grandTotal)
              );
              if (reversal > 0) {
                let toConsume = reversal;
                const consumedFrom = [];
                while (toConsume > 0 && st.pool.length > 0) {
                  const head = st.pool[0];
                  const take = Math.min(head.remaining, toConsume);
                  head.remaining -= take; // mutates the doc in loyaltyTxDocs (same ref)
                  toConsume -= take;
                  consumedFrom.push({ transactionId: head._id.toString(), points: take });
                  if (head.remaining === 0) st.pool.shift();
                }
                const actual = reversal - toConsume;
                st.balance -= actual;
                if (actual > 0) {
                  loyaltyTxDocs.push({
                    restaurantId: new mongoose.Types.ObjectId(restId),
                    customerId: new mongoose.Types.ObjectId(b.cust._id),
                    customerPhone: b.cust.phone,
                    branchId: branchOid,
                    type: 'redeem',
                    points: -actual,
                    wallet: 0,
                    balanceAfter: st.balance,
                    walletBalanceAfter: 0,
                    description: `Refund reversal (bill ${b.invoiceNumber})`,
                    refType: 'bill',
                    refId: b.invoiceNumber,
                    consumedFrom,
                    createdBy: b.cashier.name,
                    createdAt: b.createdAt,
                  });
                }
              }
            }
          }

          // Audit log
          auditDocs.push({
            action: 'BILL_CREATED',
            entityType: 'bill',
            entityId: b.invoiceNumber,
            performedBy: b.cashier.name,
            performedById: b.cashier.id || 'mfe_owner',
            details: {
              grandTotal: b.grandTotal,
              paymentMethod: b.paymentMethod,
              invoiceNumber: b.invoiceNumber,
              customerId: b.cust ? String(b.cust._id) : undefined,
              pointsEarned: b.pointsEarned,
            },
            branchId: branchOid,
            ipAddress: '127.0.0.1',
            createdAt: b.createdAt,
          });
        }
      }
      if (back % 30 === 0) log(`    … ${365 - back} days generated`);
    }
    logGreen(`generated ${billDocs.length} bills`);

    // ── Loyalty ledger true-up ─────────────────────────────────
    // Customers were seeded with a `points` balance derived from totalSpend,
    // which won't sum exactly to the per-bill earn/redeem entries. Write an
    // 'adjustment' entry per customer that closes the gap so the FIFO pool
    // (getAvailablePoints) exactly equals the customer's points balance.
    let loyaltyAdjustments = 0;
    for (const cust of customers) {
      const st = loyaltyPool.get(cust._id.toString());
      const target = cust.points || 0;
      const current = st ? st.balance : 0;
      const diff = target - current;
      if (diff === 0) continue;
      loyaltyAdjustments++;
      if (diff > 0) {
        const adjDoc = {
          _id: new mongoose.Types.ObjectId(),
          restaurantId: new mongoose.Types.ObjectId(restId),
          customerId: new mongoose.Types.ObjectId(cust._id),
          customerPhone: cust.phone,
          branchId: cust.branchId,
          type: 'adjustment',
          points: diff,
          wallet: 0,
          balanceAfter: target,
          walletBalanceAfter: 0,
          remaining: diff,
          expiresAt: null,
          description: 'Opening balance sync',
          createdBy: 'mfe_owner',
          createdAt: cust.firstVisit || now,
        };
        if (st) st.pool.push(adjDoc);
        loyaltyTxDocs.push(adjDoc);
      } else {
        // Negative gap — consume FIFO and record a debit adjustment
        let toConsume = -diff;
        const consumedFrom = [];
        while (toConsume > 0 && st && st.pool.length > 0) {
          const head = st.pool[0];
          const take = Math.min(head.remaining, toConsume);
          head.remaining -= take; // mutates the doc in loyaltyTxDocs (same ref)
          toConsume -= take;
          consumedFrom.push({ transactionId: head._id.toString(), points: take });
          if (head.remaining === 0) st.pool.shift();
        }
        loyaltyTxDocs.push({
          restaurantId: new mongoose.Types.ObjectId(restId),
          customerId: new mongoose.Types.ObjectId(cust._id),
          customerPhone: cust.phone,
          branchId: cust.branchId,
          type: 'adjustment',
          points: diff,
          wallet: 0,
          balanceAfter: target,
          walletBalanceAfter: 0,
          description: 'Balance reconciliation',
          consumedFrom,
          createdBy: 'mfe_owner',
          createdAt: cust.lastVisit || now,
        });
      }
    }

    for (let i = 0; i < billDocs.length; i += 1000) {
      const chunk = billDocs.slice(i, i + 1000);
      await db.collection('bills').insertMany(chunk, { ordered: false });
    }

    // Rebuild items per bill from the invoice → items map captured during
    // generation (billDocs themselves don't embed items).
    const linked = [];
    {
      const inserted = await db.collection('bills').find(
        { restaurantId: new mongoose.Types.ObjectId(restId), invoiceNumber: { $regex: '^MF-INV-' } },
        { projection: { _id: 1, invoiceNumber: 1, createdAt: 1 } }
      ).toArray();
      for (const b of inserted) {
        const items = billInvoiceItems.get(b.invoiceNumber) || [];
        for (const it of items) {
          linked.push({
            billId: b._id,
            menuItemId: it.product.id,
            itemName: it.product.name,
            priceAtSale: it.price,
            quantity: it.quantity,
            gstRateAtSale: it.product.gstPercent,
            discountAtSale: 0,
            notes: it.notes,
            isFree: false,
            createdAt: b.createdAt,
          });
        }
      }
      await insertChunked('billitems', linked);
      logGreen(`${linked.length} bill items linked`);
    }

    // Insert the customer visits / activities / bill audit logs collected above
    await insertChunked('customervisits', visitDocs);
    await insertChunked('customeractivities', activityDocs);
    await insertChunked('cashledgers', cashLedgerDocs);
    await insertChunked('auditlogs', auditDocs);
    await insertChunked('loyaltytransactions', loyaltyTxDocs);
    logGreen(`${visitDocs.length} customer visits / ${activityDocs.length} activities / ${cashLedgerDocs.length} cash ledger entries / ${auditDocs.length} bill audits / ${loyaltyTxDocs.length} loyalty ledger entries (${loyaltyAdjustments} balance syncs)`);

    // ─── Expenses + cash ledger expense entries ───────────────
    log('[15] Bulk: expenses');
    const EXP_CATS = [
      ['Ingredients & Raw Materials', true], ['Salaries & Wages', false], ['Utilities', false],
      ['Rent & Lease', false], ['Equipment & Maintenance', false], ['Marketing & Advertising', false],
      ['Delivery & Logistics', false], ['Cleaning & Supplies', false], ['Licenses & Permits', false], ['Miscellaneous', false],
    ];
    const expenseDocs = [];
    const expLedgerDocs = [];
    for (let back = 364; back >= 0; back--) {
      const d = dateOffset(back);
      const dateStr = localDateStr(d);
      for (const [bkey, branchOid] of [['head', headOid], ['second', secondOid]]) {
        const nExp = bkey === 'head' ? randInt(4, 8) : randInt(2, 5);
        for (let i = 0; i < nExp; i++) {
          const [cat, isCogs] = pick(EXP_CATS);
          const base = isCogs ? randInt(2000, 15000) : cat === 'Rent & Lease' ? randInt(60000, 95000) : cat === 'Salaries & Wages' ? randInt(30000, 80000) : randInt(400, 9000);
          const amount = Math.round(base * 100) / 100;
          const desc = pick([
            'Vegetables & spices — daily market', 'Fresh meat & poultry order', 'Dairy, paneer & cream restock',
            'Rice, atta & cooking oil bulk buy', 'Monthly rent — premises', 'Staff salaries & payroll',
            'Electricity bill', 'Water & sewage charges', 'LPG gas cylinder refill', 'Kitchen equipment servicing',
            'POS terminal maintenance', 'Instagram & food app ads', 'Swiggy/Zomato delivery payouts',
            'Detergents & cleaning supplies', 'Health & safety inspection fee', 'Miscellaneous operational expenses',
          ]);
          const ts = new Date(`${dateStr}T${randInt(9, 21)}:${String(randInt(0, 59)).padStart(2, '0')}:00`);
          const paymentMethod = pick(['Cash', 'UPI', 'Card', 'Bank Transfer']);
          expenseDocs.push({
            restaurantId: new mongoose.Types.ObjectId(restId),
            branchId: branchOid,
            date: dateStr,
            category: cat,
            description: desc,
            amount,
            paymentMethod,
            vendor: pick(['FreshMart Supplies', 'Metro Wholesale', 'BESCOM', 'BBMP', 'Swiggy', 'Zomato', 'IndusInd Rentals', 'TechServe']),
            notes: rng() < 0.15 ? 'Approved by manager' : undefined,
            isCogs,
            gst: isCogs ? { cgst: 0, sgst: 0, igst: 0, cess: 0, inputGst: true, taxInclusive: true } : undefined,
            attachments: [],
            isRecurring: cat === 'Rent & Lease' || cat === 'Salaries & Wages',
            version: 1,
            isDeleted: false, deletedAt: null,
            createdAt: ts, updatedAt: ts,
          });
          balancePerBranch[bkey] = Math.round((balancePerBranch[bkey] - amount) * 100) / 100;
          expLedgerDocs.push({
            restaurantId: new mongoose.Types.ObjectId(restId),
            branchId: branchOid,
            date: dateStr,
            type: 'expense',
            amount: -amount,
            balanceAfter: balancePerBranch[bkey],
            refType: 'expense',
            note: `${cat} — ${desc}`,
            performedBy: 'mfe_manager',
            isDeleted: false,
            createdAt: ts, updatedAt: ts,
          });
        }
      }
    }
    await insertChunked('expenses', expenseDocs);
    await insertChunked('cashledgers', expLedgerDocs);
    logGreen(`${expenseDocs.length} expenses`);

    // ─── Daily summaries ──────────────────────────────────────
    log('[16] Bulk: daily summaries');
    const dsDocs = [];
    for (const agg of dsAgg.values()) {
      dsDocs.push({
        date: agg.date,
        restaurantId: new mongoose.Types.ObjectId(restId),
        branchId: agg.branchId,
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
        updatedAt: now,
      });
    }
    await insertChunked('dailysummaries', dsDocs);
    logGreen(`${dsDocs.length} daily summaries`);

    // ─── Orders + order items + KOTs + timeline ───────────────
    log('[17] Bulk: orders');
    const orderDocs = [];
    const orderItemDocs = [];
    const kotDocs = [];
    const timelineDocs = [];
    const orderStatuses = ['New', 'Accepted', 'Preparing', 'Ready', 'Served', 'Waiting Payment', 'Paid', 'Closed'];
    let onum = 10001;
    for (let back = 89; back >= 0; back--) {
      const d = dateOffset(back);
      const dateStr = localDateStr(d);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const nOrders = weekend ? randInt(16, 26) : randInt(9, 16);
      for (let i = 0; i < nOrders; i++) {
        onum++;
        const branchOid = rng() < 0.65 ? headOid : secondOid;
        const isToday = back === 0;
        const closed = !isToday && rng() < 0.85;
        const status = closed ? pick(['Served', 'Paid', 'Closed']) : pick(orderStatuses);
        const type = weighted([
          { v: 'Dine In', w: 45 }, { v: 'Takeaway', w: 25 }, { v: 'Delivery', w: 12 },
          { v: 'Swiggy', w: 10 }, { v: 'Zomato', w: 8 },
        ]);
        const nItems = randInt(1, 4);
        const items = [];
        const used = new Set();
        let subtotal = 0, gst = 0;
        for (let j = 0; j < nItems; j++) {
          let idx = randInt(0, productIds.length - 1);
          let guard = 0;
          while (used.has(idx) && guard++ < 8) idx = randInt(0, productIds.length - 1);
          used.add(idx);
          const prod = productDocs[idx];
          const qty = randInt(1, 3);
          subtotal += prod.price * qty;
          gst += (prod.price * qty * prod.gstPercent) / 100;
          items.push({ product: prod, qty, notes: rng() < 0.1 ? 'no onions' : undefined });
        }
        const discount = rng() < 0.15 ? randInt(20, Math.round(subtotal * 0.08)) : 0;
        const grandTotal = Math.round((subtotal + gst - discount) * 100) / 100;
        const time = pick(TIME_SLOTS);
        const createdAt = new Date(`${dateStr}T${time}:00`);
        const cust = rng() < 0.5 ? pick(customers) : null;
        const oid = O();
        orderDocs.push({
          _id: oid,
          orderNumber: onum,
          type,
          status,
          tableId: type === 'Dine In' ? `t${randInt(1, 16)}` : undefined,
          tableNumber: type === 'Dine In' ? randInt(1, 16) : undefined,
          platform: ['Swiggy', 'Zomato'].includes(type) ? type : undefined,
          branchId: branchOid,
          customerPhone: cust ? cust.phone : undefined,
          customerName: cust ? cust.name : (type === 'Takeaway' || type === 'Delivery' ? customerNames[randInt(0, customerNames.length - 1)].name : undefined),
          waiterId: 'mfe_owner',
          waiterName: pick(CASHIERS).name,
          guestCount: type === 'Dine In' ? randInt(1, 10) : undefined,
          specialInstructions: rng() < 0.12 ? 'Please pack cutlery' : undefined,
          deliveryAddress: (type === 'Delivery' || type === 'Swiggy' || type === 'Zomato') ? `${randInt(1, 500)}, ${pick(['MG Road', 'Park Street', 'Lake View', 'Rose Garden', 'Central Ave', 'Market Road'])}, ${pick(CITIES)}` : undefined,
          deliveryEta: (type === 'Delivery') ? `${randInt(20, 45)} min` : undefined,
          subtotal: Math.round(subtotal * 100) / 100,
          discount,
          gst: Math.round(gst * 100) / 100,
          grandTotal,
          paymentMethod: closed ? pick(PREF_METHODS) : undefined,
          paidAt: closed ? new Date(createdAt.getTime() + randInt(30, 90) * 60000) : null,
          closedAt: closed ? new Date(createdAt.getTime() + randInt(60, 150) * 60000) : null,
          appliedRewardTitle: rng() < 0.05 ? pick(rewardDocs).title : undefined,
          loyaltyPointsEarned: cust ? Math.round(grandTotal / 20) : 0,
          loyaltyPointsRedeemed: cust && rng() < 0.06 ? randInt(40, 300) : 0,
          isDeleted: false, deletedAt: null,
          createdAt, updatedAt: createdAt,
        });
        for (const it of items) {
          orderItemDocs.push({
            orderId: oid,
            productId: it.product.code,
            productName: it.product.name,
            variantName: undefined,
            quantity: it.qty,
            price: it.product.price,
            notes: it.notes,
            isFree: false,
            kotPrinted: status !== 'New',
            isDeleted: false,
            createdAt, updatedAt: createdAt,
          });
        }
        // KOT record (Original; Additional if status advanced)
        kotDocs.push({
          orderId: oid,
          kotNumber: onum,
          type: rng() < 0.15 ? 'Additional' : 'Original',
          items: items.map((it) => ({ itemName: it.product.name, quantity: it.qty, notes: it.notes })),
          printedBy: pick(CASHIERS).name,
          note: rng() < 0.1 ? 'Urgent table 5' : undefined,
          createdAt,
        });
        // Timeline
        const flow = ['Created', 'Accepted', 'Preparing', 'Ready', 'Served', 'Paid', 'Closed'];
        const maxStep = closed ? 6 : flow.indexOf(status) >= 0 ? Math.max(0, flow.indexOf(status)) : 0;
        for (let s = 0; s <= maxStep; s++) {
          timelineDocs.push({
            orderId: oid,
            type: flow[s],
            description: `Order ${flow[s].toLowerCase()} by ${pick(CASHIERS).name}`,
            actor: pick(CASHIERS).name,
            createdAt: new Date(createdAt.getTime() + s * randInt(8, 25) * 60000),
          });
        }
      }
    }
    await insertChunked('orders', orderDocs);
    await insertChunked('orderitems', orderItemDocs);
    await insertChunked('kotrecords', kotDocs);
    await insertChunked('timelineevents', timelineDocs);
    logGreen(`${orderDocs.length} orders / ${orderItemDocs.length} order items / ${kotDocs.length} KOTs / ${timelineDocs.length} timeline events`);

    // ─── Takeaway orders ──────────────────────────────────────
    log('[18] Bulk: takeaway orders');
    const tkDocs = [];
    let tkonum = 20001;
    for (let back = 89; back >= 0; back--) {
      const d = dateOffset(back);
      const dateStr = localDateStr(d);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const nTk = weekend ? randInt(5, 9) : randInt(2, 5);
      for (let i = 0; i < nTk; i++) {
        tkonum++;
        const cust = rng() < 0.7 ? pick(customers) : null;
        const name = cust ? cust.name : customerNames[randInt(0, customerNames.length - 1)].name;
        const phone = cust ? cust.phone : `99${String(randInt(10000000, 99999999))}`;
        const nItems = randInt(1, 3);
        const items = [];
        let amount = 0;
        for (let j = 0; j < nItems; j++) {
          const prod = pick(productDocs);
          const qty = randInt(1, 3);
          amount += prod.price * qty;
          items.push({ itemName: prod.name, quantity: qty, price: prod.price });
        }
        const ts = new Date(`${dateStr}T${pick(TIME_SLOTS)}:00`);
        const isToday = back === 0;
        tkDocs.push({
          orderNumber: tkonum,
          customerName: name,
          customerPhone: phone,
          status: isToday ? pick(['Preparing', 'Ready', 'Collected']) : pick(['Preparing', 'Ready', 'Collected', 'Completed']),
          amount: Math.round(amount * 100) / 100,
          paymentStatus: isToday ? (rng() < 0.6 ? 'Paid' : 'Pending') : pick(['Paid', 'Paid', 'Paid', 'Pending']),
          branchId: rng() < 0.6 ? headOid : secondOid,
          items,
          isDeleted: false, deletedAt: null,
          createdAt: ts, updatedAt: ts,
        });
      }
    }
    await insertChunked('takeawayorders', tkDocs);
    logGreen(`${tkDocs.length} takeaway orders`);

    // ─── Reservations ─────────────────────────────────────────
    log('[19] Bulk: reservations');
    const resDocs = [];
    for (let ahead = 14; ahead >= -30; ahead--) {
      const d = ahead >= 0 ? dateAhead(ahead) : dateOffset(-ahead);
      const dateStr = localDateStr(d);
      const nRes = randInt(2, 6);
      for (let i = 0; i < nRes; i++) {
        const cust = pick(customers);
        const past = ahead < 0;
        const status = past ? pick(['Seated', 'Seated', 'Seated', 'Cancelled', 'No Show']) : pick(['Confirmed', 'Confirmed', 'Confirmed', 'Pending']);
        resDocs.push({
          customerName: cust.name,
          customerPhone: cust.phone,
          guestCount: randInt(1, 10),
          date: dateStr,
          time: pick(TIME_SLOTS),
          tableId: `t${randInt(1, 16)}`,
          tableNumber: randInt(1, 16),
          status,
          branchId: rng() < 0.6 ? headOid : secondOid,
          restaurantId: new mongoose.Types.ObjectId(restId),
          notes: rng() < 0.25 ? pick(['Window seat preferred', 'Anniversary dinner', 'Business lunch', 'Birthday cake ordered', 'Vegetarian']) : undefined,
          occasion: rng() < 0.2 ? pick(['Birthday', 'Anniversary', 'Business', 'Family Dinner']) : undefined,
          createdBy: 'mfe_manager',
          customerId: String(cust._id),
          seatedAt: past ? new Date(`${dateStr}T${pick(TIME_SLOTS)}:00`) : null,
          isDeleted: false, deletedAt: null,
          createdAt: new Date(`${dateStr}T09:00:00`),
          updatedAt: now,
        });
      }
    }
    await insertChunked('reservations', resDocs);
    logGreen(`${resDocs.length} reservations`);

    // ─── Waiting list ─────────────────────────────────────────
    log('[20] Bulk: waiting entries');
    const waitDocs = [];
    for (let i = 0; i < 25; i++) {
      const cust = pick(customers);
      waitDocs.push({
        customerName: cust.name,
        customerPhone: cust.phone,
        guestCount: randInt(1, 8),
        estimatedWaitMinutes: randInt(10, 45),
        status: rng() < 0.75 ? 'Waiting' : 'Seated',
        branchId: rng() < 0.7 ? headOid : secondOid,
        notes: rng() < 0.2 ? 'High chair needed' : undefined,
        partyType: pick(['adult', 'family', 'business']),
        isDeleted: false, deletedAt: null,
        createdAt: new Date(Date.now() - randInt(5, 90) * 60000),
        updatedAt: now,
      });
    }
    await insertChunked('waitingentries', waitDocs);
    logGreen(`${waitDocs.length} waiting entries`);

    // ─── Held orders ──────────────────────────────────────────
    log('[21] Bulk: held orders');
    const heldDocs = [];
    for (let i = 0; i < 6; i++) {
      const nItems = randInt(1, 3);
      const items = [];
      for (let j = 0; j < nItems; j++) {
        const prod = pick(productDocs);
        items.push({ product: { id: prod.code, name: prod.name, price: prod.price, category: prod.category }, productName: prod.name, quantity: randInt(1, 2), price: prod.price });
      }
      heldDocs.push({
        clientId: `held_mfe_${Date.now()}_${i}`,
        orderId: null,
        customer: rng() < 0.5 ? { name: pick(customers).name, phone: pick(customers).phone } : null,
        items,
        type: pick(['Dine In', 'Takeaway']),
        timestamp: new Date().toISOString(),
        branchId: headOid,
        isDeleted: false, deletedAt: null,
        createdAt: new Date(Date.now() - i * 3600000),
        updatedAt: now,
      });
    }
    await insertChunked('heldorders', heldDocs);
    logGreen(`${heldDocs.length} held orders`);

    // ─── LOGIN audit trail + historical subscription payments ─
    log('[22] Bulk: audit LOGIN trail + historical payments');
    const marker = `MEGA_FEAST_${String(restId).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-10)}`;
    const loginDocs = [];
    for (let back = 364; back >= 0; back--) {
      const d = dateOffset(back);
      const nLogins = randInt(2, 5);
      for (let i = 0; i < nLogins; i++) {
        const emp = pick(CASHIERS);
        const ts = new Date(d.getTime() + randInt(0, 12) * 3600000 + randInt(0, 59) * 60000);
        loginDocs.push({
          action: 'LOGIN',
          entityType: 'user',
          entityId: `mfe_${restId}`,
          performedBy: emp.name,
          performedById: `mfe_${restId}`,
          details: { role: emp.role.toLowerCase(), restaurantId: marker },
          branchId: rng() < 0.7 ? headOid : secondOid,
          ipAddress: '127.0.0.1',
          createdAt: ts,
        });
      }
    }
    await insertChunked('auditlogs', loginDocs);
    const code = String(restId).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-8) || 'MEGA';
    const subDoc = await db.collection('subscriptions').findOne({ restaurantId: new mongoose.Types.ObjectId(restId) });
    const payDocs = [];
    for (let m = 11; m >= 1; m--) {
      const ts = new Date();
      ts.setMonth(ts.getMonth() - m, 1);
      ts.setHours(10, 30, 0, 0);
      payDocs.push({
        restaurantId: new mongoose.Types.ObjectId(restId),
        subscriptionId: subDoc?._id,
        razorpayOrderId: `order_mfe_hist_${code}_${m}`,
        razorpayPaymentId: `pay_mfe_hist_${code}_${m}`,
        amount: 4999,
        currency: 'INR',
        gateway: 'cash',
        paymentMethod: 'Cash',
        status: 'success',
        invoiceNumber: `SUB-2026-MF-${code}-${m}`,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    await insertChunked('payments', payDocs);
    logGreen(`${loginDocs.length} LOGIN audits + ${payDocs.length} historical payments`);

    // ─── Customer 'created' activities for every customer ─────
    log('[23] Bulk: customer created activities');
    const createdActs = customers.map((c) => ({
      restaurantId: new mongoose.Types.ObjectId(restId),
      customerId: c._id,
      customerPhone: c.phone,
      type: 'created',
      title: `Customer profile created — ${c.name}`,
      performedBy: 'mfe_owner',
      createdAt: c.createdAt || now,
    }));
    await insertChunked('customeractivities', createdActs);
    logGreen(`${createdActs.length} created activities`);

    // ═══════════════════════════════════════════════════════════
    // VERIFY
    // ═══════════════════════════════════════════════════════════
    log('\n=== SEED COMPLETE ===');
    log('\n=== COLLECTION COUNTS (this restaurant) ===');
    const oidRest = new mongoose.Types.ObjectId(restId);
    const branchOids = [headOid, secondOid];
    const scoped = {};
    for (const c of ['subscriptions', 'payments', 'branches', 'employees', 'products', 'customers', 'offers', 'rewards', 'devices', 'itemaliases', 'cashledgers', 'customeractivities']) {
      try { scoped[c] = await db.collection(c).countDocuments({ restaurantId: oidRest }); } catch { scoped[c] = 'ERR'; }
    }
    for (const c of ['bills', 'expenses', 'tables', 'orders', 'takeawayorders', 'reservations', 'waitingentries', 'heldorders', 'dailysummaries']) {
      try { scoped[c] = await db.collection(c).countDocuments({ branchId: { $in: branchOids } }); } catch { scoped[c] = 'ERR'; }
    }
    // Collections keyed by billId/orderId (no branchId) — count via a $lookup so the
    // printed table reflects real volume instead of 0.
    try {
      const billLink = await db.collection('bills').aggregate([
        { $match: { restaurantId: oidRest } },
        { $lookup: { from: 'billitems', localField: '_id', foreignField: 'billId', as: 'bi' } },
        { $project: { n: { $size: '$bi' } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]).toArray();
      scoped.billitems = billLink[0]?.n || 0;
    } catch { scoped.billitems = 'ERR'; }
    try {
      const oLink = await db.collection('orders').aggregate([
        { $match: { branchId: { $in: branchOids } } },
        { $lookup: { from: 'orderitems', localField: '_id', foreignField: 'orderId', as: 'oi' } },
        { $project: { n: { $size: '$oi' } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]).toArray();
      scoped.orderitems = oLink[0]?.n || 0;
    } catch { scoped.orderitems = 'ERR'; }
    try {
      const kLink = await db.collection('orders').aggregate([
        { $match: { branchId: { $in: branchOids } } },
        { $lookup: { from: 'kotrecords', localField: '_id', foreignField: 'orderId', as: 'k' } },
        { $project: { n: { $size: '$k' } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]).toArray();
      scoped.kotrecords = kLink[0]?.n || 0;
    } catch { scoped.kotrecords = 'ERR'; }
    try {
      const tLink = await db.collection('orders').aggregate([
        { $match: { branchId: { $in: branchOids } } },
        { $lookup: { from: 'timelineevents', localField: '_id', foreignField: 'orderId', as: 't' } },
        { $project: { n: { $size: '$t' } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]).toArray();
      scoped.timelineevents = tLink[0]?.n || 0;
    } catch { scoped.timelineevents = 'ERR'; }
    scoped.customers = await db.collection('customers').countDocuments({ restaurantId: oidRest });
    scoped.bills = await db.collection('bills').countDocuments({ restaurantId: oidRest });
    scoped.auditLogs = await db.collection('auditlogs').countDocuments({ $or: [{ 'details.restaurantId': marker }, { action: 'BILL_CREATED', 'details.invoiceNumber': { $regex: '^MF-INV-' } }] });
    Object.entries(scoped).forEach(([k, v]) => log(`  ${k}: ${v}`));

    log('\n==============================================');
    log('  LOGIN CREDENTIALS');
    log('==============================================');
    log(`  Restaurant:     ${restaurant.name}`);
    log(`  Owner (user):   username=${restaurant.ownerUserId}  PIN=${restaurant.ownerPin}`);
    log(`  Owner (staff):  mfe_owner / 1008`);
    log(`  Manager:        mfe_manager / 2009`);
    log(`  Cashier:        mfe_cashier1 / 1234,  mfe_cashier2 / 2345`);
    log('  ─────────────────────────────────────────────');
    log('  ADMIN DASHBOARD:');
    log(`  username=admin   password=1008`);
    log('==============================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error('\n❌ Seeding failed:', err.message);
    console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
