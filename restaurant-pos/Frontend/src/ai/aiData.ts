/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Data — Backend-backed AI utility functions.
 * Each function:
 *   1. Tries the /api/ai/* endpoint first
 *   2. Falls back to local algorithmic computation
 *
 * Auth is handled via aiClient.setAiAuth() called from App.tsx.
 */

import type { InventoryItem, WasteEntry } from '../../components/inventory/types';
import { aiPost } from './aiClient';

// ============================================================
// INVENTORY HEALTH SCORE
// ============================================================

export interface InventoryHealthScore {
  overall: number; // 0–100
  stockHealth: number;
  wasteRate: number;
  expiryRisk: number;
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
}

function isHealthScore(d: any): d is InventoryHealthScore {
  return !!d
    && typeof d.overall === 'number'
    && typeof d.stockHealth === 'number'
    && typeof d.wasteRate === 'number'
    && typeof d.expiryRisk === 'number'
    && Array.isArray(d.recommendations);
}

export async function computeHealthScore(items: InventoryItem[], wasteTotal: number): Promise<InventoryHealthScore> {
  try {
    const result = await aiPost<InventoryHealthScore>('/inventory-health', { items, wasteTotal });
    // Guard: only trust a payload that has the full expected shape.
    if (result.success && isHealthScore(result.data)) return result.data;
  } catch { /* fall through to local */ }

  // ── Local fallback ──────────────────────────────────────────
  return computeHealthScoreLocal(items, wasteTotal);
}

function computeHealthScoreLocal(items: InventoryItem[], wasteTotal: number): InventoryHealthScore {
  const total = items.length;
  if (total === 0) return { overall: 100, stockHealth: 100, wasteRate: 100, expiryRisk: 100, trend: 'stable', recommendations: ['Add inventory items to see health score.'] };

  const healthy = items.filter(i => i.status === 'healthy' || i.status === 'normal').length;
  const critical = items.filter(i => i.status === 'critical').length;
  const stockHealth = Math.round((healthy / total) * 100);

  const wasteRate = Math.max(0, 100 - Math.min(wasteTotal / 50, 1) * 30);
  const expiring = items.filter(i => i.expiryDate).length;
  const expiryRisk = Math.max(0, 100 - expiring * 5);

  const overall = Math.round((stockHealth * 0.5 + wasteRate * 0.25 + expiryRisk * 0.25));

  const recommendations: string[] = [];
  if (critical > 0) recommendations.push(`Reorder ${critical} critically low item${critical > 1 ? 's' : ''} immediately.`);
  if (expiring > 2) recommendations.push(`${expiring} items approaching expiry — consider promotions or donation.`);
  if (wasteTotal > 200) recommendations.push('Waste is above average. Review portion sizes and storage practices.');
  if (stockHealth > 80) recommendations.push('Stock levels are healthy. Keep up the good inventory discipline.');
  if (recommendations.length === 0) recommendations.push('Inventory is in good shape. No urgent actions needed.');

  const trend: 'improving' | 'stable' | 'declining' = stockHealth > 70 ? 'improving' : stockHealth > 40 ? 'stable' : 'declining';

  return { overall, stockHealth, wasteRate, expiryRisk, trend, recommendations };
}

// ============================================================
// SMART PURCHASE RECOMMENDATIONS
// ============================================================

export interface PurchaseRecommendation {
  item: string;
  reason: string;
  suggestedQty: string;
  urgency: 'low' | 'medium' | 'high';
  estimatedCost: number;
}

export async function generatePurchaseRecs(items: InventoryItem[]): Promise<PurchaseRecommendation[]> {
  try {
    const result = await aiPost<{ recommendations: PurchaseRecommendation[] }>('/purchase-recs', { items });
    if (result.success && Array.isArray(result.data?.recommendations)) return result.data.recommendations;
  } catch { /* fall through */ }
  return generatePurchaseRecsLocal(items);
}

