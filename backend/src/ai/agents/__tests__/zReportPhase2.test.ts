/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportPhase2.test.ts — Phase 2 (Daily Summary / Z-Report Intelligence)
 * acceptance: normalizeWastage + normalizeCashClosing normalizers and the
 * buildZReportContext context builder.
 *
 * Normalizer tests are pure (no DB). Context tests use the repository's
 * established per-file mongodb-memory-server pattern to exercise the REAL
 * resolveBranchScope tenant validation and the REAL memoryManager degrade
 * path — no mocked production code paths.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { businessSignalSchema } from '../../intelligence/businessSignalTypes';
import { normalizeCashClosing, normalizeWastage } from '../../intelligence/businessSignalNormalizers';
import {
  buildZReportContext,
  comparisonWindows,
  normalizeBusinessDate,
} from '../zReportContext';
import BranchModel from '../../../models/core/Branch';
import RestaurantModel from '../../../models/core/Restaurant';

const A = '507f1f77bcf86cd799439011';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');

const tenantInput = { restaurantId: A, branchId: null as string | null, now: NOW };
const branchInput = { restaurantId: A, branchId: BR_A1 as string | null, now: NOW };

/** Every emitted signal must satisfy the canonical schema + scope rules. */
function expectCanonical(signals: unknown[], restaurantId: string, branchId: string | null) {
  for (const s of signals) {
    const parsed = businessSignalSchema.safeParse(s);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : (parsed as any).error?.issues)).toBe(true);
    const sig = s as { scope: { restaurantId: string; branchId: string | null; scope: string }; evidence: unknown[] };
    expect(sig.scope.restaurantId).toBe(restaurantId);
    expect(sig.scope.branchId).toBe(branchId);
    expect(sig.scope.scope).toBe(branchId ? 'branch' : 'tenant');
    expect(sig.evidence.length).toBeGreaterThan(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeWastage
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeWastage', () => {
  it('is unavailable with NO_TOOL_OUTPUT for null/undefined', () => {
    expect(normalizeWastage(null, tenantInput).status).toBe('unavailable');
    expect(normalizeWastage(null, tenantInput).reason).toBe('NO_TOOL_OUTPUT');
  });

  it('is unavailable with NO_WASTAGE_DATA when the tool found nothing', () => {
    const r = normalizeWastage({ available: false, reason: 'NO_WASTAGE_DATA', generatedAt: '2026-10-07T00:00:00.000Z' }, tenantInput);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_WASTAGE_DATA');
    expect(r.signals).toHaveLength(0);
  });

  it('is unavailable when an available payload carries no usable rows', () => {
    const r = normalizeWastage({ available: true, topItems: [], items: [], generatedAt: '2026-10-07T00:00:00.000Z' }, tenantInput);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_WASTAGE_DATA');
  });

  it('emits inventory_wastage levels for observed items', () => {
    const r = normalizeWastage(
      {
        available: true,
        topItems: [{ name: 'Paneer', qty: 3.5, unit: 'kg', cost: 700 }],
        items: [{ name: 'Paneer', unit: 'kg', qty: 3.5, cost: 700, prevQty: 3, prevCost: 600 }],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expectCanonical(r.signals, A, null);
    // Same ingredient from items[] and topItems[] must not be double-reported.
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].code).toBe('inventory_wastage');
    expect(r.signals[0].value).toBe(3.5);
    expect(r.signals[0].baseline).toBe(3);
    expect(r.signals[0].unit).toBe('kg');
  });

  it('emits inventory_wastage_spike only for a like-for-like quantity jump above 40%', () => {
    const r = normalizeWastage(
      {
        available: true,
        items: [
          { name: 'Tomato', unit: 'kg', qty: 10, cost: 300, prevQty: 5, prevCost: 150 }, // +100% → spike
          { name: 'Onion', unit: 'kg', qty: 4, cost: 80, prevQty: 3.5, prevCost: 70 },   // +14% → level
          { name: 'Rice', unit: 'kg', qty: 2, cost: 90, prevQty: 1, prevCost: 45 },      // +100% → spike
        ],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expectCanonical(r.signals, A, null);
    const spikes = r.signals.filter((s) => s.code === 'inventory_wastage_spike');
    expect(spikes.map((s) => s.subject?.id).sort()).toEqual(['Rice', 'Tomato']);
    for (const s of spikes) {
      expect(s.changePct).toBeGreaterThan(0.4);
      expect(s.baseline).toBeGreaterThan(0);
    }
    expect(r.signals.find((s) => s.subject?.id === 'Onion')?.code).toBe('inventory_wastage');
  });

  it('does not fabricate a spike when the previous figure is missing or zero', () => {
    const r = normalizeWastage(
      {
        available: true,
        items: [
          { name: 'FirstTime', unit: 'kg', qty: 9, cost: 100 },
          { name: 'ZeroBefore', unit: 'kg', qty: 9, cost: 100, prevQty: 0 },
        ],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.signals.every((s) => s.code === 'inventory_wastage')).toBe(true);
    expect(r.signals.every((s) => s.changePct === undefined)).toBe(true);
  });

  it('skips malformed rows and drops zero-quantity observations', () => {
    const r = normalizeWastage(
      {
        available: true,
        topItems: [{ name: '', qty: 5, cost: 10 }, { name: 'Ghost', qty: Number.NaN, cost: 10 }, { name: 'Nothing', qty: 0, cost: 0 }],
        items: [{ name: 'BadQty', unit: 'kg', qty: Number.NaN, cost: 5 }],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_WASTAGE_DATA');
    expect(r.signals).toHaveLength(0);
  });

  it('discloses unavailable-source wastage rows with unknown freshness, never as current', () => {
    const r = normalizeWastage(
      {
        available: false,
        reason: 'NO_WASTAGE_DATA',
        topItems: [{ name: 'StalePaneer', qty: 2, unit: 'kg', cost: 400 }],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].freshness).toBe('unknown');
    expect(r.signals[0].caveats?.join(' ')).toContain('unavailable');
    expectCanonical(r.signals, A, null);
  });

  it('propagates branch scope when requested', () => {
    const r = normalizeWastage(
      { available: true, items: [{ name: 'Oil', unit: 'L', qty: 2, cost: 300 }], generatedAt: '2026-10-07T00:00:00.000Z' },
      branchInput,
    );
    expect(r.signals[0].scope).toEqual({ restaurantId: A, branchId: BR_A1, scope: 'branch' });
  });

  it('sorts signals by measured quantity descending', () => {
    const r = normalizeWastage(
      {
        available: true,
        items: [
          { name: 'Small', unit: 'kg', qty: 1, cost: 20 },
          { name: 'Large', unit: 'kg', qty: 9, cost: 180 },
        ],
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.signals.map((s) => s.subject?.id)).toEqual(['Large', 'Small']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeCashClosing
// ─────────────────────────────────────────────────────────────────────────────

const CLOSING = {
  sales: {
    date: '2026-10-06',
    grossRevenue: 56000,
    netRevenue: 52000,
    orders: 210,
    averageOrderValue: 247.62,
    discounts: 1500,
    taxes: 2500,
    payments: [{ method: 'Cash', amount: 18000, count: 120 }, { method: 'UPI', amount: 34000, count: 90 }],
  },
  cash: {
    openingCash: 2000,
    cashSales: 18000,
    cashIn: 500,
    cashOut: 300,
    expenses: 1200,
    adjustments: 0,
    expectedCash: 19000,
    actualCash: 18900,
    overShort: -100,
  },
  generatedAt: '2026-10-07T02:00:00.000Z',
};

describe('normalizeCashClosing', () => {
  it('is unavailable for missing payload or missing closing date', () => {
    expect(normalizeCashClosing(null, tenantInput).reason).toBe('NO_TOOL_OUTPUT');
    const noDate = normalizeCashClosing({ ...CLOSING, sales: { ...CLOSING.sales, date: '' } }, tenantInput);
    expect(noDate.status).toBe('unavailable');
    expect(noDate.reason).toBe('NO_CLOSING_DATE');
  });

  it('emits the deterministic day-close sales level and the cash variance', () => {
    const r = normalizeCashClosing(CLOSING, tenantInput);
    expect(r.status).toBe('ok');
    expectCanonical(r.signals, A, null);
    const close = r.signals.find((s) => s.code === 'sales_day_close');
    const variance = r.signals.find((s) => s.code === 'cash_over_short');
    expect(close).toBeDefined();
    expect(close?.value).toBe(52000);
    expect(close?.sampleSize).toBe(210);
    expect(variance?.value).toBe(-100);
    expect(variance?.direction).toBe('down');
    // Variance evidence carries BOTH ledger sides of the reconciliation.
    const refs = (variance?.evidence ?? []).map((e) => e.ref);
    expect(refs).toContain('metric:cash:expected');
    expect(refs).toContain('metric:cash:actual');
  });

  it('grounding: confidence is 0.9 exactly when the deterministic report requires manager approval', () => {
    const flagged = normalizeCashClosing({ ...CLOSING, requiresManagerApproval: true }, tenantInput);
    const clean = normalizeCashClosing({ ...CLOSING, requiresManagerApproval: false }, tenantInput);
    expect(flagged.signals.find((s) => s.code === 'cash_over_short')?.confidence).toBe(0.9);
    expect(flagged.signals.find((s) => s.code === 'cash_over_short')?.caveats?.join(' ')).toContain('manager approval');
    expect(clean.signals.find((s) => s.code === 'cash_over_short')?.confidence).toBe(0.75);
  });

  it('handles a perfectly reconciled drawer (flat direction) and an over drawer (up)', () => {
    const flat = normalizeCashClosing(
      { ...CLOSING, cash: { ...CLOSING.cash, expectedCash: 19000, actualCash: 19000, overShort: 0 } },
      tenantInput,
    );
    expect(flat.signals.find((s) => s.code === 'cash_over_short')?.direction).toBe('flat');
    const over = normalizeCashClosing(
      { ...CLOSING, cash: { ...CLOSING.cash, expectedCash: 19000, actualCash: 19150, overShort: 150 } },
      tenantInput,
    );
    expect(over.signals.find((s) => s.code === 'cash_over_short')?.direction).toBe('up');
  });

  it('propagates branch scope when requested', () => {
    const r = normalizeCashClosing(CLOSING, branchInput);
    expect(r.signals[0].scope).toEqual({ restaurantId: A, branchId: BR_A1, scope: 'branch' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Business date + comparison windows (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeBusinessDate / comparisonWindows', () => {
  it('accepts a strict YYYY-MM-DD input', () => {
    expect(normalizeBusinessDate('2026-10-06', NOW)).toBe('2026-10-06');
  });

  it('rejects malformed dates with TOOL_INPUT_INVALID', () => {
    for (const bad of ['2026-10-6', '06-10-2026', '2026/10/06', '2026-13-01', '2026-02-30', 'yesterday', '']) {
      expect(() => normalizeBusinessDate(bad, NOW)).toThrowError();
    }
  });

  it('defaults to YESTERDAY in local calendar terms', () => {
    // 2026-10-07T00:30 local (+05:30) → local date 2026-10-07 → yesterday 2026-10-06.
    const justAfterMidnight = Date.parse('2026-10-06T19:00:00.000Z');
    expect(normalizeBusinessDate(undefined, justAfterMidnight)).toBe('2026-10-06');
    // 2026-10-07T18:30 local → local date 2026-10-07 → yesterday 2026-10-06.
    const evening = Date.parse('2026-10-07T13:00:00.000Z');
    expect(normalizeBusinessDate(undefined, evening)).toBe('2026-10-06');
  });

  it('builds previous-day, trailing-7d and trailing-30d windows ending yesterday', () => {
    const w = comparisonWindows('2026-10-06');
    expect(w.businessDate).toBe('2026-10-06');
    expect(w.previousDate).toBe('2026-10-05');
    expect(w.weekStartDate).toBe('2026-09-29');
    expect(w.weekEndDate).toBe('2026-10-05');
    expect(w.monthStartDate).toBe('2026-09-06');
    expect(w.monthEndDate).toBe('2026-10-05');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildZReportContext — REAL resolveBranchScope + memoryManager (mongodb-memory-server)
// ─────────────────────────────────────────────────────────────────────────────

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('buildZReportContext', () => {
  it('builds a tenant-wide context with resolved comparison windows and a memory snapshot', async () => {
    const ctx = await buildZReportContext({ restaurantId: A }, { date: '2026-10-06', now: NOW });
    expect(ctx.restaurantId).toBe(A);
    expect(ctx.branchId).toBeUndefined();
    expect(ctx.businessDate).toBe('2026-10-06');
    expect(ctx.comparison.previousDate).toBe('2026-10-05');
    expect(ctx.promptVersion).toBe('z-report-daily-v1');
    expect(Array.isArray(ctx.memory.episodes)).toBe(true);
    expect(Array.isArray(ctx.memory.longTerm)).toBe(true);
    expect(ctx.memory.degraded).toBeUndefined();
  });

  it('resolves an owned branch with its name', async () => {
    await RestaurantModel.create({ restaurantId: 'rest-a', name: 'Rest A', phone: '100' });
    await BranchModel.create({ _id: new mongoose.Types.ObjectId(BR_A1), restaurantId: new mongoose.Types.ObjectId(A), name: 'Koramangala', isHeadBranch: true, isActive: true });

    const ctx = await buildZReportContext({ restaurantId: A }, { date: '2026-10-06', branchId: BR_A1, now: NOW });
    expect(ctx.branchId).toBe(BR_A1);
    expect(ctx.branchName).toBe('Koramangala');
  });

  it('REJECTS a foreign branch with TOOL_TENANT_MISMATCH (tenant isolation P0)', async () => {
    const B = '507f1f77bcf86cd799439022';
    await RestaurantModel.create({ restaurantId: 'rest-b', name: 'Rest B', phone: '200' });
    await BranchModel.create({ restaurantId: new mongoose.Types.ObjectId(B), name: 'Foreign Branch', isHeadBranch: true, isActive: true });
    const foreign = await BranchModel.findOne({ restaurantId: new mongoose.Types.ObjectId(B) }).lean();

    await expect(
      buildZReportContext({ restaurantId: A }, { date: '2026-10-06', branchId: String(foreign?._id), now: NOW }),
    ).rejects.toMatchObject({ code: 'TOOL_TENANT_MISMATCH' });
  });

  it('rejects a nonexistent branch id just like a foreign one', async () => {
    await expect(
      buildZReportContext({ restaurantId: A }, { date: '2026-10-06', branchId: new mongoose.Types.ObjectId().toString(), now: NOW }),
    ).rejects.toMatchObject({ code: 'TOOL_TENANT_MISMATCH' });
  });

  it('rejects a malformed business date before any query runs', async () => {
    await expect(
      buildZReportContext({ restaurantId: A }, { date: 'not-a-date', now: NOW }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  });

  it('degrades gracefully (never throws) when the database is unavailable', async () => {
    await mongoose.disconnect();
    try {
      const ctx = await buildZReportContext({ restaurantId: A }, { date: '2026-10-06', now: NOW });
      // Context still builds; memory is flagged degraded — memory is context,
      // never a gate.
      expect(ctx.businessDate).toBe('2026-10-06');
      expect(ctx.memory.degraded).toBe(true);
    } finally {
      await mongoose.connect(mongo.getUri());
    }
  });
});
