/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AliasResolver — Resolves spoken item names to canonical products.
 *
 * NOW DELEGATES to the ProductResolutionEngine for all product resolution.
 * The old built-in dictionary + ItemAlias collection path is preserved as a
 * thin compatibility wrapper for callers that have not yet migrated.
 *
 * The engine pipeline:
 *   1. Exact Name     6. Barcode
 *   2. Voice Alias    7. Fuzzy Match
 *   3. Search Alias   8. Semantic (LLM)
 *   4. Learned Alias
 *   5. SKU
 */

import mongoose from 'mongoose';
import ItemAlias, { IItemAlias } from '../models/ItemAlias';
import type { AliasMatch, ProductResolutionResult } from '../types';
import { resolveProduct } from './ProductResolutionEngine';
import { computeRestaurantCalibration } from './SelfLearningService';

// ====================================================================
// LEGACY BUILT-IN ALIAS DICTIONARY (preserved for backward compat)
// This dictionary was the original fallback used before the product
// resolution engine existed. It is now relegated to a secondary fallback
// when the engine produces no result (edge case for unknown environments).
// ====================================================================

// ====================================================================
// BUILT-IN FOOD ALIAS DICTIONARY (FALLBACK)
// ====================================================================
// These are fallback aliases used when no restaurant-specific mapping exists.
// Covers the most common Indian restaurant inventory items.

interface BuiltinAlias {
  canonical: string;
  category: string;
  defaultUnit: string;
  aliases: string[];
}

