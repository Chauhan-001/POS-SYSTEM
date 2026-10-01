/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * experimentExperiment.test.ts — Step 3 (experimentation foundation) test suite:
 *
 *   - stable deterministic assignment (repeat calls, tenant isolation)
 *   - allocation boundaries + status guards (pure assignment)
 *   - eligibility/consent gate applied after the draw
 *   - exposure vs outcome recording (separate timestamps, attribution window)
 *   - control-arm ledger rows (treatment=0) + analyzer verdicts
 *   - insufficient sample → inconclusive (never a winner)
 *   - tenant isolation end-to-end
 *   - experimentEval gate: control arm now counted; converted rows no longer
 *     fake "repeated assignments"
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import OfferExperiment from '../../../models/intelligence/OfferExperiment';
import OfferExperimentEvent from '../../../models/intelligence/OfferExperimentEvent';
import {
  stableAssignmentBucket,
  assignVariant,
  isEligible,
  ExperimentNotActiveError,
} from '../experimentAssignment';
import {
  aggregateArm,
  compareArms,
  analyzeExperiment,
  type ArmAggregate,
} from '../experimentAnalyzer';
import {
  createExperiment,
  launchExperiment,
  getExperiment,
  assignCustomerToExperiment,
  recordExposure,
  recordExperimentOutcome,
  analyzeExperimentById,
  validateExperimentDesign,
} from '../experimentService';
import { evaluateExperimentRandomization } from '../experimentEval';
import { exportUplitExperimentRows } from '../experimentTracker';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

const EXP_ID = 'EXP-2026-10';
const VARIANTS = [
  { id: 'control', name: 'No offer', kind: 'control' as const, offerId: null as string | null, allocation: 0.3 },
  { id: 'variant-a', name: '10% off', kind: 'treatment' as const, offerId: null as string | null, allocation: 0.7 },
];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    OfferExperiment.deleteMany({}).exec(),
    OfferExperimentEvent.deleteMany({}).exec(),
  ]);
});

async function seedActiveExperiment(restaurantId: string, experimentId = EXP_ID) {
  const exp = await createExperiment({
    restaurantId,
    experimentId,
    name: 'Diwali offer test',
    objective: 'Measure redemption incrementality',
    controlDescription: 'No offer — customers see regular menu prices',
    variants: VARIANTS,
    primaryMetric: 'redemption_rate',
    attributionWindowDays: 7,
    minSampleSizePerArm: 5, // small for tests
    createdBy: 'test-suite',
  });
  return launchExperiment(restaurantId, experimentId).then(() => exp);
}

// ─── Pure assignment ────────────────────────────────────────────────────────

