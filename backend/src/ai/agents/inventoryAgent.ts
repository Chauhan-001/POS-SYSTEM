/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgent.ts — Deterministic inventory action planner.
 *
 * Structure mirrors the marketing agent (agents/marketingAgent.ts):
 *   - the agent reads ONLY shared tenant-scoped tools (tools/inventory/*),
 *   - every conclusion is rule-based and evidence-backed — no model call,
 *   - availability is honest: an unavailable source is reported, never guessed,
 *   - the agent NEVER writes to inventory; it only recommends actions.
 *
 * Evidence sources (all existing tools):
 *   getInventoryStatus — current stock levels (stock-tracked items)
 *   getStockoutRisk    — consumption-forecast stockouts (demand-derived)
 *   getExpiryRisk      — perishable batches approaching expiry
 *   getWastage         — observed kitchen wastage (cost engine)
 */

import { executeTool } from '../tools/registry/toolExecutor';
import type { ToolContext } from '../tools/registry/toolTypes';
import {
  getInventoryStatusToolDefinition,
  type InventoryStatusOutput,
} from '../tools/inventory/getInventoryStatusTool';
import {
  getStockoutRiskToolDefinition,
  type StockoutRiskOutput,
} from '../tools/inventory/getStockoutRiskTool';
import {
  getExpiryRiskToolDefinition,
  type ExpiryRiskOutput,
} from '../tools/inventory/getExpiryRiskTool';
import {
  getWastageToolDefinition,
  type WastageOutput,
} from '../tools/inventory/getWastageTool';

export interface InventoryPurchaseRecommendation {
  item: string;
  reason: string;
  suggestedQty: string;
  urgency: 'low' | 'medium' | 'high';
  estimatedCost: number | null;
}

export interface InventoryStockoutPrediction {
  item: string;
  daysUntilOut: number;
  severity: 'warning' | 'critical';
  currentStock: number;
  unit: string;
  suggestedAction: string;
}

export interface InventoryAgentResult {
  mode: 'deterministic';
  status: 'ready' | 'insufficient_data';
  summary: string;
  purchaseRecommendations: InventoryPurchaseRecommendation[];
  stockoutPredictions: InventoryStockoutPrediction[];
  expiryRisks: NonNullable<ExpiryRiskOutput['alerts']>;
  wastageSignals: NonNullable<WastageOutput['topItems']>;
  /** Neutral, evidence-backed next steps — advisory only, never executed. */
  nextActions: string[];
  evidenceSources: {
    inventory: boolean;
    demandForecast: boolean;
    expiry: boolean;
    wastage: boolean;
  };
  generatedAt: string;
}

/**
 * The deterministic analyzer consumes ONLY `available` plus the row arrays.
 * The reason is deliberately widened to `string` so a caller that legitimately
 * did not investigate a source (e.g. the agentic path only called two tools)
 * can say `NOT_INVESTIGATED` honestly instead of borrowing a tool's reason
 * code for "no data".
 */
export interface InventoryAgentEvidence {
  inventory: { available: boolean; reason?: string; items?: InventoryStatusOutput['items']; generatedAt: string };
  stockout: { available: boolean; reason?: string; alerts?: StockoutRiskOutput['alerts']; generatedAt: string };
  expiry: { available: boolean; reason?: string; alerts?: ExpiryRiskOutput['alerts']; generatedAt: string };
  wastage: { available: boolean; reason?: string; topItems?: WastageOutput['topItems']; generatedAt: string };
  generatedAt: string;
}

const urgencyRank: Record<InventoryPurchaseRecommendation['urgency'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function itemKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function buildInventoryAgentResult(evidence: InventoryAgentEvidence): InventoryAgentResult {
  const items = evidence.inventory.items || [];
  const stockouts = evidence.stockout.alerts || [];
  const expiryRisks = evidence.expiry.alerts || [];
  const wastageSignals = evidence.wastage.topItems || [];
  const itemByName = new Map(items.map((item) => [itemKey(item.name), item]));
  const stockoutByName = new Map(stockouts.map((risk) => [itemKey(risk.itemName), risk]));
  const recommendations = new Map<string, InventoryPurchaseRecommendation>();

  const addRecommendation = (recommendation: InventoryPurchaseRecommendation) => {
    const key = itemKey(recommendation.item);
    const previous = recommendations.get(key);
    if (!previous) {
      recommendations.set(key, recommendation);
      return;
    }
    const preferred = urgencyRank[recommendation.urgency] < urgencyRank[previous.urgency]
      ? recommendation
      : previous;
    const other = preferred === recommendation ? previous : recommendation;
    recommendations.set(key, {
      ...preferred,
      reason: preferred.reason === other.reason
        ? preferred.reason
        : `${preferred.reason}; ${other.reason.charAt(0).toLowerCase()}${other.reason.slice(1)}`,
      estimatedCost: preferred.estimatedCost == null && other.estimatedCost == null
        ? null
        : Math.max(preferred.estimatedCost || 0, other.estimatedCost || 0),
    });
  };

  for (const item of items) {
    const currentStock = Math.max(0, Number(item.currentStock) || 0);
    const minStock = Math.max(0, Number(item.minStock) || 0);
    if (minStock <= 0 || currentStock >= minStock) continue;

    const risk = stockoutByName.get(itemKey(item.name));
    const forecastQuantity = Math.max(0, Number(risk?.recommendedReorderQuantity) || 0);
    const suggestedQuantity = forecastQuantity > 0
      ? forecastQuantity
      : Math.max(Number(item.maxStock) - currentStock, minStock * 2);
    const urgency = currentStock <= 0 || risk?.severity === 'critical' ? 'high' : 'medium';
    addRecommendation({
      item: item.name,
      reason: currentStock <= 0
        ? 'Out of stock; reorder immediately.'
        : `Below minimum stock (${round2(currentStock)} of ${round2(minStock)} ${item.unit}).`,
      suggestedQty: `${round2(suggestedQuantity)} ${item.unit}`,
      urgency,
      estimatedCost: Number(item.averageCost) > 0
        ? round2(suggestedQuantity * Number(item.averageCost))
        : null,
    });
  }

  for (const risk of stockouts) {
    const name = risk.itemName.trim();
    if (!name) continue;
    const item = itemByName.get(itemKey(name));
    const forecastQuantity = Math.max(0, Number(risk.recommendedReorderQuantity) || 0);
    const suggestedQuantity = forecastQuantity > 0
      ? forecastQuantity
      : item
        ? Math.max(Number(item.maxStock) - Number(item.currentStock), Number(item.minStock) * 2)
        : 0;
    if (suggestedQuantity <= 0) continue;
    const days = Math.max(0, Math.floor(Number(risk.daysUntilDepletion) || 0));
    addRecommendation({
      item: name,
      reason: `Forecast indicates stockout in ${days} day${days === 1 ? '' : 's'}; replenish before depletion.`,
      suggestedQty: `${round2(suggestedQuantity)} ${item?.unit || 'units'}`,
      urgency: risk.severity === 'critical' || days <= 2 ? 'high' : 'medium',
      estimatedCost: item && Number(item.averageCost) > 0
        ? round2(suggestedQuantity * Number(item.averageCost))
        : null,
    });
  }

  const purchaseRecommendations = [...recommendations.values()].sort((a, b) =>
    urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.item.localeCompare(b.item),
  );

  const stockoutPredictions = stockouts
    .map((risk) => {
      const daysUntilOut = Math.max(0, Math.floor(Number(risk.daysUntilDepletion) || 0));
      const item = itemByName.get(itemKey(risk.itemName));
      return {
        item: risk.itemName,
        daysUntilOut,
        severity: risk.severity,
        currentStock: Math.max(0, Number(risk.currentStock) || Number(item?.currentStock) || 0),
        unit: item?.unit || 'units',
        suggestedAction: `Forecast indicates depletion in ${daysUntilOut} day${daysUntilOut === 1 ? '' : 's'}; replenish ${round2(Math.max(0, Number(risk.recommendedReorderQuantity) || 0))} ${item?.unit || 'units'}.`,
      };
    })
    .sort((a, b) => a.daysUntilOut - b.daysUntilOut || a.item.localeCompare(b.item));

  // Neutral next actions — advisory only, each tied to a concrete evidence row.
  const nextActions: string[] = [];
  for (const risk of expiryRisks.slice(0, 3)) {
    if (risk.canPromote) {
      nextActions.push(`${risk.itemName} expires in ${risk.daysUntilExpiry} day(s) — a promotion on dishes using it can move stock before expiry.`);
    } else {
      nextActions.push(`${risk.itemName} expires in ${risk.daysUntilExpiry} day(s) — plan usage or rotation now; promotion was not indicated by the data.`);
    }
  }
  for (const w of wastageSignals.slice(0, 2)) {
    nextActions.push(`Wastage hotspot: ${w.name} (${round2(w.qty)}${w.unit ? ` ${w.unit}` : ''} in the window) — review prep portions and storage.`);
  }
  if (purchaseRecommendations.length > 0) {
    const high = purchaseRecommendations.filter((r) => r.urgency === 'high').length;
    nextActions.push(
      high > 0
        ? `${high} high-urgency reorder${high === 1 ? '' : 's'} need attention today — confirm quantities in Purchasing before creating purchase orders.`
        : 'Review the reorder list and confirm quantities in Purchasing.',
    );
  }
  if (nextActions.length === 0 && hasEvidenceSources(evidence)) {
    // D1: only sources that actually returned data may be called healthy — an
    // unavailable source is reported as unavailable, never as "no risk".
    const healthy = availableSourceLabels(evidence);
    nextActions.push(
      `No immediate inventory actions are indicated — ${healthy.join(' and ')} look healthy.`,
    );
  }

  const sources = evidenceSources(evidence);
  const hasEvidence = Object.values(sources).some(Boolean);
  const actionCount = purchaseRecommendations.length + expiryRisks.length + wastageSignals.length;
  const summary = !hasEvidence
    ? 'Inventory data is unavailable, so no recommendations were generated.'
    : actionCount === 0
      ? 'No immediate inventory actions are indicated by the available data.'
      : summaryWithUnavailableSources(purchaseRecommendations.length, expiryRisks.length, wastageSignals.length, sources);

  return {
    mode: 'deterministic',
    status: hasEvidence ? 'ready' : 'insufficient_data',
    summary,
    purchaseRecommendations,
    stockoutPredictions,
    expiryRisks,
    wastageSignals,
    nextActions,
    evidenceSources: sources,
    generatedAt: evidence.generatedAt,
  };
}

function evidenceSources(evidence: InventoryAgentEvidence) {
  return {
    inventory: evidence.inventory.available,
    demandForecast: evidence.stockout.available,
    expiry: evidence.expiry.available,
    wastage: evidence.wastage.available,
  };
}

function hasEvidenceSources(evidence: InventoryAgentEvidence): boolean {
  return Object.values(evidenceSources(evidence)).some(Boolean);
}

/** Source labels for the capabilities that actually returned usable data (D1). */
function availableSourceLabels(evidence: InventoryAgentEvidence): string[] {
  const labels: string[] = [];
  if (evidence.inventory.available) labels.push('stock levels');
  if (evidence.stockout.available) labels.push('stockout forecast');
  if (evidence.expiry.available) labels.push('expiry');
  if (evidence.wastage.available) labels.push('wastage');
  return labels.length > 0 ? labels : ['the investigated sources'];
}

/**
 * D1: report counts ONLY for sources that returned data. A source that was
 * unavailable is named as unavailable — it is never rendered as a zero risk.
 */
function summaryWithUnavailableSources(
  reorders: number,
  expiryRisks: number,
  wastageSignals: number,
  sources: ReturnType<typeof evidenceSources>,
): string {
  const parts: string[] = [];
  if (sources.inventory || sources.demandForecast) {
    parts.push(`${reorders} reorder action${reorders === 1 ? '' : 's'}`);
  }
  if (sources.expiry) parts.push(`${expiryRisks} expiry risk${expiryRisks === 1 ? '' : 's'}`);
  if (sources.wastage) parts.push(`${wastageSignals} wastage signal${wastageSignals === 1 ? '' : 's'}`);

  const unavailable: string[] = [];
  if (!sources.inventory && !sources.demandForecast) unavailable.push('stock levels');
  if (!sources.expiry) unavailable.push('expiry');
  if (!sources.wastage) unavailable.push('wastage');
  const joined = unavailable.join(' and ');
  const tail = unavailable.length > 0
    ? ` ${joined.charAt(0).toUpperCase()}${joined.slice(1)} could not be determined from the available data.`
    : '';
  if (parts.length === 0) {
    return `No counts are available for the investigated sources.${tail}`;
  }
  return `${parts.join(', ')} identified from live inventory data.${tail}`;
}

export async function runInventoryAgent(ctx: ToolContext): Promise<InventoryAgentResult> {
  const generatedAt = new Date().toISOString();
  const [inventoryResult, stockoutResult, expiryResult, wastageResult] = await Promise.all([
    executeTool(getInventoryStatusToolDefinition, {}, ctx),
    executeTool(getStockoutRiskToolDefinition, { horizonDays: 14 }, ctx),
    executeTool(getExpiryRiskToolDefinition, { horizonDays: 30 }, ctx),
    executeTool(getWastageToolDefinition, { days: 60 }, ctx),
  ]);

  const inventory: InventoryStatusOutput = inventoryResult.ok
    ? (inventoryResult as { data: InventoryStatusOutput }).data
    : { available: false, reason: 'NO_INVENTORY_DATA', generatedAt };
  const stockout: StockoutRiskOutput = stockoutResult.ok
    ? (stockoutResult as { data: StockoutRiskOutput }).data
    : { available: false, reason: 'NO_STOCKOUT_DATA', generatedAt };
  const expiry: ExpiryRiskOutput = expiryResult.ok
    ? (expiryResult as { data: ExpiryRiskOutput }).data
    : { available: false, reason: 'NO_EXPIRY_DATA', generatedAt };
  const wastage: WastageOutput = wastageResult.ok
    ? (wastageResult as { data: WastageOutput }).data
    : { available: false, reason: 'NO_WASTAGE_DATA', generatedAt };

  return buildInventoryAgentResult({ inventory, stockout, expiry, wastage, generatedAt });
}
