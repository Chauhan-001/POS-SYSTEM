/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * businessSignalTypes.ts — PHASE 3 canonical business-intelligence signal
 * representation for the Marketing Agent.
 *
 * ARCHITECTURE (do not duplicate):
 *   - The canonical PERSISTED signal model already exists:
 *     `models/intelligence/IntelligenceSignal` (type/entity/value/confidence/
 *     evidence/sampleSize/detectedAt/expiresAt/tenant+branch scope). Phase 3
 *     does NOT create a second signal store and does NOT write to it here.
 *   - This module defines the IN-MEMORY, agent-facing *normalized* view built
 *     by reading the existing read-only tools and services. It adapts the
 *     existing `SignalType` vocabulary (reused verbatim) into a stable
 *     agent-facing shape with explicit freshness, provenance and scope.
 *
 * Signals are EVIDENCE, never recommendations, and never a replacement for
 * the authoritative source systems (bills, inventory, customers, offers).
 */

import { z } from 'zod';
import type { SignalType } from '../../models/intelligence/IntelligenceSignal';

/**
 * Agent-facing canonical signal codes. These EXTEND the persisted
 * `SignalType` vocabulary with the neutral, tool-derived facts the agent
 * consumes. Persisted vocabulary is reused verbatim wherever it exists.
 */
export const BUSINESS_SIGNAL_CODES = [
  // ── Sales ──
  'sales_revenue_level',
  'sales_aov_level',
  'sales_weekday_peak',
  'sales_weekday_trough',
  'sales_hour_peak',
  'sales_hour_trough',
  'sales_category_strong',
  'sales_category_weak',
  // ── Menu / margin ──
  'product_high_margin',
  'product_low_margin',
  'product_high_demand',
  'product_slow_moving',
  'product_declining',
  'product_growing',
  // ── Inventory ──
  'inventory_low',
  'inventory_overstock',
  'inventory_expiring',
  'inventory_stockout_risk',
  // ── Customers ──
  'customer_segment_present',
  'customer_inactive_high',
  'customer_high_value_present',
  // ── Marketing history ──
  'offer_underperforming',
  'offer_active',
  'campaign_underperforming',
  'campaign_effective',
  // ── Demand / basket ──
  'product_high_demand_forecast',
  'basket_pair_strength',
  // ── Context ──
  'festival_upcoming',
  'sports_event_relevant',
  'competition_density',
  'weather_shift',
  // ── Z-Report daily intelligence (Daily Summary pipeline) ──
  // Appended for the Daily Summary / Z-Report Intelligence pipeline. Purely
  // additive: existing codes and every normalizer output stay untouched.
  'sales_growth',
  'sales_decline',
  'volume_aov_divergence',
  'discount_pressure',
  'margin_pressure',
  'refund_spike',
  'cash_over_short',
  'inventory_wastage_spike',
  // Observed wastage without a same-item previous-period comparison.
  'inventory_wastage',
  // Closing-day sales level, as stated by the deterministic Z-report itself.
  'sales_day_close',
  // Net revenue on the closing day vs the weekday-aware rolling baseline
  // (same weekday over up to 4 prior weeks + trailing 7-day average).
  'sales_weekday_baseline',
] as const;

export type BusinessSignalCode = (typeof BUSINESS_SIGNAL_CODES)[number];