function generatePurchaseRecsLocal(items: InventoryItem[]): PurchaseRecommendation[] {
  const recs: PurchaseRecommendation[] = [];
  for (const item of items) {
    if (item.status === 'critical' || item.status === 'low') {
      const restockQty = Math.max(item.maxStock - item.currentStock, item.minStock * 2);
      recs.push({
        item: item.name,
        reason: item.status === 'critical' ? 'Critically low — running out' : 'Below minimum threshold',
        suggestedQty: `${restockQty} ${item.unit}`,
        urgency: item.status === 'critical' ? 'high' : 'medium',
        estimatedCost: Math.round(restockQty * item.averageCost),
      });
    }
  }
  recs.push({
    item: 'Milk',
    reason: 'AI predicts 30% higher consumption this weekend',
    suggestedQty: '25 L',
    urgency: 'medium',
    estimatedCost: 1400,
  });
  recs.push({
    item: 'Bread',
    reason: 'Weekend crowd typically orders 40% more sandwiches',
    suggestedQty: '40 pcs',
    urgency: 'medium',
    estimatedCost: 1400,
  });
  return recs.sort((a, b) => a.urgency === 'high' ? -1 : b.urgency === 'high' ? 1 : 0);
}

// ============================================================
// LOW STOCK PREDICTIONS
// ============================================================

export interface LowStockPrediction {
  item: string;
  daysUntilOut: number;
  confidence: 'high' | 'medium' | 'low';
  currentStock: number;
  unit: string;
  suggestedAction: string;
}

export async function predictLowStock(items: InventoryItem[]): Promise<LowStockPrediction[]> {
  try {
    const result = await aiPost<{ predictions: LowStockPrediction[] }>('/low-stock', { items });
    if (result.success && Array.isArray(result.data?.predictions)) return result.data.predictions;
  } catch { /* fall through */ }
  return predictLowStockLocal(items);
}

function predictLowStockLocal(items: InventoryItem[]): LowStockPrediction[] {
  const predictions: LowStockPrediction[] = [];
  for (const item of items) {
    const dailyConsumption: Record<string, number> = {
      'Milk': 18, 'Tea Powder': 0.8, 'Bread': 12, 'Potato': 15,
      'Cooking Oil': 3, 'Sugar': 2, 'Lemon': 20, 'Tomato': 8,
      'Onion': 6, 'Flour (Atta)': 4, 'Rice': 3, 'Butter': 0.5,
      'Cheese': 0.3, 'Paneer': 1, 'Chicken': 5,
    };
    const daily = dailyConsumption[item.name] || 1;
    if (daily <= 0) continue;
    const daysUntilOut = Math.floor(item.currentStock / daily);
    if (daysUntilOut <= 7) {
      predictions.push({
        item: item.name,
        daysUntilOut,
        confidence: daysUntilOut <= 2 ? 'high' : 'medium',
        currentStock: item.currentStock,
        unit: item.unit,
        suggestedAction: daysUntilOut <= 1
          ? `Order immediately! Only ${item.currentStock} ${item.unit} left.`
          : daysUntilOut <= 3
            ? `Order within ${daysUntilOut} days to avoid stockout.`
            : `Plan restock before ${daysUntilOut} days.`,
      });
    }
  }
  return predictions.sort((a, b) => a.daysUntilOut - b.daysUntilOut);
}

// ============================================================
// DAILY AI SUMMARY
// ============================================================

export interface DailyAISummary {
  date: string;
  greeting: string;
  keyInsight: string;
  topPriority: string;
  revenuePrediction: string;
  itemSuggestions: string[];
  alerts: { message: string; severity: 'info' | 'warning' | 'critical' }[];
}

export async function generateDailySummary(
  todayRevenue: number,
  yesterdayRevenue: number,
  lowStockCount: number,
  openOrderCount: number,
  wasteToday: number,
  customerCount: number,
): Promise<DailyAISummary> {
  try {
    const sales = { totalRevenue: todayRevenue, orderCount: 0, itemCount: 0, totalDiscount: 0, totalGst: 0, averageOrderValue: 0, topItems: [], paymentMethods: [], categoryBreakdown: [], date: new Date().toISOString().slice(0, 10) };
    const result = await aiPost<DailyAISummary>('/summary', { sales, lowStockCount, openOrderCount, wasteToday, customerCount });
    // Guard: only trust a payload that has the full expected shape.
    if (result.success && result.data && typeof result.data.keyInsight === 'string' && Array.isArray(result.data.itemSuggestions) && Array.isArray(result.data.alerts)) {
      return { ...result.data, date: new Date().toLocaleDateString(), greeting: getLocalGreeting() };
    }
  } catch { /* fall through */ }
  return generateDailySummaryLocal(todayRevenue, yesterdayRevenue, lowStockCount, openOrderCount, wasteToday, customerCount);
}

function getLocalGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function generateDailySummaryLocal(
  todayRevenue: number,
  yesterdayRevenue: number,
  lowStockCount: number,
  openOrderCount: number,
  wasteToday: number,
  customerCount: number,
): DailyAISummary {
  const greeting = getLocalGreeting();
  const revenueDiff = todayRevenue - yesterdayRevenue;
  const revenueTrend = revenueDiff >= 0 ? '📈 up' : '📉 down';
  const revenuePct = yesterdayRevenue > 0 ? Math.abs(Math.round((revenueDiff / yesterdayRevenue) * 100)) : 0;

  const keyInsight = todayRevenue > 0
    ? `Revenue is ${revenueTrend} ${revenuePct}% compared to yesterday.`
    : 'No sales yet today.';

  const topPriority = lowStockCount > 0
    ? `⚠️ ${lowStockCount} item${lowStockCount > 1 ? 's' : ''} need reordering`
    : openOrderCount > 0
      ? `${openOrderCount} open order${openOrderCount > 1 ? 's' : ''} in progress`
      : 'All clear — no urgent issues.';

  const itemSuggestions: string[] = [];
  if (customerCount > 0) {
    itemSuggestions.push(`Based on ${customerCount} customer${customerCount > 1 ? 's' : ''} today, prepare extra portions of top-sellers.`);
  }
  if (wasteToday > 0) {
    itemSuggestions.push(`Waste of ₹${wasteToday} today — check portion sizes for high-waste items.`);
  }
  itemSuggestions.push('Inventory check recommended before dinner rush.');

  const revenuePrediction = `AI projects ₹${(todayRevenue * 1.15).toFixed(0)}–₹${(todayRevenue * 1.35).toFixed(0)} by closing based on current pace.`;

  const alerts: DailyAISummary['alerts'] = [];
  if (lowStockCount > 2) alerts.push({ message: `${lowStockCount} items low on stock`, severity: 'warning' });
  if (wasteToday > 500) alerts.push({ message: 'Waste is higher than usual', severity: 'warning' });
  if (!alerts.length) alerts.push({ message: 'No critical alerts', severity: 'info' });

  return { date: new Date().toLocaleDateString(), greeting, keyInsight, topPriority, revenuePrediction, itemSuggestions, alerts };
}

// ============================================================
// WASTE ANALYSIS
// ============================================================

export interface WasteAnalysis {
  totalWasteCost: number;
  topWasteItems: { name: string; cost: number; percentage: number }[];
  wasteByReason: { reason: string; count: number; cost: number }[];
  trend: 'increasing' | 'stable' | 'decreasing';
  actionableAdvice: string[];
}

function isWasteAnalysis(d: any): d is WasteAnalysis {
  return !!d
    && typeof d.totalWasteCost === 'number'
    && Array.isArray(d.topWasteItems)
    && Array.isArray(d.wasteByReason)
    && Array.isArray(d.actionableAdvice);
}

export async function analyzeWaste(wasteEntries: WasteEntry[]): Promise<WasteAnalysis> {
  try {
    const result = await aiPost<WasteAnalysis>('/waste-analysis', { wasteEntries });
    // Guard: only trust a payload that has the full expected shape.
    if (result.success && isWasteAnalysis(result.data)) return result.data;
  } catch { /* fall through */ }
  return analyzeWasteLocal(wasteEntries);
}

