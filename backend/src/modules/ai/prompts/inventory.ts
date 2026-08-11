/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Prompts — Template builders for inventory health,
 * purchase recommendations, low stock predictions, and waste analysis.
 *
 * Schema-compliant output matters: every response is validated against the
 * feature's expected shape (see aiService.isValidFeatureData) and falls back
 * to an algorithmic substitute when it drifts. Each prompt therefore demands
 * ONLY the exact JSON object (no markdown fences / explanation) and shows a
 * complete example so the configured model stays on-schema.
 */

import type { SanitizedInventoryItem, SanitizedWasteEntry } from '../types';

const STRICT_JSON_RULE =
  'Return ONLY a valid JSON object — no markdown fences, no code blocks, no explanations, no text before or after.';

export function buildHealthPrompt(items: SanitizedInventoryItem[], wasteTotal: number): string {
  const itemLines = items.map(i =>
    `${i.name} (${i.category}): stock=${i.currentStock}${i.unit}, min=${i.minStock}, max=${i.maxStock}, status=${i.status}${i.expiryDate ? `, expires=${i.expiryDate}` : ''}`
  ).join('\n');

  return `You are an AI inventory analyst for a restaurant. Analyze the following inventory data:

Items:
${itemLines}

Total waste cost this period: ₹${wasteTotal}

${STRICT_JSON_RULE} The object must match this exact schema, with scores computed from the data above (0-100):

{
  "overall": 82,
  "stockHealth": 75,
  "wasteRate": 90,
  "expiryRisk": 40,
  "trend": "stable",
  "recommendations": ["2-3 actionable recommendations"]
}

Example of a valid response:
{"overall":82,"stockHealth":75,"wasteRate":90,"expiryRisk":40,"trend":"stable","recommendations":["Reorder paneer — below minimum.","Check dairy expiry dates."]}

Base the scores on stock levels relative to min/max, expiry dates, and waste.`;
}

export function buildPurchaseRecPrompt(items: SanitizedInventoryItem[]): string {
  const lowItems = items.filter(i => i.status === 'low' || i.status === 'critical');
  const itemLines = lowItems.map(i =>
    `${i.name}: stock=${i.currentStock}${i.unit}, min=${i.minStock}, max=${i.maxStock}, cost=₹${i.averageCost}/${i.unit}${i.expiryDate ? `, expires=${i.expiryDate}` : ''}`
  ).join('\n');

  return `You are an AI purchasing assistant for a restaurant. Recommend restock quantities for low items.

Items needing attention:
${itemLines || 'All items are adequately stocked.'}

Consider typical restaurant restock quantities and costs. For items with an expiry date, keep restock quantities conservative so the batch can be used before it expires.

${STRICT_JSON_RULE} The object must match this exact schema:

{
  "recommendations": [
    {
      "item": "item name",
      "reason": "why it needs restocking",
      "suggestedQty": "amount with unit",
      "urgency": "low|medium|high",
      "estimatedCost": 1234
    }
  ]
}

Example of a valid response:
{"recommendations":[{"item":"Paneer","reason":"Below minimum stock","suggestedQty":"10 kg","urgency":"high","estimatedCost":4500}]}

Include 1-2 predictive recommendations based on typical consumption patterns even for items that aren't low yet.`;
}

export function buildLowStockPrompt(items: SanitizedInventoryItem[]): string {
  const itemLines = items.filter(i => i.currentStock > 0).map(i =>
    `${i.name}: stock=${i.currentStock}${i.unit}, min=${i.minStock}, avg cost=₹${i.averageCost}${i.expiryDate ? `, expires=${i.expiryDate}` : ''}`
  ).join('\n');

  return `You are an AI inventory forecaster for a restaurant. Predict which items will run out soon.

Current inventory:
${itemLines || 'No items in inventory.'}

Typical daily consumption varies by item type. Consider that:
- Dairy products (milk, butter, cheese) are consumed at 0.5-20 units/day
- Produce (vegetables) at 5-20 units/day
- Dry goods at 1-10 units/day
- Beverages at 10-30 units/day

${STRICT_JSON_RULE} The object must match this exact schema:

{
  "predictions": [
    {
      "item": "item name",
      "daysUntilOut": 3,
      "confidence": "high|medium|low",
      "currentStock": 12,
      "unit": "unit string",
      "suggestedAction": "action text"
    }
  ]
}

Example of a valid response:
{"predictions":[{"item":"Milk","daysUntilOut":1,"confidence":"high","currentStock":5,"unit":"L","suggestedAction":"Order immediately!"}]}

Only include items predicted to run out within 7 days. Sort by daysUntilOut ascending.`;
}

export function buildWasteAnalysisPrompt(entries: SanitizedWasteEntry[]): string {
  const entryLines = entries.map(e =>
    `${e.item}: qty=${e.quantity}${e.unit}, reason=${e.reason}, cost=₹${e.cost}, date=${e.date}`
  ).join('\n');

  return `You are an AI waste analyst for a restaurant. Analyze the following waste log:

${entryLines || 'No waste entries recorded.'}

${STRICT_JSON_RULE} The object must match this exact schema:

{
  "totalWasteCost": 2500,
  "topWasteItems": [
    { "name": "item name", "cost": 1500, "percentage": 60 }
  ],
  "wasteByReason": [
    { "reason": "spoiled|burnt|expired|dropped|other", "count": 3, "cost": 1800 }
  ],
  "trend": "increasing|stable|decreasing",
  "actionableAdvice": ["2-4 specific, actionable recommendations to reduce waste"]
}

Example of a valid response:
{"totalWasteCost":2500,"topWasteItems":[{"name":"Paneer","cost":1500,"percentage":60}],"wasteByReason":[{"reason":"spoiled","count":3,"cost":1800}],"trend":"increasing","actionableAdvice":["Check fridge temperature","Review portion sizes"]}

Focus on actionable restaurant-specific advice computed from the log above.`;
}
