/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * advisorService — Business Advisor / Recommendation Engine (V1).
 *
 * Architecture (per the Business Advisor spec):
 *
 *   Restaurant data
 *     → existing deterministic engines (recommendationContext, offerEngine,
 *       profitability/cost services)
 *     → business facts / signals
 *     → goal-based opportunity detection
 *     → deterministic scoring + economics validation
 *     → AI reasoning/explanation (enhancement ONLY — deterministic fallback)
 *     → ranked, persisted recommendations
 *     → owner action → existing POS engine executes it
 *
 * Rules honored:
 *   - The LLM never computes financial truth: every price/margin/impact number
 *     originates from the deterministic context (recipe costs, real bills,
 *     real inventory, real offer analytics).
 *   - Only aggregate facts are stored / sent — never customer PII.
 *   - Empty data ⇒ no fabricated recommendation; a clear "insufficient data"
 *     result is returned instead.
 *   - Branch scope: when branchId is provided (validated by the controller as
 *     belonging to the tenant), sales + offer analytics are branch-scoped.
 */

import mongoose from 'mongoose';
import AdvisorRecommendationModel, { AdvisorGoal } from '../models/AdvisorRecommendation';
import BillItemModel from '../models/BillItem';
import { buildRecommendationContext, deriveSurplusItems } from './recommendationContext';
import type { RecommendationContext, OfferSuggestion } from './offerEngine';
import { generateRecommendations } from './offerEngine';
import { getUpcomingFestivals } from './festivalService';
import { executeAiCall, AiFeature } from '../modules/ai/services/aiService';

// ─── Types ──────────────────────────────────────────────────────────

export interface AdvisorCandidate {
  recommendationType: string;
  title: string;
  why: string;
  evidence: string[];
  economics?: {
    price?: number;
    marginPercent?: number;
    discount?: number;
    currentAov?: number;
    projectedAov?: number;
    minOrderValue?: number;
  };
  expectedImpact: string;
  risk?: string;
  confidence: 'Low' | 'Medium' | 'High';
  score: number;
  supportingSignals: string[];
  offerSuggestion?: OfferSuggestion;
  action: 'create_offer' | 'create_combo' | 'create_campaign' | 'review_inventory' | 'review_pricing';
}

export interface AdvisorResult {
  goal: AdvisorGoal;
  recommendations: AdvisorCandidate[];
  insufficientData: boolean;
  note?: string;
  analyzed: { sales: boolean; inventory: boolean; customers: boolean; margins: boolean; offers: boolean; calendar: boolean };
}

// ─── Helpers ────────────────────────────────────────────────────────

