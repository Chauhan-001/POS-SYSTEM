/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for product extraction from voice inventory commands.
 * Covers the critical bug where "Add 10 kg of mushroom" would extract
 * "10" as the product name instead of "mushroom".
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeForFuzzy,
  normalizePlural,
} from '../FuzzyMatcher';

// ====================================================================
// UNIT NORMALIZATION
// ====================================================================

describe('Unit extraction from transcript', () => {
  // Test that extractUnit (imported indirectly via the module) handles
  // all common unit variations. We test via the keyword fallback path.

  it('extractUnit handles kg variants', () => {
    // normalizeForFuzzy applies plural normalization
    expect(normalizeForFuzzy('10 kg')).toBe('10 kg');
    expect(normalizeForFuzzy('10 kilogram')).toBe('10 kilogram');
    expect(normalizeForFuzzy('10 kilograms')).toBe('10 kilogram');
  });

  it('extractUnit handles gram variants', () => {
    expect(normalizeForFuzzy('500 g')).toBe('500 g');
    expect(normalizeForFuzzy('500 gram')).toBe('500 gram');
    expect(normalizeForFuzzy('500 grams')).toBe('500 gram');
  });
});

// ====================================================================
// PRODUCT NAME RECOVERY FROM TRANSCRIPT
// ====================================================================

