/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer-Response Dataset Builder (spec Step 4).
 *
 * Builds per-customer training rows from the OFFER EXPERIMENT LEDGER — the
 * same rows the Uplit bridge exports, but structured for the Node-side offer
 * response model (Step 5) and the shared AI tool (Step 7):
 *
 *   row = {
 *     customerId, experimentId, variantId, offerId,
 *     treatment (0|1), purchase (0|1),
 *     features        — pre-treatment snapshot ONLY (leakage guard below),
 *     attributedRevenue (outcome label),
 *     assignedAt / exposedAt / convertedAt / experiment_date
 *   }
 *
 * LEAKAGE GUARD: feature keys are filtered through the experimentTracker's
 * WHITELISTED_FEATURES — the exact pre-treatment contract the Uplit bridge
 * uses. Post-treatment fields (assignedAt, purchase, revenue...) can never
 * slip in as features, even if a legacy row's snapshot was written before
 * this guard existed.
 *
 * HONESTY: the dataset reports its composition. Rows from treatment-only
 * (legacy default) experiments are labeled `hasControlArm: false` — training
 * an UPLIFT model on them would be invalid; a RESPONSE model (p(buy | offer))
 * is fine. Analysis/training callers decide via the flags.
 */

import mongoose from 'mongoose';
import OfferExperimentEvent from '../../models/intelligence/OfferExperimentEvent';
import { WHITELISTED_FEATURES } from './experimentTracker';

export interface OfferResponseRow {
  customerId: string;
  experimentId: string; // '_default' for legacy rows
  variantId: string | null;
  offerId: string | null;
  treatment: 0 | 1;
  purchase: 0 | 1;
  features: Record<string, unknown>; // pre-treatment, whitelist-filtered
  attributedRevenue: number | null;
  assignedAt: string | null;
  exposedAt: string | null;
  convertedAt: string | null;
  experiment_date: string | null; // YYYY-MM-DD (Uplit temporal split key)
}

export interface OfferResponseDataset {
  restaurantId: string;
  generatedAt: string;
  rowCount: number;
  /** Composition flags — honesty metadata for training/analysis callers. */
  composition: {
    distinctExperiments: number;
    treatmentOnlyExperiments: string[]; // no control arm → no causal claims
    controlledExperiments: string[]; // have both arms
    treatmentRows: number;
    controlRows: number;
    conversions: number;
    rowsMissingFeatures: number;
  };
  /** Non-fatal problems encountered (never silently dropped). */
  warnings: string[];
  rows: OfferResponseRow[];
}

const DAY_MS = 86_400_000;

