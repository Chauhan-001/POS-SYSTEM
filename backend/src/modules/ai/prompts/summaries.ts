/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Summary Prompts — Template builders for daily and closing summaries.
 * Returns structured prompt messages ready for LLM consumption.
 *
 * SECURITY: These prompts NEVER include sensitive data.
 * Only sanitized, aggregated business metrics are included.
 */

import type { SanitizedSalesData } from '../types';

/**
 * Build prompt for the AI Daily Summary.
 * Used by the dashboard to show a morning briefing.
 */
export function buildDailySummaryPrompt(sales: SanitizedSalesData, extras: {
  lowStockCount: number;
  openOrderCount: number;
  wasteToday: number;
  customerCount: number;
}): string {
  return `You are an AI assistant for a restaurant POS system. Generate a brief, actionable daily business summary.

Today's sales data:
- Total revenue: ₹${sales.totalRevenue}
- Orders today: ${sales.orderCount}
- Items sold: ${sales.itemCount}
- Average order value: ₹${sales.averageOrderValue}
- Total discounts given: ₹${sales.totalDiscount}
- GST collected: ₹${sales.totalGst}

Top selling items: ${sales.topItems.slice(0, 3).map(i => `${i.name} (${i.qty}x)`).join(', ')}

Payment methods: ${sales.paymentMethods.map(p => `${p.method}: ₹${p.amount}`).join(', ')}

Additional context:
- Low stock items: ${extras.lowStockCount}
- Open/in-progress orders: ${extras.openOrderCount}
- Waste today: ₹${extras.wasteToday}
- Customers today: ${extras.customerCount}

Respond with a JSON object containing:
{
  "keyInsight": "One-line insight about today's performance",
  "topPriority": "Single most important action item right now",
  "revenuePrediction": "Revenue projection based on current pace",
  "itemSuggestions": ["2-3 brief suggestions for today"],
  "alerts": [
    { "message": "alert text", "severity": "info|warning|critical" }
  ]
}

Keep everything concise and actionable. Maximum 2 lines per item.`;
}

/**
 * Build prompt for the AI Closing Assistant.
 * Used after end-of-day Z-Report.
 */
export function buildClosingPrompt(
  totalRevenue: number,
  orderCount: number,
  lowStockItems: number,
  wasteCost: number,
): string {
  return `You are an AI assistant for a restaurant POS system. Generate an end-of-day closing summary.

Today's results:
- Total revenue: ₹${totalRevenue}
- Orders served: ${orderCount}
- Low stock items: ${lowStockItems}
- Waste cost: ₹${wasteCost}

Respond with a JSON object containing:
{
  "todaySummary": "Brief one-liner summarizing today",
  "tomorrowPrep": ["3 actionable preparation steps"],
  "inventoryHealthNote": "One-line inventory status",
  "itemsToOrder": ["items needing restock"],
  "potentialRisks": ["3 risk assessments, prefix ✅ or ⚠️"],
  "revenuePrediction": "Tomorrow's projected revenue range",
  "mood": "great|good|okay|needs_attention"
}

Keep items concise and specific to a restaurant context.`;
}
