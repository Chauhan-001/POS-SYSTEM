/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demand Sync Service — orchestrates the P0 data bridge:
 *
 *   MongoDB (Bills/BillItems/Products, tenant-scoped)
 *     → billExtractor.extractBillsForDemandModel()
 *     → chunked DemandPosSyncEnvelope batches
 *     → demandModelClient.syncBillsToDemandModel()  (HTTP → Demand model)
 *
 * Tenant isolation: every entry point requires the VERIFIED restaurantId
 * (from req.user.restaurantId via requireAuth) — never client-supplied input.
 */

import { extractBillsForDemandModel, type ExtractWindow } from './billExtractor';
import { recordMlEventFireAndForget } from './mlObservability';
import {
  syncBillsToDemandModel,
  getDemandClientConfig,
  type SyncOutcome,
} from './demandModelClient';
import {
  DEMAND_SYNC_MAX_BILLS_PER_BATCH,
  chunkArray,
} from './demandIngestionContract';

export interface DemandSyncOptions {
  fromDate?: string;
  toDate?: string;
  limitBills?: number;
}

export interface DemandSyncResult {
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
  sync: SyncOutcome | null;
  configured: boolean;
}

/**
 * Runs one full extract→push cycle for a tenant.
 * Throws when the ML service is not configured (caller decides UX), and
 * surfaces partial failures verbatim — never pretends all-good.
 */
export async function runDemandSync(
  restaurantId: string,
  options: DemandSyncOptions = {},
  context: { jwt?: string; serviceTokenMode?: boolean } = {}
): Promise<DemandSyncResult> {
  if (!restaurantId) {
    throw new Error('restaurantId is required (must come from verified JWT)');
  }

  const configured = getDemandClientConfig() !== null;

  const window: ExtractWindow = {
    fromDate: options.fromDate,
    toDate: options.toDate,
    limitBills: options.limitBills,
  };

  const extraction = await extractBillsForDemandModel(restaurantId, window);

  const windowInfo = {
    fromDate: extraction.stats.earliestBillDate,
    toDate: extraction.stats.latestBillDate,
  };

  if (extraction.envelope.orders.length === 0) {
    return {
      restaurantId,
      window: windowInfo,
      extraction: { ...extraction.stats },
      sync: null,
      configured,
    };
  }

  // Chunk orders (bills) into HTTP-sized batches.
  const chunks = chunkArray(extraction.envelope.orders, DEMAND_SYNC_MAX_BILLS_PER_BATCH);
  const envelopes = chunks.map((orders) => ({ orders }));

  const sync = await syncBillsToDemandModel(restaurantId, envelopes, {
    jwt: context.jwt,
    serviceTokenMode: context.serviceTokenMode,
  });

  // Job 3 observability: record sync failures (not successes — keep volume low).
  if (sync.status === 'failed') {
    recordMlEventFireAndForget({
      event: 'ml_prediction_failed',
      restaurantId,
      model: 'demand',
      severity: 'error',
      reason: `pos-sync failed: ${sync.batchesFailed}/${sync.batchesTotal} batches — ${sync.batchResults.find(b => b.error)?.error?.slice(0, 200) ?? 'unknown'}`,
    });
  }

  return {
    restaurantId,
    window: windowInfo,
    extraction: { ...extraction.stats },
    sync,
    configured,
  };
}
