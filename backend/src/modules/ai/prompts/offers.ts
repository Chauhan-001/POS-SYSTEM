/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Prompts — Template builder for AI-generated promotional offer suggestions.
 * Uses sales trends, inventory data, and weather to suggest relevant promotions.
 */

export interface OfferSuggestionInput {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  topSellingCategories: { name: string; qty: number; revenue: number }[];
  lowStockItems: { name: string; currentStock: number; minStock: number }[];
  currentOffers: string[];
  customerCount: number;
  weather?: { condition: string; temperature: number };
}

export function buildOfferPrompt(input: OfferSuggestionInput): string {
  const topCats = input.topSellingCategories
    .slice(0, 5)
    .map(c => `  - ${c.name}: ${c.qty} sold, Rs.${c.revenue}`)
    .join('\n');

  const lowStock = input.lowStockItems
    .slice(0, 5)
    .map(i => `  - ${i.name}: ${i.currentStock}/${i.minStock} min`)
    .join('\n');

  const offers = input.currentOffers.length > 0
    ? input.currentOffers.map(o => `  - ${o}`).join('\n')
    : '  (none active)';

  const weather = input.weather
    ? `- Current weather: ${input.weather.condition}, ${input.weather.temperature}°C`
    : '';

  return `You are an AI marketing strategist for a restaurant POS system. Generate promotional offer suggestions based on the following business data.

Current business metrics:
- Total revenue: Rs.${input.totalRevenue}
- Orders: ${input.orderCount}
- Average order value: Rs.${input.averageOrderValue}
- Active customers today: ${input.customerCount}

Top-selling categories:
${topCats}

Low stock items (consider promoting excess stock):
${lowStock || '  (none)'}

Current active offers:
${offers}
${weather}

Respond with a JSON object containing 3 actionable offer suggestions:
{
  "suggestions": [
    {
      "title": "Short offer name",
      "description": "One-line description of the offer",
      "type": "percentage|bogo|flat",
      "value": <number>,
      "reason": "Why this offer makes sense based on the data",
      "targetCategory": "category name or 'All'",
      "estimatedImpact": "Expected impact on sales",
      "priority": "high|medium|low"
    }
  ],
  "summaryInsight": "One-line overall recommendation",
  "trendNote": "What the data suggests about current customer behavior"
}

Be specific to Indian restaurant context. Suggest offers that drive sales for underperforming categories or leverage top sellers. If weather data is available, suggest weather-appropriate offers.`;
}
