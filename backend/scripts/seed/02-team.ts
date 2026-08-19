/**
 * 02-team.ts — Creates staff across all roles and branches.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, pick } from './helpers';
import bcrypt from 'bcrypt';

export async function seedTeam(db: Db, ctx: SeedContext): Promise<void> {
  console.log('👥 Seeding team...');

  // Safety: wipe ALL employees/users so orphaned records with null usernames
  // (from previous broken seeds or middleware side-effects) cannot collide
  // with the unique index on username.
  await db.collection('employees').deleteMany({});
  await db.collection('users').deleteMany({});

  // PIN '1234' — bcrypt-hashed for both employee.pin and user.password
  const pinHash = await bcrypt.hash('1234', 10);
  const rid = ctx.restaurantId;

  const roles = [
    { name: 'Vikram Singh', role: 'Owner', userId: 'vksingh', phone: '9876543210', branchIdx: -1, empId: ctx.ownerEmployeeId },
    { name: 'Priya Sharma', role: 'Manager', userId: 'psharma', phone: '9876543220', branchIdx: 0, empId: ctx.managerEmployeeId },
    { name: 'Rahul Verma', role: 'Cashier', userId: 'rverma', phone: '9876543230', branchIdx: 0, empId: ctx.cashierEmployeeId },
    { name: 'Chef Arjun', role: 'Chef', userId: 'achef', phone: '9876543240', branchIdx: 0, empId: ctx.chefEmployeeId },
    { name: 'Amit Kumar', role: 'Manager', userId: 'akumar', phone: '9876543250', branchIdx: 1, empId: oid() },
    { name: 'Sunita Devi', role: 'Cashier', userId: 'sdevi', phone: '9876543260', branchIdx: 1, empId: oid() },
    { name: 'Chef Ravi', role: 'Chef', userId: 'rchef', phone: '9876543270', branchIdx: 1, empId: oid() },
    { name: 'Neha Gupta', role: 'Manager', userId: 'ngupta', phone: '9876543280', branchIdx: 2, empId: oid() },
    { name: 'Deepak Yadav', role: 'Cashier', userId: 'dyadav', phone: '9876543290', branchIdx: 2, empId: oid() },
    { name: 'Chef Mohan', role: 'Chef', userId: 'mchef', phone: '9876543300', branchIdx: 2, empId: oid() },
  ];

  const waiters = [
    { name: 'Ramesh', branchIdx: 0 }, { name: 'Suresh', branchIdx: 0 },
    { name: 'Mahesh', branchIdx: 1 }, { name: 'Rajesh', branchIdx: 1 },
    { name: 'Ganesh', branchIdx: 2 }, { name: 'Nilesh', branchIdx: 2 },
  ];

  // Insert employees
  for (const r of roles) {
    const branchId = r.branchIdx >= 0 ? ctx.branchIds[r.branchIdx] : null;
    await db.collection('employees').insertOne({
      _id: r.empId, restaurantId: rid, branchId,
      name: r.name, role: r.role, username: r.userId, userId: r.userId, phone: r.phone,
      pin: pinHash, status: 'Active', isDeleted: false,
      createdAt: daysAgo(180), updatedAt: new Date(),
    });
    // Create user login
    await db.collection('users').insertOne({
      _id: oid(), userId: r.userId, password: pinHash, name: r.name,
      role: r.role === 'Owner' ? 'Owner' : r.role,
      restaurantId: rid, branchId, phone: r.phone, email: `${r.userId}@royalbistro.in`,
      isActive: true, isDeleted: false,
      createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  // Insert waiters
  for (const w of waiters) {
    const branchId = ctx.branchIds[w.branchIdx];
    const empId = oid();
    ctx.waiterEmployeeIds.push(empId);
    await db.collection('employees').insertOne({
      _id: empId, restaurantId: rid, branchId,
      name: w.name, role: 'Waiter', username: w.name.toLowerCase(), userId: w.name.toLowerCase(), phone: '987654' + String(Math.floor(Math.random() * 9000 + 1000)),
      pin: pinHash, status: 'Active', isDeleted: false,
      createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  console.log(`   ✅ Team: ${roles.length} core staff + ${waiters.length} waiters`);
}
