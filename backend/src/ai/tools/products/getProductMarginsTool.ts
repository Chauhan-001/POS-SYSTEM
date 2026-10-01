/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getProductMarginsTool.ts — Per-product margin economics, adapted from the
 * authoritative cost engine (costIntelligenceCore.metrics →
 * productProfitability) — the same rows the offer-engine context carries.
 */

import { z } from 'zod';
import { costIntelligenceCore } from '../../../modules/recipes/services/costIntelligenceCore';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getProductMarginsInputSchema = z
  .object({
    /** Analysis window in days (7–180). */
    days: z.number().int().min(7).max(180).optional(),
    /** Only items sold at least this many times in the window. */
    minUnitsSold: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export type GetProductMarginsInput = z.infer<typeof getProductMarginsInputSchema>;

export interface ProductMarginsOutput {
  available: boolean;
  reason?: 'NO_MARGIN_DATA';
  products?: Array<{
    productId: string;
    productName: string;
    category?: string;
    sellingPrice: number;
    recipeCost: number;
    foodCostPercent: number;
    contributionMarginPercent: number;
    unitsSold: number;
    totalContribution: number;
  }>;
  generatedAt: string;
}

export async function executeGetProductMargins(
  input: GetProductMarginsInput,
  ctx: ToolContext,
): Promise<ProductMarginsOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const m = await costIntelligenceCore.metrics(ctx.tenant.restaurantId, { days: input.days ?? 60 });
    const rows = (m.productProfitability || []).map((r: any) => ({
      productId: String(r.productId),
      productName: String(r.productName),
      category: r.category || undefined,
      sellingPrice: Number(r.sellingPrice) || 0,
      recipeCost: Number(r.recipeCost) || 0,
      foodCostPercent: Number(r.foodCostPercent) || 0,
      contributionMarginPercent: Number(r.contributionMarginPercent) || 0,
      unitsSold: Number(r.unitsSold) || 0,
      totalContribution: Number(r.totalContribution) || 0,
    }));
    const filtered =
      input.minUnitsSold !== undefined
        ? rows.filter((r) => r.unitsSold >= (input.minUnitsSold ?? 0))
        : rows;
    if (filtered.length === 0) {
      return { available: false, reason: 'NO_MARGIN_DATA', generatedAt };
    }
    return { available: true, products: filtered, generatedAt };
  } catch {
    return { available: false, reason: 'NO_MARGIN_DATA', generatedAt };
  }
}

export const getProductMarginsToolDefinition: ToolDefinition<GetProductMarginsInput, ProductMarginsOutput> = {
  name: 'getProductMargins',
  category: 'products',
  access: 'read',
  meta: {
    description:
      'Per-product economics: selling price, recipe cost, food-cost %, contribution margin %, units sold and total contribution over a window.',
    source: 'modules/recipes/services/costIntelligenceCore.ts → metrics (authoritative cost engine)',
  },
  inputSchema: getProductMarginsInputSchema,
  execute: executeGetProductMargins,
};
