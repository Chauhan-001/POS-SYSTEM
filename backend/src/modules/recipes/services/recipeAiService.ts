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
  /**
   * No inventory item exists for this ingredient. It is a NEW item: when the
   * recipe is saved it is created in inventory with 0 stock (never during
   * draft creation — quickCreate saves nothing).
   */
  isNew?: boolean;
  /** Why MEDIUM/LOW (shown to the user). */
  reason?: string;
}

/** A brand-new inventory item proposed by the matcher (created on save). */
export interface NewIngredient {
  name: string;
  /** Normalized unit ('g' | 'kg' | 'ml' | 'L' | 'pcs') the item is tracked in. */
  unit: string;
  quantity: number;
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
  /**
   * Ingredients with no inventory match at all. Saving the recipe creates
   * each as an inventory item with 0 stock and includes it as a component.
   */
  newIngredients: NewIngredient[];
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

/** Unit words recognised directly after a quantity ("200 grams", "2 kg"). */
const UNIT_WORDS = new Set([
  'mg', 'milligram', 'milligrams',
  'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
  'l', 'ltr', 'litre', 'litres', 'liter', 'liters',
  'pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'unit', 'units',
  'plate', 'plates', 'serving', 'servings',
  'tbsp', 'tsp', 'cup', 'cups', 'pack', 'packs', 'packet', 'packets',
  'bottle', 'bottles', 'bunch', 'bunches', 'box', 'boxes', 'can', 'cans',
  'dozen', 'slice', 'slices', 'leaf', 'leaves', 'clove', 'cloves',
  'pinch', 'pinches', 'handful', 'handfuls', 'sprig', 'sprigs', 'stick', 'sticks', 'sheet', 'sheets',
]);

/** Filler grammar stripped from a spoken ingredient name. */
const FILLER_RX = /\b(?:of|ka|ki|ke|ko|mein|me|se|add|daal|daalo|dal|dalo|karo|please|the|a|an|take|took|put|mix|use|using|with|then|into|to|taste)\b/g;

interface QtyEvent { value: number; unit: string; start: number; end: number; }

/**
 * Every quantity in one connector-free chunk: "200", "200g", "2 kg", "do".
 * `end` is the offset just past the consumed quantity (and its unit word), so
 * the caller can slice the surrounding text into per-ingredient names.
 */
function quantityEvents(segment: string): QtyEvent[] {
  const events: QtyEvent[] = [];

  // Numeric quantities with an optional immediately-following unit word.
  const numRx = /(\d+(?:\.\d+)?)(\s*)([a-zA-Z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = numRx.exec(segment)) !== null) {
    const word = (m[3] || '').toLowerCase();
    const wordStart = m.index + m[1].length + m[2].length;
    const hasUnit = !!word && UNIT_WORDS.has(word);
    events.push({
      value: Number(m[1]),
      unit: hasUnit ? word : '',
      start: m.index,
      end: hasUnit ? wordStart + m[3].length : m.index + m[1].length,
    });
  }

  // Hinglish/Devanagari number words ("do kilo atta").
  const wordRx = /\S+/g;
  let w: RegExpExecArray | null;
  while ((w = wordRx.exec(segment)) !== null) {
    const token = w[0].toLowerCase().replace(/[^a-z\u0900-\u097F]/g, '');
    if (token === '' || NUMBER_WORDS[token] === undefined) continue;
    const wordEnd = w.index + w[0].length;
    const next = segment.slice(wordEnd).match(/^\s*([a-zA-Z\u0900-\u097F]+)/);
    const nextWord = next ? next[1].toLowerCase() : '';
    const hasUnit = nextWord !== '' && UNIT_WORDS.has(nextWord);
    events.push({
      value: NUMBER_WORDS[token],
      unit: hasUnit ? nextWord : '',
      start: w.index,
      end: hasUnit ? wordEnd + (next as RegExpMatchArray)[0].length : wordEnd,
    });
  }

  events.sort((a, b) => a.start - b.start);
  return events;
}

function cleanIngredientName(raw: string): string {
  return raw.replace(FILLER_RX, ' ').replace(/\s+/g, ' ').trim();
}

/** A real ingredient name needs ≥2 chars and at least one letter (Latin/Devanagari). */
function isRealIngredientName(name: string): boolean {
  return name.length >= 2 && /[a-zA-Z\u0900-\u097F]/.test(name);
}

/**
 * Parse free-text ingredients into structured rows. Deterministic, offline.
 *
 * A chunk is first split on connectors (",", "and", "aur", "और", "+"); each
 * chunk is then scanned for EVERY quantity — not just the first — so a whole
 * sentence spoken in one go ("take 200 grams of paneer add 150 grams of
 * tomato") yields a separate row per ingredient. Handles quantities before
 * ("200g paneer") or after ("paneer 200g") the name, Devanagari numerals and
 * Hinglish number words. Rows without any quantity default to 1 pcs.
 */
function extractIngredients(text: string): AiParsedIngredient[] {
  const cleaned = devanagariToDigits(String(text || ''));
  const parts = cleaned.split(/\s*(?:,|\band\b|\baur\b|\bऔर\b|\+)\s*/).map((p) => p.trim()).filter(Boolean);
  const out: AiParsedIngredient[] = [];

  for (const part of parts) {
    const events = quantityEvents(part);

    if (events.length === 0) {
      // No quantity anywhere → a single row with the default 1 pcs.
      const name = cleanIngredientName(part);
      if (isRealIngredientName(name)) {
        out.push({ ingredientText: name.slice(0, 120), quantity: 1, unit: 'pcs' });
      }
      continue;
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const nextStart = i + 1 < events.length ? events[i + 1].start : part.length;
      // Preferred: the name FOLLOWS its quantity ("200g paneer").
      let raw = part.slice(ev.end, nextStart);
      if (!raw.trim()) {
        // Quantity FOLLOWS the name ("paneer 200g") — take the text since the
        // previous quantity so the same name is never assigned twice.
        const prevEnd = i > 0 ? events[i - 1].end : 0;
        raw = part.slice(prevEnd, ev.start);
      }
      const name = cleanIngredientName(raw);
      if (!isRealIngredientName(name)) continue;
      out.push({
        ingredientText: name.slice(0, 120),
        quantity: ev.value > 0 ? Math.min(ev.value, 1_000_000) : 1,
        unit: (ev.unit || 'pcs').slice(0, 20),
      });
    }
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
        newIngredients: [],
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
        // No inventory item at all → a NEW ingredient. It stays reviewable and
        // is only written to inventory (stock 0) when the recipe is saved.
        needsAttention.push({
          ingredientText: ing.ingredientText,
          quantity: ing.quantity,
          unit: ing.unit,
          confidence: 'LOW',
          isNew: true,
          reason: 'New item — it will be added to inventory with 0 stock when you save.',
        });
        warnings.push(`"${ing.ingredientText}" is new — it will be added to inventory with 0 stock when you save.`);
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

    // New items the save flow should create in inventory (stock 0).
    const newIngredients: NewIngredient[] = needsAttention
      .filter((c) => c.isNew)
      .map((c) => ({
        name: c.ingredientText,
        unit: normalizeUnit(c.unit) || 'pcs',
        quantity: c.quantity,
      }));

    return {
      productId: String(product._id),
      productName: product.name,
      variantName: variant,
      variants,
      resolution,
      matched,
      needsAttention,
      newIngredients,
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