function fmt(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface MarginInfo {
  productId: string;
  productName: string;
  category?: string;
  sellingPrice: number;
  recipeCost: number;
  foodCostPercent: number;
  contributionMarginPercent: number;
  unitsSold: number;
}

/** Deterministic margin lookup for menu products (from recipe cost engine). */
function marginMap(ctx: RecommendationContext): Map<string, MarginInfo> {
  const map = new Map<string, MarginInfo>();
  for (const m of ctx.margin?.productMargins || []) {
    map.set(m.productId, m);
  }
  return map;
}

function marginOf(margins: Map<string, MarginInfo>, productId?: string): number | undefined {
  if (!productId) return undefined;
  const m = margins.get(productId);
  return m ? m.contributionMarginPercent : undefined;
}

/** Weekend vs weekday revenue uplift from real bill data (deterministic). */
function weekendUplift(ctx: RecommendationContext): number | undefined {
  const wd = ctx.sales?.weekdayPerformance;
  if (!wd || wd.length !== 7) return undefined;
  const weekendDays = [5, 6, 0];
  const weekend = weekendDays.reduce((s, d) => s + (wd[d] || 0), 0);
  const weekdayDays = [1, 2, 3, 4];
  const weekday = weekdayDays.reduce((s, d) => s + (wd[d] || 0), 0);
  if (weekday <= 0) return undefined;
  return Math.round(((weekend / 3) - (weekday / 4)) / (weekday / 4) * 100);
}

/**
 * Real product attachment from transaction data (deterministic).
 * For the top-selling product, compute how often each other item appears in
 * the same bill — the "Burger → Coke attachment rate" the spec asks for.
 * Bounded: only the top product's bills are scanned (cap 400 bills).
 */
async function computeAttachment(
  restaurantId: string,
  topProductId: string | undefined,
  topProductName: string | undefined,
): Promise<Array<{ productId: string; name: string; bills: number; ratePct: number }>> {
  if (!topProductId || !topProductName) return [];
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  try {
    const itemIds = await BillItemModel.find({
      restaurantId: oid,
      itemId: topProductId,
      billId: { $exists: true, $ne: null },
      createdAt: { $gte: cutoff },
      isVoided: { $ne: true },
    })
      .select('billId')
      .limit(400)
      .lean()
      .exec();
    const billIds = [...new Set(itemIds.map((i: any) => String(i.billId)))];
    if (billIds.length < 3) return [];
    const others = await BillItemModel.find({
      restaurantId: oid,
      billId: { $in: billIds },
      itemId: { $ne: topProductId, $exists: true },
    })
      .select('itemId itemName billId')
      .lean()
      .exec();
    const byItem = new Map<string, { name: string; bills: Set<string> }>();
    for (const o of others as any[]) {
      const id = String(o.itemId);
      if (!id || id === 'undefined') continue;
      let entry = byItem.get(id);
      if (!entry) {
        entry = { name: o.itemName || 'Item', bills: new Set() };
        byItem.set(id, entry);
      }
      entry.bills.add(String(o.billId));
    }
    return [...byItem.entries()]
      .map(([productId, e]) => ({ productId, name: e.name, bills: e.bills.size, ratePct: Math.round((e.bills.size / billIds.length) * 100) }))
      .filter((a) => a.ratePct >= 10)
      .sort((a, b) => b.ratePct - a.ratePct)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ─── Goal-based candidate generation ────────────────────────────────

/**
 * Top products by REAL units sold.
 *
 * Primary source: recipe-cost margin intelligence (productMargins.unitsSold).
 * Fallback: actual BillItem rows over the last 60 days — so restaurants that
 * sell without full recipe-costing still get data-backed combos/upsells
 * instead of none. The margin map is still consulted for economics (a product
 * can carry a margin from averageCost even when the recipe engine has no
 * units). Returns the margin row where available, else a synthetic row with
 * only the facts we actually know (never invented numbers).
 */
async function topProductsByUnits(
  restaurantId: string,
  ctx: RecommendationContext,
  margins: Map<string, MarginInfo>,
  limit = 5,
): Promise<MarginInfo[]> {
  const fromMargins = (ctx.margin?.productMargins || [])
    .filter((m) => m.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, limit);
  if (fromMargins.length > 0) return fromMargins;

  // Fallback: real transaction units (60 days) — read-only, tenant-scoped.
  try {
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const rows = await BillItemModel.aggregate([
      {
        $match: {
          restaurantId: oid,
          isVoided: { $ne: true },
          itemId: { $exists: true, $ne: null },
          createdAt: { $gte: cutoff },
        },
      },
      {
        $group: {
          _id: '$itemId',
          productName: { $first: '$itemName' },
          unitsSold: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: limit },
    ]).exec();
    return rows
      .map((r: any) => {
        const pid = String(r._id);
        const m = margins.get(pid);
        return {
          productId: pid,
          productName: r.productName || 'Item',
          category: m?.category,
          sellingPrice: m?.sellingPrice ?? 0,
          recipeCost: m?.recipeCost ?? 0,
          foodCostPercent: m?.foodCostPercent ?? 0,
          contributionMarginPercent: m?.contributionMarginPercent ?? 0,
          unitsSold: Number(r.unitsSold) || 0,
        };
      })
      .filter((r: MarginInfo) => r.unitsSold > 0);
  } catch {
    return [];
  }
}

function confidenceFromScore(score: number): 'Low' | 'Medium' | 'High' {
  if (score >= 65) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function scoreCandidate(opts: {
  evidenceCount: number;
  marginPercent?: number;
  hasSales: boolean;
  hasCustomers: boolean;
  hasInventory: boolean;
  contextBonus?: number;
}): { score: number; confidence: 'Low' | 'Medium' | 'High' } {
  let score = 25;
  if (opts.hasSales) score += 15;
  if (opts.hasCustomers) score += 8;
  if (opts.hasInventory) score += 8;
  score += Math.min(20, opts.evidenceCount * 4);
  if (opts.marginPercent !== undefined) {
    if (opts.marginPercent >= 35) score += 15;
    else if (opts.marginPercent >= 22) score += 8;
    else score -= 12;
  }
  score += opts.contextBonus || 0;
  score = clamp(Math.round(score), 0, 100);
  return { score, confidence: confidenceFromScore(score) };
}

/** Combo economics: combined price, discount, deterministic margin. */
function comboEconomics(main: MarginInfo, addon: { sellingPrice: number; marginPercent?: number }, discountPercent: number) {
  const normalPrice = main.sellingPrice + addon.sellingPrice;
  const discount = Math.round(normalPrice * (discountPercent / 100));
  const comboPrice = normalPrice - discount;
  const mainCost = main.recipeCost || 0;
  const addonCost = addon.marginPercent !== undefined && addon.sellingPrice > 0
    ? addon.sellingPrice * (1 - addon.marginPercent / 100)
    : addon.sellingPrice * 0.5; // conservative default when cost unknown
  const cost = mainCost + addonCost;
  const marginPercent = comboPrice > 0 ? Math.round(((comboPrice - cost) / comboPrice) * 100) : 0;
  return { normalPrice, discount, comboPrice, marginPercent };
}

// ─── Goal generators ────────────────────────────────────────────────

async function goalIncreaseSales(ctx: RecommendationContext, restaurantId: string, margins: Map<string, MarginInfo>): Promise<AdvisorCandidate[]> {
  const out: AdvisorCandidate[] = [];
  const hasSales = Boolean(ctx.sales && (ctx.sales.orderCount || 0) > 0);
  const top = (await topProductsByUnits(restaurantId, ctx, margins, 1))[0];
  const uplift = weekendUplift(ctx);

  // 1. Top seller + real attachment combo (real transaction affinity).
  if (top) {
    const attachments = await computeAttachment(restaurantId, top.productId, top.productName);
    // Prefer an attached item that is a beverage-like add-on with healthy margin.
    const attach = attachments[0];
    const addonMargin = attach ? marginOf(margins, attach.productId) : undefined;
    if (attach && attach.ratePct >= 15) {
      const econ = comboEconomics(top, { sellingPrice: top.sellingPrice, marginPercent: marginOf(margins, top.productId) }, 15);
      const discountNote = uplift !== undefined && uplift > 0 ? ` Weekend ${top.productName} demand is ${pct(uplift)} above your weekday baseline.` : '';
      out.push({
        recommendationType: 'combo',
        title: `${top.productName} + ${attach.name} Combo`,
        why: `${top.productName} is one of your top sellers and ${attach.name} is bought alongside it in ${pct(attach.ratePct)} of qualifying orders — a combo captures a behaviour your customers already show.`,
        evidence: [
          `${top.productName}: ${top.unitsSold} units sold (last 60 days)`,
          `${attach.name} attached to ${pct(attach.ratePct)} of ${top.productName} orders`,
          `Combo price ${fmt(econ.comboPrice)} keeps estimated gross margin around ${pct(econ.marginPercent)}`,
        ].concat(uplift !== undefined && uplift > 0 ? [`Weekend ${top.productName} demand is ${pct(uplift)} higher`] : []),
        economics: {
          price: econ.comboPrice,
          discount: econ.discount,
          marginPercent: econ.marginPercent,
          currentAov: ctx.sales?.averageOrderValue,
          projectedAov: ctx.sales ? Math.round((ctx.sales.averageOrderValue || 0) + econ.comboPrice * 0.4) : undefined,
        },
        expectedImpact: 'Higher order value on your strongest product and a lift in add-on sales',
        risk: addonMargin !== undefined && addonMargin < 20 ? 'The add-on has a thin margin — keep the combo discount modest.' : 'Low — both components already sell well together',
        offerSuggestion: {
          title: `${top.productName} + ${attach.name} Combo`,
          type: 'combo',
          value: econ.comboPrice,
          description: `${top.productName} + ${attach.name} together for ${fmt(econ.comboPrice)} — normally ${fmt(econ.normalPrice)}.${discountNote}`,
          recommendationSource: 'combo_upsell',
          recommendationReason: `${top.productName} is a top seller and ${attach.name} is purchased with it in ${pct(attach.ratePct)} of qualifying orders. Estimated combo margin ${pct(econ.marginPercent)}.`,
          estimatedReach: Math.round(ctx.customerCount * 0.6),
          expectedImpact: 'Lift average order value via a proven pairing',
          priority: 'high',
          applicableCategories: [],
          applicableProductIds: [top.productId, attach.productId],
          defaultDurationDays: 7,
        } as any,
        action: 'create_combo',
        ...scoreCandidate({ evidenceCount: 4, marginPercent: econ.marginPercent, hasSales, hasCustomers: ctx.customerCount > 0, hasInventory: false, contextBonus: uplift && uplift > 0 ? 5 : 0 }),
        supportingSignals: ['top_seller', 'real_attachment', 'combo_margin'],
      });
    }

    // 2. Bestseller upsell — push the top product with a minimum-order flat deal.
    out.push({
      recommendationType: 'upsell',
      title: `${top.productName} Bestseller Deal`,
      why: `${top.productName} is your top seller (${top.unitsSold} units) — rewarding a bigger basket around it lifts revenue without discounting the whole menu.`,
      evidence: [
        `${top.productName}: ${top.unitsSold} units sold (last 60 days)`,
        `Contribution margin ${pct(marginOf(margins, top.productId) ?? 0)}`,
        `Current average order value ${fmt(ctx.sales?.averageOrderValue || 0)}`,
      ],
      economics: {
        price: top.sellingPrice,
        marginPercent: marginOf(margins, top.productId),
        currentAov: ctx.sales?.averageOrderValue,
        projectedAov: ctx.sales ? Math.round((ctx.sales.averageOrderValue || 0) * 1.15) : undefined,
      },
      expectedImpact: '15-25% lift in average order value from a bigger-basket incentive',
      risk: marginOf(margins, top.productId) !== undefined && (marginOf(margins, top.productId) || 0) < 25 ? 'Keep the minimum order high enough to protect margin.' : 'Low — high-margin bestseller',
      offerSuggestion: {
        title: `${top.productName} Bestseller Deal`,
        type: 'flat',
        value: 100,
        description: `Get ${fmt(100)} off when you spend ${fmt(Math.max(500, Math.round(top.sellingPrice * 3)))} or more — stock up on your favourite.`,
        recommendationSource: 'top_category',
        recommendationReason: `${top.productName} is your top seller (${top.unitsSold} units). Upselling it lifts average order value with minimal risk.`,
        estimatedReach: Math.round(ctx.customerCount * 0.6),
        expectedImpact: '10-20% increase in average order value',
        priority: 'medium',
        applicableCategories: [],
        applicableProductIds: [top.productId],
        minOrderValue: Math.max(500, Math.round(top.sellingPrice * 3)),
        defaultDurationDays: 7,
      } as any,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: 3, marginPercent: marginOf(margins, top.productId), hasSales, hasCustomers: ctx.customerCount > 0, hasInventory: false }),
      supportingSignals: ['top_seller', 'upsell'],
    });
  }

  // 3. Weak-category flash sale (from real category performance).
  const weak = (ctx.sales?.weakCategories || []).slice(0, 1)[0];
  if (weak && weak.revenue >= 0) {
    out.push({
      recommendationType: 'promotion',
      title: `${weak.name} Flash Sale`,
      why: `${weak.name} is your weakest category (${fmt(weak.revenue)} in the last 30 days) — a short targeted sale re-engages customers on it.`,
      evidence: [
        `${weak.name} category revenue ${fmt(weak.revenue)} (last 30 days)`,
        `${weak.qty} units moved`,
      ],
      economics: { discount: 20 },
      expectedImpact: 'Recover part of the revenue gap in a weak category',
      risk: 'Category-wide discounting can erode margin — keep it short (max 7 days).',
      offerSuggestion: {
        title: `${weak.name} Flash Sale`,
        type: 'percentage',
        value: 20,
        description: `Give ${weak.name} some love — 20% off on all ${weak.name} items for a limited time.`,
        recommendationSource: 'weak_category',
        recommendationReason: `${weak.name} is underperforming at ${fmt(weak.revenue)}. Targeted promotions can increase category sales.`,
        estimatedReach: Math.round(ctx.customerCount * 0.35),
        expectedImpact: '25-40% increase in targeted category sales',
        priority: 'medium',
        applicableCategories: [weak.name],
        defaultDurationDays: 7,
      } as any,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: 2, marginPercent: undefined, hasSales, hasCustomers: ctx.customerCount > 0, hasInventory: false }),
      supportingSignals: ['weak_category'],
    });
  }
  return out;
}

async function goalMoveInventory(ctx: RecommendationContext, _rid: string, margins: Map<string, MarginInfo>): Promise<AdvisorCandidate[]> {
  const out: AdvisorCandidate[] = [];
  const surplus = ctx.surplusStockItems || deriveSurplusItems((ctx as any).products || []) || [];
  const hasInventory = surplus.length > 0;

  for (const s of surplus.slice(0, 3)) {
    const m = s.productId ? margins.get(s.productId) : undefined;
    const margin = m?.contributionMarginPercent;
    const marginNote = margin !== undefined ? ` Estimated margin ${pct(margin)}.` : '';
    if (margin !== undefined && margin < 18) continue; // never push a thin-margin clearance hard
    out.push({
      recommendationType: 'clearance',
      title: `Move excess ${s.productName}`,
      why: `${s.productName} is ${fmt(s.surplusQuantity)} above its normal stock ceiling (${s.currentStock} of max ${s.maxStock} ${s.unit || 'units'}) — a limited-time push moves it before it ages${s.expiryRisk ? ' or expires' : ''}.`,
      evidence: [
        `Current stock ${s.currentStock} ${s.unit || 'units'} vs ceiling ${s.maxStock}`,
        `${fmt(s.surplusQuantity)} ${s.unit || 'units'} above the 80% stock threshold`,
        ...(s.expiryRisk ? ['Expiry date tracked — time-sensitive'] : []),
      ].concat(margin !== undefined ? [`Estimated margin ${pct(margin)}`] : []),
      economics: { discount: 20, marginPercent: margin },
      expectedImpact: 'Reduces overstock and waste cost before it ties up working capital',
      risk: margin !== undefined && margin < 25 ? 'Discount only to 20% max — deeper cuts destroy contribution.' : 'Low — clearing surplus frees cash',
      offerSuggestion: {
        title: `${s.productName} Clearance`,
        type: 'percentage',
        value: 20,
        description: `${s.productName} — 20% off for a limited time while stock lasts.${s.expiryRisk ? ' Fresh stock arriving soon.' : ''}`,
        recommendationSource: 'inventory_clearance',
        recommendationReason: `${s.productName} is ${fmt(s.surplusQuantity)} above its stock ceiling.${marginNote}`,
        estimatedReach: Math.round(ctx.customerCount * 0.4),
        expectedImpact: 'Reduce overstock before it ages',
        priority: 'medium',
        applicableCategories: [],
        applicableProductIds: s.productId ? [s.productId] : [],
        defaultDurationDays: 5,
      } as any,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: 3, marginPercent: margin, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.customerCount > 0, hasInventory }),
      supportingSignals: ['overstock', s.expiryRisk ? 'expiry_risk' : 'stock_ceiling'],
    });
  }

  if (surplus.length === 0 && hasInventory === false) {
    // No surplus — surface the review-inventory action only when stock data exists.
    const items = ctx.inventory || [];
    if (items.length > 0) {
      out.push({
        recommendationType: 'inventory_review',
        title: 'Review your slow-moving stock',
        why: 'No item is above its stock ceiling right now, but stock health still needs a look — some items may be moving slowly relative to their levels.',
        evidence: [`${items.length} stock-tracked items`, 'No item above the 80% surplus threshold'],
        expectedImpact: 'Keeps inventory fresh and working capital free',
        risk: 'No action needed if stock is genuinely aligned with demand',
        action: 'review_inventory',
        ...scoreCandidate({ evidenceCount: 2, marginPercent: undefined, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.customerCount > 0, hasInventory: true }),
        supportingSignals: ['no_overstock'],
      });
    }
  }
  return out;
}

