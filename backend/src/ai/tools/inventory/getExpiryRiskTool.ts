/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getExpiryRiskTool.ts — Perishable batches approaching expiry, adapted from
 * the existing deterministic expiry engine
 * (inventoryDemandForecastingService.generateExpiryAlerts).
 */

import { z } from 'zod';
import { generateExpiryAlerts } from '../../../services/inventoryDemandForecastingService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getExpiryRiskInputSchema = z
  .object({
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    /** Look-ahead window in days (1–90). */
    horizonDays: z.number().int().min(1).max(90).optional(),
  })
  .strict();

export type GetExpiryRiskInput = z.infer<typeof getExpiryRiskInputSchema>;

export interface ExpiryRiskOutput {
  available: boolean;
  reason?: 'NO_EXPIRY_RISK';
  alerts?: Array<{
    itemId: string;
    itemName: string;
    currentStock: number;
    expiryDate: Date;
    daysUntilExpiry: number;
    severity: 'warning' | 'critical';
    canPromote: boolean;
    recommendedActions: string[];
  }>;
  generatedAt: string;
}

export async function executeGetExpiryRisk(
  input: GetExpiryRiskInput,
  ctx: ToolContext,
): Promise<ExpiryRiskOutput> {
  const generatedAt = new Date().toISOString();
  try {
    // Service is restaurant-scoped internally; branchId is only ever used as a
    // filter the service applies against this tenant's own inventory.
    const alerts = await generateExpiryAlerts(
      ctx.tenant.restaurantId,
      input.branchId,
      input.horizonDays ?? 30,
    );
    if (!alerts || alerts.length === 0) {
      return { available: false, reason: 'NO_EXPIRY_RISK', generatedAt };
    }
    return {
      available: true,
      alerts: alerts.map((a) => ({
        itemId: a.ingredientId,
        itemName: a.ingredientName,
        currentStock: a.currentStock,
        expiryDate: a.expiryDate,
        daysUntilExpiry: a.daysUntilExpiry,
        severity: a.severity,
        canPromote: a.canPromote,
        recommendedActions: a.recommendedActions,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_EXPIRY_RISK', generatedAt };
  }
}

export const getExpiryRiskToolDefinition: ToolDefinition<GetExpiryRiskInput, ExpiryRiskOutput> = {
  name: 'getExpiryRisk',
  category: 'inventory',
  access: 'read',
  meta: {
    description:
      'Inventory batches approaching expiry within a horizon (default 30 days): item, stock, expiry date, days remaining, severity and whether promotion is allowed.',
    source: 'services/inventoryDemandForecastingService.ts → generateExpiryAlerts',
  },
  inputSchema: getExpiryRiskInputSchema,
  execute: executeGetExpiryRisk,
};