describe('experimentAssignment (pure, deterministic)', () => {
  it('stableAssignmentBucket is stable and within [0,1)', () => {
    const b1 = stableAssignmentBucket(REST_A, EXP_ID, 'cust-1');
    const b2 = stableAssignmentBucket(REST_A, EXP_ID, 'cust-1');
    expect(b1).toBe(b2);
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(1);
  });

  it('assignment is STABLE across repeat calls (no variant flips)', () => {
    const input = { restaurantId: REST_A, experimentId: EXP_ID, customerId: 'cust-42', status: 'active' };
    const first = assignVariant(input, VARIANTS);
    for (let i = 0; i < 20; i++) {
      const again = assignVariant(input, VARIANTS);
      expect(again.variantId).toBe(first.variantId);
      expect(again.kind).toBe(first.kind);
      expect(again.bucket).toBe(first.bucket);
    }
  });

  it('tenant isolation: same customer id under a different tenant gets an independent draw', () => {
    const a = assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'shared-cust', status: 'active' }, VARIANTS);
    const b = assignVariant({ restaurantId: REST_B, experimentId: EXP_ID, customerId: 'shared-cust', status: 'active' }, VARIANTS);
    // We cannot assert they differ (random could collide) — assert they are
    // computed from different hashes (independent draws).
    expect(stableAssignmentBucket(REST_A, EXP_ID, 'shared-cust'))
      .not.toBe(stableAssignmentBucket(REST_B, EXP_ID, 'shared-cust'));
    expect(a.variantId).toBeTruthy();
    expect(b.variantId).toBeTruthy();
  });

  it('assignment differs across experiments for the same customer', () => {
    const e1 = stableAssignmentBucket(REST_A, 'EXP-1', 'cust-1');
    const e2 = stableAssignmentBucket(REST_A, 'EXP-2', 'cust-1');
    expect(e1).not.toBe(e2);
  });

  it('respects allocation boundaries: 100% treatment sends everyone to treatment', () => {
    const all = [{ id: 'c', kind: 'control' as const, allocation: 0 }, { id: 't', kind: 'treatment' as const, allocation: 1 }];
    for (let i = 0; i < 50; i++) {
      const r = assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `c${i}`, status: 'active' }, all);
      expect(r.variantId).toBe('t');
      expect(r.kind).toBe('treatment');
    }
  });

  it('zero-allocation variant never receives customers', () => {
    const vs = [
      { id: 'control', kind: 'control' as const, allocation: 0.5 },
      { id: 'dead', kind: 'treatment' as const, allocation: 0 },
      { id: 'live', kind: 'treatment' as const, allocation: 0.5 },
    ];
    for (let i = 0; i < 100; i++) {
      const r = assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `z${i}`, status: 'active' }, vs);
      expect(r.variantId).not.toBe('dead');
    }
  });

  it('roughly honors a 30/70 split over many customers (sanity, not precision)', () => {
    let control = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const r = assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `dist-${i}`, status: 'active' }, VARIANTS);
      if (r.kind === 'control') control += 1;
    }
    const share = control / N;
    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.36);
  });

  it('refuses to assign when the experiment is not active', () => {
    for (const status of ['draft', 'paused', 'completed', 'cancelled']) {
      expect(() =>
        assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'c', status }, VARIANTS)
      ).toThrow(ExperimentNotActiveError);
    }
  });

  it('rejects allocations that do not sum to 1', () => {
    const bad = [
      { id: 'control', kind: 'control' as const, allocation: 0.3 },
      { id: 't', kind: 'treatment' as const, allocation: 0.3 },
    ];
    expect(() =>
      assignVariant({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'c', status: 'active' }, bad)
    ).toThrow(/sum to 1/);
  });

  it('eligibility gate: explicit opt-out wins, applied AFTER the draw', () => {
    expect(isEligible({ opted_in: 0 })).toBe(false);
    expect(isEligible({ opted_in: false })).toBe(false);
    expect(isEligible({ opted_in: 1 })).toBe(true);
    expect(isEligible({})).toBe(true); // absence is not an opt-out
  });
});

// ─── Pure analyzer ──────────────────────────────────────────────────────────

