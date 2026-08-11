/**
 * =============================================================================
 * seed-branch-prices.mjs — apply branch-specific menu prices to the live DB
 * =============================================================================
 *
 * Gives the Koramangala branch of the seeded "Mega Feast House" restaurant a
 * few branchPrice overrides so its customer storefront shows different prices
 * than the head branch (branch-scoped pricing in action).
 *
 *   - The head branch keeps the product's BASE price.
 *   - The Koramangala branch shows the OVERRIDE price on its QR storefront
 *     (getMenu applies branchPrice per branch; order totals use it too).
 *
 * Idempotent: safe to re-run. Only touches Mega Feast products, never other
 * restaurants. Also mirrors the BRANCH_PRICE_OVERRIDES baked into
 * seed-mega-restaurant.mjs so re-seeding keeps the same demo.
 *
 * Run from backend/ :  node scripts/seed-branch-prices.mjs
 * =============================================================================
 */
import mongoose from 'mongoose';

// Product code → Koramangala price (head branch keeps the base price).
const BRANCH_PRICE_OVERRIDES = {
  MF026: 79,  // Garlic Naan       ₹69 → ₹79
  MF027: 65,  // Butter Naan       ₹59 → ₹65
  MF004: 469, // BBQ Chicken Pizza ₹449 → ₹469
  MF022: 349, // Chicken Biryani   ₹329 → ₹349
};

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos', { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const rest = await db.collection('restaurants').findOne({ name: /^Mega Feast House/ });
  if (!rest) { console.log('✗ Mega Feast restaurant not found'); process.exit(1); }
  const rid = rest._id;

  const kor = await db.collection('branches').findOne({ restaurantId: rid, name: /Koramangala/i });
  if (!kor) { console.log('✗ Koramangala branch not found'); process.exit(1); }
  const korId = String(kor._id);
  console.log(`Restaurant: ${rest.name} (${rid})`);
  console.log(`Koramangala branch: ${kor.name} (${korId})`);

  let updated = 0;
  for (const [code, price] of Object.entries(BRANCH_PRICE_OVERRIDES)) {
    const res = await db.collection('products').updateOne(
      { restaurantId: rid, code, isDeleted: { $ne: true } },
      { $set: { [`branchPrice.${korId}`]: price, updatedAt: new Date() } }
    );
    const prod = await db.collection('products').findOne({ restaurantId: rid, code, isDeleted: { $ne: true } });
    if (res.matchedCount === 0) { console.log(`  ✗ ${code} not found`); continue; }
    updated++;
    console.log(`  ✓ ${code} ${prod ? prod.name : ''} — base ₹${prod ? prod.price : '?'} → Koramangala ₹${price}`);
  }

  // Confirm persisted shape
  const sample = await db.collection('products').find(
    { restaurantId: rid, code: { $in: Object.keys(BRANCH_PRICE_OVERRIDES) } },
    { projection: { code: 1, price: 1, branchPrice: 1 } }
  ).toArray();
  console.log('\nPersisted branchPrice maps:');
  for (const s of sample) {
    console.log(`  ${s.code} base ₹${s.price} → branchPrice`, JSON.stringify(s.branchPrice || {}));
  }
  console.log(`\nDone — ${updated}/${Object.keys(BRANCH_PRICE_OVERRIDES).length} products overridden.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
