/**
 * =============================================================================
 *  recipes.ts — Recipe Manager Module Routes (Phase 19)
 * =============================================================================
 *
 * Paths:
 *   /api/recipes/*                  — recipe CRUD, versions, lifecycle, costing
 *   /api/recipe-consumption/*       — theoretical consumption + reconciliation
 *   /api/profitability/*            — product / offer profitability
 *
 * Access:
 *   - Reads (list/get/cost/profitability/consumption) : any authenticated staff
 *   - Writes (create/update/activate/archive/duplicate/delete/recalc) :
 *     Owner / Manager / Inventory roles
 *
 * Every handler derives the tenant from the authenticated user — the client
 * never supplies a restaurantId.
 * =============================================================================
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { requireFeature } from '../../../middleware/subscriptionMiddleware';
import { validate } from '../../../middleware/validate';
import { cached } from '../../../utils/ResponseCache';
import * as r from '../controllers/recipeController';
import * as c from '../controllers/consumptionController';
import * as p from '../controllers/profitabilityController';
import * as cs from '../controllers/costSettingsController';
import * as ai from '../controllers/recipeAiController';
import * as ci from '../controllers/costIntelligenceController';
import {
  createRecipeSchema,
  updateRecipeSchema,
  recipeQuerySchema,
  recipeParamsSchema,
  recalcSchema,
  dateRangeQuerySchema,
  costSettingsSchema,
} from '../validators/recipe';

const router = Router();
const writeRole = requireRole('Owner', 'Manager', 'Inventory');

// ─── Recipes ─────────────────────────────────────────────────────
router.get('/recipes', requireAuth, requireFeature('inventory'), validate({ query: recipeQuerySchema }), cached({ ttlMs: 15_000, tags: ['recipes'] }), r.listRecipes);
router.get('/recipes/:id', requireAuth, requireFeature('inventory'), validate({ params: recipeParamsSchema }), r.getRecipe);
router.get('/recipes/:id/versions', requireAuth, requireFeature('inventory'), validate({ params: recipeParamsSchema }), cached({ ttlMs: 30_000, tags: ['recipes'] }), r.getRecipeVersions);
router.get('/recipes/:id/cost', requireAuth, requireFeature('inventory'), validate({ params: recipeParamsSchema }), cached({ ttlMs: 15_000, tags: ['recipes'] }), r.calculateCost);
router.post('/recipes', requireAuth, writeRole, requireFeature('inventory'), validate({ body: createRecipeSchema }), r.createRecipe);
router.put('/recipes/:id', requireAuth, writeRole, requireFeature('inventory'), validate({ params: recipeParamsSchema, body: updateRecipeSchema }), r.updateRecipe);
router.post('/recipes/:id/activate', requireAuth, writeRole, requireFeature('inventory'), validate({ params: recipeParamsSchema }), r.activateRecipe);
router.post('/recipes/:id/archive', requireAuth, writeRole, requireFeature('inventory'), validate({ params: recipeParamsSchema }), r.archiveRecipe);
router.post('/recipes/:id/duplicate', requireAuth, writeRole, requireFeature('inventory'), validate({ params: recipeParamsSchema }), r.duplicateRecipe);
router.delete('/recipes/:id', requireAuth, writeRole, requireFeature('inventory'), validate({ params: recipeParamsSchema }), r.deleteRecipe);

// ─── Dependency-aware recalculation ──────────────────────────────
router.post('/recipes/recalculate', requireAuth, writeRole, requireFeature('inventory'), validate({ body: recalcSchema }), r.recalculateForIngredient);

// ─── AI-assisted recipe creation (text + voice transcript) ───────
router.post('/recipes/ai/quick-create', requireAuth, writeRole, requireFeature('inventory'), ai.quickCreateDraft);
router.post('/recipes/ai/search', requireAuth, requireFeature('inventory'), ai.searchInventory);

// ─── Restaurant-level cost settings (layered cost model) ─────────
router.get('/cost-settings', requireAuth, requireFeature('inventory'), cs.getCostSettings);
router.put('/cost-settings', requireAuth, writeRole, requireFeature('inventory'), validate({ body: costSettingsSchema }), cs.updateCostSettings);
router.get('/cost-settings/calibrate', requireAuth, writeRole, requireFeature('inventory'), cs.calibrateCostSettings);

// ─── Consumption (theoretical) ───────────────────────────────────
router.get('/recipe-consumption', requireAuth, requireFeature('inventory'), validate({ query: dateRangeQuerySchema }), cached({ ttlMs: 30_000, tags: ['recipe-consumption'] }), c.listConsumptions);
router.get('/recipe-consumption/bill/:billId', requireAuth, requireFeature('inventory'), c.consumptionByBill);
router.get('/recipe-consumption/reconcile', requireAuth, requireFeature('inventory'), validate({ query: dateRangeQuerySchema }), cached({ ttlMs: 60_000, tags: ['recipe-consumption'] }), c.reconcile);

// ─── Profitability ───────────────────────────────────────────────
router.get('/profitability/products', requireAuth, requireFeature('analytics'), validate({ query: dateRangeQuerySchema }), cached({ ttlMs: 30_000, tags: ['profitability'] }), p.productProfitability);
router.get('/profitability/products/:productId/margin', requireAuth, requireFeature('analytics'), p.productMargin);
router.get('/profitability/offers/:offerId', requireAuth, requireFeature('analytics'), p.offerProfitability);
router.post('/profitability/offers/preview', requireAuth, writeRole, requireFeature('analytics'), p.offerPreview);
// Read-only order-screen aid — any authenticated staff (cashier included) may
// see the cost/contribution of the current bill when an offer is applied.
router.post('/profitability/bill-preview', requireAuth, requireFeature('analytics'), p.billPreview);
router.post('/profitability/offers/assistant', requireAuth, writeRole, requireFeature('analytics'), ci.offerAssistant);
router.post('/profitability/combos/assistant', requireAuth, writeRole, requireFeature('analytics'), ci.comboAssistant);

// ─── Cost intelligence (deterministic metrics + AI insights) ─────
router.get('/cost-intelligence', requireAuth, requireFeature('analytics'), cached({ ttlMs: 60_000, tags: ['cost-intelligence'] }), ci.costIntelligence);
router.post('/cost-intelligence/insights', requireAuth, requireFeature('analytics'), ci.costInsights);

export default router;
