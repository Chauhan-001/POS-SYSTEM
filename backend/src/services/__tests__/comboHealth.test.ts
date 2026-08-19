/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 12 — combo health + weak-combo provider tests. Deterministic only:
 * health/ranking come from existing combo analytics (revenue alone never
 * decides health); rework candidates come from the real catalog; thin
 * evidence (units < 5) yields MONITOR, never an aggressive call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Offer', () => ({ default: { find: vi.fn() } }));
vi.mock('../../models/Product', () => ({ default: { find: vi.fn() } }));
vi.mock('../offerAnalyticsService', () => ({
  getComboAnalytics: vi.fn(),
  // Real classifyCombo is synchronous (returns string[]); the service spreads it.
  classifyCombo: vi.fn(() => []),
}));
vi.mock('../productService', () => ({
  resolveMenuProductScope: vi.fn(async () => [{ restaurantId: 'restA' }]),
}));
vi.mock('../../modules/recipes/services/costIntelligenceService', () => ({
  costIntelligenceService: { metrics: vi.fn() },
}));

import { getComboHealth, MIN_EVIDENCE_UNITS } from '../comboHealthService';
import { WeakComboRecommendationProvider, type RecommendationContext } from '../offerEngine';
import OfferModel from '../../models/Offer';
import ProductModel from '../../models/Product';
import { getComboAnalytics } from '../offerAnalyticsService';
import { costIntelligenceService } from '../../modules/recipes/services/costIntelligenceService';

const REST = '507f1f77bcf86cd799439011';

function comboRow(overrides: Record<string, any>) {
  return {
    offerId: 'c1', name: 'Combo One', restaurantId: REST, orders: 20, units: 20,
    comboPrice: 249, listValueAtSale: 5000, structuralSavings: 1000, comboRevenue: 4980,
    variableCost: 180, contribution: 1380, contributionMargin: 27.7, uniqueCustomers: 12,
    repeatCustomers: 3, repeatRate: 25, averageOrderValue: 400, components: [],
    bestPeriod: null, weakPeriod: null, impressions: null, clicks: null, conversionRate: null,
    classification: [],
    ...overrides,
  };
}

function chainable(rows: any[]) {
  return { select: () => ({ lean: () => ({ exec: async () => rows }) }), lean: () => rows };
}

beforeEach(() => {
  vi.clearAllMocks();
  (OfferModel.find as any).mockImplementation(() => chainable([
    { _id: 'c1', title: 'Combo One', comboProductIds: ['prodA', 'prodB'], comboPrice: 249 },
  ]));
  (ProductModel.find as any).mockImplementation(() => chainable([
    { _id: 'prodA', name: 'Burger', category: 'Burgers' },
    { _id: 'prodB', name: 'Fries', category: 'Sides' },
    { _id: 'prodC', name: 'Salad', category: 'Sides' },
  ]));
  (costIntelligenceService.metrics as any).mockResolvedValue({
    productProfitability: [
      { productId: 'prodA', productName: 'Burger', contributionMarginPercent: 60, unitsSold: 100 },
      { productId: 'prodB', productName: 'Fries', contributionMarginPercent: 15, unitsSold: 80 },
      { productId: 'prodC', productName: 'Salad', contributionMarginPercent: 70, unitsSold: 50 },
    ],
    ingredientCostChanges: [], wastage: {}, variance: {},
  });
});

describe('Phase 12 — combo health classifications', () => {
  it('classifies a healthy combo NO_ACTION', async () => {
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 40, contributionMargin: 45 })])
      .mockResolvedValueOnce([comboRow({ units: 15, contributionMargin: 45 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('HEALTHY');
    expect(rows[0].recommendation).toBe('NO_ACTION');
  });

  it('classifies a low-margin combo as REPRICE', async () => {
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 25, contributionMargin: 8 })])
      .mockResolvedValueOnce([comboRow({ units: 10, contributionMargin: 8 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('LOW_MARGIN');
    expect(rows[0].recommendation).toBe('REPRICE');
  });

  it('classifies a high-discount combo as REDUCE_DISCOUNT', async () => {
    // structuralSavings 2000 / comboRevenue 4980 = 40% discount, margin 22% (< 25)
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 20, contributionMargin: 22, structuralSavings: 2000 })])
      .mockResolvedValueOnce([comboRow({ units: 8, contributionMargin: 22, structuralSavings: 2000 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('HIGH_DISCOUNT');
    expect(rows[0].recommendation).toBe('REDUCE_DISCOUNT');
    expect(rows[0].discountImpact).toBe(40);
  });

  it('classifies a low-demand healthy combo as PROMOTE', async () => {
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 7, contributionMargin: 45 })])
      .mockResolvedValueOnce([comboRow({ units: 2, contributionMargin: 45 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('LOW_DEMAND');
    expect(rows[0].recommendation).toBe('PROMOTE');
  });

  it('classifies a declining combo (7d < 25% of 30d) with thin margin as REWORK', async () => {
    // savings 900/4980 = 18% — below the 20% discount flag, so DECLINING wins.
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 20, contributionMargin: 18, structuralSavings: 900 })])
      .mockResolvedValueOnce([comboRow({ units: 1, contributionMargin: 18, structuralSavings: 900 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('DECLINING');
    expect(rows[0].recommendation).toBe('REWORK');
  });

  it('treats insufficient data as MONITOR, never an aggressive call', async () => {
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 2, contributionMargin: 5 })])
      .mockResolvedValueOnce([comboRow({ units: 1, contributionMargin: 5 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('INSUFFICIENT_DATA');
    expect(rows[0].recommendation).toBe('MONITOR');
    expect(rows[0].reworkCandidates).toBeUndefined(); // never propose surgery on 2 sales
    expect(MIN_EVIDENCE_UNITS).toBe(5);
  });

  it('ranks economics over revenue: high-revenue broken combo is NOT healthy', async () => {
    // ₹30k revenue, ₹10k discount, 9% margin — broken economics despite revenue.
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 60, comboRevenue: 30000, structuralSavings: 10000, contributionMargin: 9 })])
      .mockResolvedValueOnce([comboRow({ units: 20, comboRevenue: 30000, structuralSavings: 10000, contributionMargin: 9 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('LOW_MARGIN');
    expect(rows[0].recommendation).toBe('REPRICE');
  });
});

