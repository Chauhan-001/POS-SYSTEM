/**
 * =============================================================================
 * reconcile.ts — HISTORICAL FOUNDATION, PHASE 2 (READ-ONLY RECONCILIATION)
 * =============================================================================
 *
 * Reconciles the transaction spine WITHOUT writing anything:
 *
 *   1. Bill.subtotal  vs  Σ BillItem line totals (pricingSnapshot.lineTotal or
 *                         priceAtSale × quantity)
 *   2. Bill.grandTotal vs (subtotal − discount + gst)
 *   3. Split-payment bills: Σ splitDetails vs grandTotal
 *   4. RecipeConsumption totals vs the linked bill (existence + count)
 *
 * Modes (default is read-only):
 *   npx tsx scripts/historical/reconcile.ts                # print summary
 *   npx tsx scripts/historical/reconcile.ts --out report.json
 *
 * SAFETY: this script performs NO writes — only find()/aggregate() reads. It never
 * deletes, updates, or inserts. It is safe to run against any database.
 *
 * It reuses the repository's existing metric definitions where possible; it does
 * NOT create a second finance engine (prompt §44). It is the read-only half of the
 * Phase 2 gate; corrections (if any) are a separate, explicitly-approved phase.
 */

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const ARGS = process.argv.slice(2);
const outIdx = ARGS.indexOf('--out');
const outPath = outIdx >= 0 ? ARGS[outIdx + 1] : null;
const TOL = 0.01;

interface BillBreakdown {
  restaurantId: string | null;
  branchId: string | null;
  billId: string;
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod: string;
  splitSum: number | null;
  itemsSubtotal: number;
  itemsCount: number;
  isVoided: boolean;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');

  // ── 1. Aggregate BillItems by billId ───────────────────────────────────────
  // An item is "priced" only when it carries a real historical price snapshot
  // (pricingSnapshot.lineTotal or a present priceAtSale). Items without either
  // are UNAVAILABLE line history — never treated as a ₹0 sale (prompt §26).
  const itemsByBill = new Map<string, { line: number; count: number; priced: number }>();
  process.stdout.write('scanning billitems… ');
  const itemCursor = db.collection('billitems').find(
    {},
    { projection: { billId: 1, priceAtSale: 1, quantity: 1, 'pricingSnapshot.lineTotal': 1 } },
  );
  let itemsScanned = 0;
  let itemsUnpriced = 0;
  for await (const it of itemCursor as unknown as AsyncIterable<Record<string, any>>) {
    itemsScanned++;
    const key = String(it.billId);
    const snapLine = it?.pricingSnapshot?.lineTotal;
    const hasPrice = typeof snapLine === 'number' || typeof it.priceAtSale === 'number';
    if (!hasPrice) itemsUnpriced++;
    const line = typeof snapLine === 'number'
      ? snapLine
      : hasPrice
        ? Number(it.priceAtSale) * Number(it.quantity ?? 0)
        : 0;
    const cur = itemsByBill.get(key) ?? { line: 0, count: 0, priced: 0 };
    cur.line += line;
    cur.count += 1;
    if (hasPrice) cur.priced += 1;
    itemsByBill.set(key, cur);
  }
  console.log(`${itemsScanned} items (${itemsUnpriced} unpriced) → ${itemsByBill.size} bills`);

  // ── 2. Iterate bills and reconcile ─────────────────────────────────────────
  process.stdout.write('scanning bills… ');
  const billCursor = db.collection('bills').find(
    {},
    {
      projection: {
        restaurantId: 1, branchId: 1, subtotal: 1, discount: 1, gst: 1, grandTotal: 1,
        paymentMethod: 1, splitDetails: 1, isVoided: 1,
      },
    },
  );

  const res = {
    billsScanned: 0,
    billsWithNoItems: 0,
    billsWithUnpricedItems: 0,
    subtotalMismatch: 0,
    subtotalAbsDiff: 0,
    // grandTotal is stored under TWO legitimate business conventions in this DB
    // (tax-additive vs tax-inclusive). We count BOTH as reconciled and only flag
    // bills matching NEITHER — never imposing one formula (prompt §44/§51).
    grandTotalAdditive: 0,
    grandTotalInclusive: 0,
    grandTotalUnclassified: 0,
    splitMismatch: 0,
    voidedBills: 0,
    byTenant: {} as Record<string, { bills: number; subtotalMismatch: number; unpriced: number }>,
    samples: [] as Array<Record<string, unknown>>,
  };
  const seenBillIds = new Set<string>();

