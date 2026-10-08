/**
 * =============================================================================
 * derive.ts — HISTORICAL FOUNDATION, PHASE 4 (PURE DERIVATION)
 * =============================================================================
 *
 * Pure functions that turn raw transaction rows into canonical HistoricalFacts
 * (the Phase 1 contract). NO I/O, NO writes, NO DB. The streaming extractor
 * (`scripts/historical/extract.ts`) feeds rows in; nothing here touches Mongo.
 *
 * Non-negotiables encoded:
 *   - businessDate comes from the row's own business date, else the restaurant
 *     timezone applied to createdAt — never a UTC slice (D5).
 *   - voided bills do not contribute revenue but are still counted, never silently
 *     dropped (prompt §26).
 *   - every fact carries provenance + datasetVersion + runId (prompt §28/§29).
 */

import { businessDateForTimezone } from './businessDay';
import { isBusinessDate, type HistoricalFact } from './dataContract';

/** Minimal shape of a bill row needed for sales derivation. */
export interface BillLike {
  _id?: unknown;
  restaurantId?: unknown;
  branchId?: unknown;
  date?: unknown;          // string YYYY-MM-DD (source business date)
  createdAt?: unknown;     // Date | string
  grandTotal?: unknown;
  discount?: unknown;
  gst?: unknown;
  subtotal?: unknown;
  isVoided?: unknown;
}

/**
 * Resolve a bill's business date. Prefers the stored `date` (already a business
 * date string); otherwise derives it in the restaurant timezone. Never UTC-slices.
 */
export function businessDateOfBill(bill: BillLike, timezone: string): string | null {
  if (typeof bill.date === 'string' && isBusinessDate(bill.date.slice(0, 10))) {
    return bill.date.slice(0, 10);
  }
  if (bill.createdAt) {
    try {
      return businessDateForTimezone(bill.createdAt as string | Date, timezone || 'UTC');
    } catch {
      return null;
    }
  }
  return null;
}

export interface DeriveOptions {
  /** Tenant scope — the ONLY legitimate source of restaurantId (prompt §7). */
  restaurantId: string;
  datasetVersion: string;
  runId: string;
  timezone: string;
  /** True when the source rows are synthetic dev data (prompt §32). */
  synthetic?: boolean;
}

interface DayAccumulator {
  billed: number;
  voided: number;
  grossRevenue: number;
  subtotal: number;
  discount: number;
  gst: number;
}

/**
 * Derive canonical daily sales facts from an iterable of bill rows for one
 * tenant. Stream-friendly: consumes the iterable once and accumulates only a
 * bounded (tenant, branch, businessDate) map — never the whole row set.
 */
export function deriveDailySalesFacts(
  bills: Iterable<BillLike>,
  opts: DeriveOptions,
): HistoricalFact<number>[] {
  const byKey = new Map<string, { branchId: string | null; businessDate: string; acc: DayAccumulator }>();

  for (const b of bills) {
    const restaurantId = b.restaurantId ? String(b.restaurantId) : null;
    // Tenant isolation: only rows whose restaurantId matches the approved scope.
    if (restaurantId !== opts.restaurantId) continue;
    const businessDate = businessDateOfBill(b, opts.timezone);
    if (!businessDate) continue;
    const branchId = b.branchId ? String(b.branchId) : null;
    const key = `${branchId ?? '∅'}|${businessDate}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { branchId, businessDate, acc: { billed: 0, voided: 0, grossRevenue: 0, subtotal: 0, discount: 0, gst: 0 } };
      byKey.set(key, entry);
    }
    const a = entry.acc;
    if (b.isVoided) {
      a.voided += 1;
      continue;
    }
    a.billed += 1;
    a.grossRevenue += num(b.grandTotal);
    a.subtotal += num(b.subtotal);
    a.discount += num(b.discount);
    a.gst += num(b.gst);
  }

  const facts: HistoricalFact<number>[] = [];
  const provenance = {
    source: 'bills',
    sourceCollections: ['bills'],
    derivationId: 'deriveDailySalesFacts@v1',
    synthetic: opts.synthetic ?? false,
  };
  for (const { branchId, businessDate, acc } of byKey.values()) {
    const push = (metric: string, value: number, unit: string) => {
      facts.push({
        restaurantId: opts.restaurantId,
        branchId,
        businessDate,
        metric,
        value: round2(value),
        unit,
        dataStatus: 'OBSERVED',
        provenance,
        datasetVersion: opts.datasetVersion,
        runId: opts.runId,
      });
    };
    push('sales.grossRevenue', acc.grossRevenue, 'INR');
    push('sales.subtotal', acc.subtotal, 'INR');
    push('sales.discount', acc.discount, 'INR');
    push('sales.gst', acc.gst, 'INR');
    push('sales.bills', acc.billed, 'count');
    push('sales.billsVoided', acc.voided, 'count');
  }
  return facts.sort((x, y) =>
    x.businessDate === y.businessDate
      ? (x.branchId ?? '').localeCompare(y.branchId ?? '') || x.metric.localeCompare(y.metric)
      : x.businessDate.localeCompare(y.businessDate),
  );
}

/**
 * Business dates absent from `facts` within [start,end]. Used to report missing
 * days WITHOUT converting them to zero (prompt §43).
 *
 * @param branchId  omitted → across ALL branches; null → branchless only; a
 *                  string → that branch only.
 */
export function missingBusinessDays(
  facts: HistoricalFact<number>[],
  start: string,
  end: string,
  branchId?: string | null,
): string[] {
  const scoped = branchId === undefined ? facts : facts.filter((f) => f.branchId === branchId);
  const present = new Set(scoped.map((f) => f.businessDate));
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < 3660 && cur <= end; i++) {
    if (!present.has(cur)) out.push(cur);
    cur = nextDay(cur);
  }
  return out;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().substring(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
