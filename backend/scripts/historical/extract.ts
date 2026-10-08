/**
 * =============================================================================
 * extract.ts — HISTORICAL FOUNDATION, PHASE 4 (READ-ONLY EXTRACTION)
 * =============================================================================
 *
 * Streams the transaction history into CANONICAL HistoricalFacts (Phase 1
 * contract) and reports coverage — WITHOUT writing anything.
 *
 * Modes / options:
 *   npx tsx scripts/historical/extract.ts                         # all tenants, summary
 *   npx tsx scripts/historical/extract.ts --tenant <id>           # one tenant
 *   npx tsx scripts/historical/extract.ts --sample 5              # print N sample facts
 *   npx tsx scripts/historical/extract.ts --out extract.json      # durable JSON report
 *
 * SAFETY: read-only. Only find()/distinct() reads. No insert/update/delete.
 * Memory: bounded to ONE tenant's bills at a time (the largest tenant is ~20k
 * rows). Business dates honour the restaurant timezone, never a UTC slice.
 */

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';

import {
  businessDateOfBill,
  deriveDailySalesFacts,
  missingBusinessDays,
  type BillLike,
} from '../../src/modules/historical-foundation/derive';
import type { HistoricalFact } from '../../src/modules/historical-foundation/dataContract';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const ARGS = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = ARGS.indexOf(name);
  return i >= 0 ? ARGS[i + 1] ?? null : null;
};
const onlyTenant = arg('--tenant');
const outPath = arg('--out');
const sampleN = Number(arg('--sample') ?? '0');
const DATASET_VERSION = 'hist-v1';
const RUN_ID = `extract-${new Date().toISOString()}`;

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');

  // Timezone map (Phase 3): resolve once, never from a client field.
  const tzMap = new Map<string, string>();
  for (const r of await db.collection('restaurants').find({}, { projection: { timezone: 1 } }).toArray()) {
    tzMap.set(String(r._id), typeof r.timezone === 'string' && r.timezone ? r.timezone : 'UTC');
  }

  const tenantIds: string[] = onlyTenant
    ? [onlyTenant]
    : (await db.collection('bills').distinct('restaurantId')).map(String).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    datasetVersion: DATASET_VERSION,
    runId: RUN_ID,
    tenants: [] as Array<Record<string, unknown>>,
  };
  let allFacts: HistoricalFact<number>[] = [];

  for (const tenant of tenantIds) {
    const timezone = tzMap.get(tenant) ?? 'UTC';
    const bills = (await db
      .collection('bills')
      .find(
        { restaurantId: new mongoose.Types.ObjectId(tenant) },
        { projection: { restaurantId: 1, branchId: 1, date: 1, createdAt: 1, grandTotal: 1, subtotal: 1, discount: 1, gst: 1, isVoided: 1 } },
      )
      .toArray()) as unknown as BillLike[];

    const facts = deriveDailySalesFacts(bills, {
      restaurantId: tenant,
      datasetVersion: DATASET_VERSION,
      runId: RUN_ID,
      timezone,
    });
    allFacts = allFacts.concat(facts);

    const dates = [...new Set(bills.map((b) => businessDateOfBill(b, timezone)).filter(Boolean))] as string[];
    dates.sort();
    const from = dates[0] ?? null;
    const to = dates[dates.length - 1] ?? null;
    const missing = from && to ? missingBusinessDays(facts, from, to) : [];
    const revenueFacts = facts.filter((f) => f.metric === 'sales.grossRevenue');
    const totalRevenue = round2(revenueFacts.reduce((a, f) => a + (f.value ?? 0), 0));
    const branches = [...new Set(bills.map((b) => (b.branchId ? String(b.branchId) : 'null')))];

    report.tenants.push({
      tenant,
      timezone,
      bills: bills.length,
      branches: branches.length,
      businessDates: dates.length,
      range: { from, to },
      missingDays: missing.length,
      missingRanges: compress(missing),
      facts: facts.length,
      totalRevenue,
      status: 'OBSERVED',
    });
  }

  const summary = {
    ...report,
    totalFacts: allFacts.length,
    totalTenants: report.tenants.length,
    tenantCoverage: report.tenants.map((t) => ({ tenant: t.tenant, dates: t.businessDates, from: (t.range as any).from, to: (t.range as any).to })),
    sampleFacts: sampleN > 0 ? allFacts.slice(0, sampleN) : undefined,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
  await mongoose.disconnect();
  console.log(`\n[writes=0] extracted ${allFacts.length} canonical facts across ${report.tenants.length} tenant(s)`);
}

function compress(days: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start: string | null = null;
  let end: string | null = null;
  let prev = 0;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (start === null || end === null) {
      start = d;
      end = d;
    } else if (t - prev === 86_400_000) {
      end = d;
    } else {
      out.push([start, end]);
      start = d;
      end = d;
    }
    prev = t;
  }
  if (start !== null && end !== null) out.push([start, end]);
  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

main().catch((e) => {
  console.error('extract failed:', e);
  process.exit(1);
});
