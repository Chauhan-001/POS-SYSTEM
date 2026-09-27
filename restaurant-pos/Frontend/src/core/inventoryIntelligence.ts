/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Intelligence — deterministic core engine.
 *
 * PHASE 3: every function here is a pure, synchronous computation over the
 * real inventory catalog (stock statuses, expiry dates, purchase history and
 * logged waste). No LLM and no network calls: the numbers always match the
 * data shown next to them. This module is the successor of the removed
 * AI-backed layer (src/ai/aiData.ts) — the local engines it fell back to now
 * ARE the product.
 */

import type { InventoryItem, Purchase, WasteEntry } from '../../components/inventory/types';

// ============================================================
// RESULT PROVENANCE
// ============================================================

/** Provenance of a computed value: 'live' (backend AI), 'local'/'data'
 * (deterministic computation from real data) or 'delta' (instant local
 * recompute after a catalog change). Kept as a union so the UI badges that
 * still render all variants keep type-checking. */
export type AiSource = 'live' | 'local' | 'delta' | 'data';

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

/** Days from today until the given YYYY-MM-DD expiry (negative = already expired). */
function daysUntil(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(`${expiryDate}T00:00:00`);
  if (isNaN(t.getTime())) return Infinity;
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}

export function computeHealthScoreLocal(items: InventoryItem[], wasteTotal: number): InventoryHealthScore | null {
  const total = items.length;
  if (total === 0) return null;

  const healthy = items.filter(i => i.status === 'healthy' || i.status === 'normal').length;
  const critical = items.filter(i => i.status === 'critical').length;
  const stockHealth = Math.round((healthy / total) * 100);

  // Waste Control from REAL logged waste cost (last 30 days) relative to the
  // current stock value — 100 when there is no waste, losing up to 30 points
  // as waste reaches 30% of stock value. Never a fabricated count.
  const stockValue = items.reduce((s, i) => s + i.currentStock * i.averageCost, 0);
  const wasteRatio = stockValue > 0 ? wasteTotal / stockValue : 0;
  const wasteRate = Math.max(0, Math.round(100 - Math.min(wasteRatio / 0.3, 1) * 30));

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
  if (wasteRatio > 0.1) recommendations.push('Waste is above average. Review portion sizes and storage practices.');
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
 * Merge recommendations that refer to the same item (e.g. once for low stock
 * and once for an expiring batch), which would otherwise break React list
 * keys. Keeps the highest-urgency entry and folds the other reason into one
 * readable line.
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
  // Urgency-ordered (high first) so list slices always surface the most
  // urgent recommendations.
  return Array.from(byItem.values()).sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}

export function generatePurchaseRecsLocal(items: InventoryItem[]): PurchaseRecommendation[] {
  // Deterministic by design: recommendations are derived only from items that
  // REALLY exist in the catalog (below threshold or expiring).
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
  return dedupeRecs(recs);
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

/** Known daily consumption rates (per unit) used only when there is no
 * purchase history for an item — never for items with real purchase data. */
const KNOWN_DAILY_CONSUMPTION: Record<string, number> = {
  'Milk': 18, 'Tea Powder': 0.8, 'Bread': 12, 'Potato': 15,
  'Cooking Oil': 3, 'Sugar': 2, 'Lemon': 20, 'Tomato': 8,
  'Onion': 6, 'Flour (Atta)': 4, 'Rice': 3, 'Butter': 0.5,
  'Cheese': 0.3, 'Paneer': 1, 'Chicken': 5,
};

export function predictLowStockLocal(items: InventoryItem[], purchases?: Purchase[]): LowStockPrediction[] {
  // Real daily consumption from purchase history: units bought in the last 30
  // days ÷ 30. Falls back to the known-name table for items without purchase
  // data, and never guesses for items with no consumption signal at all (no
  // fabricated predictions).
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const bought = new Map<string, number>();
  (purchases || []).forEach((p) => {
    if (p.status !== 'completed') return;
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t) || t < thirtyDaysAgo) return;
    const qty = Number(p.quantity) || 0;
    if (qty <= 0) return;
    bought.set(p.item.toLowerCase(), (bought.get(p.item.toLowerCase()) || 0) + qty);
  });

  const consumptionOf = (name: string): number | null => {
    const fromHistory = bought.get(name.toLowerCase());
    if (fromHistory && fromHistory > 0) return fromHistory / 30;
    const known = KNOWN_DAILY_CONSUMPTION[name];
    return known && known > 0 ? known : null; // null = no signal → skip
  };

  const predictions: LowStockPrediction[] = [];
  for (const item of items) {
    const daily = consumptionOf(item.name);
    if (daily === null || daily <= 0) continue;
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
// DETERMINISTIC LOCAL CARDS (all three at once)
// ============================================================

/** Result of computing all three inventory intelligence cards with the local engines. */
export interface InventoryCardsLocal {
  health: InventoryHealthScore | null;
  purchaseRecs: PurchaseRecommendation[];
  lowStock: LowStockPrediction[];
}

/**
 * Compute all three inventory Overview cards in one pass — used for the
 * instant delta recompute when the catalog changes while the page is open
 * (stock edit, purchase, waste logged elsewhere).
 */
export function computeInventoryCardsLocal(items: InventoryItem[], wasteTotal: number, purchases?: Purchase[]): InventoryCardsLocal {
  return {
    health: computeHealthScoreLocal(items, wasteTotal),
    purchaseRecs: generatePurchaseRecsLocal(items),
    lowStock: predictLowStockLocal(items, purchases),
  };
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

export function analyzeWasteLocal(wasteEntries: WasteEntry[]): WasteAnalysis {
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
