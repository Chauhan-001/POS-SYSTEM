/**
 * 08-customers.ts — Creates 350 customers with realistic loyalty, visit, and spend data.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, CustomerSeedResult, oid } from './types';
import { daysAgo, rand, pick, round2, randomPhone } from './helpers';

const FIRST_NAMES = ['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Krishna','Ishaan','Shaurya','Ananya','Diya','Priya','Saanvi','Aanya','Aadhya','Navya','Anvi','Prisha','Riya','Rohan','Vikram','Amit','Rahul','Deepak','Suresh','Mahesh','Rajesh','Ganesh','Nilesh','Neha','Sunita','Priyanka','Kavita','Meena','Rekha','Sunita','Pooja','Geeta','Sita','Manoj','Vijay','Sanjay','Ajay','Vinay','Ravi','Sunil','Karan','Nitin','Pankaj','Harsh','Tanvi','Pallavi','Shweta','Pooja','Nisha','Ritu','Simran','Komal','Divya','Sakshi'];
const LAST_NAMES = ['Sharma','Verma','Gupta','Singh','Kumar','Yadav','Mishra','Pandey','Tiwari','Jha','Mehta','Patel','Reddy','Nair','Iyer','Das','Banerjee','Mukherjee','Chatterjee','Ghosh','Agarwal','Jain','Bansal','Goel','Khanna','Malhotra','Kapoor','Sinha','Saxena','Chauhan','Tomar','Rathore','Bhatt','Shah','Desai'];

export async function seedCustomers(db: Db, ctx: SeedContext): Promise<CustomerSeedResult> {
  console.log('👤 Seeding customers...');
  const rid = ctx.restaurantId;
  const customerIds: ObjectId[] = [];
  const customerPhones: string[] = [];
  const usedPhones = new Set<string>();

  const NUM_CUSTOMERS = 350;
  const now = new Date();

  for (let i = 0; i < NUM_CUSTOMERS; i++) {
    const id = oid();
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const name = `${firstName} ${lastName}`;

    // Generate unique phone
    let phone: string;
    do { phone = randomPhone(); } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // Randomize visit/spend profile
    const visits = rand(1, 60);
    const avgSpend = rand(150, 800);
    const totalSpend = round2(visits * avgSpend);
    const totalOrders = visits + rand(0, Math.floor(visits * 0.3));
    const daysSinceFirstVisit = rand(10, 170);
    const daysSinceLastVisit = rand(0, Math.min(daysSinceFirstVisit, 90));
    const firstVisit = daysAgo(daysSinceFirstVisit);
    const lastVisit = daysAgo(daysSinceLastVisit);
    const visitFrequency = visits > 1 ? Math.round(daysSinceFirstVisit / visits) : 0;

    // Points
    const lifetimePoints = Math.floor(totalSpend / 10);
    const points = Math.floor(lifetimePoints * (0.3 + Math.random() * 0.5));

    // Tier based on spend
    let tier: string = 'Bronze';
    if (totalSpend > 20000) tier = 'Platinum';
    else if (totalSpend > 10000) tier = 'Gold';
    else if (totalSpend > 5000) tier = 'Silver';

    // Status: ~8% dormant, ~2% blocked
    let status = 'active';
    if (daysSinceLastVisit > 60 && Math.random() < 0.3) status = 'dormant';
    else if (Math.random() < 0.02) status = 'blocked';

    // Birthday (~30% have one)
    const birthday = Math.random() < 0.3
      ? `${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`
      : undefined;

    // Tags
    const tags: string[] = [];
    if (tier === 'Gold' || tier === 'Platinum') tags.push('VIP');
    if (visits > 20) tags.push('regular');
    if (totalSpend > 15000) tags.push('high-value');
    if (daysSinceLastVisit > 45) tags.push('needs-winback');

    await db.collection('customers').insertOne({
      _id: id, restaurantId: rid, branchId: pick(ctx.branchIds),
      name, phone, email: Math.random() < 0.4 ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 99)}@email.com` : undefined,
      birthday, gender: pick(['Male', 'Female']),
      city: 'Lucknow', state: 'Uttar Pradesh',
      tags, marketingOptIn: Math.random() < 0.6, isVip: tier === 'Platinum',
      status, referralCode: `${firstName.slice(0, 3).toUpperCase()}${lastName.slice(0, 3).toUpperCase()}${rand(100, 999)}`,
      points, lifetimePoints, walletBalance: rand(0, 500),
      tier, totalSpend, averageSpend: round2(totalSpend / visits),
      totalOrders, visits, lastVisit, visitFrequency, firstVisit,
      isNewCustomer: visits <= 1, isBlocked: status === 'blocked', isDeleted: false,
      favoriteItems: pick(['Paneer Kadhai', 'Butter Naan', 'Cold Coffee', 'Veg Biryani', '']),
      favoriteCategories: pick(['Main Course', 'Beverages', 'Breads', '']),
      preferredPaymentMethod: pick(['Cash', 'UPI', 'Card']),
      referralCount: rand(0, 5),
      createdAt: firstVisit, updatedAt: new Date(),
    });

    customerIds.push(id);
    customerPhones.push(phone);
  }

  console.log(`   ✅ Customers: ${NUM_CUSTOMERS}`);
  return { customerIds, customerPhones };
}
