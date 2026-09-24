/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * factConsistencyService tests — deterministic fact validation.
 *
 * PHASE 3: this file was split from factConsistencyTelemetryBranch.test.ts.
 * The deterministic fact-consistency engine (numeric claims, unsupported
 * comparisons, entity checks, inventory claims, severity levels, fallback on
 * INVALID) is fully preserved; the AI telemetry / LLM-cache sections of the
 * old file were removed together with the AI execution layer.
 */
import { describe, it, expect } from 'vitest';

import { validateFactConsistency, normalizeNumber } from '../factConsistencyService';

function bundle(overrides: Record<string, any> = {}) {
  return {
    amounts: { revenue: 125000, orders: 412, aov: 303 },
    products: ['Burger', 'Pizza', 'Pasta', 'Paneer Tikka'],
    categories: ['Main Course', 'Beverages'],
    segments: ['VIP', 'Dormant 30D'],
    surplusStockItems: ['Paneer'],
    lowStockItems: ['Milk'],
    ...overrides,
  };
}

// ─── Numeric claim validation ─────────────────────────────────────────

describe('numeric claim validation', () => {
  it('normalizes currency formats: ₹, commas, lakh', () => {
    expect(normalizeNumber('₹125,000')).toBe(125000);
    expect(normalizeNumber('Rs. 1.25 lakh')).toBe(125000);
    expect(normalizeNumber('INR 412')).toBe(412);
  });

  it('accepts an exact numeric match', () => {
    const r = validateFactConsistency('Revenue was ₹125,000 and we had 412 orders.', bundle());
    expect(r.status).toBe('VALID');
    expect(r.violations).toHaveLength(0);
  });

  it('accepts a rounded/lakh-form numeric match', () => {
    const r = validateFactConsistency('Revenue was around ₹1.25 lakh.', bundle());
    expect(r.status).toBe('VALID');
  });

  it('flags a numeric mismatch (revenue 140k vs 125k)', () => {
    const r = validateFactConsistency('Revenue was ₹140,000 last month.', bundle());
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'numeric_mismatch')).toBe(true);
  });

  it('flags an unsupported percentage comparison (no previous-period data)', () => {
    const r = validateFactConsistency('Revenue increased 18% this month.', bundle({ previousPeriod: undefined }));
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'unsupported_comparison')).toBe(true);
  });

  it('validates a comparison when previous-period data exists', () => {
    const facts = bundle({ previousPeriod: { revenue: 100000, orders: 350 } });
    const r = validateFactConsistency('Revenue increased 25% compared to the previous period.', facts);
    // 125000 vs 100000 = +25% → VALID
    expect(r.status).toBe('VALID');
  });

  it('flags a comparison that contradicts previous-period data', () => {
    const facts = bundle({ previousPeriod: { revenue: 100000, orders: 350 } });
    const r = validateFactConsistency('Revenue dropped 30% compared to the previous period.', facts);
    expect(r.status).toBe('INVALID');
  });

  it('treats qualitative trends without numbers as WARNING (ambiguous)', () => {
    const r = validateFactConsistency('Our revenue is growing and sales are strong overall.', bundle());
    expect(r.status).toBe('WARNING');
    expect(r.violations.some((v) => v.code === 'ambiguous_qualitative')).toBe(true);
  });
});

// ─── Entity validation ────────────────────────────────────────────────

describe('entity validation', () => {
  it('flags a claim about an unknown product', () => {
    const r = validateFactConsistency('Sandwich sales are falling this week.', bundle());
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'unknown_entity')).toBe(true);
  });

  it('accepts claims about known entities', () => {
    const r = validateFactConsistency('Burger is a top-selling item and Beverages is a strong category.', bundle());
    expect(r.violations.filter((v) => v.code === 'unknown_entity')).toHaveLength(0);
  });

  it('flags an unknown segment reference', () => {
    const r = validateFactConsistency('Target Platinum members with this offer.', bundle());
    expect(r.violations.some((v) => v.code === 'unknown_segment')).toBe(true);
  });
});

// ─── Inventory claims ─────────────────────────────────────────────────

describe('inventory claims', () => {
  it('flags overstock claims when the deterministic surplus list is empty', () => {
    const r = validateFactConsistency('Paneer is overstocked — push a discount.', bundle({ surplusStockItems: [] }));
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'unsupported_inventory_claim')).toBe(true);
  });

  it('accepts overstock claims only for deterministic surplus items', () => {
    const r = validateFactConsistency('Paneer is overstocked, so we can promote it.', bundle());
    expect(r.status).toBe('VALID');
  });

  it('flags overstock claims for items NOT in the surplus list', () => {
    const r = validateFactConsistency('Chicken is overstocked, so we can promote it.', bundle());
    expect(r.status).toBe('INVALID');
  });

  it('flags an inventory conflict: low-stock item claimed as overstocked', () => {
    const r = validateFactConsistency('Milk is overstocked — discount it.', bundle());
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'inventory_conflict')).toBe(true);
  });

  it('flags wastage claims when no deterministic wastage data exists', () => {
    const r = validateFactConsistency('Paneer wastage is rising, so clearance offers make sense.', bundle({ wastageItems: [] }));
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'unsupported_wastage_claim')).toBe(true);
  });

  it('accepts wastage claims only for deterministic wastage items', () => {
    const r = validateFactConsistency('Milk wastage is high — a short clearance framing could help.', bundle({ wastageItems: ['Milk'] }));
    expect(r.status).toBe('VALID');
  });

  it('warns on wastage claims for items not in the deterministic wastage list', () => {
    const r = validateFactConsistency('Chicken wastage is high — clear it out.', bundle({ wastageItems: ['Milk'] }));
    expect(r.status).toBe('WARNING');
    expect(r.violations.some((v) => v.code === 'unsupported_wastage_claim')).toBe(true);
  });

  it('treats deteriorating-margin product names as known entities', () => {
    const r = validateFactConsistency('Veg Biryani margins are under pressure from rice costs.', bundle({ deterioratingItems: ['Veg Biryani'], products: [] }));
    // The claim references a supplied deterministic fact — no unknown-entity violation.
    expect(r.violations.some((v) => v.code === 'unknown_entity')).toBe(false);
  });
});

// ─── Output quality & fallback ────────────────────────────────────────

describe('output quality & fallback', () => {
  it('flags malformed/empty output', () => {
    const r = validateFactConsistency('', bundle());
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'malformed_output')).toBe(true);
  });

  it('returns VALID for an empty fact bundle (nothing to contradict)', () => {
    const r = validateFactConsistency('Everything looks good today.', {});
    expect(r.status).toBe('VALID');
  });

  it('never crashes on non-string input', () => {
    const r = validateFactConsistency(null, bundle());
    expect(r.status).toBe('INVALID');
  });
});
