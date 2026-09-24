/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic offer-intelligence CORE tests — AI-free by construction.
 * Split from offerIntelligence.test.ts in Phase 2 (core extraction). These
 * cover LAYER: CORE behavior that must survive AI removal unchanged:
 *   - Phase 4 — deriveSurplusItems (deterministic surplus inventory)
 *   - Phase 6 — ProvenOfferRecommendationProvider (economic ranking)
 *
 * PHASE 3: the AI-endpoint request-schema assertions were removed together
 * with the /api/ai endpoints; the deterministic assertions are unchanged.
 */
import { describe, it, expect } from 'vitest';

import { deriveSurplusItems } from '../recommendationContext';
import { ProvenOfferRecommendationProvider, provenOfferEconomicScore, type RecommendationContext } from '../offerEngine';

function baseCtx(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    restaurantId: '507f1f77bcf86cd799439011',
    customerCount: 100,
    activeCustomers: 60,
    newCustomersToday: 3,
    repeatCustomersToday: 5,
    ...overrides,
  } as RecommendationContext;
}

// ─── Phase 4 — deterministic surplus inventory ───────────────────────

describe('Phase 4 — deriveSurplusItems is deterministic and conflict-safe', () => {
  const product = (over: any) => ({
    _id: over._id || 'p1',
    name: over.name || 'Item',
    category: 'Inventory',
    currentStock: over.currentStock ?? 0,
    minStock: over.minStock ?? 0,
    maxStock: over.maxStock ?? 0,
    unit: over.unit || 'kg',
    price: 0,
    averageCost: 10,
    expiryDate: over.expiryDate || '',
  });

  it('flags an item above 80% of max stock as surplus with surplusQuantity', () => {
    const items = [product({ name: 'Mango Pulp', currentStock: 30, maxStock: 20, expiryDate: '2026-09-01' })];
    const surplus = deriveSurplusItems(items);
    expect(surplus).toBeDefined();
    expect(surplus![0].productName).toBe('Mango Pulp');
    expect(surplus![0].surplusQuantity).toBe(14); // 30 − 20×0.8
    expect(surplus![0].expiryRisk).toBe(true);
  });

  it('does NOT flag stock under the surplus threshold', () => {
    const items = [product({ name: 'Milk', currentStock: 10, maxStock: 20 })];
    expect(deriveSurplusItems(items)).toBeUndefined();
  });

  it('low-stock WINS over surplus on inconsistent data (never promoted)', () => {
    // currentStock above 80% of max AND at/below min — the deterministic rule
    // resolves the conflict: low stock is authoritative, item is NOT surplus.
    const items = [product({ name: 'Paneer', currentStock: 4, minStock: 5, maxStock: 5 })];
    expect(deriveSurplusItems(items)).toBeUndefined();
  });

  it('returns undefined for empty input (no fabricated surplus)', () => {
    expect(deriveSurplusItems([])).toBeUndefined();
  });

  it('is deterministic — same input, same output', () => {
    const items = [product({ name: 'Bun', currentStock: 40, maxStock: 30 })];
    expect(JSON.stringify(deriveSurplusItems(items))).toBe(JSON.stringify(deriveSurplusItems(items)));
  });
});

// ─── Phase 6 — deterministic economic ranking of proven offers ───────