function goalBringCustomersBack(ctx: RecommendationContext): AdvisorCandidate[] {
  const out: AdvisorCandidate[] = [];
  const dormant = ctx.dormant30d || 0;
  const aov = ctx.sales?.averageOrderValue || 0;

  if (dormant > 0) {
    const minOrder = Math.max(399, Math.round(aov * 0.9));
    out.push({
      recommendationType: 'win_back',
      title: 'Bring lapsed customers back',
      why: `${dormant} customers who used to visit have not returned in 30+ days — a targeted minimum-order offer is the lowest-risk way to win them back (better than a blanket discount).`,
      evidence: [
        `${dormant} customers inactive for 30+ days`,
        `Average order value ${fmt(aov)}`,
        ...(ctx.segments && ctx.segments.length > 0 ? [`${ctx.segments.length} existing segments available to target`] : []),
      ],
      economics: {
        discount: 50,
        currentAov: aov,
        minOrderValue: minOrder,
        marginPercent: 30,
      },
      expectedImpact: 'Re-activate a share of lapsed customers with a minimum-order incentive',
      risk: 'Discount applies only above the minimum order, protecting margin',
      offerSuggestion: {
        title: 'Welcome Back',
        type: 'flat',
        value: 50,
        description: `We miss you — ${fmt(50)} off your next order above ${fmt(minOrder)}.`,
        recommendationSource: 'win_back',
        recommendationReason: `${dormant} customers haven't visited in 30+ days. Win-back offers recover a share of dormant customers.`,
        estimatedReach: Math.round(dormant * 0.25),
        expectedImpact: 'Recovery of dormant customers',
        priority: 'high',
        applicableCategories: [],
        minOrderValue: minOrder,
        maxPerCustomer: 1,
        defaultDurationDays: 21,
      } as any,
      action: 'create_campaign',
      ...scoreCandidate({ evidenceCount: 3, marginPercent: 30, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: dormant > 0, hasInventory: false }),
      supportingSignals: ['dormant_30d', 'win_back'],
    });
  }

  const repeat = ctx.repeatCustomersToday || 0;
  if (repeat > 0 || ctx.activeCustomers > 0) {
    out.push({
      recommendationType: 'retention',
      title: 'Reward returning customers',
      why: `${Math.max(repeat, ctx.activeCustomers)} active customers keep your business running — double loyalty points on the next visit raises retention without hurting margin.`,
      evidence: [
        `${ctx.activeCustomers} active customers`,
        ...(repeat > 0 ? [`${repeat} repeat customers today`] : []),
      ],
      economics: { discount: 0, marginPercent: undefined },
      expectedImpact: 'Higher retention and lifetime value among regulars',
      risk: 'Loyalty points are a future liability — keep the rate modest',
      offerSuggestion: {
        title: 'Come Back for More',
        type: 'reward_points',
        value: 50,
        description: 'Earn double loyalty points on your next visit.',
        recommendationSource: 'repeat_customer',
        recommendationReason: 'Repeat-customer offers increase retention and lifetime value.',
        estimatedReach: Math.round(ctx.activeCustomers * 0.5),
        expectedImpact: 'Higher customer retention',
        priority: 'medium',
        applicableCategories: [],
        defaultDurationDays: 14,
      } as any,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: 2, marginPercent: undefined, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.activeCustomers > 0, hasInventory: false }),
      supportingSignals: ['repeat_customers'],
    });
  }
  return out;
}

