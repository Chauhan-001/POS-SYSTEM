/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Engine — Deterministic recommendation engine that generates
 * proactive offer suggestions based on weather, festivals, inventory,
 * time, and business performance data. No AI calls for generation logic.
 * AI is used ONLY for creating attractive titles/descriptions/copy.
 *
 * Architecture:
 *   Rule Engine (current)
 *       ↓
 *   Future ML Engine (same interface)
 *       ↓
 *   Future AI Engine (same interface)
 *
 * All providers use the same RecommendationProvider interface.
 */

import { getUpcomingFestivals, isFestivalSeason } from './festivalService';
import type { OfferRecommendationSource } from '../models/Offer';

// ─── Interfaces ─────────────────────────────────────────────────

export interface RecommendationContext {
  restaurantId: string;
  /** Phase 9 — recommendation scope. 'branch' when branchId is set, else 'tenant'. */
  scope?: 'tenant' | 'branch';
  /** Phase 9 — branch this context is scoped to (only when scope = 'branch'). */
  branchId?: string;
  branchName?: string;
  weather?: {
    condition: string;
    temperature: number;
    city: string;
  };
  inventory?: Array<{
    id: string;
    name: string;
    category: string;
    currentStock: number;
    minStock: number;
    maxStock: number;
    unit: string;
    price: number;
    averageCost: number;
  }>;
  products?: Array<{
    id: string;
    name: string;
    category: string;
    price: number;
    gstPercent: number;
  }>;
  sales?: {
    dailyRevenue: number;
    weeklyRevenue: number;
    monthlyRevenue: number;
    orderCount: number;
    averageOrderValue: number;
    topCategories: Array<{ name: string; revenue: number; qty: number }>;
    weakCategories: Array<{ name: string; revenue: number; qty: number }>;
    weekdayPerformance: number[]; // revenue by day of week (0=Sun)
    hourlyPerformance: number[];  // revenue by hour (0-23)
  };
  customerCount: number;
  activeCustomers: number;
  newCustomersToday: number;
  repeatCustomersToday: number;
  /** Customers not seen in 30+ days (win-back audience). */
  dormant30d?: number;
  /** High-value loyal customers (e.g. 20+ visits, 500+ points). */
  vipCount?: number;
  /**
   * Phase 1/5 — deterministic customer segments (from the existing segment
   * engine's CustomerSegment records, tenant-scoped). Only id/name/count —
   * never customer PII. The LLM may reason over these exact segment
   * identities but must never invent new ones.
   */
  segments?: Array<{
    id: string;
    name: string;
    customerCount: number;
  }>;
  /**
   * Phase 1/4 — deterministic surplus inventory. Computed by the shared
   * context builder using the same overstock rule as the inventory provider
   * (maxStock > 0 AND currentStock >= maxStock × 0.8), with the conflict rule
   * that an item at/below minStock is NEVER surplus (low stock wins). The LLM
   * may only promote products explicitly listed here — it must never infer
   * surplus status on its own.
   */
  surplusStockItems?: Array<{
    productId: string;
    productName: string;
    category?: string;
    currentStock: number;
    maxStock: number;
    surplusQuantity: number;
    unit?: string;
    expiryRisk: boolean;
  }>;
  /**
   * Phase B — REAL historical offer performance (from OfferAnalytics). Only
   * sanitized tenant-scoped metrics (redemptions, revenue, discount, AOV,
   * unique customers, type/value) — never PII or raw customer data.
   */
  offerPerformance?: Array<{
    offerId: string;
    title?: string;
    type?: string;
    value?: number;
    redemptions: number;
    revenueGenerated: number;
    discountGiven: number;
    averageOrderValue: number;
    uniqueCustomers: number;
    /** P2 — deterministic combo-attributed economics (only present for combos). */
    comboUnits?: number;
    comboRevenue?: number;
    comboPrice?: number;
    comboOrders?: number;
    structuralSavings?: number;
    contributionMargin?: number | null;
    /**
     * Phase 6 — deterministic ESTIMATED contribution (recipe-cost economics)
     * attached for non-combo offers by the shared context builder. Currency
     * amount, advisory only — never the offer's true ledger contribution.
     */
    contribution?: number;
    /**
     * Phase 6 — deterministic estimated contribution MARGIN RATE (0..1) for
     * the same offers, so the ProvenOffer provider can apply the margin-aware
     * gate (only healthy economics get a "run it again" card), mirroring the
     * combo rule. Only present when recipe-cost economics were measured.
     */
    contributionMarginRate?: number;
  }>;
  /**
   * Margin-aware context (deterministic, from recipeCostEngine + real sales):
   * menu-product contribution margins and ingredient purchase-cost risers.
   * Used by the margin-safety provider to warn against discounting products
   * where the discount would destroy contribution.
   */
  margin?: {
    /** Menu products with an active recipe and real sales (last 60 days). */
    productMargins: Array<{
      productId: string;
      productName: string;
      category?: string;
      sellingPrice: number;
      recipeCost: number;
      foodCostPercent: number;
      contributionMarginPercent: number;
      unitsSold: number;
      totalContribution: number;
    }>;
    /** Ingredients whose weighted-average purchase cost rose meaningfully. */
    costRisers: Array<{
      itemId: string;
      name: string;
      unit?: string;
      currentCost: number;
      avgPurchaseCost?: number;
      previousAvgPurchaseCost?: number;
      pctChange?: number;
    }>;
    /**
     * Phase D — per-recipe margin deterioration (deterministic, recomputed by
     * the recipe cost engine at last period's purchase prices). One entry per
     * materially-affected menu product.
     */
    deterioratingProducts: Array<{
      productId: string;
      productName: string;
      recipeName?: string;
      category?: string;
      sellingPrice: number;
      previousRecipeCost: number;
      recipeCost: number;
      recipeCostDelta: number;
      recipeCostPct: number;
      previousContributionMarginPercent: number;
      contributionMarginPercent: number;
      marginDeltaPp: number;
      ingredientName: string;
      ingredientPreviousCost: number;
      ingredientCurrentCost: number;
      ingredientPctChange: number;
    }>;
  };
  /**
   * Wastage context (deterministic): recorded waste events plus theoretical vs
   * actual consumption variance per ingredient. Feeds the wastage provider that
   * flags abnormal waste-to-consumption ratios.
   */
  wastage?: {
    /** Ingredients with recorded waste events, by total cost (top first). */
    topItems: Array<{ name: string; qty: number; unit: string; cost: number }>;
    /**
     * Phase D — current-window waste plus the previous-window baseline per
     * ingredient, so spikes and repeated problems can be detected
     * deterministically.
     */
    items: Array<{ name: string; unit: string; qty: number; cost: number; prevQty: number; prevCost: number }>;
    /** Theoretical (recipe) vs actual (stock movement) consumption per item. */
    varianceRows: Array<{
      name: string;
      unit: string;
      theoreticalQty: number;
      actualQty: number;
      varianceQty: number;
      variancePercent: number;
      varianceCost: number;
    }>;
  };
}

