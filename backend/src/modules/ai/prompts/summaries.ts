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
  const itemsPerOrder = sales.orderCount > 0 ? (sales.itemCount / sales.orderCount).toFixed(1) : '0';
  const discountPct = sales.totalRevenue > 0 ? ((sales.totalDiscount / sales.totalRevenue) * 100).toFixed(1) : '0';
  const top3 = sales.topItems.slice(0, 3);
  const top3Share = sales.totalRevenue > 0 && top3.length
    ? ((top3.reduce((s, i) => s + (i.revenue || 0), 0) / sales.totalRevenue) * 100).toFixed(0)
    : null;
  const paymentLines = sales.paymentMethods
    .map((p) => {
      const share = sales.totalRevenue > 0 ? ` (${((p.amount / sales.totalRevenue) * 100).toFixed(0)}% of revenue)` : '';
      return `${p.method}: ₹${p.amount}${share}`;
    })
    .join(', ');
  const categoryLines = [...sales.categoryBreakdown]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4)
    .map((c) => `${c.category} (${c.qty}x, ₹${c.revenue})`)
    .join(', ');

  return `You are an AI assistant for a restaurant POS system. Generate a brief, actionable daily business summary.

Today's sales data:
- Total revenue: ₹${sales.totalRevenue}
- Orders today: ${sales.orderCount}
- Items sold: ${sales.itemCount} (${itemsPerOrder} items per order)
- Average order value: ₹${sales.averageOrderValue}
- Total discounts given: ₹${sales.totalDiscount} (${discountPct}% of revenue)
- GST collected: ₹${sales.totalGst}

Top selling items: ${top3.map(i => `${i.name} (${i.qty}x, ₹${i.revenue})`).join(', ')}${top3Share ? ` — together ${top3Share}% of today's revenue` : ''}

Payment methods: ${paymentLines || 'None'}

Top categories: ${categoryLines || 'None'}

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

KEY INSIGHT RULE — the dashboard already shows today's revenue, order count and average order value as KPI cards, so the "keyInsight" MUST NOT merely restate those totals (e.g. "strong sales with 32 orders and ₹73,906.66 revenue"). Instead it must surface ONE specific derived finding from the data above, for example:
- A concentration risk: top 3 items drive a large share of revenue, or one payment method dominates
- An order-value signal: average order value vs items per order, or discount share of revenue
- A category or item trend worth acting on
- An operational risk: open orders, low stock items, or waste

Keep everything concise and actionable. Maximum 2 lines per item.

RULES:
- NEVER invent percentage changes, growth figures, or comparisons to yesterday/previous periods — no previous-period data was provided.
- NEVER state a single exact projected rupee amount. For "revenuePrediction", express a RANGE based on today's actual total (e.g. "₹70k–₹80k by close" when today's revenue is ₹73,906.66) — never a precise invented number.
- Only mention items, categories, and payment methods that appear in the data above.
- Base every statement strictly on the figures listed above.
- The "topPriority" and the "itemSuggestions" must be DIFFERENT, non-overlapping actions — do not re-list the same items in both.`;
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
