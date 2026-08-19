/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phases 7–9 tests:
 *   Phase 7 — deterministic LLM fact-consistency validation (numeric claims,
 *             unsupported comparisons, entity checks, inventory claims,
 *             severity levels, fallback on INVALID)
 *   Phase 8 — AI telemetry: prompt version, privacy-safe prompt hash, cache-bust
 *             flag, and validation outcome surfaced through executeAiCall
 *   Phase 9 — branch-scoped cache isolation (Branch A ≠ Branch B ≠ tenant-wide)
 *             and branchId accepted by the recommendation schema
 *
 * Deterministic engines remain the financial source of truth; the LLM is only
 * checked against facts — it never computes them.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks: LLM provider + AI-enabled flag (before importing modules) ──
const completeMock = vi.hoisted(() => vi.fn());
vi.mock('../../modules/ai/provider/llmProvider', () => ({
  complete: completeMock,
}));
vi.mock('../../modules/ai/config', () => ({
  isAiEnabled: vi.fn(() => true),
  aiConfig: { apiKeys: ['test-key'] },
}));

import { validateFactConsistency, normalizeNumber, extractAmountClaims } from '../factConsistencyService';
import { executeAiCall, PROMPT_VERSIONS } from '../../modules/ai/services/aiService';
import { offerRecommendationsSchema } from '../../modules/ai/validators/ai';

const TENANT_A = '507f1f77bcf86cd799439011';
const TENANT_B = '507f191e810c19729de860ea';
const BRANCH_A = '507f1f77bcf86cd799439021';
const BRANCH_B = '507f1f77bcf86cd799439022';

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

// ─── PHASE 7 — FACT CONSISTENCY ───────────────────────────────────────

describe('Phase 7 — numeric claim validation', () => {
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

describe('Phase 7 — entity validation', () => {
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

describe('Phase 7 — inventory claims', () => {
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

describe('Phase 7 — output quality & fallback', () => {
  it('flags malformed/empty AI output', () => {
    const r = validateFactConsistency('', bundle());
    expect(r.status).toBe('INVALID');
    expect(r.violations.some((v) => v.code === 'malformed_output')).toBe(true);
  });

  it('returns VALID for an empty fact bundle (nothing to contradict)', () => {
    const r = validateFactConsistency('Everything looks good today.', {});
    expect(r.status).toBe('VALID');
  });

  it('never crashes on non-string AI output', () => {
    const r = validateFactConsistency(null, bundle());
    expect(r.status).toBe('INVALID');
  });
});

// ─── PHASE 8 — AI TELEMETRY ───────────────────────────────────────────

describe('Phase 8 — telemetry surfaced through executeAiCall', () => {
  it('records prompt version, privacy-safe prompt hash and cacheBust flag', async () => {
    completeMock.mockResolvedValueOnce({
      content: JSON.stringify({ suggestions: [], summaryInsight: 'ok', trendNote: 'note' }),
    });
    const r = await executeAiCall({
      prompt: 'Factual revenue 125000.',
      feature: 'offers',
      tenantId: TENANT_A,
      bustCache: true,
    });
    expect(r.promptVersion).toBe(PROMPT_VERSIONS['offers']);
    expect(r.promptVersion).toBe('offers-v3');
    expect(r.promptHash).toBeTypeOf('string');
    expect(r.promptHash).not.toContain('125000'); // never the full prompt
    expect(r.cacheBust).toBe(true);
  });

  it('reports cacheBust=false on a normal request', async () => {
    completeMock.mockResolvedValueOnce({
      content: JSON.stringify({ suggestions: [], summaryInsight: 'ok', trendNote: 'note' }),
    });
    const r = await executeAiCall({ prompt: 'Normal request.', feature: 'offers', tenantId: TENANT_A });
    expect(r.cacheBust).toBe(false);
  });

  it('cached responses carry prompt version metadata too', async () => {
    completeMock.mockResolvedValueOnce({
      content: JSON.stringify({ suggestions: [], summaryInsight: 'ok', trendNote: 'note' }),
    });
    await executeAiCall({ prompt: 'Cache me.', feature: 'offers', tenantId: TENANT_A });
    const hit = await executeAiCall({ prompt: 'Cache me.', feature: 'offers', tenantId: TENANT_A });
    expect(hit.cached).toBe(true);
    expect(hit.promptVersion).toBe(PROMPT_VERSIONS['offers']);
  });

  it('a cache-busted call replaces the cached entry', async () => {
    completeMock.mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [], summaryInsight: 'old', trendNote: 'old' }) });
    await executeAiCall({ prompt: 'Refresh me.', feature: 'offers', tenantId: TENANT_A });
    completeMock.mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [], summaryInsight: 'new', trendNote: 'new' }) });
    const fresh = await executeAiCall({ prompt: 'Refresh me.', feature: 'offers', tenantId: TENANT_A, bustCache: true });
    expect(fresh.cached).toBe(false);
    expect(fresh.data.summaryInsight).toBe('new');
    expect(fresh.cacheBust).toBe(true);
  });
});

// ─── PHASE 9 — BRANCH-SCOPED CACHE ISOLATION ──────────────────────────

describe('Phase 9 — branch-scoped cache isolation', () => {
  it('Branch A, Branch B and tenant-wide calls never share a cache entry', async () => {
    completeMock
      .mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [{ title: 'BranchA plan' }], summaryInsight: 'A', trendNote: '' }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [{ title: 'BranchB plan' }], summaryInsight: 'B', trendNote: '' }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [{ title: 'Tenant plan' }], summaryInsight: 'T', trendNote: '' }) });
    const prompt = 'Same contextual prompt text across scopes.';

    const a = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A, branchId: BRANCH_A });
    const b = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A, branchId: BRANCH_B });
    const t = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A });

    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    expect(t.cached).toBe(false);
    expect(a.data.summaryInsight).toBe('A');
    expect(b.data.summaryInsight).toBe('B');
    expect(t.data.summaryInsight).toBe('T');

    // Repeating Branch A must hit Branch A's own cache — not B's or tenant's.
    const aAgain = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A, branchId: BRANCH_A });
    expect(aAgain.cached).toBe(true);
    expect(aAgain.data.summaryInsight).toBe('A');
  });

  it('keeps tenants isolated within the same branch scope', async () => {
    completeMock
      .mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [], summaryInsight: 'TenantA', trendNote: '' }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ suggestions: [], summaryInsight: 'TenantB', trendNote: '' }) });
    const prompt = 'Cross-tenant branch check.';
    const a = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A, branchId: BRANCH_A });
    const b = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_B, branchId: BRANCH_A });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    expect(b.data.summaryInsight).toBe('TenantB');
  });
});

describe('Phase 9 — branchId accepted by the recommendation schema', () => {
  it('accepts an optional branchId and rejects unknown keys', () => {
    const ok = offerRecommendationsSchema.safeParse({ branchId: BRANCH_A, bustCache: true });
    expect(ok.success).toBe(true);
    const bad = offerRecommendationsSchema.safeParse({ branchId: BRANCH_A, madeUpKey: 1 });
    expect(bad.success).toBe(false);
  });
});
