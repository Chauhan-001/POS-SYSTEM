/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Inventory Routes — API endpoints for the Voice Inventory Management system.
 *
 * Route prefix: /api/voice-inventory
 *
 * Endpoints:
 *   POST /api/voice-inventory/parse     — Parse voice transcript into inventory action
 *   POST /api/voice-inventory/confirm   — Confirm/edit/cancel a parsed action
 *   GET  /api/voice-inventory/aliases   — List item aliases
 *   POST /api/voice-inventory/aliases   — Create/update item alias
 *   PUT  /api/voice-inventory/aliases/:id — Update alias by ID
 *   DELETE /api/voice-inventory/aliases/:id — Soft-delete alias
 *   POST /api/voice-inventory/aliases/bulk — Bulk create/update aliases
 *   GET  /api/voice-inventory/history   — Query voice action history
 *   GET  /api/voice-inventory/status    — Module status
 *
 * SECURITY:
 *   - All routes (except status) require authentication
 *   - All input is validated with Zod schemas
 *   - Rate limiting prevents abuse
 *   - Restaurant-scoped access control
 */

import { Router } from 'express';
import { requireAuth } from '../../../middleware/authMiddleware';
import { requireFeature } from '../../../middleware/subscriptionMiddleware';
import { validate } from '../../../middleware/validate';
import { voiceApiLimiter } from '../../../middleware/rateLimiter';
import {
  parseVoiceCommand,
  transcribeVoiceAudio,
  confirmVoiceAction,
  undoVoiceAction,
  listAliases,
  createAlias,
  updateAlias,
  deleteAlias,
  bulkCreateAliases,
  getVoiceHistory,
  getStatus,
  resolveSpokenProduct,
  learnCorrection,
  generateProductAliases,
  suggestNewProduct,
  listProductAliases,
  updateProductAliases,
  handleConverse,
  handleAnalytics,
  createProductFromVoice,
} from '../controllers/voiceInventoryController';
import {
  voiceParseRequestSchema,
  voiceTranscribeSchema,
  voiceConfirmSchema,
  voiceUndoSchema,
  aliasCreateSchema,
  aliasUpdateSchema,
  aliasBulkSchema,
  voiceHistorySchema,
  resolveProductSchema,
  learnSchema,
  generateAliasesSchema,
  suggestProductSchema,
  converseSchema,
  analyticsSchema,
  createProductFromVoiceSchema,
} from '../validators/voiceInventory';

const router = Router();

// ─── PUBLIC ENDPOINT ───────────────────────────────────────────────

/**
 * GET /api/voice-inventory/status
 * Check if the voice inventory module is operational.
 */
router.get('/status', getStatus);

// ─── AUTHENTICATED ENDPOINTS ───────────────────────────────────────
// All routes below require a valid JWT token.

/**
 * POST /api/voice-inventory/parse
 * Parse a voice transcript into a structured inventory action.
 */
router.post(
  '/parse',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: voiceParseRequestSchema }),
  voiceApiLimiter,
  parseVoiceCommand
);

/**
 * POST /api/voice-inventory/transcribe
 * Transcribe a base64 audio clip to text (Groq Whisper / STT provider).
 */
router.post(
  '/transcribe',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: voiceTranscribeSchema }),
  voiceApiLimiter,
  transcribeVoiceAudio
);

/**
 * POST /api/voice-inventory/confirm
 * Confirm, edit, or cancel a previously parsed voice action.
 * Only on "confirm" does inventory actually get updated.
 */
router.post(
  '/confirm',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: voiceConfirmSchema }),
  voiceApiLimiter,
  confirmVoiceAction
);

/**
 * POST /api/voice-inventory/undo
 * Undo a previously confirmed voice action (reverses the stock change).
 */
router.post(
  '/undo',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: voiceUndoSchema }),
  voiceApiLimiter,
  undoVoiceAction
);

// ─── ALIAS MANAGEMENT ──────────────────────────────────────────────

/**
 * GET /api/voice-inventory/aliases
 * List all item aliases for the current restaurant.
 */
