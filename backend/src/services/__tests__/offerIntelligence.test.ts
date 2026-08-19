/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Offer Intelligence — tests for Phases 1–6:
 *   Phase 1 — canonical RecommendationContext → AI prompt (same context as the
 *             deterministic engine, incl. segments + surplus)
 *   Phase 2 — ONE consolidated offer-copy LLM call (was five)
 *   Phase 3 — explicit AI cache busting (bustCache) with tenant-scoped cache
 *   Phase 4 — deterministic surplus inventory (conflict rule: low stock wins)
 *   Phase 5 — segment identities in recommendation context (no invented
 *             segments, no PII)
 *   Phase 6 — deterministic economic ranking for proven offers (not revenue)
 *
 * Financial truth is NEVER computed by the LLM in these tests — every number
 * arrives pre-computed from deterministic services and the prompts are
 * asserted to treat them as authoritative facts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks: LLM provider + AI-enabled flag (before importing modules) ──
const completeMock = vi.hoisted(() => vi.fn());
vi.mock('../../modules/ai/provider/llmProvider', () => ({
  complete: completeMock,
}));
vi.mock('../../modules/ai/config', () => ({
  isAiEnabled: vi.fn(() => true),
  aiConfig: { apiKeys: ['test-key'] },
}));

import { buildOfferPrompt } from '../../modules/ai/prompts/offers';
import { buildMarketingPrompt } from '../../modules/ai/prompts/marketing';
import { buildOfferCopyPrompt } from '../../modules/ai/prompts/offerCopy';
import { offerCopyOutputSchema, offerCopySchema, marketingGenerateSchema, offerRecommendationsSchema } from '../../modules/ai/validators/ai';
import { generateOfferCopy } from '../marketingService';
import { executeAiCall } from '../../modules/ai/services/aiService';
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

const TENANT_A = '507f1f77bcf86cd799439011';
const TENANT_B = '507f191e810c19729de860ea';

// ─── Phase 1 — unified RecommendationContext → AI prompt ──────────────

