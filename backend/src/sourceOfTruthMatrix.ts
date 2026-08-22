/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SourceOfTruthMatrix — Single authoritative system per business fact.
 *
 * No AI component should become an alternative source of truth.
 * Every business fact has ONE authoritative system.
 */

// Source of Truth Matrix — Phase 8
// This matrix defines the authoritative system for each business fact.
// AI may read/consume these facts but must never override or re-compute them.

export type BusinessFact =
  | 'product_price'
  | 'recipe_cost'
  | 'product_variant_cost'
  | 'stock_current'
  | 'stock_min'
  | 'stock_max'
  | 'product_margin'
  | 'product_food_cost_percent'
  | 'customer_lifetime_value'
  | 'customer_dormancy_days'
  | 'sales_revenue'
  | 'sales_order_count'
  | 'sales_aov'
  | 'sales_weekly_revenue'
  | 'sales_daily_revenue'
  | 'sales_weekday_performance'
  | 'sales_hourly_performance'
  | 'customer_segment'
  | 'offer_type'
  | 'offer_discount'
  | 'offer_minimum_order'
  | 'offer_maximum_uses'
  | 'offer_current_uses'
  | 'combo_component'
  | 'combo_price'
  | 'combo_discount'
  | 'combo_contribution_margin'
  | 'promotion_discount'
  | 'promotion_contribution'
  | 'promotion_expected_revenue'
  | 'promotion_expected_contribution'
  | 'promotion_confidence'
  | 'forecast_predicted_demand'
  | 'forecast_baseline'
  | 'forecast_trend'
  | 'forecast_seasonality'
  | 'forecast_confidence_score'
  | 'ai_recommendation'
  | 'ai_explanation';

export interface SourceOfTruthEntry {
  businessFact: BusinessFact;
  authoritativeSystem: string; // Service name or module name
  apiEndpoint?: string;
  description: string;
  lastUpdated?: string;
  version?: string;
}

/**
 * Source-of-Truth Matrix — definitive mapping of every business fact
 * to its authoritative system. AI must never override these.
 */
