/**
 * =============================================================================
 *  migrate-phase-1.6.ts — Safe migration for Customer Management, Loyalty & CRM
 * =============================================================================
 *
 * Phase 1.6 converts the CRUD-only customer module into the full CRM/loyalty
 * system. This script safely upgrades EXISTING data:
 *
 *  1. Drops the legacy global-unique `phone_1` index (blocks multi-tenant).
 *  2. Backfills restaurantId on every customer from their bills (customerPhone
 *     → most recent bill's restaurantId). Unmatched customers are assigned to
 *     the restaurant with the most bills (typical single-restaurant POS); if
 *     the DB has no bills at all they keep restaurantId null (visible only to
 *     a future owner claim) — the unique compound index tolerates this because
 *     the legacy index has been dropped.
 *  3. Recreates the { restaurantId, phone } UNIQUE index (via syncIndexes).
 *  4. Seeds default loyalty settings + tiers per restaurant.
 *  5. Backfills loyalty stats (tier from totalSpend, lifetime points,
 *     total spend/orders from bills) — all server-computed, no data loss.
 *  6. Generates referral codes for customers that lack one.
 *  7. Backfills CustomerVisit/legacy records with restaurantId where possible.
 *
 * Safe: idempotent (safe to run twice), never deletes data, never rewrites
 * bills. Run BEFORE starting the new backend against existing databases:
 *
 *   npx tsx scripts/migrate-phase-1.6.ts
 *
 * Env: MONGO_URI (defaults to backend/src/config.ts's local default).
 * =============================================================================
 */

import mongoose from 'mongoose';
import { config } from '../src/config';

