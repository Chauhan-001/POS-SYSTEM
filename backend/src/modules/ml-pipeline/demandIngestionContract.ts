/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demand Ingestion Contract — the single source of truth for the payload
 * exchanged between ChitKuber's backend and the Demand_forcasting_model's
 * ingestion API (MLmodels/Demand_forcasting_model, POST /api/ingest/pos-sync).
 *
 * IMPORTANT: this file is a mirror of the schema consumed by the Demand
 * model's SchemaMappingEngine + POSAPIDataSource (see
 * MLmodels/Demand_forcasting_model/src/forecasting.ts lines ~11419-12413).
 * Do NOT invent fields here that the receiving end does not understand;
 * every alias below is one the SchemaMappingEngine actually reads.
 *
 * The mapping engine on the receiving side is alias-based: it recognizes
 * `order_id | orderid | bill_no | ...` for the order, `product_id | item_id |
 * sku | ...` for the product, etc. This contract emits the canonical alias
 * for every field so mapping is deterministic, never accidental.
 */

// ─── Normalized per-line-item row (what the Demand model ultimately stores) ───

/**
 * One normalized sales row as the Demand model's IngestionValidator sees it.
 * Kept as a structural type so tests can construct partial fixtures without
 * depending on the ML repo's TS build.
 */
export interface DemandNormalizedRow {
  restaurant_id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  category: string;
  date: string; // YYYY-MM-DD (derived by the Demand model from `timestamp`)
  timestamp: string; // ISO 8601
  quantity: number;
  unit_price: number;
  discount: number; // percentage 0-100 per SchemaMappingEngine semantics
  final_price: number;
  payment_status: 'paid' | 'pending' | 'cancelled' | 'refunded';
  customer_id?: string;
  stockout: boolean;
  menu_available: boolean;
}

// ─── POS-sync envelope (POST /api/ingest/pos-sync) ────────────────────────────

/**
 * Canonical POS-sync payload. POSAPIDataSource flattens `orders[].items[]`
 * and forwards { order_id, timestamp, customer_id, payment_status, ...item }
 * records into SchemaMappingEngine.normalizeRecord.
 */
export interface DemandPosSyncEnvelope {
  orders: Array<{
    order_id: string;
    timestamp: string; // ISO 8601 — SchemaMappingEngine derives date via new Date(...)
    customer_id?: string;
    payment_status: 'paid' | 'cancelled' | 'refunded' | 'pending';
    items: Array<{
      product_id: string;
      product_name: string;
      category?: string;
      quantity: number;
      unit_price: number;
      discount?: number; // percentage 0-100 (SchemaMappingEngine semantics)
      /**
       * REAL availability signal (audit Phase 7 fix): true only when the POS
       * itself marked the item sold out / unavailable — MenuAvailability
       * status 'UNAVAILABLE' or Product.availability=false at extraction
       * time. NEVER inferred from zero sales. The Demand model's
       * SchemaMappingEngine reads this alias ('stockout') and feeds it into
       * inventory records + demand-censoring features instead of fabricating
       * opening stock.
       */
      stockout?: boolean;
      /**
       * Explicit menu availability; omitted = the receiving engine's default
       * (menu_available defaults to !stockout). Sent only when the tenant has
       * an explicit MenuAvailability row for the product.
       */
      menu_available?: boolean;
    }>;
  }>;
}

/** One order (bill) in the POS-sync envelope. */
export type DemandOrderRecord = DemandPosSyncEnvelope['orders'][number];

/** One line item within a DemandOrderRecord. */
export type DemandOrderItemRecord = DemandOrderRecord['items'][number];

// ─── Response types (PipelineExecutionResult subset we rely on) ──────────────

export interface DemandIngestionQualityReportSummary {
  data_quality_score: number;
  readiness_status: string;
  missing_rate?: number;
  duplicate_rate?: number;
  stockout_rate?: number;
  coverage_start_date?: string;
  coverage_end_date?: string;
}

/**
 * Subset of the Demand model's PipelineExecutionResult that the backend
 * inspects. Structural typing keeps the integration decoupled from the ML
 * repo's exact TS types.
 */
export interface DemandIngestionSyncResult {
  success: boolean;
  source_name?: string;
  source_type?: string;
  restaurant_id?: string;
  batch_id?: string;
  total_raw_rows?: number;
  accepted_rows_count: number;
  rejected_rows_count: number;
  data_quality_score?: number;
  readiness_status?: string;
  quality_report?: DemandIngestionQualityReportSummary;
  error?: string;
}

// ─── Chunking helper ─────────────────────────────────────────────────────────

/**
 * The Demand model reads the entire body into memory (express.json limit
 * '10mb') and processes it synchronously. Keep batches comfortably below the
 * 10 MB JSON ceiling: 500 bills ≈ 1-3k line items ≈ well under 1 MB.
 */
export const DEMAND_SYNC_MAX_BILLS_PER_BATCH = 500;

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
