/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * comboHealthService.ts — Deterministic combo health & rework intelligence (Phase 12).
 *
 * Extends the EXISTING combo analytics (OfferAnalytics.getComboAnalytics +
 * classifyCombo) — it never recomputes revenue, cost, contribution or margin.
 * It only classifies each combo into a health status, maps that to an owner
 * recommendation, and — for rework candidates — finds real catalog products
 * with better deterministic contribution than the current combo components.
 *
 * Economic rule (12.4): a combo is never ranked by revenue alone. Margin and
 * contribution drive the health status; revenue only gates the evidence
 * sample (12.9): with fewer than MIN_EVIDENCE_UNITS sales the verdict is
 * INSUFFICIENT_DATA → MONITOR, never an aggressive RETIRE.
 *
 * Thresholds (centralized, reused from existing classifyCombo + MarginSafety):
 *   MIN_EVIDENCE_UNITS = 5  — same evidence floor classifyCombo treats as
 *                             LOW_PERFORMER (< 5 units)
 *   LOW_MARGIN_PCT     = 10 — margin below this is economically broken
 *   THIN_MARGIN_PCT    = 25 — below this the combo has little pricing room
 *   HIGH_DISCOUNT_RATE = 20% of combo revenue given up as structural savings
 */

import OfferModel from '../models/Offer';
import ProductModel from '../models/Product';
import { getComboAnalytics, classifyCombo, type ComboAnalyticsSummary } from './offerAnalyticsService';
import { costIntelligenceService } from '../modules/recipes/services/costIntelligenceService';
import { resolveMenuProductScope } from './productService';

// ─── Central, documented thresholds ───────────────────────────────────

export const MIN_EVIDENCE_UNITS = 5;
export const LOW_MARGIN_PCT = 10;
export const THIN_MARGIN_PCT = 25;
export const HIGH_DISCOUNT_RATE = 0.2;

export type ComboHealthStatus =
  | 'HEALTHY'
  | 'LOW_MARGIN'
  | 'HIGH_DISCOUNT'
  | 'LOW_DEMAND'
  | 'DECLINING'
  | 'HIGH_COST'
  | 'INSUFFICIENT_DATA';

export type ComboRecommendation =
  | 'NO_ACTION'
  | 'PROMOTE'
  | 'REPRICE'
  | 'REDUCE_DISCOUNT'
  | 'REWORK'
  | 'RETIRE'
  | 'MONITOR';

export interface ComboHealthRow {
  comboId: string;
  title: string;
  revenue: number;
  orders: number;
  units: number;
  redemptionRate: number | null;
  contribution: number;
  margin: number | null;
  discountImpact: number;
  healthStatus: ComboHealthStatus;
  riskFlags: string[];
  recommendation: ComboRecommendation;
  evidence: string[];
  /** Deterministic rework candidates (real catalog products, better contribution). */
  reworkCandidates?: Array<{ productId: string; productName: string; category?: string; contributionMarginPercent: number; replacementFor?: string }>;
}

export interface ComboHealthOptions {
  /** Phase 9 — branch scope for the analytics window. */
  branchId?: string;
}

function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic combo health for the restaurant. Read-only advisory — the owner
 * decides whether to reprice/rework/retire through the existing offer editor.
 */