export interface OfferSuggestion {
  title: string;
  type: string;
  value: number;
  description: string;
  recommendationSource: OfferRecommendationSource;
  recommendationReason: string;
  estimatedReach: number;
  expectedImpact: string;
  priority: 'high' | 'medium' | 'low';
  applicableCategories: string[];
  minOrderValue?: number;
  maxDiscount?: number;
  startHour?: number;
  endHour?: number;
  daysOfWeek?: number[];
  maxPerCustomer?: number;
  defaultDurationDays: number;
  /** Safety advisory — render as a warning, not a promotable offer. */
  isWarning?: boolean;
}

// ─── Recommendation Provider Interface ─────────────────────────

export interface RecommendationProvider {
  name: string;
  getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]>;
}

// ─── Weather-Based Recommendations ─────────────────────────────

const WEATHER_OFFER_MAP: Record<string, {
  items: string[];
  reason: string;
  offerType: string;
  defaultDiscount: number;
  audience: string;
}> = {
  rainy: {
    items: ['Tea', 'Coffee', 'Soup', 'Pakora', 'Samosa'],
    reason: 'Rain expected. Hot beverage and fried snack sales typically increase during rainy weather.',
    offerType: 'percentage',
    defaultDiscount: 15,
    audience: 'Tea & Coffee Lovers, Regular Customers',
  },
  cold: {
    items: ['Hot Chocolate', 'Coffee', 'Tea', 'Soup', 'Hot Toddy'],
    reason: 'Cold weather expected. Warm food and beverage sales increase in cold conditions.',
    offerType: 'percentage',
    defaultDiscount: 10,
    audience: 'Beverage Lovers, All Customers',
  },
  sunny: {
    items: ['Ice Cream', 'Cold Coffee', 'Fresh Juice', 'Milkshake', 'Smoothie'],
    reason: 'Hot sunny day expected. Cold treats and refreshing beverages are in high demand.',
    offerType: 'percentage',
    defaultDiscount: 20,
    audience: 'All Customers, Dessert Lovers',
  },
  foggy: {
    items: ['Tea', 'Coffee', 'Soup', 'Noodle Soup'],
    reason: 'Foggy conditions. Comfort food and hot beverages are preferred.',
    offerType: 'bogo',
    defaultDiscount: 0,
    audience: 'Regular Customers',
  },
  cloudy: {
    items: ['Pizza', 'Pasta', 'Comfort Food'],
    reason: 'Cloudy weather. Comfort food orders are likely to increase.',
    offerType: 'percentage',
    defaultDiscount: 10,
    audience: 'All Customers',
  },
};

class WeatherRecommendationProvider implements RecommendationProvider {
  name = 'weather';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.weather) return [];

    const condition = ctx.weather.condition.toLowerCase();
    const config = WEATHER_OFFER_MAP[condition];
    if (!config) return [];

    // Find matching products in the menu
    const matchingProducts = ctx.products?.filter(p =>
      config.items.some(item => p.name.toLowerCase().includes(item.toLowerCase()))
    ) || [];

    const applicableCategories = [...new Set(matchingProducts.map(p => p.category))];
    const itemNames = matchingProducts.map(p => p.name).slice(0, 5);

    return [{
      title: `${condition === 'rainy' ? 'Rainy Day' : condition === 'cold' ? 'Warm Up' : condition === 'sunny' ? 'Cool Down' : 'Weather'} Special`,
      type: config.offerType,
      value: config.defaultDiscount,
      description: itemNames.length > 0
        ? `Special offer on ${itemNames.join(', ')}${itemNames.length > 3 ? ' and more' : ''} — perfect for the ${condition} weather!`
        : `Special offer on ${config.items.slice(0, 3).join(', ')} — perfect for ${condition} days!`,
      recommendationSource: 'weather',
      recommendationReason: config.reason,
      estimatedReach: Math.round(ctx.customerCount * 0.6),
      expectedImpact: '15-25% increase in targeted item sales during weather window',
      priority: 'high',
      applicableCategories,
      defaultDurationDays: 1,
    }];
  }
}

// ─── Festival-Based Recommendations ──────────────────────────

class FestivalRecommendationProvider implements RecommendationProvider {
  name = 'festival';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const upcoming = getUpcomingFestivals(30);
    if (upcoming.length === 0) return [];

    // Surface the next TWO festivals so the owner can plan ahead. Dates come
    // from the exact festival table, so the day count is accurate.
    return upcoming.slice(0, 2).map((festival) => {
      const timing = festival.daysAway === 0 ? 'today' : `in ${festival.daysAway} day${festival.daysAway === 1 ? '' : 's'}`;
      const angle = festival.foodAngle ? ` — spotlight ${festival.foodAngle}` : '';
      return {
        title: `${festival.name} Special`,
        type: festival.recommendedOfferTypes[0] || 'percentage',
        value: 15,
        description: `Celebrate ${festival.name} (${festival.date}) with a special festive offer${angle}. Launching the offer now gives customers time to plan their visit.`,
        recommendationSource: 'festival',
        recommendationReason: `${festival.name} is on ${festival.date} (${timing}). Festival periods typically see a clear lift in dine-in and takeaway demand, so an offer launched ahead of the date captures the rush.`,
        estimatedReach: Math.round(ctx.customerCount * 0.8),
        expectedImpact: 'Higher orders during the festival window, driven by an early-launched offer',
        priority: festival.daysAway <= 3 ? 'high' : 'medium',
        applicableCategories: [],
        defaultDurationDays: festival.daysAway <= 3 ? 7 : 14,
      };
    });
  }
}

// ─── Inventory-Based Recommendations ─────────────────────────

class InventoryRecommendationProvider implements RecommendationProvider {
  name = 'inventory';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.inventory || ctx.inventory.length === 0) return [];
    const suggestions: OfferSuggestion[] = [];

    // Clearance: items with stock above 80% of maxStock.
    // One suggestion PER overstocked category (up to 3) so a large catalog
    // yields several distinct, actionable clearance cards instead of one
    // generic card — the restaurant can promote the exact category it
    // needs to move.
    const overstocked = ctx.inventory.filter(i =>
      i.maxStock > 0 && i.currentStock >= i.maxStock * 0.8
    );
    if (overstocked.length > 0) {
      const byCategory = new Map<string, typeof overstocked>();
      for (const item of overstocked) {
        const key = item.category || 'Inventory';
        const arr = byCategory.get(key);
        if (arr) arr.push(item); else byCategory.set(key, [item]);
      }
      const groups = [...byCategory.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 3);
      for (const [cat, items] of groups) {
        const names = items.slice(0, 3).map(i => i.name);
        suggestions.push({
          title: `${cat} Clearance Sale`,
          type: 'percentage',
          value: 20,
          description: `Clearing excess stock! Get 20% off on ${names.join(', ')}${items.length > 3 ? ` and ${items.length - 3} more items` : ''}. Help us reduce waste!`,
          recommendationSource: 'inventory_clearance',
          recommendationReason: `${items.length} ${cat} item(s) are above 80% stock levels. Promotional offers can reduce waste by 40%.`,
          estimatedReach: Math.round(ctx.customerCount * 0.4),
          expectedImpact: '35-45% reduction in overstock, waste cost savings',
          priority: 'medium',
          applicableCategories: [cat],
          defaultDurationDays: 5,
        });
      }
    }

    // Low stock protection: items at or below minStock
    const lowStock = ctx.inventory.filter(i => i.currentStock <= i.minStock && i.minStock > 0);
    if (lowStock.length > 0) {
      suggestions.push({
        title: 'Limited Stock Alert',
        type: 'flat',
        value: 50,
        description: `${lowStock.slice(0, 3).map(i => i.name).join(', ')} are selling fast! Order now before we run out. Flat Rs.50 off!`,
        recommendationSource: 'inventory_low_stock_protection',
        recommendationReason: `${lowStock.length} items are at minimum stock. Promote remaining stock before replenishment for higher margins.`,
        estimatedReach: Math.round(ctx.customerCount * 0.3),
        expectedImpact: 'Clear remaining stock at full margin before restocking',
        priority: 'low',
        applicableCategories: [...new Set(lowStock.map(i => i.category))],
        minOrderValue: 200,
        defaultDurationDays: 3,
      });
    }

    return suggestions;
  }
}

