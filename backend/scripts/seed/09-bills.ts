/**
 * 09-bills.ts — Creates 800+ bills with realistic line items, multi-tax, and payments.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, ProductSeedResult, CustomerSeedResult, oid } from './types';
import { daysAgo, rand, pick, round2, restaurantHour, isWeekend, dateStr, timeStr } from './helpers';

export async function seedBills(db: Db, ctx: SeedContext, productsCtx: ProductSeedResult, customersCtx: CustomerSeedResult): Promise<void> {
  console.log('🧾 Seeding bills...');
  const rid = ctx.restaurantId;

  // Get menu products (not inventory)
  const menuProducts = await db.collection('products').find({
    restaurantId: rid, _id: { $in: productsCtx.menuItemIds },
  }).toArray();
  if (menuProducts.length === 0) { console.log('   ⚠️  No menu products'); return; }

  const employees = await db.collection('employees').find({ restaurantId: rid }).toArray();
  const cashiers = employees.filter((e: any) => e.role === 'Cashier' || e.role === 'Manager');
  const customers = customersCtx.customerIds;
  const orderTypes = ['Dine In', 'Dine In', 'Dine In', 'Takeaway', 'Takeaway', 'Delivery'];

  let billCount = 0;
  let invoiceNum = 1001;

  for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
    const d = daysAgo(dayOffset);
    // Weekend = more orders
    const ordersPerDay = isWeekend(d) ? rand(30, 50) : rand(15, 35);

    for (let o = 0; o < ordersPerDay; o++) {
      const orderType = pick(orderTypes);
      const numItems = rand(1, 6);
      const items: any[] = [];
      let subtotal = 0;

      for (let i = 0; i < numItems; i++) {
        const product = pick(menuProducts);
        if (!product) continue;
        const qty = rand(1, 3);
        const price = product.price;
        const amount = price * qty;
        subtotal += amount;

        items.push({
          productId: product._id,
          productName: product.name,
          productCode: product.code,
          category: product.category,
          quantity: qty,
          price,
          amount,
          gstPercent: product.gstPercent || 5,
        });
      }

      if (items.length === 0) continue;

      // Tax calculation (multi-slab)
      const gstMap: Record<number, { taxable: number; tax: number }> = {};
      for (const item of items) {
        const rate = item.gstPercent;
        if (!gstMap[rate]) gstMap[rate] = { taxable: 0, tax: 0 };
        gstMap[rate].taxable += item.amount;
        gstMap[rate].tax += round2(item.amount * rate / 100);
      }
      const totalGst = round2(Object.values(gstMap).reduce((s, v) => s + v.tax, 0));
      const discount = Math.random() < 0.15 ? round2(subtotal * pick([0.05, 0.1, 0.15])) : 0;
      const grandTotal = round2(subtotal - discount + totalGst);

      const billDate = new Date(d);
      billDate.setHours(restaurantHour(), rand(0, 59));
      const cashier = pick(cashiers);
      const customerIdx = Math.random() < 0.6 ? rand(0, customers.length - 1) : -1;
      const customerId = customerIdx >= 0 ? customers[customerIdx] : null;
      const customer = customerId ? await db.collection('customers').findOne({ _id: customerId }) : null;

      const paymentMethod = pick(['Cash', 'UPI', 'UPI', 'Card', 'Cash', 'Cash']);

      // Points earned (1 per ₹10)
      const pointsEarned = Math.floor(grandTotal / 10);

      const billId = oid();
      await db.collection('bills').insertOne({
        _id: billId,
        invoiceNumber: `RB-${String(invoiceNum++).padStart(4, '0')}`,
        ticketNumber: `T-${rand(1000, 9999)}`,
        date: dateStr(billDate), time: timeStr(billDate),
        cashierName: cashier?.name || 'Staff', cashierRole: cashier?.role || 'Cashier',
        subtotal: round2(subtotal), discount, gst: totalGst, grandTotal,
        paymentMethod,
        orderType, restaurantId: rid, branchId: pick(ctx.branchIds),
        customerId, customerPhone: customer?.phone, customerName: customer?.name,
        pointsEarned, pointsRedeemed: Math.random() < 0.1 ? rand(50, 200) : 0,
        isVoided: false, isRefunded: false, refundAmount: 0,
        createdAt: billDate, updatedAt: billDate,
      });

      // Insert bill items
      const billItems = items.map(item => ({
        _id: oid(), billId, restaurantId: rid,
        productId: item.productId, productName: item.productName,
        productCode: item.productCode, category: item.category,
        quantity: item.quantity, price: item.price,
        gstPercent: item.gstPercent,
        total: item.amount,
        createdAt: billDate, updatedAt: billDate,
      }));
      if (billItems.length > 0) {
        await db.collection('billitems').insertMany(billItems);
      }

      billCount++;
    }
  }

  console.log(`   ✅ Bills: ${billCount}`);
}
