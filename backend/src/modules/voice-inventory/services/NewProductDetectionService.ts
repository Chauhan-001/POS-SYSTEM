/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NewProductDetectionService — Detects and enriches brand-new product
 * suggestions when the Product Resolution Engine cannot match an existing item.
 *
 * Flow:
 *   1. All deterministic stages + semantic stage fail to reach confidence.
 *   2. This service asks the LLM whether the spoken term is a REAL product.
 *   3. If yes, it predicts category/subcategory/units/storage/GST + aliases.
 *   4. Returns a NewProductSuggestion payload — the merchant ALWAYS confirms
 *      before any product is created (never auto-insert).
 *
 * Also handles CATEGORY MANAGEMENT: if the predicted category doesn't exist,
 * the merchant is prompted to create it along with the product.
 */

import { z } from 'zod';
import { complete } from '../../ai/provider/llmProvider';
import { parseJsonResponse } from '../../ai/services/responseParser';
import { buildProductSuggestionPrompt } from '../prompts/productSuggestion';
import type { NewProductSuggestion } from '../types';

// ====================================================================
// VALIDATION SCHEMA
// ====================================================================

const productSuggestionSchema = z.object({
  isLikelyRealProduct: z.boolean(),
  validationReason: z.string().max(500).default(''),
  productName: z.string().max(200).default(''),
  primaryCategory: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  inventoryUnit: z.string().max(50).optional(),
  purchaseUnit: z.string().max(50).optional(),
  salesUnit: z.string().max(50).optional(),
  gstCategory: z.string().max(20).optional(),
  storageType: z.string().max(50).optional(),
  categoryNeedsCreation: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0),
  suggestedVoiceAliases: z.array(z.string().max(200)).max(30).default([]),
  suggestedSearchAliases: z.array(z.string().max(200)).max(30).default([]),
});

// ====================================================================
// HEURISTIC GUARD — cheap rejection of obvious non-products
// ====================================================================

const NON_PRODUCT_PATTERNS: RegExp[] = [
  /^(hello|hi|hey|namaste|namaskar|good\s*(morning|afternoon|evening|night)|thanks|thank\s*you|bye|ok|okay|achha|theek\s*hai|welcome)\b/i,
  /^(kal|aaj|parson|today|tomorrow|yesterday|abhi|thoda|thodi|kuch|zyada|kam|sab|kya|kaise|kyun|kab|kaun|kahan)\b/i,
  /^(my\s*friend|friend|restaurant|kitchen|table|owner|manager|bhai|bhaiya|didi|madam|sir|boss)\b/i,
  /^(add|remove|delete|update|change|adjust|waste|order|buy|sell|lao|daalo|nikalo|hatao|karo|karde|rakh|rakho)\b/i,
  /^(please|pls|plz|kripya)\b/i,
  /^[0-9\s.,]+$/,
];

/** Quick local heuristic to short-circuit obvious non-products. */
export function isObviousNonProduct(spokenName: string): boolean {
  const trimmed = spokenName.trim();
  if (!trimmed) return true;
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 6) return false; // Long phrases are likely real products
  return NON_PRODUCT_PATTERNS.some((p) => p.test(trimmed));
}

// ====================================================================
// SERVICE
// ====================================================================

/**
 * Detect & enrich a new-product suggestion for an unmatched spoken name.
 *
 * @param spokenName - The spoken item that no existing product matched
 * @param transcript - Full transcript context
 * @param existingCategories - Categories already in the restaurant catalog
 * @param timeoutMs - LLM timeout override
 * @returns A NewProductSuggestion (isLikelyRealProduct may be false)
 */
export async function detectNewProduct(
  spokenName: string,
  transcript: string,
  existingCategories: string[],
  timeoutMs = 10000
): Promise<NewProductSuggestion> {
  const name = (spokenName || '').trim();

  // Cheap local guard first.
  if (isObviousNonProduct(name)) {
    return {
      type: 'NEW_PRODUCT_SUGGESTION',
      productName: name,
      confidence: 0,
      isLikelyRealProduct: false,
      validationReason: 'Term looks like small talk / instruction, not a product',
      existingCategories,
      suggestedVoiceAliases: [],
      suggestedSearchAliases: [],
      categoryNeedsCreation: false,
    };
  }

  const prompt = buildProductSuggestionPrompt({
    spokenName: name,
    transcript,
    existingCategories,
  });

  try {
    const response = await complete(
      [
        {
          role: 'system',
          content:
            'You are a product analyst for an Indian restaurant POS. Output ONLY valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      { timeout: timeoutMs, maxTokens: 1024, temperature: 0.2 }
    );

    const parsed = parseJsonResponse(response.content);
    const validated = productSuggestionSchema.parse(parsed);

    const cleanVoice = dedupe(validated.suggestedVoiceAliases);
    const cleanSearch = dedupe(validated.suggestedSearchAliases);

    return {
      type: 'NEW_PRODUCT_SUGGESTION',
      productName: validated.productName || name,
      confidence: validated.confidence,
      isLikelyRealProduct: validated.isLikelyRealProduct,
      validationReason: validated.validationReason,
      primaryCategory: validated.primaryCategory,
      subcategory: validated.subcategory,
      inventoryUnit: validated.inventoryUnit,
      purchaseUnit: validated.purchaseUnit,
      salesUnit: validated.salesUnit,
      gstCategory: validated.gstCategory,
      storageType: validated.storageType,
      categoryNeedsCreation:
        validated.categoryNeedsCreation &&
        !!validated.primaryCategory &&
        !existingCategories.some(
          (c) => c.toLowerCase() === (validated.primaryCategory || '').toLowerCase()
        ),
      existingCategories,
      suggestedVoiceAliases: cleanVoice,
      suggestedSearchAliases: cleanSearch,
    };
  } catch (error: any) {
    console.warn(
      `[NewProductDetection] Detection failed for "${name}":`,
      error.message
    );
    return {
      type: 'NEW_PRODUCT_SUGGESTION',
      productName: name,
      confidence: 0.4,
      isLikelyRealProduct: true, // Be lenient — let the merchant decide
      validationReason: 'AI detection unavailable — merchant review recommended',
      existingCategories,
      suggestedVoiceAliases: [name.toLowerCase()],
      suggestedSearchAliases: [name.toLowerCase()],
      categoryNeedsCreation: false,
    };
  }
}

/** De-duplicate alias strings preserving order. */
function dedupe(aliases: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of aliases) {
    const clean = (a || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