describe('Phase 6 — proven offers rank by economics, not revenue', () => {
  const provider = new ProvenOfferRecommendationProvider();

  function perf(offerId: string, over: any) {
    return {
      offerId,
      redemptions: 10,
      revenueGenerated: 10000,
      discountGiven: 1000,
      averageOrderValue: 1000,
      uniqueCustomers: 8,
      ...over,
    };
  }

  it('provenOfferEconomicScore: a lower-revenue strong-contribution offer outranks a high-revenue poor one', () => {
    const offerA = perf('a', { revenueGenerated: 20000, discountGiven: 8000, redemptions: 10, contribution: 3000 });
    const offerB = perf('b', { revenueGenerated: 15000, discountGiven: 3000, redemptions: 10, contribution: 7000 });
    expect(provenOfferEconomicScore(offerB)).toBeGreaterThan(provenOfferEconomicScore(offerA));
  });

  it('without contribution data, the discount-aware approximation still prefers the healthier offer', () => {
    const offerA = perf('a', { revenueGenerated: 20000, discountGiven: 8000, redemptions: 10 }); // net 12000, 40% discount
    const offerB = perf('b', { revenueGenerated: 15000, discountGiven: 3000, redemptions: 10 }); // net 12000, 20% discount
    expect(provenOfferEconomicScore(offerB)).toBeGreaterThan(provenOfferEconomicScore(offerA));
  });

  it('small samples are weighted down (confidence guard)', () => {
    const lowSample = perf('a', { revenueGenerated: 10000, discountGiven: 500, redemptions: 3 });
    const healthySample = perf('b', { revenueGenerated: 8000, discountGiven: 400, redemptions: 10 });
    expect(provenOfferEconomicScore(healthySample)).toBeGreaterThan(provenOfferEconomicScore(lowSample));
  });

  it('contribution path respects the same confidence guard as the approximation', () => {
    // A 3-redemption offer with a big estimated contribution must NOT outrank a
    // 40-redemption proven offer with solid contribution (score × min(1, n/10)).
    const fluke = perf('a', { revenueGenerated: 100000, discountGiven: 0, redemptions: 3, contribution: 8000 }); // 8000 × 0.3 = 2400
    const proven = perf('b', { revenueGenerated: 20000, discountGiven: 2000, redemptions: 40, contribution: 4500 }); // 4500 × 1.0
    expect(provenOfferEconomicScore(proven)).toBeGreaterThan(provenOfferEconomicScore(fluke));
  });

  it('gates out offers whose deterministic margin is below the healthy floor (combo-rule mirror)', async () => {
    // margin 3000/20000 = 15% < 25% floor → NOT auto-recommended as a repeat,
    // exactly like a high-volume low-margin combo is not re-run.
    const ctx = baseCtx({
      customerCount: 100,
      offerPerformance: [
        perf('a', { title: 'Big Discount Feast', type: 'percentage', value: 50, revenueGenerated: 20000, discountGiven: 8000, contribution: 3000, contributionMarginRate: 0.15 }),
        perf('b', { title: 'Steady Performer', type: 'percentage', value: 10, revenueGenerated: 15000, discountGiven: 1500, contribution: 7000, contributionMarginRate: 0.47 }),
      ],
    });
    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].title).toContain('Steady Performer');
    expect(suggestions[0].recommendationReason).toContain('healthy-margin floor');
    expect(suggestions.some((s) => (s.title || '').includes('Big Discount Feast'))).toBe(false);
  });

  it('unmeasurable economics (no margin rate) still surface, ranked by the discount-aware score', async () => {
    const ctx = baseCtx({
      customerCount: 100,
      offerPerformance: [
        perf('a', { title: 'No-Recipe Offer', type: 'flat', value: 50, revenueGenerated: 20000, discountGiven: 8000, redemptions: 10 }),
        perf('b', { title: 'Leaner Offer', type: 'flat', value: 20, revenueGenerated: 15000, discountGiven: 1500, redemptions: 10 }),
      ],
    });
    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].title).toContain('Leaner Offer'); // lower discount share ranks first
  });

  it('insufficient analytics produce no recommendation (redemptions < 3)', async () => {
    const ctx = baseCtx({
      offerPerformance: [perf('a', { redemptions: 2, revenueGenerated: 5000, discountGiven: 100 })],
    });
    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.length).toBe(0);
  });

  it('high discount / low contribution offer is ranked below a healthy one in provider output', async () => {
    const ctx = baseCtx({
      customerCount: 100,
      offerPerformance: [
        perf('a', { title: 'Big Discount Feast', type: 'percentage', value: 50, revenueGenerated: 20000, discountGiven: 8000, contribution: 3000 }),
        perf('b', { title: 'Steady Performer', type: 'percentage', value: 10, revenueGenerated: 15000, discountGiven: 1500, contribution: 7000 }),
      ],
    });
    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.length).toBe(2);
    const titles = suggestions.map((s) => s.title || '');
    // The healthy offer must be the first repeat recommendation.
    expect(titles[0]).toContain('Steady Performer');
    expect(titles[1]).toContain('Big Discount Feast');
  });

  it('is deterministic — same context, same order, every time', async () => {
    const ctx = baseCtx({
      offerPerformance: [
        perf('a', { title: 'Offer A', type: 'flat', value: 50, revenueGenerated: 20000, discountGiven: 8000, contribution: 3000 }),
        perf('b', { title: 'Offer B', type: 'flat', value: 10, revenueGenerated: 15000, discountGiven: 1500, contribution: 7000 }),
      ],
    });
    const a = await provider.getSuggestions(ctx);
    const b = await provider.getSuggestions(ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('combo ranking remains margin-based (regression guard for existing behavior)', async () => {
    const ctx = baseCtx({
      offerPerformance: [
        {
          offerId: 'combo-healthy', title: 'Healthy Combo', type: 'combo', value: 249,
          redemptions: 45, revenueGenerated: 18000, discountGiven: 3000, averageOrderValue: 400,
          uniqueCustomers: 30, comboUnits: 45, comboRevenue: 18000, comboPrice: 400,
          comboOrders: 40, structuralSavings: 3000, contributionMargin: 62,
        },
        {
          offerId: 'combo-thin', title: 'Thin Combo', type: 'combo', value: 199,
          redemptions: 120, revenueGenerated: 26000, discountGiven: 14000, averageOrderValue: 300,
          uniqueCustomers: 90, comboUnits: 120, comboRevenue: 26000, comboPrice: 199,
          comboOrders: 125, structuralSavings: 13000, contributionMargin: 9.12,
        },
      ],
    });
    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.some((s) => String(s.title).includes('Healthy Combo'))).toBe(true);
    expect(suggestions.every((s) => !String(s.title).includes('Thin Combo'))).toBe(true);
  });
});
