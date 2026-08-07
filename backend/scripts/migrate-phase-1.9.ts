/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1.9 Migration — Centralized POS Settings.
 *
 * Safe, idempotent migration that:
 *  1. Backfills restaurantId on legacy BranchSettings docs (tenant isolation fix).
 *  2. Backfills restaurantId on legacy AuditLog entries where determinable from
 *     the performedById → User lookup (best effort; skips when unknown).
 *  3. Seeds an empty restaurant-scope RestaurantSettings doc for every
 *     restaurant (so the priority chain always resolves without client setup).
 *  4. Ensures the indexes for RestaurantSettings + Printer exist.
 *
 * Usage:  npx tsx scripts/migrate-phase-1.9.ts
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import Branch from '../src/models/Branch';
import BranchSettings from '../src/models/BranchSettings';
import Restaurant from '../src/models/Restaurant';
import User from '../src/models/User';
import AuditLog from '../src/models/AuditLog';
import RestaurantSettings from '../src/modules/settings/models/RestaurantSettings';
import Printer from '../src/modules/settings/models/Printer';

async function ensureIndexes(): Promise<void> {
  const tasks: Array<{ model: mongoose.Model<any>; spec: Record<string, 1 | -1>; name: string }> = [
    { model: RestaurantSettings, spec: { restaurantId: 1, scope: 1, settingsVersion: -1 }, name: 'restaurantsettings_tenant_scope' },
    { model: Printer, spec: { restaurantId: 1, name: 1 }, name: 'printer_tenant_name' },
    { model: Printer, spec: { restaurantId: 1, type: 1, enabled: 1 }, name: 'printer_tenant_type' },
    { model: AuditLog, spec: { restaurantId: 1, entityType: 1, createdAt: -1 }, name: 'auditlog_tenant_entity' },
    { model: BranchSettings, spec: { restaurantId: 1 }, name: 'branchsettings_tenant' },
  ];
  for (const t of tasks) {
    const existing = await t.model.collection.indexes();
    const has = existing.some((i: any) => i.name === t.name);
    if (has) { console.log(`[migrate-1.9] index exists: ${t.name}`); continue; }
    await t.model.collection.createIndex(t.spec, { name: t.name });
    console.log(`[migrate-1.9] created index: ${t.name}`);
  }
}

async function backfillBranchSettings(): Promise<void> {
  const unassigned = await BranchSettings.countDocuments({ $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] });
  if (unassigned === 0) {
    console.log('[migrate-1.9] BranchSettings already tenant-assigned');
    return;
  }
  const branches = await Branch.find({}).select('_id restaurantId').lean().exec();
  const byId = new Map(branches.map((b: any) => [String(b._id), b.restaurantId]));
  let assigned = 0;
  const docs = await BranchSettings.find({ $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] }).exec();
  for (const doc of docs) {
    const restaurantId = byId.get(String(doc.branchId));
    if (restaurantId) {
      doc.restaurantId = restaurantId;
      await doc.save();
      assigned++;
    }
  }
  console.log(`[migrate-1.9] assigned restaurantId to ${assigned}/${docs.length} BranchSettings docs`);
}

async function backfillAuditRestaurantId(): Promise<void> {
  const unassigned = await AuditLog.countDocuments({ restaurantId: { $exists: false } });
  if (unassigned === 0) {
    console.log('[migrate-1.9] AuditLog already tenant-assigned');
    return;
  }
  const users = await User.find({ restaurantId: { $exists: true, $ne: null } }).select('_id restaurantId').lean().exec();
  const byId = new Map(users.map((u: any) => [String(u._id), u.restaurantId]));
  let assigned = 0;
  let processed = 0;
  const BATCH = 5000;
  for (;;) {
    const docs = await AuditLog.find({ restaurantId: { $exists: false } }).limit(BATCH).exec();
    if (docs.length === 0) break;
    processed += docs.length;
    for (const doc of docs) {
      const restaurantId = doc.performedById ? byId.get(String(doc.performedById)) : undefined;
      if (restaurantId) {
        doc.restaurantId = restaurantId;
        await doc.save();
        assigned++;
      }
    }
    console.log(`[migrate-1.9] audit backfill batch: ${processed} processed, ${assigned} assigned`);
  }
  console.log(`[migrate-1.9] backfilled restaurantId on ${assigned}/${processed} AuditLog docs`);
}

async function seedRestaurantSettings(): Promise<void> {
  const restaurants = await Restaurant.find({}).select('_id').lean().exec();
  let created = 0;
  for (const r of restaurants) {
    const existing = await RestaurantSettings.findOne({ restaurantId: r._id, scope: 'restaurant' }).exec();
    if (!existing) {
      await RestaurantSettings.create({
        restaurantId: r._id,
        scope: 'restaurant',
        settingsVersion: 1,
        settings: {},
        history: [],
        updatedBy: 'migration-1.9',
      });
      created++;
    }
  }
  console.log(`[migrate-1.9] seeded ${created} restaurant-scope settings docs (${restaurants.length} restaurants)`);
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  console.log(`[migrate-1.9] connected (${mongoose.connection.name})`);
  await ensureIndexes();
  await backfillBranchSettings();
  await backfillAuditRestaurantId();
  await seedRestaurantSettings();
  await mongoose.disconnect();
  console.log('[migrate-1.9] done ✔');
}

main().catch((err) => {
  console.error('[migrate-1.9] FAILED:', err);
  process.exit(1);
});
