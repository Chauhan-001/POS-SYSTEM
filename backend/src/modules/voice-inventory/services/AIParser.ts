/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIParser — Sends transcript to LLM, extracts structured JSON for inventory actions.
 *
 * This is the ONLY service that talks to the LLM.
 * It returns structured data — it NEVER writes to the database.
 *
 * Pipeline:
 *   Transcript → Prompt Builder → LLM → JSON Parser → Structured Output
 *
 * SECURITY:
 *   - All prompts go through sanitizer to prevent injection
 *   - LLM output is validated against a Zod schema before returning
 *   - Never exposes system prompts or configuration
 *   - Never passes MongoDB data to the LLM (only item names)
 */

import { z } from 'zod';
import { complete } from '../../ai/provider/llmProvider';
import { parseJsonResponse } from '../../ai/services/responseParser';
import { executeAiCall } from '../../ai/services/aiService';
import { buildVoiceParsePrompt } from '../prompts/voice';
import type { VoiceParseOutput, ParsedItem, VoiceIntent } from '../types';

// ====================================================================
// VALIDATION SCHEMA
// ====================================================================

const parsedItemSchema = z.object({
  item: z.string().min(1).max(200).nullable().optional(),
  quantity: z.number().min(0).nullable().optional(),
  unit: z.string().nullable().optional(),
  /** Purchase rate (₹ per unit) — captured instead of discarded. */
  rate: z.number().min(0).max(1_000_000).nullable().optional(),
});

const voiceLLMOutputSchema = z.object({
  intent: z.enum([
    'inventory_add',
    'inventory_remove',
    'inventory_adjust',
    'inventory_waste',
    'purchase_reminder',
    'supplier_update',
    'unknown',
  ]),
  items: z.array(parsedItemSchema).default([]),
  confidence: z.number().min(0).max(1).default(0),
  language: z.enum(['en', 'hi', 'hi-en']).optional().default('hi-en'),
  originalText: z.string().optional().default(''),
  /** Supplier/vendor name spoken in the command ("from Verka Dairy"). */
  supplier: z.string().max(200).nullable().optional(),
  /** Purchase date — ISO YYYY-MM-DD or a resolvable relative word (kal/aaj). */
  date: z.string().max(40).nullable().optional(),
  /** Brand/variant spoken in the command ("Amul brand butter"). */
  brand: z.string().max(200).nullable().optional(),
  /** Expiry date for the incoming batch ("expiry 31 Dec 2026"). */
  expiryDate: z.string().max(40).nullable().optional(),
});

type VoiceLLMOutput = z.infer<typeof voiceLLMOutputSchema>;

// ====================================================================
// AI PARSER SERVICE
// ====================================================================

export interface ParseOptions {
  /** Language hint */
  language?: string;
  /** Timeout for LLM call in ms */
  timeoutMs?: number;
  /** Known inventory items for context */
  inventoryContext?: { name: string; unit: string }[];
}

/**
 * Parse a voice transcript into structured inventory action.
 *
 * @param transcript - Raw text from speech-to-text
 * @param options - Parsing options
 * @returns Structured parse result
 */