// ─── Margin Safety Recommendations ───────────────────────────
// Warning cards only — never promotable offers. The engine must not suggest
// discounts on products where contribution is already thin or ingredients
// just got more expensive (the discount would destroy margin).

export class MarginSafetyRecommendationProvider implements RecommendationProvider {
  name = 'margin_safety';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.margin) return [];
    const warnings: OfferSuggestion[] = [];

    // 1. Low-margin products — warn against aggressive discount.
    //    Thresholds: contribution margin < 25% OR food cost > 60%. Products
    //    without an active recipe have no tracked sales (unitsSold = 0) but
    //    may still be low-margin (averageCost/price), so an extreme food-cost
    //    signal alone is enough to warn.
    const lowMargin = (ctx.margin.productMargins || [])
      .filter(m => m.contributionMarginPercent < 25 || m.foodCostPercent > 60)
      .filter(m => m.unitsSold > 0 || m.foodCostPercent > 70)
      .sort((a, b) => a.contributionMarginPercent - b.contributionMarginPercent)
      .slice(0, 3);

    if (lowMargin.length > 0) {
      const names = lowMargin.map(m => m.productName).join(', ');
      const worst = lowMargin[0];
      warnings.push({
        title: `Hold discounts on ${names} — thin margin`,
        type: 'flat',
        value: 0,
        description: `${names} ${lowMargin.length === 1 ? 'has' : 'have'} a thin margin (food cost ${Math.round(worst.foodCostPercent)}% of price, contribution margin ${Math.round(worst.contributionMarginPercent)}%). A deep discount would leave little or no contribution.`,//
        recommendationSource: 'margin_protection',
        recommendationReason: `${worst.productName} contribution margin is ${Math.round(worst.contributionMarginPercent)}% (recipe cost ${worst.sellingPrice > 0 ? Math.round((worst.recipeCost / worst.sellingPrice) * 100) : '—'}% of ₹${Math.round(worst.sellingPrice)} price). Discounting below this would destroy contribution.`,
        estimatedReach: 0,
        expectedImpact: 'Protects contribution on low-margin items',
        priority: 'low',
        applicableCategories: lowMargin.map(m => m.category).filter((c): c is string => Boolean(c)),
        maxDiscount: Math.max(5, Math.round(worst.contributionMarginPercent / 2)),
        defaultDurationDays: 0,
        isWarning: true,
      });
    }

    // 2. Ingredients whose purchase cost rose sharply (>= 10%) — warn that
    //    recipe costs are rising and margins are under pressure.
    const costRisers = (ctx.margin.costRisers || [])
      .filter(c => c.pctChange !== undefined && c.pctChange >= 10)
      .sort((a, b) => (b.pctChange || 0) - (a.pctChange || 0))
      .slice(0, 3);

    if (costRisers.length > 0) {
      const names = costRisers.map(c => c.name).join(', ');
      const top = costRisers[0];
      warnings.push({
        title: `Ingredient costs rising — review margins`,
        type: 'flat',
        value: 0,
        description: `${names} ${costRisers.length === 1 ? 'got' : 'got'} more expensive recently (${top.name} up ${Math.round(top.pctChange || 0)}%). Recipes using these ingredients now cost more — avoid discounting those dishes until prices settle.`,
        recommendationSource: 'cost_increase_warning',
        recommendationReason: `${top.name} purchase cost rose ${Math.round(top.pctChange || 0)}% (₹${Math.round(top.previousAvgPurchaseCost || 0)} → ₹${Math.round(top.avgPurchaseCost || top.currentCost || 0)}). Rising ingredient costs squeeze contribution on every affected recipe.`,
        estimatedReach: 0,
        expectedImpact: 'Prevents margin erosion on cost-increased recipes',
        priority: 'low',
        applicableCategories: [],
        maxDiscount: 0,
        defaultDurationDays: 0,
        isWarning: true,
      });
    }

    // 3. Phase D — per-recipe margin deterioration. When a material ingredient
    //    cost rise has moved an actual recipe's contribution margin, surface
    //    the affected product with deterministic before/after numbers. Advisory
    //    only: the owner reviews pricing / discount exposure.
    const deteriorating = (ctx.margin.deterioratingProducts || [])
      .sort((a, b) => a.marginDeltaPp - b.marginDeltaPp)
      .slice(0, 3);
    for (const d of deteriorating) {
      warnings.push({
        title: `Margin deteriorated on ${d.productName} — review pricing`,
        type: 'flat',
        value: 0,
        description:
          `${d.ingredientName} cost rose ${Math.round(d.ingredientPctChange)}% (₹${Math.round(d.ingredientPreviousCost)} → ₹${Math.round(d.ingredientCurrentCost)}), raising ${d.productName}'s recipe cost from ₹${Math.round(d.previousRecipeCost)} to ₹${Math.round(d.recipeCost)} ` +
          `(${d.recipeCostDelta >= 0 ? '+' : ''}₹${Math.round(d.recipeCostDelta)}). Estimated contribution margin dropped from ${Math.round(d.previousContributionMarginPercent)}% to ${Math.round(d.contributionMarginPercent)}%. Review menu price, portion or discount exposure.`,
        recommendationSource: 'margin_deterioration',
        recommendationReason:
          `${d.ingredientName} cost increased ${Math.round(d.ingredientPctChange)}% (₹${Math.round(d.ingredientPreviousCost)}/unit → ₹${Math.round(d.ingredientCurrentCost)}/unit), which raised ${d.productName} recipe cost by ₹${Math.round(d.recipeCostDelta)} ` +
          `(₹${Math.round(d.previousRecipeCost)} → ₹${Math.round(d.recipeCost)}, ${d.recipeCostDelta >= 0 ? '+' : ''}${Math.round(d.recipeCostPct)}%) and cut contribution margin by ${Math.round(Math.abs(d.marginDeltaPp))} percentage points ` +
          `(${Math.round(d.previousContributionMarginPercent)}% → ${Math.round(d.contributionMarginPercent)}%). Do not discount this dish while costs are elevated — review pricing first.`,
        estimatedReach: 0,
        expectedImpact: 'Prevents margin erosion on cost-increased dishes',
        priority: 'low',
        applicableCategories: d.category ? [d.category] : [],
        maxDiscount: 0,
        defaultDurationDays: 0,
        isWarning: true,
      });
    }

    return warnings;
  }
}