const BUILTIN_ALIASES: BuiltinAlias[] = [
  // ─── GRAINS & FLOURS ──────────────────────────────────────
  {
    canonical: 'Flour',
    category: 'Grains & Flours',
    defaultUnit: 'kg',
    aliases: [
      'atta', 'आटा', 'aata', 'wheat flour', 'gehu ka atta', 'maida',
      'मैदा', 'refined flour', 'white flour', 'besan', 'gram flour',
      'चने का आटा', 'chana flour', 'rice flour', 'chawal ka atta',
      'चावल का आटा',
    ],
  },
  {
    canonical: 'Rice',
    category: 'Grains & Flours',
    defaultUnit: 'kg',
    aliases: [
      'chawal', 'चावल', 'basmati rice', 'basmati chawal',
      'steam rice', 'pulao rice', 'jeera rice', 'fried rice',
      'tandoori rice', 'biryani rice',
    ],
  },
  {
    canonical: 'Wheat Flour (Atta)',
    category: 'Grains & Flours',
    defaultUnit: 'kg',
    aliases: [
      'gehu ka atta', 'whole wheat flour', 'chakki atta',
      'gahun ka atta', 'गेहूं का आटा',
    ],
  },
  {
    canonical: 'Basmati Rice',
    category: 'Grains & Flours',
    defaultUnit: 'kg',
    aliases: [
      'basmati', 'basmati chawal', 'लंबा चावल', 'pulao rice',
      'biryani chawal',
    ],
  },

  // ─── DAIRY ────────────────────────────────────────────────
  {
    canonical: 'Fresh Milk',
    category: 'Dairy',
    defaultUnit: 'L',
    aliases: [
      'milk', 'doodh', 'दूध', 'dudh', 'amul milk',
      'mother dairy milk', 'full cream milk', 'toned milk',
      'double toned milk', 'cow milk', 'buffalo milk',
    ],
  },
  {
    canonical: 'Paneer',
    category: 'Dairy',
    defaultUnit: 'kg',
    aliases: [
      'पनीर', 'paneer', 'cottage cheese', 'amul paneer',
      'fresh paneer', 'malai paneer', 'soft paneer',
    ],
  },
  {
    canonical: 'Butter',
    category: 'Dairy',
    defaultUnit: 'kg',
    aliases: [
      'makkhan', 'मक्खन', 'amul butter', 'white butter',
      'cooking butter', 'table butter',
    ],
  },
  {
    canonical: 'Ghee',
    category: 'Dairy',
    defaultUnit: 'L',
    aliases: [
      'घी', 'ghee', 'clarified butter', 'desi ghee',
      'pure ghee', 'amul ghee',
    ],
  },
  {
    canonical: 'Curd',
    category: 'Dairy',
    defaultUnit: 'kg',
    aliases: [
      'दही', 'dahi', 'yogurt', 'sour curd', 'fresh curd',
      'hung curd', 'greek yogurt',
    ],
  },
  {
    canonical: 'Cream',
    category: 'Dairy',
    defaultUnit: 'L',
    aliases: [
      'malai', 'मलाई', 'fresh cream', 'whipping cream',
      'cooking cream', 'heavy cream',
    ],
  },
  {
    canonical: 'Cheese',
    category: 'Dairy',
    defaultUnit: 'kg',
    aliases: [
      'पनीर', 'amul cheese', 'processed cheese', 'mozzarella',
      'cheddar cheese', 'grated cheese', 'cheese slice',
    ],
  },

  // ─── OILS & FATS ──────────────────────────────────────────
  {
    canonical: 'Cooking Oil',
    category: 'Oils & Fats',
    defaultUnit: 'L',
    aliases: [
      'oil', 'cooking oil', 'vegetable oil', 'tel', 'तेल',
      'refined oil', 'mustard oil', 'sarson ka tel',
      'sunflower oil', 'soybean oil', 'palm oil',
    ],
  },
  {
    canonical: 'Mustard Oil',
    category: 'Oils & Fats',
    defaultUnit: 'L',
    aliases: [
      'sarson ka tel', 'सरसों का तेल', 'mustard tel',
    ],
  },

  // ─── SPICES & MASALA ──────────────────────────────────────
  {
    canonical: 'Turmeric Powder',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'haldi', 'हल्दी', 'turmeric', 'haldi powder',
    ],
  },
  {
    canonical: 'Red Chili Powder',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'lal mirch', 'लाल मिर्च', 'red chili', 'mirchi powder',
      'lal mirch powder',
    ],
  },
  {
    canonical: 'Cumin Seeds',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'jeera', 'जीरा', 'cumin', 'safed jeera', 'whole cumin',
    ],
  },
  {
    canonical: 'Coriander Powder',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'dhaniya', 'धनिया', 'coriander', 'dhaniya powder',
    ],
  },
  {
    canonical: 'Garam Masala',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'गरम मसाला', 'garam masala', 'hot spice mix',
    ],
  },
  {
    canonical: 'Salt',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'namak', 'नमक', 'table salt', 'sendha namak',
      'rock salt', 'black salt', 'kala namak',
    ],
  },
  {
    canonical: 'Sugar',
    category: 'Spices',
    defaultUnit: 'kg',
    aliases: [
      'chini', 'चीनी', 'shakkar', 'शक्कर', 'white sugar',
      'powdered sugar',
    ],
  },

  // ─── VEGETABLES ───────────────────────────────────────────
  {
    canonical: 'Potato',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'aloo', 'आलू', 'potatoes', 'aalu',
    ],
  },
  {
    canonical: 'Onion',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'pyaaz', 'प्याज़', 'pyaz', 'onions', 'red onion',
    ],
  },
  {
    canonical: 'Tomato',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'tamatar', 'टमाटर', 'tomatoes', 'tamatar',
    ],
  },
  {
    canonical: 'Ginger',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'adrak', 'अदरक', 'fresh ginger',
    ],
  },
  {
    canonical: 'Garlic',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'lehsun', 'लहसुन', 'lassan', 'garlic cloves',
    ],
  },
  {
    canonical: 'Green Chili',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'hari mirch', 'हरी मिर्च', 'green chilli', 'hari mirchi',
    ],
  },
  {
    canonical: 'Coriander Leaves',
    category: 'Vegetables',
    defaultUnit: 'bunch',
    aliases: [
      'dhaniya patta', 'हरा धनिया', 'cilantro', 'coriander',
      'hara dhaniya',
    ],
  },
  {
    canonical: 'Lemon',
    category: 'Vegetables',
    defaultUnit: 'kg',
    aliases: [
      'nimbu', 'नींबू', 'lemons', 'nibu',
    ],
  },

  // ─── BEVERAGES ────────────────────────────────────────────
  {
    canonical: 'Coca Cola',
    category: 'Beverages',
    defaultUnit: 'case',
    aliases: [
      'coke', 'coca cola', 'कोका कोला', 'coke pet',
    ],
  },
  {
    canonical: 'Pepsi',
    category: 'Beverages',
    defaultUnit: 'case',
    aliases: [
      'pepsi', 'पेप्सी', 'pepsi cola',
    ],
  },
  {
    canonical: 'Thums Up',
    category: 'Beverages',
    defaultUnit: 'case',
    aliases: [
      'thums up', 'thumbs up', 'thumb up',
    ],
  },
  {
    canonical: 'Mineral Water',
    category: 'Beverages',
    defaultUnit: 'bottle',
    aliases: [
      'water bottle', 'bisleri', 'aquafina', 'kinley',
      'packaged water', 'drinking water', 'पानी की बोतल',
    ],
  },

  // ─── PACKAGED GOODS ───────────────────────────────────────
  {
    canonical: 'Amul Butter',
    category: 'Packaged Goods',
    defaultUnit: 'pcs',
    aliases: [
      'amul butter pack', 'butter packet',
    ],
  },
  {
    canonical: 'Tomato Ketchup',
    category: 'Packaged Goods',
    defaultUnit: 'kg',
    aliases: [
      'ketchup', 'sauce', 'tomato sauce', 'टोमेटो केचप',
    ],
  },

  // ─── PULSES & LEGUMES ─────────────────────────────────────
  {
    canonical: 'Toor Dal',
    category: 'Pulses',
    defaultUnit: 'kg',
    aliases: [
      'arhar dal', 'tur dal', 'tuvar dal', 'pigeon pea',
      'अरहर दाल', 'तूर दाल',
    ],
  },
  {
    canonical: 'Moong Dal',
    category: 'Pulses',
    defaultUnit: 'kg',
    aliases: [
      'moong', 'yellow dal', 'split moong', 'मूंग दाल',
    ],
  },
];

