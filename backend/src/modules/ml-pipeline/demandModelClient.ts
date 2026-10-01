/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demand Model Client — pushes extracted tenant data to the Demand model's
 * ingestion API (POST /api/ingest/pos-sync).
 *
 * Security model (P0 audit item #2): the ML service is unauthenticated by
 * default; until the Demand model verifies JWTs itself, this client forwards
 * the caller's verified JWT + tenant id over an INTERNAL header contract
 * (x-chitkuber-jwt / x-restaurant-id) and only to a trusted, operator-configured
 * base URL. The tenant id sent is ALWAYS the verified one — never derived from
 * any client-controlled input.
 */

import type {
  DemandPosSyncEnvelope,
  DemandIngestionSyncResult,
} from './demandIngestionContract';

import { config } from '../../config';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DemandClientConfig {
  /** Base URL of the Demand model service, e.g. http://localhost:3000 */
  baseUrl: string;
  /** Internal service token forwarded as x-service-token (recommended). */
  serviceToken?: string;
  /** Request timeout in ms. */
  timeoutMs: number;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getDemandClientConfig(): DemandClientConfig | null {
  // Read the env var at CALL time (config.ts snapshots env at import time,
  // which makes runtime/test configuration impossible). The env var remains
  // the single source of truth; config.mlPipeline documents it and serves as
  // the fallback for embedders that set config programmatically.
  const baseUrl = (process.env.ML_DEMAND_BASE_URL || config.mlPipeline?.demandBaseUrl || '').trim();
  if (!baseUrl) return null; // integration disabled when unset
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceToken:
      (process.env.ML_SERVICE_TOKEN || config.mlPipeline?.serviceToken || '').trim() || undefined,
    timeoutMs: safeInt(process.env.ML_DEMAND_TIMEOUT_MS, config.mlPipeline?.demandTimeoutMs || 30_000),
  };
}

// ─── Result types ────────────────────────────────────────────────────────────

export type BatchOutcome = 'synced' | 'rejected_rows' | 'failed';

export interface SyncOutcome {
  status: 'synced' | 'partial' | 'failed';
  batchesTotal: number;
  batchesSynced: number;
  batchesFailed: number;
  acceptedRows: number;
  rejectedRows: number;
  dataQualityScore: number | null;
  readinessStatus: string | null;
  batchResults: Array<{
    index: number;
    billsInBatch: number;
    outcome: BatchOutcome;
    accepted?: number;
    rejected?: number;
    error?: string;
  }>;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Syncs a tenant's extracted envelopes to the Demand model, one HTTP call per
 * envelope. Partial success is reported honestly: failed batches are listed
 * with their error, never swallowed.
 */
export async function syncBillsToDemandModel(
  restaurantId: string,
  envelopes: DemandPosSyncEnvelope[],
  options: { jwt?: string; serviceTokenMode?: boolean } = {}
): Promise<SyncOutcome> {
  const cfg = getDemandClientConfig();
  if (!cfg) {
    throw new Error('ML_DEMAND_BASE_URL is not configured — demand model sync disabled');
  }

  const outcome: SyncOutcome = {
    status: 'synced',
    batchesTotal: envelopes.length,
    batchesSynced: 0,
    batchesFailed: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    dataQualityScore: null,
    readinessStatus: null,
    batchResults: [],
  };

  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i];
    const billsInBatch = envelope.orders.length;

    try {
      const result = await postPosSync(cfg, restaurantId, envelope, {
        jwt: options.serviceTokenMode ? undefined : options.jwt,
      });
      const accepted = result.accepted_rows_count ?? 0;
      const rejected = result.rejected_rows_count ?? 0;

      outcome.acceptedRows += accepted;
      outcome.rejectedRows += rejected;
      if (typeof result.data_quality_score === 'number') {
        outcome.dataQualityScore = result.data_quality_score;
      }
      if (result.readiness_status) {
        outcome.readinessStatus = result.readiness_status;
      }

      if (accepted > 0 && rejected === 0) {
        outcome.batchesSynced += 1;
        outcome.batchResults.push({ index: i, billsInBatch, outcome: 'synced', accepted });
      } else if (accepted > 0 || rejected > 0) {
        outcome.batchesSynced += 1;
        outcome.status = 'partial';
        outcome.batchResults.push({
          index: i,
          billsInBatch,
          outcome: 'rejected_rows',
          accepted,
          rejected,
        });
      } else {
        // 2xx but nothing accepted — surface honestly, never pretend success
        outcome.batchesFailed += 1;
        outcome.status = 'partial';
        outcome.batchResults.push({
          index: i,
          billsInBatch,
          outcome: 'failed',
          error: 'Demand model accepted 0 rows (empty payload or all rows rejected)',
        });
      }
    } catch (err) {
      outcome.batchesFailed += 1;
      outcome.status = 'failed';
      outcome.batchResults.push({
        index: i,
        billsInBatch,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (outcome.batchesFailed > 0 && outcome.batchesSynced === 0) {
    outcome.status = 'failed';
  }

  return outcome;
}

async function postPosSync(
  cfg: DemandClientConfig,
  restaurantId: string,
  envelope: DemandPosSyncEnvelope,
  opts: { jwt?: string }
): Promise<DemandIngestionSyncResult> {
  const jwt = opts.jwt;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/ingest/pos-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-restaurant-id': restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
        ...(jwt ? { 'x-chitkuber-jwt': jwt } : {}),
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(
        `Demand model ingestion failed (HTTP ${res.status}): ${bodyText.slice(0, 300)}`
      );
    }

    const json = (await res.json()) as DemandIngestionSyncResult;
    return json;
  } finally {
    clearTimeout(timer);
  }
}