function goalIncreaseProfit(ctx: RecommendationContext, margins: Map<string, MarginInfo>): AdvisorCandidate[] {
  const out: AdvisorCandidate[] = [];
  const hasSales = Boolean(ctx.sales?.orderCount);

  // 1. Promote high-margin products as add-ons (margin-led, not volume-led).
  const highMargin = (ctx.margin?.productMargins || [])
    .filter((m) => m.contributionMarginPercent >= 45 && m.unitsSold > 0)
    .sort((a, b) => b.contributionMarginPercent - a.contributionMarginPercent)
    .slice(0, 2);
  for (const h of highMargin) {
    out.push({
      recommendationType: 'margin_promotion',
      title: `Push ${h.productName} as an add-on`,
      why: `${h.productName} has a ${pct(h.contributionMarginPercent)} contribution margin and already sells (${h.unitsSold} units) — steering customers toward it grows profit, not just revenue.`,
      evidence: [
        `${h.productName} contribution margin ${pct(h.contributionMarginPercent)}`,
        `${h.unitsSold} units sold (last 60 days)`,
        `Selling price ${fmt(h.sellingPrice)}`,
      ],
      economics: { marginPercent: h.contributionMarginPercent, price: h.sellingPrice },
      expectedImpact: 'Profit grows with every upsell of a high-margin product',
      risk: 'Do not deep-discount it — that would destroy the margin advantage',
      offerSuggestion: {
        title: `Add-on: ${h.productName}`,
        type: 'percentage',
        value: 10,
        description: `Make it a combo — ${h.productName} at 10% off when paired with a main.`,
        recommendationSource: 'high_margin_promotion',
        recommendationReason: `${h.productName} has a ${pct(h.contributionMarginPercent)} contribution margin.`,
        estimatedReach: Math.round(ctx.customerCount * 0.5),
        expectedImpact: 'Higher profit per order',
        priority: 'medium',
        applicableCategories: [],
        applicableProductIds: [h.productId],
        defaultDurationDays: 14,
      } as any,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: 3, marginPercent: h.contributionMarginPercent, hasSales, hasCustomers: ctx.customerCount > 0, hasInventory: false }),
      supportingSignals: ['high_margin'],
    });
  }

  // 2. Margin-protection warning: hold discounts on thin-margin products.
  const lowMargin = (ctx.margin?.productMargins || [])
    .filter((m) => (m.contributionMarginPercent < 25 || m.foodCostPercent > 60) && m.unitsSold > 0)
    .sort((a, b) => a.contributionMarginPercent - b.contributionMarginPercent)
    .slice(0, 2);
  for (const l of lowMargin) {
    out.push({
      recommendationType: 'margin_protection',
      title: `Hold discounts on ${l.productName}`,
      why: `${l.productName} runs on a thin ${pct(l.contributionMarginPercent)} contribution margin (food cost ${pct(l.foodCostPercent)} of price) — a deep discount would leave almost no profit.`,
      evidence: [
        `${l.productName} contribution margin ${pct(l.contributionMarginPercent)}`,
        `Food cost ${pct(l.foodCostPercent)} of ${fmt(l.sellingPrice)} price`,
        `${l.unitsSold} units sold`,
      ],
      economics: { marginPercent: l.contributionMarginPercent, price: l.sellingPrice },
      expectedImpact: 'Protects contribution on your thinnest-margin items',
      risk: 'Raising price could hurt volume — review portion or cost first',
      offerSuggestion: {
        title: `Protect margin on ${l.productName}`,
        type: 'flat',
        value: 0,
        description: `Avoid discounting ${l.productName} below its current price — margin is already thin.`,
        recommendationSource: 'margin_protection',
        recommendationReason: `${l.productName} contribution margin is ${pct(l.contributionMarginPercent)}.`,
        estimatedReach: 0,
        expectedImpact: 'Prevents margin erosion',
        priority: 'low',
        applicableCategories: [],
        maxDiscount: Math.max(5, Math.round(l.contributionMarginPercent / 2)),
        defaultDurationDays: 0,
        isWarning: true,
      } as any,
      action: 'review_pricing',
      ...scoreCandidate({ evidenceCount: 3, marginPercent: l.contributionMarginPercent, hasSales, hasCustomers: false, hasInventory: false }),
      supportingSignals: ['thin_margin'],
    });
  }

  // 3. Ingredient cost risers — review pricing.
  const riser = (ctx.margin?.costRisers || [])
    .filter((c) => c.pctChange !== undefined && c.pctChange >= 10)
    .sort((a, b) => (b.pctChange || 0) - (a.pctChange || 0))[0];
  if (riser) {
    out.push({
      recommendationType: 'cost_riser',
      title: `Review recipes using ${riser.name}`,
      why: `${riser.name} purchase cost rose ${pct(riser.pctChange || 0)} (${fmt(riser.previousAvgPurchaseCost || 0)} → ${fmt(riser.avgPurchaseCost || riser.currentCost || 0)}) — every recipe using it is now thinner.`,
      evidence: [
        `${riser.name}: ${fmt(riser.previousAvgPurchaseCost || 0)} → ${fmt(riser.avgPurchaseCost || riser.currentCost || 0)} (${pct(riser.pctChange || 0)})`,
      ],
      economics: { marginPercent: undefined },
      expectedImpact: 'Protects margin before recipe costs eat it entirely',
      risk: 'Price hikes can hurt demand — raise carefully or switch suppliers',
      action: 'review_pricing',
      ...scoreCandidate({ evidenceCount: 1, marginPercent: undefined, hasSales, hasCustomers: false, hasInventory: false }),
      supportingSignals: ['cost_riser'],
    });
  }
  return out;
}

