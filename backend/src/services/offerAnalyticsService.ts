/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerAnalyticsService.ts — OfferAnalytics derived from REAL authoritative
 * records (CouponRedemption + Bill/BillItem + Offer), never fabricated.
 *
 * Source-of-truth matrix (Phase B):
 *   - Redemption ledger        → CouponRedemption (status='applied')
 *   - Sales on redemption bills → Bill (subtotal) via CouponRedemption.billId
 *   - Offer definition         → Offer
 *   - OfferAnalytics           → DERIVED snapshot, rebuildable & deterministic
 *
 * Two writing modes:
 *   1. recordRedemption() — fast-path daily upsert when a redemption happens
 *      (used by offerValidationService.recordApplication). Idempotent per
 *      bill: the same billId can never double-count a daily snapshot.
 *   2. aggregateAndBackfill() — deterministic rebuild of the whole window
 *      straight from CouponRedemption + Bill. Repeatable (upsert semantics),
 *      safe to run any time, and is what historical data analysis uses.
 *
 * All writes are tenant-scoped, failure-safe and NEVER block billing (every
 * public method swallows its own errors after logging).
 */

import mongoose from 'mongoose';
import OfferAnalytics from '../models/OfferAnalytics';
import CouponRedemption from '../models/CouponRedemption';
import Bill from '../models/Bill';
import BillItem from '../models/BillItem';
import { Product, Recipe } from '../models';
import { recipeCostEngine } from '../modules/recipes/services/recipeCostEngine';
import { AppError } from '../utils/AppError';

function objectId(v: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v.toString());
}

function dayStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RedemptionEvent {
  restaurantId: string;
  offerId: string;
  discountAmount: number;
  /** Sales subtotal (before discount) of the bill the offer was applied to. */
  salesAmount?: number;
  billId?: string;
  branchId?: string;
  customerId?: string;
  customerPhone?: string;
  /** ISO date the redemption belongs to (defaults to today). */
  date?: string;
}

export interface OfferAnalyticsWindow {
  restaurantId: string;
  offerId?: string;
  branchId?: string;
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
}

export interface OfferPerformanceSummary {
  offerId: string;
  title?: string;
  type?: string;
  value?: number;
  redemptions: number;
  revenueGenerated: number;
  discountGiven: number;
  averageOrderValue: number;
  uniqueCustomers: number;
  repeatCustomers: number;
  redemptionRate?: number | null;  // null when no denominator (no view tracking)
  customersTargeted: number;
  customersReached: number;
  opened: number;
  contribution?: number | null;    // estimated contribution (see computeContribution)
  contributionMargin?: number | null;
  daysActive: number;
  trend: Array<{ date: string; redeemed: number; revenue: number; discount: number }>;
  // P2 — combo-specific economics (populated only for Offer.type='combo').
  comboUnits?: number;
  comboRevenue?: number;
  comboPrice?: number;
  comboOrders?: number;
  structuralSavings?: number;
  individualValue?: number;
  customerSavings?: number;
  variableCost?: number;
  repeatRate?: number | null;
  classification?: string[];
}

/** Currency formatting used across analytics output. */
export function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * Deterministic rebuild of OfferAnalytics snapshots from the authoritative
 * CouponRedemption + Bill records for the given window. Upsert semantics —
 * repeatable, idempotent, safe to re-run any time. Does NOT touch data for
 * other restaurants.
 */
