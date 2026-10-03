/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgent.test.ts — acceptance for the deterministic inventory agent:
 * evidence-backed reorders, forecast-merged urgency, honest insufficient_data,
 * and next actions that never fabricate beyond the evidence rows.
 */

import { describe, expect, it } from 'vitest';
import { buildInventoryAgentResult, type InventoryAgentEvidence } from '../inventoryAgent';

const baseEvidence = (): InventoryAgentEvidence => ({
  generatedAt: '2026-10-03T12:00:00.000Z',
  inventory: {
    available: true,
    generatedAt: '2026-10-03T12:00:00.000Z',
    items: [
      { id: 'rice-id', name: 'Rice', category: 'Raw material', currentStock: 2.456, minStock: 5, maxStock: 20, unit: 'kg', price: 0, averageCost: 42.125 },
      { id: 'oil-id', name: 'Oil', category: 'Raw material', currentStock: 14, minStock: 5, maxStock: 20, unit: 'L', price: 0, averageCost: 120 },
    ],
  },
  stockout: {
    available: true,
    generatedAt: '2026-10-03T12:00:00.000Z',
    alerts: [{
      itemId: 'rice-id',
      itemName: 'Rice',
      currentStock: 2.456,
      predictedDepletionDate: new Date('2026-10-04T00:00:00.000Z'),
      daysUntilDepletion: 1,
      severity: 'critical',
      recommendedReorderQuantity: 10.126,
      contributingMenuItems: ['Rice bowl'],
    }],
  },
  expiry: { available: false, reason: 'NO_EXPIRY_RISK', generatedAt: '2026-10-03T12:00:00.000Z' },
  wastage: { available: false, reason: 'NO_WASTAGE_DATA', generatedAt: '2026-10-03T12:00:00.000Z' },
});

describe('buildInventoryAgentResult', () => {
  it('ranks evidence-backed stock actions and merges duplicate low-stock and forecast signals', () => {
    const result = buildInventoryAgentResult(baseEvidence());

    expect(result.mode).toBe('deterministic');
    expect(result.status).toBe('ready');
    expect(result.purchaseRecommendations).toHaveLength(1);
    expect(result.purchaseRecommendations[0]).toMatchObject({
      item: 'Rice',
      urgency: 'high',
      suggestedQty: '10.13 kg',
      estimatedCost: 426.56,
    });
    expect(result.stockoutPredictions[0]).toMatchObject({
      item: 'Rice',
      daysUntilOut: 1,
      severity: 'critical',
    });
    expect(result.nextActions.length).toBeGreaterThan(0);
    expect(result.evidenceSources).toEqual({ inventory: true, demandForecast: true, expiry: false, wastage: false });
  });

  it('does not invent recommendations when all evidence sources are unavailable', () => {
    const evidence = baseEvidence();
    evidence.inventory = { available: false, reason: 'NO_INVENTORY_DATA', generatedAt: evidence.generatedAt };
    evidence.stockout = { available: false, reason: 'NO_STOCKOUT_RISK', generatedAt: evidence.generatedAt };

    const result = buildInventoryAgentResult(evidence);

    expect(result.status).toBe('insufficient_data');
    expect(result.purchaseRecommendations).toEqual([]);
    expect(result.stockoutPredictions).toEqual([]);
    expect(result.summary).toMatch(/unavailable/i);
    expect(result.nextActions).toEqual([]);
  });

  it('keeps forecast warnings at medium urgency and does not invent a cost when price data is missing', () => {
    const evidence = baseEvidence();
    evidence.inventory.items = [{
      id: 'beans-id',
      name: 'Beans',
      category: 'Raw material',
      currentStock: 4,
      minStock: 10,
      maxStock: 20,
      unit: 'kg',
      price: 0,
      averageCost: 0,
    }];
    evidence.stockout.alerts = [{
      itemId: 'beans-id',
      itemName: 'Beans',
      currentStock: 4,
      predictedDepletionDate: new Date('2026-10-08T00:00:00.000Z'),
      daysUntilDepletion: 5,
      severity: 'warning',
      recommendedReorderQuantity: 0,
      contributingMenuItems: ['Bean curry'],
    }];

    const result = buildInventoryAgentResult(evidence);

    expect(result.purchaseRecommendations).toHaveLength(1);
    expect(result.purchaseRecommendations[0]).toMatchObject({
      item: 'Beans',
      urgency: 'medium',
      suggestedQty: '20 kg',
      estimatedCost: null,
    });
  });

  it('keeps items at or above minimum stock out of the reorder list', () => {
    const evidence = baseEvidence();
    evidence.inventory.items = [
      { id: 'oil-id', name: 'Oil', category: 'Raw material', currentStock: 14, minStock: 5, maxStock: 20, unit: 'L', price: 0, averageCost: 120 },
    ];
    evidence.stockout.alerts = [];

    const result = buildInventoryAgentResult(evidence);

    expect(result.purchaseRecommendations).toEqual([]);
    expect(result.status).toBe('ready');
    expect(result.summary).toMatch(/no immediate inventory actions/i);
  });

  it('turns expiry and wastage evidence into advisory next actions only', () => {
    const evidence = baseEvidence();
    evidence.expiry = {
      available: true,
      generatedAt: evidence.generatedAt,
      alerts: [{
        itemId: 'paneer-id',
        itemName: 'Paneer',
        currentStock: 3,
        expiryDate: new Date('2026-10-05T00:00:00.000Z'),
        daysUntilExpiry: 2,
        severity: 'warning',
        canPromote: true,
        recommendedActions: ['promote'],
      }],
    };
    evidence.wastage = {
      available: true,
      generatedAt: evidence.generatedAt,
      topItems: [{ name: 'Onion', qty: 4.2, unit: 'kg', cost: 84 }],
    };

    const result = buildInventoryAgentResult(evidence);

    expect(result.expiryRisks).toHaveLength(1);
    expect(result.wastageSignals).toHaveLength(1);
    expect(result.nextActions.some((a) => a.includes('Paneer'))).toBe(true);
    expect(result.nextActions.some((a) => a.includes('Onion'))).toBe(true);
    // Wastage/expiry alone never create a purchase recommendation.
    expect(result.purchaseRecommendations).toHaveLength(1); // still just Rice
  });
});
