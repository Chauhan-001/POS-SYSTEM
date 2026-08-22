/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BasketAnalysisService — Computes support, confidence, and lift for product
 * associations from actual bill data. Used for combo and add-on detection.
 *
 * Statistical safeguards:
 * - Minimum support threshold (default 1%)
 * - Minimum confidence threshold (default 10%)
 * - Minimum lift threshold (default 1.2x)
 * - Minimum co-occurrence count (default 5 bills)
 * - Only returns statistically meaningful associations
 */

import mongoose from 'mongoose';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';

export interface AssociationRule {
  antecedent: string; // Product A ID
  antecedentName: string;
  consequent: string; // Product B ID
  consequentName: string;
  support: number; // P(A ∧ B) - proportion of all bills containing both
  confidence: number; // P(B | A) - proportion of A bills also containing B
  lift: number; // P(B | A) / P(B) - how much more likely B is when A is present
  coOccurrenceCount: number; // Number of bills containing both
  antecedentCount: number; // Number of bills containing A
  consequentCount: number; // Number of bills containing B
  totalBills: number;
}

export interface BasketAnalysisOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minSupport?: number; // Default 0.01 (1%)
  minConfidence?: number; // Default 0.1 (10%)
  minLift?: number; // Default 1.2
  minCoOccurrence?: number; // Default 5
  maxRules?: number; // Default 50
  categoryFilter?: string[]; // Only analyze specific categories
}

export interface ProductAffinity {
  productId: string;
  productName: string;
  category: string;
  associations: AssociationRule[];
}

interface BillWithItems {
  billId: mongoose.Types.ObjectId;
  items: Array<{
    productId: string;
    productName: string;
    category: string;
  }>;
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

/**
 * Fetch bills with their items for basket analysis
 */
async function fetchBillsWithItems(opts: BasketAnalysisOptions): Promise<BillWithItems[]> {
  const { restaurantId, branchId, lookbackDays = 90, categoryFilter } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const billFilter: any = {
    restaurantId: objectId(restaurantId),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  };
  if (branchId) billFilter.branchId = objectId(branchId);

  const bills = await BillModel.find(billFilter)
    .select('_id')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);

  // Build product category map
  const productFilter: any = {
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  };
  if (categoryFilter && categoryFilter.length > 0) {
    productFilter.category = { $in: categoryFilter };
  }

  const products = await ProductModel.find(productFilter)
    .select('_id name category')
    .lean()
    .exec();

  const productMap = new Map(products.map(p => [String(p._id), { name: p.name, category: p.category || 'Other' }]));

  // Fetch bill items
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('billId itemId itemName')
    .lean()
    .exec();

  // Group by bill
  const billsWithItems = new Map<string, BillWithItems>();
  for (const item of items) {
    const billIdStr = String(item.billId);
    let bill = billsWithItems.get(billIdStr);
    if (!bill) {
      bill = { billId: item.billId, items: [] };
      billsWithItems.set(billIdStr, bill);
    }

    const productInfo = productMap.get(String(item.itemId));
    if (!productInfo) continue; // Skip items not in our product list

    bill.items.push({
      productId: String(item.itemId),
      productName: item.itemName || productInfo.name,
      category: productInfo.category,
    });
  }

  return Array.from(billsWithItems.values());
}

/**
 * Compute association rules from bill data
 */
