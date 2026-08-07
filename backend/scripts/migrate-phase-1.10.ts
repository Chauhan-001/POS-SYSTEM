/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1.10 Migration — End-to-End Validation.
 *
 * Safe, idempotent migration that:
 *  1. Ensures the unique sparse compound index { restaurantId, clientRef } on
 *     the Bill collection — the offline-replay idempotency key. Existing
 *     bills without clientRef are untouched (sparse), so this never fails on
 *     historical data.
 *  2. Ensures the mutation-audit compound index on AuditLog
 *     { restaurantId, action, createdAt } used by the request-logger's
 *     audit trail lookups.
 *
 * Usage:  npx tsx scripts/migrate-phase-1.10.ts
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import Bill from '../src/models/Bill';
import AuditLog from '../src/models/AuditLog';

async function ensureIndexes(): Promise<void> {
  const tasks: Array<{ model: mongoose.Model<any>; spec: Record<string, 1 | -1>; name: string; options?: Record<string, any> }> = [
    {
      model: Bill,
      spec: { restaurantId: 1, clientRef: 1 },
      name: 'bill_tenant_clientref',
      options: { unique: true, sparse: true },
    },
    {
      model: AuditLog,
      spec: { restaurantId: 1, action: 1, createdAt: -1 },
      name: 'auditlog_tenant_action',
    },
  ];
  for (const t of tasks) {
    const existing = await t.model.collection.indexes();
    const has = existing.some((i: any) => i.name === t.name);
    if (has) { console.log(`[migrate-1.10] index exists: ${t.name}`); continue; }
    await t.model.collection.createIndex(t.spec, { name: t.name, ...(t.options || {}) });
    console.log(`[migrate-1.10] created index: ${t.name}`);
  }
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  console.log(`[migrate-1.10] connected (${mongoose.connection.name})`);
  await ensureIndexes();
  await mongoose.disconnect();
  console.log('[migrate-1.10] done ✔');
}

main().catch((err) => {
  console.error('[migrate-1.10] FAILED:', err);
  process.exit(1);
});
