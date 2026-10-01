/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Experiment Service (spec Step 3) — orchestration for CONTROLLED offer
 * experiments with a real control arm. Sits on top of:
 *
 *   - OfferExperiment          (definition: variants, allocation, gates)
 *   - OfferExperimentEvent     (ledger: assignments/exposures/conversions)
 *   - experimentAssignment.ts  (pure stable hash → variant)
 *   - experimentAnalyzer.ts    (pure two-proportion analysis)
 *
 * Honesty rules:
 *   - Control-arm rows are recorded with treatment=0 — the ledger becomes the
 *     single source of truth for both arms, and experimentEval's gate can
 *     finally evaluate real randomization instead of reporting controlCount=0.
 *   - Uplit export compatibility: exportUplitExperimentRows keeps exporting
 *     treatment rows; control rows (treatment=0) are EXCLUDED from the Uplit
 *     payload because Uplit's T-Learner ingest contract is treatment-only.
 *   - assignment ≠ exposure: recordExposure stamps exposedAt separately.
 *   - Conversions honor the experiment's attribution window.
 */

import mongoose from 'mongoose';

import OfferExperiment, {
  IOfferExperiment,
  IOfferExperimentVariant,
} from '../../models/intelligence/OfferExperiment';
import OfferExperimentEvent, {
  IOfferExperimentEvent,
} from '../../models/intelligence/OfferExperimentEvent';
import {
  assignVariant,
  isEligible,
  ExperimentNotActiveError,
} from './experimentAssignment';
import { snapshotPreTreatmentFeatures } from './experimentTracker';
import {
  analyzeExperiment,
  type ExperimentAnalysis,
  type ExperimentMetric,
} from './experimentAnalyzer';

// ─── Definition management ───────────────────────────────────────────────────

export interface CreateExperimentInput {
  restaurantId: string;
  experimentId: string;
  name: string;
  objective: string;
  controlDescription: string;
  variants: Array<{
    id: string;
    name: string;
    kind: 'control' | 'treatment';
    offerId?: string | null;
    allocation: number;
  }>;
  primaryMetric: ExperimentMetric;
  secondaryMetrics?: ExperimentMetric[];
  attributionWindowDays: number;
  minSampleSizePerArm?: number;
  createdBy: string;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
}

/**
 * Validates experiment DESIGN before persistence (absorbs the intent of the
 * dead services/abTestingService.validateExperimentDesign — that file had zero
 * importers and is left untouched).
 */
export function validateExperimentDesign(input: CreateExperimentInput): ValidationFailure | ValidationSuccess {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (input.variants.length < 2) errors.push('an experiment needs at least 2 variants');

  let controlCount = 0;
  let allocationSum = 0;
  for (const v of input.variants) {
    if (ids.has(v.id)) errors.push(`duplicate variant id '${v.id}'`);
    ids.add(v.id);
    if (v.kind === 'control') controlCount += 1;
    if (v.allocation < 0 || v.allocation > 1) {
      errors.push(`variant '${v.id}' allocation must be within 0..1`);
    }
    allocationSum += v.allocation;
  }
  if (controlCount !== 1) {
    errors.push(`exactly one control variant is required (found ${controlCount})`);
  }
  if (Math.abs(allocationSum - 1) > 1e-6) {
    errors.push(`variant allocations must sum to 1 (got ${allocationSum})`);
  }
  if (input.attributionWindowDays < 1 || input.attributionWindowDays > 30) {
    errors.push('attributionWindowDays must be 1..30');
  }
  if (input.minSampleSizePerArm !== undefined && input.minSampleSizePerArm < 1) {
    errors.push('minSampleSizePerArm must be >= 1');
  }
  if (!input.controlDescription.trim()) {
    errors.push('controlDescription is required — what the control arm receives must be documented');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function createExperiment(input: CreateExperimentInput): Promise<IOfferExperiment> {
  const validation = validateExperimentDesign(input);
  if (!validation.ok) {
    throw new Error(`Invalid experiment design: ${validation.errors.join('; ')}`);
  }
  return OfferExperiment.create({
    restaurantId: input.restaurantId,
    experimentId: input.experimentId.toUpperCase(),
    name: input.name,
    objective: input.objective,
    controlDescription: input.controlDescription,
    variants: input.variants.map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.kind,
      offerId: v.offerId ? new mongoose.Types.ObjectId(v.offerId) : null,
      allocation: v.allocation,
    })),
    primaryMetric: input.primaryMetric,
    secondaryMetrics: input.secondaryMetrics ?? [],
    attributionWindowDays: input.attributionWindowDays,
    minSampleSizePerArm: input.minSampleSizePerArm ?? 100,
    status: 'draft',
    createdBy: input.createdBy,
  });
}