// ─── Wastage Recommendations ────────────────────────────────
// Flags ingredients whose recorded waste is abnormal relative to consumption
// (or whose actual consumption far exceeds recipe-theoretical usage), and
// suggests investigation / portion / prep adjustments. Warning cards only.

export class WastageRecommendationProvider implements RecommendationProvider {
  name = 'wastage';

  /**
   * Phase D — deterministic thresholds (documented):
   *   - ratio:       waste >= 10% of recipe-theoretical consumption → abnormal
   *   - spike:       current waste >= 1.5× previous-window baseline AND the
   *                  excess (current − baseline) costs >= ₹200 at current
   *                  average cost → investigation card with excess economics
   *   - repeated:    previous window also elevated (>= 80% of current) AND the
   *                  ratio rule holds → stronger "repeatedly elevated" card
   *   - overstock:   an overstocked ingredient (currentStock > maxStock) that
   *                  also wastes materially gets operational guidance (reduce
   *                  purchases / improve utilization) — NEVER "order more"
   *   - normal waste: nothing is emitted (negative control)
   */
  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.wastage) return [];
    const warnings: OfferSuggestion[] = [];

    // Items may arrive as the rich Phase D shape ({ prevQty, prevCost }) or
    // the legacy topItems shape — support both so the provider stays
    // backward-compatible with older callers/tests.
    const wasteByName = new Map<string, { name: string; qty: number; unit: string; cost: number; prevQty: number; prevCost: number }>();
    for (const w of ctx.wastage.items || []) {
      wasteByName.set(String(w.name).toLowerCase(), { ...w, prevQty: w.prevQty || 0, prevCost: w.prevCost || 0 });
    }
    for (const w of ctx.wastage.topItems || []) {
      const key = String(w.name).toLowerCase();
      if (!wasteByName.has(key)) wasteByName.set(key, { ...w, prevQty: 0, prevCost: 0 });
    }
    const theoreticalByName = new Map<string, { theoreticalQty: number; actualQty: number; variancePercent: number; unit: string }>();
    for (const r of ctx.wastage.varianceRows || []) {
      theoreticalByName.set(String(r.name).toLowerCase(), r);
    }
    const inventoryByName = new Map<string, { currentStock: number; maxStock: number; unit: string }>();
    for (const i of ctx.inventory || []) {
      inventoryByName.set(String(i.name).toLowerCase(), { currentStock: i.currentStock || 0, maxStock: i.maxStock || 0, unit: i.unit });
    }

    const MIN_EXCESS_COST = 200; // ₹ — below this, a spike is not worth a card

    // ── 1. Abnormal waste (ratio rule), with baseline-aware classification ──
    const abnormal: Array<{
      name: string; wasteQty: number; unit: string; wasteCost: number; theoreticalQty: number; ratioPct: number;
      prevQty: number; excessQty: number; excessCost: number; kind: 'spike' | 'repeated' | 'abnormal'; overstock: boolean;
    }> = [];
    for (const [key, w] of wasteByName.entries()) {
      const theo = theoreticalByName.get(key);
      const theoreticalQty = theo?.theoreticalQty || 0;
      if (theoreticalQty <= 0) continue;
      const ratioPct = Math.round((w.qty / theoreticalQty) * 100);
      if (ratioPct < 10) continue;
      const unit = w.unit || theo?.unit || 'kg';
      const excessQty = Math.max(0, w.qty - w.prevQty);
      const avgCost = w.qty > 0 ? w.cost / w.qty : 0;
      const excessCost = Math.round(excessQty * avgCost);
      const inv = inventoryByName.get(key);
      const overstock = Boolean(inv && inv.maxStock > 0 && inv.currentStock > inv.maxStock);
      let kind: 'spike' | 'repeated' | 'abnormal' = 'abnormal';
      if (w.prevQty > 0) {
        if (w.qty >= w.prevQty * 1.5 && excessCost >= MIN_EXCESS_COST) kind = 'spike';
        else if (w.qty >= w.prevQty * 0.8) kind = 'repeated';
      }
      abnormal.push({ name: w.name, wasteQty: w.qty, unit, wasteCost: w.cost, theoreticalQty, ratioPct, prevQty: w.prevQty, excessQty: Math.round(excessQty * 10) / 10, excessCost, kind, overstock });
    }
    const kindOrder = { spike: 0, repeated: 1, abnormal: 2 };
    abnormal.sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || (b.ratioPct - a.ratioPct));
    for (const item of abnormal.slice(0, 4)) {
      if (item.kind === 'spike') {
        const guidance = item.overstock
          ? ' Stock is already above max — do NOT reorder until this clears; cut purchase frequency and review storage.'
          : '';
        warnings.push({
          title: `${item.name} waste spiked — investigate`,
          type: 'flat',
          value: 0,
          description: `${item.name} waste jumped from ${item.prevQty} ${item.unit} to ${item.wasteQty} ${item.unit} this period — ${item.excessQty} ${item.unit} of excess waste. Review receiving, storage and prep immediately.${guidance}`,
          recommendationSource: 'wastage_alert',
          recommendationReason: `Waste jumped from ${item.prevQty} ${item.unit} (baseline) to ${item.wasteQty} ${item.unit} (${item.ratioPct}% of recipe consumption) — approximately ${item.excessQty} ${item.unit} excess, worth about ₹${item.excessCost} at current cost.${item.overstock ? ' Overstocked as well — reducing purchases is the right lever, not reordering.' : ''}`,
          estimatedReach: 0,
          expectedImpact: `Excess waste costs ~₹${item.excessCost} this period — fixing it is direct margin recovery`,
          priority: 'low',
          applicableCategories: [],
          defaultDurationDays: 0,
          isWarning: true,
        });
      } else if (item.kind === 'repeated') {
        warnings.push({
          title: `${item.name} wastage repeatedly elevated`,
          type: 'flat',
          value: 0,
          description: `${item.name} waste stayed elevated again this period (${item.wasteQty} ${item.unit}, ${item.ratioPct}% of recipe consumption) — it was already high last period (${item.prevQty} ${item.unit}). This is a recurring problem, not a one-off: fix storage or prep permanently.${item.overstock ? ' Stock is above max — reduce purchase quantities while you fix this.' : ''}`,
          recommendationSource: 'wastage_alert',
          recommendationReason: `Repeated abnormal waste: ${item.prevQty} ${item.unit} last period → ${item.wasteQty} ${item.unit} this period (${item.ratioPct}% of consumption). Recurring waste means a process issue — investigate storage, portioning and purchase quantities.${item.overstock ? ' Overstocked as well — reducing purchases is the right lever, not reordering.' : ''}`,
          estimatedReach: 0,
          expectedImpact: 'Fixing a recurring waste pattern protects margin every period',
          priority: 'low',
          applicableCategories: [],
          defaultDurationDays: 0,
          isWarning: true,
        });
      } else {
        warnings.push({
          title: `${item.name} wastage unusually high`,
          type: 'flat',
          value: 0,
          description: `${item.wasteQty} ${item.unit} of ${item.name} was written off as waste — that's ${item.ratioPct}% of the ${item.theoreticalQty} ${item.unit} used in recipes. Review storage, receiving and prep portions.${item.overstock ? ' Stock is already above max — do NOT reorder until this clears; cut purchase frequency.' : ''}`,
          recommendationSource: 'wastage_alert',
          recommendationReason: `${item.wasteQty} ${item.unit} waste vs ${item.theoreticalQty} ${item.unit} consumed by recipes (${item.ratioPct}%). Normal waste should be under 10% — investigate storage conditions and prep handling.${item.overstock ? ' Overstocked as well — do not reorder; reduce purchase frequency and improve utilization.' : ''}`,
          estimatedReach: 0,
          expectedImpact: `₹${item.wasteCost.toFixed(0)} wasted — a 5% reduction in ${item.name} waste saves that much per period`,
          priority: 'low',
          applicableCategories: [],
          defaultDurationDays: 0,
          isWarning: true,
        });
      }
    }

    // ── 2. Actual consumption far exceeds theoretical (portion/prep drift) ──
    const drift = (ctx.wastage.varianceRows || [])
      .filter(r => r.theoreticalQty > 0 && r.variancePercent >= 15)
      .sort((a, b) => b.variancePercent - a.variancePercent)
      .slice(0, 3);
    for (const r of drift) {
      warnings.push({
        title: `${r.name} portions may be over-served`,
        type: 'flat',
        value: 0,
        description: `${r.actualQty} ${r.unit} of ${r.name} left stock but recipes only account for ${r.theoreticalQty} ${r.unit} — a ${r.variancePercent}% over-usage. Check portion sizes and prep waste.`,
        recommendationSource: 'wastage_alert',
        recommendationReason: `Actual consumption ${r.actualQty} ${r.unit} is ${r.variancePercent}% above recipe-theoretical ${r.theoreticalQty} ${r.unit}. Portion or prep drift leaks margin on every plate.`,
        estimatedReach: 0,
        expectedImpact: 'Closing the gap restores recipe margins directly',
        priority: 'low',
        applicableCategories: [],
        defaultDurationDays: 0,
        isWarning: true,
      });
    }

    return warnings;
  }
}