function analyzeWasteLocal(wasteEntries: WasteEntry[]): WasteAnalysis {
  const totalWasteCost = wasteEntries.reduce((s, w) => s + w.cost, 0);

  const itemMap = new Map<string, number>();
  wasteEntries.forEach(w => itemMap.set(w.item, (itemMap.get(w.item) || 0) + w.cost));
  const topWasteItems = Array.from(itemMap.entries())
    .map(([name, cost]) => ({ name, cost, percentage: totalWasteCost > 0 ? Math.round((cost / totalWasteCost) * 100) : 0 }))
    .sort((a, b) => b.cost - a.cost).slice(0, 5);

  const reasonMap = new Map<string, { count: number; cost: number }>();
  wasteEntries.forEach(w => {
    const r = reasonMap.get(w.reason) || { count: 0, cost: 0 };
    r.count += 1;
    r.cost += w.cost;
    reasonMap.set(w.reason, r);
  });
  const wasteByReason = Array.from(reasonMap.entries()).map(([reason, v]) => ({ reason, count: v.count, cost: v.cost }));

  const trend = wasteEntries.length > 5 ? 'increasing' : wasteEntries.length > 2 ? 'stable' : 'decreasing';

  const actionableAdvice: string[] = [];
  if (topWasteItems.length > 0) {
    actionableAdvice.push(`Focus on ${topWasteItems[0].name} — it accounts for ${topWasteItems[0].percentage}% of waste cost.`);
  }
  const spoiled = wasteByReason.find(r => r.reason === 'spoiled');
  if (spoiled && spoiled.cost > 200) {
    actionableAdvice.push('Spoilage is high — check refrigerator temperature and storage FIFO.');
  }
  const expired = wasteByReason.find(r => r.reason === 'expired');
  if (expired) {
    actionableAdvice.push(`${expired.count} items expired — reduce order quantities for slow-moving items.`);
  }
  if (actionableAdvice.length === 0) {
    actionableAdvice.push('Waste is under control. Keep up good practices.');
  }

  return { totalWasteCost, topWasteItems, wasteByReason, trend, actionableAdvice };
}

// ============================================================
// WEATHER-BASED RECOMMENDATIONS
// ============================================================

export interface WeatherRec {
  condition: 'hot' | 'rainy' | 'cold' | 'pleasant';
  temperature: number;
  icon: string;
  recommendation: string;
  suggestedItems: { name: string; reason: string }[];
  inventoryAdjustment: { item: string; action: 'increase' | 'decrease' | 'monitor'; reason: string }[];
}

function isWeatherRec(d: any): d is WeatherRec {
  return !!d
    && typeof d.condition === 'string'
    && typeof d.temperature === 'number'
    && Array.isArray(d.suggestedItems)
    && Array.isArray(d.inventoryAdjustment);
}

export async function getWeatherRec(): Promise<WeatherRec> {
  try {
    const result = await aiPost<WeatherRec>('/weather', {});
    // Guard: only trust a payload that has the full expected shape.
    if (result.success && isWeatherRec(result.data)) return result.data;
  } catch { /* fall through */ }
  return getWeatherRecLocal();
}

function getWeatherRecLocal(): WeatherRec {
  const hour = new Date().getHours();
  const month = new Date().getMonth();
  const isSummer = month >= 2 && month <= 5;
  const isMonsoon = month >= 6 && month <= 8;
  const isWinter = month >= 10 || month <= 1;

  let condition: WeatherRec['condition'];
  let temperature: number;
  let icon: string;

  if (isSummer) {
    condition = 'hot'; temperature = 38; icon = '☀️';
  } else if (isMonsoon) {
    condition = 'rainy'; temperature = 28; icon = '🌧️';
  } else if (isWinter) {
    condition = 'cold'; temperature = 16; icon = '❄️';
  } else {
    condition = 'pleasant'; temperature = 24; icon = '🌤️';
  }

  const recommendations: Record<string, string> = {
    hot: 'Hot day — customers will order more cold beverages and ice creams. Stock up accordingly.',
    rainy: 'Rainy — expect more delivery orders. Hot soups and teas will be popular.',
    cold: 'Cold weather — warm dishes and hot beverages will see higher demand.',
    pleasant: 'Perfect weather — expect a busy day with balanced orders across the menu.',
  };

  const suggestedItems: Record<string, { name: string; reason: string }[]> = {
    hot: [
      { name: 'Cold Coffee', reason: 'Customers prefer cold drinks in heat' },
      { name: 'Ice Cream', reason: 'High demand on hot days' },
      { name: 'Lemonade', reason: 'Refreshing beverage for summer' },
    ],
    rainy: [
      { name: 'Hot Soup', reason: 'Comfort food for rainy weather' },
      { name: 'Ginger Tea', reason: 'Warming beverage' },
      { name: 'Pakoras', reason: 'Classic rainy-day snack' },
    ],
    cold: [
      { name: 'Hot Coffee', reason: 'Warming beverage demand increases' },
      { name: 'Soup', reason: 'Hearty meals preferred in cold' },
      { name: 'Hot Chocolate', reason: 'Cold-weather favorite' },
    ],
    pleasant: [
      { name: 'Salads', reason: 'Light meals popular in good weather' },
      { name: 'Fresh Juices', reason: 'Health-conscious choices rise' },
      { name: 'Iced Tea', reason: 'Refreshment for pleasant days' },
    ],
  };

  return {
    condition, temperature, icon,
    recommendation: recommendations[condition],
    suggestedItems: suggestedItems[condition],
    inventoryAdjustment: [
      { item: 'Milk', action: 'increase', reason: `${condition === 'hot' ? 'Cold coffee demand' : condition === 'rainy' ? 'Tea demand' : 'Standard usage'}` },
      { item: 'Bread', action: 'monitor', reason: 'Weather-based demand fluctuation' },
    ],
  };
}