export async function parseTranscript(
  transcript: string,
  options: ParseOptions = {}
): Promise<VoiceParseOutput> {
  const startTime = Date.now();
  const { language, inventoryContext = [] } = options;

  if (!transcript || transcript.trim().length === 0) {
    return {
      intent: 'unknown',
      items: [],
      confidence: 0,
      originalText: transcript,
      error: 'Empty transcript received',
    };
  }

  // Auto-detect language (covers Devanagari Hindi AND Romanized Hinglish)
  const detectedLang = detectLanguage(transcript);
  const effectiveLanguage = language || detectedLang;

  // Provide default inventory context if none given (helps LLM understand
  // Hinglish inputs like "beesh litre doodh" even without inventory data)
  const effectiveInventoryContext = inventoryContext.length === 0 && detectedLang === 'hi-en'
    ? [
        { name: 'Fresh Milk', unit: 'L' },
        { name: 'Flour', unit: 'kg' },
        { name: 'Cooking Oil', unit: 'L' },
        { name: 'Rice', unit: 'kg' },
        { name: 'Paneer', unit: 'kg' },
        { name: 'Potato', unit: 'kg' },
        { name: 'Onion', unit: 'kg' },
        { name: 'Tomato', unit: 'kg' },
        { name: 'Butter', unit: 'kg' },
        { name: 'Sugar', unit: 'kg' },
        { name: 'Salt', unit: 'kg' },
        { name: 'Spices', unit: 'kg' },
      ]
    : inventoryContext;

  // Build the prompt with detected language and effective context
  const prompt = buildVoiceParsePrompt(transcript, effectiveInventoryContext, effectiveLanguage);

  // LOG: transcript + LLM prompt (audit trail)
  console.log(`[AIParser] Transcript: "${transcript}" (lang=${effectiveLanguage})`);
  console.log(`[AIParser] LLM prompt (${prompt.length} chars): ${prompt}`);

  try {
    // First try: Use the existing AI service with retry/caching
    const aiResult = await executeAiCall({
      prompt,
      feature: 'voice',
    });

    if (aiResult.success && aiResult.data) {
      const validated = validateLLMOutput(aiResult.data, transcript);
      const elapsed = Date.now() - startTime;
      // LOG: LLM JSON (raw + validated)
      console.log(
        `[AIParser] LLM raw JSON: ${JSON.stringify(aiResult.data)}`
      );
      console.log(
        `[AIParser] Structured JSON returned in ${elapsed}ms: ${JSON.stringify({
          intent: validated.intent,
          items: validated.items,
          confidence: validated.confidence,
          error: validated.error,
        })}`
      );
      // Only accept the AI service result when validation actually passed.
      // If the LLM was unavailable (circuit-breaker fallback) or the output
      // failed schema validation, fall through to the direct LLM call and the
      // keyword fallback so voice input keeps working even without the LLM.
      if (!validated.error) {
        return applyRateBackstop(validated, transcript);
      }
      console.warn('[AIParser] AI service output failed validation — falling through');
    }

    // Second try: Direct LLM call with stricter timeout
    console.warn(
      '[AIParser] AI service returned fallback, trying direct LLM call'
    );
    try {
      const llmResponse = await complete(
        [
          {
            role: 'system',
            content:
              'You are a restaurant voice parser. Output ONLY valid JSON with no markdown or extra text.',
          },
          { role: 'user', content: prompt },
        ],
        { timeout: options.timeoutMs || 10000, maxTokens: 512 }
      );

      const parsed = parseJsonResponse(llmResponse.content);
      const validated = validateLLMOutput(parsed, transcript);

      const elapsed = Date.now() - startTime;
      console.log(
        `[AIParser] Direct LLM parsed in ${elapsed}ms: intent=${validated.intent}, items=${validated.items.length}`
      );

      // Only return if LLM succeeded with confidence > 0
      if (validated.confidence > 0) {
        return applyRateBackstop(validated, transcript);
      }
    } catch {
      console.warn('[AIParser] Direct LLM call also failed, using keyword fallback');
    }

    // Third try: Keyword-based rule parsing as ultimate fallback
    console.warn('[AIParser] LLM failed, applying keyword-based Hinglish parsing');
    const keywordParsed = applyRateBackstop(
      keywordFallbackParse(transcript),
      transcript
    );
    const elapsed = Date.now() - startTime;
    console.log(
      `[AIParser] Keyword fallback in ${elapsed}ms: intent=${keywordParsed.intent}, items=${keywordParsed.items.length}`
    );
    return keywordParsed;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[AIParser] Failed after ${elapsed}ms:`, error.message);

    return {
      intent: 'unknown',
      items: [],
      confidence: 0,
      originalText: transcript,
      error: `AI parsing failed: ${error.message}`,
    };
  }
}

/**
 * Validate and sanitize LLM output against the expected schema.
 * This is the safety layer — never trust raw LLM output.
 */
function validateLLMOutput(
  raw: any,
  originalText: string
): VoiceParseOutput {
  try {
    const result = voiceLLMOutputSchema.parse(raw);

    // Sanitize item names (trim, remove control chars).
    // IMPORTANT: null fields are PRESERVED as null (never guessed). Only
    // items with a non-null empty-string name are dropped.
    const sanitizedItems: ParsedItem[] = result.items
      .filter((item) => item.item == null || (item.item && item.item.trim().length > 0))
      .map((item) => ({
        item: item.item == null ? null : item.item.trim().slice(0, 200),
        quantity: item.quantity == null ? 0 : Math.max(0, item.quantity),
        unit: item.unit || 'pcs',
        // Sanitize the spoken rate — never trust the LLM's raw number.
        rate:
          item.rate == null || !isFinite(item.rate) || item.rate <= 0
            ? undefined
            : Math.min(Math.round(item.rate * 100) / 100, 1_000_000),
      }));

    // Auto-detect language from original text
    const detectedLanguage = detectLanguage(originalText);

    return {
      intent: result.intent,
      items: sanitizedItems,
      confidence: result.confidence,
      originalText: originalText,
      language: detectedLanguage,
      // Supplier — the LLM's clean structured value wins; scan the raw
      // transcript when the LLM dropped the field entirely.
      supplier: extractSpokenSupplier(String(result.supplier || '')) || extractSpokenSupplier(originalText),
      // Date — the DETERMINISTIC transcript extraction wins. LLMs routinely
      // hallucinate "today" ("aaj") into a wrong year, and only the raw
      // transcript is ground truth for relative words like kal/aaj/parso.
      // The LLM's value is used only as a fallback for absolute dates.
      date: extractSpokenDate(originalText) || extractSpokenDate(String(result.date || '')),
      // Brand — the LLM's clean structured value wins; fall back to explicit
      // "X brand"/"brand X" markers in the transcript when the LLM dropped it.
      brand: extractSpokenBrand(String(result.brand || '')) || extractSpokenBrand(originalText),
      // Expiry date — the DETERMINISTIC marker-based transcript extraction wins
      // (only after an explicit "expiry/exp/expires" marker), so a purchase
      // date or quantity is never mistaken for an expiry. The LLM's ISO value
      // is used as a fallback when the transcript has no marker.
      expiryDate: extractSpokenExpiry(originalText) || extractSpokenExpiry(String(result.expiryDate || '')),
    };
  } catch (validationError: any) {
    console.warn(
      '[AIParser] LLM output validation failed:',
      validationError.message
    );

    // Attempt partial recovery: extract whatever we can
    const items = extractItemsFromRaw(raw);

    return {
      intent: raw?.intent || 'unknown',
      items,
      confidence: Math.min(raw?.confidence || 0, 0.5), // Penalize confidence for invalid output
      originalText,
      supplier: extractSpokenSupplier(raw?.supplier ? String(raw.supplier) : originalText),
      date: extractSpokenDate(originalText) || extractSpokenDate(raw?.date ? String(raw.date) : ''),
      brand: extractSpokenBrand(raw?.brand ? String(raw.brand) : originalText),
      expiryDate: extractSpokenExpiry(originalText) || extractSpokenExpiry(raw?.expiryDate ? String(raw.expiryDate) : ''),
      error: 'Output validation failed, partial extraction used',
    };
  }
}

/**
 * Attempt to extract items from malformed LLM output.
 */
function extractItemsFromRaw(raw: any): ParsedItem[] {
  try {
    if (raw?.items && Array.isArray(raw.items)) {
      return raw.items
        .filter(
          (i: any) => i && typeof i.item === 'string' && i.item.trim()
        )
        .map((i: any) => ({
          item: String(i.item || '').trim().slice(0, 200),
          quantity: Math.max(0, Number(i.quantity) || 0),
          unit: String(i.unit || 'pcs').trim() || 'pcs',
          rate:
            i.rate != null && isFinite(Number(i.rate)) && Number(i.rate) > 0
              ? Math.min(Math.round(Number(i.rate) * 100) / 100, 1_000_000)
              : undefined,
        }));
    }
    // Single item at top level
    if (raw?.item) {
      return [
        {
          item: String(raw.item).trim().slice(0, 200),
          quantity: Math.max(0, Number(raw.quantity) || 0),
          unit: String(raw.unit || 'pcs').trim() || 'pcs',
          rate:
            raw.rate != null && isFinite(Number(raw.rate)) && Number(raw.rate) > 0
              ? Math.min(Math.round(Number(raw.rate) * 100) / 100, 1_000_000)
              : undefined,
        },
      ];
    }
  } catch {
    // Silently ignore extraction failures
  }
  return [];
}

// ─── Keyword-based Hinglish Fallback Parser ───────────────────────────
// Activated when the LLM fails to parse Hinglish input.
// Uses pattern matching for common Indian number words, items, and intents.

/**
 * Map of Hindi number words (romanized) to numeric values.
 * Covers phonetic variations like "bees", "beesh", "bish" for 20.
 * Devanagari numerals (एक, दो ...) are also mapped so spoken Hindi
 * text (e.g. Whisper output "एक किलो आलू") survives the fallback path.
 */
const HINDI_NUMBERS: Record<string, number> = {
  // Devanagari numerals 1-100
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5,
  'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15,
  'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20,
  'इक्कीस': 21, 'बाईस': 22, 'तेईस': 23, 'चौबीस': 24, 'पच्चीस': 25,
  'छब्बीस': 26, 'सत्ताईस': 27, 'अट्ठाईस': 28, 'उनतीस': 29, 'तीस': 30,
  'इकतीस': 31, 'बत्तीस': 32, 'चालीस': 40, 'पचास': 50, 'साठ': 60,
  'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100,
  'डेढ़': 1.5, 'सवा': 1.25, 'पौना': 0.75, 'पाव': 0.25, 'आधा': 0.5, 'अढ़ाई': 2.5,
  // Romanized 1-10
  'ek': 1, 'do': 2, 'teen': 3, 'tin': 3, 'chaar': 4, 'paanch': 5, 'panch': 5,
  'cheh': 6, 'che': 6, 'chhah': 6, 'saat': 7, 'sat': 7, 'aath': 8, 'aat': 8,
  'nau': 9, 'das': 10,
  // 11-20
  'gyaarah': 11, 'gyarah': 11, 'baarah': 12, 'barah': 12, 'terah': 13,
  'chaudah': 14, 'pandrah': 15, 'solah': 16, 'satrah': 17, 'athaarah': 18,
  'unnees': 19, 'bees': 20, 'beesh': 20, 'bish': 20, 'bis': 20,
  // 21-100
  'ikkees': 21, 'baaees': 22, 'teis': 23, 'chaubees': 24, 'pachchees': 25,
  'chhabbees': 26, 'sattaaees': 27, 'atthaaees': 28, 'untees': 29,
  'tees': 30, 'teesh': 30, 'tis': 30, 'iktees': 31, 'batees': 32,
  'chalees': 40, 'chalis': 40,
  'pachaas': 50, 'pachas': 50,
  'saath': 60, 'sath': 60,
  'sattar': 70, 'satar': 70,
  'assi': 80,
  'nabbey': 90, 'nabbe': 90,
  'sau': 100, 'sai': 100,
  // Fractional / special
  'dedh': 1.5, 'dhed': 1.5, 'sava': 1.25, 'pona': 0.75,
  'paav': 0.25, 'adha': 0.5, 'aadha': 0.5, 'adhai': 2.5,
};

/**
 * Map of Hindi item names to canonical English item names.
 */
const ITEM_MAP: Record<string, string> = {
  'doodh': 'Fresh Milk', 'dudh': 'Fresh Milk', 'dhudh': 'Fresh Milk', 'milk': 'Fresh Milk', 'दूध': 'Fresh Milk', 'दूद': 'Fresh Milk',
  'atta': 'Flour', 'aata': 'Flour', 'flour': 'Flour', 'आटा': 'Flour', 'मैदा': 'Refined Flour', 'maida': 'Refined Flour', 'besan': 'Gram Flour', 'बेसन': 'Gram Flour',
  'chawal': 'Rice', 'chaval': 'Rice', 'rice': 'Rice', 'चावल': 'Rice',
  'tel': 'Cooking Oil', 'tail': 'Cooking Oil', 'oil': 'Cooking Oil', 'refined': 'Cooking Oil', 'तेल': 'Cooking Oil',
  'paneer': 'Paneer', 'cheese': 'Paneer', 'पनीर': 'Paneer',
  'makkhan': 'Butter', 'makhan': 'Butter', 'butter': 'Butter', 'मक्खन': 'Butter',
  'ghee': 'Ghee', 'घी': 'Ghee',
  'dahi': 'Yogurt', 'yogurt': 'Yogurt', 'curd': 'Yogurt', 'दही': 'Yogurt',
  'aloo': 'Potato', 'potato': 'Potato', 'आलू': 'Potato',
  'pyaaz': 'Onion', 'pyaz': 'Onion', 'onion': 'Onion', 'प्याज': 'Onion',
  'tamatar': 'Tomato', 'tomato': 'Tomato', 'टमाटर': 'Tomato',
  'mirchi': 'Green Chilli', 'chilli': 'Green Chilli', 'chili': 'Green Chilli', 'मिर्ची': 'Green Chilli',
  'adrak': 'Ginger', 'ginger': 'Ginger', 'अदरक': 'Ginger',
  'lehsun': 'Garlic', 'garlic': 'Garlic', 'लहसुन': 'Garlic',
  'haldi': 'Turmeric', 'turmeric': 'Turmeric', 'हल्दी': 'Turmeric',
  'dhania': 'Coriander', 'coriander': 'Coriander', 'धनिया': 'Coriander',
  'masala': 'Spices', 'spices': 'Spices', 'मसाला': 'Spices',
  'jeera': 'Cumin', 'cumin': 'Cumin', 'जीरा': 'Cumin',
  'murgh': 'Chicken', 'murgi': 'Chicken', 'chicken': 'Chicken', 'चिकन': 'Chicken', 'मुर्गी': 'Chicken',
  'gosht': 'Mutton', 'mutton': 'Mutton', 'मटन': 'Mutton',
  'machli': 'Fish', 'machhli': 'Fish', 'fish': 'Fish', 'मछली': 'Fish',
  'anda': 'Egg', 'ande': 'Egg', 'egg': 'Egg', 'eggs': 'Egg', 'अंडा': 'Egg', 'अंडे': 'Egg',
  'sooji': 'Semolina', 'suji': 'Semolina', 'semolina': 'Semolina', 'सूजी': 'Semolina',
  'daal': 'Lentils', 'dal': 'Lentils', 'dahl': 'Lentils', 'lentils': 'Lentils', 'दाल': 'Lentils',
  'chana': 'Chickpeas', 'chickpeas': 'Chickpeas', 'चना': 'Chickpeas',
  'rajma': 'Kidney Beans', 'kidney': 'Kidney Beans', 'राजमा': 'Kidney Beans',
  'chini': 'Sugar', 'cheeni': 'Sugar', 'sugar': 'Sugar', 'चीनी': 'Sugar',
  'namak': 'Salt', 'salt': 'Salt', 'नमक': 'Salt',
  'thumsup': 'Thums Up', 'thums': 'Thums Up',
  'pepsi': 'Pepsi', 'coke': 'Coca Cola', 'coca': 'Coca Cola',
  'amul': 'Amul Butter',
};

/**
 * Intent keywords in Hinglish / Hindi.
 */
const ADD_KEYWORDS = ['add', 'daalo', 'daal', 'laao', 'lao', 'aaya', 'aaye', 'aayee', 'aa_gaya', 'aa_gaye', 'bhar_do', 'एड', 'एड़', 'डालो', 'जोड़ो', 'करतो', 'करो', 'कर'];
const REMOVE_KEYWORDS = ['remove', 'nikaalo', 'nikal', 'hatao', 'hata', 'hata_do', 'kam_karo', 'ghatao'];
const WASTE_KEYWORDS = ['waste', 'kharab', 'bigad', 'sad_gaya', 'sad_gaye', 'phoonk'];
const ORDER_KEYWORDS = ['order', 'mangao', 'manga', 'manga_do', 'order_karo', 'chahiye', 'farmayish'];
const ADJUST_KEYWORDS = ['adjust', 'theek', 'sahi', 'badal', 'change'];
const SUPPLIER_KEYWORDS = ['supplier', 'vendor', 'thekedar', 'company_wala'];

/**
 * Determine the most likely intent from the text.
 */
function detectIntent(text: string): VoiceIntent {
  const lower = text.toLowerCase();
  const words = lower.split(/[\s,._-]+/).filter(Boolean);

  const intentScores: Record<string, number> = {
    inventory_add: 0,
    inventory_remove: 0,
    inventory_waste: 0,
    purchase_reminder: 0,
    inventory_adjust: 0,
    supplier_update: 0,
  };

  for (const word of words) {
    if (ADD_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['inventory_add']++;
    if (REMOVE_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['inventory_remove']++;
    if (WASTE_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['inventory_waste']++;
    if (ORDER_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['purchase_reminder']++;
    if (ADJUST_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['inventory_adjust']++;
    if (SUPPLIER_KEYWORDS.some(k => word.includes(k) || k.includes(word))) intentScores['supplier_update']++;
  }

  // Find the highest scoring intent
  let bestIntent: VoiceIntent = 'unknown';
  let bestScore = 0;
  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as VoiceIntent;
    }
  }

  return bestScore >= 1 ? bestIntent : 'unknown';
}

/**
 * Parse Hinglish number words from text.
 * Extracts the first number found (either digit or Hindi word).
 */
function extractQuantity(text: string): number {
  const lower = text.toLowerCase();

  // Try to find digit-based quantities first
  const digitMatch = lower.match(/\b(\d+\.?\d*)\b/);
  if (digitMatch) {
    return parseFloat(digitMatch[1]);
  }

  // Try Hindi number words
  const words = lower.split(/[\s,._-]+/).filter(Boolean);
  for (const word of words) {
    if (HINDI_NUMBERS[word] !== undefined) {
      return HINDI_NUMBERS[word];
    }
  }

  return 0;
}

/**
 * Extract the canonical item name from the text.
 * First checks known item mappings, then falls back to extracting the most likely noun.
 */
function extractItem(text: string): string {
  const lower = text.toLowerCase();

  // Check known item mappings
  for (const [hinglish, english] of Object.entries(ITEM_MAP)) {
    if (lower.includes(hinglish)) {
      return english;
    }
  }

  // Try to extract a noun — the word immediately before or after a quantity/unit
  const words = lower.split(/[\s,._-]+/).filter(Boolean);
  const unitWords = ['kg', 'kilo', 'kilos', 'litre', 'litres', 'l', 'ml', 'g', 'pcs', 'packet', 'bottle', 'crate', 'dozen', 'sack', 'bori', 'bag', 'carton', 'लीटर', 'लीटर्स', 'किलो', 'केजी', 'पैकेट', 'बोरी'];

  for (let i = 0; i < words.length; i++) {
    if (unitWords.includes(words[i]) && i > 0) {
      return words[i - 1]; // Word before the unit
    }
  }

  return '';
}

/**
 * Extract the unit from the text.
 * NOTE: \b (ASCII word boundary) does NOT match around Devanagari characters,
 * so units written in Hindi script use explicit surrounding-space matching.
 */
function extractUnit(text: string): string {
  const lower = text.toLowerCase();

  if (/(?:^|\s)(?:kg|kilo|kilos|kilogram|kilogramme|किलो|केजी)(?:\s|$)/i.test(lower)) return 'kg';
  if (/(?:^|\s)(?:litre|litres|ltr|लीटर|लीटर्स)(?:\s|$)/i.test(lower) && !/(?:^|\s)ml(?:\s|$)/i.test(lower)) return 'L';
  if (/\bl\b/i.test(lower) && !/\bml\b/i.test(lower)) return 'L';
  if (/(?:^|\s)(?:crate|क्रेत)(?:\s|$)/i.test(lower)) return 'crate';
  if (/(?:^|\s)(?:bottle|bottles|बोतल)(?:\s|$)/i.test(lower)) return 'bottle';
  if (/(?:^|\s)(?:packet|pack|packs|पैकेट)(?:\s|$)/i.test(lower)) return 'packet';
  if (/(?:^|\s)(?:dozen|dz|दर्जन)(?:\s|$)/i.test(lower)) return 'dozen';
  if (/(?:^|\s)(?:sack|bori|bag|बोरी)(?:\s|$)/i.test(lower)) return 'sack';
  if (/(?:^|\s)(?:carton|कार्टून)(?:\s|$)/i.test(lower)) return 'carton';
  if (/(?:^|\s)(?:ml|millilitre|मिलीलीटर)(?:\s|$)/i.test(lower)) return 'ml';
  if (/\bg\b/i.test(lower) && !/\bkg\b/i.test(lower)) return 'g';
  if (/(?:^|\s)(?:pcs|pieces?|piece|पीस)(?:\s|$)/i.test(lower)) return 'pcs';

  return 'pcs'; // default
}

/**
 * Deterministic purchase-rate backstop, applied to the FINAL parse result
 * regardless of which path produced it (LLM service, direct LLM, keyword
 * fallback). Many LLMs drop the optional "rate" field even when told to
 * extract it, so we recover it straight from the raw transcript — a spoken
 * rate is never silently lost.
 *
 * Phrasing rules:
 *   - "40 rupaye ke rate par" / "at ₹56" / "56 rs per kg" → per-unit rate
 *   - "200 rupaye mein N kg" → amount is the TOTAL → divide by quantity
 */
function applyRateBackstop(
  parsed: VoiceParseOutput,
  transcript: string
): VoiceParseOutput {
  const transcriptRate = extractRate(transcript);
  if (transcriptRate == null && parsed.items.length === 0) return parsed;

  // "X rupaye mein / में N kg" phrases the amount as the TOTAL for the
  // quantity. "X rupaye ke rate par" / "per kg" is already per-unit and must
  // NOT be divided — so only "mein/में" (or nothing) right after the amount
  // counts as total phrasing. ("ka" is excluded: "40 rupaye ka rate" is also
  // a per-unit rate.)
  const totalForQtyPhrasing = /(?:rupaye|rs\.?|rupees?|₹|inr)\s*(?:mein|में)(?:\s|$)/i.test(
    transcript
  );
  const singleItem = parsed.items.length === 1;

  // Unit backstop: the unit the speaker actually used ("5 kg aloo") is a
  // deterministic fact of the transcript. Stamp it onto every item so a later
  // resolver default can never downgrade "kg" to "pcs".
  const spokenUnit = extractUnit(transcript);

  const items = parsed.items.map((it) => {
    let next: ParsedItem = it;

    // Unit — only override when the speaker clearly stated one (extractUnit
    // returns 'pcs' as its default too, so keep the parser's unit when the
    // transcript had none).
    if (spokenUnit && spokenUnit !== 'pcs' && (!it.unit || it.unit === 'pcs')) {
      next = { ...next, unit: spokenUnit };
    }

    // Rate — fill when missing and the transcript mentions one.
    if (transcriptRate != null && !(next.rate != null && next.rate > 0)) {
      let rate = transcriptRate;
      if (totalForQtyPhrasing && singleItem && next.quantity > 0) {
        rate = rate / next.quantity;
      }
      next = {
        ...next,
        rate: Math.min(Math.max(Math.round(rate * 100) / 100, 0.01), 1_000_000),
      };
    }

    return next;
  });

  return { ...parsed, items };
}

/**
 * Extract a spoken purchase rate from text.
 *
 * Handles common Indian price phrasings:
 *   - "40 rupaye ke rate par" / "at ₹56" / "56 rupees per kg"  → 56
 *   - "₹40/kg" → 40
 *   - "200 rupaye mein 5 kg" → 40 (total ÷ quantity, done by the caller)
 * Returns the raw per-unit number, or null when no rate is mentioned.
 */
function extractRate(text: string): number | null {
  const lower = text.toLowerCase();

  // Pattern A — number BEFORE the currency word (most common in Hinglish):
  //   "40 rupaye ke rate par", "200 rupaye mein", "40 रुपये किलो"
  // The number must be IMMEDIATELY followed by the currency word (only spaces
  // between) so a quantity like "5 kg aloo" is never mistaken for a rate.
  const numberFirst = lower.match(
    /(?:^|[^\d])(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees?|rupay[ae]?|inr|रुपये|रुपए|रुपे)(?:\s|$)/i
  );
  if (numberFirst) return parseFloat(numberFirst[1]);

  // "₹40" or "₹ 40" — the ₹ glyph sits right before the number.
  const rupeeGlyph = lower.match(/₹\s*(\d+(?:\.\d+)?)/i);
  if (rupeeGlyph) return parseFloat(rupeeGlyph[1]);

  // Pattern B — currency word BEFORE the number:
  //   "rate par 40", "rupees 56 per kg", "at 56 rs"
  const currencyFirst = lower.match(
    /(?:rs\.?|rupees?|rupay[ae]?|inr|rate|रुपये|रुपए|रुपे)\s*[:@]?\s*(\d+(?:\.\d+)?)/i
  );
  if (currencyFirst) return parseFloat(currencyFirst[1]);
  return null;
}

/**
 * Keyword-based Hinglish fallback parser.
 * Used when the LLM fails to parse Hinglish input.
 * Handles common patterns like:
 *   - "beesh litre doodh add kardo"
 *   - "20 kg flour add karo"
 *   - "do crate ThumsUp aa gaya"
 */
function keywordFallbackParse(text: string): VoiceParseOutput {
  // Keep price clauses for rate extraction, but strip them from the text we
  // scan for quantities so "40 rupaye" is never mistaken for a quantity.
  const cleanedText = text.replace(/\d+\s*(?:रुपे|रुपये|rs|rupees|rs\.|inr).*?(?:rate|पर|mein|me|per|$)/gi, '');
  const lower = cleanedText.toLowerCase().trim();
  const intent = detectIntent(text);
  const rawRate = extractRate(text);

  // Split by connectors to handle multi-item
  const separators = /\s+(?:and|aur|और|&)\s+|\s*,\s*/;
  const parts = cleanedText.split(separators).filter(Boolean);

  const items: ParsedItem[] = [];
  let totalConfidence = 0;

  for (const part of parts) {
    const quantity = extractQuantity(part);
    const itemName = extractItem(part);
    const unit = extractUnit(part);

    if (itemName && quantity > 0) {
      // A "X rupaye mein 5 kg" (total-for-quantity) phrasing → divide to get
      // the per-unit rate. "X rupaye ke rate par" is already per-unit and is
      // left untouched (applyRateBackstop applies the same rule afterwards).
      const isTotalPhrasing = /(?:rupaye|rs\.?|rupees?|₹|inr)\s*(?:mein|में)(?:\s|$)/i.test(part);
      let rate = rawRate ?? undefined;
      if (rawRate != null && parts.length === 1 && isTotalPhrasing && quantity > 0) {
        rate = Math.round((rawRate / quantity) * 100) / 100;
      }
      items.push({ item: itemName, quantity, unit, rate });
      totalConfidence += 0.7; // base confidence per item
    }
  }

  // If no items found via keyword, try one more time on the full cleaned text
  if (items.length === 0) {
    const fullQuantity = extractQuantity(cleanedText);
    const fullItem = extractItem(cleanedText);
    const fullUnit = extractUnit(cleanedText);
    if (fullItem && fullQuantity > 0) {
      const isTotalPhrasing = /(?:rupaye|rs\.?|rupees?|₹|inr)\s*(?:mein|में)(?:\s|$)/i.test(cleanedText);
      items.push({
        item: fullItem,
        quantity: fullQuantity,
        unit: fullUnit,
        rate:
          rawRate != null && isTotalPhrasing && fullQuantity > 0
            ? Math.round((rawRate / fullQuantity) * 100) / 100
            : rawRate ?? undefined,
      });
      totalConfidence = 0.65;
    }
  }

  const confidence = items.length > 0
    ? Math.min(totalConfidence / items.length, 0.85)
    : 0.3;

  const detectedLang = detectLanguage(text);

  return {
    intent: items.length > 0 ? intent : 'unknown',
    items,
    confidence,
    language: detectedLang,
    originalText: text,
    supplier: extractSpokenSupplier(text),
    date: extractSpokenDate(text),
    brand: extractSpokenBrand(text),
    expiryDate: extractSpokenExpiry(text),
  };
}

/**
 * Extract a spoken expiry date from a voice command.
 *
 * Requires an explicit marker ("expiry / exp / expires") so a purchase date
 * or a quantity is never confused with an expiry. Supports:
 *   - ISO: "expiry 2026-12-31" / "expires on 2026-12-31"
 *   - "expiry 31-12-2026" / "expiry 31/12/2026" / "expiry 31.12.26"
 *   - named month: "expiry 31 Dec 2026" / "expiry December 2026"
 *   - month/year: "exp 12/2026" → the LAST day of December 2026 (the common
 *     food/batch convention for a month-only expiry).
 * Returns undefined when no expiry is mentioned.
 */
function extractSpokenExpiry(text: string): string | undefined {
  const t = (text || '').trim();
  if (!t) return undefined;
  const lower = ` ${t.toLowerCase().replace(/[.,!?]+/g, ' ')} `;

  // Locate the expiry marker, then look at the token(s) right after it.
  const markerMatch = lower.match(
    /(?:^|\s)(?:expiry|expir(?:es|y)?|exp)(?:\s+date)?(?:\s+(?:on|is|ka|ki|tak|till|until))?\s*/
  );
  if (!markerMatch) return undefined;
  const after = lower.slice((markerMatch.index || 0) + markerMatch[0].length).slice(0, 40);
  if (!after) return undefined;

  // Local-date ISO helper — avoids the UTC-off-by-one-day trap that
  // .toISOString() produces for dates near midnight in positive TZ offsets.
  const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 1. ISO date.
  const isoMatch = after.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // 2. Month/year ("12/2026" or "12-2026") → last day of that month.
  const myMatch = after.match(/^(\d{1,2})[/-](\d{2,4})\b/);
  if (myMatch) {
    let y = Number(myMatch[2]);
    if (y < 100) y += 2000;
    const m = Number(myMatch[1]);
    if (m >= 1 && m <= 12) {
      const d = new Date(y, m, 0);
      if (!isNaN(d.getTime())) return isoLocal(d);
    }
  }

  // 3. dd-mm-yyyy / dd/mm/yyyy / dd.mm.yy.
  // NOTE: separators are REQUIRED ([-/.]) so that concatenated digits like
  // "31122026" are never parsed as a valid date — only real date formats with
  // explicit dashes, dots, or slashes ("31-12-2026") are accepted.
  const numMatch = after.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numMatch && numMatch[1].length <= 2 && numMatch[2].length <= 2) {
    let yyyy = Number(numMatch[3]);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, Number(numMatch[2]) - 1, Number(numMatch[1]));
    if (!isNaN(d.getTime()) && d.getFullYear() === yyyy) return isoLocal(d);
  }

  // 4. Named month: "31 Dec 2026" (day + month [+ year]) or "December 2026"
  //    (month-only → last day of that month).
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthRe =
    '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const dayMonthYear = after.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthRe}\\b\\s*,?\\s*(\\d{2,4})?`)
  );
  if (dayMonthYear) {
    // Groups: [0]=full, [1]=day, [2]=month, [3]=year
    const mm = months[dayMonthYear[2].slice(0, 3)];
    let yyyy = dayMonthYear[3] ? Number(dayMonthYear[3]) : new Date().getFullYear();
    if (yyyy < 100) yyyy += 2000;
    const day = Number(dayMonthYear[1]);
    const d = new Date(yyyy, mm - 1, day);
    if (!isNaN(d.getTime()) && d.getFullYear() === yyyy) return isoLocal(d);
  }
  const monthYear = after.match(new RegExp(`^${monthRe}\\b\\s*,?\\s*(\\d{2,4})`));
  if (monthYear) {
    // Groups: [0]=full, [1]=month, [2]=year
    const mm = months[monthYear[1].slice(0, 3)];
    let yyyy = Number(monthYear[2]);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm, 0);
    if (!isNaN(d.getTime())) return isoLocal(d);
  }

  return undefined;
}