/** Launch gates: design must still be valid and the experiment not yet ended. */
export async function launchExperiment(
  restaurantId: string,
  experimentId: string,
  now: Date = new Date()
): Promise<IOfferExperiment> {
  const experiment = await getExperiment(restaurantId, experimentId);
  if (experiment.status === 'completed' || experiment.status === 'cancelled') {
    throw new Error(`cannot launch a ${experiment.status} experiment`);
  }
  experiment.status = 'active';
  experiment.startAt = experiment.startAt ?? now;
  await experiment.save();
  return experiment;
}

export async function getExperiment(
  restaurantId: string,
  experimentId: string
): Promise<IOfferExperiment> {
  const experiment = await OfferExperiment.findOne({
    restaurantId,
    experimentId: experimentId.toUpperCase(),
  });
  if (!experiment) {
    throw new Error(`experiment '${experimentId}' not found for this tenant`);
  }
  return experiment;
}

// ─── Assignment + exposure ───────────────────────────────────────────────────

export interface ControlledAssignment {
  event: IOfferExperimentEvent;
  variantId: string;
  kind: 'control' | 'treatment';
  eligible: boolean;
  alreadyAssigned: boolean;
}

/**
 * Deterministically assigns a customer to an arm of an ACTIVE experiment and
 * persists the ledger row (idempotent). Control rows get treatment=0.
 * Eligibility is applied AFTER the draw; ineligible customers are still
 * persisted with their arm (so analysis can report exclusion) but flagged.
 */
export async function assignCustomerToExperiment(input: {
  restaurantId: string;
  experimentId: string;
  customerId: string;
  branchId?: string | null;
  features?: Record<string, unknown> | null;
}): Promise<ControlledAssignment> {
  const experiment = await getExperiment(input.restaurantId, input.experimentId);

  // Pure draw FIRST (no DB lookups that could bias it).
  const draw = assignVariant(
    {
      restaurantId: input.restaurantId,
      experimentId: experiment.experimentId,
      customerId: input.customerId,
      status: experiment.status,
    },
    experiment.variants.map((v) => ({ id: v.id, kind: v.kind, allocation: v.allocation }))
  );

  // Features: caller-supplied snapshot wins (pre-treatment by contract);
  // otherwise snapshot from the Customer document (same whitelist as Uplit).
  let features = input.features ?? null;
  if (!features) {
    features = await snapshotPreTreatmentFeatures(input.restaurantId, input.customerId);
  }
  const eligible = isEligible(features);

  const existing = await OfferExperimentEvent.findOne({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    experimentId: experiment.experimentId,
    eventType: 'assigned',
  });
  if (existing) {
    return {
      event: existing,
      variantId: existing.variantId ?? draw.variantId,
      kind: (existing.treatment === 1 ? 'treatment' : 'control') as 'control' | 'treatment',
      eligible,
      alreadyAssigned: true,
    };
  }

  const variant = experiment.variants.find((v) => v.id === draw.variantId);
  const event = await OfferExperimentEvent.create({
    restaurantId: input.restaurantId,
    branchId: input.branchId ? new mongoose.Types.ObjectId(input.branchId) : null,
    offerId: variant?.offerId ?? null,
    customerId: input.customerId,
    experimentId: experiment.experimentId,
    variantId: draw.variantId,
    eventType: 'assigned',
    treatment: draw.kind === 'treatment' ? 1 : 0,
    purchase: 0,
    features,
    assignedAt: new Date(),
    exposedAt: null,
  });

  return { event, variantId: draw.variantId, kind: draw.kind, eligible, alreadyAssigned: false };
}

/**
 * Stamps exposure (the customer actually SAW/received the offer) — separate
 * from assignment per spec. Only treatment arms have something to expose;
 * control exposure is rejected (there is no offer to expose).
 */