// ─── Time-Based Recommendations ─────────────────────────────

class TimeBasedRecommendationProvider implements RecommendationProvider {
  name = 'time_based';

  /**
   * Date-deterministic (not clock-deterministic): it suggests the UPCOMING
   * windows rather than only the one currently open, so the engine reliably
   * produces 10+ actionable cards without depending on the exact hour the
   * owner opens the screen.
   */
  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun
    const suggestions: OfferSuggestion[] = [];

    const isWeekday = currentDay >= 1 && currentDay <= 5;      // Mon-Fri
    const weekendSoon = currentDay === 4 || currentDay === 5 || currentDay === 6 || currentDay === 0; // Thu..Sun

    // Happy Hour (3 PM - 6 PM weekdays) — suggest on weekdays, not only during
    // the 3-hour window itself.
    if (isWeekday) {
      suggestions.push({
        title: 'Happy Hour!',
        type: 'percentage',
        value: 20,
        description: 'It\'s Happy Hour! Enjoy 20% off on all beverages and appetizers. Valid until 6 PM.',
        recommendationSource: 'time_based',
        recommendationReason: 'Happy Hour promotions increase footfall by 25-40% during slow afternoon hours.',
        estimatedReach: Math.round(ctx.customerCount * 0.5),
        expectedImpact: '25-40% increase in afternoon/early evening orders',
        priority: 'high',
        applicableCategories: ['Beverages', 'Appetizers', 'Starters'],
        startHour: 15,
        endHour: 18,
        daysOfWeek: [1, 2, 3, 4, 5],
        defaultDurationDays: 1,
      });
    }

    // Lunch Rush (11 AM - 2 PM)
    if (isWeekday || currentDay === 6) {
      suggestions.push({
        title: 'Lunch Special Combo',
        type: 'combo',
        value: 20,
        description: 'Quick lunch combo at 20% off! Perfect for your midday break. Includes main + beverage.',
        recommendationSource: 'time_based',
        recommendationReason: 'Lunch combos increase average order value by 15-20% during lunch rush.',
        estimatedReach: Math.round(ctx.customerCount * 0.6),
        expectedImpact: '15-20% increase in lunch-time average order value',
        priority: 'high',
        applicableCategories: ['Main Course', 'Beverages'],
        startHour: 11,
        endHour: 14,
        daysOfWeek: [1, 2, 3, 4, 5, 6],
        defaultDurationDays: 1,
      });
    }

    // Weekend Special (suggest from Thursday so the owner can schedule it)
    if (weekendSoon) {
      suggestions.push({
        title: 'Weekend Family Feast',
        type: 'percentage',
        value: 15,
        description: 'Weekend special! Bring the family and enjoy 15% off on orders above Rs.500. Perfect for a relaxed weekend meal.',
        recommendationSource: 'weekend',
        recommendationReason: 'Weekend family dining accounts for 40% of weekly revenue. Promotions increase party size by 2-3 guests.',
        estimatedReach: Math.round(ctx.customerCount * 0.7),
        expectedImpact: '20-30% increase in weekend revenue',
        priority: 'medium',
        applicableCategories: [],
        minOrderValue: 500,
        daysOfWeek: [5, 6, 0],
        defaultDurationDays: 3,
      });
    }

    // Late-night cravings (Fri/Sat nights)
    if (currentDay === 5 || currentDay === 6) {
      suggestions.push({
        title: 'Late Night Cravings',
        type: 'flat',
        value: 80,
        description: 'Late night munchies? Get Rs.80 off on orders above Rs.400 after 10 PM. Perfect for weekend cravings!',
        recommendationSource: 'time_based',
        recommendationReason: 'Late-night offers capture a high-margin, low-competition order window and lift weekend evening revenue.',
        estimatedReach: Math.round(ctx.customerCount * 0.45),
        expectedImpact: '15-25% lift in late-night weekend orders',
        priority: 'low',
        applicableCategories: [],
        minOrderValue: 400,
        startHour: 22,
        endHour: 2,
        daysOfWeek: [5, 6],
        defaultDurationDays: 2,
      });
    }

    return suggestions;
  }
}

// ─── Slow Day Recommendations (based on sales data) ──────────

