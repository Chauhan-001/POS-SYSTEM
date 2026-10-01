/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlSyncScheduler.ts — closes audit item #6 (scheduler/worker).
 *
 * Daily background job (setInterval, matching the repo's existing scheduler
 * convention in subscriptionScheduler.ts):
 *
 *   For each active restaurant:
 *     1. Incremental bill sync → Demand model (last 2 days; idempotent —
 *        the Demand model upserts on order_id, so overlaps just replace).
 *     1b. Incremental transaction sync → Basket service (same window;
 *         idempotent by transaction_id).
 *     2. Prediction pull → ml_predictions for the tenant's active products
 *        (demand forecasts) + combo recommendations (Basket).
 *     3. Retraining trigger → Demand model /api/retraining/evaluate+run AND
 *        Basket /api/model/train (each service's own gates decide whether to
 *        actually retrain — the scheduler only knocks).
 *
 * Opt-in via env (never runs in an unintended deployment):
 *   ML_SYNC_ENABLED=on               — master switch
 *   ML_SYNC_INTERVAL_MINUTES=1440    — cadence (default daily)
 *   ML_SYNC_RUN_ON_STARTUP=off       — immediate first run (default off)
 */

import Restaurant from '../../models/core/Restaurant';
import Product from '../../models/catalog/Product';
import { runDemandSync } from './demandSyncService';
import { pullDemandPredictions, pullBasketComboPredictions } from './predictionService';
import { getDemandClientConfig } from './demandModelClient';
import { runBasketSync, triggerBasketTrainingSafe } from './basketSyncService';
import { getBasketClientConfig } from './basketModelClient';
import { runSegmentSync, storeSegments } from './segmentSyncService';
import { getSegmentClientConfig } from './segmentModelClient';
import { evaluateDemandPredictionOutcomes } from './predictionFeedbackService';
import { recordMlEventFireAndForget } from './mlObservability';

const DEFAULT_INTERVAL_MINUTES = 1440; // daily
const INCREMENTAL_WINDOW_DAYS = 2; // overlap one extra day for late bills

function isEnabled(): boolean {
  return (
    (process.env.ML_SYNC_ENABLED || '').trim().toLowerCase() === 'on' &&
    (getDemandClientConfig() !== null || getBasketClientConfig() !== null || getSegmentClientConfig() !== null)
  );
}

