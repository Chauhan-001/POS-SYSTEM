/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getSalesTrendsTool.ts — Phase 2 reference tool.
 *
 * Adapts the EXISTING authoritative sales aggregation
 * (services/recommendationContext.ts → buildSalesContext — the same function
 * the deterministic offer engine consumes). No logic is duplicated here; the
 * tool adds the AI platform contract: tenant from ToolContext, schema-validated
 * arguments, explicit unavailable states (spec §7, §34).
 */

import { z } from 'zod';
import { AiError } from '../../shared/aiErrors';
import {
  buildSalesContext,
  loadMenuProducts,
  resolveBranchScope,
} from '../../../services/recommendationContext';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getSalesTrendsInputSchema = z
  .object({
    /** Optional branch scope — validated against the tenant before use. */
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'branchId must be a 24-hex ObjectId').optional(),
  })
  .strict();

/** Mirrors RecommendationContext['sales'] — the authoritative sales shape. */
export const getSalesTrendsOutputSchema = z.object({
  available: z.literal(true),
  scope: z.enum(['tenant', 'branch']),
  dailyRevenue: z.number(),
  weeklyRevenue: z.number(),
  monthlyRevenue: z.number(),
  orderCount: z.number(),
  averageOrderValue: z.number(),
  topCategories: z.array(z.object({ name: z.string(), revenue: z.number(), qty: z.number() })),
  weakCategories: z.array(z.object({ name: z.string(), revenue: z.number(), qty: z.number() })),
  weekdayPerformance: z.array(z.number()).length(7),
  hourlyPerformance: z.array(z.number()).length(24),
  generatedAt: z.string(),
});

export const getSalesTrendsOutputUnavailableSchema = z.object({
  available: z.literal(false),
  reason: z.enum(['NO_SALES_DATA', 'SERVICE_ERROR']),
  generatedAt: z.string(),
});

export type GetSalesTrendsInput = z.infer<typeof getSalesTrendsInputSchema>;
export type GetSalesTrendsOutput =
  | z.infer<typeof getSalesTrendsOutputSchema>
  | z.infer<typeof getSalesTrendsOutputUnavailableSchema>;

export const getSalesTrendsToolDefinition: ToolDefinition<GetSalesTrendsInput, GetSalesTrendsOutput> = {
  name: 'getSalesTrends',
  category: 'sales',
  access: 'read',
  meta: {
    description:
      'Revenue trends for the restaurant: daily/weekly/monthly revenue, order count, average order value, top and weak categories, weekday and hourly performance over the last 30 days.',
    source: 'services/recommendationContext.ts → buildSalesContext (authoritative offer-engine context)',
  },
  inputSchema: getSalesTrendsInputSchema,
  execute: executeGetSalesTrends,
};

export async function executeGetSalesTrends(
  input: GetSalesTrendsInput,
  ctx: ToolContext,
): Promise<GetSalesTrendsOutput> {
  const restaurantId = ctx.tenant.restaurantId;
  const generatedAt = new Date().toISOString();

  // Branch scope is validated against the tenant: a branchId that does not
  // belong to this restaurant is rejected, never silently trusted (spec §33).
  let branchId: string | undefined;
  if (input.branchId) {
    const scope = await resolveBranchScope(restaurantId, input.branchId);
    if (!scope) throw new AiError('TOOL_TENANT_MISMATCH', 'branchId does not belong to this restaurant');
    branchId = scope.branchId;
  }

  try {
    const products = await loadMenuProducts(restaurantId);
    const sales = await buildSalesContext(restaurantId, products as any[], branchId);

    if (!sales) {
      // Honest empty state — the agent reasons over "no data", never a zero
      // that could be mistaken for real revenue.
      return { available: false, reason: 'NO_SALES_DATA', generatedAt };
    }

    return {
      available: true,
      scope: branchId ? 'branch' : 'tenant',
      ...sales,
      generatedAt,
    };
  } catch (err) {
    if (err instanceof AiError) throw err;
    // Upstream failure → explicit unavailable state (spec §34).
    return { available: false, reason: 'SERVICE_ERROR', generatedAt };
  }
}