describe('experimentAnalyzer (pure two-proportion stats)', () => {
  const arm = (over: Partial<ArmAggregate>): ArmAggregate => ({
    arm: 'treatment',
    variantId: 't',
    customers: 100,
    conversions: 10,
    responseRate: 0.1,
    totalRevenue: 10000,
    revenuePerCustomer: 100,
    ...over,
  });

  it('below-minimum sample → inconclusive with no winner claim', () => {
    const result = compareArms(
      arm({ arm: 'control', customers: 3, conversions: 1, responseRate: 1 / 3 }),
      arm({ customers: 4, conversions: 4, responseRate: 1 }),
      { primaryMetric: 'redemption_rate', minSampleSizePerArm: 100 }
    );
    expect(result.verdict).toBe('inconclusive');
    expect(result.absoluteDifference).toBeNull();
    expect(result.ci95Low).toBeNull();
  });

  it('large significant gap with control arm → causal treatment_wins', () => {
    // 5% vs 20% over 1000/arm — overwhelmingly significant.
    const result = compareArms(
      arm({ arm: 'control', variantId: 'c', customers: 1000, conversions: 50, responseRate: 0.05 }),
      arm({ customers: 1000, conversions: 200, responseRate: 0.2 }),
      { primaryMetric: 'redemption_rate', minSampleSizePerArm: 100 }
    );
    expect(result.verdict).toBe('treatment_wins');
    expect(result.absoluteDifference).toBeCloseTo(0.15, 6);
    expect(result.relativeDifference).toBeCloseTo(3, 6);
    expect(result.ci95Low!).toBeGreaterThan(0);
    expect(result.hasControlArm).toBe(true);
    expect(result.notes.join(' ')).toMatch(/causal/);
  });

  it('small gap → tie (CI includes 0), never a winner', () => {
    const result = compareArms(
      arm({ arm: 'control', customers: 500, conversions: 50, responseRate: 0.1 }),
      arm({ customers: 500, conversions: 52, responseRate: 0.104 }),
      { primaryMetric: 'redemption_rate', minSampleSizePerArm: 100 }
    );
    expect(result.verdict).toBe('tie');
  });

  it('control wins when control rate is significantly higher', () => {
    const result = compareArms(
      arm({ arm: 'control', customers: 1000, conversions: 300, responseRate: 0.3 }),
      arm({ customers: 1000, conversions: 100, responseRate: 0.1 }),
      { primaryMetric: 'redemption_rate', minSampleSizePerArm: 100 }
    );
    expect(result.verdict).toBe('control_wins');
    expect(result.ci95High!).toBeLessThan(0);
  });

  it('treatment-only analysis is explicitly non-causal', () => {
    const result = compareArms(
      null,
      arm({ customers: 1000, conversions: 200, responseRate: 0.2 }),
      { primaryMetric: 'redemption_rate', minSampleSizePerArm: 100 }
    );
    expect(result.hasControlArm).toBe(false);
    expect(result.notes.join(' ')).toMatch(/NOT incremental\/causal/);
  });

  it('aggregateArm computes rates/revenue with zero-divide guards', () => {
    const empty = aggregateArm('c', 'control', []);
    expect(empty.responseRate).toBeNull();
    expect(empty.revenuePerCustomer).toBeNull();

    const filled = aggregateArm('t', 'treatment', [
      { purchase: 1, attributedRevenue: 250 },
      { purchase: 0, attributedRevenue: null },
      { purchase: 1, attributedRevenue: 750 },
    ]);
    expect(filled.customers).toBe(3);
    expect(filled.conversions).toBe(2);
    expect(filled.responseRate).toBeCloseTo(2 / 3, 6);
    expect(filled.totalRevenue).toBe(1000);
    expect(filled.revenuePerCustomer).toBeCloseTo(1000 / 3, 6);
  });

  it('analyzeExperiment reports margin-aware contribution', () => {
    const analysis = analyzeExperiment({
      experimentId: EXP_ID,
      primaryMetric: 'revenue',
      minSampleSizePerArm: 10,
      attributionWindowDays: 7,
      control: { variantId: 'control', customers: 100, conversions: 0, revenue: 5000 },
      treatment: { variantId: 'variant-a', customers: 100, conversions: 0, revenue: 8000 },
      discountCostTreatment: 1500,
    });
    expect(analysis.contributionTreatment).toBeCloseTo(65, 6); // (8000-1500)/100
    expect(analysis.contributionControl).toBeCloseTo(50, 6); // 5000/100
  });
});

// ─── Service orchestration (MongoMemoryServer) ──────────────────────────────

