/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeDraftService — assisted recipe creation (Phase F/H).
 *
 * PHASE 3: AI execution removed. Ingredient extraction from the owner's
 * free-text ("200g paneer, 150g tomato") is now a deterministic parser:
 * quantity+unit pattern matching, connector splitting, and Hinglish/Devanagari
 * number words — the same shapes the LLM previously returned. Matching against
 * THIS restaurant's inventory (tenant-scoped, with explicit confidence levels)
 * was already deterministic and is unchanged. Nothing is saved without user
 * confirmation. Unit compatibility is enforced by the unitConversion service.
 *
 * Flow: text → deterministic extraction → inventory matching (with
 * confidence) → reviewable draft → user confirms → recipeService.create.
 *
 * FUTURE AI INTEGRATION POINT: a future AI layer may re-add an LLM extraction
 * stage ahead of the deterministic matcher below — the matcher is and remains
 * the source of truth.
 */

import mongoose from 'mongoose';
import { z } from 'zod';
import { Product } from '../../../models';
import { AppError } from '../../../utils/AppError';
import { normalizeUnit, familyOf } from './unitConversion';
import { builtinCanonicalName } from '../../voice-inventory/services/AliasResolver';

// ─── Structured ingredient shape (deterministic parser output) ────
const aiIngredientSchema = z.object({
  ingredientText: z.string().min(1).max(120).trim(),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().min(1).max(20).trim(),
});

export type AiParsedIngredient = z.infer<typeof aiIngredientSchema>;

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MatchedComponent {
  ingredientText: string;
  quantity: number;
  unit: string;
  confidence: MatchConfidence;
  /** Matched inventory product (HIGH/MEDIUM only). */
  inventoryItemId?: string;
  itemName?: string;
  /** The inventory item's own unit (may differ from the spoken unit). */
  itemUnit?: string;
  /** Deterministic cost preview: quantity × averageCost (₹). */
  costPreview?: number;
  /** Unit incompatibility between spoken unit and item's unit. */
  unitMismatch?: boolean;
  /** No cost recorded on the inventory item (never purchased). */
  missingCost?: boolean;
  /** Why MEDIUM/LOW (shown to the user). */
  reason?: string;
}

export interface QuickCreateDraft {
  productId: string;
  productName: string;
  /** Variant the draft targets (override recipe). Empty for the base recipe. */
  variantName?: string;
  /** Known variant names for the product (ProductVariant + recipe overrides). */
  variants: string[];
  /** Current effective recipe mode for the target: 'exact' | 'inherit' | 'none'. */
  resolution?: { mode: string; inherited?: boolean; sourceRecipeId?: string };
  matched: MatchedComponent[];
  /** Items with no confident inventory match (LOW) — require manual selection. */
  needsAttention: MatchedComponent[];
  /** Human-readable warning list for the review screen. */
  warnings: string[];
  aiUnavailable: boolean;
}

// ─── Deterministic ingredient extraction (Phase 3 — replaces the LLM) ────

/** Hinglish/Devanagari number words → value (mirrors the voice parser). */
const NUMBER_WORDS: Record<string, number> = {
  'ek': 1, 'do': 2, 'teen': 3, 'tin': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5,
  'cheh': 6, 'chhah': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'bees': 20,
  'सौ': 100, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20,
  'adha': 0.5, 'aadha': 0.5, 'dedh': 1.5, 'डेढ़': 1.5, 'आधा': 0.5,
};

/** Convert Devanagari numerals (०-९) to ASCII digits. */
function devanagariToDigits(s: string): string {
  const map: Record<string, string> = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
  return s.replace(/[०१२३४५६७८९]/g, (ch) => map[ch] || ch);
}

/**
 * Parse free-text ingredients into structured rows. Deterministic, offline.
 * Handles: "200g paneer, 150g tomato", "2 kg atta aur 1 litre tel",
 * "500 ml doodh", "1 pcs paneer", "paneer 200g" — plus Devanagari numerals
 * and Hinglish number words. Rows without any quantity default to 1 pcs.
 */
