/**
 * 10-offers.ts — Creates 25 realistic offers in various lifecycle states.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, rand, pick, dateStr } from './helpers';

export async function seedOffers(db: Db, ctx: SeedContext): Promise<void> {
  console.log('🏷️  Seeding offers...');
  const rid = ctx.restaurantId;

  const OFFERS = [
    { title: 'Weekend Special', type: 'percentage', value: 15, description: '15% off on all main course items this weekend', shortDescription: '15% off main course', status: 'active', minOrderValue: 300, daysOfWeek: [0, 6], couponCode: 'WEEKEND15' },
    { title: 'Lunch Thali Deal', type: 'flat', value: 50, description: '₹50 off on Lunch Thali', shortDescription: '₹50 off Lunch Thali', status: 'active', minOrderValue: 200, couponCode: 'LUNCH50' },
    { title: 'Flat ₹100 Off', type: 'flat', value: 100, description: '₹100 off on orders above ₹500', shortDescription: '₹100 off', status: 'active', minOrderValue: 500, couponCode: 'FLAT100' },
    { title: 'Free Dessert', type: 'free_item', value: 1, description: 'Free Gulab Jamun on orders above ₹799', shortDescription: 'Free dessert', status: 'active', minOrderValue: 799, couponCode: 'FREEDESS' },
    { title: '10% Cashback', type: 'cashback', value: 10, description: '10% cashback up to ₹150', shortDescription: '10% cashback', status: 'active', minOrderValue: 300, maxDiscount: 150, couponCode: 'CASH10' },
    { title: 'Happy Hours', type: 'percentage', value: 20, description: '20% off on beverages 3-6 PM', shortDescription: '20% off drinks', status: 'active', minOrderValue: 0, couponCode: 'HAPPY20' },
    { title: 'Birthday Special', type: 'flat', value: 200, description: '₹200 off on your birthday', shortDescription: '₹200 off birthday', status: 'active', minOrderValue: 500, couponCode: 'BDAY200' },
    { title: 'Buy 2 Get 1 Free', type: 'bogo', value: 1, description: 'Buy 2 starters, get 1 free', shortDescription: 'Buy 2 Get 1', status: 'active', minOrderValue: 0, couponCode: 'BOGO1' },
    { title: 'New Year Mega Sale', type: 'percentage', value: 25, description: '25% off entire menu', shortDescription: '25% off everything', status: 'expired', minOrderValue: 200, couponCode: 'NEWYEAR25' },
    { title: 'Diwali Dhamaka', type: 'flat', value: 150, description: '₹150 off on festive orders', shortDescription: '₹150 off festive', status: 'expired', minOrderValue: 500, couponCode: 'DIWALI150' },
    { title: 'Independence Day Offer', type: 'percentage', value: 15, description: '15% off all combos', shortDescription: '15% off combos', status: 'expired', minOrderValue: 200, couponCode: 'IND15' },
    { title: 'Monsoon Offer', type: 'flat', value: 75, description: '₹75 off on soup + main course combo', shortDescription: '₹75 off combos', status: 'paused', minOrderValue: 300, couponCode: 'MONSOON75' },
    { title: 'Rainy Day Special', type: 'percentage', value: 10, description: '10% off hot beverages', shortDescription: '10% off hot drinks', status: 'paused', minOrderValue: 0, couponCode: 'RAIN10' },
    { title: 'Weekend Brunch', type: 'percentage', value: 20, description: '20% off Saturday-Sunday brunch', shortDescription: '20% brunch discount', status: 'scheduled', minOrderValue: 300, startDate: dateStr(daysAgo(-7)), endDate: dateStr(daysAgo(-2)), couponCode: 'BRUNCH20' },
    { title: 'Eid Special', type: 'flat', value: 100, description: 'Flat ₹100 off for Eid', shortDescription: '₹100 off Eid', status: 'scheduled', minOrderValue: 400, couponCode: 'EID100' },
    { title: 'Student Discount', type: 'percentage', value: 12, description: '12% off for students with valid ID', shortDescription: '12% student discount', status: 'active', minOrderValue: 150, couponCode: 'STUDENT12' },
    { title: 'Senior Citizen Discount', type: 'percentage', value: 10, description: '10% off for senior citizens', shortDescription: '10% senior discount', status: 'active', minOrderValue: 0, couponCode: 'SENIOR10' },
    { title: 'First Order Welcome', type: 'percentage', value: 20, description: '20% off on your first order', shortDescription: '20% first order', status: 'active', minOrderValue: 200, couponCode: 'WELCOME20' },
    { title: 'Refer & Earn', type: 'flat', value: 100, description: '₹100 off when you refer a friend', shortDescription: '₹100 referral', status: 'active', minOrderValue: 300, couponCode: 'REFER100' },
    { title: 'Combo Deal: Burger + Coke', type: 'combo', value: 249, description: 'Veg Burger + Coke at ₹249 (save ₹50)', shortDescription: 'Burger + Coke ₹249', status: 'active', minOrderValue: 0, comboPrice: 249, couponCode: 'BURGER249' },
    { title: 'Pizza Mania', type: 'flat', value: 80, description: '₹80 off on any pizza', shortDescription: '₹80 off pizza', status: 'active', minOrderValue: 150, couponCode: 'PIZZA80' },
    { title: 'Thali Special', type: 'flat', value: 30, description: '₹30 off on any thali', shortDescription: '₹30 off thali', status: 'active', minOrderValue: 100, couponCode: 'THALI30' },
    { title: 'Night Owl Deal', type: 'percentage', value: 15, description: '15% off after 10 PM', shortDescription: '15% off late night', status: 'active', minOrderValue: 200, startHour: 22, endHour: 24, couponCode: 'NIGHT15' },
    { title: 'Early Bird Breakfast', type: 'percentage', value: 10, description: '10% off before 10 AM', shortDescription: '10% off breakfast', status: 'draft', minOrderValue: 0, couponCode: 'EARLY10' },
    { title: 'Mega Saver', type: 'percentage', value: 30, description: '30% off on orders above ₹1000', shortDescription: '30% off big orders', status: 'draft', minOrderValue: 1000, couponCode: 'MEGA30' },
  ];

  let count = 0;
  for (const o of OFFERS) {
    await db.collection('offers').insertOne({
      _id: oid(), restaurantId: rid, title: o.title, type: o.type,
      value: o.value, description: o.description, shortDescription: o.shortDescription,
      status: o.status, minOrderValue: o.minOrderValue || 0,
      maxDiscount: o.maxDiscount || null, couponCode: o.couponCode,
      daysOfWeek: o.daysOfWeek || [], startHour: o.startHour || null, endHour: o.endHour || null,
      startDate: o.startDate || null, endDate: o.endDate || null,
      currentUses: o.status === 'active' ? rand(5, 80) : o.status === 'expired' ? rand(20, 150) : 0,
      maxUses: o.status === 'active' ? 500 : null,
      applicableProducts: [], applicableCategories: [],
      sortOrder: count, isActive: o.status === 'active',
      isDeleted: false, createdAt: daysAgo(rand(10, 160)), updatedAt: new Date(),
    });
    count++;
  }

  console.log(`   ✅ Offers: ${count}`);
}
