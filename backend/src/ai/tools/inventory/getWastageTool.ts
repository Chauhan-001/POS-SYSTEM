/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getWastageTool.ts — Real wastage observed in the kitchen, adapted from the
 * deterministic cost/margin engine (costIntelligenceCore.metrics) — the same
 * rows the margin/wastage context carries (wastage.topItems / items).
 */

import { z } from 'zod';
import { costIntelligenceCore } from '../../../modules/recipes/services/costIntelligenceCore';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getWastageInputSchema = z
  .object({
    /** Analysis window in days (7–180). */
    days: z.number().int().min(7).max(180).optional(),
  })
  .strict();

export type GetWastageInput = z.infer<typeof getWastageInputSchema>;

export interface WastageOutput {
  available: boolean;
  reason?: 'NO_WASTAGE_DATA';
  topItems?: Array<{ name: string; qty: number; unit?: string; cost: number }>;
  items?: Array<{
    name: string;
    unit?: string;
    qty: number;
    cost: number;
    prevQty?: number;
    prevCost?: number;
  }>;
  generatedAt: string;
}

export async function executeGetWastage(
  input: GetWastageInput,
  ctx: ToolContext,
): Promise<WastageOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const m = await costIntelligenceCore.metrics(ctx.tenant.restaurantId, { days: input.days ?? 60 });
    const topItems = (m.wastage?.topItems || []).map((w: any) => ({
      name: String(w.name),
      qty: Number(w.qty) || 0,
      unit: w.unit,
      cost: Number(w.cost) || 0,
    }));
    if (topItems.length === 0 && !(m.wastage?.items || []).length) {
      return { available: false, reason: 'NO_WASTAGE_DATA', generatedAt };
    }
    return {
      available: true,
      topItems,
      items: (m.wastage?.items || []).map((w: any) => ({
        name: String(w.name),
        unit: w.unit,
        qty: Number(w.qty) || 0,
        cost: Number(w.cost) || 0,
        prevQty: w.prevQty,
        prevCost: w.prevCost,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_WASTAGE_DATA', generatedAt };
  }
}

export const getWastageToolDefinition: ToolDefinition<GetWastageInput, WastageOutput> = {
  name: 'getWastage',
  category: 'inventory',
  access: 'read',
  meta: {
    description:
      'Wastage observed over a window: top wasted items by quantity and cost, with previous-period comparison when available.',
    source: 'modules/recipes/services/costIntelligenceCore.ts → metrics (authoritative cost engine)',
  },
  inputSchema: getWastageInputSchema,
  execute: executeGetWastage,
};