router.get('/aliases', requireAuth, requireFeature('inventory'), listAliases);

/**
 * POST /api/voice-inventory/aliases
 * Create or update an item alias.
 */
router.post(
  '/aliases',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: aliasCreateSchema }),
  voiceApiLimiter,
  createAlias
);

/**
 * PUT /api/voice-inventory/aliases/:id
 * Update an existing alias entry.
 */
router.put(
  '/aliases/:id',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: aliasUpdateSchema }),
  voiceApiLimiter,
  updateAlias
);

/**
 * DELETE /api/voice-inventory/aliases/:id
 * Soft-delete an alias entry.
 */
router.delete('/aliases/:id', requireAuth, requireFeature('inventory'), voiceApiLimiter, deleteAlias);

/**
 * POST /api/voice-inventory/aliases/bulk
 * Bulk create or update aliases.
 */
router.post(
  '/aliases/bulk',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: aliasBulkSchema }),
  voiceApiLimiter,
  bulkCreateAliases
);

// ─── HISTORY ───────────────────────────────────────────────────────

/**
 * GET /api/voice-inventory/history
 * Query voice action history with optional filters.
 */
router.get(
  '/history',
  requireAuth,
  requireFeature('inventory'),
  validate({ query: voiceHistorySchema }),
  voiceApiLimiter,
  getVoiceHistory
);

// ─── PRODUCT RESOLUTION ENGINE ENDPOINTS ──────────────────────────

/**
 * POST /api/voice-inventory/resolve
 * Resolve a spoken item through the full 8-stage Product Resolution Engine.
 */
router.post(
  '/resolve',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: resolveProductSchema }),
  voiceApiLimiter,
  resolveSpokenProduct
);

/**
 * POST /api/voice-inventory/learn
 * Record a manual correction for self-learning.
 */
router.post(
  '/learn',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: learnSchema }),
  voiceApiLimiter,
  learnCorrection
);

/**
 * POST /api/voice-inventory/generate-aliases
 * On-demand AI alias generation for a product.
 */
router.post(
  '/generate-aliases',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: generateAliasesSchema }),
  voiceApiLimiter,
  generateProductAliases
);

/**
 * POST /api/voice-inventory/suggest-product
 * AI-powered new product suggestion for unmatched items.
 */
router.post(
  '/suggest-product',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: suggestProductSchema }),
  voiceApiLimiter,
  suggestNewProduct
);

// ─── PRODUCT ALIAS ADMIN ENDPOINTS ────────────────────────────────

/**
 * GET /api/voice-inventory/product-aliases
 * List voice/search aliases for all products (Admin UI).
 */
router.get(
  '/product-aliases',
  requireAuth,
  requireFeature('inventory'),
  voiceApiLimiter,
  listProductAliases
);

/**
 * PUT /api/voice-inventory/product-aliases/:id
 * Update a product's aliases (Admin UI).
 */
router.put(
  '/product-aliases/:id',
  requireAuth,
  requireFeature('inventory'),
  voiceApiLimiter,
  updateProductAliases
);

// ─── CONVERSATIONAL & ANALYTICS ENDPOINTS ─────────────────────────

/**
 * POST /api/voice-inventory/converse
 * Process a conversational multi-turn voice command.
 * Maintains context via conversationId.
 */
router.post(
  '/converse',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: converseSchema }),
  voiceApiLimiter,
  handleConverse
);

/**
 * GET /api/voice-inventory/analytics
 * Get voice analytics (resolution methods, confidence, top products, etc.).
 */
router.get(
  '/analytics',
  requireAuth,
  requireFeature('inventory'),
  validate({ query: analyticsSchema }),
  voiceApiLimiter,
  handleAnalytics
);

/**
 * POST /api/voice-inventory/products/new
 * Create a product from a voice suggestion (approve new product).
 * Generates aliases automatically.
 */
router.post(
  '/products/new',
  requireAuth,
  requireFeature('inventory'),
  validate({ body: createProductFromVoiceSchema }),
  voiceApiLimiter,
  createProductFromVoice
);

export default router;
