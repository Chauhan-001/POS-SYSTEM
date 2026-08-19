/**
 * 12-reservations.ts — Creates 120 reservations: past, today, and upcoming.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, rand, pick, randomPhone } from './helpers';

export async function seedReservations(db: Db, ctx: SeedContext): Promise<void> {
  console.log('📅 Seeding reservations...');
  const rid = ctx.restaurantId;

  const FIRST_NAMES = ['Aarav','Priya','Rohan','Ananya','Vikram','Neha','Amit','Sunita','Rahul','Kavita','Deepak','Pooja','Suresh','Rekha','Manoj','Geeta'];
  const LAST_NAMES = ['Sharma','Verma','Gupta','Singh','Kumar','Yadav','Mishra','Mehta','Patel','Reddy'];
  const TIMES = ['12:00', '12:30', '13:00', '13:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
  const STATUSES = ['confirmed', 'confirmed', 'confirmed', 'completed', 'completed', 'cancelled', 'no_show'];
  const SPECIAL_REQUESTS = ['Window seat please', 'Birthday celebration', 'Quiet corner', 'Family with kids', 'Anniversary dinner', 'Business lunch', 'Near AC', 'Ground floor', 'No spicy food', ''];

  const tables = await db.collection('tables').find({ restaurantId: rid }).toArray();
  let count = 0;

  // Past reservations (90 days ago to yesterday)
  for (let day = 90; day >= 1; day--) {
    const d = daysAgo(day);
    const numRes = day <= 7 ? rand(2, 4) : rand(1, 3);
    for (let i = 0; i < numRes; i++) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const partySize = pick([2, 2, 4, 4, 4, 6, 6, 8]);
      const table = pick(tables.filter((t: any) => t.capacity >= partySize)) || pick(tables);
      const status = rand(0, 100) < 75 ? 'completed' : rand(0, 100) < 50 ? 'cancelled' : 'no_show';
      const dObj = new Date(d);
      dObj.setHours(rand(12, 21), rand(0, 1) * 30);

      await db.collection('reservations').insertOne({
        _id: oid(), restaurantId: rid, branchId: pick(ctx.branchIds),
        customerName: name, customerPhone: randomPhone(),
        partySize, date: d, time: pick(TIMES),
        tableId: table?._id, tableNumber: table?.number,
        status, specialRequest: pick(SPECIAL_REQUESTS),
        createdAt: daysAgo(day + rand(1, 5)), updatedAt: dObj,
      });
      count++;
    }
  }

  // Today's reservations
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const partySize = pick([2, 4, 4, 6]);
    const table = pick(tables.filter((t: any) => t.capacity >= partySize)) || pick(tables);

    await db.collection('reservations').insertOne({
      _id: oid(), restaurantId: rid, branchId: pick(ctx.branchIds),
      customerName: name, customerPhone: randomPhone(),
      partySize, date: today.toISOString().slice(0, 10), time: pick(TIMES),
      tableId: table?._id, tableNumber: table?.number,
      status: i < 3 ? 'confirmed' : 'pending',
      specialRequest: pick(SPECIAL_REQUESTS),
      createdAt: daysAgo(1), updatedAt: new Date(),
    });
    count++;
  }

  // Future reservations (next 30 days)
  for (let day = 1; day <= 30; day++) {
    const d = daysAgo(-day);
    const numRes = rand(1, 3);
    for (let i = 0; i < numRes; i++) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const partySize = pick([2, 4, 4, 6, 8]);
      const table = pick(tables.filter((t: any) => t.capacity >= partySize)) || pick(tables);

      await db.collection('reservations').insertOne({
        _id: oid(), restaurantId: rid, branchId: pick(ctx.branchIds),
        customerName: name, customerPhone: randomPhone(),
        partySize, date: d.toISOString().slice(0, 10), time: pick(TIMES),
        tableId: table?._id, tableNumber: table?.number,
        status: 'confirmed', specialRequest: pick(SPECIAL_REQUESTS),
        createdAt: daysAgo(rand(1, 10)), updatedAt: new Date(),
      });
      count++;
    }
  }

  console.log(`   ✅ Reservations: ${count}`);
}