export async function computeAssociationRules(opts: BasketAnalysisOptions): Promise<AssociationRule[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minSupport = 0.01,
    minConfidence = 0.1,
    minLift = 1.2,
    minCoOccurrence = 5,
    maxRules = 50,
    categoryFilter,
  } = opts;

  const billsWithItems = await fetchBillsWithItems({ restaurantId, branchId, lookbackDays, categoryFilter });
  const totalBills = billsWithItems.length;

  if (totalBills < minCoOccurrence * 2) return []; // Need sufficient bills

  // Count individual product occurrences
  const productCounts = new Map<string, { name: string; count: number }>();
  for (const bill of billsWithItems) {
    const uniqueProducts = new Set(bill.items.map(i => i.productId));
    for (const pid of uniqueProducts) {
      const existing = productCounts.get(pid) || { name: bill.items.find(i => i.productId === pid)?.productName || 'Item', count: 0 };
      existing.count++;
      productCounts.set(pid, existing);
    }
  }

  // Count co-occurrences (pairs)
  const pairCounts = new Map<string, { nameA: string; nameB: string; count: number }>();
  for (const bill of billsWithItems) {
    const productIds = bill.items.map(i => i.productId);
    // Generate all pairs
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const pidA = productIds[i];
        const pidB = productIds[j];
        // Sort to ensure consistent ordering
        const [sortedA, sortedB] = pidA < pidB ? [pidA, pidB] : [pidB, pidA];
        const key = `${sortedA}|${sortedB}`;
        const itemA = bill.items.find(i => i.productId === sortedA);
        const itemB = bill.items.find(i => i.productId === sortedB);
        const existing = pairCounts.get(key) || { nameA: itemA?.productName || 'Item', nameB: itemB?.productName || 'Item', count: 0 };
        existing.count++;
        pairCounts.set(key, existing);
      }
    }
  }

  // Compute metrics for each pair
  const rules: AssociationRule[] = [];
  for (const [key, pair] of pairCounts.entries()) {
    const [pidA, pidB] = key.split('|');
    const countA = productCounts.get(pidA)?.count || 0;
    const countB = productCounts.get(pidB)?.count || 0;
    const coOccurrence = pair.count;

    if (coOccurrence < minCoOccurrence) continue;
    if (countA === 0 || countB === 0) continue;

    const support = coOccurrence / totalBills;
    if (support < minSupport) continue;

    const confidenceAB = coOccurrence / countA; // P(B | A)
    const confidenceBA = coOccurrence / countB; // P(A | B)

    const probA = countA / totalBills;
    const probB = countB / totalBills;
    const liftAB = confidenceAB / probB;
    const liftBA = confidenceBA / probA;

    // Add both directions if they meet thresholds
    if (confidenceAB >= minConfidence && liftAB >= minLift) {
      rules.push({
        antecedent: pidA,
        antecedentName: pair.nameA,
        consequent: pidB,
        consequentName: pair.nameB,
        support: Math.round(support * 10000) / 100, // Percentage with 2 decimals
        confidence: Math.round(confidenceAB * 10000) / 100,
        lift: Math.round(liftAB * 100) / 100,
        coOccurrenceCount: coOccurrence,
        antecedentCount: countA,
        consequentCount: countB,
        totalBills,
      });
    }

    if (confidenceBA >= minConfidence && liftBA >= minLift) {
      rules.push({
        antecedent: pidB,
        antecedentName: pair.nameB,
        consequent: pidA,
        consequentName: pair.nameA,
        support: Math.round(support * 10000) / 100,
        confidence: Math.round(confidenceBA * 10000) / 100,
        lift: Math.round(liftBA * 100) / 100,
        coOccurrenceCount: coOccurrence,
        antecedentCount: countB,
        consequentCount: countA,
        totalBills,
      });
    }
  }

  // Sort by lift (strongest association first), then confidence
  rules.sort((a, b) => {
    if (Math.abs(b.lift - a.lift) > 0.01) return b.lift - a.lift;
    return b.confidence - a.confidence;
  });

  return rules.slice(0, maxRules);
}

/**
 * Get top associations for a specific product (what sells with it)
 */
export async function getProductAssociations(
  productId: string,
  opts: BasketAnalysisOptions
): Promise<AssociationRule[]> {
  const rules = await computeAssociationRules(opts);
  return rules.filter(r => r.antecedent === productId || r.consequent === productId);
}

/**
 * Get product affinities grouped by product
 */
