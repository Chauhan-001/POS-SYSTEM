/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferAssistantService — natural-language offer creation (Phase P).
 *
 * Flow (Phase 3 — deterministic, no LLM):
 *   NL request → deterministic intent parse (regex heuristics) →
 *   deterministic product/category resolution → deterministic economics for
 *   the requested config AND alternatives → advisory proposal.
 *
 * Nothing here creates or modifies offers. The owner reviews the proposal
 * and the existing CreatePromotion builder applies it on confirmation.
 *
 * FUTURE AI INTEGRATION POINT: a future AI layer may re-add an LLM intent
 * parse ahead of the deterministic resolution/economics below — the economics
 * engine is and remains the source of truth.
 */

import mongoose from 'mongoose';
import { z } from 'zod';
import { Product } from '../../../models';
import { AppError } from '../../../utils/AppError';
import { round2 } from './unitConversion';
import { profitabilityService } from './profitabilityService';

const intentSchema = z.object({
  target: z.enum(['order', 'category', 'products']),
  targetName: z.string().optional().nullable(), // category name when target=category
  discountType: z.enum(['percentage', 'flat', 'bogo']),
  value: z.number().positive().max(100000),
  timeHint: z.string().optional().nullable(),
});

const comboIntentSchema = z.object({
  targetName: z.string().optional().nullable(), // a dish/food hint (e.g. "burger") when named
  itemHints: z.array(z.string()).max(20).optional().default([]),
  desiredPrice: z.number().positive().max(1000000).optional().nullable(), // explicit price if stated
});

