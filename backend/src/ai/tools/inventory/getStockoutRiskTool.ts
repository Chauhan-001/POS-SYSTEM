/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getStockoutRiskTool.ts — Predicted ingredient stockouts, adapted from the
 * existing consumption-forecast engine (generateStockoutAlerts).
 */

import { z } from 'zod';
import { assessStockoutRisk } from '../../../services/inventoryDemandForecastingService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getStockoutRiskInputSchema = z
  .object({
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    /** Forecast horizon in days (1–30). */
    horizonDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export type GetStockoutRiskInput = z.infer<typeof getStockoutRiskInputSchema>;

export interface StockoutRiskOutput {
  /** True when the forecast engine had usable input and completed. An empty
   *  `alerts` array on an available source means "checked, nothing at risk" —
   *  NOT "unavailable". */
  available: boolean;
  reason?: 'NO_STOCKOUT_DATA';
  alerts?: Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    predictedDepletionDate: Date;
    daysUntilDepletion: number;
    severity: 'warning' | 'critical';
    recommendedReorderQuantity: number;
    contributingMenuItems: string[];
  }>;
  generatedAt: string;
}

export async function executeGetStockoutRisk(
  input: GetStockoutRiskInput,
  ctx: ToolContext,
): Promise<StockoutRiskOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const { assessed, alerts } = await assessStockoutRisk(
      ctx.tenant.restaurantId,
      input.branchId,
      input.horizonDays ?? 14,
    );
    // No usable input at all (no recipes / consumption history) → the source
    // is genuinely unavailable. An assessed source with no at-risk items is
    // available with an empty alert list.
    if (!assessed) {
      return { available: false, reason: 'NO_STOCKOUT_DATA', generatedAt };
    }
    return {
      available: true,
      alerts: alerts.map((a) => ({
        itemId: a.ingredientId,
        itemName: a.ingredientName,
        currentStock: a.currentStock,
        predictedDepletionDate: a.predictedDepletionDate,
        daysUntilDepletion: a.daysUntilDepletion,
        severity: a.severity,
        recommendedReorderQuantity: a.recommendedReorderQuantity,
        contributingMenuItems: a.contributingMenuItems,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_STOCKOUT_DATA', generatedAt };
  }
}

export const getStockoutRiskToolDefinition: ToolDefinition<GetStockoutRiskInput, StockoutRiskOutput> = {
  name: 'getStockoutRisk',
  category: 'inventory',
  access: 'read',
  meta: {
    description:
      'Ingredients predicted to run out within a horizon (default 14 days) based on consumption forecasts: days until stockout, projected shortfall and severity.',
    source: 'services/inventoryDemandForecastingService.ts → generateStockoutAlerts',
  },
  inputSchema: getStockoutRiskInputSchema,
  execute: executeGetStockoutRisk,
};
