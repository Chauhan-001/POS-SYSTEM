#!/usr/bin/env node
// Restore-verification helper for the MongoDB restore drill.
//
// Connects to the given database, asserts the business-critical collections
// exist, and prints their document counts. Exits non-zero if the connection
// fails or any expected collection is missing.
//
// Usage:
//   node scripts/verify-restore-counts.mjs <uri> <db> [--drop] [--expect a,b,c]
//
//   --drop     drop the database after verification (used for scratch DBs so
//              a drill never leaves test data behind)
//   --expect   comma-separated collection list (defaults to the core POS set)
//
// Requires: the mongodb driver (available transitively via mongoose).
import { MongoClient } from 'mongodb';

const DEFAULT_EXPECTED = [
  'restaurants',
  'branches',
  'users',
  'products',
  'customers',
  'bills',
  'payments',
  'orders',
  'inventoryevents',
  'offers',
];

function fail(msg) {
  console.error(`[verify] FAIL: ${msg}`);
  process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node verify-restore-counts.mjs <uri> <db> [--drop] [--expect a,b,c]');
  process.exit(1);
}
const [uri, dbName] = args;
const drop = args.includes('--drop');
const expectIdx = args.indexOf('--expect');
const expected =
  expectIdx !== -1 && args[expectIdx + 1]
    ? args[expectIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_EXPECTED;

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
});

let ok = true;
try {
  await client.connect();
  const db = client.db(dbName);
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  console.log(`[verify] db: ${dbName} — verifying ${expected.length} collections`);
  const rows = [];
  for (const name of expected) {
    if (existing.has(name)) {
      const count = await db.collection(name).countDocuments({}, { maxTimeMS: 30000 });
      rows.push([name, count]);
    } else {
      rows.push([name, 'MISSING']);
      ok = false;
    }
  }
  for (const [name, count] of rows) {
    console.log(`  ${name.padEnd(20)} ${count}`);
  }

  if (drop) {
    await db.dropDatabase();
    console.log('[verify] scratch database dropped');
  }
} catch (err) {
  fail(err.message);
} finally {
  await client.close().catch(() => {});
}

if (ok) {
  console.log('[verify] PASS — all expected collections present');
} else {
  fail('one or more expected collections missing');
}
process.exit(process.exitCode || (ok ? 0 : 1));