export async function getProductAffinities(opts: BasketAnalysisOptions): Promise<ProductAffinity[]> {
  const rules = await computeAssociationRules(opts);

  const affinityMap = new Map<string, ProductAffinity>();

  for (const rule of rules) {
    // Add antecedent
    let affinityA = affinityMap.get(rule.antecedent);
    if (!affinityA) {
      affinityA = {
        productId: rule.antecedent,
        productName: rule.antecedentName,
        category: '', // Will be filled below
        associations: [],
      };
      affinityMap.set(rule.antecedent, affinityA);
    }
    affinityA.associations.push(rule);

    // Add consequent
    let affinityB = affinityMap.get(rule.consequent);
    if (!affinityB) {
      affinityB = {
        productId: rule.consequent,
        productName: rule.consequentName,
        category: '',
        associations: [],
      };
      affinityMap.set(rule.consequent, affinityB);
    }
    // Add reverse association
    affinityB.associations.push({
      ...rule,
      antecedent: rule.consequent,
      antecedentName: rule.consequentName,
      consequent: rule.antecedent,
      consequentName: rule.antecedentName,
    });
  }

  // Fetch categories for all products
  const productIds = Array.from(affinityMap.keys());
  if (productIds.length > 0) {
    const products = await ProductModel.find({
      restaurantId: objectId(opts.restaurantId),
      _id: { $in: productIds.map(objectId) },
      isDeleted: { $ne: true },
    })
      .select('_id category')
      .lean()
      .exec();

    const categoryMap = new Map(products.map(p => [String(p._id), p.category || 'Other']));
    for (const [pid, affinity] of affinityMap.entries()) {
      affinity.category = categoryMap.get(pid) || 'Other';
    }
  }

  return Array.from(affinityMap.values());
}

/**
 * Find best combo candidates from basket analysis
 */