export const SOURCE_OF_TRUTH_MATRIX: SourceOfTruthEntry[] = [
  // Pricing & Cost
  {
    businessFact: 'product_price',
    authoritativeSystem: 'Pricing system',
    apiEndpoint: 'GET /products/:id',
    description: 'Menu product selling price. Determined by restaurant owner, not AI.',
  },
  {
    businessFact: 'recipe_cost',
    authoritativeSystem: 'Recipe/Cost engine',
    apiEndpoint: 'GET /recipes/:productId/cost',
    description: 'Recipe ingredient costs from the recipe cost engine. Single source of truth for all margin calculations.',
  },
  {
    businessFact: 'product_variant_cost',
    authoritativeSystem: 'Recipe/Cost engine',
    apiEndpoint: 'GET /product-variants/:variantId/cost',
    description: 'Per-variant recipe cost. Each variant (Size: Small/Medium/Large) has independent cost.',
  },
  {
    businessFact: 'product_margin',
    authoritativeSystem: 'Recipe/Cost engine → profitabilityService',
    apiEndpoint: 'GET /margin/product/:productId',
    description: 'Product contribution margin. Computed from recipe cost and selling price. Never computed by AI.',
  },
  {
    businessFact: 'product_food_cost_percent',
    authoritativeSystem: 'Recipe/Cost engine',
    apiEndpoint: 'GET /metrics/product-profitability',
    description: 'Food cost as percentage of selling price. From recipe cost engine, not AI.',
  },

  // Inventory
  {
    businessFact: 'stock_current',
    authoritativeSystem: 'Inventory engine',
    apiEndpoint: 'GET /inventory/current?productId=XXX',
    description: 'Current stock level. Real-time from inventory tracking. Never estimated by AI.',
  },
  {
    businessFact: 'stock_min',
    authoritativeSystem: 'Inventory engine',
    apiEndpoint: 'GET /inventory/min-max?productId=XXX',
    description: 'Minimum stock threshold. Configured by restaurant, used by all services.',
  },
  {
    businessFact: 'stock_max',
    authoritativeSystem: 'Inventory engine',
    apiEndpoint: 'GET /inventory/min-max?productId=XXX',
    description: 'Maximum stock ceiling. Configured by restaurant; surplus detected when current >= 80% of max.',
  },

  // Sales
  {
    businessFact: 'sales_revenue',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/revenue?restaurantId=XXX',
    description: 'Total revenue from bills. authoritative source is the billing database.',
  },
  {
    businessFact: 'sales_order_count',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/orders?restaurantId=XXX',
    description: 'Number of orders. From bill count, not AI estimate.',
  },
  {
    businessFact: 'sales_aov',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/aov?restaurantId=XXX',
    description: 'Average order value. Computed from bill totals / order count. Not AI-generated.',
  },
  {
    businessFact: 'sales_weekly_revenue',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/weekly?restaurantId=XXX',
    description: 'Weekly revenue aggregated from bills. Deterministic from database.',
  },
  {
    businessFact: 'sales_daily_revenue',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/daily?restaurantId=XXX',
    description: 'Today revenue from bills. Real-time from billing system.',
  },
  {
    businessFact: 'sales_weekday_performance',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/weekday-performance?restaurantId=XXX',
    description: 'Revenue by day of week (0=Sun..6=Sat). From bill aggregation, not AI.',
  },
  {
    businessFact: 'sales_hourly_performance',
    authoritativeSystem: 'Billing/Sales system',
    apiEndpoint: 'GET /sales/hourly?restaurantId=XXX',
    description: 'Revenue by hour (0-23). From bill aggregation, deterministic.',
  },

  // Customers
  {
    businessFact: 'customer_lifetime_value',
    authoritativeSystem: 'Customer segmentation service',
    apiEndpoint: 'GET /customers/lifetime-value?restaurantId=XXX',
    description: 'Customer lifetime value. From customer visit and spending history. Not AI-computed.',
  },
  {
    businessFact: 'customer_dormancy_days',
    authoritativeSystem: 'Customer segmentation service',
    apiEndpoint: 'GET /customers/dormancy?restaurantId=XXX',
    description: 'Days since last visit. From customer model lastVisit field. Deterministic.',
  },
  {
    businessFact: 'customer_segment',
    authoritativeSystem: 'Customer segmentation service',
    apiEndpoint: 'GET /customers/segments?restaurantId=XXX',
    description: 'Customer segments (id, name, customerCount). From CustomerSegment model. Tenant-scoped, aggregate only.',
  },

  // Offers
  {
    businessFact: 'offer_type',
    authoritativeSystem: 'Offer engine',
    apiEndpoint: 'GET /offers/:id',
    description: 'Offer type (percentage/flat/bogo/free_item/combo/cashback/reward_points/coupon/festival/referral/loyalty_bonus). From Offer model.',
  },
  {
    businessFact: 'offer_discount',
    authoritativeSystem: 'Offer engine',
    apiEndpoint: 'GET /offers/:id',
    description: 'Offer discount value. From Offer model.value field. Deterministic.',
  },
  {
    businessFact: 'offer_minimum_order',
    authoritativeSystem: 'Offer engine',
    apiEndpoint: 'GET /offers/:id',
    description: 'Offer minimum order value. From Offer model.minOrderValue field.',
  },
  {
    businessFact: 'offer_maximum_uses',
    authoritativeSystem: 'Offer engine',
    apiEndpoint: 'GET /offers/:id',
    description: 'Offer maximum uses. From Offer model.maxUses field.',
  },
  {
    businessFact: 'offer_current_uses',
    authoritativeSystem: 'Offer engine / Campaign execution',
    apiEndpoint: 'GET /offers/current-uses?offerId=XXX',
    description: 'Current number of times offer has been redeemed. Tracks currentUses. Real-time.',
  },

  // Combos
  {
    businessFact: 'combo_component',
    authoritativeSystem: 'Recommendation/combo engine',
    apiEndpoint: 'GET /combo/components?comboId=XXX',
    description: 'Combo component product IDs. From combo structure. Deterministic.',
  },
  {
    businessFact: 'combo_price',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/combo',
    description: 'Combo price after discount. Computed by promotion engine, not AI.',
  },
  {
    businessFact: 'combo_discount',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/combo',
    description: 'Combo discount percentage. Calculated by optimization engine using constraint bounds.',
  },
  {
    businessFact: 'combo_contribution_margin',
    authoritativeSystem: 'Promotion optimization service + recipe cost',
    apiEndpoint: 'POST /optimization/contribution',
    description: 'Combo contribution margin. Computed from component costs and combo price. Deterministic engine.',
  },

  // Promotions
  {
    businessFact: 'promotion_discount',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/promotion',
    description: 'Recommended discount percentage. From optimization engine with constraint validation.',
  },
  {
    businessFact: 'promotion_contribution',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/result',
    description: 'Expected incremental contribution. From promotion optimization financial calculation.',
  },
  {
    businessFact: 'promotion_expected_revenue',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/result',
    description: 'Expected incremental revenue. From promotion optimization scenario evaluation.',
  },
  {
    businessFact: 'promotion_confidence',
    authoritativeSystem: 'Promotion optimization service',
    apiEndpoint: 'POST /optimization/result',
    description: 'Confidence level (HIGH/MODERATE/LOW/INSUFFICIENT). From optimization confidence calculation.',
  },

  // Forecast
  {
    businessFact: 'forecast_predicted_demand',
    authoritativeSystem: 'Demand forecasting service',
    apiEndpoint: 'GET /forecast?entity=product&id=XXX',
    description: 'Predicted demand units. From statistical forecasting engine. Deterministic.',
  },
  {
    businessFact: 'forecast_baseline',
    authoritativeSystem: 'Demand forecasting service',
    apiEndpoint: 'GET /forecast?entity=product&id=XXX',
    description: 'Baseline demand (median of comparable periods). From forecasting engine.',
  },
  {
    businessFact: 'forecast_trend',
    authoritativeSystem: 'Demand forecasting service',
    apiEndpoint: 'GET /forecast?entity=product&id=XXX',
    description: 'Trend component. From forecasting engine linear regression.',
  },
  {
    businessFact: 'forecast_seasonality',
    authoritativeSystem: 'Demand forecasting service',
    apiEndpoint: 'GET /forecast?entity=product&id=XXX',
    description: 'Seasonality component. From weekly averages across years in forecasting engine.',
  },
  {
    businessFact: 'forecast_confidence_score',
    authoritativeSystem: 'Demand forecasting service',
    apiEndpoint: 'GET /forecast?entity=product&id=XXX',
    description: 'Confidence score 0-100. From forecasting data sufficiency and pattern reliability.',
  },

  // AI Advisor (consumes but does not override)
  {
    businessFact: 'ai_recommendation',
    authoritativeSystem: 'AI Advisor (read-only, deterministic fallback)',
    apiEndpoint: 'POST /advisor/chat',
    description: 'AI-generated recommendations. AI may propose but deterministic engine is authoritative. AI cannot modify financial truth.',
  },
  {
    businessFact: 'ai_explanation',
    authoritativeSystem: 'AI Advisor (enhancement only)',
    apiEndpoint: 'POST /advisor/enrich',
    description: 'AI-enhanced why/impact/risk text. Deterministic copy always preserved. AI never changes financial numbers.',
  },
];