describe('Phase 1 — buildOfferPrompt consumes the canonical RecommendationContext', () => {
  it('includes sales, surplus, segments, offer performance and margin facts', () => {
    const ctx = baseCtx({
      sales: {
        dailyRevenue: 5000, weeklyRevenue: 35000, monthlyRevenue: 150000,
        orderCount: 300, averageOrderValue: 500,
        topCategories: [{ name: 'Starters', revenue: 60000, qty: 400 }],
        weakCategories: [{ name: 'Desserts', revenue: 8000, qty: 30 }],
        weekdayPerformance: new Array(7).fill(1000), hourlyPerformance: new Array(24).fill(100),
      },
      surplusStockItems: [
        { productId: 'p1', productName: 'Mango Pulp', category: 'Inventory', currentStock: 30, maxStock: 20, surplusQuantity: 14, unit: 'kg', expiryRisk: true },
      ],
      segments: [{ id: 's1', name: 'Dormant (30 Days)', customerCount: 94 }],
      offerPerformance: [
        { offerId: 'o1', title: 'Weekend Family Feast', type: 'percentage', value: 15, redemptions: 40, revenueGenerated: 40000, discountGiven: 6000, averageOrderValue: 1000, uniqueCustomers: 30 },
      ],
      margin: {
        // A THIN-margin product (food cost > 60%) — only these surface in the
        // prompt so the model never discounts a margin it would destroy.
        productMargins: [{ productId: 'p2', productName: 'Butter Chicken', sellingPrice: 299, recipeCost: 200, foodCostPercent: 67, contributionMarginPercent: 33, unitsSold: 50, totalContribution: 4950 }],
        costRisers: [], deterioratingProducts: [],
      },
    });
    const prompt = buildOfferPrompt(ctx);
    expect(prompt).toContain('Total revenue (30d): ₹1,50,000');
    expect(prompt).toContain('Mango Pulp');                 // surplus (Phase 4)
    expect(prompt).toContain('EXPIRY RISK');
    expect(prompt).toContain('Dormant (30 Days): 94 customers'); // segments (Phase 5)
    expect(prompt).toContain('Weekend Family Feast');       // offer performance
    expect(prompt).toContain('Butter Chicken');             // margin facts (thin-margin warning)
    expect(prompt).toContain('do NOT infer surplus');       // conflict rule wording
    expect(prompt).toContain('never invent segments');      // segment guard
  });

  it('explicitly forbids the LLM from inventing financial values', () => {
    const prompt = buildOfferPrompt(baseCtx());
    expect(prompt).toMatch(/never change, recalculate, or invent any of them/i);
    expect(prompt).toContain('Use only the facts above');
  });

  it('treats low-stock items as non-promotable and surplus must not contradict them', () => {
    const ctx = baseCtx({
      inventory: [{ id: 'i1', name: 'Paneer', category: 'Inventory', currentStock: 2, minStock: 5, maxStock: 20, unit: 'kg', price: 0, averageCost: 400 }],
      surplusStockItems: [], // derived surplus already excludes low-stock items
    });
    const prompt = buildOfferPrompt(ctx);
    expect(prompt).toContain('Paneer: 2/5 min');
    expect(prompt).toContain('do NOT promote these');
  });

  it('surfaces wastage, deteriorating margins, cost risers, offer economics, dormant/VIP and slow-period facts', () => {
    const ctx = baseCtx({
      sales: {
        dailyRevenue: 5000, weeklyRevenue: 35000, monthlyRevenue: 150000,
        orderCount: 300, averageOrderValue: 500,
        topCategories: [{ name: 'Starters', revenue: 60000, qty: 400 }],
        weakCategories: [{ name: 'Desserts', revenue: 8000, qty: 30 }],
        // Sunday = 800 (min) → slowest day; hour 3 (03:00) = 5 (min) → slowest hour.
        weekdayPerformance: [800, 5000, 5000, 5000, 5000, 6000, 7000],
        hourlyPerformance: [10, 10, 10, 5, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      },
      dormant30d: 42,
      vipCount: 7,
      offerPerformance: [
        // Phase 6 — deterministic estimated contribution rides along.
        { offerId: 'o1', title: 'Weekend Family Feast', type: 'percentage', value: 15, redemptions: 40, revenueGenerated: 40000, discountGiven: 6000, contribution: 18000, averageOrderValue: 1000, uniqueCustomers: 30 },
      ],
      margin: {
        productMargins: [{ productId: 'p2', productName: 'Butter Chicken', sellingPrice: 299, recipeCost: 200, foodCostPercent: 67, contributionMarginPercent: 33, unitsSold: 50, totalContribution: 4950 }],
        costRisers: [{ itemId: 'i9', name: 'Cooking Oil', currentCost: 130, previousAvgPurchaseCost: 110, avgPurchaseCost: 130, pctChange: 18.2 }],
        deterioratingProducts: [{
          productId: 'p3', productName: 'Veg Biryani', category: 'Main Course', sellingPrice: 199,
          previousRecipeCost: 90, recipeCost: 112, recipeCostDelta: 22, recipeCostPct: 24.4,
          previousContributionMarginPercent: 54.8, contributionMarginPercent: 43.7, marginDeltaPp: -11.1,
          ingredientName: 'Basmati Rice', ingredientPreviousCost: 120, ingredientCurrentCost: 160, ingredientPctChange: 33.3,
        }],
      },
      wastage: {
        topItems: [{ name: 'Milk', qty: 4, unit: 'L', cost: 240 }],
        items: [],
        varianceRows: [{ name: 'Paneer', unit: 'kg', theoreticalQty: 10, actualQty: 8, varianceQty: -2, variancePercent: 20, varianceCost: 800 }],
      },
    });
    const prompt = buildOfferPrompt(ctx);
    // Wastage facts + clearance-only framing.
    expect(prompt).toContain('Milk: 4 L wasted, ₹240 cost');
    expect(prompt).toContain('20% variance');
    expect(prompt).toMatch(/Wastage \(deterministic.*clearance offers/i);
    // Deteriorating margins + cost risers.
    expect(prompt).toContain('Veg Biryani: margin 55% → 44% (-11pp)');
    expect(prompt).toContain('Basmati Rice +33%');
    expect(prompt).toContain('Cooking Oil: +18% (₹110 → ₹130)');
    expect(prompt).toMatch(/deteriorating-margin product/);
    // Offer economics (Phase 6 contribution).
    expect(prompt).toContain('~₹18,000 estimated contribution');
    // Dormant / VIP audiences.
    expect(prompt).toContain('Dormant customers (no visit in 30+ days): 42 — win-back audience');
    expect(prompt).toContain('VIP loyal customers (20+ visits, 500+ points): 7');
    // Slow-period facts.
    expect(prompt).toContain('Slowest day: Sunday');
    expect(prompt).toContain('slowest hour: 3:00–4:00');
  });

  it('omits optional sections cleanly when absent (no fabricated numbers)', () => {
    const prompt = buildOfferPrompt(baseCtx());
    expect(prompt).toContain('(no data)');
    expect(prompt).toContain('(none)');
    expect(prompt).toContain('(no segments computed yet');
    expect(prompt).toContain('(no deterioration detected)');
    expect(prompt).toContain('(no cost risers detected)');
    expect(prompt).toContain('(no wastage data)');
    expect(prompt).toContain('(no period data)');
  });

  it('prioritizes the most-overstocked surplus items in the prompt', () => {
    const ctx = baseCtx({
      surplusStockItems: [
        { productId: 'p1', productName: 'Butter', category: 'Dairy', currentStock: 20, maxStock: 20, surplusQuantity: 4, unit: 'kg', expiryRisk: false },
        { productId: 'p2', productName: 'Paneer', category: 'Dairy', currentStock: 508, maxStock: 40, surplusQuantity: 476, unit: 'kg', expiryRisk: false },
        { productId: 'p3', productName: 'Milk', category: 'Dairy', currentStock: 100, maxStock: 60, surplusQuantity: 52, unit: 'L', expiryRisk: true },
      ],
    });
    const prompt = buildOfferPrompt(ctx);
    const pIndex = prompt.indexOf('Paneer');
    const mIndex = prompt.indexOf('Milk');
    const bIndex = prompt.indexOf('Butter');
    // Most-overstocked first: Paneer (476) before Milk (52) before Butter (4).
    expect(pIndex).toBeGreaterThan(-1);
    expect(pIndex).toBeLessThan(mIndex);
    expect(mIndex).toBeLessThan(bIndex);
  });
});

// ─── Phase 4b — surplus in the marketing-plan prompt ──────────────────

describe('Phase 4b — marketing prompt receives deterministic surplus, not just low stock', () => {
  const marketingCtx = (overrides: Record<string, any> = {}) => ({
    restaurantName: 'Demo Restaurant',
    city: 'Delhi',
    customerCount: 210,
    activeCustomers: 160,
    newCustomersToday: 4,
    dormant30d: 30,
    birthdaysThisWeek: 2,
    vipCount: 7,
    segments: [{ name: 'VIP', customerCount: 7 }],
    topCategories: ['Main Course', 'Beverages'],
    lowStockItems: ['Milk'],
    activeOffers: [],
    recentCampaigns: 0,
    festivals: [],
    ...overrides,
  });

  it('lists surplus items with the clearance-only framing', () => {
    const prompt = buildMarketingPrompt({ request: 'clear out excess stock' }, marketingCtx({
      surplusStockItems: [
        { productName: 'Paneer', category: 'Dairy', currentStock: 508, maxStock: 40, surplusQuantity: 476, unit: 'kg', expiryRisk: false },
      ],
    }));
    expect(prompt).toContain('Paneer');
    expect(prompt).toMatch(/ONLY these products may be proposed as excess-stock\/clearance promotions/i);
    expect(prompt).toMatch(/never propose clearing an item from the low-stock list/i);
  });

  it('says none when the deterministic layer found no surplus (never invents)', () => {
    const prompt = buildMarketingPrompt({ request: 'promote' }, marketingCtx({ surplusStockItems: [] }));
    expect(prompt).toMatch(/no deterministic surplus detected/i);
    // Milk is a known LOW-stock item here — it may appear as low stock, but no
    // product may be claimed surplus without the deterministic list.
    expect(prompt).not.toMatch(/Paneer|Butter/);
    expect(prompt).toMatch(/Low stock items \(do NOT propose clearing these\): Milk/);
  });
});

// ─── Phase 2 — one consolidated offer-copy LLM call ──────────────────

describe('Phase 2 — consolidated offer copy (5 → 1 LLM call)', () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  const copyInput = (reason: string) => ({
    type: 'percentage',
    value: 15,
    applicableCategories: ['Beverages'],
    targetAudience: 'all customers',
    // reason varies per test so the prompt hash differs — the AI cache is
    // module-level and shared within this file; a distinct prompt per test
    // keeps each scenario on its own cache path.
    reason,
    minOrderValue: 300,
    durationDays: 7,
    language: 'en' as const,
  });

  it('makes exactly ONE provider call for all five fields', async () => {
    completeMock.mockResolvedValue({
      content: JSON.stringify({
        title: 'Cool Down Summer',
        description: 'Enjoy 15% off beverages above Rs.300. A treat from us!',
        whatsapp: '🎉 Beat the heat! 15% OFF beverages above Rs.300. See you soon!',
        sms: '15% off beverages above Rs.300 at our restaurant today!',
        push: '15% off beverages! 🎉',
      }),
    });
    const result = await generateOfferCopy(TENANT_A, copyInput('happy-path'));
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.fallback).toBe(false);
    expect(result.title).toBe('Cool Down Summer');
    expect(result.description).toContain('15% off');
    expect(result.whatsapp).toContain('15% OFF');
    expect(result.sms).toContain('15%');
    expect(result.push).toContain('15%');
    // Deterministic email fields are still provided.
    expect(result.emailSubject).toBeTruthy();
    expect(result.emailBody).toBeTruthy();
  });

  it('falls back to deterministic templates on malformed LLM output', async () => {
    completeMock.mockResolvedValue({ content: 'not json at all' });
    const result = await generateOfferCopy(TENANT_A, copyInput('malformed-json'));
    expect(result.fallback).toBe(true);
    expect(result.title).toBeTruthy();
    expect(result.whatsapp).toContain('15% OFF');
  });

  it('falls back to deterministic templates on provider failure', async () => {
    completeMock.mockRejectedValue(new Error('provider down'));
    const result = await generateOfferCopy(TENANT_A, copyInput('provider-failure'));
    expect(result.fallback).toBe(true);
    expect(result.description).toContain('15%');
    expect(result.sms).toBeTruthy();
  });

  it('falls back to deterministic templates when a field is empty/invalid', async () => {
    completeMock.mockResolvedValue({
      content: JSON.stringify({ title: 'Only A Title' }), // missing the other four
    });
    const result = await generateOfferCopy(TENANT_A, copyInput('partial-output'));
    expect(result.fallback).toBe(true);
    // Missing fields come from the deterministic fallback, never blank.
    expect(result.whatsapp).toBeTruthy();
    expect(result.sms).toBeTruthy();
  });

  it('offerCopyOutputSchema validates a complete structured response and rejects partial ones', () => {
    const good = offerCopyOutputSchema.safeParse({
      title: 'T', description: 'D', whatsapp: 'W', sms: 'S', push: 'P',
    });
    expect(good.success).toBe(true);
    const bad = offerCopyOutputSchema.safeParse({ title: 'T' });
    expect(bad.success).toBe(false);
  });

  it('request schemas accept bustCache and reject unknown fields', () => {
    expect(offerCopySchema.safeParse({ type: 'percentage', value: 10, bustCache: true }).success).toBe(true);
    expect(marketingGenerateSchema.safeParse({ request: 'bring back customers', bustCache: true }).success).toBe(true);
    expect(offerRecommendationsSchema.safeParse({ bustCache: true }).success).toBe(true);
    expect(offerCopySchema.safeParse({ type: 'percentage', value: 10, nope: 1 }).success).toBe(false);
  });

  it('buildOfferCopyPrompt embeds the authoritative offer facts and forbids inventing values', () => {
    const prompt = buildOfferCopyPrompt(copyInput('prompt-check'));
    expect(prompt).toContain('15% OFF');
    expect(prompt).toContain('above Rs.300');
    expect(prompt).toContain('Beverages');
    expect(prompt).toMatch(/never change or invent these/i);
    expect(prompt).toMatch(/Do NOT invent prices, discount amounts, dates, availability/i);
  });
});

