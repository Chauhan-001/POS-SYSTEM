/** Cleanup script — drops employees, branches, and auditlogs collections for fresh first-time setup test */
import mongoose from 'mongoose';

async function run() {
  await mongoose.connect('mongodb://localhost:27017/pos-system', { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  const cols = await db.listCollections().toArray();
  const names = cols.map(c => c.name);
  console.log('Collections:', names.join(', ') || '(none)');
  for (const name of ['employees', 'branches', 'auditlogs']) {
    try { await db.collection(name).drop(); console.log('Dropped:', name); }
    catch (e: any) { if (e.codeName !== 'NamespaceNotFound') throw e; else console.log('Already clean:', name); }
  }
  console.log('Database clean ✅');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
