/**
 * report.ts — Generates a comprehensive report of the seeded data.
 */
import { Db } from 'mongodb';

const COLLECTIONS_TO_REPORT = [
  'restaurants', 'branches', 'users', 'employees', 'tables', 'floors',
  'products', 'productvariants', 'suppliers', 'purchases',
  'customers', 'bills', 'billitems', 'orders', 'orderitems',
  'offers', 'campaigns', 'promotions',
  'reservations', 'receiptfeedbacks', 'inventoryevents',
  'recipes', 'rewards', 'loyaltysettings', 'loyaltytiers',
  'restaurantssettings', 'financesettings', 'expensecategories',
  'printers', 'auditlogs', 'costsettings',
  'subscriptions', 'subscriptionplans', 'customersegments',
  'loyaltytransactions', 'expenses', 'payments',
  'cashledgers', 'referrals', 'couponredemptions',
  'heldorders', 'takeawayorders', 'waitingentries',
  'kotrecords', 'invoices', 'daily summaries', 'monthlysummaries',
  'marketing automations', 'support tickets',
  'devices', 'deviceactivities', 'timelineevents',
  'item aliases', 'qr tokens', 'qr ordering sessions',
  'advisor recommendations', 'ai usagelogs',
];

export async function generateReport(db: Db): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SEED DATA REPORT');
  console.log('═'.repeat(60));

  let totalRecords = 0;
  const results: { name: string; count: number }[] = [];

  // Get all collection names that exist
  const existingColls = await db.listCollections().toArray();
  const existingNames = new Set(existingColls.map(c => c.name));

  for (const collName of COLLECTIONS_TO_REPORT) {
    if (!existingNames.has(collName)) continue;
    try {
      const count = await db.collection(collName).countDocuments();
      results.push({ name: collName, count });
      totalRecords += count;
    } catch {
      results.push({ name: collName, count: 0 });
    }
  }

  // Print table
  console.log('');
  console.log(`${'Collection'.padEnd(30)} ${'Count'.padStart(8)}`);
  console.log('─'.repeat(40));
  for (const r of results.filter(r => r.count > 0)) {
    console.log(`${r.name.padEnd(30)} ${String(r.count).padStart(8)}`);
  }
  console.log('─'.repeat(40));
  console.log(`${'TOTAL'.padEnd(30)} ${String(totalRecords).padStart(8)}`);

  // Check for empty critical collections
  console.log('\n📋 EMPTY COLLECTION CHECK:');
  const criticalEmpty = results.filter(r => r.count === 0 && ['products', 'customers', 'bills', 'offers', 'reservations'].includes(r.name));
  if (criticalEmpty.length > 0) {
    for (const r of criticalEmpty) {
      console.log(`   ⚠️  ${r.name} is empty (critical)`);
    }
  } else {
    console.log('   ✅ All critical collections have data');
  }

  // Verify restaurant exists
  const restaurant = await db.collection('restaurants').findOne({ restaurantId: 'ROYAL_BISTRO' });
  if (restaurant) {
    console.log('\n🏪 DEMO RESTAURANT:');
    console.log(`   Name: ${restaurant.name || restaurant.brandName}`);
    console.log(`   Restaurant ID: ${restaurant.restaurantId}`);
    console.log(`   Owner: ${restaurant.ownerName}`);
    console.log(`   Phone: ${restaurant.phone}`);
    console.log(`   GSTIN: ${restaurant.gst}`);
    console.log(`   City: ${restaurant.city}, ${restaurant.state}`);
    console.log(`   Public Token: ${restaurant.publicToken}`);
  }

  // Branch count
  const branchCount = await db.collection('branches').countDocuments({ restaurantId: restaurant?._id });
  console.log(`\n🏢 BRANCHES: ${branchCount}`);

  // Employee count by role
  const employees = await db.collection('employees').aggregate([
    { $match: { restaurantId: restaurant?._id } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]).toArray();
  console.log('\n👥 TEAM:');
  for (const e of employees) {
    console.log(`   ${e._id}: ${e.count}`);
  }

  // Bill stats
  const billStats = await db.collection('bills').aggregate([
    { $match: { restaurantId: restaurant?._id } },
    { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 }, avg: { $avg: '$grandTotal' } } },
  ]).toArray();
  if (billStats[0]) {
    console.log('\n💰 BILLING:');
    console.log(`   Total bills: ${billStats[0].count}`);
    console.log(`   Total revenue: ₹${Math.round(billStats[0].total).toLocaleString('en-IN')}`);
    console.log(`   Average bill: ₹${Math.round(billStats[0].avg)}`);
  }

  // Customer stats
  const custStats = await db.collection('customers').aggregate([
    { $match: { restaurantId: restaurant?._id } },
    { $group: { _id: null, total: { $sum: 1 }, avgSpend: { $avg: '$totalSpend' }, avgVisits: { $avg: '$visits' } } },
  ]).toArray();
  if (custStats[0]) {
    console.log('\n👤 CUSTOMERS:');
    console.log(`   Total: ${custStats[0].total}`);
    console.log(`   Average spend: ₹${Math.round(custStats[0].avgSpend)}`);
    console.log(`   Average visits: ${Math.round(custStats[0].avgVisits)}`);
  }

  // Offer stats
  const offerStats = await db.collection('offers').aggregate([
    { $match: { restaurantId: restaurant?._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).toArray();
  console.log('\n🏷️  OFFERS:');
  for (const o of offerStats) {
    console.log(`   ${o._id}: ${o.count}`);
  }

  // Feedback stats
  const feedbackStats = await db.collection('receiptfeedbacks').aggregate([
    { $match: { restaurantId: restaurant?._id } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]).toArray();
  console.log('\n💬 FEEDBACK:');
  for (const f of feedbackStats) {
    console.log(`   ${f._id}★: ${f.count}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Report complete');
  console.log('═'.repeat(60));
}