class SlowDayRecommendationProvider implements RecommendationProvider {
  name = 'slow_day';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.sales) return [];

    const currentDay = new Date().getDay();
    const todayPerformance = ctx.sales.weekdayPerformance[currentDay] || 0;
    const avgPerformance = ctx.sales.weekdayPerformance.reduce((a, b) => a + b, 0) /
      ctx.sales.weekdayPerformance.filter(v => v > 0).length || 1;

    // If today is a historically weak day (less than 60% of average)
    if (todayPerformance < avgPerformance * 0.6) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return [{
        title: `${dayNames[currentDay]} Special Offer`,
        type: 'percentage',
        value: 25,
        description: `${dayNames[currentDay]} special! Get 25% off on all orders. Turn a quiet day into your best day!`,
        recommendationSource: 'slow_day',
        recommendationReason: `${dayNames[currentDay]} is historically ${Math.round((1 - todayPerformance / avgPerformance) * 100)}% below average. Promotions can recover 60-70% of the gap.`,
        estimatedReach: Math.round(ctx.customerCount * 0.5),
        expectedImpact: '60-70% recovery of revenue gap on historically slow day',
        priority: 'high',
        applicableCategories: [],
        minOrderValue: 200,
        daysOfWeek: [currentDay],
        defaultDurationDays: 1,
      }];
    }

    return [];
  }
}

// ─── Performance-Based Recommendations ──────────────────────

class PerformanceRecommendationProvider implements RecommendationProvider {
  name = 'performance';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.sales) return [];
    const suggestions: OfferSuggestion[] = [];

    // Weak category promotions — up to 2 so both slow movers surface.
    const weak = (ctx.sales.weakCategories || []).slice(0, 2);
    for (const w of weak) {
      suggestions.push({
        title: `${w.name} Flash Sale`,
        type: 'percentage',
        value: 20,
        description: `Give ${w.name} some love! Get 20% off on all ${w.name} items. Offer valid for limited time.`,
        recommendationSource: 'weak_category',
        recommendationReason: `${w.name} is underperforming at Rs.${w.revenue}. Targeted promotions can increase category sales by 25-40%.`,
        estimatedReach: Math.round(ctx.customerCount * 0.35),
        expectedImpact: '25-40% increase in targeted category sales',
        priority: 'medium',
        applicableCategories: [w.name],
        defaultDurationDays: 7,
      });
    }

    // Bestseller upsell — promote the strongest category at a higher minimum
    // order value to raise average basket size.
    const top = (ctx.sales.topCategories || [])[0];
    if (top && top.revenue > 0 && top.qty >= 10) {
      suggestions.push({
        title: `${top.name} Bestseller Deal`,
        type: 'flat',
        value: 100,
        description: `Love our ${top.name}? Get Rs.100 off when you spend Rs.600 or more — stock up on your favourites!`,
        recommendationSource: 'top_category',
        recommendationReason: `${top.name} is your top category (Rs.${top.revenue} in revenue). Upselling it lifts average order value with minimal risk.`,
        estimatedReach: Math.round(ctx.customerCount * 0.6),
        expectedImpact: '10-20% increase in average order value',
        priority: 'medium',
        applicableCategories: [top.name],
        minOrderValue: 600,
        defaultDurationDays: 7,
      });
    }

    return suggestions;
  }
}

// ─── Customer-Loyalty Based Recommendations ─────────────────

class CustomerLoyaltyRecommendationProvider implements RecommendationProvider {
  name = 'customer_loyalty';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const suggestions: OfferSuggestion[] = [];

    // First visit reward (always relevant for new customers)
    suggestions.push({
      title: 'Welcome Treat!',
      type: 'flat',
      value: 100,
      description: 'First time here? Welcome! Enjoy Rs.100 off on your first order above Rs.300. A treat from us to you!',
      recommendationSource: 'first_visit',
      recommendationReason: 'First-visit offers increase conversion by 40% and build initial loyalty.',
      estimatedReach: Math.max(Math.round(ctx.customerCount * 0.15), 10),
      expectedImpact: '40% increase in new customer conversion rate',
      priority: 'high',
      applicableCategories: [],
      minOrderValue: 300,
      maxPerCustomer: 1,
      defaultDurationDays: 30,
    });

    // Repeat customer offer
    suggestions.push({
      title: 'Come Back for More!',
      type: 'reward_points',
      value: 50,
      description: 'Earn double loyalty points on your next visit! Your next meal is on us — almost!',
      recommendationSource: 'repeat_customer',
      recommendationReason: 'Repeat customer offers increase retention by 25% and lifetime value by 35%.',
      estimatedReach: Math.round(ctx.repeatCustomersToday * 2),
      expectedImpact: '25% increase in customer retention rate',
      priority: 'medium',
      applicableCategories: [],
      defaultDurationDays: 14,
    });

    // High-value / VIP reward — protect your best customers
    if ((ctx.vipCount ?? 0) > 0) {
      suggestions.push({
        title: 'VIP Loyalty Reward',
        type: 'percentage',
        value: 10,
        description: 'A little thank you for our most loyal guests — enjoy 10% off your next order, no minimum spend required.',
        recommendationSource: 'vip_reward',
        recommendationReason: `${ctx.vipCount} high-value customers (20+ visits, 500+ points) deserve recognition. VIP rewards lift retention of your most profitable guests.`,
        estimatedReach: Math.round((ctx.vipCount || 0) * 1.2),
        expectedImpact: 'Higher retention and lifetime value among top customers',
        priority: 'medium',
        applicableCategories: [],
        maxPerCustomer: 1,
        defaultDurationDays: 14,
      });
    }

    // Dormant customer win-back
    if ((ctx.dormant30d ?? 0) > 0) {
      suggestions.push({
        title: 'Welcome Back!',
        type: 'flat',
        value: 100,
        description: 'We miss you! Enjoy Rs.100 off your next order above Rs.400. Come back and taste the difference.',
        recommendationSource: 'win_back',
        recommendationReason: `${ctx.dormant30d} customers haven't visited in 30+ days. Win-back offers recover 15-25% of dormant customers.`,
        estimatedReach: Math.round((ctx.dormant30d || 0) * 0.25),
        expectedImpact: '15-25% recovery of dormant customers',
        priority: 'medium',
        applicableCategories: [],
        minOrderValue: 400,
        maxPerCustomer: 1,
        defaultDurationDays: 21,
      });
    }

    return suggestions;
  }
}

