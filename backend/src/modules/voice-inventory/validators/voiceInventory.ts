/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice Inventory Validation — Zod schemas for all voice inventory API requests.
 * Validates all incoming data before it reaches any service.
 */

import { z } from 'zod';

// ====================================================================
// PARSED ITEM SCHEMA
// ====================================================================

const parsedItemSchema = z
  .object({
    item: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    quantity: z.number().min(0).max(100000),
    unit: z.string().max(20).optional(),
    canonicalName: z.string().max(200).optional(),
  })
  .refine((d) => d.item || d.name, {
    message: 'Either item or name is required',
    path: ['item'],
  });

// ====================================================================
// API REQUEST SCHEMAS
// ====================================================================

/**
 * POST /api/voice-inventory/parse
 * Send a transcript or audio to be parsed by the AI.
 */
export const voiceParseRequestSchema = z.object({
  transcript: z.string().min(1).max(2000).optional(),
  audio: z.string().optional(), // Base64 encoded audio
  audioMimeType: z.string().max(50).optional(),
  language: z
    .enum(['en', 'hi', 'hi-en'])
    .optional()
    .default('hi-en'),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        unit: z.string().max(20).optional(),
      })
    )
    .max(500)
    .optional(),
}).refine(
  (data) => data.transcript || data.audio,
  { message: 'Either transcript or audio is required' }
);

/**
 * POST /api/voice-inventory/transcribe
 * Transcribe a base64 audio clip to text (Groq Whisper / STT provider).
 */
export const voiceTranscribeSchema = z.object({
  audio: z.string().min(1).max(50_000_000), // base64 audio (max ~37MB raw)
  audioMimeType: z.string().max(50).optional(),
  language: z
    .enum(['en', 'hi', 'hi-en'])
    .optional()
    .default('hi-en'),
});

/**
 * POST /api/voice-inventory/confirm
 * Confirm, edit, or cancel a parsed voice action.
 */
export const voiceConfirmSchema = z.object({
  logId: z.string().min(1),
  action: z.enum(['confirm', 'edit', 'cancel', 'clarify']),
  editedItems: z.array(parsedItemSchema).max(20).optional(),
  clarification: z.string().max(500).optional(),
});

/**
 * POST /api/voice-inventory/aliases
 * Add or update item aliases for the restaurant.
 */
export const aliasCreateSchema = z.object({
  canonicalName: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(100)).min(1).max(100),
  unit: z.string().max(20).optional().default('pcs'),
});

/**
 * POST /api/voice-inventory/aliases/bulk
 * Bulk create/update item aliases.
 */
export const aliasBulkSchema = z.object({
  aliases: z.array(aliasCreateSchema).min(1).max(100),
});

/**
 * PUT /api/voice-inventory/aliases/:id
 * Update an existing alias entry.
 */
export const aliasUpdateSchema = z.object({
  aliases: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
  unit: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/voice-inventory/history
 * Query voice action history with filters.
 */
export const voiceHistorySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
  intent: z
    .enum([
      'inventory_add',
      'inventory_remove',
      'inventory_adjust',
      'inventory_waste',
      'purchase_reminder',
      'supplier_update',
      'unknown',
    ])
    .optional(),
  status: z.enum(['pending', 'confirmed', 'rejected', 'clarified']).optional(),
  from: z.string().optional(), // ISO date
  to: z.string().optional(),   // ISO date
});

// ====================================================================
// NEW PRODUCT RESOLUTION ENGINE SCHEMAS
// ====================================================================

/**
 * POST /api/voice-inventory/resolve
 * Resolve a spoken item through the full Product Resolution Engine.
 */
export const resolveProductSchema = z.object({
  transcript: z.string().min(1).max(2000),
  restaurantId: z.string().optional(),
});

/**
 * POST /api/voice-inventory/learn
 * Record a manual correction to improve the self-learning system.
 */
export const learnSchema = z.object({
  spokenName: z.string().min(1).max(300),
  productId: z.string().min(1),
  source: z.enum(['confirmation_override', 'product_picker', 'admin_edit']).optional().default('confirmation_override'),
});

/**
 * POST /api/voice-inventory/generate-aliases
 * On-demand: generate multilingual aliases for a product.
 */
export const generateAliasesSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  existingAliases: z.array(z.string().max(200)).max(100).optional(),
});

/**
 * POST /api/voice-inventory/suggest-product
 * AI-powered new product suggestion for an unmatched spoken name.
 */
export const suggestProductSchema = z.object({
  spokenName: z.string().min(1).max(200),
  transcript: z.string().min(1).max(2000),
  existingCategories: z.array(z.string().max(100)).max(200).default([]),
});

// ====================================================================
// CONVERSATIONAL & ANALYTICS SCHEMAS
// ====================================================================

/**
 * POST /api/voice-inventory/converse
 * Multi-turn conversational voice command processing.
 */
export const converseSchema = z.object({
  transcript: z.string().min(1).max(2000),
  conversationId: z.string().min(1).max(64).optional(),
  language: z
    .enum(['en', 'hi', 'hi-en'])
    .optional()
    .default('hi-en'),
  skipLLM: z.boolean().optional().default(false),
});

/**
 * GET /api/voice-inventory/analytics
 * Voice analytics query parameters.
 */
export const analyticsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * POST /api/voice-inventory/products/new
 * Create a new product from a voice suggestion.
 */
export const createProductFromVoiceSchema = z.object({
  productName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  unit: z.string().max(20).optional().default('pcs'),
  price: z.number().min(0).optional().default(0),
  code: z.string().max(50).optional(),
  voiceAliases: z.array(z.string().min(1).max(100)).max(50).optional(),
  searchAliases: z.array(z.string().min(1).max(100)).max(50).optional(),
});