export async function findComboCandidates(opts: BasketAnalysisOptions & {
  minComboMargin?: number;
  maxComboDiscount?: number;
}): Promise<Array<{
  primaryProduct: { id: string; name: string; price: number; margin: number };
  addOnProduct: { id: string; name: string; price: number; margin: number };
  association: AssociationRule;
  suggestedComboPrice: number;
  estimatedMargin: number;
}>> {
  const rules = await computeAssociationRules(opts);
  if (rules.length === 0) return [];

  // Fetch product prices and margins
  const productIds = new Set<string>();
  for (const rule of rules) {
    productIds.add(rule.antecedent);
    productIds.add(rule.consequent);
  }

  const products = await ProductModel.find({
    restaurantId: objectId(opts.restaurantId),
    _id: { $in: Array.from(productIds).map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name price averageCost')
    .lean()
    .exec();

  const productInfoMap = new Map(products.map(p => [
    String(p._id),
    {
      name: p.name,
      price: p.price || 0,
      averageCost: p.averageCost || 0,
      margin: p.price && p.averageCost ? Math.round(((p.price - p.averageCost) / p.price) * 100) : 0,
    }
  ]));

  const candidates = [];
  const { minComboMargin = 25, maxComboDiscount = 20 } = opts;

  for (const rule of rules) {
    const primary = productInfoMap.get(rule.antecedent);
    const addOn = productInfoMap.get(rule.consequent);

    if (!primary || !addOn) continue;
    if (primary.price <= 0 || addOn.price <= 0) continue;

    // Primary should be the higher-priced/main item
    const [main, side] = primary.price >= addOn.price
      ? [primary, addOn]
      : [addOn, primary];

    // Calculate combo economics
    const normalPrice = main.price + side.price;
    const discountPercent = Math.min(maxComboDiscount, Math.round((normalPrice * 0.15) / normalPrice * 100)); // ~15% discount
    const comboPrice = Math.round(normalPrice * (1 - discountPercent / 100));

    const mainCost = main.price * (1 - main.margin / 100);
    const sideCost = side.price * (1 - side.margin / 100);
    const comboCost = mainCost + sideCost;
    const comboMargin = comboPrice > 0 ? Math.round(((comboPrice - comboCost) / comboPrice) * 100) : 0;

    if (comboMargin < minComboMargin) continue;

    candidates.push({
      primaryProduct: { id: main.price >= addOn.price ? rule.antecedent : rule.consequent, name: main.name, price: main.price, margin: main.margin },
      addOnProduct: { id: main.price >= addOn.price ? rule.consequent : rule.antecedent, name: side.name, price: side.price, margin: side.margin },
      association: rule,
      suggestedComboPrice: comboPrice,
      estimatedMargin: comboMargin,
    });
  }

  // Sort by lift * margin (strong affinity + healthy margin)
  candidates.sort((a, b) => (b.association.lift * b.estimatedMargin) - (a.association.lift * a.estimatedMargin));

  return candidates.slice(0, 10);
}

/**
 * Find best add-on/upsell candidates
 */
export async function findAddOnCandidates(opts: BasketAnalysisOptions & {
  minAddOnMargin?: number;
}): Promise<Array<{
  mainProduct: { id: string; name: string; price: number; margin: number };
  addOnProduct: { id: string; name: string; price: number; margin: number };
  association: AssociationRule;
  suggestedAddOnPrice: number;
}>> {
  const rules = await computeAssociationRules(opts);
  if (rules.length === 0) return [];

  const productIds = new Set<string>();
  for (const rule of rules) {
    productIds.add(rule.antecedent);
    productIds.add(rule.consequent);
  }

  const products = await ProductModel.find({
    restaurantId: objectId(opts.restaurantId),
    _id: { $in: Array.from(productIds).map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name price averageCost')
    .lean()
    .exec();

  const productInfoMap = new Map(products.map(p => [
    String(p._id),
    {
      name: p.name,
      price: p.price || 0,
      averageCost: p.averageCost || 0,
      margin: p.price && p.averageCost ? Math.round(((p.price - p.averageCost) / p.price) * 100) : 0,
    }
  ]));

  const candidates = [];
  const { minAddOnMargin = 20 } = opts;

  for (const rule of rules) {
    const main = productInfoMap.get(rule.antecedent);
    const addOn = productInfoMap.get(rule.consequent);

    if (!main || !addOn) continue;
    if (main.price <= 0 || addOn.price <= 0) continue;

    // Add-on should be lower priced than main
    if (addOn.price > main.price * 0.5) continue; // Add-on shouldn't be more than 50% of main price

    const addOnMargin = addOn.margin;
    if (addOnMargin < minAddOnMargin) continue;

    // Suggested add-on price: 20-30% of main price, but at least above cost
    const suggestedPrice = Math.max(
      Math.round(addOn.price * 0.8), // Slight discount from standalone
      Math.round(main.price * 0.25) // 25% of main price
    );

    candidates.push({
      mainProduct: { id: rule.antecedent, name: main.name, price: main.price, margin: main.margin },
      addOnProduct: { id: rule.consequent, name: addOn.name, price: addOn.price, margin: addOn.margin },
      association: rule,
      suggestedAddOnPrice: suggestedPrice,
    });
  }

  // Sort by confidence * margin
  candidates.sort((a, b) => (b.association.confidence * b.addOnProduct.margin) - (a.association.confidence * a.addOnProduct.margin));

  return candidates.slice(0, 10);
}

/**
 * Persist basket analysis results as signals
 */
export async function persistBasketAnalysisAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  affinities: ProductAffinity[]
): Promise<void> {
  const docs: any[] = [];

  for (const affinity of affinities) {
    for (const assoc of affinity.associations) {
      docs.push({
        restaurantId: objectId(restaurantId),
        branchId: branchId ? objectId(branchId) : undefined,
        type: 'BASKET_LIFT_HIGH' as SignalType,
        entityType: 'combo_candidate',
        entityId: `${affinity.productId}|${assoc.consequent}`,
        entityName: `${affinity.productName} + ${assoc.consequentName}`,
        value: assoc.lift,
        baseline: 1.0,
        percentageChange: Math.round((assoc.lift - 1) * 100),
        confidence: assoc.confidence / 100, // Convert from percentage
        minSampleSize: assoc.minCoOccurrence || 5,
        sampleSize: assoc.coOccurrenceCount,
        evidence: [{
          description: `${affinity.productName} → ${assoc.consequentName}: ${assoc.confidence}% confidence, ${assoc.lift}x lift`,
          value: assoc.lift,
          baseline: 1.0,
          percentageChange: Math.round((assoc.lift - 1) * 100),
          sampleSize: assoc.coOccurrenceCount,
          confidence: assoc.confidence / 100,
          metadata: {
            support: assoc.support,
            confidence: assoc.confidence,
            lift: assoc.lift,
            coOccurrenceCount: assoc.coOccurrenceCount,
            antecedentCount: assoc.antecedentCount,
            consequentCount: assoc.consequentCount,
            totalBills: assoc.totalBills,
          },
        }],
        detectedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        consumed: false,
        tags: ['basket_analysis', 'affinity', affinity.category],
      });
    }
  }

  if (docs.length > 0) {
    await IntelligenceSignalModel.insertMany(docs, { ordered: false });
  }
}