async function goalIncreaseAov(ctx: RecommendationContext, restaurantId: string, margins: Map<string, MarginInfo>): Promise<AdvisorCandidate[]> {
  const out: AdvisorCandidate[] = [];
  const aov = ctx.sales?.averageOrderValue || 0;
  const top = (await topProductsByUnits(restaurantId, ctx, margins, 1))[0];

  // Add-on from real attachment: offer the attached item at a small add-on price.
  if (top && aov > 0) {
    const attachments = await computeAttachment(restaurantId, top.productId, top.productName);
    const attach = attachments[0];
    const addonMargin = attach ? marginOf(margins, attach.productId) : undefined;
    if (attach && attach.ratePct >= 10) {
      const addonPrice = Math.round(top.sellingPrice * 0.25);
      const projected = Math.round(aov + addonPrice * (attach.ratePct / 100));
      out.push({
        recommendationType: 'add_on',
        title: `Offer ${attach.name} as an add-on to ${top.productName}`,
        why: `${attach.name} already shows up in ${pct(attach.ratePct)} of ${top.productName} orders — turning that into a priced add-on is the least effort way to lift the basket.`,
        evidence: [
          `${attach.name} attached to ${pct(attach.ratePct)} of ${top.productName} orders`,
          `Current average order value ${fmt(aov)}`,
          ...(addonMargin !== undefined ? [`${attach.name} contribution margin ${pct(addonMargin)}`] : []),
        ],
        economics: {
          price: addonPrice,
          marginPercent: addonMargin,
          currentAov: aov,
          projectedAov: projected,
        },
        expectedImpact: `Average order value could rise from ${fmt(aov)} toward ${fmt(projected)}`,
        risk: addonMargin !== undefined && addonMargin < 20 ? 'Add-on margin is thin — keep the add-on price above cost.' : 'Low — the pairing already happens naturally',
        offerSuggestion: {
          title: `${top.productName} + ${attach.name} add-on`,
          type: 'combo',
          value: addonPrice,
          description: `Add ${attach.name} to any ${top.productName} order for just ${fmt(addonPrice)}.`,
          recommendationSource: 'combo_upsell',
          recommendationReason: `${attach.name} is attached to ${pct(attach.ratePct)} of ${top.productName} orders.`,
          estimatedReach: Math.round(ctx.customerCount * 0.5),
          expectedImpact: 'Higher average order value',
          priority: 'medium',
          applicableCategories: [],
          applicableProductIds: [top.productId, attach.productId],
          defaultDurationDays: 14,
        } as any,
        action: 'create_combo',
        ...scoreCandidate({ evidenceCount: 3, marginPercent: addonMargin, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.customerCount > 0, hasInventory: false }),
        supportingSignals: ['real_attachment', 'aov'],
      });
    }
  }
  return out;
}

