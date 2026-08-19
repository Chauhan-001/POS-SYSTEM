/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * priceIntelligenceService.ts — Deterministic price-floor & price-deterioration
 * intelligence (Phase 10).
 *
 * Reuses the existing cost/profitability stack — this module NEVER computes a
 * new cost formula:
 *   - productProfitability / costIntelligenceService.metrics → food cost %,
 *     contribution margin, recipe cost, units sold
 *   - costIntelligenceService.marginDeterioration → before/after recipe cost
 *     and margin per product (deterministic ingredient-cost evidence)
 *   - MarginSafety provider thresholds (25% contribution margin / 60% food
 *     cost, 10% cost-rise) → the documented safety rules reused here
 *   - Product.branchPrice → branch-scoped selling price (Phase 9/10.8)
 *
 * HARD RULE: this service is READ-ONLY. It never mutates a product's selling
 * price. It only tells the owner WHAT to review; the owner changes the price
 * through the existing product editor + authorization/audit flow.
 *
 * Thresholds (centralized, documented — no magic numbers in providers):
 *   TARGET_MARGIN_PCT = 25   — same floor the MarginSafety provider treats as
 *                              "thin margin" (contribution margin < 25%)
 *   COST_SPIKE_PCT    = 10   — same threshold MarginSafety uses for cost risers
 *   DETERIORATION_PP  = 5    — margin must have dropped ≥ 5 pp to be "deteriorating"
 */

import ProductModel from '../models/Product';
import { costIntelligenceService } from '../modules/recipes/services/costIntelligenceService';
import { resolveMenuProductScope } from './productService';

// ─── Central, documented thresholds ───────────────────────────────────

/** Contribution margin the system treats as the safe floor (matches MarginSafety). */
export const TARGET_MARGIN_PCT = 25;
/** Ingredient/recipe cost rise that counts as a cost spike (matches MarginSafety). */
export const COST_SPIKE_PCT = 10;
/** Margin drop (percentage points) that counts as deterioration. */
export const DETERIORATION_PP = 5;

export type PriceStatus =
  | 'HEALTHY'
  | 'MONITOR'
  | 'MARGIN_DETERIORATING'
  | 'BELOW_PRICE_FLOOR'
  | 'COST_SPIKE';

export type PriceRecommendation =
  | 'NO_ACTION'
  | 'REVIEW_PRICE'
  | 'REVIEW_RECIPE'
  | 'REVIEW_WASTAGE';

export type PriceSeverity = 'none' | 'low' | 'medium' | 'high';

export interface PriceIntelligenceRow {
  productId: string;
  productName: string;
  category?: string;
  /** Branch-scoped selling price (branchPrice override when scope=branch). */
  currentPrice: number;
  currentCost: number;
  currentMargin: number;
  currentFoodCostPercent: number;
  targetMargin: number;
  /** Deterministic price floor: cost / (1 − target margin). Only when cost > 0. */
  minimumSafePrice: number | null;
  previousCost?: number;
  previousMargin?: number;
  costChangePct?: number;
  marginChangePp?: number;
  unitsSold: number;
  status: PriceStatus;
  severity: PriceSeverity;
  recommendation: PriceRecommendation;
  reasons: string[];
}

