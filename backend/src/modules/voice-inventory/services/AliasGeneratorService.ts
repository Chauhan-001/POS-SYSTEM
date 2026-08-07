/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AliasGeneratorService — Auto-generates multilingual aliases for products
 * using the existing Groq LLM. The merchant NEVER manually creates aliases.
 *
 * Triggers:
 *   - On new product creation (fire-and-forget, non-blocking)
 *   - On-demand via the Admin UI ("Regenerate aliases")
 *
 * Generated alias types:
 *   - Common English names
 *   - Hindi names (Devanagari)
 *   - Hinglish names (Romanized Hindi)
 *   - Spoken variations / phonetic spellings
 *   - Brand abbreviations
 *   - Restaurant terminology / generic terms
 *   - Singular & plural forms
 *
 * Design:
 *   - Uses `complete()` from the AI provider (Groq/OpenAI/Anthropic/Ollama).
 *   - Output is Zod-validated before being applied.
 *   - AI-generated aliases are flagged for merchant approval (default auto-approve
 *     for high-confidence ones, pending list for lower-confidence ones).
 *   - Never blocks product creation — generation is queued.
 */

import { z } from 'zod';
import { complete } from '../../ai/provider/llmProvider';
import { parseJsonResponse } from '../../ai/services/responseParser';
import { buildAliasGenerationPrompt } from '../prompts/aliasGeneration';
import Product from '../../../models/Product';
import type {
  AliasGenerationInput,
  AliasGenerationResult,
  AliasSuggestion,
} from '../types';

// ====================================================================
// VALIDATION SCHEMA
// ====================================================================

const aliasSuggestionSchema = z.object({
  alias: z.string().min(1).max(200).trim(),
  type: z.enum([
    'english_name',
    'hindi_name',
    'hinglish_name',
    'brand_abbreviation',
    'spoken_variation',
    'restaurant_term',
    'singular',
    'plural',
  ]),
  language: z.enum(['en', 'hi', 'hi-en']),
  confidence: z.number().min(0).max(1),
});

const aliasGenerationOutputSchema = z.object({
  voiceAliases: z.array(aliasSuggestionSchema).min(1).max(30),
  searchAliases: z.array(aliasSuggestionSchema).min(1).max(30),
});

// ====================================================================
// HELPERS
// ====================================================================

/** De-duplicate aliases preserving order, case-insensitively. */
function dedupeAliases(aliases: AliasSuggestion[]): AliasSuggestion[] {
  const seen = new Set<string>();
  const result: AliasSuggestion[] = [];
  for (const a of aliases) {
    const key = a.alias.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...a, alias: a.alias.trim() });
    }
  }
  return result;
}

/** Clean an alias: trim, collapse whitespace, cap length. */
function cleanAlias(alias: string): string {
  return alias.trim().replace(/\s+/g, ' ').slice(0, 200);
}

// ====================================================================
// SERVICE
// ====================================================================

/**
 * Generate multilingual aliases for a product name.
 *
 * @param input - Product metadata
 * @returns Generated aliases (voice + search buckets)
 */
