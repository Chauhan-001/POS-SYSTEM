/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Basket Ingestion Contract — Node-side mirror of the Basket service's
 * POST /api/ingest/transactions schema (MLmodels/Market_Basket_Analysis/
 * backend/ingest_router.py). Canonical field names only — no invented fields.
 */

// ─── Envelope (POST /api/ingest/transactions) ────────────────────────────────

export interface BasketIngestItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  net_price: number;
  product_name?: string;
  category?: string;
  selling_price?: number;
  cost_price?: number;
}

export interface BasketIngestTransaction {
  transaction_id: string;
  timestamp: string; // ISO 8601
  customer_id?: string;
  order_status: 'completed' | 'cancelled' | 'refunded';
  payment_status: 'paid' | 'pending' | 'failed';
  channel: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  total_amount: number;
  discount_amount: number;
  items: BasketIngestItem[];
}

export interface BasketIngestEnvelope {
  transactions: BasketIngestTransaction[];
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface BasketIngestResult {
  success: boolean;
  restaurant_id?: string;
  accepted_count: number;
  failed_count: number;
  failed?: Array<{ transaction_id: string; reason: string }>;
  warnings?: string[];
  detail?: string;
}

export interface BasketTrainResult {
  success?: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface BasketManagerCombo {
  combo_id?: string;
  product_a_id: string;
  product_b_id: string;
  ml_prediction?: number | null;
  estimated_future_profit?: number | null;
  [key: string]: unknown;
}

export interface BasketManagerRecommendations {
  restaurant_id?: string;
  recommendation_mode?: string;
  model_version?: string | null;
  items: BasketManagerCombo[];
  detail?: string;
}

/** Basket batches: the service ingests each transaction with per-row saves. */
export const BASKET_SYNC_MAX_TX_PER_BATCH = 250;

export { chunkArray } from './demandIngestionContract';

/** Honest per-batch sync outcome (structural mirror of the Demand client's). */
export interface SyncOutcomeShim {
  status: 'synced' | 'partial' | 'failed';
  batchesTotal: number;
  batchesSynced: number;
  batchesFailed: number;
  acceptedRows: number;
  rejectedRows: number;
  failures: Array<{ transaction_id: string; reason: string }>;
}
