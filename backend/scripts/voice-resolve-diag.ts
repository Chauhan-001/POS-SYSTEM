/**
 * TEMP DIAGNOSTIC — verifies alias resolution with the OWNER's real
 * restaurantId (decoded from the live login JWT).
 * Run: node --import tsx scripts/voice-resolve-diag.ts
 */
import mongoose from 'mongoose';
import { resolveAlias } from '../src/modules/voice-inventory/services/AliasResolver';
import { resolveProduct } from '../src/modules/voice-inventory/services/ProductResolutionEngine';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pos');

  const login = await fetch('http://localhost:3002/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: '1008' }),
  });
  const j: any = await login.json();
  const token = j.accessToken || j.token || '';
  const payload: any = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const rid = payload.restaurantId || '';
  console.log('JWT user:', payload.name || payload.username, '| restaurantId:', rid);

  const db = mongoose.connection.db;
  const prods = await db
    .collection('products')
    .find({ isDeleted: { $ne: true } }, { projection: { name: 1, unit: 1, averageCost: 1, restaurantId: 1 } })
    .limit(30)
    .toArray();
  console.log('--- sample catalog for', rid.slice(-6), '---');
  prods.forEach((p: any) =>
    console.log(`  ${p.name} | unit:${p.unit} | avgCost:${p.averageCost} | rid:${String(p.restaurantId || 'GLOBAL').slice(-6)}`)
  );

  for (const name of ['Potato', 'Paneer', 'Flour', 'Coca Cola', 'aloo', 'paneer']) {
    const alias = await resolveAlias(rid, name);
    console.log(`ALIAS "${name}" =>`, JSON.stringify(alias));
  }
  const eng = await resolveProduct('Potato', rid, { skipSemantic: true, skipNewProductDetection: true });
  console.log('ENGINE Potato =>', JSON.stringify({ outcome: eng.outcome, conf: eng.confidence, product: eng.product }));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('DIAG ERROR:', e.message);
  process.exit(1);
});