// ====================================================================
// RESOLVER SERVICE
// ====================================================================

// ====================================================================
// PRODUCT RESOLUTION ENGINE INTEGRATION
// ====================================================================

/**
 * NEW primary entry-point: resolve a spoken item through the full
 * ProductResolutionEngine (8 stages + confidence tiers + self-learning).
 *
 * This is the recommended path for all callers in the voice inventory pipeline.
 * The old resolveAlias() is preserved as a thin compatibility wrapper.
 *
 * @param spokenName - The item name as spoken (Hinglish/Hindi/English)
 * @param restaurantId - Restaurant's MongoDB ObjectId
 * @returns Full resolution result with stage trace and confidence decision
 */
export async function resolveProductViaEngine(
  spokenName: string,
  restaurantId?: string
): Promise<ProductResolutionResult> {
  const options: any = {};

  // Load restaurant calibration if restaurantId is available
  if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
    try {
      options.restaurantCalibration = await computeRestaurantCalibration(restaurantId);
    } catch {
      options.restaurantCalibration = 1.0;
    }
  }

  return resolveProduct(spokenName, restaurantId, options);
}

// ====================================================================
// BACKWARD COMPATIBLE resolveAlias()
// ====================================================================

/**
 * Legacy resolveAlias — now wraps the ProductResolutionEngine result into
 * the old AliasMatch shape so existing callers work without changes.
 *
 * Uses the engine's exact-match or alias stages to find the canonical name.
 * Falls back to the built-in dictionary when the engine returns no result
 * (edge case for unknown environments).
 *
 * @deprecated Use resolveProductViaEngine() for full pipeline results.
 */
export async function resolveAlias(
  restaurantId: string,
  spokenName: string | null | undefined
): Promise<AliasMatch> {
  const name = (spokenName || '').trim();
  if (!name) return { canonicalName: '', unit: 'pcs', confidence: 0 };

  try {
    const result = await resolveProduct(name, restaurantId, {
      skipSemantic: true,
      skipNewProductDetection: true,
    });

    if (result.product && result.confidence >= 0.6) {
      return {
        canonicalName: result.product.name,
        unit: result.product.unit || 'pcs',
        confidence: result.confidence,
      };
    }
  } catch (error) {
    console.warn('[AliasResolver] Engine resolve failed, using built-in fallback:', error);
  }

  // Fallback: built-in dictionary only
  const normalized = name.toLowerCase();
  const builtinMatch = resolveFromBuiltin(normalized);
  if (builtinMatch) return builtinMatch;

  return { canonicalName: name, unit: 'pcs', confidence: 0.3 };
}

/**
 * Resolve multiple spoken items via the engine.
 */
export async function resolveAliases(
  restaurantId: string,
  spokenNames: string[]
): Promise<AliasMatch[]> {
  return Promise.all(
    spokenNames.map((name) => resolveAlias(restaurantId, name))
  );
}

// ====================================================================
// BUILT-IN DICTIONARY RESOLUTION (FALLBACK)
// ====================================================================

function resolveFromBuiltin(normalized: string): AliasMatch | null {
  // Direct canonical match
  const directMatch = BUILTIN_ALIASES.find(
    (b) => b.canonical.toLowerCase() === normalized
  );
  if (directMatch) {
    return {
      canonicalName: directMatch.canonical,
      unit: directMatch.defaultUnit,
      confidence: 1.0,
    };
  }

  // Alias match
  for (const entry of BUILTIN_ALIASES) {
    const aliasMatch = entry.aliases.some(
      (a) => a.toLowerCase().trim() === normalized
    );
    if (aliasMatch) {
      return {
        canonicalName: entry.canonical,
        unit: entry.defaultUnit,
        confidence: 0.95,
      };
    }
  }

  // Fuzzy substring match (catch partial names)
  let bestMatch: { entry: BuiltinAlias; score: number } | null = null;

  for (const entry of BUILTIN_ALIASES) {
    const canonical = entry.canonical.toLowerCase();

    // Check if spoken name contains canonical or vice versa
    if (normalized.includes(canonical) || canonical.includes(normalized)) {
      const score =
        Math.min(normalized.length, canonical.length) /
        Math.max(normalized.length, canonical.length);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { entry, score };
      }
    }

    // Check aliases
    for (const alias of entry.aliases) {
      const a = alias.toLowerCase();
      if (normalized.includes(a) || a.includes(normalized)) {
        const score =
          Math.min(normalized.length, a.length) /
          Math.max(normalized.length, a.length);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { entry, score };
        }
      }
    }
  }

  if (bestMatch && bestMatch.score >= 0.6) {
    return {
      canonicalName: bestMatch.entry.canonical,
      unit: bestMatch.entry.defaultUnit,
      confidence: Math.round(bestMatch.score * 100) / 100,
    };
  }

  return null;
}
