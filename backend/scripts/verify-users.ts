/**
 * verify-users.ts — Check that the users collection still has data intact.
 * Run after clear-db-except-users.ts to verify users are preserved.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';

async function run() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // Count users
  const userCount = await db.collection('users').countDocuments();
  console.log(`👤 Users collection: ${userCount} document(s)`);

  if (userCount > 0) {
    // Show a summary of the users (without passwords)
    const users = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .toArray();
    console.log('\n📋 User list:');
    users.forEach((u: any) => {
      console.log(`   - ${u.name || '(no name)'} (${u.userId || u.email || '(no ID)'}) — role: ${u.role}`);
    });
  }

  // Verify other collections are empty
  const cols = await db.listCollections().toArray();
  const nonUsers = cols.filter(c => c.name !== 'users');
  let allEmpty = true;
  for (const col of nonUsers) {
    const count = await db.collection(col.name).countDocuments();
    if (count > 0) {
      console.log(`⚠️  ${col.name}: ${count} documents (should be empty!)`);
      allEmpty = false;
    }
  }

  if (allEmpty && nonUsers.length > 0) {
    console.log(`\n✅ All ${nonUsers.length} non-user collections are empty — cleanup successful.`);
  } else if (nonUsers.length === 0) {
    console.log('\n⚠️  No non-user collections exist.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('💥 Error:', err);
  process.exit(1);
});
