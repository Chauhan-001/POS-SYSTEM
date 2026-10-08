/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * businessSignals.test.ts — PHASE 3 canonical business-intelligence acceptance.
 *
 * Areas: normalization per dimension, confidence handling, freshness
 * classification (fresh/aging/stale/unknown), evidence refs, tenant/branch
 * scope propagation, malformed source data, missing source data, stale data,
 * and deterministic ordering.
 */

import { describe, it, expect } from 'vitest';

import {
  BUSINESS_SIGNAL_CODES,
  SIGNAL_CATEGORIES,
  businessSignalSchema,
  classifyFreshness,
  clamp01,
  directionFromChange,
  isUsableFreshness,
  makeSignalId,
  PERSISTED_SIGNAL_TYPE_MAP,
} from '../businessSignalTypes';
import {
  normalizeActiveOffers,
  normalizeCampaignPerformance,
  normalizeCompetitionContext,
  normalizeCustomerSegments,
  normalizeDemandForecast,
  normalizeExpiryRisk,
  normalizeFestivalContext,
  normalizeInventoryStatus,
  normalizeMarketBasket,
  normalizeMenuPerformance,
  normalizeOfferPerformance,
  normalizeProductMargins,
  normalizeRetentionSignals,
  normalizeSalesTrends,
  normalizeSportsContext,
  normalizeStockoutRisk,
  normalizeWeatherContext,
  OFFER_UNDERPERFORM_REDEMPTION_RATE,
} from '../businessSignalNormalizers';
import { businessInvestigationLines, businessInvestigationSummary } from '../businessIntelligenceService';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const NOW = Date.parse('2026-10-04T12:00:00.000Z');

const tenantInput = { restaurantId: A, branchId: null, now: NOW };
const branchInput = { restaurantId: A, branchId: BR_A1, now: NOW };

/** Every emitted signal must satisfy the canonical schema + scope rules. */
function expectCanonical(signals: unknown[], restaurantId: string, branchId: string | null) {
  for (const s of signals) {
    const parsed = businessSignalSchema.safeParse(s);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    const sig = s as { scope: { restaurantId: string; branchId: string | null; scope: string }; evidence: unknown[] };
    expect(sig.scope.restaurantId).toBe(restaurantId);
    expect(sig.scope.branchId).toBe(branchId);
    expect(sig.scope.scope).toBe(branchId ? 'branch' : 'tenant');
    expect(sig.evidence.length).toBeGreaterThan(0);
  }
}

describe('0. vocabulary and helpers', () => {
  it('exposes a stable canonical vocabulary with unique codes', () => {
    expect(new Set(BUSINESS_SIGNAL_CODES).size).toBe(BUSINESS_SIGNAL_CODES.length);
    expect(SIGNAL_CATEGORIES).toContain('sales');
    expect(PERSISTED_SIGNAL_TYPE_MAP.product_high_margin).toBeDefined();
  });

  it('classifies freshness relative to the expected window', () => {
    expect(classifyFreshness('2026-10-04T00:00:00.000Z', 7, NOW)).toBe('fresh');
    expect(classifyFreshness('2026-09-25T12:00:00.000Z', 7, NOW)).toBe('aging');
    expect(classifyFreshness('2026-08-01T12:00:00.000Z', 7, NOW)).toBe('stale');
    expect(classifyFreshness(undefined, 7, NOW)).toBe('unknown');
    expect(classifyFreshness('not-a-date', 7, NOW)).toBe('unknown');
    expect(isUsableFreshness('fresh')).toBe(true);
    expect(isUsableFreshness('stale')).toBe(false);
  });

  it('clamps confidence and derives direction deterministically', () => {
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(directionFromChange(0.01)).toBe('flat');
    expect(directionFromChange(0.4)).toBe('up');
    expect(directionFromChange(-0.4)).toBe('down');
    expect(directionFromChange(undefined)).toBe('unknown');
    expect(makeSignalId('product_high_margin', A, 'p1')).toBe(makeSignalId('product_high_margin', A, 'p1'));
  });
});