// ─── Proven-Offer Recommendations (Phase B — analytics signal) ──
// Offers with real historical redemptions + revenue are the strongest signal
// a restaurant has: instead of guessing, "run it again" with the same type &
// value. Deterministic (sorted by revenue), advisory only.

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export class ProvenOfferRecommendationProvider implements RecommendationProvider {
  name = 'analytics_proven';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const perf = Array.isArray(ctx.offerPerformance) ? ctx.offerPerformance : [];
    if (perf.length === 0) return [];

    // Phase D (RULE 5): historical success must NOT override current
    // economics. If a product's margin just deteriorated materially, do not
    // blindly re-run a previously-successful offer whose theme targets it —
    // the margin_deterioration warning covers that product instead.
    const deterioratedNames = (ctx.margin?.deterioratingProducts || []).map((d) => String(d.productName || '').toLowerCase()).filter(Boolean);
    const themeTargetsDeteriorated = (title: string): boolean => {
      const words = String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
      if (words.length === 0) return false;
      return deterioratedNames.some((name) => words.some((w) => name.includes(w)));
    };

    // Only offers that actually redeemed enough to be meaningful, and only
    // types the engine can rebuild deterministically. Combos are handled
    // separately below — the whole-bill OfferAnalytics subtotal is NOT
    // combo-attributed revenue, so their economics come from the deterministic
    // combo analytics instead.
    //
    // Phase 6 — economic ranking, not revenue ranking: a high-revenue offer
    // with a heavy discount / poor estimated contribution must NOT outrank a
    // lower-revenue offer with strong contribution. Score is deterministic:
    //   score = netRevenue × (1 − discountRate) × confidence
    //   netRevenue  = revenueGenerated − discountGiven
    //   discountRate= discountGiven / revenueGenerated (0 when no revenue)
    //   confidence  = min(1, redemptions / 10)  — sample-size guard
    // When the context carries a deterministic estimated contribution (from
    // recipeCostEngine + profitabilityService), it takes priority over the
    // analytics-only approximation.
    //
    // Margin-aware gate (mirror of the combo rule): only offers whose
    // deterministic economics clear the healthy-margin floor get a repeat
    // card. An offer with recipe-cost economics measured below the floor is
    // deliberately NOT auto-recommended (its margin warning providers already
    // cover it) — exactly like a high-volume low-margin combo is not re-run.
    const proven = perf
      .filter((p) => p.redemptions >= 3 && p.revenueGenerated > 0 && p.type && p.type !== 'combo')
      .filter((p) => !themeTargetsDeteriorated(p.title || ''))
      .filter((p) => {
        if (typeof p.contributionMarginRate !== 'number') return true; // not measurable → discount-aware score guards it
        return p.contributionMarginRate >= PROVEN_OFFER_MARGIN_FLOOR;
      })
      .sort((a, b) => provenOfferEconomicScore(b) - provenOfferEconomicScore(a))
      .slice(0, 2);

    // P2 — bundle-margin-aware combo re-run. A combo is "proven" only when its
    // deterministic combo analytics show meaningful volume AND a healthy
    // contribution margin (thresholds reused from the HIGH_PERFORMER badge,
    // P2 §14 — never tuned per dataset). Sorted by margin, not redemptions: a
    // high-volume low-margin combo is deliberately NOT auto-recommended, so the
    // economics context survives (P2 §15).
    const comboRecs: OfferSuggestion[] = perf
      .filter((p) => p.type === 'combo')
      .filter(
        (p) =>
          Number(p.comboUnits) >= 10 &&
          Number(p.comboRevenue) > 0 &&
          typeof p.contributionMargin === 'number' &&
          p.contributionMargin >= 35,
      )
      .filter((p) => !themeTargetsDeteriorated(p.title || ''))
      .sort((a, b) => (b.contributionMargin ?? 0) - (a.contributionMargin ?? 0))
      .slice(0, 1)
      .map((p) => {
        const margin = Number(p.contributionMargin) || 0;
        const orders = Number(p.comboOrders) > 0 ? Number(p.comboOrders) : p.redemptions;
        return {
          title: `Run “${p.title || 'your top combo'}” again`,
          type: 'combo',
          value: Number(p.comboPrice) || 10,
          description:
            `${p.title || 'This combo'} moved ${p.comboUnits} combo sets across ${orders} orders, earning ` +
            `${fmtMoney(Number(p.comboRevenue))} in combo-attributed revenue at a ${margin.toFixed(1)}% contribution margin. ` +
            `Re-run it to keep that momentum going.`,
          recommendationSource: 'analytics_proven',
          recommendationReason:
            `Deterministic combo analytics show ${p.comboUnits} units, ${fmtMoney(Number(p.comboRevenue))} combo revenue, ` +
            `${fmtMoney(Number(p.structuralSavings))} structural bundle savings and a ${margin.toFixed(1)}% contribution margin. ` +
            `Healthy bundle economics make a repeat lower-risk than a new launch.`,
          estimatedReach: Math.max(Math.round(ctx.customerCount * 0.6), 50),
          expectedImpact: 'Maintain proven combo revenue — repeat of a demonstrated bundle performer',
          priority: 'high',
          applicableCategories: [],
          defaultDurationDays: 7,
        };
      });

    const regular: OfferSuggestion[] = proven.map((p) => {
      const aov = p.redemptions > 0 ? Math.round(p.revenueGenerated / p.redemptions) : 0;
      const marginNote = typeof p.contributionMarginRate === 'number'
        ? ` at ~${Math.round(p.contributionMarginRate * 100)}% estimated contribution margin`
        : '';
      return {
        title: `Run “${p.title || 'your top offer'}” again`,
        type: p.type as string,
        value: Number(p.value) || 10,
        description:
          `${p.title || 'This offer'} earned ${fmtMoney(p.revenueGenerated)} across ${p.redemptions} ` +
          `real redemptions (avg order ${fmtMoney(aov)})${marginNote}. Re-run it to keep that momentum going.`,
        recommendationSource: 'analytics_proven',
        recommendationReason:
          `Real performance data shows this offer delivered ${p.redemptions} redemptions and ` +
          `${fmtMoney(p.revenueGenerated)} in influenced revenue, with ${fmtMoney(p.discountGiven)} given as discount` +
          `${marginNote}. ` +
          (typeof p.contributionMarginRate === 'number'
            ? `Deterministic economics cleared the ${Math.round(PROVEN_OFFER_MARGIN_FLOOR * 100)}% healthy-margin floor, so a repeat is lower-risk than a new launch.`
            : `Its discount-aware economics still clear the repeat bar, so a repeat is lower-risk than a new launch.`),
        estimatedReach: Math.max(Math.round(ctx.customerCount * 0.6), 50),
        expectedImpact: 'Maintain proven revenue — a lower-risk repeat of a demonstrated performer',
        priority: 'high',
        applicableCategories: [],
        defaultDurationDays: 7,
      };
    });

    // Combo suggestions are advisory and deterministic — they never replace a
    // non-combo repeat offer, and they carry their own economic context.
    return [...comboRecs, ...regular];
  }
}

/**
 * Phase 6 — deterministic economic score for a proven non-combo offer.
 *
 * Replaces revenue-only ranking so a discount-heavy offer can't ride its raw
 * top line. Formula (documented, tested, no hidden weights):
 *
 *   score = netRevenue × (1 − discountRate) × confidence
 *
 *   netRevenue   = revenueGenerated − discountGiven   (money actually kept)
 *   discountRate = discountGiven / revenueGenerated    (0..1; penalizes deep
 *                  discounts even when net revenue is equal)
 *   confidence   = min(1, redemptions / 10)            (small samples count
 *                  for less; 3 redemptions ≈ 30% weight, 10+ = full)
 *
 * When the shared context builder attached a deterministic estimated
 * contribution (recipeCostEngine + profitabilityService), that value is the
 * authoritative sort key and the analytics approximation is ignored.
 */