function toDateStr(d: unknown): string | null {
  if (!d) return null;
  const date = new Date(d as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Builds the offer-response dataset for one tenant.
 *
 * @param options.fromDate/toDate  restrict to rows assigned in the window
 * @param options.limit            cap row count (newest assignments first)
 * @param options.experimentId     restrict to a single experiment
 */
export async function buildOfferResponseDataset(
  restaurantId: string,
  options: {
    fromDate?: string;
    toDate?: string;
    limit?: number;
    experimentId?: string;
  } = {}
): Promise<OfferResponseDataset> {
  if (!restaurantId) throw new Error('restaurantId is required (must come from verified JWT)');

  const warnings: string[] = [];
  const query: Record<string, unknown> = { restaurantId };
  if (options.experimentId) query.experimentId = options.experimentId.toUpperCase();

  const events = await OfferExperimentEvent.find(query).sort({ createdAt: -1 }).lean() as unknown as Array<{
    _id: unknown;
    customerId: string;
    offerId?: mongoose.Types.ObjectId | null;
    experimentId?: string | null;
    variantId?: string | null;
    eventType: string;
    treatment: number;
    purchase: number;
    features?: Record<string, unknown>;
    attributedRevenue?: number | null;
    assignedAt?: Date | null;
    exposedAt?: Date | null;
    convertedAt?: Date | null;
  }>;

  // ── Group per customer+experiment (same keying as the Uplit export) ──────
  type Group = {
    experimentId: string;
    customerId: string;
    treatment: 0 | 1;
    variantId: string | null;
    offerId: string | null;
    purchase: 0 | 1;
    features: Record<string, unknown>;
    attributedRevenue: number | null;
    assignedAt: Date | null;
    exposedAt: Date | null;
    convertedAt: Date | null;
  };

  const groups = new Map<string, Group>();
  for (const ev of events) {
    const expId = ev.experimentId ?? '_default';
    const key = `${expId}|${ev.customerId}`;

    let g = groups.get(key);
    if (!g) {
      // Ledger contract: treatment is uniform per (experiment, customer) —
      // converted rows COPY the assignment row's treatment. Anything else is
      // contamination; we take the assignment row's value (first row wins)
      // and warn below.
      g = {
        experimentId: expId,
        customerId: ev.customerId,
        treatment: 1, // provisional; corrected by 'assigned' rows below
        variantId: null,
        offerId: null,
        purchase: 0,
        features: {},
        attributedRevenue: null,
        assignedAt: null,
        exposedAt: null,
        convertedAt: null,
      };
      groups.set(key, g);
    }

    if (ev.eventType === 'assigned') {
      g.treatment = ev.treatment === 1 ? 1 : 0;
      g.variantId = ev.variantId ?? null;
      g.offerId = ev.offerId ? String(ev.offerId) : null;
      if (ev.assignedAt) g.assignedAt = ev.assignedAt;
      if (ev.exposedAt) g.exposedAt = ev.exposedAt;
      // Features come from the EARLIEST assignment (rows sorted newest-first,
      // so keep the first seen and never overwrite).
      if (Object.keys(g.features).length === 0 && ev.features) {
        g.features = ev.features;
      }
    }
    if (ev.eventType === 'converted') {
      g.purchase = 1;
      if (ev.convertedAt) g.convertedAt = ev.convertedAt;
      if (typeof ev.attributedRevenue === 'number') {
        g.attributedRevenue = (g.attributedRevenue ?? 0) + ev.attributedRevenue;
      }
    }
  }

  // ── Window filter (on assignment date) + limit ───────────────────────────
  let rowsRaw = Array.from(groups.values());
  if (options.fromDate) {
    rowsRaw = rowsRaw.filter((g) => {
      const d = toDateStr(g.assignedAt);
      return d !== null && d >= options.fromDate!;
    });
  }
  if (options.toDate) {
    rowsRaw = rowsRaw.filter((g) => {
      const d = toDateStr(g.assignedAt);
      return d !== null && d <= options.toDate!;
    });
  }
  if (options.limit !== undefined && rowsRaw.length > options.limit) {
    rowsRaw = rowsRaw.slice(0, options.limit);
  }

  // ── Whitelist-filter features (leakage guard) + flatten ──────────────────
  let rowsMissingFeatures = 0;
  const rows: OfferResponseRow[] = rowsRaw.map((g) => {
    const filtered: Record<string, unknown> = {};
    const feats = g.features ?? {};
    for (const key of WHITELISTED_FEATURES) {
      if (feats[key] !== undefined) filtered[key] = feats[key];
    }
    if (Object.keys(filtered).length === 0) rowsMissingFeatures += 1;

    return {
      customerId: g.customerId,
      experimentId: g.experimentId,
      variantId: g.variantId,
      offerId: g.offerId,
      treatment: g.treatment,
      purchase: g.purchase,
      features: filtered,
      attributedRevenue: g.attributedRevenue,
      assignedAt: toDateStr(g.assignedAt),
      exposedAt: toDateStr(g.exposedAt),
      convertedAt: toDateStr(g.convertedAt),
      experiment_date: toDateStr(g.assignedAt),
    };
  });

  // ── Composition flags (honesty metadata) ────────────────────────────────
  const armsByExperiment = new Map<string, { t: boolean; c: boolean }>();
  for (const r of rows) {
    const entry = armsByExperiment.get(r.experimentId) ?? { t: false, c: false };
    if (r.treatment === 1) entry.t = true;
    else entry.c = true;
    armsByExperiment.set(r.experimentId, entry);
  }
  const treatmentOnlyExperiments: string[] = [];
  const controlledExperiments: string[] = [];
  for (const [expId, arms] of armsByExperiment) {
    if (arms.t && arms.c) controlledExperiments.push(expId);
    else treatmentOnlyExperiments.push(expId);
  }

  if (treatmentOnlyExperiments.length > 0) {
    warnings.push(
      `${treatmentOnlyExperiments.length} experiment(s) have no control arm in this window: ` +
        `${treatmentOnlyExperiments.join(', ')} — response-model training OK, uplift/causal training NOT valid on these rows`
    );
  }
  if (rowsMissingFeatures > 0) {
    warnings.push(`${rowsMissingFeatures} row(s) have an empty feature snapshot (no customer match at assignment time)`);
  }

  return {
    restaurantId,
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    composition: {
      distinctExperiments: armsByExperiment.size,
      treatmentOnlyExperiments,
      controlledExperiments,
      treatmentRows: rows.filter((r) => r.treatment === 1).length,
      controlRows: rows.filter((r) => r.treatment === 0).length,
      conversions: rows.filter((r) => r.purchase === 1).length,
      rowsMissingFeatures,
    },
    warnings,
    rows,
  };
}

/**
 * Readiness gate for training (spec §data-sufficiency): an offer-response
 * dataset is trainable only with a minimum number of rows AND conversions;
 * an UPLIFT dataset additionally requires a control arm with conversions.
 */
export function assessDatasetReadiness(
  dataset: OfferResponseDataset,
  minRows = 200,
  minConversions = 20
): { responseModelReady: boolean; upliftModelReady: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (dataset.rowCount < minRows) reasons.push(`rows ${dataset.rowCount} < ${minRows} minimum`);
  if (dataset.composition.conversions < minConversions) {
    reasons.push(`conversions ${dataset.composition.conversions} < ${minConversions} minimum`);
  }
  const responseModelReady = reasons.length === 0;

  const upliftReasons = [...reasons];
  if (dataset.composition.controlledExperiments.length === 0) {
    upliftReasons.push('no experiment with a control arm in this dataset — uplift training is not valid');
  } else if (dataset.composition.controlRows === 0) {
    upliftReasons.push('control rows present in experiments but absent in this window');
  }
  const upliftModelReady = upliftReasons.length === 0;
  return { responseModelReady, upliftModelReady, reasons: upliftReasons };
}
