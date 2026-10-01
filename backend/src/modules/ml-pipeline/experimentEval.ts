/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * experimentEval.ts — Uplift experiment randomization diagnostics (Job 3,
 * Sec 22). Computed from the Node-side OfferExperimentEvent ledger.
 *
 * HONESTY MODEL (updated with the controlled-experiment flow):
 *   - Rows carry experimentId. Legacy rows (experimentId null) belong to the
 *     '_default' experiment (offerId-keyed, treatment-only).
 *   - Arm membership comes from eventType='assigned' rows ONLY — converted
 *     rows share the (experiment|customer) key and previously inflated the
 *     "repeated assignments" signal (fixed here).
 *   - A REAL control arm is counted via treatment=0 assignment rows. With the
 *     new controlled flow (experimentService) control rows are persisted, so
 *     evaluable can finally become true; legacy default-flow rows remain
 *     treatment-only and keep the gate honestly closed for that experiment.
 */

import OfferExperimentEvent from '../../models/intelligence/OfferExperimentEvent';

export interface ExperimentDiagnostics {
  evaluable: boolean;
  reasons: string[];
  treatmentCount: number;
  controlCount: number;
  treatmentRatio: number | null; // treatment / (treatment + control)
  assignmentEntropyBits: number | null; // over distinct experiments/customers mix
  distinctExperiments: number;
  repeatedAssignments: number; // same customer assigned in same experiment more than once
  customersInMultipleArms: number; // contamination signal (same customer in control AND treatment)
  minimumExperimentSize: number;
}

export async function evaluateExperimentRandomization(
  restaurantId: string,
  minimumExperimentSize = 100
): Promise<ExperimentDiagnostics> {
  const events = await OfferExperimentEvent.find({
    restaurantId,
    eventType: 'assigned',
  }).lean();

  const reasons: string[] = [];

  const perExperiment = new Map<string, number>();
  const perCustomerExp = new Map<string, number>();
  const armByCustomerExp = new Map<string, number>();
  let treatmentCount = 0;
  let controlCount = 0;
  let repeatedAssignments = 0;
  let customersInMultipleArms = 0;

  for (const ev of events as unknown as Array<{
    customerId: string;
    offerId?: unknown;
    experimentId?: string | null;
    treatment: number;
  }>) {
    const expKey = ev.experimentId ?? '_default';
    perExperiment.set(expKey, (perExperiment.get(expKey) ?? 0) + 1);

    const custKey = `${expKey}|${ev.customerId}`;
    const n = (perCustomerExp.get(custKey) ?? 0) + 1;
    perCustomerExp.set(custKey, n);
    if (n === 2) repeatedAssignments += 1;

    // Contamination: same (experiment, customer) seen with BOTH arms.
    const arm = ev.treatment === 1 ? 1 : 0;
    const prevArm = armByCustomerExp.get(custKey);
    if (prevArm !== undefined && prevArm !== arm) customersInMultipleArms += 1;
    armByCustomerExp.set(custKey, arm);

    if (arm === 1) treatmentCount += 1;
    else controlCount += 1;
  }

  const total = treatmentCount + controlCount;
  const distinctExperiments = perExperiment.size;

  // Assignment entropy over the experiment dimension (how spread out
  // assignments are). 0 bits = all in one experiment; log2(k) = uniform.
  let entropyBits: number | null = null;
  if (distinctExperiments > 1 && total > 0) {
    entropyBits = -Array.from(perExperiment.values()).reduce((s, c) => {
      const p = c / total;
      return s + p * Math.log2(p);
    }, 0);
  }

  const treatmentRatio = total > 0 ? treatmentCount / total : null;

  if (total === 0) reasons.push('no assignment events recorded');
  if (controlCount === 0) {
    reasons.push(
      'no control arm: application assigns offers without randomized holdout, ' +
        'so uplift cannot be causally estimated from this ledger'
    );
  }
  if (treatmentCount < minimumExperimentSize) {
    reasons.push(
      `experiment too small: ${treatmentCount} treatment assignments < ${minimumExperimentSize} minimum`
    );
  }
  if (repeatedAssignments > 0) {
    reasons.push(`${repeatedAssignments} repeated assignment(s) detected in the same experiment`);
  }
  if (customersInMultipleArms > 0) {
    reasons.push(`${customersInMultipleArms} customer(s) seen in BOTH arms of the same experiment`);
  }

  return {
    evaluable:
      controlCount > 0 &&
      treatmentCount >= minimumExperimentSize &&
      repeatedAssignments === 0 &&
      customersInMultipleArms === 0,
    reasons,
    treatmentCount,
    controlCount,
    treatmentRatio,
    assignmentEntropyBits: entropyBits != null ? Number(entropyBits.toFixed(3)) : null,
    distinctExperiments,
    repeatedAssignments,
    customersInMultipleArms,
    minimumExperimentSize,
  };
}
