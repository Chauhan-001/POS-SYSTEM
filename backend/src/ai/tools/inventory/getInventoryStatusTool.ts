/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getInventoryStatusTool.ts — Stock levels for stock-tracked items, adapted
 * from the canonical context builder (buildInventoryContext) — the same
 * deterministic inventory view the offer engine consumes (spec §7).
 */

import { z } from 'zod';
import { AiError } from '../../shared/aiErrors';
import {
  buildInventoryContext,
  loadMenuProducts,
  resolveBranchScope,
} from '../../../services/recommendationContext';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getInventoryStatusInputSchema = z
  .object({
    /** Optional branch scope — validated against the tenant before use. */
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  })
  .strict();

export type GetInventoryStatusInput = z.infer<typeof getInventoryStatusInputSchema>;

export interface InventoryStatusOutput {
  available: boolean;
  reason?: 'NO_INVENTORY_DATA';
  items?: Array<{
    id: string;
    name: string;
    category: string;
    currentStock: number;
    minStock: number;
    maxStock: number;
    unit: string;
    price: number;
    averageCost: number;
  }>;
  generatedAt: string;
}

export async function executeGetInventoryStatus(
  input: GetInventoryStatusInput,
  ctx: ToolContext,
): Promise<InventoryStatusOutput> {
  const restaurantId = ctx.tenant.restaurantId;
  const generatedAt = new Date().toISOString();

  // Branch scope must belong to this tenant — never trusted from the caller.
  if (input.branchId) {
    const scope = await resolveBranchScope(restaurantId, input.branchId);
    if (!scope) throw new AiError('TOOL_TENANT_MISMATCH', 'branchId does not belong to this restaurant');
  }

  try {
    const products = await loadMenuProducts(restaurantId);
    const items = await buildInventoryContext(restaurantId, products as any[]);
    if (!items || items.length === 0) {
      return { available: false, reason: 'NO_INVENTORY_DATA', generatedAt };
    }
    return { available: true, items, generatedAt };
  } catch {
    // Inventory is an optional signal upstream too (the context builder
    // swallows its failure) — an unavailable state beats a fabricated one.
    return { available: false, reason: 'NO_INVENTORY_DATA', generatedAt };
  }
}

export const getInventoryStatusToolDefinition: ToolDefinition<GetInventoryStatusInput, InventoryStatusOutput> = {
  name: 'getInventoryStatus',
  category: 'inventory',
  access: 'read',
  meta: {
    description:
      'Stock levels for all stock-tracked menu items: current, minimum and maximum stock, unit, selling price and average cost per item.',
    source: 'services/recommendationContext.ts → buildInventoryContext (canonical offer-engine inventory view)',
  },
  inputSchema: getInventoryStatusInputSchema,
  execute: executeGetInventoryStatus,
};