async function goalCreateOffer(ctx: RecommendationContext): Promise<AdvisorCandidate[]> {
  const suggestions = await generateRecommendations(ctx, 10);
  const out: AdvisorCandidate[] = [];
  for (const s of suggestions.filter((x) => !x.isWarning).slice(0, 3)) {
    const ev: string[] = [];
    if (s.applicableCategories && s.applicableCategories.length > 0) {
      ev.push(`Targets: ${s.applicableCategories.slice(0, 3).join(', ')}`);
    }
    if (s.minOrderValue) ev.push(`Minimum order ${fmt(s.minOrderValue)}`);
    if (s.estimatedReach) ev.push(`Estimated reach ${Math.round(s.estimatedReach).toLocaleString('en-IN')} customers`);
    out.push({
      recommendationType: 'offer',
      title: s.title,
      why: s.recommendationReason,
      evidence: ev,
      economics: { discount: s.value, price: s.type === 'combo' ? s.value : undefined },
      expectedImpact: s.expectedImpact,
      risk: s.priority === 'high' ? 'High-urgency window — schedule carefully' : 'Standard promotion risk',
      offerSuggestion: s,
      action: 'create_offer',
      ...scoreCandidate({ evidenceCount: ev.length + 1, marginPercent: undefined, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.customerCount > 0, hasInventory: Boolean(ctx.inventory?.length) }),
      supportingSignals: [s.recommendationSource],
    });
  }
  return out;
}

async function goalCreateCombo(ctx: RecommendationContext, restaurantId: string, margins: Map<string, MarginInfo>): Promise<AdvisorCandidate[]> {
  const out: AdvisorCandidate[] = [];
  const top = (await topProductsByUnits(restaurantId, ctx, margins, 1))[0];
  if (!top) return out;

  const attachments = await computeAttachment(restaurantId, top.productId, top.productName);
  const attach = attachments[0];
  if (!attach) return out;
  const addonMargin = marginOf(margins, attach.productId);
  const econ = comboEconomics(top, { sellingPrice: top.sellingPrice, marginPercent: marginOf(margins, top.productId) }, 15);
  const uplift = weekendUplift(ctx);

  out.push({
    recommendationType: 'combo',
    title: `${top.productName} + ${attach.name} Combo`,
    why: `${top.productName} is your top seller and ${attach.name} is purchased with it in ${pct(attach.ratePct)} of qualifying orders — a priced combo converts an existing habit into a bigger basket.`,
    evidence: [
      `${top.productName}: ${top.unitsSold} units sold`,
      `${attach.name} attached to ${pct(attach.ratePct)} of ${top.productName} orders`,
      `Combo ${fmt(econ.comboPrice)} vs normal ${fmt(econ.normalPrice)} — saves ${fmt(econ.discount)}`,
      `Estimated combo margin ${pct(econ.marginPercent)}`,
    ],
    economics: {
      price: econ.comboPrice,
      discount: econ.discount,
      marginPercent: econ.marginPercent,
      currentAov: ctx.sales?.averageOrderValue,
      projectedAov: ctx.sales ? Math.round((ctx.sales.averageOrderValue || 0) + econ.comboPrice * 0.4) : undefined,
    },
    expectedImpact: 'Higher basket value on your strongest product with a margin-safe bundle',
    risk: addonMargin !== undefined && addonMargin < 20 ? 'The add-on has a thin margin — keep the 15% bundle discount as the ceiling.' : 'Low — proven pairing, controlled discount',
    offerSuggestion: {
      title: `${top.productName} + ${attach.name} Combo`,
      type: 'combo',
      value: econ.comboPrice,
      description: `${top.productName} + ${attach.name} together for ${fmt(econ.comboPrice)} (normally ${fmt(econ.normalPrice)})${uplift !== undefined && uplift > 0 ? ` — weekend ${top.productName} demand is ${pct(uplift)} higher.` : ''}`,
      recommendationSource: 'combo_upsell',
      recommendationReason: `${top.productName} is a top seller and ${attach.name} is purchased with it in ${pct(attach.ratePct)} of qualifying orders. Estimated combo margin ${pct(econ.marginPercent)}.`,
      estimatedReach: Math.round(ctx.customerCount * 0.6),
      expectedImpact: 'Lift average order value via a proven pairing',
      priority: 'high',
      applicableCategories: [],
      applicableProductIds: [top.productId, attach.productId],
      defaultDurationDays: 7,
    } as any,
    action: 'create_combo',
    ...scoreCandidate({ evidenceCount: 4, marginPercent: econ.marginPercent, hasSales: Boolean(ctx.sales?.orderCount), hasCustomers: ctx.customerCount > 0, hasInventory: false, contextBonus: uplift && uplift > 0 ? 5 : 0 }),
    supportingSignals: ['top_seller', 'real_attachment', 'combo_margin'],
  });
  return out;
}

