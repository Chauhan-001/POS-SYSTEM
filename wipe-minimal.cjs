/**
 * MINIMAL WIPE — clear ALL collection data; keep ONLY the admin dashboard user.
 *
 * Deletes EVERY document from EVERY MongoDB collection, then inserts exactly
 * one record: the admin dashboard user (userId=admin / password=1008).
 * Everything else is left empty. The backend's startup seed (seedDashboardAdmin)
 * re-applies the admin authorizations automatically on next boot.
 *
 * Run:  node wipe-minimal.cjs
 */

const mongoose = require('C:/Loyalty_POS system/backend/node_modules/mongoose');
const bcrypt = require('C:/Loyalty_POS system/backend/node_modules/bcrypt');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';

async function wipe() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('[WIPE] Connected');

    const collections = await mongoose.connection.db.listCollections().toArray();
    const names = collections.map((c) => c.name).filter((n) => !n.startsWith('system.'));
    console.log('[WIPE] Collections:', names.length);

    // 1. Delete ALL documents from EVERY collection
    for (const name of names) {
      await mongoose.connection.db.collection(name).deleteMany({});
    }
    console.log('[WIPE] All collection data cleared');

    // 2. Insert ONLY the admin dashboard user
    const users = mongoose.connection.db.collection('users');
    await users.insertOne({
      restaurantId: null,
      userId: 'admin',
      phone: '+1-555-000-0001',
      name: 'Admin',
      email: 'admin@pos.com',
      password: await bcrypt.hash('1008', 10),
      role: 'super_admin',
      status: 'active',
      branchIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('[WIPE] Admin user inserted (userId=admin / password=1008)');

    // Verify
    let total = 0;
    const nonEmpty = [];
    for (const name of names) {
      const c = await mongoose.connection.db.collection(name).countDocuments({});
      total += c;
      if (c > 0) nonEmpty.push(`${name}: ${c}`);
    }
    console.log('');
    console.log('[WIPE] === COMPLETE ===');
    console.log('[WIPE] Total documents remaining:', total);
    console.log('[WIPE] Non-empty collections:', nonEmpty.length ? nonEmpty.join(', ') : '(none)');
    console.log('[WIPE] Admin dashboard login: userId=admin / password=1008');
    console.log('[WIPE] Restart the backend server so seedDashboardAdmin re-applies admin permissions.');

  } catch (err) {
    console.error('[WIPE] ERROR:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('[WIPE] Disconnected');
  }
}

wipe();