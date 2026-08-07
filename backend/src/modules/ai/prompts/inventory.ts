/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Prompts — Template builders for inventory health,
 * purchase recommendations, low stock predictions, and waste analysis.
 */

import type { SanitizedInventoryItem, SanitizedWasteEntry } from '../types';

export function buildHealthPrompt(items: SanitizedInventoryItem[], wasteTotal: number): string {
  const itemLines = items.map(i =>
    `${i.name} (${i.category}): stock=${i.currentStock}${i.unit}, min=${i.minStock}, max=${i.maxStock}, status=${i.status}${i.expiryDate ? `, expires=${i.expiryDate}` : ''}`
  ).join('\n');

  return `You are an AI inventory analyst for a restaurant. Analyze the following inventory data:

Items:
${itemLines}

Total waste cost this period: ₹${wasteTotal}

Respond with a JSON object containing:
{
  "overall": <number 0-100 indicating overall health>,
  "stockHealth": <number 0-100>,
  "wasteRate": <number 0-100>,
  "expiryRisk": <number 0-100>,
  "trend": "improving|stable|declining",
  "recommendations": ["2-3 actionable recommendations"]
}

Base the scores on stock levels relative to min/max, expiry dates, and waste.`;
}

export function buildPurchaseRecPrompt(items: SanitizedInventoryItem[]): string {
  const lowItems = items.filter(i => i.status === 'low' || i.status === 'critical');
  const itemLines = lowItems.map(i =>
    `${i.name}: stock=${i.currentStock}${i.unit}, min=${i.minStock}, max=${i.maxStock}, cost=₹${i.averageCost}/${i.unit}`
  ).join('\n');

  return `You are an AI purchasing assistant for a restaurant. Recommend restock quantities for low items.

Items needing attention:
${itemLines || 'All items are adequately stocked.'}

Consider typical restaurant restock quantities and costs.
Respond with a JSON object containing:
{
  "recommendations": [
    {
      "item": "item name",
      "reason": "why it needs restocking",
      "suggestedQty": "amount with unit",
      "urgency": "low|medium|high",
      "estimatedCost": <number>
    }
  ]
}

Include 1-2 predictive recommendations based on typical consumption patterns even for items that aren't low yet.`;
}

export function buildLowStockPrompt(items: SanitizedInventoryItem[]): string {
  const itemLines = items.filter(i => i.currentStock > 0).map(i =>
    `${i.name}: stock=${i.currentStock}${i.unit}, min=${i.minStock}, avg cost=₹${i.averageCost}`
  ).join('\n');

  return `You are an AI inventory forecaster for a restaurant. Predict which items will run out soon.

Current inventory:
${itemLines || 'No items in inventory.'}

Typical daily consumption varies by item type. Consider that:
- Dairy products (milk, butter, cheese) are consumed at 0.5-20 units/day
- Produce (vegetables) at 5-20 units/day
- Dry goods at 1-10 units/day
- Beverages at 10-30 units/day

Respond with a JSON object containing:
{
  "predictions": [
    {
      "item": "item name",
      "daysUntilOut": <number>,
      "confidence": "high|medium|low",
      "currentStock": <number>,
      "unit": "unit string",
      "suggestedAction": "action text"
    }
  ]
}

Only include items predicted to run out within 7 days. Sort by daysUntilOut ascending.`;
}

export function buildWasteAnalysisPrompt(entries: SanitizedWasteEntry[]): string {
  const entryLines = entries.map(e =>
    `${e.item}: qty=${e.quantity}${e.unit}, reason=${e.reason}, cost=₹${e.cost}, date=${e.date}`
  ).join('\n');

  return `You are an AI waste analyst for a restaurant. Analyze the following waste log:

${entryLines || 'No waste entries recorded.'}

Respond with a JSON object containing:
{
  "totalWasteCost": <number>,
  "topWasteItems": [
    { "name": "item name", "cost": <number>, "percentage": <number> }
  ],
  "wasteByReason": [
    { "reason": "spoiled|burnt|expired|dropped|other", "count": <number>, "cost": <number> }
  ],
  "trend": "increasing|stable|decreasing",
  "actionableAdvice": ["2-4 specific, actionable recommendations to reduce waste"]
}

Focus on actionable restaurant-specific advice.`;
}
