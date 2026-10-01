/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * offerResponseDataset.test.ts — Step 4 test suite:
 *
 *   - per-customer grouping mirrors the Uplit export keying
 *   - leakage guard: feature keys pass through WHITELISTED_FEATURES only
 *   - window/limit filters + composition flags (control vs treatment-only)
 *   - readiness gate: response vs uplift requirements
 *   - tenant isolation
 *   - persisted attribution-window flag flows into the dataset
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import OfferExperimentEvent from '../../../models/intelligence/OfferExperimentEvent';
import {
  buildOfferResponseDataset,
  assessDatasetReadiness,
  type OfferResponseDataset,
} from '../offerResponseDataset';
import { WHITELISTED_FEATURES } from '../experimentTracker';
import {
  createExperiment,
  launchExperiment,
  assignCustomerToExperiment,
  recordExperimentOutcome,
} from '../experimentService';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const EXP_ID = 'EXP-RESP';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await OfferExperimentEvent.deleteMany({}).exec();
});

async function seedLedgerRow(over: Partial<Record<string, unknown>> = {}) {
  return OfferExperimentEvent.create({
    restaurantId: REST_A,
    customerId: 'C1',
    eventType: 'assigned',
    treatment: 1,
    purchase: 0,
    features: { total_spend: 4200, visits_30d: 3 },
    assignedAt: new Date('2026-09-10T10:00:00Z'),
    ...over,
  });
}

