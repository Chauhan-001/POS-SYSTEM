/**
 * 01-restaurant.ts — Creates "The Royal Bistro" restaurant + 3 branches.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, randomPhone } from './helpers';
import bcrypt from 'bcrypt';

export async function seedRestaurant(db: Db): Promise<SeedContext> {
  console.log('📍 Seeding restaurant & branches...');

  const rid = oid();
  const branch1Id = oid();
  const branch2Id = oid();
  const branch3Id = oid();
  const publicToken = 'pbl_' + Math.random().toString(36).slice(2, 18);
  const ownerPinHash = await bcrypt.hash('1234', 10);

  await db.collection('restaurants').insertOne({
    _id: rid,
    restaurantId: 'ROYAL_BISTRO',
    name: 'The Royal Bistro',
    brandName: 'The Royal Bistro',
    legalName: 'Royal Bistro Hospitality Pvt Ltd',
    restaurantType: 'Fine Dining',
    cuisineType: 'North Indian, Mughlai, Chinese',
    phone: '9876543210',
    altPhone: '9876543211',
    email: 'contact@royalbistro.in',
    website: 'https://royalbistro.in',
    description: 'Authentic North Indian cuisine with a modern twist. Family restaurant since 2019.',
    gst: '09AABCR1234F1Z5',
    fssai: '10019002000312',
    pan: 'AABCR1234F',
    businessRegNumber: 'UP-2019-0847',
    ownerName: 'Vikram Singh',
    ownerPhone: '9876543210',
    ownerEmail: 'vikram@royalbistro.in',
    address: '42, Hazratganj Main Road',
    area: 'Hazratganj',
    city: 'Lucknow',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    country: 'India',
    pinCode: '226001',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    gstEnabled: true,
    printerType: 'Thermal 80mm',
    receiptWidth: '80mm',
    taxMode: 'Inclusive',
    offlineMode: true,
    aiEnabled: true,
    loyaltyEnabled: true,
    weatherEnabled: true,
    maxDevices: 5,
    logoUrl: '/api/media/demo-restaurant-logo.jpg',
    isActive: true,
    ownerUserId: 'vksingh',
    ownerPin: ownerPinHash,
    publicToken,
    isDeleted: false,
    createdAt: daysAgo(180),
    updatedAt: new Date(),
  });

  // ─── Branches ──────────────────────────────────────────────────
  const branches = [
    {
      _id: branch1Id, name: 'Royal Bistro - Hazratganj', code: 'HZG',
      address: '42, Hazratganj Main Road', area: 'Hazratganj', city: 'Lucknow',
      state: 'Uttar Pradesh', pinCode: '226001', phone: '5224045001',
      openingHours: '08:00', closingHours: '23:30', isActive: true,
    },
    {
      _id: branch2Id, name: 'Royal Bistro - Civil Lines', code: 'CVL',
      address: '15, Civil Lines Station Road', area: 'Civil Lines', city: 'Lucknow',
      state: 'Uttar Pradesh', pinCode: '226001', phone: '5224045002',
      openingHours: '09:00', closingHours: '23:00', isActive: true,
    },
    {
      _id: branch3Id, name: 'Royal Bistro - Gomti Nagar', code: 'GMN',
      address: '78, Vibhuti Khand, Gomti Nagar', area: 'Gomti Nagar', city: 'Lucknow',
      state: 'Uttar Pradesh', pinCode: '226010', phone: '5224045003',
      openingHours: '09:00', closingHours: '23:30', isActive: true,
    },
  ];

  for (const b of branches) {
    await db.collection('branches').insertOne({
      ...b, restaurantId: rid, isDeleted: false, createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  // ─── Tables (20 per branch, varied capacities) ────────────────
  for (const [branchId, branchName] of [[branch1Id, 'HZG'], [branch2Id, 'CVL'], [branch3Id, 'GMN']]) {
    const tables: any[] = [];
    for (let i = 1; i <= 20; i++) {
      const capacity = i <= 8 ? 2 : i <= 14 ? 4 : i <= 18 ? 6 : 8;
      tables.push({
        _id: oid(),
        restaurantId: rid, branchId,
        number: i, capacity,
        status: i <= 3 ? 'occupied' : 'available',
        section: i <= 10 ? 'indoor' : 'outdoor',
        isActive: true, isDeleted: false,
        createdAt: daysAgo(180), updatedAt: new Date(),
      });
    }
    await db.collection('tables').insertMany(tables);
  }

  // ─── Floors ────────────────────────────────────────────────────
  for (const branchId of [branch1Id, branch2Id, branch3Id]) {
    await db.collection('floors').insertMany([
      { _id: oid(), restaurantId: rid, branchId, name: 'Ground Floor', sortOrder: 1, isDeleted: false, createdAt: daysAgo(180), updatedAt: new Date() },
      { _id: oid(), restaurantId: rid, branchId, name: 'First Floor', sortOrder: 2, isDeleted: false, createdAt: daysAgo(180), updatedAt: new Date() },
    ]);
  }

  console.log(`   ✅ Restaurant: The Royal Bistro (${rid})`);
  console.log(`   ✅ Branches: ${branches.length}`);

  return {
    restaurantId: rid,
    restaurantDocId: rid,
    branchIds: [branch1Id, branch2Id, branch3Id],
    branchNames: ['HZG', 'CVL', 'GMN'],
    ownerEmployeeId: oid(),
    managerEmployeeId: oid(),
    cashierEmployeeId: oid(),
    chefEmployeeId: oid(),
    waiterEmployeeIds: [oid(), oid(), oid()],
  };
}