/**
 * A short (≤60 char), digit-free, letters/spaces/punctuation-only name — the
 * shape of a bare brand/supplier value returned by the LLM. Guards against a
 * quantity or a full sentence ever being captured as a name.
 */
function extractBareName(text: string): string | undefined {
  const t = (text || '').trim();
  if (!t || t.length > 60 || /\d/.test(t)) return undefined;
  return /^[A-Za-z][A-Za-z0-9 .'&-]{0,59}$/.test(t)
    ? t.slice(0, 200)
    : undefined;
}

/**
 * Extract a spoken brand/variant name from a voice command.
 *
 * Conservative by design — a brand is only captured when the speaker makes it
 * explicit, so "5 kg paneer" can never be mistaken for a brand:
 *   - Bare brand name (what the LLM returns for "brand"): short, no digits.
 *   - "X brand" ("Amul brand butter") / "brand X" ("brand Amul") markers,
 *     English or Devanagari (ब्रांड).
 */
function extractSpokenBrand(text: string): string | undefined {
  const t = (text || '').trim();
  if (!t) return undefined;

  // 1. Bare brand name — short, no digits, letters/spaces/punctuation only,
  //    so a quantity or a full sentence can never sneak through.
  const bare = extractBareName(t);
  if (bare) return bare;

  // 2. Explicit "X brand" / "brand X" markers.
  const nameClass = "[A-Za-z][A-Za-z .'&-]{1,30}";
  const beforeBrand = t.match(
    new RegExp(`\\b(${nameClass})\\s+(?:brand|ब्रांड)\\b`, 'i')
  );
  if (beforeBrand && beforeBrand[1]) return beforeBrand[1].trim().slice(0, 200);
  const afterBrand = t.match(
    new RegExp(`\\b(?:brand|ब्रांड)\\s+(${nameClass})\\b`, 'i')
  );
  if (afterBrand && afterBrand[1]) return afterBrand[1].trim().slice(0, 200);
  return undefined;
}

/**
 * Extract a spoken supplier/vendor name from a voice command.
 *
 * Handles common phrasings:
 *   - "... from Verka Dairy" / "... Verka Dairy se" / "... से"
 *   - "... ke paas se" / "... के पास से"
 * The name is trimmed at common connectors so a trailing clause ("from Verka
 * Dairy and 5 kg paneer") never swallows the whole rest of the command.
 */
function extractSpokenSupplier(text: string): string | undefined {
  const t = (text || '').trim();
  if (!t) return undefined;

  // 1. Bare vendor name — this is what the LLM returns for "supplier"
  //    ("Verka Dairy"). Short, no digits, letters/spaces/punctuation only,
  //    so a quantity or a full sentence can never sneak through.
  const bare = extractBareName(t);
  if (bare) return bare;

  // 2. Pattern-based extraction from a full command:
  //    - "from Verka Dairy" (English — supplier AFTER "from")
  //    - "Verka Dairy se ..." (Hinglish — supplier BEFORE "se")
  // Supplier names are usually capitalized brand names, so the primary match
  // starts with an uppercase letter — this stops "5 kg paneer" from being
  // captured. A lowercase fallback ("verka dairy se") then grabs the last
  // two words before "se" after stripping leading unit/quantity tokens.
  const nameClass = "[A-Z][A-Za-z .'&-]{1,40}";
  const fromMatch = t.match(new RegExp(`\\bfrom\\s+(${nameClass})`, 'i'));
  const seMatch = t.match(new RegExp(`(${nameClass})\\s+(?:se|से)(?:\\s|$)`));
  let raw = (fromMatch && fromMatch[1]) || (seMatch && seMatch[1]) || undefined;
  if (!raw) {
    // Lowercase Hinglish supplier — capture the LAST run of letters before
    // "se", then keep only the final two words (brand names are short).
    const lowMatch = t.match(/([A-Za-z][A-Za-z .'&-]{1,40})\s+(?:se|से)(?:\s|$)/i);
    if (lowMatch) {
      const words = String(lowMatch[1]).trim().split(/\s+/);
      const tail = words.slice(-2).join(' ').trim();
      if (tail.length >= 2) raw = tail;
    }
  }
  if (raw) {
    const cut = String(raw)
      .split(/\s+(?:and|aur|और|for|on|date|aaj|aj|kal|ke|ko|liye|per|at|add|daalo|lao|karo|kar|do)\b/i)[0]
      .trim();
    const name = cut.replace(/[.,;!?]+$/g, '').trim();
    if (name.length >= 2 && !/^(the|a|an|my|me|it|is|of|to|thee)$/i.test(name)) {
      return name.slice(0, 200);
    }
  }

  return undefined;
}

/**
 * Extract a spoken purchase date from a voice command, returning YYYY-MM-DD.
 *
 * Resolves in priority order:
 *   1. Relative words — aaj/today (today), kal/yesterday (−1), parso (+2),
 *      narso (−2) — with Devanagari variants.
 *   2. ISO dates (2026-08-05).
 *   3. Numeric dates (05-08-2026, 05/08/26).
 *   4. Named months ("5 august", "5 aug 2026").
 * Returns undefined when no date was spoken (the caller defaults to today).
 */
function extractSpokenDate(text: string): string | undefined {
  if (!text || !text.trim()) return undefined;
  const lower = ` ${String(text).toLowerCase().replace(/[.,!?]+/g, ' ')} `;
  const today = new Date();
  // Local-date ISO helper — avoids the UTC-off-by-one-day trap that
  // .toISOString() produces for dates near midnight in positive TZ offsets.
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 1. Relative day words (word boundaries — Devanagari has no \b).
  const relatives: Array<[RegExp, number]> = [
    [/(?:^|\s)(?:aaj|aj|today|आज)(?:\s|$)/, 0],
    [/(?:^|\s)(?:kal|yesterday|कल)(?:\s|$)/, -1],
    [/(?:^|\s)(?:parso|parson|day after tomorrow|परसों)(?:\s|$)/, 2],
    [/(?:^|\s)(?:narso|day before yesterday|नरसों)(?:\s|$)/, -2],
  ];
  for (const [re, offset] of relatives) {
    if (re.test(lower)) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      return iso(d);
    }
  }

  // 2. ISO date.
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // 3. Numeric date (dd-mm-yyyy | dd/mm/yyyy | dd.mm.yy).
  // NOTE: separators are REQUIRED so concatenated digits are never matched.
  const numMatch = lower.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numMatch && numMatch[1].length <= 2 && numMatch[2].length <= 2) {
    let yyyy = Number(numMatch[3]);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, Number(numMatch[2]) - 1, Number(numMatch[1]));
    if (!isNaN(d.getTime()) && d.getFullYear() === yyyy) return iso(d);
  }

  // 4. Named month ("5 august", "5 aug 2026").
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const namedMatch = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b\s*,?\s*(\d{2,4})?\b/
  );
  if (namedMatch) {
    const mm = months[namedMatch[2].slice(0, 3)];
    let yyyy = namedMatch[3] ? Number(namedMatch[3]) : today.getFullYear();
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm - 1, Number(namedMatch[1]));
    if (!isNaN(d.getTime())) return iso(d);
  }

  return undefined;
}

