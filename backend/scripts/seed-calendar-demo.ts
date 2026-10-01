/**
 * Seed: Context Calendar — DEVELOPMENT/DEMO data only (Phase 1, spec §19).
 *
 * Explicitly opt-in: run `npm run seed:calendar` from backend/. Never invoked
 * by the app at boot; production databases get NO fake events automatically.
 * Every seeded event is tagged 'demo' and source='admin' so cleanup via
 * --clean (removes exactly the demo-tagged set) is deterministic.
 *
 * Usage:
 *   npx tsx scripts/seed-calendar-demo.ts            # insert demo events
 *   npx tsx scripts/seed-calendar-demo.ts --clean    # remove demo events
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant-pos';

// Deterministic "current year + 1" dates keep the seed useful in any year.
function dateOf(month: number, day: number, offsetYears = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() + offsetYears, month - 1, day));
}

const DEMO_TAG = 'demo';

const DEMO_EVENTS = [
  {
    name: 'Diwali', type: 'festival', scope: 'india', country: 'India',
    startDate: dateOf(10, 20), endDate: dateOf(10, 24),
    description: 'Festival of lights — sweets, family gatherings, gifting.',
    tags: ['sweets', 'family', 'gifting', DEMO_TAG], marketingRelevance: 'high', preparationWindowDays: 14,
  },
  {
    name: 'Holi', type: 'festival', scope: 'india', country: 'India',
    startDate: dateOf(3, 14), endDate: dateOf(3, 14),
    description: 'Festival of colours — thandai, street food, group celebrations.',
    tags: ['colours', 'street-food', DEMO_TAG], marketingRelevance: 'high', preparationWindowDays: 10,
  },
  {
    name: 'Independence Day', type: 'national_event', scope: 'india', country: 'India',
    startDate: dateOf(8, 15), endDate: dateOf(8, 15),
    description: 'Indian Independence Day — tricolor themed specials.',
    tags: ['national', 'patriotic', DEMO_TAG], marketingRelevance: 'medium', preparationWindowDays: 5,
  },
  {
    name: 'Janmashtami', type: 'festival', scope: 'india', country: 'India',
    startDate: dateOf(8, 19), endDate: dateOf(8, 19),
    description: 'Krishna Janmashtami — fasting-friendly menu, midnight specials.',
    tags: ['fasting', 'traditional', DEMO_TAG], marketingRelevance: 'high', preparationWindowDays: 7,
  },
  {
    name: 'Dehradun Food Festival', type: 'local_event', scope: 'city', country: 'India',
    state: 'Uttarakhand', city: 'Dehradun',
    startDate: dateOf(11, 25), endDate: dateOf(11, 28),
    description: 'Annual local food festival — high footfall weekend.',
    tags: ['local', 'food-festival', DEMO_TAG], marketingRelevance: 'high', preparationWindowDays: 21,
  },
];

async function run() {
  const clean = process.argv.includes('--clean');
  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.db!.collection('calendarevents');

  if (clean) {
    const res = await col.deleteMany({ tags: DEMO_TAG });
    console.log(`🧹 Removed ${res.deletedCount} demo calendar event(s).`);
    await mongoose.disconnect();
    return;
  }

  const existing = await col.countDocuments({ tags: DEMO_TAG });
  if (existing > 0) {
    console.log(`ℹ️  ${existing} demo event(s) already present — nothing inserted (idempotent).`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const docs = DEMO_EVENTS.map((e) => ({ ...e, status: 'active', source: 'admin', createdAt: now, updatedAt: now }));
  const res = await col.insertMany(docs);
  console.log(`✅ Seeded ${res.length} DEMO calendar events (tagged '${DEMO_TAG}').`);
  console.log('   These are development/demo fixtures — production data is never faked.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