describe('experimentService (controlled flow)', () => {
  it('createExperiment enforces design validation', async () => {
    const bad = validateExperimentDesign({
      restaurantId: REST_A,
      experimentId: 'BAD',
      name: 'x',
      objective: 'x',
      controlDescription: '',
      variants: [{ id: 'v1', name: 'only', kind: 'treatment', allocation: 0.4 }],
      primaryMetric: 'redemption_rate',
      attributionWindowDays: 0,
      createdBy: 'test-suite',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(' ')).toMatch(/at least 2 variants/);
      expect(bad.errors.join(' ')).toMatch(/exactly one control/);
      expect(bad.errors.join(' ')).toMatch(/sum to 1/);
      expect(bad.errors.join(' ')).toMatch(/attributionWindowDays/);
      expect(bad.errors.join(' ')).toMatch(/controlDescription/);
    }

    await expect(
      createExperiment({
        restaurantId: REST_A,
        experimentId: 'BAD',
        name: 'x',
        objective: 'x',
        controlDescription: 'x',
        variants: VARIANTS.map((v) => ({ ...v, allocation: 0.4 })),
        primaryMetric: 'redemption_rate',
        attributionWindowDays: 7,
        createdBy: 't',
      })
    ).rejects.toThrow(/Invalid experiment design/);
  });

  it('assignCustomerToExperiment persists treatment=1 and control=0 rows idempotently', async () => {
    await seedActiveExperiment(REST_A);

    // Draw from the real 30/70 split until we have one of each kind — the
    // concrete ids are then deterministic for the rest of the test.
    let tId: string | null = null;
    let cId: string | null = null;
    for (let i = 0; i < 500 && (!tId || !cId); i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `pair-${i}` });
      if (r.kind === 'treatment' && !tId) tId = `pair-${i}`;
      if (r.kind === 'control' && !cId) cId = `pair-${i}`;
    }
    expect(tId).toBeTruthy();
    expect(cId).toBeTruthy();
    const t1 = await OfferExperimentEvent.findOne({ restaurantId: REST_A, customerId: tId!, eventType: 'assigned' });
    const c1 = await OfferExperimentEvent.findOne({ restaurantId: REST_A, customerId: cId!, eventType: 'assigned' });
    expect(t1!.treatment).toBe(1);
    expect(t1!.experimentId).toBe(EXP_ID);
    expect(t1!.variantId).toBe('variant-a');
    expect(t1!.offerId).toBeNull();
    expect(c1!.treatment).toBe(0);
    expect(c1!.variantId).toBe('control');

    // Idempotent replay: same customer → same row, no duplicate.
    const replay = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: tId! });
    expect(replay.alreadyAssigned).toBe(true);
    expect(String(replay.event._id)).toBe(String(t1!._id));
    expect(replay.variantId).toBe(t1!.variantId);

    // The draw sequence before tId/cId also persists rows (hash order is
    // run-dependent) — the invariant is exactly ONE row per customer.
    const dupCheck = await OfferExperimentEvent.countDocuments({
      restaurantId: REST_A,
      customerId: { $in: [tId!, cId!] },
      experimentId: EXP_ID,
      eventType: 'assigned',
    });
    expect(dupCheck).toBe(2);
  });

  it('refuses assignment for non-active experiments', async () => {
    await createExperiment({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      name: 'n',
      objective: 'o',
      controlDescription: 'no offer',
      variants: VARIANTS,
      primaryMetric: 'redemption_rate',
      attributionWindowDays: 7,
      createdBy: 't',
    }); // stays draft
    await expect(
      assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'C1' })
    ).rejects.toThrow(ExperimentNotActiveError);
  });

  it('exposure is separate from assignment; control has nothing to expose', async () => {
    await seedActiveExperiment(REST_A);
    const a = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'C-X' });

    expect(a.event.exposedAt).toBeNull();
    if (a.kind === 'treatment') {
      await recordExposure({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'C-X' });
      const after = await OfferExperimentEvent.findOne({ restaurantId: REST_A, customerId: 'C-X', eventType: 'assigned' });
      expect(after!.exposedAt).toBeInstanceOf(Date);
    }

    // Force a control row and verify exposure is a no-op for it.
    let controlCust = 'C-CTL';
    for (let i = 0; i < 50; i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `ctl-${i}` });
      if (r.kind === 'control') {
        controlCust = `ctl-${i}`;
        break;
      }
    }
    const before = await OfferExperimentEvent.findOne({ restaurantId: REST_A, customerId: controlCust, eventType: 'assigned' });
    expect(before!.treatment).toBe(0);
    await recordExposure({ restaurantId: REST_A, experimentId: EXP_ID, customerId: controlCust });
    const afterCtl = await OfferExperimentEvent.findOne({ restaurantId: REST_A, customerId: controlCust, eventType: 'assigned' });
    expect(afterCtl!.exposedAt).toBeNull(); // untouched
  });

  it('records outcomes for BOTH arms and honors the attribution window', async () => {
    await seedActiveExperiment(REST_A);

    // Find one treatment + one control customer.
    let treatmentCust: string | null = null;
    let controlCust: string | null = null;
    for (let i = 0; i < 100 && (!treatmentCust || !controlCust); i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `oc-${i}` });
      if (r.kind === 'treatment' && !treatmentCust) treatmentCust = `oc-${i}`;
      if (r.kind === 'control' && !controlCust) controlCust = `oc-${i}`;
    }
    expect(treatmentCust).toBeTruthy();
    expect(controlCust).toBeTruthy();

    // Treatment: expose then convert inside window.
    await recordExposure({ restaurantId: REST_A, experimentId: EXP_ID, customerId: treatmentCust! });
    const tOut = await recordExperimentOutcome({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      customerId: treatmentCust!,
      attributedRevenue: 450,
      at: new Date(Date.now() + 2 * 86_400_000), // +2d < 7d window
    });
    expect(tOut.counted).toBe(true);
    expect(tOut.event.treatment).toBe(1);
    expect(tOut.event.purchase).toBe(1);
    expect(tOut.event.attributedRevenue).toBe(450);
    expect(tOut.event.variantId).toBe('variant-a');

    // Control: converts too (bought without an offer) — within window.
    const cOut = await recordExperimentOutcome({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      customerId: controlCust!,
      attributedRevenue: 300,
      at: new Date(Date.now() + 1 * 86_400_000),
    });
    expect(cOut.counted).toBe(true);
    expect(cOut.event.treatment).toBe(0);
    expect(cOut.event.purchase).toBe(1);

    // Out-of-window conversion: stored but flagged not counted. The customer
    // must be ASSIGNED first (outcomes require a prior assignment row).
    await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'oc-late' });
    const late = await recordExperimentOutcome({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      customerId: 'oc-late',
      attributedRevenue: 100,
      at: new Date(Date.now() + 30 * 86_400_000), // far beyond 7d
    });
    // The conversion origin is assignment/exposure time — 30d > 7d window.
    expect(late.counted).toBe(false);
    expect(late.reason).toMatch(/attribution window/);

    // Idempotent: second conversion for the same customer resolves to the row.
    const replay = await recordExperimentOutcome({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      customerId: treatmentCust!,
      attributedRevenue: 450,
    });
    expect(replay.counted).toBe(true);
    expect(replay.reason).toMatch(/idempotent/);

    // Outcome without a prior assignment is rejected.
    await expect(
      recordExperimentOutcome({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'never-assigned' })
    ).rejects.toThrow(/prior assignment/);
  });

  it('analyzeExperimentById returns inconclusive below minSampleSizePerArm, verdicts above it', async () => {
    // min=1000 guarantees the inconclusive phase regardless of the hash draw.
    const exp = await createExperiment({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      name: 'Diwali offer test',
      objective: 'Measure redemption incrementality',
      controlDescription: 'No offer — customers see regular menu prices',
      variants: VARIANTS,
      primaryMetric: 'redemption_rate',
      attributionWindowDays: 7,
      minSampleSizePerArm: 1000,
      createdBy: 'test-suite',
    });
    await launchExperiment(REST_A, EXP_ID);
    void exp;

    // Assign until BOTH arms have >= 6 customers (30/70 split converges fast).
    let t = 0;
    let c = 0;
    const treated: string[] = [];
    for (let i = 0; i < 1000 && (t < 6 || c < 6); i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `an-${i}` });
      if (r.kind === 'treatment') {
        t += 1;
        treated.push(`an-${i}`);
      } else {
        c += 1;
      }
    }
    expect(t).toBeGreaterThanOrEqual(6);
    expect(c).toBeGreaterThanOrEqual(6);

    // Phase 1: sample far below the per-arm minimum → inconclusive, no winner.
    const small = await analyzeExperimentById(REST_A, EXP_ID);
    expect(small.comparison.verdict).toBe('inconclusive');
    expect(small.comparison.absoluteDifference).toBeNull();
    expect(small.comparison.notes.join(' ')).toMatch(/inconclusive by design/);

    // Phase 2: lower the minimum and convert EVERY treatment customer
    // (100% vs 0% → significant at any arm size ≥ 2; deterministic verdict).
    const doc = await OfferExperiment.findOne({ restaurantId: REST_A, experimentId: EXP_ID });
    doc!.minSampleSizePerArm = 5;
    await doc!.save();
    for (const cust of treated) {
      await recordExperimentOutcome({ restaurantId: REST_A, experimentId: EXP_ID, customerId: cust, attributedRevenue: 500 });
    }

    const analysis = await analyzeExperimentById(REST_A, EXP_ID);
    expect(analysis.experimentId).toBe(EXP_ID);
    expect(analysis.primaryMetric).toBe('redemption_rate');
    const tArm = analysis.arms.find((a) => a.arm === 'treatment')!;
    const cArm = analysis.arms.find((a) => a.arm === 'control')!;
    expect(tArm.customers).toBe(t);
    expect(cArm.customers).toBe(c);
    expect(tArm.conversions).toBe(t); // every treatment customer converted
    expect(cArm.conversions).toBe(0);
    expect(analysis.comparison.verdict).toBe('treatment_wins');
    expect(analysis.comparison.hasControlArm).toBe(true);
  });

  it('tenant isolation: experiments and ledger rows never cross tenants', async () => {
    await seedActiveExperiment(REST_A);
    await seedActiveExperiment(REST_B, EXP_ID);

    await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: 'A-ONLY' });
    await assignCustomerToExperiment({ restaurantId: REST_B, experimentId: EXP_ID, customerId: 'B-ONLY' });

    const aRows = await OfferExperimentEvent.find({ restaurantId: REST_A, experimentId: EXP_ID });
    expect(aRows.map((r) => r.customerId)).toEqual(['A-ONLY']);

    // experimentId is unique per tenant — same id, different tenants, both exist.
    const a = await getExperiment(REST_A, EXP_ID);
    const b = await getExperiment(REST_B, EXP_ID);
    expect(String(a.restaurantId)).toBe(REST_A);
    expect(String(b.restaurantId)).toBe(REST_B);
  });

  it('Uplit export still works and excludes control rows', async () => {
    await seedActiveExperiment(REST_A);

    // Legacy default flow (experimentId null, treatment-only) still exported.
    await OfferExperimentEvent.create({
      restaurantId: REST_A,
      customerId: 'LEGACY-1',
      eventType: 'assigned',
      treatment: 1,
      purchase: 0,
      features: { total_spend: 1200 },
      assignedAt: new Date(),
    });

    // Controlled flow: one treatment + one control.
    let done = 0;
    for (let i = 0; i < 50 && done < 2; i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `up-${i}` });
      done += 1;
      if (r.kind === 'treatment') {
        await recordExperimentOutcome({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `up-${i}`, attributedRevenue: 200 });
      }
    }

    const exported = await exportUplitExperimentRows(REST_A);
    const ids = exported.events.map((e) => e.customer_id as string);
    expect(ids).toContain('LEGACY-1');
    // Treatment rows from the controlled flow are exported.
    const controlledTreatment = await OfferExperimentEvent.find({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      treatment: 1,
      eventType: 'assigned',
    });
    for (const row of controlledTreatment) {
      expect(ids).toContain(row.customerId);
    }
    // Control rows are NOT exported (Uplit ingest is treatment-only).
    const controlRows = await OfferExperimentEvent.find({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      treatment: 0,
      eventType: 'assigned',
    });
    for (const row of controlRows) {
      expect(ids).not.toContain(row.customerId);
    }
  });

  it('experimentEval counts the control arm and no longer counts conversions as repeated assignments', async () => {
    await seedActiveExperiment(REST_A, 'EVAL-EXP');

    // Seed ≥12 treatment + ≥4 control assignments, converting every 3rd
    // treatment customer — previously those converted rows inflated
    // repeatedAssignments. Quotas can overshoot by one draw (hash order is
    // run-dependent), so assertions are ≥, with the diag count matched to the
    // actual seeded rows.
    let t = 0;
    let c = 0;
    for (let i = 0; i < 200; i++) {
      if (t >= 12 && c >= 4) break;
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: 'EVAL-EXP', customerId: `ev-${i}` });
      if (r.kind === 'treatment') {
        t += 1;
        if (t % 3 === 0) {
          await recordExperimentOutcome({ restaurantId: REST_A, experimentId: 'EVAL-EXP', customerId: `ev-${i}` });
        }
      } else {
        c += 1;
      }
    }
    expect(t).toBeGreaterThanOrEqual(12);
    expect(c).toBeGreaterThanOrEqual(4);
    expect(t + c).toBeLessThan(100); // stays below the minimum → not evaluable

    const diag = await evaluateExperimentRandomization(REST_A, 100);
    expect(diag.treatmentCount).toBe(t);
    expect(diag.controlCount).toBe(c);
    expect(diag.repeatedAssignments).toBe(0); // converted rows no longer count
    expect(diag.customersInMultipleArms).toBe(0);
    expect(diag.evaluable).toBe(false); // 12 < 100
    expect(diag.reasons.join(' ')).toMatch(/experiment too small/);

    // Legacy treatment-only ledger (no control) keeps the honest gate closed.
    await OfferExperimentEvent.create({
      restaurantId: REST_A,
      customerId: 'LEG-EVAL',
      eventType: 'assigned',
      treatment: 1,
      purchase: 0,
      features: {},
      assignedAt: new Date(),
    });
    const legacyDiag = await evaluateExperimentRandomization(REST_A, 1);
    expect(legacyDiag.controlCount).toBe(c); // control rows still counted
    expect(legacyDiag.treatmentCount).toBe(t + 1);
    // evaluable requires control > 0 AND treatment >= min AND no repeats —
    // with min=1 it could pass only if no other gate trips; legacy row is fine.
    expect(legacyDiag.evaluable).toBe(true);
  });
});