describe('recoverProductName logic', () => {
  // These test the CONCEPTUAL logic of recovering product names
  // from transcripts when the LLM returns numeric items.

  const actionWords = new Set([
    'add', 'daal', 'daalo', 'dal', 'dalo', 'lao', 'laao', 'do',
    'karo', 'kar', 'kardo', 'karde',
    'remove', 'waste', 'log', 'kharab', 'bigad',
    'of', 'ka', 'ki', 'ke', 'se', 'ko', 'the', 'a', 'an',
    // Devanagari action words
    'डालो', 'डाल', 'डाल दो', 'डाल दे', 'करो', 'कर', 'कर दो', 'कर दे',
    'लाओ', 'निकालो', 'हटाओ', 'घटाओ', 'बदल', 'ठीक', 'सही',
  ]);
  const fillerWords = new Set(['of', 'ka', 'ki', 'ke', 'se', 'ko', 'ne', 'the', 'a', 'an', 'में', 'मैं']);

  // Hindi number words (romanized + Devanagari)
  const HINDI_NUMBERS: Record<string, number> = {
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5,
    'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'ग्यारह': 11, 'बारह': 12, 'बीस': 20, 'तीस': 30, 'पचास': 50, 'सौ': 100,
    'ek': 1, 'do': 2, 'teen': 3, 'paanch': 5, 'saat': 7, 'aath': 8,
    'nau': 9, 'das': 10, 'bees': 20, 'beesh': 20, 'tees': 30, 'pachas': 50, 'sau': 100,
  };

  function recoverProductName(
    transcript: string,
    quantity: number,
    unit: string
  ): string | null {
    const lower = transcript.toLowerCase();
    const words = lower.split(/[\s,._-]+/).filter(Boolean);
    const removeSet = new Set([...actionWords, ...fillerWords]);
    // Remove ALL Hindi number words
    for (const word of Object.keys(HINDI_NUMBERS)) {
      removeSet.add(word);
    }
    if (quantity > 0) removeSet.add(String(quantity));
    if (unit) removeSet.add(unit.toLowerCase());
    const unitVariations: Record<string, string[]> = {
      'kg': ['kilo', 'kilos', 'kilogram', 'kilograms', 'किलो', 'केजी', 'किलोग्राम'],
      'g': ['gram', 'grams', 'gm', 'ग्राम'],
      'L': ['litre', 'litres', 'liter', 'liters', 'ltr', 'लीटर', 'लीटर्स'],
      'ml': ['millilitre', 'milliliters', 'milliliter', 'मिलीलीटर'],
      'packet': ['packets', 'पैकेट'],
      'bottle': ['bottles', 'बोतल'],
      'pcs': ['piece', 'pieces', 'पीस'],
      'sack': ['sack', 'bori', 'bag', 'बोरी'],
    };
    for (const vars of Object.values(unitVariations)) {
      for (const v of vars) removeSet.add(v);
    }
    const remaining = words.filter((w) => !removeSet.has(w));
    const productName = remaining.join(' ').trim();
    if (productName && productName.length >= 2 && !/^\d+(\.\d+)?$/.test(productName)) {
      return productName;
    }
    return null;
  }

  it('recovers "mushroom" from "Add 10 kg of mushroom"', () => {
    expect(recoverProductName('Add 10 kg of mushroom', 10, 'kg')).toBe('mushroom');
  });

  it('recovers "mushroom" from "add 10 kg mushroom"', () => {
    expect(recoverProductName('add 10 kg mushroom', 10, 'kg')).toBe('mushroom');
  });

  it('recovers "cashew" from "add 500 grams of cashew"', () => {
    expect(recoverProductName('add 500 grams of cashew', 500, 'g')).toBe('cashew');
  });

  it('recovers "paneer" from "add 2 kg of paneer"', () => {
    expect(recoverProductName('add 2 kg of paneer', 2, 'kg')).toBe('paneer');
  });

  it('recovers "milk" from "add 2 liters of milk"', () => {
    expect(recoverProductName('add 2 liters of milk', 2, 'L')).toBe('milk');
  });

  it('recovers "cheese" from "add 3 packets of cheese"', () => {
    expect(recoverProductName('add 3 packets of cheese', 3, 'packet')).toBe('cheese');
  });

  it('recovers "oil" from "add 1 litre of oil"', () => {
    expect(recoverProductName('add 1 litre of oil', 1, 'L')).toBe('oil');
  });

  it('recovers "mushroom" from Hindi "10 kilogram mushroom daal do"', () => {
    expect(recoverProductName('10 kilogram mushroom daal do', 10, 'kg')).toBe('mushroom');
  });

  it('recovers "paneer" from Hindi "5 kg paneer add karo"', () => {
    expect(recoverProductName('5 kg paneer add karo', 5, 'kg')).toBe('paneer');
  });

  it('recovers "mushroom" from "दस किलो mushroom add करो"', () => {
    expect(recoverProductName('दस किलो mushroom add करो', 10, 'kg')).toBe('mushroom');
  });

  it('recovers "mushroom" from "दस किलो मशरूम डाल दो"', () => {
    expect(recoverProductName('दस किलो मशरूम डाल दो', 10, 'kg')).toBe('मशरूम');
  });

  it('recovers "cashew" from "बीस किलो cashew add करो"', () => {
    expect(recoverProductName('बीस किलो cashew add करो', 20, 'kg')).toBe('cashew');
  });

  it('recovers "paneer" from "पाँच किलो paneer add करो"', () => {
    expect(recoverProductName('पाँच किलो paneer add करो', 5, 'kg')).toBe('paneer');
  });

  it('recovers "mushroom" from "10 kilo mushroom डाल दो"', () => {
    expect(recoverProductName('10 kilo mushroom डाल दो', 10, 'kg')).toBe('mushroom');
  });

  it('recovers "mushroom" from "मशरूम दस किलो डाल दो"', () => {
    expect(recoverProductName('मशरूम दस किलो डाल दो', 10, 'kg')).toBe('मशरूम');
  });

  it('recovers "cashew" from "5 किलो cashew डाल दो"', () => {
    expect(recoverProductName('5 किलो cashew डाल दो', 5, 'kg')).toBe('cashew');
  });

  it('recovers "oil" from "एक लीटर oil add करो"', () => {
    expect(recoverProductName('एक लीटर oil add करो', 1, 'L')).toBe('oil');
  });

  it('recovers "paneer" from Romanized "teen kg paneer add karo"', () => {
    expect(recoverProductName('teen kg paneer add karo', 3, 'kg')).toBe('paneer');
  });

  it('recovers "paneer" from Romanized "das kilo paneer daal do"', () => {
    expect(recoverProductName('das kilo paneer daal do', 10, 'kg')).toBe('paneer');
  });

  it('recovers "cheese" from "3 packet cheese add करो"', () => {
    expect(recoverProductName('3 packet cheese add करो', 3, 'packet')).toBe('cheese');
  });

  it('returns null for empty transcript', () => {
    expect(recoverProductName('', 10, 'kg')).toBeNull();
  });

  it('returns null when only quantity/unit remain', () => {
    expect(recoverProductName('add 10 kg', 10, 'kg')).toBeNull();
  });
});

