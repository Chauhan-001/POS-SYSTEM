/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 — deterministic price-intelligence tests. The service is read-only:
 * it never mutates a selling price (no update/create calls are ever made).
 * Financial values are computed by the existing deterministic stack (mocked
 * here as its real output shape) — the LLM is not involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Product', () => ({
  default: { find: vi.fn() },
}));

/** Product.find() returns a chainable query — mock the chain we actually use. */
function chainable(rows: any[]) {
  return {
    select: () => ({ lean: () => ({ exec: async () => rows }) }),
    lean: () => rows,
  };
}
function mockProducts(rows: any[]) {
  (ProductModel.find as any).mockImplementation(() => chainable(rows));
}
vi.mock('../../services/productService', () => ({
  resolveMenuProductScope: vi.fn(async () => [{ restaurantId: 'restA' }]),
}));
vi.mock('../../modules/recipes/services/costIntelligenceService', () => ({
  costIntelligenceService: {
    metrics: vi.fn(),
    marginDeterioration: vi.fn(),
  },
}));

import { getPriceIntelligence, TARGET_MARGIN_PCT, COST_SPIKE_PCT, DETERIORATION_PP } from '../priceIntelligenceService';
import ProductModel from '../../models/Product';
import { costIntelligenceService } from '../../modules/recipes/services/costIntelligenceService';

const REST = '507f1f77bcf86cd799439011';

function product(id: string, name: string, overrides: Record<string, any> = {}) {
  return { _id: id, name, category: 'Main Course', price: 149, branchPrice: undefined, averageCost: 60, code: `SKU-${id.slice(-4)}`, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});



describe('Phase 10 — price intelligence derivation', () => {
  it('flags a product priced below its minimum safe price', async () => {
    mockProducts([product('p1', 'Chicken Curry')]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Chicken Curry', sellingPrice: 149, recipeCost: 130, foodCostPercent: 87.2, contributionMarginPercent: 12.8, unitsSold: 40, totalContribution: 763 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({ rows: [] });

    const rows = await getPriceIntelligence(REST);
    const r = rows[0];
    expect(r.status).toBe('BELOW_PRICE_FLOOR');
    expect(r.recommendation).toBe('REVIEW_PRICE');
    // price floor = 130 / (1 - 0.25) = 173.33
    expect(r.minimumSafePrice).toBeCloseTo(173.33, 1);
    expect(r.currentPrice).toBe(149);
  });

  it('keeps a product above the price floor HEALTHY', async () => {
    mockProducts([product('p1', 'Paneer Tikka')]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Paneer Tikka', sellingPrice: 249, recipeCost: 80, foodCostPercent: 32.1, contributionMarginPercent: 67.9, unitsSold: 80, totalContribution: 13580 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({ rows: [] });

    const rows = await getPriceIntelligence(REST);
    expect(rows[0].status).toBe('HEALTHY');
    expect(rows[0].recommendation).toBe('NO_ACTION');
  });

  it('detects a cost spike (recipe cost rose >= 10%)', async () => {
    // price 210 > floor 150/0.75 = 200, so BELOW_PRICE_FLOOR does not fire;
    // the 25% cost rise is the only active signal → COST_SPIKE.
    mockProducts([product('p1', 'Veg Biryani', { price: 210 })]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Veg Biryani', sellingPrice: 210, recipeCost: 150, foodCostPercent: 71.4, contributionMarginPercent: 24.6, unitsSold: 30, totalContribution: 1476 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({
      rows: [{ productId: 'p1', productName: 'Veg Biryani', previousRecipeCost: 120, recipeCost: 150, recipeCostDelta: 30, recipeCostPct: 25, previousContributionMarginPercent: 39.7, contributionMarginPercent: 24.6, marginDeltaPp: -15.1, category: 'Main Course' }],
    });

    const rows = await getPriceIntelligence(REST);
    expect(rows[0].status).toBe('COST_SPIKE');
    expect(rows[0].costChangePct).toBeGreaterThanOrEqual(COST_SPIKE_PCT);
    expect(rows[0].recommendation).toBe('REVIEW_RECIPE');
  });

  it('flags margin deterioration of >= 5 percentage points', async () => {
    // price 60 > floor 32/0.75 = 42.67 (not below floor) and cost rose only
    // 6.7% (< 10, not a spike) — margin drop is the sole active signal.
    mockProducts([product('p1', 'Masala Chai', { price: 60 })]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Masala Chai', sellingPrice: 60, recipeCost: 32, foodCostPercent: 53.3, contributionMarginPercent: 22.4, unitsSold: 200, totalContribution: 2195 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({
      rows: [{ productId: 'p1', productName: 'Masala Chai', previousRecipeCost: 30, recipeCost: 32, previousContributionMarginPercent: 38.8, contributionMarginPercent: 22.4, marginDeltaPp: -16.4 }],
    });

    const rows = await getPriceIntelligence(REST);
    expect(rows[0].status).toBe('MARGIN_DETERIORATING');
    expect(Math.abs(rows[0].marginChangePp!)).toBeGreaterThanOrEqual(DETERIORATION_PP);
    expect(rows[0].recommendation).toBe('REVIEW_PRICE');
  });

  it('applies the branchPrice override when branch-scoped (Phase 9)', async () => {
    const bp = new Map([['branchB', 179]]);
    mockProducts([product('p1', 'Cold Coffee', { branchPrice: bp })]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Cold Coffee', sellingPrice: 149, recipeCost: 100, foodCostPercent: 67.1, contributionMarginPercent: 32.9, unitsSold: 60, totalContribution: 2940 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({ rows: [] });

    const rows = await getPriceIntelligence(REST, { branchId: 'branchB' });
    expect(rows[0].currentPrice).toBe(179); // branch override wins over base 149
  });

  it('handles products with zero/invalid cost by skipping them', async () => {
    mockProducts([product('p1', 'No Cost Item', { averageCost: 0 })]);
    (costIntelligenceService.metrics as any).mockResolvedValue({ productProfitability: [], ingredientCostChanges: [], wastage: {}, variance: {} });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({ rows: [] });

    const rows = await getPriceIntelligence(REST);
    expect(rows).toHaveLength(0); // no cost truth → never guess a price action
  });

  it('is read-only: never mutates a product price', async () => {
    mockProducts([product('p1', 'Paneer Tikka')]);
    (costIntelligenceService.metrics as any).mockResolvedValue({
      productProfitability: [{ productId: 'p1', productName: 'Paneer Tikka', sellingPrice: 249, recipeCost: 80, foodCostPercent: 32.1, contributionMarginPercent: 67.9, unitsSold: 80, totalContribution: 13580 }],
      ingredientCostChanges: [], wastage: {}, variance: {},
    });
    (costIntelligenceService.marginDeterioration as any).mockResolvedValue({ rows: [] });

    await getPriceIntelligence(REST);
    // The service only calls Product.find (read) — never updateOne/create.
    const calls = (ProductModel.find as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect((ProductModel as any).updateOne).toBeUndefined();
  });

  it('exports centralized documented thresholds', () => {
    expect(TARGET_MARGIN_PCT).toBe(25);
    expect(COST_SPIKE_PCT).toBe(10);
    expect(DETERIORATION_PP).toBe(5);
  });
});