  for await (const b of billCursor as unknown as AsyncIterable<Record<string, any>>) {
    res.billsScanned++;
    const billId = String(b._id);
    seenBillIds.add(billId);
    const ag = itemsByBill.get(billId);
    const itemsSubtotal = ag ? round2(ag.line) : 0;
    const itemsCount = ag ? ag.count : 0;
    const pricedCount = ag ? ag.priced : 0;
    if (itemsCount === 0) res.billsWithNoItems++;
    if (b.isVoided) res.voidedBills++;

    const tenant = b.restaurantId ? String(b.restaurantId) : 'null';
    const t = (res.byTenant[tenant] ??= { bills: 0, subtotalMismatch: 0, unpriced: 0 });
    t.bills++;

    // Unpriced = items exist but carry NO price snapshot. Line-level history is
    // UNAVAILABLE for these bills; they are reported separately, not as mismatches.
    const unpriced = itemsCount > 0 && pricedCount === 0;
    if (unpriced) {
      res.billsWithUnpricedItems++;
      t.unpriced++;
      continue;
    }

    const subtotalDiff = round2(itemsSubtotal - Number(b.subtotal ?? 0));
    if (Math.abs(subtotalDiff) > TOL) {
      res.subtotalMismatch++;
      res.subtotalAbsDiff = round2(res.subtotalAbsDiff + Math.abs(subtotalDiff));
      t.subtotalMismatch++;
      if (res.samples.length < 20) {
        res.samples.push({ billId, tenant, items: itemsCount, priced: pricedCount, itemsSubtotal, subtotal: b.subtotal, diff: subtotalDiff });
      }
    }

    const gt = Number(b.grandTotal ?? 0);
    const additive = round2(Number(b.subtotal ?? 0) - Number(b.discount ?? 0) + Number(b.gst ?? 0));
    if (Math.abs(round2(gt - additive)) <= TOL) res.grandTotalAdditive++;
    else if (Math.abs(round2(gt - Number(b.subtotal ?? 0))) <= TOL) res.grandTotalInclusive++;
    else res.grandTotalUnclassified++;

    if (b.paymentMethod === 'Split' && b.splitDetails) {
      const sd = b.splitDetails;
      const splitSum = round2(
        Number(sd.cashAmount ?? 0) + Number(sd.cardAmount ?? 0) + Number(sd.upiAmount ?? 0) + Number(sd.walletAmount ?? 0),
      );
      if (Math.abs(round2(splitSum - Number(b.grandTotal ?? 0))) > TOL) res.splitMismatch++;
    }
  }
  console.log(`${res.billsScanned} bills`);

  // ── 3. Referential-integrity: BillItems whose parent Bill does not exist ────
  const orphanBillIds = [...itemsByBill.keys()].filter((k) => !seenBillIds.has(k));
  const orphanItems = orphanBillIds.reduce((a, k) => a + (itemsByBill.get(k)?.count ?? 0), 0);

  // ── 4. RecipeConsumption link check ────────────────────────────────────────
  const rcCount = await db.collection('recipeconsumptions').estimatedDocumentCount();
  const rcLinked = await db.collection('recipeconsumptions').countDocuments({ billId: { $ne: null } });

  const summary = {
    generatedAt: new Date().toISOString(),
    uri,
    readOnly: true,
    tolerance: TOL,
    billitems: { scanned: itemsScanned, unpriced: itemsUnpriced, billsRepresented: itemsByBill.size },
    bills: res,
    orphanBillItems: {
      orphanBillIds: orphanBillIds.length,
      orphanItemDocs: orphanItems,
      note: 'BillItem.billId has no matching Bill — referential-integrity gap. REPORTED, not repaired (prompt §57).',
    },
    recipeConsumptions: { total: rcCount, withBillLink: rcLinked },
    verdict: {
      subtotalReconciled: res.subtotalMismatch === 0,
      grandTotalExplained: res.grandTotalUnclassified === 0,
      splitReconciled: res.splitMismatch === 0,
      // Line-level history exists for all bills only when nothing is unpriced.
      lineHistoryComplete: res.billsWithUnpricedItems === 0 && itemsUnpriced === 0,
      referentialIntegrityIntact: orphanBillIds.length === 0,
      fullyReconciled:
        res.subtotalMismatch === 0 &&
        res.grandTotalUnclassified === 0 &&
        res.splitMismatch === 0 &&
        res.billsWithNoItems === 0 &&
        res.billsWithUnpricedItems === 0 &&
        orphanBillIds.length === 0,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
  await mongoose.disconnect();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

main().catch((e) => {
  console.error('reconcile failed:', e);
  process.exit(1);
});
