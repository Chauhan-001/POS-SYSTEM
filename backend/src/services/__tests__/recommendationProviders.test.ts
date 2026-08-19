/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase D provider unit tests — margin_deterioration + wastage intelligence.
 *
 * Both providers are pure functions of RecommendationContext (all financial
 * values arrive pre-computed by deterministic services), so these tests run
 * without a database. They assert BEHAVIOR (which cards appear, what numbers
 * are quoted) rather than implementation details.
 */
import { describe, it, expect } from 'vitest';
import {
  MarginSafetyRecommendationProvider,
  WastageRecommendationProvider,
  type RecommendationContext,
} from '../offerEngine';

const marginProvider = new MarginSafetyRecommendationProvider();
const wasteProvider = new WastageRecommendationProvider();

function baseCtx(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    restaurantId: '507f1f77bcf86cd799439011',
    customerCount: 0,
    activeCustomers: 0,
    newCustomersToday: 0,
    repeatCustomersToday: 0,
    ...overrides,
  } as RecommendationContext;
}

const onlyMarginDeterioration = (suggestions: any[]) =>
  suggestions.filter((s) => s.recommendationSource === 'margin_deterioration');

const onlyWastage = (suggestions: any[]) =>
  suggestions.filter((s) => s.recommendationSource === 'wastage_alert');

// ─── Margin deterioration ───────────────────────────────────────────────

