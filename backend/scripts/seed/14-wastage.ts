/**
 * 14-wastage.ts — Creates 80 realistic wastage records.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, oid } from './types';
import { daysAgo, rand, pick, round2 } from './helpers';

export async function seedWastage(db: Db, ctx: SeedContext, productsCtx: ProductSeedResult): Promise<void> {
  console.log('🗑️  Seeding wastage...');
  const rid = ctx.restaurantId;

  const invProducts = await db.collection('products').find({
    restaurantId: rid, _id: { $in: productsCtx.inventoryItemIds },
  }).toArray();
  if (invProducts.length === 0) { console.log('   ⚠️  No inventory items'); return; }

  const REASONS = ['Expired', 'Damaged', 'Spoiled', 'Kitchen preparation loss', 'Spillage', 'Storage failure', 'Overcooked', 'Customer returned', 'Quality check rejected'];

  let count = 0;
  for (let day = 60; day >= 0; day--) {
    const d = daysAgo(day);
    const numWastage = rand(0, 3);
    for (let i = 0; i < numWastage; i++) {
      const product = pick(invProducts);
      const qty = Math.round((Math.random() * 3 + 0.1) * 10) / 10;
      const reason = pick(REASONS);
      const cost = round2(qty * (product.price || 50));

      // Insert as inventory event with wastage type
      await db.collection('inventoryevents').insertOne({
        _id: oid(), restaurantId: rid, branchId: pick(ctx.branchIds),
        productId: product._id, productName: product.name,
        eventType: 'wastage',
        quantity: -qty, unit: product.unit, costPerUnit: product.price || 50,
        totalCost: cost,
        reference: reason,
        notes: `Wastage: ${reason}. ${qty} ${product.unit} discarded.`,
        createdBy: pick(['Vikram Singh', 'Priya Sharma', 'Chef Arjun']),
        createdAt: d, updatedAt: d,
      });
      count++;
    }
  }

  console.log(`   ✅ Wastage records: ${count}`);
}