describe('1. sales normalization', () => {
  const base = {
    available: true,
    scope: 'tenant' as const,
    dailyRevenue: 45000,
    weeklyRevenue: 315000,
    monthlyRevenue: 1350000,
    orderCount: 320,
    averageOrderValue: 140.6,
    topCategories: [{ name: 'Mains', revenue: 200000, qty: 900 }],
    weakCategories: [{ name: 'Desserts', revenue: 8000, qty: 40 }],
    weekdayPerformance: [10, 20, 30, 40, 50, 60, 70],
    hourlyPerformance: Array.from({ length: 24 }, (_, h) => (h === 13 ? 5000 : h === 4 ? 5 : 100)),
    generatedAt: '2026-10-04T10:00:00.000Z',
  };

  it('emits revenue/AOV/weekday/hour/category signals with evidence and scope', () => {
    const r = normalizeSalesTrends(base, tenantInput);
    expect(r.status).toBe('ok');
    const codes = r.signals.map((s) => s.code);
    expect(codes).toContain('sales_revenue_level');
    expect(codes).toContain('sales_aov_level');
    expect(codes).toContain('sales_weekday_peak');
    expect(codes).toContain('sales_weekday_trough');
    expect(codes).toContain('sales_hour_peak');
    expect(codes).toContain('sales_category_strong');
    expect(codes).toContain('sales_category_weak');
    expectCanonical(r.signals, A, null);

    const peak = r.signals.find((s) => s.code === 'sales_weekday_peak')!;
    expect(peak.subject?.label).toBe('Saturday');
    expect(peak.value).toBe(70);
    const hour = r.signals.find((s) => s.code === 'sales_hour_peak')!;
    expect(hour.subject?.label).toBe('13:00');
  });

  it('propagates branch scope', () => {
    const r = normalizeSalesTrends(base, branchInput);
    expectCanonical(r.signals, A, BR_A1);
  });

  it('missing source data → unavailable with reason, never zeroes', () => {
    expect(normalizeSalesTrends(null, tenantInput)).toMatchObject({ status: 'unavailable', reason: 'NO_TOOL_OUTPUT' });
    const r = normalizeSalesTrends({ available: false, reason: 'NO_SALES_DATA' }, tenantInput);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_SALES_DATA');
    expect(r.signals).toHaveLength(0);
  });

  it('malformed source data degrades without throwing', () => {
    const r = normalizeSalesTrends(
      { available: true, weekdayPerformance: [1, 2], hourlyPerformance: 'nope', generatedAt: 'not-a-date' } as never,
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expectCanonical(r.signals, A, null);
    expect(r.signals.every((s) => s.freshness === 'unknown')).toBe(true);
  });

  it('D-22: a MISSING source timestamp stays unknown — never substituted with "now"', () => {
    const r = normalizeSalesTrends(
      { available: true, dailyRevenue: 1000, orderCount: 10, averageOrderValue: 100 } as never,
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals.length).toBeGreaterThan(0);
    // No fabricated freshness and no fabricated period window.
    expect(r.signals.every((s) => s.freshness === 'unknown')).toBe(true);
    expect(r.signals.every((s) => s.generatedAt === '')).toBe(true);
    expect(r.signals.every((s) => s.periodStart === undefined && s.periodEnd === undefined)).toBe(true);
  });

  it('stale source data is labelled stale', () => {
    const r = normalizeSalesTrends(
      { ...base, generatedAt: '2026-08-01T10:00:00.000Z' },
      tenantInput,
    );
    expect(r.signals.every((s) => s.freshness === 'stale')).toBe(true);
    const lines = businessInvestigationLines({
      signals: r.signals,
      dimensions: [],
      unavailableDimensions: [],
      toolErrors: [],
      freshness: { fresh: 0, aging: 0, stale: r.signals.length, unknown: 0, expired: 0 },
      topSignals: r.signals,
      generatedAt: new Date(NOW).toISOString(),
      usable: false,
    });
    expect(lines[0]).toContain('[STALE — do not treat as current]');
  });
});

describe('2. menu / product normalization', () => {
  const items = [
    { productId: 'p1', productName: 'Paneer Tikka', category: 'Starters', classification: 'STAR', contributionMarginPercent: 72, dailyUnits: 45, dailyRevenue: 9000, trend: 'growing', recommendedActions: [] },
    { productId: 'p2', productName: 'Cheesecake', category: 'Desserts', classification: 'DOG', contributionMarginPercent: 22, dailyUnits: 1, dailyRevenue: 200, trend: 'declining', recommendedActions: [] },
  ];

  it('maps classification/margin/trend into canonical product signals', () => {
    const r = normalizeMenuPerformance({ available: true, items, generatedAt: '2026-10-03T10:00:00.000Z' }, tenantInput);
    expect(r.status).toBe('ok');
    const codes = r.signals.map((s) => s.code);
    expect(codes).toContain('product_high_margin');
    expect(codes).toContain('product_high_demand');
    expect(codes).toContain('product_growing');
    expect(codes).toContain('product_low_margin');
    expect(codes).toContain('product_slow_moving');
    expect(codes).toContain('product_declining');
    expectCanonical(r.signals, A, null);
    expect(r.signals.every((s) => s.subject?.type === 'product')).toBe(true);
  });

  it('missing / empty item list → unavailable', () => {
    expect(normalizeMenuPerformance({ available: false, reason: 'NO_MENU_PERFORMANCE_DATA' }, tenantInput).status).toBe('unavailable');
    expect(normalizeMenuPerformance({ available: true, items: [] }, tenantInput).status).toBe('unavailable');
    expect(normalizeMenuPerformance(undefined, tenantInput).status).toBe('unavailable');
  });

  it('malformed item rows are tolerated', () => {
    const r = normalizeMenuPerformance(
      { available: true, items: [{ productId: 'x', productName: 'X' } as never], generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    // No numeric margin/units/trend → no signals emitted (never invented).
    expect(r.status).toBe('unavailable');
    expect(r.signals).toHaveLength(0);
  });
});

describe('3. margin normalization', () => {
  it('emits high/low margin signals from cost intelligence', () => {
    const r = normalizeProductMargins(
      {
        available: true,
        products: [
          { productId: 'p1', productName: 'Biryani', sellingPrice: 300, recipeCost: 90, foodCostPercent: 30, contributionMarginPercent: 70, unitsSold: 400, totalContribution: 84000 },
          { productId: 'p2', productName: 'Combo', sellingPrice: 200, recipeCost: 160, foodCostPercent: 80, contributionMarginPercent: 20, unitsSold: 150, totalContribution: 6000 },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals.map((s) => s.code).sort()).toEqual(['product_high_margin', 'product_low_margin']);
    expectCanonical(r.signals, A, null);
    expect(r.caveats.join(' ')).toContain('offer engine');
  });

  it('no extremes → unavailable (no invented mid-margin signals)', () => {
    const r = normalizeProductMargins(
      {
        available: true,
        products: [
          { productId: 'p1', productName: 'X', sellingPrice: 100, recipeCost: 60, foodCostPercent: 60, contributionMarginPercent: 40, unitsSold: 10, totalContribution: 400 },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_MARGIN_EXTREMES');
  });
});

describe('4. inventory normalization', () => {
  it('flags low stock and overstock with min/max baselines', () => {
    const r = normalizeInventoryStatus(
      {
        available: true,
        items: [
          { id: 'i1', name: 'Paneer', category: 'Dairy', currentStock: 2, minStock: 5, maxStock: 50, unit: 'kg', price: 400, averageCost: 320 },
          { id: 'i2', name: 'Flour', category: 'Staples', currentStock: 80, minStock: 10, maxStock: 60, unit: 'kg', price: 50, averageCost: 40 },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    const low = r.signals.find((s) => s.code === 'inventory_low')!;
    expect(low.baseline).toBe(5);
    expect(low.direction).toBe('down');
    expect(r.signals.find((s) => s.code === 'inventory_overstock')!.direction).toBe('up');
    expectCanonical(r.signals, A, null);
  });

  it('expiry alerts become inventory_expiring signals with severity confidence', () => {
    const r = normalizeExpiryRisk(
      {
        available: true,
        alerts: [
          { itemId: 'i1', itemName: 'Milk', currentStock: 12, daysUntilExpiry: 1, severity: 'critical', canPromote: true },
          { itemId: 'i2', itemName: 'Cream', currentStock: 4, daysUntilExpiry: 3, severity: 'warning', canPromote: false },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals).toHaveLength(2);
    expect(r.signals[0].confidence).toBeGreaterThan(r.signals[1].confidence);
    expect(r.signals[1].caveats?.join(' ')).toContain('not permitted');
    expectCanonical(r.signals, A, null);
  });

  it('stockout alerts become inventory_stockout_risk signals', () => {
    const r = normalizeStockoutRisk(
      {
        available: true,
        alerts: [{ itemId: 'i1', itemName: 'Paneer', currentStock: 3, daysUntilDepletion: 2, severity: 'critical', recommendedReorderQuantity: 20, contributingMenuItems: ['Paneer Tikka'] }],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].code).toBe('inventory_stockout_risk');
    expect(r.signals[0].value).toBe(2);
    expectCanonical(r.signals, A, null);
  });

  it('missing inventory data → unavailable for all three inventory normalizers', () => {
    expect(normalizeInventoryStatus({ available: false, reason: 'NO_INVENTORY_DATA' }, tenantInput).reason).toBe('NO_INVENTORY_DATA');
    expect(normalizeExpiryRisk({ available: false, reason: 'NO_EXPIRY_RISK' }, tenantInput).reason).toBe('NO_EXPIRY_RISK');
    expect(normalizeStockoutRisk({ available: false, reason: 'NO_STOCKOUT_RISK' }, tenantInput).reason).toBe('NO_STOCKOUT_RISK');
  });
});

describe('5. customer normalization', () => {
  it('emits segment presence signals with counts', () => {
    const r = normalizeCustomerSegments(
      { available: true, segments: [{ id: 's1', name: 'VIP', customerCount: 120 }], generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].subject).toMatchObject({ type: 'segment', id: 's1', label: 'VIP' });
    expect(r.signals[0].sampleSize).toBe(120);
    expectCanonical(r.signals, A, null);
  });

  it('retention summary produces inactive/high-value/at-risk signals', () => {
    const r = normalizeRetentionSignals(
      {
        available: true,
        summary: { totalCustomers: 1000, newCustomers: 50, activeCustomers: 600, inactiveCustomers: 300, highValueCustomers: 90, atRiskCustomers: 75, avgOrderValue: 150, avgVisitsPerCustomer: 3.2 },
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    const codes = r.signals.map((s) => s.code);
    expect(codes).toContain('customer_inactive_high');
    expect(codes).toContain('customer_high_value_present');
    expectCanonical(r.signals, A, null);
  });

  it('missing summary → unavailable (never fabricates counts)', () => {
    expect(normalizeRetentionSignals({ available: true }, tenantInput).status).toBe('unavailable');
  });
});

describe('6. marketing history normalization', () => {
  it('flags underperforming offers below the explicit threshold', () => {
    const r = normalizeOfferPerformance(
      {
        available: true,
        offers: [
          { offerId: 'o1', title: 'Weak Offer', redemptions: 1, revenueGenerated: 100, discountGiven: 50, averageOrderValue: 100, uniqueCustomers: 200, repeatCustomers: 0 },
          { offerId: 'o2', title: 'Good Offer', redemptions: 60, revenueGenerated: 9000, discountGiven: 900, averageOrderValue: 150, uniqueCustomers: 200, repeatCustomers: 10 },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].code).toBe('offer_underperforming');
    expect(r.signals[0].value).toBeLessThan(OFFER_UNDERPERFORM_REDEMPTION_RATE);
    expect(r.caveats.join(' ')).toContain('unique customers');
    expectCanonical(r.signals, A, null);
  });

  it('campaign performance emits effective/underperforming signals', () => {
    const r = normalizeCampaignPerformance(
      {
        available: true,
        campaigns: [
          { id: 'c1', channel: 'sms', recipientCount: 500, openedCount: 100, redeemedCount: 5, campaignCost: 200, status: 'sent' },
          { id: 'c2', channel: 'whatsapp', recipientCount: 500, openedCount: 300, redeemedCount: 120, campaignCost: 200, status: 'sent' },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    const codes = r.signals.map((s) => s.code);
    expect(codes).toContain('campaign_underperforming');
    expect(codes).toContain('campaign_effective');
    expectCanonical(r.signals, A, null);
  });

  it('active offers become offer_active context signals', () => {
    const r = normalizeActiveOffers(
      { available: true, offers: [{ id: 'o1', title: 'Lunch 10%', description: '', type: 'percentage', value: 10 }], generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].code).toBe('offer_active');
    expect(r.signals[0].confidence).toBeGreaterThan(0.5);
  });

  it('zero-recipient campaigns are skipped, not divided by zero', () => {
    const r = normalizeCampaignPerformance(
      { available: true, campaigns: [{ id: 'c1', channel: 'sms', recipientCount: 0, openedCount: 0, redeemedCount: 0, campaignCost: 0, status: 'draft' }], generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
  });
});

describe('7. demand / basket (ML) normalization', () => {
  it('demand forecast takes peak per product and honours model metadata', () => {
    const r = normalizeDemandForecast(
      {
        available: true,
        modelId: 'demand',
        modelVersion: 'v3',
        evaluationStatus: 'ok',
        freshnessAgeDays: 1,
        predictions: [
          { productId: 'p1', predictionFor: '2026-10-05', expected: 30, lower: 20, upper: 40, confidenceLevel: 'high', dataMode: 'live' },
          { productId: 'p1', predictionFor: '2026-10-06', expected: 55, lower: 40, upper: 70, confidenceLevel: 'high', dataMode: 'live' },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].value).toBe(55);
    expect(r.signals[0].freshness).toBe('fresh');
    expect(r.caveats.join(' ')).toContain('v3');
    expectCanonical(r.signals, A, null);
  });

  it('stale demand forecast reduces confidence and is labelled stale', () => {
    const r = normalizeDemandForecast(
      {
        available: true,
        freshnessAgeDays: 40,
        predictions: [{ productId: 'p1', predictionFor: '2026-10-05', expected: 30, lower: null, upper: null, confidenceLevel: null, dataMode: null }],
        generatedAt: '2026-08-01T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.signals[0].freshness).toBe('stale');
    expect(r.signals[0].confidence).toBeLessThan(0.5);
  });

  it('unavailable ML services degrade with the pipeline detail as reason', () => {
    const r = normalizeDemandForecast(
      { available: false, detail: 'Demand prediction store unavailable.', evaluationStatus: 'unknown' },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('unavailable');
    expect(r.signals).toHaveLength(0);
  });

  it('basket pairs report expected purchases honestly (no invented lift)', () => {
    const r = normalizeMarketBasket(
      {
        available: true,
        modelId: 'combo',
        modelVersion: 'v2',
        predictionSource: 'stored_predictions',
        signals: [
          { productAId: 'p1', productBId: 'p2', expectedPurchases7d: 25, estimatedFutureProfit: 4000, source: 'ml_prediction' },
        ],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].unit).toBe('purchases/7d');
    expect(r.signals[0].value).toBe(25);
    expect(r.signals[0].statement).not.toMatch(/lift/i);
    expectCanonical(r.signals, A, null);
  });

  it('manager-table pairs are disclosed as heuristic with lower confidence', () => {
    const r = normalizeMarketBasket(
      {
        available: true,
        predictionSource: 'manager_table',
        signals: [{ productAId: 'p1', productBId: 'p2', expectedPurchases7d: 10, estimatedFutureProfit: null, source: 'manager_table' }],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.signals[0].confidence).toBeLessThan(0.5);
    expect(r.signals[0].caveats?.join(' ')).toContain('not a model prediction');
  });
});

describe('8. context normalization', () => {
  it('festival context emits a fresh signal when close', () => {
    const r = normalizeFestivalContext(
      { available: true, nearest: { name: 'Diwali', daysAway: 3 }, generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].freshness).toBe('fresh');
    expect(r.signals[0].caveats?.join(' ')).toContain('not guaranteed');
    expectCanonical(r.signals, A, null);
  });

  it('sports context is neutral and never an offer trigger', () => {
    const r = normalizeSportsContext(
      { available: true, relevantMatches: [{ name: 'IND vs AUS', competition: 'ODI', localDateTime: '2026-10-04T18:00:00.000Z', relevance: 'high', timeWindow: 'currently_live' }], generatedAt: '2026-10-04T12:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].freshness).toBe('fresh');
    expect(r.signals[0].caveats?.join(' ')).toContain('never a reason');
  });

  it('competition context discloses stale provider data', () => {
    const r = normalizeCompetitionContext(
      {
        available: true,
        summary: { totalCompetitors: 12, nearestDistanceMeters: 350, density: 'high' },
        searchRadiusMeters: 2000,
        signals: [{ freshness: { status: 'stale' } }],
        generatedAt: '2026-10-04T00:00:00.000Z',
      },
      tenantInput,
    );
    expect(r.status).toBe('ok');
    expect(r.signals[0].freshness).toBe('stale');
    expect(r.signals[0].caveats?.join(' ')).toContain('never a claim about competitor performance');
  });

  it('weather emits nothing for unremarkable conditions', () => {
    const r = normalizeWeatherContext(
      { available: true, current: { condition: 'clear', temperatureC: 28, precipitationMm: 0 }, generatedAt: '2026-10-04T00:00:00.000Z' },
      tenantInput,
    );
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('NO_NOTABLE_WEATHER_SHIFT');
  });
});

describe('9. tenant isolation and scope safety', () => {
  it('signals never carry a restaurantId other than the authenticated tenant', () => {
    const rA = normalizeSalesTrends(
      { available: true, dailyRevenue: 100, orderCount: 5, generatedAt: '2026-10-04T00:00:00.000Z' },
      { restaurantId: A, now: NOW },
    );
    const rB = normalizeSalesTrends(
      { available: true, dailyRevenue: 100, orderCount: 5, generatedAt: '2026-10-04T00:00:00.000Z' },
      { restaurantId: B, now: NOW },
    );
    expect(rA.signals[0].scope.restaurantId).toBe(A);
    expect(rB.signals[0].scope.restaurantId).toBe(B);
    expect(rA.signals[0].signalId).not.toBe(rB.signals[0].signalId);
  });

  it('branch-scoped signals carry the branch and tenant scope only', () => {
    const r = normalizeInventoryStatus(
      { available: true, items: [{ id: 'i1', name: 'Milk', category: 'Dairy', currentStock: 1, minStock: 3, maxStock: 10, unit: 'L', price: 60, averageCost: 50 }], generatedAt: '2026-10-04T00:00:00.000Z' },
      branchInput,
    );
    expect(r.signals[0].scope).toEqual({ restaurantId: A, branchId: BR_A1, scope: 'branch' });
  });
});

describe('10. investigation summary helpers', () => {
  it('summarizes counts without leaking raw business data', () => {
    const summary = businessInvestigationSummary({
      signals: [],
      dimensions: [],
      unavailableDimensions: ['basket'],
      toolErrors: [{ tool: 'getMarketBasketSignals', code: 'TOOL_FAILED', message: 'x' }],
      freshness: { fresh: 0, aging: 0, stale: 0, unknown: 0, expired: 0 },
      topSignals: [],
      generatedAt: new Date(NOW).toISOString(),
      usable: false,
    });
    expect(summary).toEqual({
      signals: 0,
      usable: false,
      unavailableDimensions: ['basket'],
      toolErrors: 1,
      freshness: { fresh: 0, aging: 0, stale: 0, unknown: 0, expired: 0 },
    });
  });
});