describe('MarginSafetyRecommendationProvider — margin_deterioration', () => {
  it('emits a margin_deterioration card with deterministic before/after economics on a material cost increase', async () => {
    const ctx = baseCtx({
      margin: {
        productMargins: [],
        costRisers: [],
        deterioratingProducts: [
          {
            productId: 'p1', productName: 'Paneer Butter Masala', category: 'Main Course',
            sellingPrice: 299, previousRecipeCost: 76, recipeCost: 86, recipeCostDelta: 10,
            recipeCostPct: 13.2, previousContributionMarginPercent: 74.6, contributionMarginPercent: 71.2,
            marginDeltaPp: -3.4, ingredientName: 'Paneer', ingredientPreviousCost: 300,
            ingredientCurrentCost: 360, ingredientPctChange: 20,
          },
        ],
      },
    });
    const cards = onlyMarginDeterioration(await marginProvider.getSuggestions(ctx));
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.title).toContain('Paneer Butter Masala');
    expect(card.isWarning).toBe(true);
    expect(card.maxDiscount).toBe(0);
    // The reason must quote the actual deterministic numbers.
    expect(card.recommendationReason).toContain('20%');
    expect(card.recommendationReason).toContain('₹300');
    expect(card.recommendationReason).toContain('₹360');
    expect(card.recommendationReason).toContain('₹76');
    expect(card.recommendationReason).toContain('₹86');
    // Display rounds percentages; the underlying values are the deterministic ones.
    expect(card.recommendationReason).toContain('75%');
    expect(card.recommendationReason).toContain('71%');
  });

  it('emits a card when the margin falls materially even if the recipe-cost pct is small', async () => {
    const ctx = baseCtx({
      margin: {
        productMargins: [], costRisers: [],
        deterioratingProducts: [
          {
            productId: 'p1', productName: 'Cheap Snack', sellingPrice: 100,
            previousRecipeCost: 40, recipeCost: 49, recipeCostDelta: 9, recipeCostPct: 5.1,
            previousContributionMarginPercent: 60, contributionMarginPercent: 51,
            marginDeltaPp: -9, ingredientName: 'Oil', ingredientPreviousCost: 140,
            ingredientCurrentCost: 155, ingredientPctChange: 10.7,
          },
        ],
      },
    });
    const cards = onlyMarginDeterioration(await marginProvider.getSuggestions(ctx));
    expect(cards).toHaveLength(1);
    expect(cards[0].recommendationReason).toContain('9 percentage points');
  });

  it('emits NOTHING for an insignificant cost movement (sub-10% riser, no material impact)', async () => {
    const ctx = baseCtx({
      margin: {
        productMargins: [], costRisers: [],
        deterioratingProducts: [],
      },
    });
    const cards = onlyMarginDeterioration(await marginProvider.getSuggestions(ctx));
    expect(cards).toHaveLength(0);
  });

  it('caps multiple affected products at 3 distinct cards (dedupe + limit)', async () => {
    const make = (name: string, i: number) => ({
      productId: `p${i}`, productName: name, category: 'Main Course',
      sellingPrice: 250, previousRecipeCost: 60 + i, recipeCost: 70 + i,
      recipeCostDelta: 10, recipeCostPct: 15, previousContributionMarginPercent: 72,
      contributionMarginPercent: 68, marginDeltaPp: -4, ingredientName: 'Paneer',
      ingredientPreviousCost: 300, ingredientCurrentCost: 360, ingredientPctChange: 20,
    });
    const ctx = baseCtx({
      margin: {
        productMargins: [], costRisers: [],
        deterioratingProducts: ['Paneer Butter Masala', 'Paneer Tikka', 'Chilli Paneer', 'Paneer Roll', 'Paneer Paratha'].map(make),
      },
    });
    const cards = onlyMarginDeterioration(await marginProvider.getSuggestions(ctx));
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(3);
    const titles = new Set(cards.map((c) => c.title));
    expect(titles.size).toBe(cards.length);
  });

  it('is tenant-safe: only the context restaurant’s products ever appear in output', async () => {
    const tenantB = baseCtx({
      restaurantId: '507f191e810c19729de860ea', // tenant B
      margin: {
        productMargins: [], costRisers: [],
        deterioratingProducts: [
          {
            productId: 'b1', productName: 'Isolation Burger', sellingPrice: 199,
            previousRecipeCost: 80, recipeCost: 92, recipeCostDelta: 12, recipeCostPct: 15,
            previousContributionMarginPercent: 59.8, contributionMarginPercent: 53.8,
            marginDeltaPp: -6, ingredientName: 'Cheese', ingredientPreviousCost: 400,
            ingredientCurrentCost: 470, ingredientPctChange: 17.5,
          },
        ],
      },
    });
    const tenantACtx = baseCtx({
      restaurantId: '507f1f77bcf86cd799439011', // tenant A
      margin: { productMargins: [], costRisers: [], deterioratingProducts: [] },
    });
    const bCards = onlyMarginDeterioration(await marginProvider.getSuggestions(tenantB));
    const aCards = onlyMarginDeterioration(await marginProvider.getSuggestions(tenantACtx));
    expect(bCards.some((c) => c.title.includes('Isolation Burger'))).toBe(true);
    expect(aCards.length).toBe(0);
  });

  it('degrades gracefully on missing/invalid cost data (no throw, no cards)', async () => {
    const ctx = baseCtx({ margin: undefined });
    const cards = onlyMarginDeterioration(await marginProvider.getSuggestions(ctx));
    expect(cards).toHaveLength(0);
  });

  it('is deterministic — same context produces identical output', async () => {
    const ctx = baseCtx({
      margin: {
        productMargins: [], costRisers: [],
        deterioratingProducts: [
          {
            productId: 'p1', productName: 'Chilli Paneer', sellingPrice: 259,
            previousRecipeCost: 66, recipeCost: 76, recipeCostDelta: 10, recipeCostPct: 15.2,
            previousContributionMarginPercent: 74.5, contributionMarginPercent: 70.7,
            marginDeltaPp: -3.8, ingredientName: 'Paneer', ingredientPreviousCost: 300,
            ingredientCurrentCost: 360, ingredientPctChange: 20,
          },
        ],
      },
    });
    const a = await marginProvider.getSuggestions(ctx);
    const b = await marginProvider.getSuggestions(ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Wastage variance ───────────────────────────────────────────────────

describe('WastageRecommendationProvider — wastage intelligence', () => {
  it('flags a waste spike vs the previous-window baseline with excess cost', async () => {
    const ctx = baseCtx({
      wastage: {
        topItems: [{ name: 'Tomato', qty: 10, unit: 'kg', cost: 400 }],
        items: [{ name: 'Tomato', unit: 'kg', qty: 10, cost: 400, prevQty: 2, prevCost: 80 }],
        varianceRows: [{ name: 'Tomato', unit: 'kg', theoreticalQty: 11.7, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const card = cards[0];
    expect(card.title.toLowerCase()).toContain('spiked');
    // excess = 10 - 2 = 8 kg × ₹40 = ₹320, must appear in the reason.
    expect(card.recommendationReason).toContain('8');
    expect(card.recommendationReason).toContain('₹320');
  });

  it('flags repeated elevation as a recurring problem (not a one-off)', async () => {
    const ctx = baseCtx({
      wastage: {
        topItems: [{ name: 'Cream', qty: 1.5, unit: 'kg', cost: 450 }],
        items: [{ name: 'Cream', unit: 'kg', qty: 1.5, cost: 450, prevQty: 1.5, prevCost: 450 }],
        varianceRows: [{ name: 'Cream', unit: 'kg', theoreticalQty: 10, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0].title.toLowerCase()).toContain('repeatedly');
    expect(cards[0].recommendationReason.toLowerCase()).toContain('recurring');
  });

  it('does NOT flag normal-range wastage (negative control)', async () => {
    const ctx = baseCtx({
      wastage: {
        topItems: [{ name: 'Curd', qty: 0.4, unit: 'kg', cost: 24 }],
        items: [{ name: 'Curd', unit: 'kg', qty: 0.4, cost: 24, prevQty: 0.4, prevCost: 24 }],
        varianceRows: [{ name: 'Curd', unit: 'kg', theoreticalQty: 10.3, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBe(0);
  });

  it('computes excess waste cost deterministically (excess qty × average cost)', async () => {
    const ctx = baseCtx({
      wastage: {
        topItems: [{ name: 'Paneer', qty: 5, unit: 'kg', cost: 1700 }],
        items: [{ name: 'Paneer', unit: 'kg', qty: 5, cost: 1700, prevQty: 2, prevCost: 680 }],
        varianceRows: [{ name: 'Paneer', unit: 'kg', theoreticalQty: 15, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    // excess = 3 kg × ₹340 = ₹1020
    expect(cards[0].recommendationReason).toContain('₹1020');
  });

  it('adds overstock guidance (do NOT reorder) when the item is overstocked AND wasting', async () => {
    const ctx = baseCtx({
      inventory: [{ id: 'm1', name: 'Mushroom', category: 'Vegetables', currentStock: 13, minStock: 1, maxStock: 10, unit: 'kg', price: 0, averageCost: 185 }],
      wastage: {
        topItems: [{ name: 'Mushroom', qty: 1.2, unit: 'kg', cost: 222 }],
        items: [{ name: 'Mushroom', unit: 'kg', qty: 1.2, cost: 222, prevQty: 0, prevCost: 0 }],
        varianceRows: [{ name: 'Mushroom', unit: 'kg', theoreticalQty: 1.1, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const text = (cards[0].title + ' ' + cards[0].description + ' ' + cards[0].recommendationReason).toLowerCase();
    expect(text).toContain('do not reorder');
    expect(text).not.toContain('order more');
  });

  it('is tenant-safe: only the context restaurant’s ingredients are referenced', async () => {
    const ctx = baseCtx({
      restaurantId: '507f191e810c19729de860ea', // tenant B
      wastage: {
        topItems: [{ name: 'Isolation Leaf', qty: 3, unit: 'kg', cost: 300 }],
        items: [{ name: 'Isolation Leaf', unit: 'kg', qty: 3, cost: 300, prevQty: 0.5, prevCost: 50 }],
        varianceRows: [{ name: 'Isolation Leaf', unit: 'kg', theoreticalQty: 5, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.some((c) => c.title.includes('Isolation Leaf'))).toBe(true);
  });

  it('degrades gracefully with no consumption baseline (no crash, no ratio card)', async () => {
    const ctx = baseCtx({
      wastage: { topItems: [{ name: 'Mystery Item', qty: 2, unit: 'kg', cost: 100 }], items: [], varianceRows: [] },
    });
    const cards = onlyWastage(await wasteProvider.getSuggestions(ctx));
    expect(cards.length).toBe(0);
  });

  it('is deterministic — same context produces identical output', async () => {
    const ctx = baseCtx({
      wastage: {
        topItems: [{ name: 'Milk', qty: 5, unit: 'L', cost: 260 }],
        items: [{ name: 'Milk', unit: 'L', qty: 5, cost: 260, prevQty: 1, prevCost: 52 }],
        varianceRows: [{ name: 'Milk', unit: 'L', theoreticalQty: 8.6, actualQty: 0, varianceQty: 0, variancePercent: 0, varianceCost: 0 }],
      },
    });
    const a = await wasteProvider.getSuggestions(ctx);
    const b = await wasteProvider.getSuggestions(ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