export async function getComboHealth(
  restaurantId: string,
  opts: ComboHealthOptions = {},
): Promise<ComboHealthRow[]> {
  const window30 = { restaurantId, branchId: opts.branchId, from: daysAgoIso(30), to: undefined as string | undefined };
  const window7 = { restaurantId, branchId: opts.branchId, from: daysAgoIso(7), to: undefined as string | undefined };

  const [combos30, combos7] = await Promise.all([
    getComboAnalytics(window30).catch(() => []),
    getComboAnalytics(window7).catch(() => []),
  ]);
  if (combos30.length === 0) return [];

  const units7ById = new Map(combos7.map((c) => [c.offerId, c.units]));

  const offerDocs = await OfferModel.find({
    _id: { $in: combos30.map((c) => c.offerId) },
    restaurantId: restaurantId as any,
    isDeleted: { $ne: true },
  })
    .select('_id title comboProductIds comboPrice')
    .lean()
    .exec();
  const offerById = new Map(offerDocs.map((o: any) => [String(o._id), o]));

  // Component categories + contribution for rework candidate selection.
  const componentProductIds = new Set<string>();
  for (const o of offerDocs as any[]) {
    for (const pid of o.comboProductIds || []) componentProductIds.add(String(pid));
  }
  const productScope = await resolveMenuProductScope(String(restaurantId));
  const catalog = await ProductModel.find({ $or: productScope, isDeleted: { $ne: true } })
    .select('_id name category')
    .lean()
    .exec();
  const catById = new Map(catalog.map((p: any) => [String(p._id), p]));
  const componentCats = new Set<string>();
  for (const pid of componentProductIds) {
    const c = catById.get(pid);
    if (c?.category) componentCats.add(c.category);
  }
  const metrics = await costIntelligenceService
    .metrics(String(restaurantId), { days: 60 })
    .catch(() => null);
  const profitById = new Map<string, any>(
    ((metrics as any)?.productProfitability || []).map((r: any) => [String(r.productId), r]),
  );

  const rows: ComboHealthRow[] = [];

  for (const c of combos30) {
    const offer = offerById.get(c.offerId);
    const title = offer?.title || c.name;
    const flags = [...classifyCombo(c)];
    const evidence: string[] = [];
    const discountRate = c.comboRevenue > 0 ? c.structuralSavings / c.comboRevenue : 0;
    const discountImpact = Math.round((discountRate || 0) * 100);

    let status: ComboHealthStatus;
    let recommendation: ComboRecommendation;

    // 12.9 — a combo is DECLINING when last-7-day units are under 25% of the
    // 30-day run (and evidence is sufficient). Checked before the demand/health
    // branches so a collapsing bundle is never masked by absolute demand.
    const declining = c.units >= MIN_EVIDENCE_UNITS && (units7ById.get(c.offerId) ?? 0) < c.units * 0.25;

    if (c.units < MIN_EVIDENCE_UNITS) {
      // 12.9 — never make an aggressive call on thin evidence.
      status = 'INSUFFICIENT_DATA';
      recommendation = 'MONITOR';
      evidence.push(`Only ${c.units} unit(s) sold in 30 days — insufficient evidence for a rework/retire decision.`);
    } else if (c.contributionMargin !== null && c.contributionMargin < LOW_MARGIN_PCT) {
      status = 'LOW_MARGIN';
      recommendation = c.units >= 10 ? 'REPRICE' : 'REWORK';
      evidence.push(`Contribution margin ${Math.round(c.contributionMargin)}% is below the ${LOW_MARGIN_PCT}% floor — the bundle economics are broken at the current price.`);
      if (discountRate > HIGH_DISCOUNT_RATE) {
        flags.push('HIGH_DISCOUNT_LOW_CONTRIBUTION');
        evidence.push(`Structural discount ${discountImpact}% of combo revenue compounds the thin margin.`);
      }
    } else if (discountRate > HIGH_DISCOUNT_RATE && c.contributionMargin !== null && c.contributionMargin < THIN_MARGIN_PCT) {
      status = 'HIGH_DISCOUNT';
      recommendation = 'REDUCE_DISCOUNT';
      evidence.push(`Structural bundle discount of ${discountImpact}% with only ${Math.round(c.contributionMargin)}% margin — reduce the discount or reprice.`);
    } else if (declining) {
      if (c.contributionMargin !== null && c.contributionMargin < THIN_MARGIN_PCT) {
        status = 'DECLINING';
        recommendation = 'REWORK';
        evidence.push(`Demand is declining (${units7ById.get(c.offerId) ?? 0} units in the last 7 days vs ${c.units} in 30) and margin is thin.`);
      } else {
        status = 'DECLINING';
        recommendation = 'MONITOR';
        evidence.push(`Demand is declining but margin is healthy — monitor before acting.`);
      }
    } else if (c.units < 10) {
      status = 'LOW_DEMAND';
      recommendation = c.contributionMargin !== null && c.contributionMargin >= THIN_MARGIN_PCT ? 'PROMOTE' : 'MONITOR';
      evidence.push(`Low demand (${c.units} units/30d) with ${c.contributionMargin !== null ? Math.round(c.contributionMargin) + '% margin' : 'unknown margin'} — promote the bundle rather than reworking it.`);
    } else if (c.contributionMargin !== null && c.contributionMargin < THIN_MARGIN_PCT) {
      status = 'HIGH_COST';
      recommendation = 'REPRICE';
      evidence.push(`High demand (${c.units} units/30d) but contribution margin is only ${Math.round(c.contributionMargin)}% — component costs are too high for the price.`);
    } else {
      status = 'HEALTHY';
      recommendation = 'NO_ACTION';
      evidence.push(`Healthy demand (${c.units} units/30d) with ${Math.round(c.contributionMargin ?? 0)}% contribution margin.`);
    }

    const row: ComboHealthRow = {
      comboId: c.offerId,
      title,
      revenue: Math.round(c.comboRevenue),
      orders: c.orders,
      units: c.units,
      redemptionRate: c.repeatRate,
      contribution: Math.round(c.contribution),
      margin: c.contributionMargin !== null ? Math.round(c.contributionMargin * 10) / 10 : null,
      discountImpact,
      healthStatus: status,
      riskFlags: flags,
      recommendation,
      evidence,
    };

    // Rework candidates (12.6): real catalog products in the combo's component
    // categories with a BETTER deterministic contribution than the current
    // component — never invented, never from another tenant.
    if (recommendation === 'REWORK' || recommendation === 'REPRICE') {
      const currentComponentIds = new Set((offer?.comboProductIds || []).map(String));
      const candidates: Array<{ productId: string; productName: string; category?: string; contributionMarginPercent: number; replacementFor?: string }> = [];
      for (const pid of componentProductIds) {
        const comp = catById.get(pid);
        if (!comp) continue;
        const compMargin = Number(profitById.get(pid)?.contributionMarginPercent ?? -1);
        for (const cat of new Set([comp.category, ...componentCats])) {
          if (!cat) continue;
          for (const p of catalog as any[]) {
            if (p.category !== cat) continue;
            const id = String(p._id);
            if (currentComponentIds.has(id) || id === pid) continue;
            const margin = Number(profitById.get(id)?.contributionMarginPercent ?? -1);
            if (margin > compMargin && margin > THIN_MARGIN_PCT) {
              candidates.push({
                productId: id,
                productName: p.name,
                category: p.category,
                contributionMarginPercent: margin,
                replacementFor: comp.name,
              });
            }
          }
        }
      }
      const seen = new Set<string>();
      const deduped = candidates.filter((cd) => {
        const k = `${cd.productId}|${cd.replacementFor}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      row.reworkCandidates = deduped.sort((a, b) => b.contributionMarginPercent - a.contributionMarginPercent).slice(0, 3);
    }

    rows.push(row);
  }

  // Sort by severity: broken economics first, healthy last.
  const severity = { LOW_MARGIN: 0, HIGH_COST: 1, HIGH_DISCOUNT: 2, DECLINING: 3, LOW_DEMAND: 4, INSUFFICIENT_DATA: 5, HEALTHY: 6 };
  rows.sort((a, b) => (severity[a.healthStatus] ?? 9) - (severity[b.healthStatus] ?? 9));
  return rows;
}
