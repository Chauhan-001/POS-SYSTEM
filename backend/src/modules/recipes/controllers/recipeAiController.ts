/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeAiController — HTTP surface for AI-assisted recipe creation (Phase F/G/H).
 *
 * Boundaries (never violated):
 *   - The LLM extracts structure only. It NEVER writes to the database.
 *   - Nothing is saved until the user confirms the reviewable draft.
 *   - Tenant is derived from the authenticated user, never the client.
 */

import { NextFunction, Request, Response } from 'express';
import { recipeAiService } from '../services/recipeAiService';

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function userOf(req: Request): { restaurantId: string } {
  const u = (req as any).user as { restaurantId?: string } | undefined;
  return (u || {}) as { restaurantId: string };
}

/**
 * POST /api/recipes/ai/quick-create
 * Natural language (text OR voice transcript) → reviewable draft.
 * Returns matched (HIGH confidence) + needsAttention (MEDIUM/LOW/mismatch)
 * components with deterministic cost previews. Saves nothing.
 */
export const quickCreateDraft = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const { productId, text } = req.body as { productId?: string; text?: string };
  if (!productId) {
    res.status(400).json({ error: 'productId is required' });
    return;
  }
  const draft = await recipeAiService.quickCreate(restaurantId, String(text || ''), String(productId));
  res.json({ data: draft });
});

/**
 * POST /api/recipes/ai/search
 * Tenant-scoped inventory search used to resolve LOW-confidence / unmatched
 * ingredients manually before confirming a draft.
 */
export const searchInventory = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const { query } = req.body as { query?: string };
  const results = await recipeAiService.searchInventory(restaurantId, String(query || ''));
  res.json({ data: results });
});