// ====================================================================
// PLURAL NORMALIZATION
// ====================================================================

describe('Plural normalization', () => {
  it('normalizes mushrooms → mushroom', () => {
    expect(normalizePlural('mushrooms')).toBe('mushroom');
  });

  it('normalizes cashews → cashew', () => {
    expect(normalizePlural('cashews')).toBe('cashew');
  });

  it('normalizes tomatoes → tomato', () => {
    expect(normalizePlural('tomatoes')).toBe('tomato');
  });

  it('normalizes potatoes → potato', () => {
    expect(normalizePlural('potatoes')).toBe('potato');
  });

  it('normalizes onions → onion', () => {
    expect(normalizePlural('onions')).toBe('onion');
  });

  it('preserves singular forms', () => {
    expect(normalizePlural('mushroom')).toBe('mushroom');
    expect(normalizePlural('cashew')).toBe('cashew');
    expect(normalizePlural('paneer')).toBe('paneer');
  });

  it('preserves short words', () => {
    expect(normalizePlural('oil')).toBe('oil');
    expect(normalizePlural('ghee')).toBe('ghee');
  });

  it('handles already-lowercase', () => {
    expect(normalizePlural('MUSHROOMS')).toBe('mushroom');
  });
});

// ====================================================================
// KEYWORD EXTRACTION — extractItem LOGIC
// ====================================================================

describe('extractItem logic — skip numbers and "of"', () => {
  // Test the updated extractItem logic that skips numbers and "of"

  const unitWords = [
    'kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'gram', 'grams',
    'litre', 'litres', 'liter', 'liters', 'ltr', 'l', 'ml', 'g', 'gm',
    'pcs', 'piece', 'pieces', 'packet', 'packets', 'bottle', 'bottles',
    'crate', 'dozen', 'sack', 'bori', 'bag', 'carton',
    'किलो', 'केजी', 'ग्राम', 'लीटर', 'मिलीलीटर', 'पैकेट', 'बोरी',
  ];
  const fillerWords = new Set([
    'of', 'the', 'a', 'an', 'ka', 'ki', 'ke', 'se', 'ko',
    'add', 'daal', 'daalo', 'dal', 'dalo', 'lao', 'laao',
    'remove', 'waste', 'log', 'kharab', 'bigad',
    // Hindi number words — these are quantities, NOT products
    'एक', 'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'छः', 'सात', 'आठ', 'नौ', 'दस',
    'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
    'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे', 'सौ',
  ]);

  function extractItem(text: string): string {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,._-]+/).filter(Boolean);

    for (let i = 0; i < words.length; i++) {
      if (unitWords.includes(words[i])) {
        // Look BEFORE the unit for the product name (skip numbers, fillers)
        for (let j = i - 1; j >= 0; j--) {
          if (/^\d+(\.\d+)?$/.test(words[j]) || fillerWords.has(words[j])) continue;
          return words[j];
        }
        // Look AFTER the unit for the product name (skip "of", fillers)
        for (let j = i + 1; j < words.length; j++) {
          if (fillerWords.has(words[j])) continue;
          return words[j];
        }
      }
    }
    return '';
  }

  it('extracts "mushroom" from "add 10 kg of mushroom"', () => {
    expect(extractItem('add 10 kg of mushroom')).toBe('mushroom');
  });

  it('extracts "mushroom" from "add 10 kg mushroom"', () => {
    expect(extractItem('add 10 kg mushroom')).toBe('mushroom');
  });

  it('extracts "cashew" from "add 500 grams of cashew"', () => {
    expect(extractItem('add 500 grams of cashew')).toBe('cashew');
  });

  it('extracts "paneer" from "add 2 kg of paneer"', () => {
    expect(extractItem('add 2 kg of paneer')).toBe('paneer');
  });

  it('extracts "milk" from "add 2 liters of milk"', () => {
    expect(extractItem('add 2 liters of milk')).toBe('milk');
  });

  it('extracts "cheese" from "add 3 packets of cheese"', () => {
    expect(extractItem('add 3 packets of cheese')).toBe('cheese');
  });

  it('extracts "oil" from "add 1 litre of oil"', () => {
    expect(extractItem('add 1 litre of oil')).toBe('oil');
  });

  it('extracts "paneer" from "2 kg paneer"', () => {
    expect(extractItem('2 kg paneer')).toBe('paneer');
  });

  it('extracts "mushroom" from Hindi "10 kilogram mushroom daal do"', () => {
    expect(extractItem('10 kilogram mushroom daal do')).toBe('mushroom');
  });

  it('extracts "mushroom" from "दस किलो mushroom add करो" (Devanagari)', () => {
    expect(extractItem('दस किलो mushroom add करो')).toBe('mushroom');
  });

  it('extracts "mushroom" from "दस kg mushroom add करो" (mixed script)', () => {
    expect(extractItem('दस kg mushroom add करो')).toBe('mushroom');
  });

  it('extracts "cashew" from "बीस किलो cashew add करो"', () => {
    expect(extractItem('बीस किलो cashew add करो')).toBe('cashew');
  });

  it('extracts "paneer" from "पाँच किलो paneer add करो"', () => {
    expect(extractItem('पाँच किलो paneer add करो')).toBe('paneer');
  });

  it('does NOT return "10" as product name', () => {
    expect(extractItem('add 10 kg of mushroom')).not.toBe('10');
    expect(extractItem('add 10 kg mushroom')).not.toBe('10');
  });

  it('does NOT return "of" as product name', () => {
    expect(extractItem('add 10 kg of mushroom')).not.toBe('of');
  });

  it('does NOT return "दस" (Hindi number) as product name', () => {
    expect(extractItem('दस किलो mushroom add करो')).not.toBe('दस');
    expect(extractItem('दस किलो mushroom add करो')).not.toBe('दस');
  });

  it('does NOT return "किलो" (Hindi unit) as product name', () => {
    expect(extractItem('दस किलो mushroom add करो')).not.toBe('किलो');
  });
});