export class OfferAssistantService {
  async propose(restaurantId: string, text: string) {
    const cleaned = String(text || '').trim();
    if (cleaned.length < 4) throw new AppError(400, 'Describe the offer you want — e.g. "20% off paneer dishes this weekend".');

    // ── 1. Deterministic intent parse (Phase 3 — regex heuristics, was LLM) ──
    const intent: z.infer<typeof intentSchema> = (() => {
      const lower = cleaned.toLowerCase();
      const pct = lower.match(/(\d+)\s*%/);
      const flat = lower.match(/₹\s*(\d+)/);
      // Category hint: "X% off <category> dishes/items ..."
      const categoryMatch = lower.match(
        /(?:off|on)\s+([a-z][a-z ]{2,30}?)(?:\s+(?:dishes|items|products))?\s*(?:this|today|tomorrow|weekend|week|\?|$|\.)/
      );
      return {
        target: categoryMatch ? 'category' : 'order',
        targetName: categoryMatch ? categoryMatch[1].trim() : null,
        discountType: /bogo|buy\s*1|buy\s*one/i.test(lower) ? 'bogo' : pct ? 'percentage' : flat ? 'flat' : 'percentage',
        value: pct ? Number(pct[1]) : flat ? Number(flat[1]) : 10,
        timeHint: null,
      } as z.infer<typeof intentSchema>;
    })();

    // ── 2. Deterministic target resolution ─────────────────────────
    const query: any = { restaurantId, isDeleted: { $ne: true }, type: 'menu' };
    if (intent.target === 'category' && intent.targetName) {
      query.category = intent.targetName;
    } else if (intent.target === 'products' && intent.targetName) {
      query.$or = [{ name: new RegExp(intent.targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    }
    const products: any[] = await Product.find(query).limit(100).lean().exec();
    if (products.length === 0) {
      // Retry as an order-wide offer so the owner still gets usable numbers
      // when the category heuristic guessed wrong.
      if (intent.target !== 'order') {
        const fallback: any[] = await Product.find({ ...query, category: undefined, $or: undefined }).limit(100).lean().exec();
        if (fallback.length > 0) {
          return this.buildProposal(restaurantId, cleaned, { ...intent, target: 'order', targetName: null }, fallback);
        }
      }
      throw new AppError(404, `No menu products match "${intent.targetName || 'that request'}" — try a different dish or make it an order-wide offer.`);
    }

    return this.buildProposal(restaurantId, cleaned, intent, products);
  }

  /** Deterministic economics for the parsed intent + resolved products. */
  private async buildProposal(
    restaurantId: string,
    cleaned: string,
    intent: z.infer<typeof intentSchema>,
    products: any[]
  ) {
    // ── 3. Deterministic economics for the requested config ────────
    const offerLike: any = {
      title: 'Offer proposal',
      type: intent.discountType,
      value: intent.value,
      applicableProductIds: intent.target === 'products' || intent.target === 'category' ? products.map((p) => p._id) : [],
      applicableCategories: intent.target === 'category' ? [intent.targetName] : [],
    };
    const requested = await profitabilityService.offerEconomics(restaurantId, offerLike);

    // ── 4. Alternatives (one gentler, one stronger) ─────────────────
    const altValue = (v: number, deltaPct: number) => {
      const base = v * (1 - deltaPct);
      return intent.discountType === 'flat' ? Math.max(0, Math.round(base / 10) * 10) : Math.round(base * 10) / 10;
    };
    const candidates: { value: number; econ: any }[] = [{ value: intent.value, econ: requested }];
    for (const factor of [0.5, 0.25]) {
      const v = altValue(intent.value, factor);
      if (v <= 0) continue;
      candidates.push({
        value: v,
        econ: await profitabilityService.offerEconomics(restaurantId, { ...offerLike, value: v }),
      });
    }
    const best = [...candidates].sort((a, b) => (a.econ.summary?.avgContributionDrop || 0) - (b.econ.summary?.avgContributionDrop || 0))[0];

    return {
      request: cleaned,
      intent,
      targets: products.map((p: any) => ({ productId: String(p._id), name: p.name, price: p.price, category: p.category })),
      summary: {
        requested: this.summarize(candidates[0], intent.discountType),
        alternatives: candidates.slice(1).map((c) => this.summarize(c, intent.discountType)),
        recommended: this.summarize(best, intent.discountType),
      },
      warnings: requested.warnings || [],
      note: 'Deterministic estimates from current recipe costs — review in the builder before activating.',
      aiGenerated: false,
    };
  }

  /**
   * Combo Assistant (Phase Q) — "combo of burger, fries and coke" or
   * "create a combo price for pizza and wings". Deterministic item
   * extraction (connector splitting + filler stripping — Phase 3, was LLM);
   * every economic number is deterministic (individual value, variable cost,
   * contribution, margin) computed by profitabilityService. The owner picks
   * a price and applies it in the offer builder — nothing auto-creates the
   * combo.
   */
  async proposeCombo(restaurantId: string, text: string) {
    const cleaned = String(text || '').trim();
    if (cleaned.length < 4) throw new AppError(400, 'Describe the combo — e.g. "combo of burger, fries and coke".');

    // ── 1. Deterministic item extraction (Phase 3 — was LLM) ────────
    const parsed: z.infer<typeof comboIntentSchema> = (() => {
      const lower = cleaned.toLowerCase();
      const price = lower.match(/₹\s*(\d+)/) || lower.match(/(\d+)\s*rupees?/);
      // Split on connectors, then strip request-grammar filler words so the
      // remaining tokens are item hints ("combo of burger" → "burger").
      const parts = lower.split(/\s*(?:,|&|\band\b|\baur\b|\bऔर\b)\s*/);
      const hints = parts
        .map((p) =>
          p
            .replace(/\b(?:create|make|build|suggest|want|need|prepare|give|please|i|me|the|a|an|combo|meal|bundle|of|with|for|at|price|priced|today|tomorrow)\b/g, ' ')
            .replace(/₹|\d+(?:\.\d+)?\s*(?:rs\.?|rupees?|inr)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter((p) => p.length >= 2)
        .slice(0, 12);
      return {
        targetName: hints[0] || null,
        itemHints: hints,
        desiredPrice: price ? Number(price[1]) : null,
      } as z.infer<typeof comboIntentSchema>;
    })();

    // ── 2. Resolve items deterministically (tenant-scoped) ───────────
    const hints = [...new Set([...(parsed.itemHints || []), parsed.targetName].filter(Boolean) as string[])];
    const products: any[] = [];
    if (hints.length > 0) {
      for (const hint of hints.slice(0, 12)) {
        const name = String(hint).trim();
        if (!name) continue;
        const found = await Product.find({
          restaurantId,
          isDeleted: { $ne: true },
          availability: true,
          name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        }).limit(1).lean().exec();
        if (found[0]) products.push(found[0]);
      }
    }
    if (products.length === 0) {
      throw new AppError(404, `No menu products match "${hints[0] || 'that request'}" — name the combo items or pick them in the builder.`);
    }

    // ── 3. Deterministic economics at candidate prices ───────────────
    const individualValue = round2(products.reduce((s: number, p: any) => s + (Number(p.price) || 0), 0));
    const candidates: { price: number; econ: any }[] = [];
    const pricePoints = [0.6, 0.7, 0.75, 0.8, 0.85];
    const seed = parsed.desiredPrice && parsed.desiredPrice < individualValue ? parsed.desiredPrice : Math.round(individualValue * 0.75);
    const points = [seed, ...pricePoints.map((f) => Math.round(individualValue * f))]
      .filter((p, i, arr) => p > 0 && arr.indexOf(p) === i)
      .sort((a, b) => b - a);
    for (const price of points.slice(0, 5)) {
      const econ = await profitabilityService.offerEconomics(restaurantId, {
        title: 'Combo',
        type: 'combo',
        value: price,
        applicableProductIds: products.map((p) => p._id),
      });
      candidates.push({ price, econ });
    }

    // Rank: prefer the cheapest price that stays healthy/tight (margin >= 20).
    const ranked = [...candidates].sort((a, b) => {
      const sA = (a.econ.combo?.status || 'tight');
      const sB = (b.econ.combo?.status || 'tight');
      const rank = (s: string) => (s === 'healthy' ? 0 : s === 'tight' ? 1 : 2);
      if (rank(sA) !== rank(sB)) return rank(sA) - rank(sB);
      return (a.econ.combo?.contributionMarginPercent || 0) - (b.econ.combo?.contributionMarginPercent || 0);
    });
    const recommended = ranked[0];

    return {
      request: cleaned,
      targets: products.map((p: any) => ({ productId: String(p._id), name: p.name, price: p.price, category: p.category })),
      individualValue,
      combos: candidates.map((c) => ({
        price: c.price,
        customerSavings: Math.max(0, round2(individualValue - c.price)),
        contribution: c.econ.combo?.contribution,
        contributionMarginPercent: c.econ.combo?.contributionMarginPercent,
        status: c.econ.combo?.status,
        warnings: c.econ.warnings || [],
      })),
      recommended: {
        price: recommended.price,
        contribution: recommended.econ.combo?.contribution,
        contributionMarginPercent: recommended.econ.combo?.contributionMarginPercent,
        status: recommended.econ.combo?.status,
        warnings: recommended.econ.warnings || [],
      },
      note: 'Deterministic estimates from current recipe costs — review in the builder before saving.',
      aiGenerated: false,
    };
  }

  private summarize(c: { value: number; econ: any }, type: string) {
    const econ = c.econ;
    const avg = econ.summary?.avgContributionDrop || 0;
    const worst = (econ.rows || [])[0];
    return {
      type,
      value: c.value,
      products: econ.rows?.length || 0,
      withRecipes: econ.summary?.withRecipes || 0,
      avgContributionDrop: round2(avg),
      healthy: avg < 25 && (econ.warnings || []).length === 0 ? 'healthy' : avg < 50 ? 'tight' : 'risky',
      warningCount: (econ.warnings || []).length,
      worst: worst ? { product: worst.productName, drop: worst.contributionDropPercent } : undefined,
    };
  }
}

export const offerAssistantService = new OfferAssistantService();
