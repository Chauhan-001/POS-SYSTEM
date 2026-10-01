/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Uplit Model Client — pushes experiment rows to the uplift service's
 * POST /api/ingest/experiment-events (MLmodels/Uplit FastAPI backend).
 *
 * Auth mirrors the other ML clients: x-service-token + x-restaurant-id (the
 * Uplit guard resolves the tenant server-side; ML_ALLOW_HEADER_TENANT=on must
 * be set on the Uplit service for machine-to-machine pushes).
 */

import { exportUplitExperimentRows } from './experimentTracker';
import { config } from '../../config';

export interface UplitClientConfig {
  baseUrl: string;
  serviceToken?: string;
  timeoutMs: number;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getUplitClientConfig(): UplitClientConfig | null {
  const baseUrl = (process.env.ML_UPLIT_BASE_URL || '').trim();
  if (!baseUrl) return null; // integration disabled when unset
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceToken:
      (process.env.ML_SERVICE_TOKEN || config.mlPipeline?.serviceToken || '').trim() || undefined,
    timeoutMs: safeInt(process.env.ML_UPLIT_TIMEOUT_MS, config.mlPipeline?.demandTimeoutMs || 30_000),
  };
}

export interface UplitPushResult {
  configured: boolean;
  pushed: number;
  rejected: number;
  rejectedDetails: Array<{ index?: number; customer_id?: string; reason: string }>;
  treatedCount: number;
  convertedCount: number;
  error?: string;
}

/**
 * Node-side proxy reads for the POS dashboard: ranked uplift customers and
 * campaign targeting, forwarded to Uplit with the tenant's verified identity.
 */
async function uplitGet<T>(cfg: UplitClientConfig, restaurantId: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: {
        'x-restaurant-id': restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Uplit GET ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface UplitCustomerRow {
  customer_id: string;
  uplift_score: number;
  uplift_percentage_points: number;
  status?: string;
}

export async function fetchUplitRankedCustomers(
  restaurantId: string,
  limit = 50
): Promise<{ total_eligible: number; customers: UplitCustomerRow[] }> {
  const cfg = getUplitClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — uplift ranking unavailable');
  return uplitGet(cfg, restaurantId, `/api/customers?limit=${encodeURIComponent(String(limit))}`);
}

export async function fetchUplitCampaignTargeting(
  restaurantId: string,
  limit = 50
): Promise<{ total_eligible_customers: number; customers: UplitCustomerRow[] }> {
  const cfg = getUplitClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — campaign targeting unavailable');
  return uplitGet(cfg, restaurantId, `/api/campaigns/uplift-targeting?limit=${encodeURIComponent(String(limit))}`);
}

/**
 * Exports this tenant's experiment ledger and pushes it to Uplit. Every row
 * carries only pre-treatment features + treatment + purchase — Uplit's ingest
 * guard rejects leaked fields outright.
 */
export async function pushExperimentEventsToUplit(restaurantId: string): Promise<UplitPushResult> {
  const cfg = getUplitClientConfig();
  const exportResult = await exportUplitExperimentRows(restaurantId);

  const base = {
    treatedCount: exportResult.treatedCount,
    convertedCount: exportResult.convertedCount,
  };

  if (!cfg) {
    return {
      configured: false,
      pushed: 0,
      rejected: 0,
      rejectedDetails: [],
      ...base,
      error: 'ML_UPLIT_BASE_URL is not configured — export available but not pushed',
    };
  }

  if (exportResult.events.length === 0) {
    return {
      configured: true,
      pushed: 0,
      rejected: 0,
      rejectedDetails: [],
      ...base,
      error: 'No experiment events recorded yet (assign offers first)',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/ingest/experiment-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-restaurant-id': restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      body: JSON.stringify({ events: exportResult.events }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Uplit ingest failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      accepted_count?: number;
      rejected_count?: number;
      rejected?: Array<{ index?: number; customer_id?: string; reason: string }>;
    };
    return {
      configured: true,
      pushed: json.accepted_count ?? 0,
      rejected: json.rejected_count ?? 0,
      rejectedDetails: json.rejected ?? [],
      ...base,
    };
  } catch (err) {
    return {
      configured: true,
      pushed: 0,
      rejected: 0,
      rejectedDetails: [],
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
