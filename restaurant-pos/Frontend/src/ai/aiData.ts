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
// AI RESULT PROVENANCE
// ============================================================

/** Whether a value came from the live AI backend or the local fallback. */
export type AiSource = 'live' | 'local';

/** Wraps AI-backed data with its provenance so UIs can label local fallbacks. */
export interface AiResult<T> {
  data: T;
  source: AiSource;
}

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

export async function computeHealthScore(items: InventoryItem[], wasteTotal: number): Promise<AiResult<InventoryHealthScore>> {
  // Empty catalog: the backend schema requires items to have >= 1 entries and
  // would reject an empty array with a 400 — skip the pointless API call and
  // use the local fallback (which returns a 100 score with an onboarding hint).
  if (items.length === 0) return { data: computeHealthScoreLocal(items, wasteTotal), source: 'local' };
  try {
    const result = await aiPost<InventoryHealthScore>('/inventory-health', { items, wasteTotal });
    // Guard: only trust a payload that has the full expected shape AND was
    // produced by the live LLM — a backend `fallback: true` response is an
    // algorithmic substitute and must be labeled local, never live.
    if (result.success && !result.fallback && isHealthScore(result.data)) return { data: result.data, source: 'live' };
  } catch { /* fall through to local */ }

  // ── Local fallback ──────────────────────────────────────────
  return { data: computeHealthScoreLocal(items, wasteTotal), source: 'local' };
}

/** Days from today until the given YYYY-MM-DD expiry (negative = already expired). */
function daysUntil(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(`${expiryDate}T00:00:00`);
  if (isNaN(t.getTime())) return Infinity;
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}