function extractIngredients(text: string): AiParsedIngredient[] {
  const cleaned = devanagariToDigits(String(text || ''));
  const parts = cleaned.split(/\s*(?:,|\band\b|\baur\b|\bऔर\b|\+)\s*/).filter((p) => p.trim());
  const out: AiParsedIngredient[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase().trim();
    if (!lower) continue;

    // Quantity: leading/trailing number (digits or Hinglish number word).
    const digitMatch = lower.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
    let quantity = 0;
    let unit = '';
    let namePart = lower;

    if (digitMatch && digitMatch.index !== undefined && digitMatch.index < Math.max(2, lower.length - 30)) {
      quantity = Number(digitMatch[1]);
      unit = digitMatch[2] || '';
      // Name = the text with the "<qty><unit>" chunk removed.
      namePart = (lower.slice(0, digitMatch.index) + ' ' + lower.slice(digitMatch.index + digitMatch[0].length)).replace(/\s+/g, ' ').trim();
    } else {
      // Hinglish number word as quantity ("do kilo atta").
      const words = lower.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        if (NUMBER_WORDS[words[i]] !== undefined) {
          quantity = NUMBER_WORDS[words[i]];
          unit = words[i + 1] || '';
          words.splice(i, 2);
          namePart = words.join(' ').trim();
          break;
        }
      }
    }

    // Strip filler grammar from the name.
    const ingredientText = namePart
      .replace(/\b(?:of|ka|ki|ke|add|daal|daalo|karo|please|the|a|an)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // A real ingredient name contains at least one letter (Latin or
    // Devanagari) — garbage tokens like "???" are skipped.
    if (!ingredientText || ingredientText.length < 2 || !/[a-zA-Z\u0900-\u097F]/.test(ingredientText)) continue;

    out.push({
      ingredientText: ingredientText.slice(0, 120),
      quantity: quantity > 0 ? Math.min(quantity, 1_000_000) : 1,
      unit: (unit || 'pcs').slice(0, 20),
    });
  }

  return out.slice(0, 60);
}

/**
 * Token-overlap score in [0,1] for ingredient → inventory matching.
 * Rewards exact/superset containment ("paneer" vs "Fresh Paneer" is a strong
 * match), with a small penalty for very long names so generic tokens don't
 * over-claim a kitchen that carries dozens of "Paneer …" items.
 */
