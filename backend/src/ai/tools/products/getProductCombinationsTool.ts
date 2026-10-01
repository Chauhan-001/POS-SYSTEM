/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getProductCombinationsTool.ts — Product pair affinities from real bills,
 * adapted from the existing market-basket analysis engine.
 */

import { z } from 'zod';
import { getProductAffinities } from '../../../services/basketAnalysisService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getProductCombinationsInputSchema = z
  .object({
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    lookbackDays: z.number().int().min(7).max(365).optional(),
    /** Max products to return (1–20). */
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export type GetProductCombinationsInput = z.infer<typeof getProductCombinationsInputSchema>;

export interface ProductCombinationsOutput {
  available: boolean;
  reason?: 'NO_BASKET_DATA';
  products?: Array<{
    productId: string;
    productName: string;
    category: string;
    topAssociation?: { item: string; confidence: number; lift: number; coOccurrence: number };
    associationCount: number;
  }>;
  generatedAt: string;
}

export async function executeGetProductCombinations(
  input: GetProductCombinationsInput,
  ctx: ToolContext,
): Promise<ProductCombinationsOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const affinities = await getProductAffinities({
      restaurantId: ctx.tenant.restaurantId,
      branchId: input.branchId,
      lookbackDays: input.lookbackDays,
    });
    if (!affinities || affinities.length === 0) {
      return { available: false, reason: 'NO_BASKET_DATA', generatedAt };
    }
    return {
      available: true,
      products: affinities.slice(0, input.limit ?? 10).map((a) => {
        const best = (a.associations || []).slice().sort((x, y) => y.confidence - x.confidence)[0];
        return {
          productId: a.productId,
          productName: a.productName,
          category: a.category,
          topAssociation: best
            ? { item: best.consequentName, confidence: best.confidence, lift: best.lift, coOccurrence: best.coOccurrenceCount }
            : undefined,
          associationCount: (a.associations || []).length,
        };
      }),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_BASKET_DATA', generatedAt };
  }
}

export const getProductCombinationsToolDefinition: ToolDefinition<GetProductCombinationsInput, ProductCombinationsOutput> = {
  name: 'getProductCombinations',
  category: 'products',
  access: 'read',
  meta: {
    description:
      'Products that are frequently bought together, from real bill baskets: per product the strongest association (item, confidence, lift, co-occurrences).',
    source: 'services/basketAnalysisService.ts → getProductAffinities (market-basket engine)',
  },
  inputSchema: getProductCombinationsInputSchema,
  execute: executeGetProductCombinations,
};
