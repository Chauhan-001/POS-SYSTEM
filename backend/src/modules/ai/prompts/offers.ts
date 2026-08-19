/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Prompts — Template builder for AI-generated promotional offer suggestions.
 *
 * Phase 1: the prompt consumes the SAME canonical RecommendationContext the
 * deterministic offerEngine receives (built server-side in
 * src/services/recommendationContext.ts). The LLM never receives client-supplied
 * metrics, never computes financial values, and only reasons over the supplied
 * deterministic facts (revenue, inventory incl. surplus, margin, segments).
 */

import type { RecommendationContext } from '../../../services/offerEngine';

function fmtMoney(n: number): string {
  return `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
}

/**
 * Build the AI offer-suggestion prompt from the canonical context.
 * Financial values are FACTS: revenue, order count, AOV, surplus stock,
 * contribution margins, offer performance. The model's only job is to propose
 * promotion ideas (narrative/advisory) — it must never calculate or override
 * any of these numbers, and it must never infer surplus status on its own.
 */
export function buildOfferPrompt(ctx: RecommendationContext): string {
  const sales = ctx.sales;
  const topCats = (sales?.topCategories || [])
    .slice(0, 5)
    .map((c) => `  - ${c.name}: ${c.qty} sold, ${fmtMoney(c.revenue)}`)
    .join('\n');

  const weakCats = (sales?.weakCategories || [])
    .slice(0, 3)
    .map((c) => `  - ${c.name}: ${c.qty} sold, ${fmtMoney(c.revenue)}`)
    .join('\n');

  const lowStock = (ctx.inventory || [])
    .filter((i) => i.minStock > 0 && i.currentStock <= i.minStock)
    .slice(0, 5)
    .map((i) => `  - ${i.name}: ${i.currentStock}/${i.minStock} min`)
    .join('\n');

  // Phase 4 — ONLY products the deterministic layer identified as surplus,
  // ordered by surplus quantity so the most-promotable overstock leads.
  const surplus = (ctx.surplusStockItems || [])
    .slice()
    .sort((a, b) => b.surplusQuantity - a.surplusQuantity)
    .slice(0, 5)
    .map((i) => `  - ${i.productName}${i.category ? ` (${i.category})` : ''}: stock ${i.currentStock} of max ${i.maxStock}, surplus ~${i.surplusQuantity} ${i.unit || 'units'}${i.expiryRisk ? ', EXPIRY RISK' : ''}`)
    .join('\n');

  const segments = (ctx.segments || [])
    .slice(0, 8)
    .map((s) => `  - ${s.name}: ${s.customerCount} customers`)
    .join('\n');

  const offers = (ctx.offerPerformance || [])
    .filter((o) => o.redemptions > 0)
    .slice(0, 5)
    .map((o) => `  - ${o.title || 'Untitled'} (${o.type || '?'}): ${o.redemptions} redemptions, ${fmtMoney(o.revenueGenerated)} revenue, ${fmtMoney(o.discountGiven)} discount given${typeof o.contribution === 'number' ? `, ~${fmtMoney(o.contribution)} estimated contribution` : ''}${typeof o.contributionMargin === 'number' ? `, ~${Math.round(o.contributionMargin)}% contribution margin` : ''}`)
    .join('\n');

  // Phase 1 — deterministic margin warnings the model should not contradict.
  const thinMargin = (ctx.margin?.productMargins || [])
    .filter((m) => m.contributionMarginPercent < 25 || m.foodCostPercent > 60)
    .slice(0, 5)
    .map((m) => `  - ${m.productName}: ${Math.round(m.foodCostPercent)}% food cost, ~${Math.round(m.contributionMarginPercent)}% contribution margin`)
    .join('\n');

  // Phase 12/7 — deterministic wastage facts (same rows the Wastage provider
  // consumes). The LLM may frame clearance ONLY for items explicitly listed.
  const wastageItems = (ctx.wastage?.topItems || [])
    .slice(0, 5)
    .map((w) => `  - ${w.name}: ${w.qty} ${w.unit || 'units'} wasted, ${fmtMoney(w.cost)} cost`)
    .join('\n');
  const varianceRows = (ctx.wastage?.varianceRows || [])
    .slice(0, 3)
    .map((r) => `  - ${r.name}: ${Math.round(r.variancePercent)}% variance (${r.varianceQty} ${r.unit || 'units'}, ${fmtMoney(r.varianceCost)})`)
    .join('\n');

  // Deterministic margin TRENDS (marginDeterioration rows) + ingredient cost
  // risers — the same signals MarginSafety uses. The model may explain them,
  // never contradict or re-derive them.
  const deteriorating = (ctx.margin?.deterioratingProducts || [])
    .slice(0, 5)
    .map((d) => `  - ${d.productName}: margin ${Math.round(d.previousContributionMarginPercent)}% → ${Math.round(d.contributionMarginPercent)}% (${Math.round(d.marginDeltaPp)}pp)${d.recipeCostDelta ? `, recipe cost ${fmtMoney(d.previousRecipeCost)} → ${fmtMoney(d.recipeCost)}` : ''}${d.ingredientName ? ` (driven by ${d.ingredientName} +${Math.round(d.ingredientPctChange)}%)` : ''}`)
    .join('\n');

  const costRisers = (ctx.margin?.costRisers || [])
    .filter((c) => Number(c.pctChange) > 0)
    .slice(0, 5)
    .map((c) => `  - ${c.name}: +${Math.round(Number(c.pctChange))}% (${fmtMoney(Number(c.previousAvgPurchaseCost ?? c.currentCost))} → ${fmtMoney(Number(c.currentCost))})`)
    .join('\n');

  // Audience facts the loyalty providers use (win-back + VIP) — counts only.
  const dormantLine = typeof ctx.dormant30d === 'number' && ctx.dormant30d > 0
    ? `- Dormant customers (no visit in 30+ days): ${ctx.dormant30d} — win-back audience`
    : '';
  const vipLine = typeof ctx.vipCount === 'number' && ctx.vipCount > 0
    ? `- VIP loyal customers (20+ visits, 500+ points): ${ctx.vipCount}`
    : '';

  // Slow day/hour facts — the same deterministic signals the SlowDay and
  // TimeBased providers use for off-peak / slow-day offers.
  let slowFacts = '';
  if (sales?.weekdayPerformance && sales.weekdayPerformance.length === 7) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const minDay = sales.weekdayPerformance.indexOf(Math.min(...sales.weekdayPerformance));
    const slowestDay = days[Math.max(minDay, 0)];
    const hours = sales.hourlyPerformance || [];
    const minHour = hours.length ? hours.indexOf(Math.min(...hours)) : -1;
    slowFacts = `- Slowest day: ${slowestDay}${minHour >= 0 ? ` | slowest hour: ${minHour}:00–${minHour + 1}:00` : ''}`;
  }

  const weather = ctx.weather
    ? `- Current weather: ${ctx.weather.condition}, ${ctx.weather.temperature}°C`
    : '';

  const perfLine = sales
    ? `- Total revenue (30d): ${fmtMoney(sales.monthlyRevenue)} | Orders: ${sales.orderCount} | AOV: ${fmtMoney(sales.averageOrderValue)}`
    : '- No 30-day sales data yet.';

  return `You are an AI marketing strategist for a restaurant POS system. Propose promotional offer suggestions from the business data below. All numbers are authoritative facts computed by the system — never change, recalculate, or invent any of them.

TRUSTED BUSINESS FACTS:
${perfLine}
- Active customers: ${ctx.customerCount} | New today: ${ctx.newCustomersToday} | Repeat today: ${ctx.repeatCustomersToday}
${dormantLine}
${vipLine}

Top-selling categories:
${topCats || '  (no data)'}

Underperforming categories:
${weakCats || '  (no data)'}

Slow sales periods (deterministic — use these for off-peak / slow-day offers):
${slowFacts || '  (no period data)'}

Low-stock items (do NOT promote these — the system flags them as running out):
${lowStock || '  (none)'}

Surplus inventory (ONLY these products may be considered for excess-stock promotions — do NOT infer surplus for anything else, and never promote an item that appears in the low-stock list above):
${surplus || '  (none)'}

Customer segments (use these EXACT segment names when proposing an audience — never invent segments or audience sizes):
${segments || '  (no segments computed yet — assume everyone)'}

Historical offer performance (deterministic):
${offers || '  (no historical redemptions yet)'}

Products with thin margins (do NOT suggest deep discounts on these):
${thinMargin || '  (no thin-margin warnings)'}

Products with deteriorating margins (rising cost / falling margin — do NOT suggest deep discounts here; prefer portion or recipe-review framing):
${deteriorating || '  (no deterioration detected)'}

Ingredient cost risers (deterministic — do not promise price holds on dishes driven by these):
${costRisers || '  (no cost risers detected)'}

Wastage (deterministic — only these explicitly listed items may be framed as clearance offers; never suggest anything that would increase wastage):
${wastageItems || '  (no wastage data)'}${varianceRows ? `
  Usage variance (theoretical vs actual):
${varianceRows}` : ''}

${weather}

Respond with a JSON object containing exactly 3 actionable offer suggestions:
{
  "suggestions": [
    {
      "title": "Short offer name",
      "description": "One-line description of the offer",
      "type": "percentage|bogo|flat|combo|reward_points",
      "value": <number>,
      "reason": "Why this offer makes sense based ONLY on the data above",
      "targetCategory": "category name or 'All'",
      "estimatedImpact": "Expected impact on sales",
      "priority": "high|medium|low"
    }
  ],
  "summaryInsight": "One-line overall recommendation",
  "trendNote": "What the data suggests about current customer behavior"
}

RULES:
- Use only the facts above. Do not invent revenue, stock levels, margins, wastage, customer counts, or segments.
- Type "value" must respect the type: percentage ≤ 100; flat/cashback are currency amounts; combo is a price.
- Excess-stock promotions may only target products listed under Surplus inventory.
- Never suggest a discount on a low-stock, thin-margin, or deteriorating-margin product.
- Wastage items may only be promoted as clearance/leftover-reduction offers, and only if listed under Wastage.
- Use dormant/VIP audience counts exactly as provided; never inflate them.
- Slow-day / off-peak offers should reference the Slow sales periods facts.
- Be specific to the Indian restaurant context. Suggest offers that lift underperforming categories or leverage proven performers.`;
}