function nameScore(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const overlap = [...ta].filter((t) => tb.has(t)).length;
  const contained = [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
  if (contained) {
    // 0.95 base, minus a small length penalty: "paneer"→"Paneer Butter
    // Masala" still scores ~0.85, so it stays HIGH when unambiguous but the
    // ambiguity delta below demotes it to MEDIUM when several "Paneer …"
    // items compete.
    return Math.max(0.85, 0.95 - 0.0125 * Math.max(ta.size, tb.size));
  }
  return overlap / Math.max(ta.size, tb.size);
}

export class RecipeAiService {
  /**
   * Parse natural-language ingredients → structured, matched draft.
   * Never saves anything. Requires productId so the review screen is
   * anchored to a real menu product of this restaurant.
   */
  async quickCreate(
    restaurantId: string,
    text: string,
    productId: string,
    variantName?: string
  ): Promise<QuickCreateDraft> {
    const cleaned = String(text || '').trim();
    if (cleaned.length < 3) throw new AppError(400, 'Describe the dish ingredients first — e.g. "200g paneer, 150g tomato".');

    const product = await Product.findOne({ _id: productId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!product) throw new AppError(404, 'Product not found in your restaurant');

    // Variant context: known variants for the product + how this target resolves.
    const { recipeResolutionService } = await import('./recipeResolutionService');
    const variants = await recipeResolutionService.getVariantsForProduct(restaurantId, String(product._id));
    const variant = (variantName || '').trim() || undefined;
    const resolved = variant
      ? await recipeResolutionService.resolveEffectiveRecipe(restaurantId, String(product._id), variant)
      : undefined;
    const resolution = variant
      ? { mode: resolved?.resolution.mode || 'none', inherited: resolved?.resolution.inherited, sourceRecipeId: resolved?.resolution.sourceRecipeId }
      : undefined;

    // ── 1. Deterministic ingredient extraction (Phase 3 — was LLM) ──
    const parsed = extractIngredients(cleaned);
    if (parsed.length === 0) {
      return {
        productId: String(product._id),
        productName: product.name,
        variantName: variant,
        variants,
        resolution,
        matched: [],
        needsAttention: [],
        warnings: ['No ingredients detected — add them in the format "200g paneer, 150g tomato".'],
        aiUnavailable: true,
      };
    }

    // ── 2. Tenant-scoped inventory matching with confidence ────────
    const inventory = await Product.find({
      restaurantId,
      type: 'inventory',
      isDeleted: { $ne: true },
    }).select('_id name unit averageCost voiceAliases searchAliases').lean().exec();

    const matched: MatchedComponent[] = [];
    const needsAttention: MatchedComponent[] = [];
    const warnings: string[] = [];

    for (const ing of parsed) {
      // Exact name, then alias match, then token-overlap scoring. Track the
      // best AND second-best scores so a query that fits several items
      // ("paneer" with 4 paneer dishes) is surfaced as ambiguous (MEDIUM)
      // instead of silently picking the first one.
      const q = ing.ingredientText.toLowerCase();
      // Built-in food dictionary ("doodh" → "Fresh Milk") — a spoken term with
      // ZERO token overlap to the inventory name still resolves, e.g. saying
      // "2 litre doodh" matches the "Fresh Milk" inventory item. Null when
      // the term isn't a known built-in alias.
      const canonical = builtinCanonicalName(ing.ingredientText);
      const canonicalNorm = canonical ? canonical.toLowerCase().trim() : null;
      let best: any = null;
      let bestScore = 0;
      let secondScore = 0;
      for (const item of inventory) {
        const aliases = [...(item.voiceAliases || []), ...(item.searchAliases || [])]
          .map((a: any) => String(a?.alias ?? a ?? '').toLowerCase());
        if (item.name.toLowerCase() === q) { best = item; bestScore = 1; secondScore = 0; break; }
        if (aliases.includes(q)) { best = item; bestScore = 0.95; secondScore = 0; break; }
        let s = nameScore(ing.ingredientText, item.name);
        // Dictionary canonical boost: "doodh" → canonical "Fresh Milk". An
        // exact canonical name match is a near-certain resolve (HIGH); a
        // containment match ("Amul Fresh Milk" vs canonical "Fresh Milk") is
        // a strong signal too. Never overrides a better direct token score.
        if (canonicalNorm) {
          const itemNorm = item.name.toLowerCase().trim();
          if (itemNorm === canonicalNorm) s = Math.max(s, 0.97);
          else if (itemNorm.includes(canonicalNorm) || canonicalNorm.includes(itemNorm)) s = Math.max(s, 0.9);
        }
        if (s > bestScore) { secondScore = bestScore; best = item; bestScore = s; }
        else if (s > secondScore) secondScore = s;
      }
      // Near-tie top candidates → genuinely ambiguous → ask the user.
      const ambiguous = secondScore > 0 && bestScore - secondScore < 0.08;

      const spokenUnit = normalizeUnit(ing.unit);
      const itemUnit = best ? normalizeUnit(best.unit) : undefined;
      const unitMismatch = !!(best && spokenUnit && itemUnit && familyOf(spokenUnit) && familyOf(itemUnit) && familyOf(spokenUnit) !== familyOf(itemUnit));

      if (!best) {
        needsAttention.push({
          ingredientText: ing.ingredientText,
          quantity: ing.quantity,
          unit: ing.unit,
          confidence: 'LOW',
          reason: 'No matching inventory item found — pick one manually.',
        });
        warnings.push(`"${ing.ingredientText}" has no inventory match — select an item manually.`);
        continue;
      }

      const confidence: MatchConfidence = ambiguous ? 'MEDIUM' : bestScore >= 0.85 ? 'HIGH' : bestScore >= 0.5 ? 'MEDIUM' : 'LOW';
      const component: MatchedComponent = {
        ingredientText: ing.ingredientText,
        quantity: ing.quantity,
        unit: ing.unit,
        confidence,
        inventoryItemId: String(best._id),
        itemName: best.name,
        itemUnit: best.unit,
        unitMismatch,
        missingCost: Number(best.averageCost) <= 0,
      };

      if (unitMismatch) {
        component.reason = `Spoken unit "${ing.unit}" doesn't match how "${best.name}" is tracked (${best.unit}) — quantity will need review.`;
        warnings.push(component.reason);
        needsAttention.push(component);
        continue;
      }

      // Deterministic cost preview (never LLM-invented).
      const { convertQuantity } = await import('./unitConversion');
      try {
        const qtyInItemUnit = convertQuantity(ing.quantity, spokenUnit || best.unit, itemUnit || best.unit);
        component.costPreview = Math.round(qtyInItemUnit * Number(best.averageCost) * 100) / 100;
      } catch {
        component.costPreview = 0;
      }

      if (confidence === 'HIGH') matched.push(component);
      else if (confidence === 'MEDIUM') {
        component.reason = `"${ing.ingredientText}" could match several items — confirm "${best.name}" is correct.`;
        needsAttention.push(component);
      } else {
        component.reason = 'Low confidence match — verify before saving.';
        needsAttention.push(component);
      }
    }

    return {
      productId: String(product._id),
      productName: product.name,
      variantName: variant,
      variants,
      resolution,
      matched,
      needsAttention,
      warnings,
      aiUnavailable: false,
    };
  }

  /** Search inventory for manual resolution of an unmatched ingredient. */
  async searchInventory(restaurantId: string, query: string): Promise<any[]> {
    if (!query || query.trim().length < 1) return [];
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // Expand with the built-in dictionary canonical name so searching "doodh"
    // also surfaces the "Fresh Milk" inventory item (same alias coverage as
    // the quick-create matcher).
    const canonical = builtinCanonicalName(query);
    const or: any[] = [{ name: rx }, { 'voiceAliases.alias': rx }, { 'searchAliases.alias': rx }];
    if (canonical && canonical.toLowerCase() !== query.trim().toLowerCase()) {
      or.push({ name: new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    }
    return Product.find({
      restaurantId,
      type: 'inventory',
      isDeleted: { $ne: true },
      $or: or,
    }).select('_id name unit averageCost currentStock image').limit(10).lean().exec();
  }
}

export const recipeAiService = new RecipeAiService();
