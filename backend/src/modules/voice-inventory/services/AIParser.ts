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
        return validated;
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
        return validated;
      }
    } catch {
      console.warn('[AIParser] Direct LLM call also failed, using keyword fallback');
    }

    // Third try: Keyword-based rule parsing as ultimate fallback
    console.warn('[AIParser] LLM failed, applying keyword-based Hinglish parsing');
    const keywordParsed = keywordFallbackParse(transcript);
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
      }));

    // Auto-detect language from original text
    const detectedLanguage = detectLanguage(originalText);

    return {
      intent: result.intent,
      items: sanitizedItems,
      confidence: result.confidence,
      originalText: originalText,
      language: detectedLanguage,
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
        }));
    }
    // Single item at top level
    if (raw?.item) {
      return [
        {
          item: String(raw.item).trim().slice(0, 200),
          quantity: Math.max(0, Number(raw.quantity) || 0),
          unit: String(raw.unit || 'pcs').trim() || 'pcs',
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
 * Keyword-based Hinglish fallback parser.
 * Used when the LLM fails to parse Hinglish input.
 * Handles common patterns like:
 *   - "beesh litre doodh add kardo"
 *   - "20 kg flour add karo"
 *   - "do crate ThumsUp aa gaya"
 */
function keywordFallbackParse(text: string): VoiceParseOutput {
  // Strip out price clauses like "40 रुपे के रेट पर", "56 rupees per", etc. so they don't confuse quantity
  const cleanedText = text.replace(/\d+\s*(?:रुपे|रुपये|rs|rupees|rs\.|inr).*?(?:rate|पर|mein|me|per|$)/gi, '');
  const lower = cleanedText.toLowerCase().trim();
  const intent = detectIntent(text);

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
      items.push({ item: itemName, quantity, unit });
      totalConfidence += 0.7; // base confidence per item
    }
  }

  // If no items found via keyword, try one more time on the full cleaned text
  if (items.length === 0) {
    const fullQuantity = extractQuantity(cleanedText);
    const fullItem = extractItem(cleanedText);
    const fullUnit = extractUnit(cleanedText);
    if (fullItem && fullQuantity > 0) {
      items.push({ item: fullItem, quantity: fullQuantity, unit: fullUnit });
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
  };
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