describe('buildOfferResponseDataset (Step 4)', () => {
  it('groups events per customer+experiment with treatment/purchase/labels', async () => {
    await seedLedgerRow({ customerId: 'C1' });
    await seedLedgerRow({
      customerId: 'C1',
      eventType: 'converted',
      treatment: 1,
      purchase: 1,
      features: {},
      convertedAt: new Date('2026-09-12T10:00:00Z'),
      attributedRevenue: 850,
    });

    const ds = await buildOfferResponseDataset(REST_A);
    expect(ds.rowCount).toBe(1);
    const row = ds.rows[0];
    expect(row.customerId).toBe('C1');
    expect(row.experimentId).toBe('_default');
    expect(row.treatment).toBe(1);
    expect(row.purchase).toBe(1);
    expect(row.attributedRevenue).toBe(850);
    expect(row.experiment_date).toBe('2026-09-10');
    expect(row.features.total_spend).toBe(4200);
  });

  it('leakage guard: non-whitelisted feature keys are stripped', async () => {
    // Simulate a legacy row whose snapshot contains a post-treatment field.
    await seedLedgerRow({
      customerId: 'LEAKY',
      features: {
        total_spend: 100,
        assignedAt: 'hacker-field', // post-treatment — must be stripped
        purchase: 1, // outcome — must be stripped
        evil_post_treatment_metric: 999,
      },
    });

    const ds = await buildOfferResponseDataset(REST_A);
    const row = ds.rows.find((r) => r.customerId === 'LEAKY')!;
    expect(row.features.total_spend).toBe(100);
    expect(row.features.assignedAt).toBeUndefined();
    expect(row.features.purchase).toBeUndefined();
    expect(row.features.evil_post_treatment_metric).toBeUndefined();
    // And the whitelist itself is the single source of truth.
    expect(Object.keys(row.features).every((k) => (WHITELISTED_FEATURES as readonly string[]).includes(k))).toBe(true);
  });

  it('respects experimentId filter, date window, and limit', async () => {
    await seedLedgerRow({ customerId: 'W1', assignedAt: new Date('2026-09-01T10:00:00Z') });
    await seedLedgerRow({ customerId: 'W2', assignedAt: new Date('2026-09-20T10:00:00Z') });
    await seedLedgerRow({
      customerId: 'W3',
      experimentId: 'EXP-OTHER',
      assignedAt: new Date('2026-09-15T10:00:00Z'),
    });

    const byExp = await buildOfferResponseDataset(REST_A, { experimentId: 'EXP-OTHER' });
    expect(byExp.rowCount).toBe(1);
    expect(byExp.rows[0].customerId).toBe('W3');

    const windowed = await buildOfferResponseDataset(REST_A, { fromDate: '2026-09-10' });
    // W2 (09-20, default) + W3 (09-15, other experiment) — window spans all
    // experiments unless experimentId is also given.
    expect(windowed.rowCount).toBe(2);
    expect(windowed.rows.map((r) => r.customerId).sort()).toEqual(['W2', 'W3']);

    const combined = await buildOfferResponseDataset(REST_A, { fromDate: '2026-09-10', experimentId: 'EXP-OTHER' });
    expect(combined.rowCount).toBe(1);
    expect(combined.rows[0].customerId).toBe('W3');

    const limited = await buildOfferResponseDataset(REST_A, { limit: 2 });
    expect(limited.rowCount).toBe(2);
  });

  it('composition flags: controlled vs treatment-only experiments + warnings', async () => {
    // Controlled flow rows (experimentId set): one treatment + one control.
    const exp = await createExperiment({
      restaurantId: REST_A,
      experimentId: EXP_ID,
      name: 'n',
      objective: 'o',
      controlDescription: 'no offer',
      variants: [
        { id: 'control', name: 'No offer', kind: 'control', offerId: null, allocation: 0.5 },
        { id: 'variant-a', name: 'Deal', kind: 'treatment', offerId: null, allocation: 0.5 },
      ],
      primaryMetric: 'redemption_rate',
      attributionWindowDays: 7,
      minSampleSizePerArm: 2,
      createdBy: 't',
    });
    await launchExperiment(REST_A, EXP_ID);
    void exp;

    let t = 0;
    let c = 0;
    for (let i = 0; i < 100 && (t < 2 || c < 2); i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: EXP_ID, customerId: `cmp-${i}` });
      if (r.kind === 'treatment') t += 1;
      else c += 1;
    }
    expect(t).toBeGreaterThanOrEqual(2);
    expect(c).toBeGreaterThanOrEqual(2);

    // Legacy default row (treatment-only).
    await seedLedgerRow({ customerId: 'LEG' });

    const ds = await buildOfferResponseDataset(REST_A);
    expect(ds.composition.controlledExperiments).toContain(EXP_ID);
    expect(ds.composition.treatmentOnlyExperiments).toContain('_default');
    expect(ds.composition.controlRows).toBeGreaterThanOrEqual(2);
    expect(ds.composition.treatmentRows).toBeGreaterThanOrEqual(2);
    expect(ds.warnings.join(' ')).toMatch(/no control arm/);
  });

  it('readiness gate: response vs uplift requirements are independent', () => {
    const base: OfferResponseDataset = {
      restaurantId: REST_A,
      generatedAt: new Date().toISOString(),
      rowCount: 250,
      composition: {
        distinctExperiments: 1,
        treatmentOnlyExperiments: ['_default'],
        controlledExperiments: [],
        treatmentRows: 250,
        controlRows: 0,
        conversions: 30,
        rowsMissingFeatures: 0,
      },
      warnings: [],
      rows: [],
    };

    const treatmentOnly = assessDatasetReadiness(base);
    expect(treatmentOnly.responseModelReady).toBe(true);
    expect(treatmentOnly.upliftModelReady).toBe(false);
    expect(treatmentOnly.reasons.join(' ')).toMatch(/control arm/);

    const controlled: OfferResponseDataset = {
      ...base,
      composition: {
        ...base.composition,
        treatmentOnlyExperiments: [],
        controlledExperiments: [EXP_ID],
        controlRows: 80,
        treatmentRows: 170,
      },
    };
    const upliftReady = assessDatasetReadiness(controlled);
    expect(upliftReady.responseModelReady).toBe(true);
    expect(upliftReady.upliftModelReady).toBe(true);

    const tiny = assessDatasetReadiness({ ...base, rowCount: 10, composition: { ...base.composition, conversions: 2 } });
    expect(tiny.responseModelReady).toBe(false);
    expect(tiny.upliftModelReady).toBe(false);
    expect(tiny.reasons.join(' ')).toMatch(/rows 10 < 200/);
    expect(tiny.reasons.join(' ')).toMatch(/conversions 2 < 20/);
  });

  it('tenant isolation: only the caller tenant’s ledger becomes the dataset', async () => {
    await seedLedgerRow({ customerId: 'A-ROW' });
    await seedLedgerRow({ restaurantId: REST_B, customerId: 'B-ROW' });

    const ds = await buildOfferResponseDataset(REST_A);
    expect(ds.rows.map((r) => r.customerId)).toEqual(['A-ROW']);

    const dsB = await buildOfferResponseDataset(REST_B);
    expect(dsB.rows.map((r) => r.customerId)).toEqual(['B-ROW']);
  });

  it('persisted attribution-window flag flows into analysis counting', async () => {
    await createExperiment({
      restaurantId: REST_A,
      experimentId: 'WIN-EXP',
      name: 'n',
      objective: 'o',
      controlDescription: 'no offer',
      variants: [
        { id: 'control', name: 'No offer', kind: 'control', offerId: null, allocation: 0.5 },
        { id: 'variant-a', name: 'Deal', kind: 'treatment', offerId: null, allocation: 0.5 },
      ],
      primaryMetric: 'redemption_rate',
      attributionWindowDays: 7,
      minSampleSizePerArm: 1,
      createdBy: 't',
    });
    await launchExperiment(REST_A, 'WIN-EXP');

    // Assign one treatment customer (any draw order is fine here).
    let found = false;
    for (let i = 0; i < 50 && !found; i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: 'WIN-EXP', customerId: `win-${i}` });
      if (r.kind === 'treatment') {
        found = true;
        // In-window conversion.
        const inWin = await recordExperimentOutcome({
          restaurantId: REST_A,
          experimentId: 'WIN-EXP',
          customerId: `win-${i}`,
          attributedRevenue: 100,
          at: new Date(Date.now() + 86_400_000),
        });
        expect(inWin.counted).toBe(true);
      }
    }
    expect(found).toBe(true);

    // Assign one more treatment customer and convert OUTSIDE the window.
    let lateFound = false;
    for (let i = 50; i < 120 && !lateFound; i++) {
      const r = await assignCustomerToExperiment({ restaurantId: REST_A, experimentId: 'WIN-EXP', customerId: `win-${i}` });
      if (r.kind === 'treatment') {
        lateFound = true;
        const late = await recordExperimentOutcome({
          restaurantId: REST_A,
          experimentId: 'WIN-EXP',
          customerId: `win-${i}`,
          attributedRevenue: 500,
          at: new Date(Date.now() + 30 * 86_400_000),
        });
        expect(late.counted).toBe(false);
      }
    }
    expect(lateFound).toBe(true);

    // Dataset: control rows were also assigned along the way; the invariants
    // are 2 treatment rows with conversions (labels), regardless of window.
    const ds = await buildOfferResponseDataset(REST_A, { experimentId: 'WIN-EXP' });
    expect(ds.composition.treatmentRows).toBe(2);
    expect(ds.composition.conversions).toBe(2);
    expect(ds.rows.filter((r) => r.treatment === 1).every((r) => r.purchase === 1)).toBe(true);
  });
});
