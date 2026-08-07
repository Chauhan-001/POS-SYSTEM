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
    const upcoming = getUpcomingFestivals(14);
    if (upcoming.length === 0) return [];

    const festival = upcoming[0];

    return [{
      title: `${festival.name} Special`,
      type: festival.recommendedOfferTypes[0] || 'percentage',
      value: 15,
      description: `Celebrate ${festival.name} with our special festive offer! ${festival.description}. Limited time offer.`,
      recommendationSource: 'festival',
      recommendationReason: `${festival.name} is ${festival.daysAway === 0 ? 'today' : `in ${festival.daysAway} days`}. Festival seasons drive 30-50% higher footfall.`,
      estimatedReach: Math.round(ctx.customerCount * 0.8),
      expectedImpact: '30-50% increase in orders during festival period',
      priority: festival.daysAway <= 3 ? 'high' : 'medium',
      applicableCategories: [],
      defaultDurationDays: festival.daysAway <= 3 ? 7 : 14,
    }];
  }
}

// ─── Inventory-Based Recommendations ─────────────────────────

class InventoryRecommendationProvider implements RecommendationProvider {
  name = 'inventory';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    if (!ctx.inventory || ctx.inventory.length === 0) return [];
    const suggestions: OfferSuggestion[] = [];

    // Clearance: items with stock above 80% of maxStock
    const overstocked = ctx.inventory.filter(i =>
      i.maxStock > 0 && i.currentStock >= i.maxStock * 0.8
    );
    if (overstocked.length > 0) {
      const productNames = overstocked.slice(0, 3).map(i => i.name);
      suggestions.push({
        title: 'Overstock Clearance Sale',
        type: 'percentage',
        value: 20,
        description: `Clearing excess stock! Get 20% off on ${productNames.join(', ')}${overstocked.length > 3 ? ` and ${overstocked.length - 3} more items` : ''}. Help us reduce waste!`,
        recommendationSource: 'inventory_clearance',
        recommendationReason: `${overstocked.length} items have over 80% stock levels. Promotional offers can reduce waste by 40%.`,
        estimatedReach: Math.round(ctx.customerCount * 0.4),
        expectedImpact: '35-45% reduction in overstock, waste cost savings',
        priority: 'medium',
        applicableCategories: [...new Set(overstocked.map(i => i.category))],
        defaultDurationDays: 5,
      });
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

// ─── Time-Based Recommendations ─────────────────────────────

class TimeBasedRecommendationProvider implements RecommendationProvider {
  name = 'time_based';

  async getSuggestions(ctx: RecommendationContext): Promise<OfferSuggestion[]> {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay(); // 0=Sun
    const suggestions: OfferSuggestion[] = [];

    // Happy Hour (3 PM - 6 PM weekdays)
    if (currentHour >= 15 && currentHour < 18 && currentDay >= 1 && currentDay <= 5) {
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
    if (currentHour >= 11 && currentHour < 14) {
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

    // Weekend Special
    if (currentDay === 5 || currentDay === 6 || currentDay === 0) {
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

    // Weak category promotion
    if (ctx.sales.weakCategories.length > 0) {
      const weak = ctx.sales.weakCategories[0];
      suggestions.push({
        title: `${weak.name} Flash Sale`,
        type: 'percentage',
        value: 20,
        description: `Give ${weak.name} some love! Get 20% off on all ${weak.name} items. Offer valid for limited time.`,
        recommendationSource: 'weak_category',
        recommendationReason: `${weak.name} is underperforming at Rs.${weak.revenue}. Targeted promotions can increase category sales by 25-40%.`,
        estimatedReach: Math.round(ctx.customerCount * 0.35),
        expectedImpact: '25-40% increase in targeted category sales',
        priority: 'medium',
        applicableCategories: [weak.name],
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

    return suggestions;
  }
}

// ─── Engine — runs all providers ────────────────────────────

const ALL_PROVIDERS: RecommendationProvider[] = [
  new WeatherRecommendationProvider(),
  new FestivalRecommendationProvider(),
  new InventoryRecommendationProvider(),
  new TimeBasedRecommendationProvider(),
  new SlowDayRecommendationProvider(),
  new PerformanceRecommendationProvider(),
  new CustomerLoyaltyRecommendationProvider(),
];

/**
 * Generate offer recommendations based on all available context.
 * Runs all provider plugins and merges results sorted by priority.
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

  // Sort by priority (high first), then by estimated reach
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  all.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 99;
    const pb = priorityOrder[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.estimatedReach || 0) - (a.estimatedReach || 0);
  });

  return all.slice(0, maxSuggestions);
}
