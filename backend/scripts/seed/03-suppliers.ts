/**
 * 03-suppliers.ts — Creates realistic food & supply vendors.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo } from './helpers';

export interface SupplierSeedResult {
  ids: ObjectId[];
  byName: Map<string, ObjectId>;
}

export async function seedSuppliers(db: Db, ctx: SeedContext): Promise<SupplierSeedResult> {
  console.log('🚚 Seeding suppliers...');

  const rid = ctx.restaurantId;
  const suppliers = [
    { name: 'FreshFarm Foods', phone: '9810000001', email: 'orders@freshfarm.in', gst: '07AABCF0001F1Z5', category: 'Vegetables & Fruits', address: 'Sadar Bazaar, Lucknow' },
    { name: 'City Dairy Suppliers', phone: '9810000002', email: 'supply@citydairy.in', gst: '07AABCC0002F1Z5', category: 'Dairy & Dairy Products', address: 'Alambagh, Lucknow' },
    { name: 'Royal Dry Fruits', phone: '9810000003', email: 'info@royaldryfruits.in', gst: '07AABCR0003F1Z5', category: 'Dry Fruits & Nuts', address: 'Aminabad, Lucknow' },
    { name: 'Green Basket Vegetables', phone: '9810000004', email: 'bulk@greenbasket.in', gst: '07AABCG0004F1Z5', category: 'Vegetables & Fruits', address: 'Vikram Nagar, Lucknow' },
    { name: 'Metro Beverages', phone: '9810000005', email: 'orders@metrobev.in', gst: '07AABCM0005F1Z5', category: 'Beverages', address: 'Gomti Nagar, Lucknow' },
    { name: 'Prime Packaging', phone: '9810000006', email: 'sales@primepkg.in', gst: '07AABCP0006F1Z5', category: 'Packaging Materials', address: 'Industrial Area, Lucknow' },
    { name: 'Spice Valley Traders', phone: '9810000007', email: 'wholesale@spicevalley.in', gst: '07AABCS0007F1Z5', category: 'Spices & Masala', address: 'Chowk, Lucknow' },
    { name: 'Daily Dairy Mart', phone: '9810000008', email: 'supply@dailydairy.in', gst: '07AABCD0008F1Z5', category: 'Dairy & Dairy Products', address: 'Hazratganj, Lucknow' },
    { name: 'Natraj Flour Mills', phone: '9810000009', email: 'orders@natrajmill.in', gst: '07AABCN0009F1Z5', category: 'Flour & Grains', address: 'Aminabad, Lucknow' },
    { name: 'Himalayan Water', phone: '9810000010', email: 'distribute@himalayan.in', gst: '07AABCH0010F1Z5', category: 'Beverages & Water', address: 'Faizabad Road, Lucknow' },
    { name: 'Modern Kitchen Equip', phone: '9810000011', email: 'sales@modernkitchen.in', gst: '07AABCK0011F1Z5', category: 'Kitchen Equipment', address: 'Aashiana, Lucknow' },
    { name: 'CleanPro Services', phone: '9810000012', email: 'contract@cleanpro.in', gst: '07AABCX0012F1Z5', category: 'Cleaning Supplies', address: 'Indira Nagar, Lucknow' },
  ];

  const ids: ObjectId[] = [];
  const byName = new Map<string, ObjectId>();

  for (const s of suppliers) {
    const id = oid();
    ids.push(id);
    byName.set(s.name, id);
    await db.collection('suppliers').insertOne({
      _id: id, restaurantId: rid, name: s.name, phone: s.phone, email: s.email,
      gstin: s.gst, category: s.category, address: s.address,
      status: 'active', outstandingAmount: 0, totalPurchases: 0,
      isDeleted: false, createdAt: daysAgo(180), updatedAt: new Date(),
    });
  }

  console.log(`   ✅ Suppliers: ${suppliers.length}`);
  return { ids, byName };
}
