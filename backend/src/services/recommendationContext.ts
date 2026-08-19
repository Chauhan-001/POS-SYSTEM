/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationContext.ts — The SINGLE canonical server-side builder for
 * RecommendationContext (Phase 1).
 *
 * Both consumers receive the same relevant business context:
 *   - deterministic offerEngine providers
 *   - the AI offer-recommendation prompt builder
 *
 * Every query is tenant-scoped. Only aggregate counts, names and ids leave
 * this module — never customer PII. No financial computation happens here:
 * margin/wastage/surplus values come from the existing deterministic services
 * (recipeCostEngine → costIntelligenceService → profitabilityService) and
 * OfferAnalytics. The LLM must never become the authority for any of these.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import CustomerModel from '../models/Customer';
import CustomerSegmentModel from '../models/CustomerSegment';
import OfferModel from '../models/Offer';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import BranchModel from '../models/Branch';
import type { RecommendationContext } from './offerEngine';
import { resolveMenuProductScope } from './productService';
import { costIntelligenceService } from '../modules/recipes/services/costIntelligenceService';
import { getOfferPerformance } from './offerAnalyticsService';
import { profitabilityService } from '../modules/recipes/services/profitabilityService';

export interface RecommendationContextOptions {
  /** Optional analytics window (YYYY-MM-DD). Defaults to the service default (last 90 days). */
  analyticsFrom?: string;
  analyticsTo?: string;
  /** Include the heavier deterministic margin/wastage blocks. Default true. */
  includeMargin?: boolean;
  /** Include historical offer performance (OfferAnalytics). Default true. */
  includeAnalytics?: boolean;
  /**
   * Phase 9 — when set, the context is scoped to ONE branch: sales and offer
   * analytics are filtered by branchId and ctx.scope = 'branch'. Products,
   * inventory stock and customer segments remain tenant-level (those models
   * carry no branchId — stock and loyalty are shared across branches by
   * design), which is stated explicitly in the returned context so consumers
   * never silently treat them as branch-specific. A tenant-wide request
   * (branchId omitted) keeps scope = 'tenant' and aggregates all branches.
   */
  branchId?: string;
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Phase 9 — resolve + validate a branch-scope request. Returns the branch
 * ONLY when it genuinely belongs to the given restaurant (tenant isolation:
 * an owner can never scope to another tenant's branch). Returns null when the
 * branchId is absent (tenant-wide) or does not belong to the tenant (the
 * caller should treat that as 400/403).
 */
export async function resolveBranchScope(
  restaurantId: string,
  branchId?: string | null,
): Promise<{ branchId?: string; branchName?: string } | null> {
  if (!branchId) return {};
  const branch = await BranchModel.findOne({
    _id: objectId(String(branchId)),
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  })
    .select('name')
    .lean()
    .exec();
  if (!branch) return null;
  return { branchId: String(branch._id), branchName: branch.name };
}

// ─── Inventory (stock-tracked products) ─────────────────────────────

export async function buildInventoryContext(restaurantId: string, products: any[]): Promise<RecommendationContext['inventory']> {
  const items = products
    .filter((p: any) => typeof p.currentStock === 'number' && (p.minStock > 0 || p.maxStock > 0 || p.currentStock > 0))
    .map((p: any) => ({
      id: String(p._id),
      name: p.name || 'Item',
      category: p.category || 'Inventory',
      currentStock: p.currentStock ?? 0,
      minStock: p.minStock ?? 0,
      maxStock: p.maxStock ?? 0,
      unit: p.unit || 'unit',
      price: p.price ?? 0,
      averageCost: p.averageCost ?? 0,
    }));
  return items.length > 0 ? items : undefined;
}

// ─── Surplus inventory (Phase 4) ────────────────────────────────────
// Deterministic rule, documented: an item is surplus when maxStock > 0 AND
// currentStock >= maxStock × 0.8 (same threshold the inventory clearance
// provider uses). Conflict rule: an item at/below minStock is NEVER surplus —
// low stock is the authoritative state, so the LLM can never be asked to
// promote something the deterministic layer says is running out.

export function deriveSurplusItems(products: any[]): RecommendationContext['surplusStockItems'] {
  const surplus = products
    .filter((p: any) => Number(p.currentStock) >= 0 && Number(p.maxStock) > 0 && Number(p.currentStock) >= Number(p.maxStock) * 0.8)
    // Low stock wins over surplus on inconsistent data.
    .filter((p: any) => !(Number(p.minStock) > 0 && Number(p.currentStock) <= Number(p.minStock)))
    .map((p: any) => ({
      productId: String(p._id),
      productName: p.name || 'Item',
      category: p.category || undefined,
      currentStock: Number(p.currentStock) || 0,
      maxStock: Number(p.maxStock) || 0,
      surplusQuantity: Math.max(0, Math.round((Number(p.currentStock) - Number(p.maxStock) * 0.8) * 100) / 100),
      unit: p.unit || undefined,
      expiryRisk: Boolean(p.expiryDate),
    }));
  return surplus.length > 0 ? surplus : undefined;
}

// ─── Sales (last 30 days, from the restaurant's own bills) ──────────

export async function buildSalesContext(restaurantId: string, products: any[], branchId?: string): Promise<RecommendationContext['sales']> {
  const oid = objectId(restaurantId);
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoff7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const billFilter: any = {
    restaurantId: oid,
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: cutoff30 },
  };
  // Phase 9 — branch-scoped sales: never aggregate other branches.
  if (branchId) billFilter.branchId = objectId(branchId);

  const bills = await BillModel.find(billFilter)
    .select('_id grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) return undefined;

  const billIds = bills.map((b: any) => b._id);
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('itemName quantity priceAtSale billId')
    .lean()
    .exec();

  const nameToCat = new Map<string, string>();
  for (const p of products) {
    if (p.name) nameToCat.set(String(p.name).toLowerCase(), p.category || 'Other');
  }

  const weekdayRevenue = new Array(7).fill(0);
  const hourlyRevenue = new Array(24).fill(0);
  const catStats = new Map<string, { revenue: number; qty: number }>();
  let dailyRevenue = 0, weeklyRevenue = 0, monthlyRevenue = 0;

  for (const b of bills as any[]) {
    const t = new Date(b.createdAt);
    const rev = Number(b.grandTotal) || 0;
    monthlyRevenue += rev;
    if (t >= cutoff7) weeklyRevenue += rev;
    if (t >= todayStart) dailyRevenue += rev;
    weekdayRevenue[t.getDay()] += rev;
    hourlyRevenue[t.getHours()] += rev;
  }

  for (const it of items as any[]) {
    const cat = nameToCat.get(String(it.itemName || '').toLowerCase()) || 'Other';
    const st = catStats.get(cat) || { revenue: 0, qty: 0 };
    st.revenue += (Number(it.priceAtSale) || 0) * (Number(it.quantity) || 0);
    st.qty += Number(it.quantity) || 0;
    catStats.set(cat, st);
  }

  const catList = [...catStats.entries()].map(([name, v]) => ({ name, revenue: Math.round(v.revenue), qty: v.qty }));
  catList.sort((a, b) => b.revenue - a.revenue);
  const avg = monthlyRevenue / bills.length;

  return {
    dailyRevenue: Math.round(dailyRevenue),
    weeklyRevenue: Math.round(weeklyRevenue),
    monthlyRevenue: Math.round(monthlyRevenue),
    orderCount: bills.length,
    averageOrderValue: Math.round(avg),
    topCategories: catList.slice(0, 5),
    weakCategories: catList.slice(-3).reverse(),
    weekdayPerformance: weekdayRevenue.map(Math.round),
    hourlyPerformance: hourlyRevenue.map(Math.round),
  };
}

// ─── Phase 6 — deterministic economic enrichment for proven offers ───
// Non-combo offers in OfferAnalytics carry revenue + discount but no cost.
// To rank by economics instead of raw revenue, attach an estimated
// contribution per offer computed from the CURRENT recipe costs
// (profitabilityService → recipeCostEngine). Bounded: only offers that the
// ProvenOffer provider considers (redemptions >= 3, revenue > 0, non-combo)
// and that have explicit applicability (product ids / categories), capped at
// 4 by revenue so a large history never turns the recommendations call into
// a per-offer economics sweep.

async function attachEstimatedContribution(
  restaurantId: string,
  performance: any[],
): Promise<any[]> {
  const candidates = (performance || [])
    .filter((p) => p.type && p.type !== 'combo' && Number(p.redemptions) >= 3 && Number(p.revenueGenerated) > 0)
    .sort((a, b) => Number(b.revenueGenerated) - Number(a.revenueGenerated))
    .slice(0, 4);
  if (candidates.length === 0) return performance;

  const offerDocs = await OfferModel.find({
    _id: { $in: candidates.map((c) => objectId(c.offerId)) },
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  })
    .select('_id applicableProductIds applicableCategories')
    .lean()
    .exec();
  const docById = new Map(offerDocs.map((o: any) => [String(o._id), o]));

  for (const p of candidates) {
    const doc = docById.get(String(p.offerId));
    if (!doc) continue;
    // Skip whole-menu offers (no explicit applicability) — their blended
    // margin over the entire catalog is a weak signal; the analytics-based
    // score remains the fallback for them.
    const hasApplicability =
      (Array.isArray(doc.applicableProductIds) && doc.applicableProductIds.length > 0) ||
      (Array.isArray(doc.applicableCategories) && doc.applicableCategories.length > 0);
    if (!hasApplicability) continue;
    try {
      const econ = await profitabilityService.offerEconomics(restaurantId, doc);
      const rows = econ.rows || [];
      if (rows.length === 0) continue;
      const totalPrice = rows.reduce((s: number, r: any) => s + (Number(r.sellingPrice) || 0), 0);
      const totalDiscContribution = rows.reduce((s: number, r: any) => s + (Number(r.discountedContribution) || 0), 0);
      if (totalPrice > 0) {
        const marginRate = totalDiscContribution / totalPrice;
        p.contribution = Math.round((Number(p.revenueGenerated) || 0) * marginRate);
        // Deterministic margin RATE (0..1) — lets the ProvenOffer provider apply
        // the same margin-quality gate the combo rule uses (healthy economics
        // only get a "run it again" card), instead of ranking on revenue alone.
        p.contributionMarginRate = Math.round(marginRate * 1000) / 1000;
      }
    } catch {
      // Leave contribution unset — the provider falls back to the
      // deterministic analytics approximation.
    }
  }
  return performance;
}

// ─── The canonical builder ──────────────────────────────────────────

/**
 * Build the full RecommendationContext for a restaurant — the SAME context
 * the deterministic engine and the AI prompt consume. Tenant-scoped,
 * aggregate-only, deterministic economics only.
 */
export async function buildRecommendationContext(
  restaurantId: string,
  opts: RecommendationContextOptions = {},
): Promise<RecommendationContext> {
  const oid = objectId(restaurantId);

  const productScope = await resolveMenuProductScope(String(restaurantId));
  const [
    products,
    customerCount,
    activeCustomers,
    dormant30d,
    vipCount,
    segments,
  ] = await Promise.all([
    ProductModel.find({ $or: productScope, isDeleted: { $ne: true } }).lean(),
    CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }),
    CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, visits: { $gte: 1 } }),
    CustomerModel.countDocuments({
      restaurantId: oid,
      isDeleted: { $ne: true },
      $or: [{ lastVisit: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, { lastVisit: null }, { lastVisit: { $exists: false } }],
    }),
    CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, visits: { $gte: 20 }, points: { $gte: 500 } }),
    CustomerSegmentModel.find({ restaurantId: oid, isDeleted: { $ne: true } })
      .select('name customerCount')
      .sort({ customerCount: -1 })
      .limit(10)
      .lean()
      .exec(),
  ]);

  // Phase 9 — branch scope (validated by the caller: the branch belongs to this tenant).
  let branchName: string | undefined;
  if (opts.branchId) {
    try {
      const branch = await BranchModel.findOne({
        _id: objectId(opts.branchId),
        restaurantId: oid,
        isDeleted: { $ne: true },
      })
        .select('name')
        .lean()
        .exec();
      branchName = branch?.name;
    } catch { /* optional */ }
  }

  const today = new Date().toISOString().split('T')[0];
  const newCustomersToday = await CustomerModel.countDocuments({
    restaurantId: oid,
    isDeleted: { $ne: true },
    createdAt: { $gte: new Date(today) },
  });

  // ── Historical offer performance (OfferAnalytics) ────────────────
  let offerPerformance: any[] = [];
  if (opts.includeAnalytics !== false) {
    try {
      offerPerformance = await getOfferPerformance({
        restaurantId,
        from: opts.analyticsFrom || undefined,
        to: opts.analyticsTo || undefined,
        // Phase 9 — branch-scoped offer analytics (OfferAnalytics rows carry branchId).
        branchId: opts.branchId || undefined,
      });
      // Phase 6 — attach deterministic estimated contribution (recipe costs)
      // so the ProvenOffer provider ranks by economics, not raw revenue.
      offerPerformance = await attachEstimatedContribution(restaurantId, offerPerformance);
    } catch (e: any) {
      console.warn('[RecommendationContext] analytics unavailable (recommendations continue):', e?.message);
    }
  }

  // ── Deterministic inventory + sales ──────────────────────────────
  let inventory: RecommendationContext['inventory'];
  let sales: RecommendationContext['sales'];
  try { inventory = await buildInventoryContext(String(restaurantId), products); } catch { /* optional */ }
  try { sales = await buildSalesContext(String(restaurantId), products, opts.branchId); } catch { /* optional */ }

  // ── Surplus (Phase 4) — deterministic, from the same products ────
  const surplusStockItems = deriveSurplusItems(products);

  // ── Margin + wastage (deterministic services only) ───────────────
  let margin: RecommendationContext['margin'];
  let wastage: RecommendationContext['wastage'];
  if (opts.includeMargin !== false) {
    try {
      const m = await costIntelligenceService.metrics(String(restaurantId), { days: 60 });
      const productMargins = (m.productProfitability || []).map((r: any) => ({
        productId: String(r.productId),
        productName: r.productName,
        category: r.category || undefined,
        sellingPrice: r.sellingPrice || 0,
        recipeCost: r.recipeCost || 0,
        foodCostPercent: r.foodCostPercent || 0,
        contributionMarginPercent: r.contributionMarginPercent || 0,
        unitsSold: r.unitsSold || 0,
        totalContribution: r.totalContribution || 0,
      }));
      const trackedIds = new Set(productMargins.map((pm: any) => pm.productId));
      for (const p of products as any[]) {
        const pid = String(p._id);
        if (trackedIds.has(pid)) continue;
        const price = Number(p.price) || 0;
        const avgCost = Number(p.averageCost) || 0;
        if (price <= 0 || avgCost <= 0) continue;
        const foodCostPercent = Math.round((avgCost / price) * 1000) / 10;
        productMargins.push({
          productId: pid,
          productName: p.name,
          category: p.category || undefined,
          sellingPrice: price,
          recipeCost: avgCost,
          foodCostPercent,
          contributionMarginPercent: Math.max(0, Math.round((100 - foodCostPercent) * 10) / 10),
          unitsSold: 0,
          totalContribution: 0,
        });
      }

      let deterioratingProducts: NonNullable<RecommendationContext['margin']>['deterioratingProducts'] = [];
      try {
        const det = await costIntelligenceService.marginDeterioration(String(restaurantId), { days: 60 });
        deterioratingProducts = (det.rows || []).map((r: any) => ({
          productId: String(r.productId),
          productName: r.productName,
          recipeName: r.recipeName,
          category: r.category || undefined,
          sellingPrice: r.sellingPrice || 0,
          previousRecipeCost: r.previousRecipeCost || 0,
          recipeCost: r.recipeCost || 0,
          recipeCostDelta: r.recipeCostDelta || 0,
          recipeCostPct: r.recipeCostPct || 0,
          previousContributionMarginPercent: r.previousContributionMarginPercent || 0,
          contributionMarginPercent: r.contributionMarginPercent || 0,
          marginDeltaPp: r.marginDeltaPp || 0,
          ingredientName: r.ingredientName || '',
          ingredientPreviousCost: r.ingredientPreviousCost || 0,
          ingredientCurrentCost: r.ingredientCurrentCost || 0,
          ingredientPctChange: r.ingredientPctChange || 0,
        }));
      } catch (e: any) {
        console.warn('[RecommendationContext] margin deterioration unavailable:', e?.message);
      }
      margin = {
        productMargins,
        costRisers: (m.ingredientCostChanges || []).map((c: any) => ({
          itemId: String(c.itemId),
          name: c.name,
          unit: c.unit || undefined,
          currentCost: c.currentCost || 0,
          avgPurchaseCost: c.avgPurchaseCost,
          previousAvgPurchaseCost: c.previousAvgPurchaseCost,
          pctChange: c.pctChange,
        })),
        deterioratingProducts,
      };
      wastage = {
        topItems: (m.wastage?.topItems || []).map((w: any) => ({ name: w.name, qty: w.qty, unit: w.unit, cost: w.cost })),
        items: (m.wastage?.items || []).map((w: any) => ({
          name: w.name, unit: w.unit, qty: w.qty, cost: w.cost, prevQty: w.prevQty || 0, prevCost: w.prevCost || 0,
        })),
        varianceRows: (m.variance?.rows || []).map((r: any) => ({
          name: r.name, unit: r.unit, theoreticalQty: r.theoreticalQty || 0,
          actualQty: r.actualQty || 0, varianceQty: r.varianceQty || 0,
          variancePercent: r.variancePercent || 0, varianceCost: r.varianceCost || 0,
        })),
      };
    } catch (e: any) {
      console.warn('[RecommendationContext] margin context unavailable (recommendations continue):', e?.message);
    }
  }

  const ctx: RecommendationContext = {
    restaurantId,
    // Phase 9 — explicit scope so consumers can never confuse branch-level
    // sales/analytics with tenant-level aggregates (and vice-versa).
    scope: opts.branchId ? 'branch' : 'tenant',
    branchId: opts.branchId || undefined,
    branchName,
    products: products.map((p: any) => ({
      id: p._id.toString(),
      name: p.name,
      category: p.category,
      price: p.price,
      gstPercent: p.gstPercent,
    })),
    customerCount,
    activeCustomers,
    newCustomersToday,
    repeatCustomersToday: Math.max(activeCustomers - newCustomersToday, 0),
    dormant30d,
    vipCount,
    segments: (segments || []).map((s: any) => ({
      id: String(s._id),
      name: s.name,
      customerCount: s.customerCount || 0,
    })),
    offerPerformance,
    inventory,
    surplusStockItems,
    sales,
    margin,
    wastage,
  };
  return ctx;
}