/**
 * Detect the language of the input text.
 * Detects Devanagari script AND Romanized Hinglish (Hindi words in Latin script).
 *
 * Romanized Hinglish indicators: Hindi number words, common Hindi/Hinglish verbs,
 * typical Hinglish sentence structure with mixed English-Hindi vocabulary.
 */
function detectLanguage(text: string): 'en' | 'hi' | 'hi-en' {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const lower = text.toLowerCase();

  // Hindi number words (romanized phonetic) — EXACT word matches only
  const hindiNumberWords = new Set([
    'ek', 'teen', 'tin', 'chaar', 'paanch', 'panch', 'cheh', 'saat', 'sat',
    'aath', 'aat', 'nau', 'das', 'gyaarah', 'gyarah', 'baarah', 'barah', 'terah',
    'chaudah', 'pandrah', 'solah', 'satrah', 'athaarah', 'unnees',
    'bees', 'beesh', 'bish', 'bis', 'ikkees', 'baaees', 'teis', 'chaubees',
    'pachchees', 'chhabbees', 'sattaaees', 'atthaaees', 'untees',
    'tees', 'teesh', 'tis', 'chalees', 'chalis', 'pachaas', 'pachas',
    'saath', 'sath', 'sattar', 'satar', 'assi', 'nabbey', 'nabbe',
    'sau', 'sai', 'dedh', 'dhed', 'sava', 'pona', 'paav', 'adha', 'aadha', 'adhai',
  ]);

  // Hindi/Hinglish common words (kitchen/inventory context) — EXACT word matches only
  const hindiKeywords = new Set([
    'daalo', 'daalde', 'daaldo', 'kardo', 'karo', 'laao', 'lao', 'aaya', 'aaye',
    'gaya', 'gaye', 'nikaalo', 'nikal', 'hatao', 'hata', 'mangao', 'manga',
    'kharab', 'bigad', 'theek', 'sahi', 'badal', 'chahiye', 'aur',
    'thoda', 'zyada', 'kam', 'doodh', 'dudh', 'atta', 'aata', 'chawal', 'chaval',
    'tel', 'paneer', 'makkhan', 'ghee', 'dahi', 'aloo', 'pyaaz', 'pyaz',
    'tamatar', 'anda', 'ande', 'murgh', 'murgi', 'gosht', 'machli',
    'masala', 'garam', 'jeera', 'haldi', 'mirchi', 'adrak', 'lehsun', 'dhania',
    'thumsup', 'thums', 'amul', 'bori', 'gilaas', 'pav', 'poon',
    'sabji', 'sabzi', 'sooji', 'maida', 'besan', 'bhaji',
    'chana', 'rajma', 'chini', 'namak', 'subah', 'shaam', 'aaj', 'kal',
  ]);

  // Check for Hindi words — EXACT matches only (no partial substring matching)
  const textWords = lower.split(/\s+/).filter(Boolean);
  const hindiWordCount = textWords.filter(w => {
    // Only exact word matches to avoid false positives with English words
    return hindiKeywords.has(w) || hindiNumberWords.has(w);
  }).length;

  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const totalWords = textWords.length;

  if (hasDevanagari && englishWords > 0) return 'hi-en';
  if (hasDevanagari) return 'hi';

  // Romanized Hinglish: significant Hindi word presence in romanized text
  const hindiRatio = totalWords > 0 ? hindiWordCount / totalWords : 0;
  if (hindiRatio >= 0.2) return 'hi-en';

  return 'en';
}