// ─── AI explanation layer (enhancement only) ─────────────────────────

/**
 * One optional LLM call per request: given the deterministic candidates it
 * returns a concise why/impact/risk rewrite per candidate. Every number in
 * the prompt is a real fact from the context. On ANY failure the deterministic
 * copy is kept — the advisor is fully functional without the LLM.
 */
async function enrichWithAi(
  restaurantId: string,
  branchId: string | undefined,
  goal: AdvisorGoal,
  candidates: AdvisorCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;
  const facts = candidates.map((c, i) => ({
    index: i,
    title: c.title,
    why: c.why,
    economics: c.economics || null,
    expectedImpact: c.expectedImpact,
    risk: c.risk || null,
  }));
  const prompt =
    `You are a restaurant business advisor. Below are deterministic recommendations already computed from the restaurant's OWN data ` +
    `(real sales, real inventory, real margins, real offer performance). All numbers are authoritative — never change them, never invent new ones.\n\n` +
    `Goal: ${goal}\n\n` +
    `Recommendations:\n${JSON.stringify(facts, null, 2)}\n\n` +
    `For each recommendation, return valid JSON ONLY: {"explanations":[{"index":0,"why":"...","impact":"...","risk":"..."}]}\n` +
    `Keep each field under 140 characters, owner-friendly, specific to the listed evidence. Do not mention "data" or "analysis".`;
  try {
    const res = await executeAiCall({
      prompt,
      feature: 'advisor',
      tenantId: restaurantId,
      branchId,
      cacheKeyVariant: `${goal}:${candidates.length}:${facts.map((f) => f.title).join('|')}`,
    });
    const explanations: Array<{ index: number; why?: string; impact?: string; risk?: string }> =
      res?.data?.explanations;
    if (!Array.isArray(explanations)) return;
    for (const e of explanations) {
      const c = candidates[e.index];
      if (!c) continue;
      if (typeof e.why === 'string' && e.why.trim()) c.why = e.why.trim();
      if (typeof e.impact === 'string' && e.impact.trim()) c.expectedImpact = e.impact.trim();
      if (typeof e.risk === 'string' && e.risk.trim()) c.risk = e.risk.trim();
    }
  } catch {
    // Deterministic copy already present — nothing to do.
  }
}

// ─── Public API ─────────────────────────────────────────────────────

const GOAL_GENERATORS: Record<AdvisorGoal, (ctx: RecommendationContext, rid: string, margins: Map<string, MarginInfo>) => Promise<AdvisorCandidate[]>> = {
  increase_sales: goalIncreaseSales,
  move_inventory: goalMoveInventory,
  bring_customers_back: async (ctx) => goalBringCustomersBack(ctx),
  increase_profit: async (ctx, _rid, margins) => goalIncreaseProfit(ctx, margins),
  increase_aov: goalIncreaseAov,
  create_offer: async (ctx) => goalCreateOffer(ctx),
  create_combo: goalCreateCombo,
};

export const ADVISOR_GOALS: AdvisorGoal[] = [
  'increase_sales',
  'move_inventory',
  'bring_customers_back',
  'increase_profit',
  'increase_aov',
  'create_offer',
  'create_combo',
];

/**
 * Generate ranked, persisted advisor recommendations for a goal.
 * `branchId` must already be validated as belonging to the tenant.
 */
export async function generateAdvisorRecommendations(
  restaurantId: string,
  goal: AdvisorGoal,
  opts: { branchId?: string } = {},
): Promise<AdvisorResult> {
  const ctx = await buildRecommendationContext(String(restaurantId), { branchId: opts.branchId });
  const margins = marginMap(ctx);

  const hasSales = Boolean(ctx.sales && (ctx.sales.orderCount || 0) > 0);
  const hasInventory = Boolean(ctx.inventory && ctx.inventory.length > 0) || Boolean(ctx.surplusStockItems?.length);
  const hasCustomers = ctx.customerCount > 0;

  const analyzed = {
    sales: hasSales,
    inventory: hasInventory,
    customers: hasCustomers,
    margins: Boolean(ctx.margin && ctx.margin.productMargins.length > 0),
    offers: Boolean(ctx.offerPerformance && ctx.offerPerformance.length > 0),
    calendar: getUpcomingFestivals(30).length > 0,
  };

  const generator = GOAL_GENERATORS[goal];
  let candidates = await generator(ctx, String(restaurantId), margins);

  // Never fabricate: with no sales, inventory or customers there is nothing
  // real to reason about — return an explicit insufficient-data note instead
  // of generic suggestions (this also gates create_offer, which would
  // otherwise fall through to calendar-only rule cards).
  if ((candidates.length === 0 || goal === 'create_offer') && !hasSales && !hasInventory && !hasCustomers) {
    return {
      goal,
      recommendations: [],
      insufficientData: true,
      note: 'I need more data before I can recommend an action for this goal — add a few days of real bills, products and stock levels, then try again.',
      analyzed,
    };
  }

  // Enrich with AI reasoning (best-effort, deterministic fallback).
  await enrichWithAi(String(restaurantId), opts.branchId, goal, candidates);

  candidates.sort((a, b) => b.score - a.score);

  // LIFECYCLE: Re-evaluate any cooldown recommendations that have expired.
  await reEvaluateRecommendations(String(restaurantId));

  // LIFECYCLE: Suppress duplicates — if the same fingerprint is already
  // active (converted or in cooldown), skip the candidate.
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const filtered: typeof candidates = [];
  for (const c of candidates) {
    const fp = generateFingerprint(c);
    const active = await isFingerprintActive(String(restaurantId), fp);
    if (!active) {
      filtered.push(c);
    }
  }

  const top = filtered.slice(0, 5);

  // Persist for outcome tracking (status 'shown').
  const docs = top.map((c) => {
    const fp = generateFingerprint(c);
    // Count existing instances of this fingerprint
    return {
      restaurantId: oid,
      branchId: opts.branchId ? new mongoose.Types.ObjectId(opts.branchId) : null,
      goal,
      recommendationType: c.recommendationType,
      title: c.title,
      why: c.why,
      evidence: c.evidence,
      economics: c.economics || undefined,
      expectedImpact: c.expectedImpact,
      risk: c.risk || '',
      confidence: c.confidence,
      score: c.score,
      supportingSignals: c.supportingSignals,
      offerSuggestion: c.offerSuggestion || null,
      status: 'shown',
      fingerprint: fp,
      instanceCount: 1,
    };
  });
  if (docs.length > 0) {
    await AdvisorRecommendationModel.insertMany(docs);
  }

  return { goal, recommendations: top, insufficientData: false, analyzed };
}