export interface PriceIntelligenceOptions {
  /** Phase 9 — branch scope. Uses branchPrice overrides for currentPrice. */
  branchId?: string;
  /** Restrict to products with at least this many units sold (0 = all). */
  minUnits?: number;
  /** Include healthy products too. Default true. */
  includeHealthy?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function marginPctFromFoodCost(foodCostPct: number): number {
  return Math.max(0, Math.round((100 - foodCostPct) * 10) / 10);
}

/**
 * Deterministic price intelligence per product. Read-only — no price mutation.
 * Every financial value comes from the existing deterministic services.
 */
export async function getPriceIntelligence(
  restaurantId: string,
  opts: PriceIntelligenceOptions = {},
): Promise<PriceIntelligenceRow[]> {
  const branchId = opts.branchId;
  const productScope = await resolveMenuProductScope(String(restaurantId));

  const [products, metrics] = await Promise.all([
    ProductModel.find({ $or: productScope, isDeleted: { $ne: true } })
      .select('_id name category price branchPrice averageCost code')
      .lean()
      .exec(),
    costIntelligenceService.metrics(String(restaurantId), { days: 60 }).catch(() => null),
  ]);

  const det = await costIntelligenceService
    .marginDeterioration(String(restaurantId), { days: 60 })
    .catch(() => ({ rows: [] } as any));
  const detById = new Map<string, any>((det?.rows || []).map((r: any) => [String(r.productId), r]));

  const profitById = new Map<string, any>(
    ((metrics as any)?.productProfitability || []).map((r: any) => [String(r.productId), r]),
  );

  const rows: PriceIntelligenceRow[] = [];

  for (const p of products as any[]) {
    const pid = String(p._id);
    const profit = profitById.get(pid);
    const detRow = detById.get(pid);

    // Selling price: branchPrice override wins when the request is branch-scoped.
    let currentPrice = Number(p.price) || 0;
    if (branchId && p.branchPrice && p.branchPrice.get?.(branchId) != null) {
      currentPrice = Number(p.branchPrice.get(branchId)) || 0;
    } else if (branchId && p.branchPrice && typeof p.branchPrice === 'object' && p.branchPrice[branchId] != null) {
      currentPrice = Number(p.branchPrice[branchId]) || 0;
    }

    // Recipe-backed: use the deterministic profitability row.
    let recipeCost = profit?.recipeCost != null ? Number(profit.recipeCost) : undefined;
    let foodCostPct = profit?.foodCostPercent != null ? Number(profit.foodCostPercent) : undefined;
    let currentMargin = profit?.contributionMarginPercent != null ? Number(profit.contributionMarginPercent) : undefined;
    const unitsSold = profit?.unitsSold != null ? Number(profit.unitsSold) : 0;

    // Not recipe-backed: deterministic averageCost-based estimate (same rule the
    // canonical recommendation context uses) so costed products are still covered.
    if (recipeCost === undefined || currentMargin === undefined) {
      const avgCost = Number(p.averageCost) || 0;
      if (avgCost > 0 && currentPrice > 0) {
        recipeCost = avgCost;
        foodCostPct = Math.round((avgCost / currentPrice) * 1000) / 10;
        currentMargin = marginPctFromFoodCost(foodCostPct);
      }
    }

    if (currentPrice <= 0 || recipeCost === undefined || recipeCost === null || recipeCost <= 0) {
      continue; // No cost truth → no price recommendation (never guess).
    }
    if (opts.minUnits && unitsSold < opts.minUnits) continue;

    const foodCost = foodCostPct ?? round2((recipeCost / currentPrice) * 100);
    const margin = currentMargin ?? marginPctFromFoodCost(foodCost);

    // Deterministic price floor from the TARGET_MARGIN rule.
    const minimumSafePrice = round2(recipeCost / (1 - TARGET_MARGIN_PCT / 100));

    // marginDeterioration rows carry previous AND current recipe cost — the
    // change % must be measured against the PREVIOUS period's cost.
    const prevCost = detRow ? Number(detRow.previousRecipeCost ?? detRow.recipeCost) : undefined;
    const prevMargin = detRow ? Number(detRow.previousContributionMarginPercent ?? detRow.contributionMarginPercent) : undefined;
    const costChangePct = prevCost && prevCost > 0 ? round2(((recipeCost - prevCost) / prevCost) * 100) : undefined;
    const marginChangePp = prevMargin !== undefined ? round2(margin - prevMargin) : undefined;

    const reasons: string[] = [];

    const belowFloor = currentPrice < minimumSafePrice;
    const costSpike = costChangePct !== undefined && costChangePct >= COST_SPIKE_PCT;
    const deteriorating = marginChangePp !== undefined && marginChangePp <= -DETERIORATION_PP;
    const lowMargin = margin < TARGET_MARGIN_PCT;
    const highFoodCost = foodCost > 60;

    // Precedence: the most actionable, deterministic signal wins the status
    // (price below floor > cost spike > margin deterioration > monitor).
    let status: PriceStatus = 'HEALTHY';
    let severity: PriceSeverity = 'none';
    let recommendation: PriceRecommendation = 'NO_ACTION';
    if (belowFloor) {
      status = 'BELOW_PRICE_FLOOR';
      severity = 'high';
      recommendation = 'REVIEW_PRICE';
      reasons.push(`Selling price ₹${round2(currentPrice)} is below the safe floor of ₹${minimumSafePrice} (recipe cost ₹${round2(recipeCost)} at ${TARGET_MARGIN_PCT}% target margin).`);
    } else if (costSpike) {
      status = 'COST_SPIKE';
      severity = 'high';
      recommendation = 'REVIEW_RECIPE';
      reasons.push(`Recipe cost rose ${round2(costChangePct!)}% (₹${round2(prevCost!)} → ₹${round2(recipeCost)}) while the selling price stayed at ₹${round2(currentPrice)}.`);
    } else if (deteriorating) {
      status = 'MARGIN_DETERIORATING';
      severity = 'medium';
      recommendation = 'REVIEW_PRICE';
      reasons.push(`Contribution margin dropped ${Math.abs(round2(marginChangePp!))} pp (${round2(prevMargin!)}% → ${round2(margin)}%).`);
    } else if (lowMargin || highFoodCost) {
      status = 'MONITOR';
      severity = 'low';
      recommendation = 'REVIEW_RECIPE';
      if (lowMargin) reasons.push(`Contribution margin ${round2(margin)}% is below the ${TARGET_MARGIN_PCT}% target — review recipe cost or portion before pricing decisions.`);
      if (highFoodCost) reasons.push(`Food cost ${round2(foodCost)}% of price exceeds the 60% guard — contribution is thin.`);
    }
    // Additional evidence rows ride along regardless of the winning status.
    if (costSpike && status !== 'COST_SPIKE') reasons.push(`Recipe cost also rose ${round2(costChangePct!)}% vs the previous period.`);
    if (deteriorating && status !== 'MARGIN_DETERIORATING') reasons.push(`Contribution margin also dropped ${Math.abs(round2(marginChangePp!))} pp vs the previous period.`);

    // includeHealthy defaults to TRUE — only exclude when explicitly false.
    if (opts.includeHealthy === false && status === 'HEALTHY') continue;

    rows.push({
      productId: pid,
      productName: p.name,
      category: p.category || undefined,
      currentPrice: round2(currentPrice),
      currentCost: round2(recipeCost),
      currentMargin: round2(margin),
      currentFoodCostPercent: round2(foodCost),
      targetMargin: TARGET_MARGIN_PCT,
      minimumSafePrice,
      previousCost: prevCost !== undefined ? round2(prevCost) : undefined,
      previousMargin: prevMargin !== undefined ? round2(prevMargin) : undefined,
      costChangePct,
      marginChangePp,
      unitsSold,
      status,
      severity,
      recommendation,
      reasons,
    });
  }

  const severityOrder = { high: 0, medium: 1, low: 2, none: 3 };
  rows.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.unitsSold - a.unitsSold);
  return rows;
}