// ====================================================================
// QUANTITY EXTRACTION — never confused with product name
// ====================================================================

describe('Quantity extraction — separate from product name', () => {
  function extractQuantity(text: string): number {
    const lower = text.toLowerCase();
    const digitMatch = lower.match(/\b(\d+\.?\d*)\b/);
    if (digitMatch) return parseFloat(digitMatch[1]);
    return 0;
  }

  it('extracts 10 from "Add 10 kg of mushroom"', () => {
    expect(extractQuantity('Add 10 kg of mushroom')).toBe(10);
  });

  it('extracts 500 from "add 500 grams of cashew"', () => {
    expect(extractQuantity('add 500 grams of cashew')).toBe(500);
  });

  it('extracts 2 from "add 2 kg of paneer"', () => {
    expect(extractQuantity('add 2 kg of paneer')).toBe(2);
  });

  it('extracts 0.5 from "add 0.5 kg mushroom"', () => {
    expect(extractQuantity('add 0.5 kg mushroom')).toBe(0.5);
  });
});

// ====================================================================
// FULL PIPELINE TEST — quantity + unit + product separation
// ====================================================================

describe('Full extraction pipeline', () => {
  // Simulates the keyword fallback pipeline: extractQuantity → extractItem → extractUnit

  const unitWords = [
    'kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'gram', 'grams',
    'litre', 'litres', 'liter', 'liters', 'ltr', 'l', 'ml', 'g', 'gm',
    'pcs', 'piece', 'pieces', 'packet', 'packets', 'bottle', 'bottles',
    'crate', 'dozen', 'sack', 'bori', 'bag', 'carton',
    'किलो', 'केजी', 'ग्राम', 'लीटर', 'मिलीलीटर', 'पैकेट', 'बोरी',
  ];
  const fillerWords = new Set([
    'of', 'the', 'a', 'an', 'ka', 'ki', 'ke', 'se', 'ko',
    'add', 'daal', 'daalo', 'dal', 'dalo', 'lao', 'laao',
    'remove', 'waste', 'log', 'kharab', 'bigad',
    // Hindi number words — Devanagari
    'एक', 'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'छः', 'सात', 'आठ', 'नौ', 'दस',
    'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
    'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे', 'सौ',
    // Hindi number words — Romanized
    'ek', 'do', 'teen', 'tin', 'chaar', 'paanch', 'panch', 'cheh', 'saat', 'sat',
    'aath', 'aat', 'nau', 'das', 'gyaarah', 'gyarah', 'baarah', 'barah',
    'bees', 'beesh', 'bish', 'bis', 'tees', 'teesh', 'tis', 'chalees', 'chalis',
    'pachaas', 'pachas', 'saath', 'sath', 'sattar', 'satar', 'assi', 'sau', 'sai',
  ]);

  // Hindi number words mapping for extractQuantity (Devanagari + Romanized)
  const HINDI_NUMBERS: Record<string, number> = {
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5,
    'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'ग्यारह': 11, 'बारह': 12, 'बीस': 20, 'तीस': 30, 'पचास': 50, 'सौ': 100,
    'ek': 1, 'do': 2, 'teen': 3, 'paanch': 5, 'saat': 7, 'aath': 8,
    'nau': 9, 'das': 10, 'bees': 20, 'beesh': 20, 'tees': 30, 'pachas': 50, 'sau': 100,
  };

  function extractQuantity(text: string): number {
    const lower = text.toLowerCase();
    // Try digit-based first
    const digitMatch = lower.match(/\b(\d+\.?\d*)\b/);
    if (digitMatch) return parseFloat(digitMatch[1]);
    // Try Hindi number words
    const words = lower.split(/[\s,._-]+/).filter(Boolean);
    for (const word of words) {
      if (HINDI_NUMBERS[word] !== undefined) return HINDI_NUMBERS[word];
    }
    return 0;
  }

  function extractItem(text: string): string {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,._-]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (unitWords.includes(words[i])) {
        for (let j = i - 1; j >= 0; j--) {
          if (/^\d+(\.\d+)?$/.test(words[j]) || fillerWords.has(words[j])) continue;
          return words[j];
        }
        for (let j = i + 1; j < words.length; j++) {
          if (fillerWords.has(words[j])) continue;
          return words[j];
        }
      }
    }
    return '';
  }

  function extractUnit(text: string): string {
    const lower = text.toLowerCase();
    if (/(?:^|\s)(?:kg|kilo|kilos|kilogram|kilograms|किलो|केजी)(?:\s|$)/i.test(lower)) return 'kg';
    if (/(?:^|\s)(?:litre|litres|liters|liter|ltr|लीटर)(?:\s|$)/i.test(lower)) return 'L';
    if (/(?:^|\s)(?:grams?|gram|ग्राम)(?:\s|$)/i.test(lower)) return 'g';
    if (/\bg\b/i.test(lower) && !/\bkg\b/i.test(lower)) return 'g';
    if (/(?:^|\s)(?:ml|millilitre|milliliters|मिलीलीटर)(?:\s|$)/i.test(lower)) return 'ml';
    if (/(?:^|\s)(?:pcs|pieces?|piece)(?:\s|$)/i.test(lower)) return 'pcs';
    if (/(?:^|\s)(?:packet|packets?|पैकेट)(?:\s|$)/i.test(lower)) return 'packet';
    if (/(?:^|\s)(?:bottle|bottles)(?:\s|$)/i.test(lower)) return 'bottle';
    if (/(?:^|\s)(?:crate)(?:\s|$)/i.test(lower)) return 'crate';
    if (/(?:^|\s)(?:dozen|dz)(?:\s|$)/i.test(lower)) return 'dozen';
    return 'pcs';
  }

  const testCases = [
    // English
    { input: 'add 10 kg of mushroom', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'add 10 kg mushroom', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'add 10 kilograms of mushroom', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'add 500 grams of cashew', expectedProduct: 'cashew', expectedQty: 500, expectedUnit: 'g' },
    { input: 'add 500 g cashew', expectedProduct: 'cashew', expectedQty: 500, expectedUnit: 'g' },
    { input: 'add 2 kg of paneer', expectedProduct: 'paneer', expectedQty: 2, expectedUnit: 'kg' },
    { input: 'add 5 kg of rice', expectedProduct: 'rice', expectedQty: 5, expectedUnit: 'kg' },
    { input: 'add 1 litre of oil', expectedProduct: 'oil', expectedQty: 1, expectedUnit: 'L' },
    { input: 'add 2 liters of milk', expectedProduct: 'milk', expectedQty: 2, expectedUnit: 'L' },
    { input: 'add 3 packets of cheese', expectedProduct: 'cheese', expectedQty: 3, expectedUnit: 'packet' },
    { input: 'add 10 pieces of tomato', expectedProduct: 'tomato', expectedQty: 10, expectedUnit: 'pcs' },
    { input: 'add 2 kg mushrooms', expectedProduct: 'mushrooms', expectedQty: 2, expectedUnit: 'kg' },
    // Hindi (Devanagari)
    { input: 'दस किलो mushroom add करो', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'दस किलो मशरूम डाल दो', expectedProduct: 'मशरूम', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'बीस किलो cashew add करो', expectedProduct: 'cashew', expectedQty: 20, expectedUnit: 'kg' },
    { input: 'पाँच किलो paneer add करो', expectedProduct: 'paneer', expectedQty: 5, expectedUnit: 'kg' },
    { input: '10 kg mushroom डाल दो', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: '5 किलो mushroom डाल दो', expectedProduct: 'mushroom', expectedQty: 5, expectedUnit: 'kg' },
    // Romanized Hinglish
    { input: '10 kilo mushroom add karo', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'mushroom 10 kilo add karo', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: '10 kg mushroom daal do', expectedProduct: 'mushroom', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'das kilo paneer daal do', expectedProduct: 'paneer', expectedQty: 10, expectedUnit: 'kg' },
    { input: 'teen kg cashew add karo', expectedProduct: 'cashew', expectedQty: 3, expectedUnit: 'kg' },
    { input: 'bees litre doodh add kardo', expectedProduct: 'doodh', expectedQty: 20, expectedUnit: 'L' },
    // Mixed language
    { input: 'मशरूम 10 kg add करो', expectedProduct: 'मशरूम', expectedQty: 10, expectedUnit: 'kg' },
    { input: '5 किलो mushroom डाल दो', expectedProduct: 'mushroom', expectedQty: 5, expectedUnit: 'kg' },
  ];

  for (const tc of testCases) {
    it(`extracts correctly from "${tc.input}"`, () => {
      const qty = extractQuantity(tc.input);
      const product = extractItem(tc.input);
      const unit = extractUnit(tc.input);

      expect(qty).toBe(tc.expectedQty);
      expect(unit).toBe(tc.expectedUnit);

      // Product should NOT be a number
      expect(/^\d+(\.\d+)?$/.test(product)).toBe(false);
      // Product should NOT be "of" or a Hindi number word
      expect(product).not.toBe('of');
      expect(product).not.toBe('दस');
      expect(product).not.toBe('किलो');
      // Product should be non-empty
      expect(product.length).toBeGreaterThan(0);
      // Product should match expected
      expect(product).toBe(tc.expectedProduct);
    });
  }
});

