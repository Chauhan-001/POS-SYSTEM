/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * tenantContext.ts — Tenant identity for every AI operation.
 *
 * HARD RULE (spec §33): the LLM must never choose the restaurantId. The
 * authenticated application context supplies tenant identity, which flows
 * into every tool execution via ToolContext. Tools receive tenantId ONLY
 * through this context — never as model-provided arguments.
 */

import type { Request } from 'express';

export interface AiTenantContext {
  /** Authenticated tenant — resolved from the request, never from the model. */
  restaurantId: string;
  /** Authenticated principal (owner/employee id) for audit trails. */
  actorId?: string;
  actorName?: string;
  /** Optional branch scope, validated upstream via resolveBranchScope. */
  branchId?: string;
}

/**
 * Extract tenant identity from an authenticated express request.
 * Uses the same req.user.restaurantId contract as middleware/authMiddleware.
 */
export function tenantContextFromRequest(req: Request): AiTenantContext {
  const user = (req as any).user as
    | { id?: string; userId?: string; restaurantId?: string; name?: string }
    | undefined;
  const restaurantId = user?.restaurantId ? String(user.restaurantId) : '';
  if (!restaurantId) {
    // Guards.ts-style explicit failure: AI endpoints are always tenant-scoped.
    throw new Error('AI request rejected: no authenticated tenant (restaurantId) on request');
  }
  return {
    restaurantId,
    actorId: user?.id ? String(user.id) : user?.userId ? String(user.userId) : undefined,
    actorName: user?.name,
  };
}
