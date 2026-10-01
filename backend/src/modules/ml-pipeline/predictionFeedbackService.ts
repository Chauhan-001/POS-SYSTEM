/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * predictionFeedbackService.ts — closes audit Phase 8 (broken feedback loop).
 *
 * Closes the loop:
 *
 *   ml_predictions (demand forecasts, day-scoped, TTL'd)
 *        ↓  once predictionFor < today, actuals exist in Bills
 *   match against real BillItem quantities (tenant-stamped query only)
 *        ↓
 *   absoluteError / signedError / errorPct (divide-by-zero guarded;
 *   missing actuals stay null — never fabricated)
 *        ↓
 *   MLPredictionOutcome (durable — survives the 3-day prediction TTL)
 *        ↓
 *   pushProductionPerformance → Demand model /api/retraining/performance
 *   (the existing retraining trigger engine's performance_degradation
 *   trigger consumes these as actual-outcome metrics — no new retraining
 *   algorithm; same engine, real production error as input).
 *
 * Tenant safety: every query is stamped with the caller-provided
 * restaurantId, which upstream routes always take from the verified JWT.
 */

import mongoose from 'mongoose';
import MLPrediction from '../../models/intelligence/MLPrediction';
import MLPredictionOutcome from '../../models/intelligence/MLPredictionOutcome';
import Bill from '../../models/intelligence/Bill';
import BillItem from '../../models/intelligence/BillItem';
import { getDemandClientConfig } from './demandModelClient';

// ─── Actuals matching ────────────────────────────────────────────────────────

/**
 * Real sold quantities for one tenant on one date, grouped by product id.
 * Mirrors the billExtractor business rules: voided bills excluded, free
 * items excluded, fully-refunded line quantities subtracted.
 */
async function getActualQuantitiesByProduct(
  restaurantId: string,
  date: string
): Promise<Map<string, number>> {
  const bills = await Bill.find({ restaurantId, date, isVoided: false })
    .select('_id isRefunded refundedItems')
    .lean<{ _id: { toString(): string }; isRefunded: boolean; refundedItems?: Array<{ menuItemId?: string; quantity: number }> }[]>();

  const actuals = new Map<string, number>();
  if (bills.length === 0) return actuals;

  const billObjectIds = bills.map((b) => new mongoose.Types.ObjectId(b._id.toString()));
  const items = await BillItem.find({ billId: { $in: billObjectIds } })
    .select('billId menuItemId quantity isFree')
    .lean<{ billId: { toString(): string }; menuItemId?: string; quantity: number; isFree: boolean }[]>();

  const billById = new Map(bills.map((b) => [b._id.toString(), b]));

  for (const item of items) {
    if (item.isFree || !item.menuItemId) continue;
    const bill = billById.get(item.billId.toString());
    if (!bill) continue;

    let qty = item.quantity;
    if (!bill.isRefunded && Array.isArray(bill.refundedItems)) {
      const refunded = bill.refundedItems
        .filter((r) => r?.menuItemId === item.menuItemId)
        .reduce((sum, r) => sum + (r.quantity || 0), 0);
      qty -= refunded;
    } else if (bill.isRefunded) {
      // Whole bill refunded → contributes zero demand (the Demand model's
      // validator treats refunded rows as non-demand as well).
      qty = 0;
    }
    if (qty <= 0) continue;
    actuals.set(item.menuItemId, (actuals.get(item.menuItemId) || 0) + qty);
  }

  return actuals;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export interface FeedbackRunStats {
  tenantsEvaluated: number;
  predictionsEvaluated: number;
  outcomesStored: number;
  missingActuals: number;
  performancePushes: number;
  errors: string[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Evaluates all matured (predictionFor < today) demand predictions for the
 * given tenants. Idempotent per (tenant, product, date) via upsert.
 */
export async function evaluateDemandPredictionOutcomes(
  restaurantIds: string[]
): Promise<FeedbackRunStats> {
  const stats: FeedbackRunStats = {
    tenantsEvaluated: 0,
    predictionsEvaluated: 0,
    outcomesStored: 0,
    missingActuals: 0,
    performancePushes: 0,
    errors: [],
  };

  const today = todayISO();

  for (const restaurantId of restaurantIds) {
    try {
      stats.tenantsEvaluated += 1;

      // Only matured, tenant-scoped demand predictions.
      const predictions = await MLPrediction.find({
        restaurantId,
        modelName: 'demand',
        predictionType: 'product_demand',
        predictionFor: { $lt: today },
      })
        .limit(2000)
        .lean<Record<string, any>[]>();

      if (predictions.length === 0) continue;

      // Group by date → one actuals query per date per tenant.
      const byDate = new Map<string, Record<string, any>[]>();
      for (const p of predictions) {
        const list = byDate.get(p.predictionFor);
        if (list) list.push(p);
        else byDate.set(p.predictionFor, [p]);
      }

      for (const [date, preds] of byDate) {
        const actuals = await getActualQuantitiesByProduct(restaurantId, date);

        for (const p of preds) {
          stats.predictionsEvaluated += 1;
          const expected = Number((p.prediction as any)?.expected ?? NaN);
          if (!Number.isFinite(expected)) continue;

          const actual =
            actuals.get(p.entityId) ?? (actuals.size > 0 ? 0 : null);
          // Distinguish "product sold 0 that day" (actual = 0, real
          // observation) from "no bills at all for the date" (null — the day
          // may have been closed / not synced; do not invent an actual).

          const hasActual = actual !== null && actual !== undefined && Number.isFinite(actual);
          const actualValue = hasActual ? (actual as number) : null;
          const absoluteError = hasActual ? Math.abs((actual as number) - expected) : null;
          const signedError = hasActual ? (actual as number) - expected : null;
          // Divide-by-zero guard: errorPct only when actual > 0.
          const errorPct =
            hasActual && (actual as number) > 0
              ? absoluteError! / (actual as number)
              : null;

          await MLPredictionOutcome.updateOne(
            {
              restaurantId: restaurantId as any,
              modelName: 'demand',
              predictionType: 'product_demand',
              productId: p.entityId,
              predictionFor: date,
            },
            {
              $set: {
                modelVersion: p.modelVersion || 'unknown',
                predictedValue: expected,
                actualValue,
                absoluteError,
                signedError,
                errorPct,
                evaluatedAt: new Date(),
              },
            },
            { upsert: true }
          );
          if (hasActual) stats.outcomesStored += 1;
          else stats.missingActuals += 1;
        }
      }

      // Feed aggregates to the Demand retraining engine.
      const pushed = await pushProductionPerformance(restaurantId);
      if (pushed) stats.performancePushes += 1;
    } catch (err) {
      stats.errors.push(
        `tenant ${restaurantId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return stats;
}

// ─── Retraining-engine feed ──────────────────────────────────────────────────

export interface ProductionPerformanceReport {
  restaurant_id: string;
  source: 'production_feedback';
  window_start: string;
  window_end: string;
  sample_count: number;
  mean_absolute_error: number | null;
  mean_wape: number | null; // weighted absolute percentage error over evaluated days
  products: Array<{
    product_id: string;
    sample_count: number;
    mean_absolute_error: number | null;
    mean_wape: number | null;
  }>;
}

/**
 * Aggregates durable outcomes into a production-performance report and POSTs
 * it to the Demand model's /api/retraining/performance endpoint, which
 * registers it with the retraining trigger engine (performance_degradation
 * trigger input). No-op (returns null) when the Demand service is not
 * configured or no evaluated outcomes exist yet.
 */
export async function buildProductionPerformance(
  restaurantId: string,
  windowDays = 30
): Promise<ProductionPerformanceReport | null> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceStr = since.toISOString().slice(0, 10);

  const outcomes = await MLPredictionOutcome.find({
    restaurantId,
    modelName: 'demand',
    predictionType: 'product_demand',
    predictionFor: { $gte: sinceStr },
    actualValue: { $ne: null },
  })
    .limit(5000)
    .lean<Record<string, any>[]>();

  if (outcomes.length === 0) return null;

  const byProduct = new Map<string, { absErrSum: number; actualSum: number; count: number }>();
  let absErrSum = 0;
  let actualSum = 0;
  let count = 0;
  let windowEnd = sinceStr;

  for (const o of outcomes) {
    const absErr = Number(o.absoluteError);
    const actual = Number(o.actualValue);
    if (!Number.isFinite(absErr) || !Number.isFinite(actual)) continue;
    const entry = byProduct.get(o.productId) || { absErrSum: 0, actualSum: 0, count: 0 };
    entry.absErrSum += absErr;
    entry.actualSum += actual;
    entry.count += 1;
    byProduct.set(o.productId, entry);
    absErrSum += absErr;
    actualSum += actual;
    count += 1;
    if (o.predictionFor > windowEnd) windowEnd = o.predictionFor;
  }
  if (count === 0) return null;

  return {
    restaurant_id: restaurantId,
    source: 'production_feedback',
    window_start: sinceStr,
    window_end: windowEnd,
    sample_count: count,
    mean_absolute_error: absErrSum / count,
    // WAPE = Σ|error| / Σ|actual| — undefined (null) when total actual is 0.
    mean_wape: actualSum > 0 ? absErrSum / actualSum : null,
    products: Array.from(byProduct.entries()).map(([productId, e]) => ({
      product_id: productId,
      sample_count: e.count,
      mean_absolute_error: e.absErrSum / e.count,
      mean_wape: e.actualSum > 0 ? e.absErrSum / e.actualSum : null,
    })),
  };
}

/**
 * Pushes the production-performance report to the Demand model. The endpoint
 * records it for the retraining trigger engine's performance_degradation
 * evaluation; failures are logged, never thrown (feedback is opportunistic).
 */
export async function pushProductionPerformance(restaurantId: string): Promise<boolean> {
  const cfg = getDemandClientConfig();
  if (!cfg) return false;
  try {
    const report = await buildProductionPerformance(restaurantId);
    if (!report) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/api/retraining/performance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': cfg.serviceToken || '',
          'x-restaurant-id': restaurantId,
        },
        body: JSON.stringify(report),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(
      `[predictionFeedback] performance push failed for ${restaurantId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
