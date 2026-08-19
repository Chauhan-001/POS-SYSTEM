/**
 * 07-purchases.ts — Creates 200+ purchase records distributed over 90 days.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, oid } from './types';
import { daysAgo, rand, pick, round2, restaurantHour, dateStr } from './helpers';

export async function seedPurchases(db: Db, ctx: SeedContext, productsCtx: ProductSeedResult): Promise<void> {
  console.log('🛒 Seeding purchases...');
  const rid = ctx.restaurantId;

  // Get supplier IDs
  const suppliers = await db.collection('suppliers').find({ restaurantId: rid }).toArray();
  if (suppliers.length === 0) { console.log('   ⚠️  No suppliers found'); return; }

  // Get inventory products
  const invProducts = await db.collection('products').find({
    restaurantId: rid, _id: { $in: productsCtx.inventoryItemIds },
  }).toArray();

  let purchaseCount = 0;

  // Generate purchases for the past 90 days
  for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
    const d = daysAgo(dayOffset);
    const purchasesPerDay = dayOffset <= 3 ? rand(5, 10) : dayOffset <= 7 ? rand(4, 8) : dayOffset <= 30 ? rand(3, 6) : rand(1, 4);

    for (let p = 0; p < purchasesPerDay; p++) {
      const supplier = pick(suppliers);
      const numItems = rand(2, 6);
      const items = [];
      let subtotal = 0;

      for (let i = 0; i < numItems; i++) {
        const product = pick(invProducts);
        if (!product) continue;
        const qty = Math.round((Math.random() * 10 + 1) * 10) / 10;
        const rate = product.price || 50;
        const amount = round2(qty * rate);
        subtotal += amount;

        items.push({
          productId: product._id,
          productName: product.name,
          productCode: product.code,
          quantity: qty,
          unit: product.unit,
          rate,
          amount,
          gstPercent: product.gstPercent || 0,
          batchNumber: `B${rand(1000, 9999)}`,
        });
      }

      const gstAmount = round2(subtotal * 0.05);
      const total = round2(subtotal + gstAmount);
      const purchaseDate = new Date(d);
      purchaseDate.setHours(restaurantHour(), rand(0, 59));

      await db.collection('purchases').insertOne({
        _id: oid(),
        restaurantId: rid,
        branchId: pick(ctx.branchIds),
        supplierId: supplier._id,
        supplierName: supplier.name,
        invoiceNumber: `INV-${dateStr(d).replace(/-/g, '')}-${rand(100, 999)}`,
        purchaseDate,
        items,
        subtotal: round2(subtotal),
        gstAmount,
        discount: 0,
        total,
        paymentStatus: pick(['paid', 'paid', 'paid', 'partial', 'pending']),
        paymentMethod: pick(['Cash', 'UPI', 'Bank Transfer']),
        receivedStatus: 'received',
        notes: '',
        isDeleted: false,
        createdAt: purchaseDate,
        updatedAt: purchaseDate,
      });
      purchaseCount++;
    }
  }

  console.log(`   ✅ Purchases: ${purchaseCount}`);
}