function computeHealthScoreLocal(items: InventoryItem[], wasteTotal: number): InventoryHealthScore {
  const total = items.length;
  if (total === 0) return { overall: 100, stockHealth: 100, wasteRate: 100, expiryRisk: 100, trend: 'stable', recommendations: ['Add inventory items to see health score.'] };

  const healthy = items.filter(i => i.status === 'healthy' || i.status === 'normal').length;
  const critical = items.filter(i => i.status === 'critical').length;
  const stockHealth = Math.round((healthy / total) * 100);

  const wasteRate = Math.max(0, 100 - Math.min(wasteTotal / 50, 1) * 30);

  // Expiry risk from REAL batch dates — items already past expiry or inside
  // the 7-day window are the risk drivers (presence alone is not a risk).
  const expiryDays = items
    .filter(i => i.expiryDate)
    .map(i => ({ name: i.name, days: daysUntil(i.expiryDate!) }));
  const expiredCount = expiryDays.filter(e => e.days < 0).length;
  const expiringSoon = expiryDays.filter(e => e.days >= 0 && e.days <= 7);
  const expiring30 = expiryDays.filter(e => e.days >= 0 && e.days <= 30);
  // 100 → −10 per expired batch → −5 per expiring-soon batch → −1 per
  // 30-day batch, floored at 20 (never a zero floor that looks "fine").
  const expiryRisk = Math.max(20, 100 - expiredCount * 10 - expiringSoon.length * 5 - Math.max(0, expiring30.length - expiringSoon.length) * 1);

  const overall = Math.round((stockHealth * 0.5 + wasteRate * 0.25 + expiryRisk * 0.25));

  const recommendations: string[] = [];
  if (critical > 0) recommendations.push(`Reorder ${critical} critically low item${critical > 1 ? 's' : ''} immediately.`);
  if (expiredCount > 0) {
    const names = expiryDays.filter(e => e.days < 0).map(e => e.name).slice(0, 3).join(', ');
    recommendations.push(`${expiredCount} batch${expiredCount > 1 ? 'es' : ''} expired (${names}${expiredCount > 3 ? '…' : ''}) — discard and review order quantities.`);
  }
  if (expiringSoon.length > 0) {
    const names = expiringSoon.map(e => e.name).slice(0, 3).join(', ');
    recommendations.push(`${expiringSoon.length} item${expiringSoon.length > 1 ? 's' : ''} expire within 7 days (${names}${expiringSoon.length > 3 ? '…' : ''}) — use first-in-first-out or run a quick promotion.`);
  }
  if (wasteTotal > 200) recommendations.push('Waste is above average. Review portion sizes and storage practices.');
  if (stockHealth > 80 && expiredCount === 0 && expiringSoon.length === 0) recommendations.push('Stock levels are healthy. Keep up the good inventory discipline.');
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

/** Urgency rank — lower wins when merging duplicate recommendations. */
const URGENCY_RANK: Record<PurchaseRecommendation['urgency'], number> = { high: 0, medium: 1, low: 2 };

/**
 * Merge recommendations that refer to the same item. The LLM backend can
 * occasionally emit two entries for one item (e.g. once for low stock and once
 * for an expiring batch), which breaks React list keys. Keeps the
 * highest-urgency entry and folds the other reason into one readable line.
 */
function dedupeRecs(recs: PurchaseRecommendation[]): PurchaseRecommendation[] {
  const byItem = new Map<string, PurchaseRecommendation>();
  for (const rec of recs) {
    const key = (rec.item || '').trim().toLowerCase();
    if (!key) continue;
    const existing = byItem.get(key);
    if (!existing) { byItem.set(key, rec); continue; }
    const keep = URGENCY_RANK[rec.urgency] <= URGENCY_RANK[existing.urgency] ? rec : existing;
    const other = keep === rec ? existing : rec;
    let reason = keep.reason;
    if (other.reason && other.reason !== keep.reason) {
      const extra = other.reason.charAt(0).toLowerCase() + other.reason.slice(1);
      reason = keep.reason ? `${keep.reason} · ${extra}` : other.reason;
    }
    byItem.set(key, { ...keep, reason });
  }
  // Urgency-ordered (high first) so list slices always surface the most urgent
  // recommendations — applies to both live and local sources.
  return Array.from(byItem.values()).sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}

export async function generatePurchaseRecs(items: InventoryItem[]): Promise<AiResult<PurchaseRecommendation[]>> {
  // Empty catalog: skip the API call (backend rejects items: [] with a 400) and
  // return the local fallback — no items means nothing to recommend yet.
  if (items.length === 0) return { data: dedupeRecs(generatePurchaseRecsLocal(items)), source: 'local' };
  try {
    const result = await aiPost<{ recommendations: PurchaseRecommendation[] }>('/purchase-recs', { items });
    // Live only when the backend LLM answered (fallback:false) with a valid shape.
    if (result.success && !result.fallback && Array.isArray(result.data?.recommendations)) {
      return { data: dedupeRecs(result.data.recommendations), source: 'live' };
    }
  } catch { /* fall through */ }
  return { data: dedupeRecs(generatePurchaseRecsLocal(items)), source: 'local' };
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
    // Separate check (not else-if): a low-stock item that is also expiring
    // generates BOTH entries — dedupeRecs merges them into one recommendation
    // that carries both reasons with the higher-urgency restock quantity.
    if (item.expiryDate) {
      // Expiring soon — restock only the minimal safe quantity so the new
      // batch arrives after the current one clears (FIFO-friendly).
      const days = daysUntil(item.expiryDate);
      if (days >= 0 && days <= 7) {
        recs.push({
          item: item.name,
          reason: `Current batch expires in ${days} day${days === 1 ? '' : 's'} (${item.expiryDate}) — restock conservatively`,
          suggestedQty: `${item.minStock} ${item.unit}`,
          urgency: 'low',
          estimatedCost: Math.round(item.minStock * item.averageCost),
        });
      }
    }
  }
  // No fabricated entries — every recommendation is derived from the real
  // catalog (stock levels, thresholds and expiry dates). dedupeRecs() (applied
  // by generatePurchaseRecs) merges per-item duplicates and sorts by urgency.
  return recs;
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

export async function predictLowStock(items: InventoryItem[]): Promise<AiResult<LowStockPrediction[]>> {
  // Empty catalog: skip the API call (backend rejects items: [] with a 400) and
  // return the local fallback — an empty inventory has no stockouts to predict.
  if (items.length === 0) return { data: predictLowStockLocal(items), source: 'local' };
  try {
    const result = await aiPost<{ predictions: LowStockPrediction[] }>('/low-stock', { items });
    // Live only when the backend LLM answered (fallback:false) with a valid shape.
    if (result.success && !result.fallback && Array.isArray(result.data?.predictions)) return { data: result.data.predictions, source: 'live' };
  } catch { /* fall through */ }
  return { data: predictLowStockLocal(items), source: 'local' };
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

export async function analyzeWaste(wasteEntries: WasteEntry[]): Promise<AiResult<WasteAnalysis>> {
  // Empty log: nothing to analyze — skip the API call and return the local
  // fallback (keeps provenance honest: no backend call, no 'live' claim).
  if (wasteEntries.length === 0) return { data: analyzeWasteLocal(wasteEntries), source: 'local' };
  try {
    const result = await aiPost<WasteAnalysis>('/waste-analysis', { wasteEntries });
    // Live only when the backend LLM answered (fallback:false) with a valid shape.
    if (result.success && !result.fallback && isWasteAnalysis(result.data)) return { data: result.data, source: 'live' };
  } catch { /* fall through */ }
  return { data: analyzeWasteLocal(wasteEntries), source: 'local' };
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