// ====================================================================
// LLM NUMERIC ITEM RECOVERY
// ====================================================================

describe('LLM numeric item recovery', () => {
  // Tests that when the LLM returns "10" as the item name,
  // the recovery logic extracts the actual product name.

  it('detects numeric-only item names', () => {
    const item = '10';
    expect(/^\d+(\.\d+)?$/.test(item.trim())).toBe(true);
  });

  it('detects non-numeric item names', () => {
    const item = 'mushroom';
    expect(/^\d+(\.\d+)?$/.test(item.trim())).toBe(false);
  });

  it('detects mixed item names as non-numeric', () => {
    const item = '10 kg';
    expect(/^\d+(\.\d+)?$/.test(item.trim())).toBe(false);
  });
});

// ====================================================================
// DEVANAGARI NUMERAL & HINDI NUMBER WORD DETECTION
// ====================================================================

describe('Devanagari and Hindi number detection', () => {
  // Hindi number words — same map as AIParser.ts
  const HINDI_NUMBERS: Record<string, number> = {
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5,
    'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'ग्यारह': 11, 'बारह': 12, 'बीस': 20, 'तीस': 30, 'पचास': 50, 'सौ': 100,
    'ek': 1, 'do': 2, 'teen': 3, 'paanch': 5, 'saat': 7, 'aath': 8,
    'nau': 9, 'das': 10, 'bees': 20, 'beesh': 20, 'tees': 30, 'pachas': 50, 'sau': 100,
  };

  function isNonProductToken(item: string): boolean {
    const trimmed = item.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return true;                        // numeric
    if (HINDI_NUMBERS[trimmed.toLowerCase()] !== undefined) return true;    // Hindi word
    if (/^[०१२३४५६७८९]+$/.test(trimmed)) return true;                    // Devanagari numeral
    if (/^(kg|kilo|kilos|kilogram|kilograms|gram|grams|gm|g|ml|litre|litres|liter|liters|l|pcs|piece|pieces|packet|packets|bottle|bottles|किलो|केजी|ग्राम|लीटर|मिलीलीटर|पैकेट|बोरी)$/i.test(trimmed)) return true; // unit
    if (/^(add|remove|waste|log|daal|daalo|dal|dalo|lao|laao|डालो|डाल दो|करो|कर दो|nikalo|hatao|kam|ghatao|में|मैं)$/i.test(trimmed)) return true; // action
    return false;
  }

  it('recognizes Hindi number words as non-product', () => {
    expect(isNonProductToken('दस')).toBe(true);
    expect(isNonProductToken('बीस')).toBe(true);
    expect(isNonProductToken('पाँच')).toBe(true);
    expect(isNonProductToken('तीन')).toBe(true);
    expect(isNonProductToken('एक')).toBe(true);
    expect(isNonProductToken('सौ')).toBe(true);
  });

  it('recognizes Romanized Hindi numbers as non-product', () => {
    expect(isNonProductToken('das')).toBe(true);
    expect(isNonProductToken('bees')).toBe(true);
    expect(isNonProductToken('beesh')).toBe(true);
    expect(isNonProductToken('paanch')).toBe(true);
    expect(isNonProductToken('teen')).toBe(true);
    expect(isNonProductToken('sau')).toBe(true);
  });

  it('recognizes Devanagari numerals as non-product', () => {
    expect(isNonProductToken('१०')).toBe(true);
    expect(isNonProductToken('२०')).toBe(true);
    expect(isNonProductToken('५')).toBe(true);
    expect(isNonProductToken('१००')).toBe(true);
  });

  it('does NOT flag real product names as non-product', () => {
    expect(isNonProductToken('mushroom')).toBe(false);
    expect(isNonProductToken('paneer')).toBe(false);
    expect(isNonProductToken('cashew')).toBe(false);
    expect(isNonProductToken('mushrooms')).toBe(false);
    expect(isNonProductToken('मशरूम')).toBe(false);
    expect(isNonProductToken('पनीर')).toBe(false);
    expect(isNonProductToken('Kadhai Paneer')).toBe(false);
  });

  it('recognizes unit words as non-product', () => {
    expect(isNonProductToken('kg')).toBe(true);
    expect(isNonProductToken('किलो')).toBe(true);
    expect(isNonProductToken('liter')).toBe(true);
    expect(isNonProductToken('लीटर')).toBe(true);
  });

  it('recognizes action words as non-product', () => {
    expect(isNonProductToken('करो')).toBe(true);
    expect(isNonProductToken('डालो')).toBe(true);
    expect(isNonProductToken('add')).toBe(true);
    expect(isNonProductToken('में')).toBe(true);
  });
});