/** Coarse dimension a signal belongs to (drives agent investigation). */
export const SIGNAL_CATEGORIES = [
  'sales',
  'product',
  'margin',
  'inventory',
  'customer',
  'marketing',
  'demand',
  'basket',
  'context',
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/** Which authoritative source produced the signal. */
export const BUSINESS_SIGNAL_SOURCES = [
  'sales_context',
  'menu_engineering',
  'cost_intelligence',
  'inventory_context',
  'customer_segments',
  'retention_signals',
  'offer_performance',
  'campaign_performance',
  'demand_forecast',
  'market_basket',
  'festival_context',
  'sports_context',
  'competition_context',
  'weather_context',
  // Daily Summary / Z-Report pipeline: the closing cash ledger (CashLedger via
  // closingReportService.zReport) is its own authoritative source, distinct
  // from bill-derived sales_context.
  'cash_ledger',
] as const;

export type BusinessSignalSource = (typeof BUSINESS_SIGNAL_SOURCES)[number];

/**
 * Freshness — how current the underlying data is. `stale`/`expired` signals
 * are NEVER presented as current evidence; the agent must treat memory/
 * freshness into account.
 *   fresh   — data period is within the expected window
 *   aging   — within 2× the window
 *   stale   — older than 2× the window (disclose, never rely on)
 *   expired — the signal's own expiry has passed
 *   unknown — no period information was available (asumable, never assumed fresh)
 */
export type SignalFreshness = 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown';

/** Direction of the measured movement, when the metric has one. */
export type SignalDirection = 'up' | 'down' | 'flat' | 'unknown';

/** Tenant/branch scope the signal was computed for. */
export interface SignalScope {
  restaurantId: string;
  branchId: string | null; // null = restaurant-wide
  scope: 'tenant' | 'branch';
}

/** A single piece of structured evidence backing a signal. */
export interface SignalEvidenceRef {
  kind: 'metric' | 'count' | 'ratio' | 'model' | 'tool_output' | 'source';
  /** Stable reference (metric ref or stable key for tool_output/source. */
  ref: string;
  label?: string;
  value?: number;
  sampleSize?: number;
  /** ISO timestamp the evidence was observed (tool generatedAt etc.). */
  observedAt?: string;
  /** Persisted IntelligenceSignal vocabulary type, when one maps. */
  canonicalType?: SignalType;
}

/** A canonical, agent-facing business signal. Evidence only — never advice. */
export interface BusinessSignal {
  signalId: string;
  /** Canonical signal code from BUSINESS_SIGNAL_CODES. */
  code: BusinessSignalCode;
  category: SignalCategory;
  /** Source dimension that produced it. */
  source: BusinessSignalSource;
  /** Human-readable statement of the measured fact (no recommendation). */
  statement: string;
  /** Measured value + unit where applicable.
   *  Numeric only where the source metric is numeric; no invented numbers.
   */
  value?: number;
  unit?: string;
  baseline?: number;
  /** Relative change vs baseline (fraction, e.g. -0.18 = -18%). */
  changePct?: number;
  direction: SignalDirection;
  /** 0..1 — 0 when the source did not provide a trustworthy value. */
  confidence: number;
  /** Observed sample size when the source exposes one. */
  sampleSize?: number;
  /** Period the signal describes (ISO dates when available). */
  periodStart?: string;
  periodEnd?: string;
  freshness: SignalFreshness;
  /** ISO timestamp the signal was computed/normalized. */
  generatedAt: string;
  scope: SignalScope;
  evidence: SignalEvidenceRef[];
  /** Subject entity (product/segment/category) when the signal is about one. */
  subject?: { type: 'product' | 'category' | 'segment' | 'ingredient' | 'time_slot' | 'restaurant'; id: string; label?: string };
  /** Explicit limitation disclosure (e.g. heuristic fallback, model version). */
  caveats?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Freshness / confidence helpers (shared by every normalizer)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify freshness from the age of the newest underlying observation.
 * `expectedWindowDays` is the period the metric is expected to cover.
 */
export function classifyFreshness(
  observedAt: string | Date | undefined | null,
  expectedWindowDays: number,
  now: number = Date.now(),
): SignalFreshness {
  if (!observedAt) return 'unknown';
  const t = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  if (Number.isNaN(t)) return 'unknown';
  const ageDays = (now - t) / DAY_MS;
  if (ageDays < 0) return 'fresh';
  if (ageDays <= expectedWindowDays) return 'fresh';
  if (ageDays <= expectedWindowDays * 2) return 'aging';
  return 'stale';
}

/** Clamp any externally supplied confidence into [0, 1]. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Derive direction from a signed change fraction with a flat tolerance. */
export function directionFromChange(changePct: number | undefined, flatTolerance = 0.02): SignalDirection {
  if (changePct === undefined || !Number.isFinite(changePct)) return 'unknown';
  if (Math.abs(changePct) <= flatTolerance) return 'flat';
  return changePct > 0 ? 'up' : 'down';
}

/** Deterministic signal id: code + scope + subject (stable across runs). */
export function makeSignalId(
  code: BusinessSignalCode,
  restaurantId: string,
  subjectId: string | undefined,
  extra?: string,
): string {
  return [code, restaurantId.slice(-6), subjectId ?? 'restaurant', extra ?? ''].filter(Boolean).join(':');
}

/** Persisted-vocabulary mapping (SignaType reuse note: persisted
 *  IntelligenceSignal.type stays the canonical vocabulary; the agent-facing
 *  codes above are the normalized view. This map documents the reuse). */
export const PERSISTED_SIGNAL_TYPE_MAP: Partial<Record<BusinessSignalCode, SignalType>> = {
  sales_category_strong: 'SALES_CATEGORY_TREND_UP',
  sales_category_weak: 'SALES_CATEGORY_TREND_DOWN',
  product_high_margin: 'MENU_HIGH_CONTRIBUTION',
  product_low_margin: 'MARGIN_HIGH_SELLING_LOW_MARGIN',
  product_slow_moving: 'MENU_DOG',
  product_high_demand: 'MENU_HIGH_POPULARITY',
  inventory_low: 'INVENTORY_STOCKOUT_RISK',
  inventory_overstock: 'INVENTORY_OVERSTOCK',
  inventory_expiring: 'INVENTORY_EXPIRY_RISK',
  inventory_stockout_risk: 'INVENTORY_STOCKOUT_RISK',
  customer_inactive_high: 'CUSTOMER_INACTIVE_HIGH',
  customer_high_value_present: 'CUSTOMER_HIGH_VALUE_HIGH',
  customer_segment_present: 'CUSTOMER_RETURNING_HIGH',
  basket_pair_strength: 'BASKET_LIFT_HIGH',
  festival_upcoming: 'FESTIVAL_DEMAND_LIFT',
  competition_density: 'COMPETITION_DENSITY_HIGH',
  weather_shift: 'WEATHER_DEMAND_SHIFT',
  // Daily Summary / Z-Report additions (persisted vocabulary reused verbatim).
  inventory_wastage_spike: 'INVENTORY_HIGH_WASTAGE',
  inventory_wastage: 'INVENTORY_HIGH_WASTAGE',
  sales_day_close: 'SALES_DAILY_REVENUE',
};

// ─────────────────────────────────────────────────────────────────────────────
// Normalization result envelope
// ─────────────────────────────────────────────────────────────────────────────

export type SignalNormalizationStatus = 'ok' | 'unavailable' | 'error';

export interface SignalNormalizationResult {
  status: SignalNormalizationStatus;
  /** Which normalizer produced this result. */
  normalizer: BusinessSignalSource;
  signals: BusinessSignal[];
  /** Machine reason when status !== 'ok' (NO_DATA / SERVICE_ERROR / …). */
  reason?: string;
  /** Human-readable caveats about partial/limited normalization. */
  caveats: string[];
  generatedAt: string;
}

export const signalScopeSchema = z.object({
  restaurantId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/),
}).strict();

/** Zod schema for validating a normalized signal (used by tests/integration). */
export const signalEvidenceRefSchema = z
  .object({
    kind: z.enum(['metric', 'count', 'ratio', 'model', 'tool_output', 'source']),
    ref: z.string().min(1),
    label: z.string().optional(),
    value: z.number().optional(),
    sampleSize: z.number().optional(),
    observedAt: z.string().optional(),
    canonicalType: z.string().optional(),
  })
  .strict();

export const businessSignalSchema = z
  .object({
    signalId: z.string().min(1),
    code: z.enum(BUSINESS_SIGNAL_CODES),
    category: z.enum(SIGNAL_CATEGORIES),
    source: z.enum(BUSINESS_SIGNAL_SOURCES),
    statement: z.string().min(1),
    value: z.number().optional(),
    unit: z.string().optional(),
    baseline: z.number().optional(),
    changePct: z.number().optional(),
    direction: z.enum(['up', 'down', 'flat', 'unknown']),
    confidence: z.number().min(0).max(1),
    sampleSize: z.number().optional(),
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
    freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'unknown']),
    generatedAt: z.string(),
    scope: z
      .object({
        restaurantId: z.string().min(1),
        branchId: z.string().nullable(),
        scope: z.enum(['tenant', 'branch']),
      })
      .strict(),
    evidence: z.array(signalEvidenceRefSchema),
    subject: z
      .object({
        type: z.enum(['product', 'category', 'segment', 'ingredient', 'time_slot', 'restaurant']),
        id: z.string().min(1),
        label: z.string().optional(),
      })
      .strict()
      .optional(),
    caveats: z.array(z.string()).optional(),
  })
  .strict();

/** True when a fresh | aging | unknown freshness still counts as usable evidence. */
export function isUsableFreshness(f: SignalFreshness): boolean {
  return f === 'fresh' || f === 'aging' || f === 'unknown';
}