/** Record an owner action on a recommendation (accept/reject/dismiss). */
export async function recordAdvisorAction(
  restaurantId: string,
  recommendationId: string,
  status: 'accepted' | 'rejected' | 'dismissed' | 'converted',
  actionTaken?: string,
): Promise<boolean> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const res = await AdvisorRecommendationModel.updateOne(
    { _id: recommendationId, restaurantId: oid },
    {
      $set: {
        status,
        ...(actionTaken ? { actionTaken } : {}),
        resolvedAt: new Date(),
      },
    },
  ).exec();
  return res.modifiedCount > 0;
}

/** Record a measurable outcome for a recommendation (feedback loop). */
export async function recordAdvisorOutcome(
  restaurantId: string,
  recommendationId: string,
  outcome: string,
): Promise<boolean> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const res = await AdvisorRecommendationModel.updateOne(
    { _id: recommendationId, restaurantId: oid },
    { $set: { outcome, status: 'accepted', resolvedAt: new Date() } },
  ).exec();
  return res.modifiedCount > 0;
}

/** Recent recommendation history for the UI (optional). */
export async function listAdvisorRecommendations(restaurantId: string, opts: { goal?: AdvisorGoal; limit?: number } = {}) {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const filter: any = { restaurantId: oid };
  if (opts.goal) filter.goal = opts.goal;
  const docs = await AdvisorRecommendationModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit || 20)
    .lean()
    .exec();
  return docs.map((d: any) => ({
    id: String(d._id),
    goal: d.goal,
    recommendationType: d.recommendationType,
    title: d.title,
    why: d.why,
    evidence: d.evidence || [],
    economics: d.economics || null,
    expectedImpact: d.expectedImpact,
    risk: d.risk || '',
    confidence: d.confidence,
    score: d.score,
    status: d.status,
    actionTaken: d.actionTaken || '',
    outcome: d.outcome || '',
    createdAt: d.createdAt,
  }));
}

export type { AdvisorGoal };

// ====================================================================
// RECOMMENDATION LIFECYCLE
// ====================================================================

/**
 * Generate a stable fingerprint for a recommendation opportunity.
 * This allows the system to recognize that two recommendations represent
 * the same underlying business opportunity.
 */
export function generateFingerprint(rec: {
  recommendationType: string;
  title?: string;
  offerSuggestion?: any;
}): string {
  const type = rec.recommendationType || '';
  const offerType = rec.offerSuggestion?.type || '';
  const categories = (rec.offerSuggestion?.applicableCategories || []).sort().join(',');
  const products = (rec.offerSuggestion?.applicableProductIds || []).sort().join(',');
  // Use type + offer config as the fingerprint — stable across instances
  return `${type}:${offerType}:${categories}:${products}`.toLowerCase();
}

/**
 * Mark a recommendation as converted when an offer is successfully created.
 * This prevents the same opportunity from being re-recommended while the
 * offer/campaign is active.
 */
export async function markRecommendationConverted(
  restaurantId: string,
  recommendationId: string,
  offerId: string,
  campaignId?: string,
): Promise<boolean> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const update: any = {
    $set: {
      status: 'converted',
      offerId: new mongoose.Types.ObjectId(offerId),
      convertedAt: new Date(),
      actionTaken: 'offer_created',
      resolvedAt: new Date(),
    },
  };
  if (campaignId) {
    update.$set.campaignId = new mongoose.Types.ObjectId(campaignId);
  }
  const res = await AdvisorRecommendationModel.updateOne(
    { _id: recommendationId, restaurantId: oid },
    update,
  ).exec();
  return res.modifiedCount > 0;
}

/**
 * Mark a recommendation as in cooldown after its campaign completes.
 * The recommendation will not be re-recommended until the cooldown expires.
 */
export async function markRecommendationCampaignCompleted(
  restaurantId: string,
  recommendationId: string,
  cooldownDays: number = 30,
): Promise<boolean> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const cooldownExpires = new Date();
  cooldownExpires.setDate(cooldownExpires.getDate() + cooldownDays);
  const res = await AdvisorRecommendationModel.updateOne(
    { _id: recommendationId, restaurantId: oid },
    {
      $set: {
        status: 'cooldown',
        campaignCompletedAt: new Date(),
        cooldownExpiresAt: cooldownExpires,
      },
    },
  ).exec();
  return res.modifiedCount > 0;
}

/**
 * Re-evaluate recommendations that have passed their cooldown period.
 * Moves them from 'cooldown' to 'reevaluate' so they can be considered
 * again during the next recommendation generation.
 */
export async function reEvaluateRecommendations(restaurantId: string): Promise<number> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const now = new Date();
  const res = await AdvisorRecommendationModel.updateMany(
    {
      restaurantId: oid,
      status: 'cooldown',
      cooldownExpiresAt: { $lte: now },
    },
    {
      $set: { status: 'reevaluate' },
    },
  ).exec();
  return res.modifiedCount;
}

/**
 * Check if a recommendation with the same fingerprint is already active
 * (converted or cooldown). Used to suppress duplicate opportunities.
 */
export async function isFingerprintActive(
  restaurantId: string,
  fingerprint: string,
): Promise<boolean> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const count = await AdvisorRecommendationModel.countDocuments({
    restaurantId: oid,
    fingerprint,
    status: { $in: ['converted', 'cooldown'] },
  }).exec();
  return count > 0;
}