export function provenOfferEconomicScore(p: {
  redemptions: number;
  revenueGenerated: number;
  discountGiven: number;
  contribution?: number | null;
}): number {
  const confidence = Math.min(1, Math.max(0, (Number(p.redemptions) || 0) / 10));
  if (typeof p.contribution === 'number' && Number.isFinite(p.contribution)) {
    // Contribution is the authoritative economics, but it must respect the SAME
    // sample-size guard as the approximation below — a 3-redemption fluke with
    // a big estimated contribution must not outrank a 40-redemption proven
    // offer (this is the non-combo mirror of the combo rule's units gate).
    return Math.max(0, p.contribution) * confidence;
  }
  const revenue = Math.max(0, Number(p.revenueGenerated) || 0);
  const discount = Math.max(0, Number(p.discountGiven) || 0);
  const netRevenue = Math.max(0, revenue - discount);
  const discountRate = revenue > 0 ? Math.min(1, discount / revenue) : 0;
  return netRevenue * (1 - discountRate) * confidence;
}

/**
 * Deterministic healthy-margin floor for "run it again" repeat cards
 * (non-combo mirror of the combo rule's margin-quality gate). Same 25%
 * contribution-margin floor the MarginSafety provider and combo-health
 * (THIN_MARGIN_PCT) treat as "healthy" — offers measured below it are
 * deliberately not auto-recommended; their margin warnings cover them.
 */
export const PROVEN_OFFER_MARGIN_FLOOR = 0.25;

// ─── Weak-Combo Advisories (Phase 12) ───────────────────────
// Deterministic combo economics only (OfferAnalytics combo rows carried in
// ctx.offerPerformance): a combo is never ranked by revenue alone. Warning
// cards only — the owner reviews/reprises through the existing offer editor.
// Evidence gate: combos with < 5 units are MONITOR, never an aggressive call.

export class WeakComboRecommendationProvider implements RecommendationProvider {
  name = 'weak_combo';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const combos = (ctx.offerPerformance || [])
      .filter((o: any) => o.type === 'combo' && o.comboUnits != null);
    if (combos.length === 0) return [];

    const warnings: OfferSuggestion[] = [];
    const risky = combos
      .map((c: any) => ({ c, margin: c.contributionMargin ?? null }))
      .sort((a: any, b: any) => (a.margin ?? 999) - (b.margin ?? 999));

    for (const { c } of risky.slice(0, 3)) {
      const units = Number(c.comboUnits) || 0;
      const margin = c.contributionMargin != null ? Number(c.contributionMargin) : null;
      const discountRate = Number(c.comboRevenue) > 0 ? (Number(c.structuralSavings) || 0) / Number(c.comboRevenue) : 0;
      const name = c.title || 'Combo';

      if (units < 5) {
        // 12.9 — insufficient evidence → monitor, never an aggressive call.
        warnings.push({
          title: `Combo ${name} — too little data to judge`,
          type: 'combo',
          value: 0,
          description: `${name} has only ${units} redemption${units === 1 ? '' : 's'} in the analytics window — not enough demand evidence to judge the bundle's economics yet. Keep monitoring.`,
          recommendationSource: 'combo_upsell',
          recommendationReason: `${name} sold ${units} units — below the ${5}-unit evidence floor. Monitoring only; no change recommended.`,
          estimatedReach: 0,
          expectedImpact: 'Avoids reworking a combo on thin evidence',
          priority: 'low',
          applicableCategories: [],
          maxDiscount: 0,
          defaultDurationDays: 0,
          isWarning: true,
        });
        continue;
      }

      if (margin !== null && margin < 10) {
        warnings.push({
          title: `Combo ${name} — economics broken, reprice or rework`,
          type: 'combo',
          value: 0,
          description: `${name} sells ${units} units but keeps only ${Math.round(margin)}% contribution margin${discountRate > 0.2 ? ` while giving up ${Math.round(discountRate * 100)}% of combo revenue as structural discount` : ''}. Raise the price or swap high-cost components before promoting it.`,
          recommendationSource: 'combo_upsell',
          recommendationReason: `Deterministic combo economics: margin ${Math.round(margin)}% (below the 10% floor), ${units} units, structural discount ${Math.round(discountRate * 100)}%.`,
          estimatedReach: 0,
          expectedImpact: 'Prevents promoting an economically broken bundle',
          priority: 'low',
          applicableCategories: [],
          maxDiscount: 0,
          defaultDurationDays: 0,
          isWarning: true,
        });
        continue;
      }

      if (discountRate > 0.2 && margin !== null && margin < 25) {
        warnings.push({
          title: `Combo ${name} — discount eroding margin`,
          type: 'combo',
          value: 0,
          description: `${name} gives up ${Math.round(discountRate * 100)}% of combo revenue as structural bundle discount while keeping only ${Math.round(margin)}% margin. Reduce the discount or reprice.`,
          recommendationSource: 'combo_upsell',
          recommendationReason: `Structural discount ${Math.round(discountRate * 100)}% with ${Math.round(margin)}% margin (below the 25% healthy floor).`,
          estimatedReach: 0,
          expectedImpact: 'Protects contribution on discounted bundles',
          priority: 'low',
          applicableCategories: [],
          maxDiscount: 0,
          defaultDurationDays: 0,
          isWarning: true,
        });
      }
    }
    return warnings;
  }
}

// ─── Engine — runs all providers ────────────────────────────

const ALL_PROVIDERS: RecommendationProvider[] = [
  new WeatherRecommendationProvider(),
  new FestivalRecommendationProvider(),
  new InventoryRecommendationProvider(),
  new MarginSafetyRecommendationProvider(),
  new WastageRecommendationProvider(),
  new TimeBasedRecommendationProvider(),
  new SlowDayRecommendationProvider(),
  new PerformanceRecommendationProvider(),
  new CustomerLoyaltyRecommendationProvider(),
  new ProvenOfferRecommendationProvider(),
  new WeakComboRecommendationProvider(),
];

/**
 * Generate offer recommendations based on all available context.
 * Runs all provider plugins, dedupes near-identical cards, and merges results
 * sorted by priority. `maxSuggestions` is a ceiling (default 10) — the engine
 * is designed to produce 10+ distinct suggestions when the restaurant has
 * real context (inventory, sales, customers, analytics).
 */
export async function generateRecommendations(
  ctx: RecommendationContext,
  maxSuggestions: number = 10,
): Promise<OfferSuggestion[]> {
  const all: OfferSuggestion[] = [];

  for (const provider of ALL_PROVIDERS) {
    try {
      const suggestions = await provider.getSuggestions(ctx);
      all.push(...suggestions);
    } catch (error: any) {
      console.error(`[OfferEngine] ${provider.name} failed:`, error.message);
    }
  }

  // Dedupe near-identical cards (same type + title + category list) so
  // provider expansion never floods the list with copies of the same idea.
  const seen = new Set<string>();
  const unique: OfferSuggestion[] = [];
  for (const s of all) {
    const key = `${s.type}|${s.title}|${(s.applicableCategories || []).join(',')}|${s.minOrderValue ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  // Sort by priority (high first), then by estimated reach
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  unique.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 99;
    const pb = priorityOrder[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.estimatedReach || 0) - (a.estimatedReach || 0);
  });

  return unique.slice(0, maxSuggestions);
}
