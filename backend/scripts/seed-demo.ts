#!/usr/bin/env npx tsx
/**
 * seed-demo.ts — Complete production-like restaurant demo environment.
 *
 * Creates "The Royal Bistro" with 3 branches, 60+ menu items, 300+ customers,
 * 800+ bills, 200+ purchases, 100+ reservations, 400+ feedback records,
 * offers, campaigns, inventory, recipes, and full settings.
 *
 * Usage (from backend/):
 *   npx tsx scripts/seed-demo.ts                 # full seed (idempotent)
 *   npx tsx scripts/seed-demo.ts --reset         # wipe + full reseed
 *   npx tsx scripts/seed-demo.ts --clean          # wipe demo data only
 *   npx tsx scripts/seed-demo.ts --report         # just report existing data
 *
 * Safety: BLOCKED when NODE_ENV=production unless DEMO_SEED=true is set.
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import { seedRestaurant } from './seed/01-restaurant';
import { seedTeam } from './seed/02-team';
import { seedSuppliers } from './seed/03-suppliers';
import { seedProducts } from './seed/04-products';
import { seedInventory } from './seed/05-inventory';
import { seedRecipes } from './seed/06-recipes';
import { seedPurchases } from './seed/07-purchases';
import { seedCustomers } from './seed/08-customers';
import { seedBills } from './seed/09-bills';
import { seedOffers } from './seed/10-offers';
import { seedCampaigns } from './seed/11-campaigns';
import { seedReservations } from './seed/12-reservations';
import { seedFeedback } from './seed/13-feedback';
import { seedWastage } from './seed/14-wastage';
import { seedSettings } from './seed/15-settings';
import { seedAuditLogs } from './seed/16-audit';
import { generateReport } from './seed/report';

// ─── Safety boundary ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED !== 'true') {
  console.error('❌ BLOCKED: Cannot seed demo data in production. Set DEMO_SEED=true to override.');
  process.exit(1);
}

const MONGO_URI = process.env.MONGODB_URI || config.mongoUri;
const isReset = process.argv.includes('--reset');
const isClean = process.argv.includes('--clean');
const isReport = process.argv.includes('--report');

async function run() {
  console.log('🏪 Royal Bistro Demo Seed');
  console.log('━'.repeat(50));
  console.log(`📍 MongoDB: ${MONGO_URI}`);
  console.log(`🔧 Mode: ${isReset ? 'RESET (wipe + reseed)' : isClean ? 'CLEAN (wipe only)' : isReport ? 'REPORT' : 'SEED (idempotent)'}`);
  console.log('━'.repeat(50));

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB\n');

  const db = mongoose.connection.db!;

  if (isClean || isReset) {
    console.log('🗑️  Cleaning demo data...');
    // Find ALL demo restaurants (previous seeds may have used different ObjectIds)
    const demoRestaurants = await db.collection('restaurants').find({ restaurantId: 'ROYAL_BISTRO' }).toArray();
    const rids = demoRestaurants.map((r: any) => r._id);

    if (rids.length > 0) {
      const colls = await db.listCollections().toArray();
      for (const c of colls) {
        try {
          await db.collection(c.name).deleteMany({ restaurantId: { $in: rids } });
        } catch { /* collection may not have restaurantId */ }
      }
    }

    // Also wipe any orphaned demo data from previous broken seeds
    const demoUserIds = ['vksingh', 'psharma', 'rverma', 'achef', 'akumar', 'sdevi', 'rchef', 'ngupta', 'dyadav', 'mchef'];
    await db.collection('employees').deleteMany({ userId: { $in: demoUserIds } });
    await db.collection('users').deleteMany({ userId: { $in: demoUserIds } });
    await db.collection('restaurants').deleteMany({ name: 'The Royal Bistro' });
    await db.collection('branches').deleteMany({ name: { $regex: /^Royal Bistro/ } });

    // Safety net: in RESET mode, wipe ALL employees/users so null-username
    // orphans from previous broken seeds cannot collide with the unique index.
    await db.collection('employees').deleteMany({});
    await db.collection('users').deleteMany({});
    console.log('✅ Demo data cleaned\n');

    if (isClean) {
      await mongoose.disconnect();
      console.log('✅ Done — clean complete.');
      return;
    }
  }

  if (isReport) {
    await generateReport(db);
    await mongoose.disconnect();
    return;
  }

  const startTime = Date.now();

  // ─── Seed in dependency order ─────────────────────────────────
  const ctx = await seedRestaurant(db);
  await seedTeam(db, ctx);
  await seedSettings(db, ctx);
  await seedSuppliers(db, ctx);
  const productsCtx = await seedProducts(db, ctx);
  await seedInventory(db, ctx, productsCtx);
  await seedRecipes(db, ctx, productsCtx);
  await seedPurchases(db, ctx, productsCtx);
  const customersCtx = await seedCustomers(db, ctx);
  await seedBills(db, ctx, productsCtx, customersCtx);
  await seedOffers(db, ctx, productsCtx);
  await seedCampaigns(db, ctx);
  await seedReservations(db, ctx);
  await seedFeedback(db, ctx, customersCtx);
  await seedWastage(db, ctx, productsCtx);
  await seedAuditLogs(db, ctx);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '━'.repeat(50));
  console.log(`⏱️  Seed completed in ${elapsed}s`);
  console.log('━'.repeat(50));

  await generateReport(db);

  await mongoose.disconnect();
  console.log('\n✅ Done — demo environment ready.');
}

run().catch((err) => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});
