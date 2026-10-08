/**
 * =============================================================================
 * dataContract.ts — CHITKUBER 1-YEAR HISTORICAL DATA FOUNDATION, PHASE 1
 * =============================================================================
 *
 * Canonical data contract for the historical-data foundation.
 *
 * This file is intentionally PURE (types + constants + tiny helpers). It performs
 * NO I/O, touches NO collection, and changes NO existing behaviour. It is the
 * vocabulary every later phase reads, and the single source of truth for:
 *
 *   - how a historical fact is shaped (restaurant/branch/businessDate + value)
 *   - how provenance and dataset versioning are recorded (prompt §28, §29)
 *   - which data-status values are allowed (OBSERVED | RECONSTRUCTED | PARTIAL | UNAVAILABLE)
 *   - which classification actions are allowed (prompt §4)
 *
 * HARD RULES encoded here (never violated by later phases):
 *   - restaurantId/branchId are ALWAYS caller/run-supplied scope, never LLM/client.
 *   - businessDate is a restaurant-timezone calendar date string (YYYY-MM-DD),
 *     NOT a UTC slice (prompt §9, finding D5).
 *   - `null` means "historically unavailable"; `0` means a measured zero. They are
 *     distinct and must never be conflated (prompt §26).
 *   - value === null REQUIRES dataStatus === 'UNAVAILABLE' (fabrication guard).
 */

/** Allowed per-fact historical status (prompt §27). */
export const DATA_STATUSES = ['OBSERVED', 'RECONSTRUCTED', 'PARTIAL', 'UNAVAILABLE'] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];

/** Allowed per-domain classification action (prompt §4). */
export const HISTORICAL_ACTIONS = [
  'REUSE_EXISTING',
  'RECONSTRUCT',
  'BACKFILL_MISSING',
  'GENERATE_SYNTHETIC_DEV_DATA',
  'COLLECT_GOING_FORWARD',
  'LEAVE_OPERATIONAL_ONLY',
  'NOT_APPLICABLE',
] as const;
export type HistoricalAction = (typeof HISTORICAL_ACTIONS)[number];

/** Execution mode. Default is always DRY_RUN (prompt §48). */
export const EXECUTION_MODES = ['DRY_RUN', 'VALIDATE_ONLY', 'APPLY'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'DRY_RUN';

/** Product surfaces a historical fact may serve (prompt §12). */
export const PRODUCT_SURFACES = [
  'RestaurantPOS',
  'AdminPOS',
  'CustomerSite',
  'Backend',
  'Reports',
  'Finance',
  'Marketing',
  'Inventory',
  'AI',
  'ML',
] as const;
export type ProductSurface = (typeof PRODUCT_SURFACES)[number];

/**
 * Scope of a historical run. `restaurantId` originates from the approved run
 * configuration ONLY — never from a request body, client field, or LLM output.
 */
export interface HistoricalScope {
  /** Tenant scope. Required. */
  restaurantId: string;
  /** Branch scope; null = tenant-wide (restaurant-wide) run. */
  branchId: string | null;
}

/**
 * Versioning envelope for any extraction/backfill/derivation run (prompt §29).
 * Every canonical fact carries the runId + datasetVersion that produced it so a
 * later ML dataset can identify exactly which history it consumed.
 */
export interface DatasetRun {
  /** Monotonic/opaque dataset version, e.g. "hist-v1". */
  datasetVersion: string;
  /** Unique id for this run. */
  runId: string;
  /** ISO timestamp the run was generated. */
  generatedAt: string;
  /** Inclusive source date range the run read (business dates). */
  sourceRange: { start: string; end: string };
  /** Tenants the run was scoped to. */
  restaurantScope: string[];
  /** Branches the run was scoped to; empty = restaurant-wide. */
  branchScope: string[];
  /** Execution mode the run was invoked with. */
  mode: ExecutionMode;
}

/** Provenance for a canonical fact/metric (prompt §28). */
export interface FactProvenance {
  /** Human-readable derivation source, e.g. "DailySummary" or "bills+receiptfeedbacks". */
  source: string;
  /** Underlying live collections the value was derived from. */
  sourceCollections: string[];
  /** Stable id of the derivation (function/rule) that produced the value. */
  derivationId: string;
  /** True when the value came from the synthetic dev-data harness (prompt §32). */
  synthetic: boolean;
}

/**
 * A single canonical historical fact. Conceptually:
 *   { restaurantId, branchId, businessDate, metric, value, source, derivationId,
 *     dataStatus, datasetVersion }   — prompt §28.
 */
export interface HistoricalFact<TValue = number> {
  restaurantId: string;
  branchId: string | null;
  /** Restaurant-timezone calendar date, "YYYY-MM-DD". */
  businessDate: string;
  /** Stable metric key, e.g. "sales.grossRevenue". */
  metric: string;
  /** Measured value. `null` ⇒ historically UNAVAILABLE (never coerced to 0). */
  value: TValue | null;
  /** Unit of the value, e.g. "INR", "count", "kg". */
  unit: string;
  /** Historical status of THIS fact. */
  dataStatus: DataStatus;
  provenance: FactProvenance;
  datasetVersion: string;
  runId: string;
}

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `s` is a syntactically valid YYYY-MM-DD business date. */
export function isBusinessDate(s: string): boolean {
  if (!BUSINESS_DATE_RE.test(s)) return false;
  // Reject impossible calendar dates (2026-02-30, 2026-13-01).
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Fabrication guard. A fact whose value is unavailable MUST be labelled
 * UNAVAILABLE, and an unavailable fact MUST carry a null value. Used by later
 * phases and the test suite to make "unknown vs zero" violations fail loudly.
 */
export function assertFactConsistency<T>(fact: HistoricalFact<T>): void {
  if (fact.value === null && fact.dataStatus !== 'UNAVAILABLE') {
    throw new Error(
      `historical fact ${fact.metric}: null value must have dataStatus UNAVAILABLE (got ${fact.dataStatus})`,
    );
  }
  if (fact.dataStatus === 'UNAVAILABLE' && fact.value !== null) {
    throw new Error(
      `historical fact ${fact.metric}: UNAVAILABLE must have a null value (got ${String(fact.value)})`,
    );
  }
  if (!isBusinessDate(fact.businessDate)) {
    throw new Error(`historical fact ${fact.metric}: invalid businessDate ${fact.businessDate}`);
  }
}