// ─── Phase 3 — explicit AI cache busting ─────────────────────────────

describe('Phase 3 — bustCache bypasses the AI cache and replaces it', () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it('serves a cached response on identical normal calls, and busts it on demand', async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify({ suggestions: [{ title: 'A', type: 'flat', value: 10 }] }) });
    const prompt = `phase3-test-${Date.now()}-${Math.random()}`;

    const first = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A });
    expect(first.cached).toBe(false);
    expect(completeMock).toHaveBeenCalledTimes(1);

    // Identical call (no bust) → cached, no second LLM call.
    const second = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A });
    expect(second.cached).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(1);

    // Explicit refresh → fresh LLM call, replaces the cached entry.
    const third = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A, bustCache: true });
    expect(third.cached).toBe(false);
    expect(completeMock).toHaveBeenCalledTimes(2);

    // The refreshed result is now the cached one for normal callers.
    const fourth = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A });
    expect(fourth.cached).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the AI cache tenant-scoped even when prompts are identical', async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify({ suggestions: [{ title: 'X', type: 'flat', value: 5 }] }) });
    const prompt = `phase3-tenant-${Date.now()}-${Math.random()}`;

    await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_A });
    // Same prompt, different tenant → must call the LLM again (no leak).
    const b = await executeAiCall({ prompt, feature: 'offers', tenantId: TENANT_B });
    expect(b.cached).toBe(false);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('normal callers are unaffected when caching is used (default behavior preserved)', async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify({ keyInsight: 'x', itemSuggestions: [], alerts: [] }) });
    const prompt = `phase3-default-${Date.now()}-${Math.random()}`;
    const a = await executeAiCall({ prompt, feature: 'summary', tenantId: TENANT_A });
    const b = await executeAiCall({ prompt, feature: 'summary', tenantId: TENANT_A });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(1);
  });
});

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

