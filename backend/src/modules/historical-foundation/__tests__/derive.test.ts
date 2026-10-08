/**
 * PHASE 4 — pure derivation tests. No DB.
 */

import { describe, expect, it } from 'vitest';

import { businessDateOfBill, deriveDailySalesFacts, missingBusinessDays, type BillLike } from '../derive';

const R = 'rest-1';
const opts = { restaurantId: R, datasetVersion: 'hist-v1', runId: 'run-1', timezone: 'Asia/Kolkata' };

const bill = (o: Partial<BillLike> = {}): BillLike => ({
  restaurantId: R,
  branchId: 'b1',
  date: '2026-10-01',
  grandTotal: 100,
  subtotal: 90,
  discount: 5,
  gst: 15,
  isVoided: false,
  ...o,
});

describe('businessDateOfBill', () => {
  it('prefers the stored business date string', () => {
    expect(businessDateOfBill({ date: '2026-10-01' }, 'UTC')).toBe('2026-10-01');
  });
  it('derives from createdAt in the restaurant timezone when date is absent', () => {
    expect(businessDateOfBill({ createdAt: '2026-10-06T19:00:00Z' }, 'Asia/Kolkata')).toBe('2026-10-07');
    expect(businessDateOfBill({ createdAt: '2026-10-06T19:00:00Z' }, 'UTC')).toBe('2026-10-06');
  });
  it('returns null when neither is usable', () => {
    expect(businessDateOfBill({}, 'UTC')).toBeNull();
  });
});

describe('deriveDailySalesFacts', () => {
  it('aggregates revenue/bills per (branch, businessDate)', () => {
    const facts = deriveDailySalesFacts(
      [
        bill({ grandTotal: 100 }),
        bill({ grandTotal: 200, discount: 0, gst: 20 }),
        bill({ branchId: 'b2', grandTotal: 50 }),
      ],
      opts,
    );
    const b1 = facts.filter((f) => f.branchId === 'b1');
    expect(b1.find((f) => f.metric === 'sales.grossRevenue')?.value).toBe(300);
    expect(b1.find((f) => f.metric === 'sales.bills')?.value).toBe(2);
    expect(facts.find((f) => f.branchId === 'b2' && f.metric === 'sales.grossRevenue')?.value).toBe(50);
    for (const f of facts) {
      expect(f.restaurantId).toBe(R);
      expect(f.dataStatus).toBe('OBSERVED');
      expect(f.datasetVersion).toBe('hist-v1');
      expect(f.runId).toBe('run-1');
    }
  });

  it('excludes voided bills from revenue but counts them', () => {
    const facts = deriveDailySalesFacts([bill({ grandTotal: 100 }), bill({ grandTotal: 999, isVoided: true })], opts);
    expect(facts.find((f) => f.metric === 'sales.grossRevenue')?.value).toBe(100);
    expect(facts.find((f) => f.metric === 'sales.bills')?.value).toBe(1);
    expect(facts.find((f) => f.metric === 'sales.billsVoided')?.value).toBe(1);
  });

  it('enforces tenant isolation (drops foreign-tenant rows)', () => {
    const facts = deriveDailySalesFacts([bill({ restaurantId: 'other' }), bill()], opts);
    expect(facts.every((f) => f.restaurantId === R)).toBe(true);
    expect(facts.find((f) => f.metric === 'sales.bills')?.value).toBe(1);
  });

  it('groups branchless bills under a null branch', () => {
    const facts = deriveDailySalesFacts([bill({ branchId: null })], opts);
    expect(facts.every((f) => f.branchId === null)).toBe(true);
  });
});

describe('missingBusinessDays', () => {
  it('reports gaps without converting them to zero', () => {
    const facts = deriveDailySalesFacts([bill({ date: '2026-10-01' }), bill({ date: '2026-10-03' })], opts);
    expect(missingBusinessDays(facts, '2026-10-01', '2026-10-03', 'b1')).toEqual(['2026-10-02']);
  });

  it('defaults to across ALL branches when no branch is given', () => {
    const facts = deriveDailySalesFacts(
      [bill({ date: '2026-10-01', branchId: 'b1' }), bill({ date: '2026-10-03', branchId: 'b2' })],
      opts,
    );
    expect(missingBusinessDays(facts, '2026-10-01', '2026-10-03')).toEqual(['2026-10-02']);
  });

  it('scopes to branchless bills when branchId is explicitly null', () => {
    const facts = deriveDailySalesFacts([bill({ date: '2026-10-01', branchId: 'b1' })], opts);
    expect(missingBusinessDays(facts, '2026-10-01', '2026-10-01', null)).toEqual(['2026-10-01']);
  });
});