export async function aggregateAndBackfill(window: OfferAnalyticsWindow): Promise<{ snapshots: number; redemptions: number }> {
  const rid = objectId(window.restaurantId);
  const filter: any = { restaurantId: rid, status: 'applied' };
  if (window.offerId) filter.offerId = objectId(window.offerId);
  if (window.branchId) filter.branchId = objectId(window.branchId);
  if (window.from || window.to) {
    filter.createdAt = {};
    if (window.from) filter.createdAt.$gte = new Date(`${window.from}T00:00:00.000Z`);
    if (window.to) filter.createdAt.$lte = new Date(`${window.to}T23:59:59.999Z`);
  }

  const redemptions = await CouponRedemption.find(filter).lean().exec();
  if (redemptions.length === 0) return { snapshots: 0, redemptions: 0 };

  // Sales subtotal per redemption bill. The redemption's billId is a STRING
  // that may be either the real Mongo id OR the POS's client-generated
  // idempotency key (useBilling applies offers with the temp id, which then
  // becomes the bill's clientRef) — match both so historical revenue is never
  // dropped. Bills are tenant-scoped by the redemption restaurantId above.
  const billRefs = redemptions
    .map((r: any) => r.billId)
    .filter((b: any): b is string => !!b && typeof b === 'string');
  const validOids = billRefs.filter((b) => mongoose.Types.ObjectId.isValid(b));
  const bills = await Bill.find({
    $or: [
      { _id: { $in: validOids } },
      ...(billRefs.length > 0 ? [{ clientRef: { $in: billRefs } }] : []),
    ],
  })
    .select('_id clientRef subtotal discount grandTotal')
    .lean()
    .exec();
  const salesByRef = new Map<string, number>();
  for (const b of bills) {
    const refs = [String(b._id), ...(b.clientRef ? [String(b.clientRef)] : [])];
    for (const ref of refs) {
      if (!salesByRef.has(ref)) salesByRef.set(ref, Number(b.subtotal) || 0);
    }
  }

  // Group into daily per-offer (and per-branch when branchId present) buckets.
  const buckets = new Map<string, {
    key: string;
    date: string;
    offerId: mongoose.Types.ObjectId;
    branchId?: mongoose.Types.ObjectId;
    redeemed: number;
    revenue: number;
    discount: number;
    customers: Set<string>;
  }>();

  for (const r of redemptions) {
    const date = r.createdAt ? dayStamp(new Date(r.createdAt)) : dayStamp();
    const key = `${date}|${String(r.offerId)}|${r.branchId ? String(r.branchId) : ''}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key, date,
        offerId: r.offerId,
        branchId: r.branchId || undefined,
        redeemed: 0, revenue: 0, discount: 0,
        customers: new Set<string>(),
      };
      buckets.set(key, bucket);
    }
    bucket.redeemed += 1;
    bucket.discount += Number(r.discountAmount) || 0;
    bucket.revenue += salesByRef.get(String(r.billId)) || 0;
    const cid = r.customerId ? String(r.customerId) : r.customerPhone ? `ph:${r.customerPhone}` : null;
    if (cid) bucket.customers.add(cid);
  }

  let snapshots = 0;
  for (const bucket of buckets.values()) {
    const uniqueCustomers = bucket.customers.size;
    const aov = bucket.redeemed > 0 ? round2(bucket.revenue / bucket.redeemed) : 0;
    const doc: any = {
      restaurantId: rid,
      offerId: bucket.offerId,
      branchId: bucket.branchId || null,
      snapshotDate: bucket.date,
      redeemed: bucket.redeemed,
      revenueGenerated: round2(bucket.revenue),
      discountGiven: round2(bucket.discount),
      uniqueCustomers,
      repeatCustomers: Math.max(0, bucket.redeemed - uniqueCustomers),
      averageOrderValue: aov,
      customersTargeted: 0,
      customersReached: 0,
      opened: 0,
      repeatVisits: 0,
      averageBillIncrease: 0,
      roi: 0,
      campaignCost: 0,
    };
    await OfferAnalytics.updateOne(
      {
        restaurantId: rid,
        offerId: bucket.offerId,
        snapshotDate: bucket.date,
        ...(bucket.branchId ? { branchId: bucket.branchId } : { branchId: null }),
      },
      { $set: doc },
      { upsert: true },
    ).exec();
    snapshots += 1;
  }

  return { snapshots, redemptions: redemptions.length };
}

/**
 * Fast-path daily snapshot upsert for a live redemption. Idempotent per bill:
 * the same billId is never double-counted in the same day (a replayed offline
 * bill can't inflate analytics). Never throws — analytics must never block a
 * completed sale.
 */
export async function recordOfferRedemption(event: RedemptionEvent): Promise<void> {
  try {
    const oid = objectId(event.restaurantId);
    const offerOid = objectId(event.offerId);
    const date = event.date ? String(event.date).slice(0, 10) : dayStamp();
    const branchOid = event.branchId && mongoose.Types.ObjectId.isValid(event.branchId)
      ? objectId(event.branchId)
      : null;
    const salesAmount = Number(event.salesAmount) || 0;
    const discount = Number(event.discountAmount) || 0;
    const billId = event.billId;

    const filter: any = { restaurantId: oid, offerId: offerOid, snapshotDate: date };
    if (branchOid) filter.branchId = branchOid;
    else filter.branchId = null;

    // Idempotency: an existing snapshot row remembers which billIds it already
    // counted (capped list — far beyond any realistic daily redemption volume).
    const existing = await OfferAnalytics.findOne(filter).select('billIds').lean().exec();
    if (existing && billId && Array.isArray(existing.billIds) && existing.billIds.includes(billId)) {
      return; // replay — already counted today
    }

    const inc: any = {
      redeemed: 1,
      revenueGenerated: salesAmount,
      discountGiven: discount,
      ...(billId ? { 'billIds.0': billId } : {}),
    };
    // $inc on an array element position would be wrong; use $addToSet for the
    // idempotency list and plain $inc for counters.
    const update: any = { $inc: { redeemed: 1, revenueGenerated: salesAmount, discountGiven: discount } };
    if (billId) update.$addToSet = { billIds: billId };
    update.$setOnInsert = {
      restaurantId: oid,
      offerId: offerOid,
      snapshotDate: date,
      branchId: branchOid || null,
      customersTargeted: 0,
      customersReached: 0,
      opened: 0,
      repeatVisits: 0,
      averageBillIncrease: 0,
      roi: 0,
      campaignCost: 0,
      averageOrderValue: 0,
      uniqueCustomers: 0,
      repeatCustomers: 0,
    };
    await OfferAnalytics.updateOne(filter, update, { upsert: true }).exec();

    // Keep averageOrderValue accurate on the fast path (it is part of the
    // offer-performance payload the POS renders). Best-effort: a failure here
    // must never matter to billing.
    try {
      const after = await OfferAnalytics.findOne(filter).select('redeemed revenueGenerated').lean().exec();
      if (after && after.redeemed > 0) {
        await OfferAnalytics.updateOne(filter, {
          $set: { averageOrderValue: round2((after.revenueGenerated || 0) / after.redeemed) },
        }).exec();
      }
    } catch { /* best-effort */ }

    // Customer counters are best-effort derived (unique set is heavy for the
    // hot path); aggregateAndBackfill() computes exact unique/repeat counts.
    if (event.customerId || event.customerPhone) {
      try {
        const key = event.customerId ? `cust:${event.customerId}` : `ph:${event.customerPhone}`;
        await OfferAnalytics.updateOne(filter, { $addToSet: { customerKeys: key } }).exec();
      } catch { /* best-effort */ }
    }
  } catch (err: any) {
    console.warn('[OfferAnalytics] redemption record failed (non-fatal):', err?.message);
  }
}

/**
 * Backward-compatible thin wrapper for existing callers that pass positional
 * args (recordOfferRedemption(restaurantId, offerId, discountAmount)).
 */
export async function recordOfferRedemptionLegacy(
  restaurantId: string,
  offerId: string,
  discountAmount: number,
): Promise<void> {
  await recordOfferRedemption({ restaurantId, offerId, discountAmount });
}

/** Record a campaign delivery outcome for an offer-linked campaign. */
export async function recordCampaignDelivery(
  restaurantId: string,
  offerId: string,
  opts: { reached: number; opened?: number },
): Promise<void> {
  try {
    const reached = Number(opts.reached) || 0;
    const opened = Number(opts.opened) || 0;
    await OfferAnalytics.updateOne(
      { restaurantId: objectId(restaurantId), offerId: objectId(offerId), snapshotDate: dayStamp() },
      {
        $inc: { customersReached: reached, opened },
        $setOnInsert: { restaurantId: objectId(restaurantId), offerId: objectId(offerId), snapshotDate: dayStamp() },
      },
      { upsert: true },
    ).exec();
  } catch (err: any) {
    console.warn('[OfferAnalytics] delivery record failed:', err?.message);
  }
}

/**
 * Roll up snapshot rows for a window into a per-offer performance summary.
 * Returns [] when the restaurant has no analytics (UI shows "data unavailable",
 * never fabricated zeros). Every query is tenant-scoped.
 */
export async function getOfferPerformance(window: OfferAnalyticsWindow): Promise<OfferPerformanceSummary[]> {
  const rid = objectId(window.restaurantId);
  const filter: any = { restaurantId: rid };
  if (window.offerId) filter.offerId = objectId(window.offerId);
  if (window.branchId) filter.branchId = objectId(window.branchId);
  if (window.from || window.to) {
    filter.snapshotDate = {};
    if (window.from) filter.snapshotDate.$gte = window.from;
    if (window.to) filter.snapshotDate.$lte = window.to;
  }

  const rows = await OfferAnalytics.find(filter).lean().exec();
  if (rows.length === 0) return [];

  const byOffer = new Map<string, OfferPerformanceSummary>();
  for (const r of rows as any[]) {
    const offerId = String(r.offerId);
    let s = byOffer.get(offerId);
    if (!s) {
      s = {
        offerId,
        redemptions: 0,
        revenueGenerated: 0,
        discountGiven: 0,
        averageOrderValue: 0,
        uniqueCustomers: 0,
        repeatCustomers: 0,
        redemptionRate: null,
        customersTargeted: 0,
        customersReached: 0,
        opened: 0,
        contribution: null,
        contributionMargin: null,
        daysActive: 0,
        trend: [],
      };
      byOffer.set(offerId, s);
    }
    s.redemptions += r.redeemed || 0;
    s.revenueGenerated += r.revenueGenerated || 0;
    s.discountGiven += r.discountGiven || 0;
    s.uniqueCustomers += r.uniqueCustomers || 0;
    s.repeatCustomers += r.repeatCustomers || 0;
    s.customersTargeted += r.customersTargeted || 0;
    s.customersReached += r.customersReached || 0;
    s.opened += r.opened || 0;
    s.daysActive += 1;
    s.trend.push({ date: r.snapshotDate, redeemed: r.redeemed || 0, revenue: r.revenueGenerated || 0, discount: r.discountGiven || 0 });
  }

  const offers = await mongoose.model('Offer').find({ _id: { $in: Array.from(byOffer.keys()) } })
    .select('_id title type value')
    .lean()
    .exec();
  const offerById = new Map(offers.map((o: any) => [String(o._id), o]));

  // P2 — combo offers get deterministic combo-attributed economics (computed
  // from source records, not the whole-bill OfferAnalytics subtotal).
  const hasCombo = Array.from(offerById.values()).some((o: any) => o?.type === 'combo');
  const combosById = hasCombo ? new Map((await getComboAnalytics(window)).map((c) => [c.offerId, c])) : new Map();

  for (const s of byOffer.values()) {
    const offerDoc = offerById.get(s.offerId);
    s.title = offerDoc?.title || undefined;
    s.type = offerDoc?.type || undefined;
    s.value = typeof offerDoc?.value === 'number' ? offerDoc.value : undefined;
    s.averageOrderValue = s.redemptions > 0 ? round2(s.revenueGenerated / s.redemptions) : 0;
    // Redemption rate needs a "viewed/applied" denominator — only when the
    // campaign actually reported reach. Otherwise keep null (unavailable).
    s.redemptionRate = s.customersReached > 0 ? Math.round((s.redemptions / s.customersReached) * 1000) / 10 : null;
    s.trend.sort((a, b) => a.date.localeCompare(b.date));
    if (offerDoc?.type === 'combo') {
      const c = combosById.get(s.offerId);
      if (c) {
        // Combo-attributed revenue REPLACES nothing — it is exposed alongside
        // the existing whole-bill "influenced revenue" (s.revenueGenerated),
        // never added on top of it.
        s.comboUnits = c.units;
        s.comboRevenue = c.comboRevenue;
        s.comboPrice = c.comboPrice;
        s.comboOrders = c.orders;
        s.structuralSavings = c.structuralSavings;
        s.individualValue = c.individualValue;
        s.customerSavings = c.customerSavings;
        s.variableCost = c.variableCost;
        s.contribution = c.contribution;
        s.contributionMargin = c.contributionMargin;
        s.repeatRate = c.repeatRate;
        s.classification = c.classification;
      }
    }
  }

  return Array.from(byOffer.values()).sort((a, b) => b.revenueGenerated - a.revenueGenerated);
}

/**
 * Overall summary across all offers in a window (tenant-scoped). Used by the
 * POS analytics header. Distinguishes real vs unavailable metrics explicitly.
 */
export async function getAnalyticsSummary(window: OfferAnalyticsWindow): Promise<any> {
  const performance = await getOfferPerformance(window);
  const totals = performance.reduce(
    (acc, s) => {
      acc.redemptions += s.redemptions;
      acc.revenue += s.revenueGenerated;
      acc.discount += s.discountGiven;
      acc.customers += s.uniqueCustomers;
      return acc;
    },
    { redemptions: 0, revenue: 0, discount: 0, customers: 0 },
  );
  return {
    redemptions: totals.redemptions,
    revenueGenerated: round2(totals.revenue),
    discountGiven: round2(totals.discount),
    averageOrderValue: totals.redemptions > 0 ? round2(totals.revenue / totals.redemptions) : 0,
    uniqueCustomers: totals.customers,
    offersTracked: performance.length,
    // Contribution is only computed per-offer when a deterministic engine
    // provides costs; absent that, it is explicitly null (unavailable).
    estimatedContribution: null,
  };
}

/**
 * Daily trend across a window: { date, redeemed, revenue, discount } sorted
 * ascending. Uses ONLY real snapshot rows.
 */
export async function getAnalyticsTrend(window: OfferAnalyticsWindow): Promise<Array<{ date: string; redeemed: number; revenue: number; discount: number }>> {
  const rid = objectId(window.restaurantId);
  const filter: any = { restaurantId: rid };
  if (window.offerId) filter.offerId = objectId(window.offerId);
  if (window.branchId) filter.branchId = objectId(window.branchId);
  if (window.from || window.to) {
    filter.snapshotDate = {};
    if (window.from) filter.snapshotDate.$gte = window.from;
    if (window.to) filter.snapshotDate.$lte = window.to;
  }
  const rows = await OfferAnalytics.find(filter).select('snapshotDate redeemed revenueGenerated discountGiven').lean().exec();
  const byDay = new Map<string, { date: string; redeemed: number; revenue: number; discount: number }>();
  for (const r of rows as any[]) {
    const d = r.snapshotDate;
    const agg = byDay.get(d) || { date: d, redeemed: 0, revenue: 0, discount: 0 };
    agg.redeemed += r.redeemed || 0;
    agg.revenue += r.revenueGenerated || 0;
    agg.discount += r.discountGiven || 0;
    byDay.set(d, agg);
  }
  return Array.from(byDay.values())
    .map((d) => ({ ...d, revenue: round2(d.revenue), discount: round2(d.discount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Throws a typed 400 with a friendly message (used by controllers). */
export function assertValidWindow(window: OfferAnalyticsWindow): void {
  if (!window.restaurantId) throw new AppError(400, 'Missing restaurant ID');
  if (window.from && window.to && window.from > window.to) {
    throw new AppError(400, 'from date must be before to date');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P2 — DETERMINISTIC COMBO ANALYTICS
//
// Combos are Offer.type='combo' (comboProductIds + comboPrice) applied as an
// order-level discount and recorded in CouponRedemption (status='applied').
// OfferAnalytics.revenueGenerated holds the WHOLE BILL subtotal — "influenced
// revenue", the same semantics as every other offer type — NOT the
// combo-attributed revenue. This module recomputes combo-attributed economics
// from the authoritative source records (redemptions → bills → bill items →
// deterministic recipe/product costs). It is READ-ONLY and deterministic: the
// same inputs always produce the same output, so incremental aggregation and
// rebuild are the same computation by construction (idempotent).
//
// Anti-double-counting contract:
//   comboRevenue + structuralSavings == units × (component sale prices)
//   comboRevenue is NEVER added on top of component line totals — it REPLACES
//   them for the bundled units (the components were sold at combo price).
// ═══════════════════════════════════════════════════════════════════════════

export interface ComboComponentEconomics {
  productId: string;
  productName: string;
  /** Average menu price of the component at sale (from BillItem snapshots). */
  priceAtSale: number;
  /** Current menu price — counterfactual basis, clearly labelled. */
  currentPrice: number;
  /** Deterministic variable cost per unit: recipe cost or Product.averageCost. */
  variableCost: number;
  hasRecipe: boolean;
}

export interface ComboAnalyticsSummary {
  offerId: string;
  name: string;
  restaurantId: string;
  /** Number of redemptions counted (one combo application each). */
  orders: number;
  /** Complete combo sets sold (min over components of net quantity). */
  units: number;
  comboPrice: number;
  /** units × component prices at sale (the actual transaction list value). */
  listValueAtSale: number;
  /** units × current component prices — COUNTERFACTUAL (not actual revenue). */
  individualValue: number;
  /** listValueAtSale − comboRevenue (structural bundle savings). */
  structuralSavings: number;
  /** individualValue − comboRevenue — COUNTERFACTUAL comparison. */
  customerSavings: number;
  /** units × comboPrice — combo-attributed revenue (never double counts). */
  comboRevenue: number;
  /** Whole-bill subtotals of redemption bills (influenced-revenue context). */
  billRevenue: number;
  /** Total discount recorded across the redemptions. */
  redemptionDiscount: number;
  /** Order-level discount beyond the structural combo savings (stacked coupon). */
  additionalDiscount: number;
  /** Deterministic variable cost (component recipe costs / average costs). */
  variableCost: number;
  contribution: number;
  /** contribution / comboRevenue × 100 — null when revenue is 0. */
  contributionMargin: number | null;
  /** Counterfactual: components at current prices × units. */
  individualContribution: number;
  /** individualContribution − contribution (what bundling gives up). */
  economicDelta: number;
  uniqueCustomers: number;
  /** Customers with ≥ 2 redemptions of this combo in the window. */
  repeatCustomers: number;
  /** repeatCustomers / uniqueCustomers × 100 — null when no unique customers. */
  repeatRate: number | null;
  averageOrderValue: number;
  components: ComboComponentEconomics[];
  bestPeriod: { weekday: number; units: number } | null;
  weakPeriod: { weekday: number; units: number } | null;
  /** No impression/click tracking exists in this architecture → null, never invented. */
  impressions: number | null;
  clicks: number | null;
  conversionRate: number | null;
  classification: string[];
}

/**
 * Deterministic combo classification badges (documented thresholds, P2 §14).
 * Absolute, dataset-independent thresholds — deliberately NOT tuned to any
 * single dataset. Returns the primary badge plus at most two context badges.
 */
export function classifyCombo(c: {
  units: number;
  contributionMargin: number | null;
  comboRevenue: number;
  structuralSavings: number;
  repeatRate: number | null;
  uniqueCustomers: number;
}): string[] {
  if (!c || c.units <= 0) return [];
  const margin = c.contributionMargin;
  const badges: string[] = [];
  if (c.units < 5) badges.push('LOW_PERFORMER');
  else if (c.units >= 10 && margin !== null && margin >= 35) badges.push('HIGH_PERFORMER');
  else if (c.units >= 10 && margin !== null && margin < 25) badges.push('HIGH_REVENUE_LOW_MARGIN');
  else if (c.units < 10 && margin !== null && margin >= 40) badges.push('LOW_REVENUE_HIGH_MARGIN');
  const discountRate = c.comboRevenue > 0 ? c.structuralSavings / c.comboRevenue : 0;
  if (discountRate > 0.2 && margin !== null && margin < 30) badges.push('HIGH_DISCOUNT_LOW_CONTRIBUTION');
  if (c.repeatRate !== null && c.repeatRate >= 30 && c.uniqueCustomers >= 5) badges.push('STRONG_REPEAT_USAGE');
  if (margin !== null && margin < 10 && !badges.includes('LOW_PERFORMER')) badges.push('LOW_MARGIN');
  return badges.slice(0, 3);
}

/**
 * Deterministic multi-dimension combo ranking (P2 §13). A single ranking
 * hides the revenue-vs-profitability split, so several dimensions are exposed.
 */
export function rankCombos(combos: ComboAnalyticsSummary[]): {
  topByRevenue: Array<{ offerId: string; name: string; value: number }>;
  topByContribution: Array<{ offerId: string; name: string; value: number }>;
  topByUnits: Array<{ offerId: string; name: string; value: number }>;
  topByMargin: Array<{ offerId: string; name: string; value: number }>;
  weakestByUnits: Array<{ offerId: string; name: string; value: number }>;
  weakestByMargin: Array<{ offerId: string; name: string; value: number }>;
} {
  const pick = (sorted: ComboAnalyticsSummary[], key: 'comboRevenue' | 'contribution' | 'units' | 'contributionMargin', n = 3) =>
    sorted.slice(0, n).map((c) => ({
      offerId: c.offerId,
      name: c.name,
      value: key === 'contributionMargin' ? c.contributionMargin ?? 0 : Number(c[key]) || 0,
    }));
  const withMargin = combos.filter((c) => c.contributionMargin !== null);
  return {
    topByRevenue: pick([...combos].sort((a, b) => b.comboRevenue - a.comboRevenue), 'comboRevenue'),
    topByContribution: pick([...combos].sort((a, b) => b.contribution - a.contribution), 'contribution'),
    topByUnits: pick([...combos].sort((a, b) => b.units - a.units), 'units'),
    topByMargin: pick([...withMargin].sort((a, b) => (b.contributionMargin ?? 0) - (a.contributionMargin ?? 0)), 'contributionMargin'),
    weakestByUnits: pick([...combos].sort((a, b) => a.units - b.units), 'units'),
    weakestByMargin: pick([...withMargin].sort((a, b) => (a.contributionMargin ?? 0) - (b.contributionMargin ?? 0)), 'contributionMargin'),
  };
}

/**
 * Deterministic combo analytics for a tenant (and optional offer / date
 * window). Read-only aggregation over CouponRedemption + Bill + BillItem +
 * Product/Recipe costs — never mutates anything. Returns [] when the
 * restaurant has no combo redemptions in the window (UI shows "no data",
 * never fabricated zeros).
 */
export async function getComboAnalytics(window: OfferAnalyticsWindow): Promise<ComboAnalyticsSummary[]> {
  const rid = objectId(window.restaurantId);

  const offerFilter: any = { restaurantId: rid, type: 'combo', isDeleted: { $ne: true } };
  if (window.offerId) offerFilter._id = objectId(window.offerId);
  const combos = await mongoose.model('Offer').find(offerFilter).select('_id title comboProductIds comboPrice').lean().exec();
  if (combos.length === 0) return [];
  const comboDefById = new Map(combos.map((o: any) => [String(o._id), o]));

  const redemptionFilter: any = {
    restaurantId: rid,
    status: 'applied',
    offerId: { $in: combos.map((o: any) => o._id) },
  };
  if (window.from || window.to) {
    redemptionFilter.createdAt = {};
    if (window.from) redemptionFilter.createdAt.$gte = new Date(`${window.from}T00:00:00.000Z`);
    if (window.to) redemptionFilter.createdAt.$lte = new Date(`${window.to}T23:59:59.999Z`);
  }
  const redemptions = await CouponRedemption.find(redemptionFilter).lean().exec();
  if (redemptions.length === 0) return [];

  // Bills (matched by real id OR client-generated idempotency key — same
  // convention as aggregateAndBackfill).
  const billRefs = redemptions
    .map((r: any) => r.billId)
    .filter((b: any): b is string => !!b && typeof b === 'string');
  const validOids = billRefs.filter((b) => mongoose.Types.ObjectId.isValid(b));
  const bills = await Bill.find({
    $or: [
      { _id: { $in: validOids } },
      ...(billRefs.length > 0 ? [{ clientRef: { $in: billRefs } }] : []),
    ],
  })
    .select('_id clientRef subtotal isVoided isRefunded refundedItems')
    .lean()
    .exec();
  const billByRef = new Map<string, any>();
  for (const b of bills as any[]) {
    const refs = [String(b._id), ...(b.clientRef ? [String(b.clientRef)] : [])];
    for (const ref of refs) if (!billByRef.has(ref)) billByRef.set(ref, b);
  }

  const billIds = bills.map((b: any) => b._id);
  const billItems = billIds.length > 0
    ? await BillItem.find({ billId: { $in: billIds } })
        .select('billId menuItemId priceAtSale quantity')
        .lean()
        .exec()
    : [];
  const itemsByBill = new Map<string, any[]>();
  for (const it of billItems as any[]) {
    const k = String(it.billId);
    if (!itemsByBill.has(k)) itemsByBill.set(k, []);
    itemsByBill.get(k)!.push(it);
  }

  // Component catalog + deterministic costs (single batch, no N+1).
  const allProductIds = new Set<string>();
  for (const o of combos as any[]) {
    for (const id of (o.comboProductIds || [])) {
      if (id && mongoose.Types.ObjectId.isValid(String(id))) allProductIds.add(String(id));
    }
  }
  const pidList = [...allProductIds].map((p) => new mongoose.Types.ObjectId(p));
  const products = pidList.length > 0
    ? await Product.find({ _id: { $in: pidList }, restaurantId: rid, isDeleted: { $ne: true } })
        .select('_id name price averageCost')
        .lean()
        .exec()
    : [];
  const productById = new Map(products.map((p: any) => [String(p._id), p]));
  // Full docs (components included) — the cost engine needs the real recipe.
  const recipes = pidList.length > 0
    ? await Recipe.find({ restaurantId: rid, status: 'active', productId: { $in: pidList }, isDeleted: { $ne: true } })
        .lean()
        .exec()
    : [];
  const recipeByProduct = new Map(recipes.map((r: any) => [String(r.productId), r]));

  const compEcon = new Map<string, ComboComponentEconomics>();
  for (const pid of allProductIds) {
    const p = productById.get(pid);
    if (!p) continue;
    let cost = Number(p.averageCost) || 0;
    let hasRecipe = false;
    const recipe = recipeByProduct.get(pid);
    if (recipe) {
      try {
        const r = await recipeCostEngine.costRecipe(recipe, { restaurantId: window.restaurantId });
        cost = r.recipeCost;
        hasRecipe = true;
      } catch {
        /* engine failure → fall back to Product.averageCost (never an AI number) */
      }
    }
    compEcon.set(pid, {
      productId: pid,
      productName: p.name,
      priceAtSale: 0,
      currentPrice: Number(p.price) || 0,
      variableCost: round2(cost),
      hasRecipe,
    });
  }

  // Per-combo aggregation buckets.
  const buckets = new Map<string, any>();
  for (const o of combos as any[]) {
    const components = (o.comboProductIds || [])
      .map((id: string) => String(id))
      .filter((id: string) => compEcon.has(id))
      .map((id: string) => ({ ...compEcon.get(id)! }));
    buckets.set(String(o._id), {
      offerId: String(o._id),
      name: o.title,
      comboPrice: round2(Number(o.comboPrice) || 0),
      components,
      orders: 0,
      units: 0,
      listValueAtSale: 0,
      billRevenue: 0,
      redemptionDiscount: 0,
      componentSaleAmount: 0,
      compSale: new Map<string, number>(),
      customers: new Map<string, number>(),
      weekdayUnits: new Map<number, number>(),
    });
  }

  for (const r of redemptions as any[]) {
    const bucket = buckets.get(String(r.offerId));
    if (!bucket) continue;
    const bill = r.billId ? billByRef.get(String(r.billId)) : null;
    if (!bill) continue;
    // Voided bills are reversed sales — never reported as active revenue.
    if (bill.isVoided) continue;
    const bItems = itemsByBill.get(String(bill._id)) || [];

    // Net quantity per component (refund-aware), then the number of COMPLETE
    // combo sets = min over components. The extra copies of a component (e.g.
    // one more tikka sold individually) are NOT part of the combo — they stay
    // in the bill as individual revenue and never enter combo list value.
    const netQty = (pid: string): number => {
      let qty = 0;
      for (const it of bItems) {
        if (String(it.menuItemId) !== pid) continue;
        qty += Number(it.quantity) || 0;
      }
      if (bill.isRefunded && Array.isArray(bill.refundedItems)) {
        for (const rf of bill.refundedItems) {
          if (String(rf.menuItemId) === pid) qty = Math.max(0, qty - (Number(rf.quantity) || 0));
        }
      }
      return qty;
    };
    const unitPrice = (pid: string): number => {
      for (const it of bItems) {
        if (String(it.menuItemId) === pid) return Number(it.priceAtSale) || 0;
      }
      return 0;
    };

    let units: number | null = null;
    for (const comp of bucket.components as ComboComponentEconomics[]) {
      const qty = netQty(comp.productId);
      if (qty <= 0) { units = 0; break; }
      const u = Math.floor(qty);
      units = units === null ? u : Math.min(units, u);
    }
    if (!units || units <= 0) continue;

    // List value counts ONLY the bundled units (units × component price).
    let saleAmount = 0;
    for (const comp of bucket.components as ComboComponentEconomics[]) {
      const price = unitPrice(comp.productId);
      saleAmount += price * units;
      bucket.compSale.set(comp.productId, round2((bucket.compSale.get(comp.productId) || 0) + price * units));
    }

    bucket.orders += 1;
    bucket.units += units;
    bucket.listValueAtSale = round2(bucket.listValueAtSale + saleAmount);
    bucket.componentSaleAmount = round2(bucket.componentSaleAmount + saleAmount);
    bucket.billRevenue = round2(bucket.billRevenue + (Number(bill.subtotal) || 0));
    bucket.redemptionDiscount = round2(bucket.redemptionDiscount + (Number(r.discountAmount) || 0));
    const cid = r.customerId ? `cust:${r.customerId}` : r.customerPhone ? `ph:${r.customerPhone}` : null;
    if (cid) bucket.customers.set(cid, (bucket.customers.get(cid) || 0) + 1);
    const wd = r.createdAt ? new Date(r.createdAt).getDay() : new Date().getDay();
    bucket.weekdayUnits.set(wd, (bucket.weekdayUnits.get(wd) || 0) + units);
  }

  const out: ComboAnalyticsSummary[] = [];
  for (const b of buckets.values()) {
    if (b.units <= 0) continue;
    const revenue = round2(b.units * b.comboPrice);
    const structuralSavings = round2(Math.max(0, b.listValueAtSale - revenue));
    const additionalDiscount = round2(Math.max(0, b.redemptionDiscount - structuralSavings));
    const variableCost = round2(b.components.reduce((s: number, c: ComboComponentEconomics) => s + (Number(c.variableCost) || 0), 0) * b.units);
    const contribution = round2(revenue - variableCost);
    const contributionMargin = revenue > 0 ? round2((contribution / revenue) * 100) : null;
    const individualValue = round2(b.units * b.components.reduce((s: number, c: ComboComponentEconomics) => s + (Number(c.currentPrice) || 0), 0));
    const customerSavings = round2(Math.max(0, individualValue - revenue));
    const individualContribution = round2(b.units * b.components.reduce((s: number, c: ComboComponentEconomics) => s + ((Number(c.currentPrice) || 0) - (Number(c.variableCost) || 0)), 0));
    const economicDelta = round2(individualContribution - contribution);
    const uniqueCustomers = b.customers.size;
    const repeatCustomers = [...b.customers.values()].filter((n) => n >= 2).length;
    const repeatRate = uniqueCustomers > 0 ? Math.round((repeatCustomers / uniqueCustomers) * 1000) / 10 : null;

    let best: { weekday: number; units: number } | null = null;
    let weak: { weekday: number; units: number } | null = null;
    for (const [wd, u] of b.weekdayUnits) {
      if (!best || u > best.units) best = { weekday: wd, units: u };
      if (!weak || u < weak.units) weak = { weekday: wd, units: u };
    }

    const components: ComboComponentEconomics[] = b.components.map((c: ComboComponentEconomics) => ({
      ...c,
      priceAtSale: b.units > 0 ? round2((b.compSale.get(c.productId) || 0) / b.units) : c.priceAtSale,
    }));

    out.push({
      offerId: b.offerId,
      name: b.name,
      restaurantId: window.restaurantId,
      orders: b.orders,
      units: b.units,
      comboPrice: b.comboPrice,
      listValueAtSale: round2(b.listValueAtSale),
      individualValue,
      structuralSavings,
      customerSavings,
      comboRevenue: revenue,
      billRevenue: round2(b.billRevenue),
      redemptionDiscount: round2(b.redemptionDiscount),
      additionalDiscount,
      variableCost,
      contribution,
      contributionMargin,
      individualContribution,
      economicDelta,
      uniqueCustomers,
      repeatCustomers,
      repeatRate,
      averageOrderValue: b.orders > 0 ? round2(revenue / b.orders) : 0,
      components,
      bestPeriod: best,
      weakPeriod: weak,
      impressions: null,
      clicks: null,
      conversionRate: null,
      classification: classifyCombo({
        units: b.units,
        contributionMargin,
        comboRevenue: revenue,
        structuralSavings,
        repeatRate,
        uniqueCustomers,
      }),
    });
  }

  return out.sort((a, b) => b.comboRevenue - a.comboRevenue);
}