function intervalMinutes(): number {
  const n = parseInt(process.env.ML_SYNC_INTERVAL_MINUTES || '', 10);
  return Number.isFinite(n) && n >= 5 ? n : DEFAULT_INTERVAL_MINUTES;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

let running = false;

async function runSyncCycle(): Promise<void> {
  if (running) return; // never overlap cycles
  running = true;
  const startedAt = Date.now();
  let syncedTenants = 0;
  let failedTenants = 0;
  let storedPredictions = 0;
  let retrainChecks = 0;
  let basketSyncedTenants = 0;
  let combosStored = 0;
  let basketTrainChecks = 0;
  let segmentsStored = 0;
  let feedbackEvaluations = 0;

  try {
    const restaurantIds = await Restaurant.find({ isActive: true })
      .select('_id')
      .lean<{ _id: { toString(): string } }[]>();

    // 0. PREDICTION → ACTUAL FEEDBACK (audit Phase 8): evaluate matured
    //    demand predictions against real bills, store durable outcomes, and
    //    push production performance to the Demand retraining engine. Runs
    //    BEFORE prediction pulls so today's rows are not double-counted.
    try {
      const feedback = await evaluateDemandPredictionOutcomes(
        restaurantIds.map((r) => r._id.toString())
      );
      feedbackEvaluations = feedback.outcomesStored;
      if (feedback.errors.length > 0) {
        for (const e of feedback.errors) console.error(`[MLSyncScheduler] feedback: ${e}`);
      }
      console.log(
        `[MLSyncScheduler] feedback pass — evaluated: ${feedback.predictionsEvaluated}, ` +
          `outcomes stored: ${feedback.outcomesStored}, missing actuals: ${feedback.missingActuals}, ` +
          `performance pushes: ${feedback.performancePushes}`
      );
    } catch (err) {
      console.error(
        '[MLSyncScheduler] feedback pass failed:',
        err instanceof Error ? err.message : err
      );
      recordMlEventFireAndForget({
        event: 'ml_feedback_failed',
        restaurantId: '*scheduler*',
        model: 'demand',
        severity: 'error',
        reason: `scheduler feedback pass failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      });
    }

    for (const r of restaurantIds) {
      const restaurantId = r._id.toString();
      try {
        // 1. Incremental bill sync (service-to-service; header-tenant mode is
        // enabled by the scheduler holding ML_SERVICE_TOKEN + ML_ALLOW_HEADER_TENANT=on
        // on the ML side, or a system JWT when configured).
        const sync = await runDemandSync(
          restaurantId,
          { fromDate: isoDaysAgo(INCREMENTAL_WINDOW_DAYS) },
          { serviceTokenMode: true }
        );
        if (sync.sync && sync.sync.status !== 'failed') syncedTenants += 1;
        else if (sync.sync?.status === 'failed') failedTenants += 1;

        // 1b. Incremental Basket sync (idempotent by transaction_id; skipped
        // silently when ML_BASKET_BASE_URL is unset).
        let basketSynced = false;
        if (getBasketClientConfig() !== null) {
          try {
            const basket = await runBasketSync(
              restaurantId,
              { fromDate: isoDaysAgo(INCREMENTAL_WINDOW_DAYS) },
              { serviceTokenMode: true }
            );
            basketSynced = basket.sync === null || basket.sync.status !== 'failed';
            if (basketSynced) basketSyncedTenants += 1;
            else failedTenants += 1;
          } catch (err) {
            failedTenants += 1;
            console.error(
              `[MLSyncScheduler] basket sync failed for ${restaurantId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }

        // 2. Prediction pull for the tenant's active products (cap for sanity).
        const products = await Product.find({ restaurantId, isAvailable: true })
          .select('_id')
          .limit(50)
          .lean<{ _id: { toString(): string } }[]>();
        if (products.length > 0 && sync.sync && sync.sync.status !== 'failed') {
          const pull = await pullDemandPredictions(restaurantId, {
            productIds: products.map((p) => p._id.toString()),
            horizonDays: 7,
            serviceTokenMode: true,
          });
          storedPredictions += pull.predictionsStored;
        }

        // 2b. Combo prediction pull (Basket → ml_predictions).
        if (basketSynced) {
          try {
            const comboPull = await pullBasketComboPredictions(restaurantId);
            combosStored += comboPull.predictionsStored;
          } catch (err) {
            console.error(
              `[MLSyncScheduler] combo pull failed for ${restaurantId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }

        // 3. Retraining checks (each model evaluates its own gates).
        const triggered = await triggerRetrainingCheck(restaurantId);
        if (triggered) retrainChecks += 1;
        if (basketSynced) {
          const train = await triggerBasketTrainingSafe(restaurantId);
          if (train.ok) basketTrainChecks += 1;
        }

        // 2c. Customer segmentation (4th model): extract → push + gated train
        //     → fetch → store. Skipped silently when ML_SEGMENT_BASE_URL unset.
        if (getSegmentClientConfig() !== null) {
          try {
            const seg = await runSegmentSync(restaurantId);
            if (seg.segments) {
              const stored = await storeSegments(restaurantId, seg.segments);
              segmentsStored += stored.stored;
            }
          } catch (err) {
            console.error(
              `[MLSyncScheduler] segmentation failed for ${restaurantId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      } catch (err) {
        failedTenants += 1;
        console.error(
          `[MLSyncScheduler] tenant ${restaurantId} cycle failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log(
      `[MLSyncScheduler] cycle done in ${Date.now() - startedAt}ms — ` +
        `tenants: ${restaurantIds.length}, synced: ${syncedTenants}, basket synced: ${basketSyncedTenants}, ` +
        `failed: ${failedTenants}, predictions stored: ${storedPredictions}, combos stored: ${combosStored}, ` +
        `retrain checks: ${retrainChecks}, basket train checks: ${basketTrainChecks}, segments stored: ${segmentsStored}, feedback outcomes: ${feedbackEvaluations}`
    );
    if (failedTenants > 0) {
      recordMlEventFireAndForget({
        event: 'ml_scheduler_failed',
        restaurantId: '*scheduler*',
        model: 'demand',
        severity: 'warning',
        reason: `cycle had ${failedTenants} failed tenant step(s) of ${restaurantIds.length}`,
        durationMs: Date.now() - startedAt,
      });
    }
  } finally {
    running = false;
  }
}

/**
 * Calls the Demand model's retraining evaluate+run endpoints for one tenant's
 * top product set. Failures are logged, never thrown — retraining is
 * opportunistic and its own gates decide whether anything happens.
 */
async function triggerRetrainingCheck(restaurantId: string): Promise<boolean> {
  const cfg = getDemandClientConfig();
  if (!cfg) return false;
  try {
    const products = await Product.find({ restaurantId, isAvailable: true })
      .select('_id')
      .limit(10)
      .lean<{ _id: { toString(): string } }[]>();
    for (const p of products) {
      const productId = p._id.toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        await fetch(`${cfg.baseUrl}/api/retraining/run`, {
          method: 'POST',
          headers: serviceHeaders(restaurantId),
          body: JSON.stringify({ restaurant_id: restaurantId, product_id: productId, manual: true }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }
    return true;
  } catch (err) {
    console.error(
      `[MLSyncScheduler] retraining check failed for ${restaurantId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

function serviceHeaders(restaurantId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-service-token': process.env.ML_SERVICE_TOKEN || '',
    'x-restaurant-id': restaurantId, // valid when ML_ALLOW_HEADER_TENANT=on
  };
}

export function startMLSyncScheduler(): void {
  if (!isEnabled()) {
    console.log('[MLSyncScheduler] disabled (set ML_SYNC_ENABLED=on + ML_DEMAND_BASE_URL to enable)');
    return;
  }
  const mins = intervalMinutes();
  console.log(`[MLSyncScheduler] starting — every ${mins} minutes`);

  if ((process.env.ML_SYNC_RUN_ON_STARTUP || '').trim().toLowerCase() === 'on') {
    void runSyncCycle();
  }
  setInterval(() => void runSyncCycle(), mins * 60 * 1000);
}