export async function recordExposure(input: {
  restaurantId: string;
  experimentId: string;
  customerId: string;
  exposedAt?: Date;
}): Promise<IOfferExperimentEvent> {
  const event = await OfferExperimentEvent.findOne({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    experimentId: input.experimentId.toUpperCase(),
    eventType: 'assigned',
  });
  if (!event) throw new Error('no assignment row — exposure requires a prior assignment');
  if (event.treatment === 1) {
    event.exposedAt = input.exposedAt ?? new Date();
    await event.save();
  }
  return event;
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

export interface RecordOutcomeResult {
  event: IOfferExperimentEvent;
  counted: boolean;
  reason?: string;
}

/**
 * Records a conversion for an experiment customer (purchase=1) — works for
 * BOTH arms. A conversion counts toward analysis only when it lands inside the
 * experiment's attribution window (measured from exposure for treatment,
 * from assignment for control — the control arm has no exposure moment).
 * Out-of-window conversions are stored for audit but flagged not counted.
 */
export async function recordExperimentOutcome(input: {
  restaurantId: string;
  experimentId: string;
  customerId: string;
  redeemedBillId?: string | null;
  attributedRevenue?: number | null;
  at?: Date;
}): Promise<RecordOutcomeResult> {
  const experiment = await getExperiment(input.restaurantId, input.experimentId);
  const at = input.at ?? new Date();

  const assignment = await OfferExperimentEvent.findOne({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    experimentId: experiment.experimentId,
    eventType: 'assigned',
  });
  if (!assignment) {
    throw new Error('no assignment row — outcomes require a prior assignment');
  }

  const existing = await OfferExperimentEvent.findOne({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    experimentId: experiment.experimentId,
    eventType: 'converted',
  });
  if (existing) {
    const features = existing.features as Record<string, unknown>;
    return {
      event: existing,
      counted: features.__counted === 1,
      reason: features.__counted === 1 ? 'already recorded (idempotent)' : 'already recorded (idempotent); outside attribution window',
    };
  }

  const origin = assignment.treatment === 1 ? assignment.exposedAt ?? assignment.assignedAt : assignment.assignedAt;
  const windowMs = experiment.attributionWindowDays * 86_400_000;
  const inWindow = origin !== null && origin !== undefined && at.getTime() - new Date(origin).getTime() <= windowMs;

  const event = await OfferExperimentEvent.create({
    restaurantId: input.restaurantId,
    offerId: assignment.offerId,
    customerId: input.customerId,
    experimentId: experiment.experimentId,
    variantId: assignment.variantId,
    eventType: 'converted',
    treatment: assignment.treatment,
    purchase: 1,
    // The converted row's features hold ONLY the window bookkeeping flag —
    // never customer features (converted rows carry outcomes as labels).
    features: inWindow ? { __counted: 1 } : { __counted: 0 },
    assignedAt: null,
    convertedAt: at,
    redeemedBillId: input.redeemedBillId ? new mongoose.Types.ObjectId(input.redeemedBillId) : null,
    attributedRevenue: typeof input.attributedRevenue === 'number' ? input.attributedRevenue : null,
  });

  return inWindow
    ? { event, counted: true }
    : {
        event,
        counted: false,
        reason: `outside ${experiment.attributionWindowDays}-day attribution window`,
      };
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * Aggregates the ledger per arm and runs the pure analyzer. Rows NOT counted:
 * ineligible customers are INCLUDED (they were randomized; excluding them
 * would bias), but conversions outside the attribution window are excluded
 * from both arms' numerators by recordExperimentOutcome's flagging — here we
 * only count 'converted' rows, which only exist when a conversion happened.
 */
export async function analyzeExperimentById(
  restaurantId: string,
  experimentId: string
): Promise<ExperimentAnalysis> {
  const experiment = await getExperiment(restaurantId, experimentId);
  const upper = experiment.experimentId;

  const [controlRows, treatmentRows, convertedRows] = await Promise.all([
    OfferExperimentEvent.find({ restaurantId, experimentId: upper, eventType: 'assigned', treatment: 0 }).lean(),
    OfferExperimentEvent.find({ restaurantId, experimentId: upper, eventType: 'assigned', treatment: 1 }).lean(),
    OfferExperimentEvent.find({ restaurantId, experimentId: upper, eventType: 'converted' }).lean(),
  ]);

  // Only conversions recorded INSIDE the attribution window count toward the
  // arms' numerators (the window decision is persisted at outcome time via
  // features.__counted, so analysis and dataset agree).
  const countedConversions = new Set(
    convertedRows
      .filter((r) => {
        const feats = (r as unknown as { features?: Record<string, unknown> }).features ?? {};
        return feats.__counted === 1;
      })
      .map((r) => String(r.customerId))
  );
  const revenueByCustomer = new Map<string, number>();
  for (const r of convertedRows as unknown as Array<{ customerId: string; attributedRevenue?: number | null }>) {
    if (typeof r.attributedRevenue === 'number') {
      revenueByCustomer.set(r.customerId, (revenueByCustomer.get(r.customerId) ?? 0) + r.attributedRevenue);
    }
  }

  const treatmentVariant = experiment.variants.find((v) => v.kind === 'treatment') as IOfferExperimentVariant;
  const controlVariant = experiment.variants.find((v) => v.kind === 'control') as IOfferExperimentVariant;

  const toArmInput = (rows: Array<Record<string, unknown>>, variantId: string) => {
    const customers = rows.length;
    const conversions = rows.filter((r) => countedConversions.has(String(r.customerId))).length;
    let revenue = 0;
    for (const r of rows) revenue += revenueByCustomer.get(String(r.customerId)) ?? 0;
    return { variantId, customers, conversions, revenue };
  };

  return analyzeExperiment({
    experimentId: upper,
    primaryMetric: experiment.primaryMetric as ExperimentMetric,
    minSampleSizePerArm: experiment.minSampleSizePerArm,
    attributionWindowDays: experiment.attributionWindowDays,
    control: toArmInput(controlRows as unknown as Array<Record<string, unknown>>, controlVariant.id),
    treatment: toArmInput(treatmentRows as unknown as Array<Record<string, unknown>>, treatmentVariant.id),
  });
}

export { ExperimentNotActiveError };
