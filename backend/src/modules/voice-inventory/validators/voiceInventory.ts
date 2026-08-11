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
    /** Purchase rate (₹/unit) — must survive validation so the spoken/edited
     *  rate reaches InventoryService (average-cost blend + purchase record).
     *  Zod strips unknown keys by default — without this the confirm flow
     *  silently dropped the rate and stored price 0. nullable() keeps old
     *  clients that send null from 400ing. */
    rate: z.number().min(0).max(1000000).nullable().optional(),
    purchaseRate: z.number().min(0).max(1000000).nullable().optional(),
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
 *
 * Hard caps (also enforced server-side in the controller):
 *   - audio: base64 string ≤ 50,000,000 chars (~37 MB decoded)
 *   - audioBytes ≤ 3 MB (max audio payload accepted from the POS)
 */
export const voiceTranscribeSchema = z.object({
  audio: z.string().min(1).max(50_000_000), // base64 audio (max ~37MB raw)
  audioMimeType: z.string().max(50).optional(),
  language: z
    .enum(['en', 'hi', 'hi-en'])
    .optional()
    .default('hi-en'),
});

/** Max raw decoded audio bytes a single transcribe payload may contain. */
export const MAX_TRANSCRIBE_AUDIO_BYTES = parseInt(
  process.env.VOICE_MAX_AUDIO_BYTES || (3 * 1024 * 1024).toString(),
  10,
);

/** Max estimated audio duration (seconds) for a transcribe/parse payload. */
export const MAX_TRANSCRIBE_DURATION_SEC = parseInt(
  process.env.VOICE_MAX_DURATION_SEC || '30',
  10,
);

/**
 * POST /api/voice-inventory/confirm
 * Confirm, edit, or cancel a parsed voice action.
 * Requires a valid pending-action token (server-side confirmation) OR a
 * legacy logId for backwards compatibility.
 */
export const voiceConfirmSchema = z
  .object({
    pendingActionId: z.string().min(1).optional(),
    confirmationToken: z.string().min(1).optional(),
    logId: z.string().min(1).optional(),
    action: z.enum(['confirm', 'edit', 'cancel', 'clarify']),
    editedItems: z.array(parsedItemSchema).max(20).optional(),
    clarification: z.string().max(500).optional(),
    /**
     * Corrected purchase date (YYYY-MM-DD) chosen in the confirm panel — lets
     * the merchant fix a misheard spoken date (e.g. "kal" parsed as today)
     * before the add is executed. Overrides the parse-time date when present.
     * The regex + refine reject impossible (2026-99-99) and future dates —
     * format-only checks would let junk flow into the purchase record.
     */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (d) =>
          !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
          d <= new Date().toISOString().slice(0, 10),
        { message: 'Date must be a real, non-future date (YYYY-MM-DD)' }
      )
      .optional(),
    /**
     * Corrected supplier/vendor name chosen in the confirm panel — lets the
     * merchant fix a misheard supplier (or add one that wasn't spoken) before
     * the add is executed. Empty string clears the supplier. Overrides the
     * parse-time supplier when present.
     */
    supplier: z.string().max(200).optional(),
    /**
     * Corrected brand/variant chosen in the confirm panel — the same product
     * can come from different brands. Empty string means no brand was
     * mentioned. Overrides the parse-time brand when present.
     */
    brand: z.string().max(200).optional(),
    /**
     * Corrected expiry date (YYYY-MM-DD) chosen in the confirm panel — the
     * incoming batch's expiry. Empty/absent means no expiry was mentioned.
     * Overrides the parse-time expiry when present.
     */
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)),
        { message: 'Expiry date must be a real date (YYYY-MM-DD)' }
      )
      .optional(),
  })
  .refine(
    (d) => (d.pendingActionId && d.confirmationToken) || d.logId,
    { message: 'Pending action (pendingActionId + confirmationToken) or logId is required' }
  );

/**
 * POST /api/voice-inventory/undo
 * Undo a previously confirmed voice action.
 */
export const voiceUndoSchema = z.object({
  logId: z.string().min(1).max(64),
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