// ─── Phase 5 — segment identities in recommendation context ──────────

describe('Phase 5 — segments reach the recommendation layer (identities, not PII)', () => {
  it('segments are carried in the context and rendered with EXACT names + counts only', () => {
    const ctx = baseCtx({
      segments: [
        { id: 'seg-dormant', name: 'Dormant (30 Days)', customerCount: 94 },
        { id: 'seg-vip', name: 'VIP Customers', customerCount: 128 },
      ],
    });
    const prompt = buildOfferPrompt(ctx);
    expect(prompt).toContain('Dormant (30 Days): 94 customers');
    expect(prompt).toContain('VIP Customers: 128 customers');
    // No PII / raw customer data anywhere in the prompt.
    expect(prompt).not.toMatch(/phone|email|contact/i);
  });

  it('never lets the LLM invent a segment — the prompt restricts to supplied names', () => {
    const prompt = buildOfferPrompt(baseCtx({ segments: [{ id: 's1', name: 'Frequent Customers', customerCount: 40 }] }));
    expect(prompt).toContain('use these EXACT segment names');
    expect(prompt).toContain('never invent segments');
  });

  it('degrades to "assume everyone" when no segments exist', () => {
    const prompt = buildOfferPrompt(baseCtx({ segments: [] }));
    expect(prompt).toContain('assume everyone');
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