describe('Phase 12 — rework candidates', () => {
  it('proposes real catalog products with better contribution than the weak component', async () => {
    // Fries has 15% margin; Salad (same category "Sides") has 70% → candidate.
    // savings 900/4980 = 18% keeps the verdict LOW_MARGIN (not HIGH_DISCOUNT).
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 12, contributionMargin: 9, structuralSavings: 900 })])
      .mockResolvedValueOnce([comboRow({ units: 4, contributionMargin: 9, structuralSavings: 900 })]);
    const rows = await getComboHealth(REST);
    expect(rows[0].healthStatus).toBe('LOW_MARGIN');
    expect(rows[0].reworkCandidates).toBeDefined();
    // Salad (70% margin) beats both Fries (15%) and Burger (60%) — assert the
    // weak-component pairing specifically.
    const salad = rows[0].reworkCandidates!.find((c) => c.productName === 'Salad' && c.replacementFor === 'Fries');
    expect(salad).toBeDefined();
    // Every candidate must be a real catalog product.
    const catalogIds = new Set(['prodA', 'prodB', 'prodC']);
    expect(rows[0].reworkCandidates!.every((c) => catalogIds.has(c.productId))).toBe(true);
  });

  it('never invents a replacement product outside the catalog', async () => {
    (getComboAnalytics as any)
      .mockResolvedValueOnce([comboRow({ units: 12, contributionMargin: 8, structuralSavings: 900 })])
      .mockResolvedValueOnce([comboRow({ units: 4, contributionMargin: 8, structuralSavings: 900 })]);
    const rows = await getComboHealth(REST);
    const catalogIds = new Set(['prodA', 'prodB', 'prodC']);
    for (const c of rows[0].reworkCandidates || []) {
      expect(catalogIds.has(c.productId)).toBe(true);
    }
  });
});

describe('Phase 12 — WeakCombo provider (offerEngine)', () => {
  const ctx = (comboOverrides: any): RecommendationContext => ({
    restaurantId: REST,
    customerCount: 100,
    activeCustomers: 60,
    newCustomersToday: 2,
    repeatCustomersToday: 5,
    offerPerformance: [{
      offerId: 'c1', title: 'Combo One', type: 'combo', redemptions: 20,
      revenueGenerated: 4980, discountGiven: 1000, averageOrderValue: 400, uniqueCustomers: 12,
      comboUnits: comboOverrides.units ?? 20, comboRevenue: 4980, comboPrice: 249, comboOrders: 20,
      structuralSavings: comboOverrides.structuralSavings ?? 1000, contributionMargin: comboOverrides.margin,
    }],
  });

  it('warns on broken economics (margin < 10%)', async () => {
    const p = new WeakComboRecommendationProvider();
    const s = await p.getSuggestions(ctx({ margin: 6 }));
    expect(s.length).toBe(1);
    expect(s[0].recommendationSource).toBe('combo_upsell');
    expect(s[0].isWarning).toBe(true);
  });

  it('monitors (not reworks) a combo with fewer than 5 units', async () => {
    const p = new WeakComboRecommendationProvider();
    const s = await p.getSuggestions(ctx({ margin: 50, units: 2 }));
    // thin-evidence card references monitoring, not aggressive rework
    expect(s.length).toBe(1);
    expect(s[0].title).toContain('too little data');
    expect(s[0].description).not.toMatch(/rework|retire/i);
  });

  it('warns on high structural discount with thin margin', async () => {
    const p = new WeakComboRecommendationProvider();
    const s = await p.getSuggestions(ctx({ margin: 20 }));
    expect(s.length).toBe(1);
    expect(s[0].description).toMatch(/discount/i);
  });
});