async function run(): Promise<void> {
  const uri = process.env.MONGO_URI || (config as any).mongoUri || 'mongodb://localhost:27017/pos';
  console.log(`[Migrate 1.6] Connecting to MongoDB…`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  if (!db) throw new Error('No database connection');

  // ─── 1. Drop the legacy global-unique phone index ────────────
  try {
    const cols = await db.listCollections({ name: 'customers' }).toArray();
    if (cols.length > 0) {
      const indexes = await db.collection('customers').indexes();
      const legacy = indexes.find((i) => i.name === 'phone_1');
      if (legacy) {
        await db.collection('customers').dropIndex('phone_1');
        console.log('[Migrate 1.6] Dropped legacy unique index phone_1');
      } else {
        console.log('[Migrate 1.6] Legacy phone_1 index already absent');
      }
    }
  } catch (err: any) {
    console.warn('[Migrate 1.6] Index drop skipped:', err.message);
  }

  // ─── 2. Backfill restaurantId from bills ─────────────────────
  const customersCol = db.collection('customers');
  const billsCol = db.collection('bills');

  const orphanCustomers = await customersCol
    .find({ $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] })
    .toArray();
  console.log(`[Migrate 1.6] Found ${orphanCustomers.length} customers without restaurantId`);

  // Map restaurantId → bill count, pick the dominant one as the fallback.
  const restaurantCounts = await billsCol.aggregate([
    { $match: { restaurantId: { $exists: true, $ne: null } } },
    { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  const fallbackRestaurantId = restaurantCounts[0]?._id || null;
  console.log(`[Migrate 1.6] Fallback restaurant: ${fallbackRestaurantId?.toString?.() || 'none'}`);

  let assignedFromBills = 0;
  let assignedFallback = 0;
  let unresolved = 0;

  for (const customer of orphanCustomers) {
    if (!customer.phone) continue;
    const bill = await billsCol
      .findOne({ customerPhone: customer.phone, restaurantId: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 });
    let restaurantId = bill?.restaurantId || null;
    if (!restaurantId && fallbackRestaurantId) restaurantId = fallbackRestaurantId;

    if (restaurantId) {
      await customersCol.updateOne(
        { _id: customer._id },
        { $set: { restaurantId } }
      );
      if (bill?.restaurantId) assignedFromBills++;
      else assignedFallback++;
    } else {
      unresolved++;
    }
  }
  console.log(`[Migrate 1.6] Customers: ${assignedFromBills} from bills, ${assignedFallback} via fallback, ${unresolved} unresolved (no bills/restaurants in DB)`);

  // ─── 3. Recreate indexes (drop stale + sync) ─────────────────
  try {
    await customersCol.dropIndexes();
    console.log('[Migrate 1.6] Dropped all legacy customer indexes (will recreate)');
  } catch (err: any) {
    console.warn('[Migrate 1.6] dropIndexes skipped:', err.message);
  }

  await import('../src/models/index').then(async (models: any) => {
    await (models.Customer as any).init();
    await (models.LoyaltyTier as any).init();
    await (models.LoyaltySettings as any).init();
    await (models.LoyaltyTransaction as any).init();
    await (models.OtpRequest as any).init();
    await (models.CouponRedemption as any).init();
    await (models.CustomerActivity as any).init();
    await (models.Referral as any).init();
    await (models.Campaign as any).init();
    console.log('[Migrate 1.6] Customer + loyalty indexes rebuilt');
  });

  // ─── 4. Backfill loyalty stats + referral codes per customer ─
  const customers = await customersCol
    .find({ restaurantId: { $exists: true, $ne: null }, isDeleted: { $ne: true } })
    .toArray();
  const TIERS = [
    { name: 'Bronze', min: 0 },
    { name: 'Silver', min: 5000 },
    { name: 'Gold', min: 20000 },
    { name: 'Platinum', min: 50000 },
    { name: 'Diamond', min: 100000 },
  ];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const genCode = () => Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const usedCodes = new Set<string>();

  for (const customer of customers) {
    // Aggregate spend/orders from bills (all-time, tenant-scoped).
    const agg = await billsCol.aggregate([
      {
        $match: {
          restaurantId: customer.restaurantId,
          $or: [{ customerId: customer._id }, { customerPhone: customer.phone }],
          isVoided: { $ne: true },
          isRefunded: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalSpend: { $sum: '$grandTotal' },
          orders: { $sum: 1 },
        },
      },
    ]).toArray();
    const totalSpend = Math.round((agg[0]?.totalSpend || 0) * 100) / 100;
    const orders = agg[0]?.orders || 0;
    const visits = Math.max(customer.visits || 0, orders);
    const averageSpend = visits > 0 ? Math.round((totalSpend / visits) * 100) / 100 : 0;
    const tier = TIERS.filter((t) => totalSpend >= t.min).pop()?.name || 'Bronze';

    let referralCode = customer.referralCode;
    if (!referralCode) {
      let code = genCode();
      while (usedCodes.has(code)) code = genCode();
      usedCodes.add(code);
      referralCode = code;
    }

    await customersCol.updateOne(
      { _id: customer._id },
      {
        $set: {
          totalSpend,
          averageSpend,
          totalOrders: orders,
          visits,
          tier,
          lifetimePoints: Math.max(customer.lifetimePoints || 0, customer.points || 0),
          walletBalance: customer.walletBalance || 0,
          referralCode,
          status: customer.status || 'active',
          isNewCustomer: customer.isNewCustomer ?? (visits <= 1),
          tierChangedAt: customer.tierChangedAt || customer.updatedAt || new Date(),
        },
      }
    );
  }
  console.log(`[Migrate 1.6] Backfilled stats/tier/referral codes for ${customers.length} customers`);

  // ─── 5. Seed default loyalty settings + tiers per restaurant ─
  const restaurants = await db.collection('restaurants').find({}).toArray();
  const loyaltySettingsCol = db.collection('loyaltysettings');
  const loyaltyTiersCol = db.collection('loyaltytiers');

  const DEFAULT_SETTINGS = {
    pointsPerCurrency: 1,
    pointsValueInCurrency: 10,
    roundOffPoints: true,
    minRedemption: 0,
    maxRedemptionPerTransaction: 500,
    dailyRedemptionLimit: 1000,
    monthlyRedemptionLimit: 5000,
    pointExpiryMode: 'none',
    rollingExpiryMonths: 12,
    expiryReminderDays: [30, 7, 1],
    welcomePoints: 50,
    birthdayBonusPoints: 100,
    anniversaryBonusPoints: 100,
    referralEnabled: true,
    referralReferrerPoints: 100,
    referralRefereePoints: 50,
    enableWallet: true,
    enableTiers: true,
    otpEnabled: true,
    largeRewardThreshold: 500,
  };
  const DEFAULT_TIERS = [
    { name: 'Bronze', minLifetimeSpend: 0, pointsMultiplier: 1, rewardPercent: 0, expiryMonths: 12, priority: 0, birthdayRewardPoints: 50, benefits: ['Earn 1x points', 'Birthday reward 50 pts'], isDefault: true },
    { name: 'Silver', minLifetimeSpend: 5000, pointsMultiplier: 1.25, rewardPercent: 0, expiryMonths: 12, priority: 1, birthdayRewardPoints: 75, benefits: ['Earn 1.25x points', 'Priority seating', 'Birthday reward 75 pts'], isDefault: false },
    { name: 'Gold', minLifetimeSpend: 20000, pointsMultiplier: 1.5, rewardPercent: 2, expiryMonths: 15, priority: 2, birthdayRewardPoints: 100, benefits: ['Earn 1.5x points', '2% extra reward', 'Free dessert on birthday'], isDefault: false },
    { name: 'Platinum', minLifetimeSpend: 50000, pointsMultiplier: 2, rewardPercent: 4, expiryMonths: 18, priority: 3, birthdayRewardPoints: 150, benefits: ['Earn 2x points', '4% extra reward', 'Free dessert + priority reservations'], isDefault: false },
    { name: 'Diamond', minLifetimeSpend: 100000, pointsMultiplier: 3, rewardPercent: 6, expiryMonths: 24, priority: 4, birthdayRewardPoints: 200, benefits: ['Earn 3x points', '6% extra reward', 'Complimentary meal on birthday', 'Dedicated host'], isDefault: false },
  ];

  const restaurantIds = new Set<string>();
  for (const c of customers) if (c.restaurantId) restaurantIds.add(c.restaurantId.toString());
  for (const r of restaurants) if (r._id) restaurantIds.add(r._id.toString());
  // Also add restaurant ids present in bills.
  for (const rc of restaurantCounts) if (rc._id) restaurantIds.add(rc._id.toString());

  for (const rid of restaurantIds) {
    const oid = new mongoose.Types.ObjectId(rid);
    const existingSettings = await loyaltySettingsCol.findOne({ restaurantId: oid });
    if (!existingSettings) {
      await loyaltySettingsCol.insertOne({ restaurantId: oid, ...DEFAULT_SETTINGS, createdAt: new Date(), updatedAt: new Date() });
    }
    const tierCount = await loyaltyTiersCol.countDocuments({ restaurantId: oid });
    if (tierCount === 0) {
      await loyaltyTiersCol.insertMany(
        DEFAULT_TIERS.map((t) => ({ restaurantId: oid, ...t, isActive: true, isDeleted: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }))
      );
    }
  }
  console.log(`[Migrate 1.6] Seeded loyalty settings/tiers for ${restaurantIds.size} restaurants`);

  // ─── 6. Backfill restaurantId on visits (from customer) ─────
  const visitsCol = db.collection('customervisits');
  const visits = await visitsCol.find({ $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] }).toArray();
  let visitsUpdated = 0;
  for (const v of visits) {
    const cust = v.customerId
      ? await customersCol.findOne({ _id: v.customerId })
      : null;
    if (cust?.restaurantId) {
      await visitsCol.updateOne({ _id: v._id }, { $set: { restaurantId: cust.restaurantId } });
      visitsUpdated++;
    }
  }
  console.log(`[Migrate 1.6] Backfilled restaurantId on ${visitsUpdated} visit records`);

  console.log('[Migrate 1.6] ✅ Complete — Phase 1.6 data migration finished.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Migrate 1.6] FAILED:', err);
  process.exit(1);
});