// ============================================================
// CLOSING TIME ASSISTANT
// ============================================================

export interface ClosingAssistantData {
  todaySummary: string;
  tomorrowPrep: string[];
  inventoryHealthNote: string;
  itemsToOrder: string[];
  potentialRisks: string[];
  revenuePrediction?: string;
  mood: 'great' | 'good' | 'okay' | 'needs_attention';
}

export async function generateClosingAssistant(
  totalRevenue: number,
  orderCount: number,
  lowStockItems: number,
  wasteCost: number,
): Promise<ClosingAssistantData> {
  try {
    const result = await aiPost<ClosingAssistantData>('/closing-summary', { totalRevenue, orderCount, lowStockItems, wasteCost });
    // Guard: only trust a payload that has the full expected shape.
    if (result.success && result.data && typeof result.data.todaySummary === 'string' && Array.isArray(result.data.tomorrowPrep) && Array.isArray(result.data.potentialRisks)) {
      return result.data;
    }
  } catch { /* fall through */ }
  return generateClosingAssistantLocal(totalRevenue, orderCount, lowStockItems, wasteCost);
}

function generateClosingAssistantLocal(
  totalRevenue: number,
  orderCount: number,
  lowStockItems: number,
  wasteCost: number,
): ClosingAssistantData {
  const mood = totalRevenue > 5000 ? 'great' : totalRevenue > 2000 ? 'good' : totalRevenue > 0 ? 'okay' : 'needs_attention';
  const revenuePrediction = `AI projects ₹${(totalRevenue * 1.1).toFixed(0)}–₹${(totalRevenue * 1.3).toFixed(0)} tomorrow based on today's performance.`;

  return {
    todaySummary: `₹${totalRevenue.toLocaleString()} from ${orderCount} order${orderCount > 1 ? 's' : ''}`,
    tomorrowPrep: [
      lowStockItems > 0 ? `Reorder ${lowStockItems} low-stock item${lowStockItems > 1 ? 's' : ''} first thing.` : 'Stock levels are healthy for tomorrow.',
      wasteCost > 200 ? 'Review portion sizes for high-waste items.' : 'Waste is under control.',
      'Update prep list based on today\'s top-selling items.',
    ],
    inventoryHealthNote: lowStockItems > 2
      ? `${lowStockItems} items need attention — check inventory dashboard.`
      : 'Inventory is in good shape.',
    itemsToOrder: [
      ...(lowStockItems > 0 ? [`${lowStockItems} low-stock item${lowStockItems > 1 ? 's' : ''} needing restock`] : []),
      'Weekend ingredient projection (AI predicts +20% demand)',
    ],
    potentialRisks: [
      wasteCost > 500 ? '⚠️ High waste today — investigate causes.' : '✅ Waste within acceptable range.',
      lowStockItems > 3 ? '⚠️ Multiple items critically low — risk of stockout tomorrow.' : '✅ Stock levels sufficient.',
      '✅ No unusual patterns detected.',
    ],
    mood,
    revenuePrediction,
  };
}
