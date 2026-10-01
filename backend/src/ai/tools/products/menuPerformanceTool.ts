/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * menuPerformanceTool.ts — Menu engineering classification (stars,
 * plowhorses, puzzles, dogs) adapted from the existing analyzer.
 */

import { z } from 'zod';
import { analyzeMenuEngineering } from '../../../services/menuEngineeringService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getMenuPerformanceInputSchema = z
  .object({
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    lookbackDays: z.number().int().min(7).max(365).optional(),
    /** Minimum units sold for an item to be classified (service default 3). */
    minSampleSize: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type GetMenuPerformanceInput = z.infer<typeof getMenuPerformanceInputSchema>;

export interface MenuPerformanceOutput {
  available: boolean;
  reason?: 'NO_MENU_PERFORMANCE_DATA';
  items?: Array<{
    productId: string;
    productName: string;
    category: string;
    classification: string;
    contributionMarginPercent: number;
    dailyUnits: number;
    dailyRevenue: number;
    trend: string;
    recommendedActions: string[];
  }>;
  generatedAt: string;
}

export async function executeGetMenuPerformance(
  input: GetMenuPerformanceInput,
  ctx: ToolContext,
): Promise<MenuPerformanceOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const items = await analyzeMenuEngineering({
      restaurantId: ctx.tenant.restaurantId,
      branchId: input.branchId,
      lookbackDays: input.lookbackDays,
      minSampleSize: input.minSampleSize,
    });
    if (!items || items.length === 0) {
      return { available: false, reason: 'NO_MENU_PERFORMANCE_DATA', generatedAt };
    }
    return {
      available: true,
      items: items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        category: i.category,
        classification: i.classification,
        contributionMarginPercent: i.contributionMarginPercent,
        dailyUnits: i.dailyUnits,
        dailyRevenue: Math.round(i.dailyRevenue),
        trend: i.trend,
        recommendedActions: i.recommendedActions,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_MENU_PERFORMANCE_DATA', generatedAt };
  }
}

export const getMenuPerformanceToolDefinition: ToolDefinition<GetMenuPerformanceInput, MenuPerformanceOutput> = {
  name: 'getMenuPerformance',
  category: 'products',
  access: 'read',
  meta: {
    description:
      'Menu engineering classes per item (star / plowhorse / puzzle / dog) with contribution margin %, units and revenue per day, trend, and the service\'s own recommended actions.',
    source: 'services/menuEngineeringService.ts → analyzeMenuEngineering',
  },
  inputSchema: getMenuPerformanceInputSchema,
  execute: executeGetMenuPerformance,
};
