// Quick diagnostic: list auth accounts that exist in MongoDB (passwords NOT shown).
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect('mongodb://localhost:27017/pos');
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({}, { projection: { userId: 1, role: 1, name: 1, status: 1, restaurantId: 1 } }).toArray();
  console.log('=== USERS (dashboard logins) ===');
  for (const u of users) console.log(`  userId=${u.userId} role=${u.role} name=${u.name} status=${u.status} rest=${u.restaurantId}`);

  const emps = await db.collection('employees').find({}, { projection: { username: 1, name: 1, role: 1, restaurantId: 1 } }).toArray();
  console.log('=== EMPLOYEES (POS logins, PIN-based) ===');
  for (const e of emps) console.log(`  username=${e.username} name=${e.name} role=${e.role} rest=${e.restaurantId}`);

  const rests = await db.collection('restaurants').find({}, { projection: { restaurantId: 1, name: 1, ownerUserId: 1 } }).toArray();
  console.log('=== RESTAURANTS ===');
  for (const r of rests) console.log(`  id=${r.restaurantId} name=${r.name} ownerUserId=${r.ownerUserId}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