export async function generateAliases(
  input: AliasGenerationInput
): Promise<AliasGenerationResult> {
  const prompt = buildAliasGenerationPrompt(input);

  try {
    const response = await complete(
      [
        {
          role: 'system',
          content:
            'You are a multilingual alias generator for an Indian restaurant voice POS. Output ONLY valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      { timeout: 10000, maxTokens: 1024, temperature: 0.3 }
    );

    const parsed = parseJsonResponse(response.content);
    const validated = aliasGenerationOutputSchema.parse(parsed);

    const voiceAliases = dedupeAliases(validated.voiceAliases);
    const searchAliases = dedupeAliases(validated.searchAliases);

    // Merge both buckets into a single allAliases list (de-duplicated).
    const allAliases = dedupeAliases([...voiceAliases, ...searchAliases]).map(
      (a) => a.alias
    );

    return {
      productName: input.productName,
      voiceAliases,
      searchAliases,
      allAliases,
    };
  } catch (error: any) {
    console.warn(
      `[AliasGeneratorService] Generation failed for "${input.productName}":`,
      error.message
    );
    // Graceful degradation — return a minimal alias set derived from the name.
    const fallback = buildFallbackAliases(input.productName);
    return fallback;
  }
}

/**
 * Persist generated aliases to a product.
 * AI-generated aliases are stored separately (source='ai_generated') so the
 * Admin UI can show pending approvals. High-confidence (≥0.9) voice aliases
 * are auto-applied to keep the voice system immediately useful.
 */
export async function applyGeneratedAliasesToProduct(
  productId: string,
  result: AliasGenerationResult,
  autoApproveConfidence = 0.9
): Promise<boolean> {
  try {
    const product = await Product.findById(productId);
    if (!product) return false;

    const voiceStrings = result.voiceAliases
      .filter((a) => a.confidence >= autoApproveConfidence)
      .map((a) => cleanAlias(a.alias))
      .filter(Boolean);

    const searchStrings = result.searchAliases
      .filter((a) => a.confidence >= autoApproveConfidence)
      .map((a) => cleanAlias(a.alias))
      .filter(Boolean);

    // Merge into existing arrays (de-duplicated).
    const existingVoice = new Set((product.voiceAliases || []).map((a) => a.toLowerCase()));
    const existingSearch = new Set((product.searchAliases || []).map((a) => a.toLowerCase()));

    const newVoice = voiceStrings.filter((a) => !existingVoice.has(a.toLowerCase()));
    const newSearch = searchStrings.filter((a) => !existingSearch.has(a.toLowerCase()));

    // Track lower-confidence aliases as learnedAliases (source=ai_generated)
    // so the Admin UI can show them for approval.
    const pendingAliases = result.allAliases
      .filter((a) => {
        const isPending =
          result.voiceAliases.find((va) => va.alias === a)?.confidence ?? 1;
        return isPending < autoApproveConfidence;
      })
      .map((alias) => ({
        alias: cleanAlias(alias),
        source: 'ai_generated' as const,
        usageCount: 0,
        lastUsed: new Date(),
      }))
      .filter((x) => x.alias && !existingVoice.has(x.alias.toLowerCase()) && !existingSearch.has(x.alias.toLowerCase()));

    await Product.updateOne(
      { _id: product._id },
      {
        $push: {
          voiceAliases: { $each: newVoice },
          searchAliases: { $each: newSearch },
          learnedAliases: { $each: pendingAliases },
        },
      }
    );

    return true;
  } catch (error: any) {
    console.error(
      `[AliasGeneratorService] Failed to apply aliases to product ${productId}:`,
      error.message
    );
    return false;
  }
}

/**
 * Generate + persist aliases in one call.
 * Used by the product-creation hook (fire-and-forget).
 */
export async function generateAndApplyAliases(
  productId: string,
  input: AliasGenerationInput
): Promise<AliasGenerationResult | null> {
  const result = await generateAliases(input);
  await applyGeneratedAliasesToProduct(productId, result);
  return result;
}

// ====================================================================
// FALLBACK
// ====================================================================

/**
 * Build a minimal alias set from the product name without the LLM.
 * Used when the LLM is unavailable — better than nothing.
 */
function buildFallbackAliases(productName: string): AliasGenerationResult {
  const name = productName.trim();
  const lower = name.toLowerCase();

  // Common Hinglish mappings for well-known items.
  const HINGLISH_MAP: Record<string, string[]> = {
    milk: ['doodh', 'दूध', 'dudh'],
    flour: ['atta', 'आटा', 'aata'],
    rice: ['chawal', 'चावल', 'chaval'],
    oil: ['tel', 'तेल', 'tail'],
    butter: ['makkhan', 'मक्खन', 'makhan'],
    ghee: ['घी', 'desi ghee'],
    curd: ['dahi', 'दही', 'yogurt'],
    sugar: ['chini', 'चीनी', 'cheeni'],
    salt: ['namak', 'नमक'],
    paneer: ['पनीर', 'cottage cheese'],
    potato: ['aloo', 'आलू'],
    onion: ['pyaaz', 'प्याज़', 'pyaz'],
    tomato: ['tamatar', 'टमाटर'],
    ginger: ['adrak', 'अदरक'],
    garlic: ['lehsun', 'लहसुन'],
    chili: ['mirchi', 'मिर्ची'],
    coriander: ['dhaniya', 'धनिया'],
    turmeric: ['haldi', 'हल्दी'],
    cumin: ['jeera', 'जीरा'],
    egg: ['anda', 'अंडा', 'ande'],
    chicken: ['murgh', 'मुर्गी', 'murgi'],
    fish: ['machhli', 'मछली', 'machli'],
    mutton: ['gosht', 'मटन'],
    coke: ['coca cola', 'कोका कोला', 'cold drink', 'soft drink', 'कोक'],
    pepsi: ['पेप्सी', 'soft drink', 'cold drink'],
  };

  const extraAliases: string[] = [];
  for (const [key, aliases] of Object.entries(HINGLISH_MAP)) {
    if (lower.includes(key)) {
      extraAliases.push(...aliases);
    }
  }

  const voiceAliases = dedupeAliases([
    { alias: name, type: 'english_name', language: 'en', confidence: 1.0 },
    ...extraAliases.map<AliasSuggestion>((a) => ({
      alias: a,
      type: a && /[\u0900-\u097F]/.test(a) ? 'hindi_name' : 'hinglish_name',
      language: a && /[\u0900-\u097F]/.test(a) ? 'hi' : 'hi-en',
      confidence: 0.85,
    })),
  ]);

  const searchAliases = dedupeAliases([
    { alias: name, type: 'english_name', language: 'en', confidence: 1.0 },
    ...extraAliases.map<AliasSuggestion>((a) => ({
      alias: a,
      type: 'spoken_variation',
      language: a && /[\u0900-\u097F]/.test(a) ? 'hi' : 'hi-en',
      confidence: 0.8,
    })),
  ]);

  return {
    productName: name,
    voiceAliases,
    searchAliases,
    allAliases: dedupeAliases([...voiceAliases, ...searchAliases]).map((a) => a.alias),
  };
}

