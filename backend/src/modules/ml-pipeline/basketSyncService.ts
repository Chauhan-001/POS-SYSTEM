/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Basket Sync Service — orchestrates the Basket (combo intelligence) bridge:
 *
 *   MongoDB (Bills/BillItems/Products, tenant-scoped)
 *     → basketExtractor.extractBillsForBasket()
 *     → chunked BasketIngestEnvelope batches
 *     → basketModelClient.pushTransactionsToBasket()  (HTTP → Basket FastAPI)
 *
 * Tenant isolation: every entry point requires the VERIFIED restaurantId
 * (from req.user.restaurantId via requireAuth) — never client-supplied input.
 */

import { extractBillsForBasket } from './basketExtractor';
import {
  pushTransactionsToBasket,
  triggerBasketTraining,
  getBasketClientConfig,
  fetchBasketManagerRecommendations,
  type BasketClientConfig,
} from './basketModelClient';
import {
  BASKET_SYNC_MAX_TX_PER_BATCH,
  chunkArray,
  type BasketIngestEnvelope,
  type BasketIngestResult,
  type BasketManagerRecommendations,
  type SyncOutcomeShim,
} from './basketIngestionContract';

export interface BasketSyncResult {
  restaurantId: string;
  window: { fromDate: string | null; toDate: string | null };
  extraction: {
    totalBills: number;
    lineItems: number;
    byStatus: Record<'paid' | 'refunded', number>;
    excludedFreeItems: number;
    skippedNoMenuId: number;
    productsEnriched: number;
    earliestBillDate: string | null;
    latestBillDate: string | null;
  };
  sync: SyncOutcomeShim | null;
  configured: boolean;
}

/**
 * Runs one full extract→push cycle for a tenant. Surfaces partial failures
 * honestly; throws when the Basket service is not configured.
 */
export async function runBasketSync(
  restaurantId: string,
  options: { fromDate?: string; toDate?: string; limitBills?: number } = {},
  context: { serviceTokenMode?: boolean } = {}
): Promise<BasketSyncResult> {
  if (!restaurantId) {
    throw new Error('restaurantId is required (must come from verified JWT)');
  }

  const cfg: BasketClientConfig | null = getBasketClientConfig();
  if (!cfg) {
    throw new Error('ML_BASKET_BASE_URL is not configured — basket sync disabled');
  }

  const extraction = await extractBillsForBasket(restaurantId, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    limitBills: options.limitBills,
  });

  const windowInfo = {
    fromDate: extraction.stats.earliestBillDate,
    toDate: extraction.stats.latestBillDate,
  };

  if (extraction.envelope.transactions.length === 0) {
    return {
      restaurantId,
      window: windowInfo,
      extraction: { ...extraction.stats },
      sync: null,
      configured: true,
    };
  }

  const chunks = chunkArray(extraction.envelope.transactions, BASKET_SYNC_MAX_TX_PER_BATCH);

  const outcome: SyncOutcomeShim = {
    status: 'synced',
    batchesTotal: chunks.length,
    batchesSynced: 0,
    batchesFailed: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    failures: [],
  };

  for (const chunk of chunks) {
    try {
      const result: BasketIngestResult = await pushTransactionsToBasket(cfg, restaurantId, {
        transactions: chunk,
      });
      outcome.acceptedRows += result.accepted_count || 0;
      const failed = result.failed_count || 0;
      outcome.rejectedRows += failed;
      if (failed > 0) {
        outcome.status = 'partial';
        outcome.failures.push(...(result.failed || []));
      }
      outcome.batchesSynced += 1;
    } catch (err) {
      outcome.batchesFailed += 1;
      outcome.status = 'failed';
      outcome.failures.push({
        transaction_id: '(batch)',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (outcome.batchesFailed > 0 && outcome.batchesSynced === 0) outcome.status = 'failed';
  else if (outcome.batchesFailed > 0 || outcome.rejectedRows > 0) outcome.status = outcome.status === 'failed' ? 'failed' : 'partial';

  void context; // reserved for forwarded-JWT mode
  return {
    restaurantId,
    window: windowInfo,
    extraction: { ...extraction.stats },
    sync: outcome,
    configured: true,
  };
}

/**
 * Per-tenant training trigger (audit item #5 wiring): calls the Basket
 * service's /api/model/train — its own sufficiency gates decide whether a
 * model actually trains. Failures are returned, never thrown, so the
 * scheduler keeps processing other tenants.
 */
export async function triggerBasketTrainingSafe(
  restaurantId: string
): Promise<{ ok: boolean; detail: string; result?: BasketTrainResultShape }> {
  const cfg = getBasketClientConfig();
  if (!cfg) return { ok: false, detail: 'ML_BASKET_BASE_URL not configured' };
  try {
    const result = await triggerBasketTraining(cfg, restaurantId);
    return { ok: true, detail: 'training pipeline executed (gates decide outcome)', result };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export type BasketTrainResultShape = Awaited<ReturnType<typeof triggerBasketTraining>>;

/**
 * Pulls the tenant's manager recommendation table (combo predictions —
 * model-backed when a validated model is active, rule-based otherwise).
 * Returns null when the service is unreachable/misconfigured (caller logs).
 */
export async function fetchBasketCombos(
  restaurantId: string
): Promise<BasketManagerRecommendations | null> {
  const cfg = getBasketClientConfig();
  if (!cfg) return null;
  try {
    return await fetchBasketManagerRecommendations(cfg, restaurantId);
  } catch {
    return null;
  }
}
