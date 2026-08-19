/**
 * 05-inventory.ts — Seed inventory events (stock additions via purchase, deductions).
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, oid } from './types';
import { daysAgo, rand, pick } from './helpers';

export async function seedInventory(db: Db, ctx: SeedContext, productsCtx: ProductSeedResult): Promise<void> {
  console.log('📦 Seeding inventory events...');
  const rid = ctx.restaurantId;

  let eventCount = 0;
  // For each inventory product, create a few inventory events over the past months
  for (const prodId of productsCtx.inventoryItemIds) {
    const product = await db.collection('products').findOne({ _id: prodId });
    if (!product) continue;

    // Create 3-8 historical stock events per item
    const numEvents = rand(3, 8);
    for (let i = 0; i < numEvents; i++) {
      const daysOld = rand(1, 170);
      const eventType = pick(['purchase', 'adjustment', 'wastage', 'sale_deduction']);
      const qty = eventType === 'wastage' ? -(Math.random() * 2 + 0.5) : rand(2, 15);

      await db.collection('inventoryevents').insertOne({
        _id: oid(),
        restaurantId: rid,
        productId: prodId,
        productName: product.name,
        eventType,
        quantity: Math.round(qty * 10) / 10,
        unit: product.unit,
        costPerUnit: product.averageCost || product.price,
        reference: eventType === 'purchase' ? `PO-${rand(1000, 9999)}` : undefined,
        branchId: pick(ctx.branchIds),
        notes: eventType === 'wastage' ? pick(['Expired', 'Damaged', 'Spoiled', 'Kitchen loss']) : undefined,
        createdBy: 'system',
        createdAt: daysAgo(daysOld),
        updatedAt: daysAgo(daysOld),
      });
      eventCount++;
    }
  }

  console.log(`   ✅ Inventory events: ${eventCount}`);
}
