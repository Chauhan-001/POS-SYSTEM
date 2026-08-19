/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductResolver.ts — Reusable product resolution layer (Phase 11).
 *
 * A thin, generic front door over the existing ProductResolutionEngine so the
 * SAME deterministic-first cascade serves every surface:
 *   - POS typed search / barcode / SKU (via POST /api/products/resolve)
 *   - customer-site menu search (via GET /api/public-store/:token/search)
 *   - voice inventory (unchanged — the voice flow still calls resolveProduct
 *     directly; this layer adds no behavior change to it)
 *
 * Cascade (deterministic first, semantic LAST resort):
 *   EXACT → NORMALIZED → ALIAS (voice/search/learned) → SKU → BARCODE → FUZZY
 *   → SEMANTIC (only when the caller opts in AND deterministic stages failed)
 *
 * Guarantees:
 *   - Deterministic matches never trigger an LLM call (semantic is skipped).
 *   - Tenant isolation: the DB path is scoped to the restaurant's own products
 *     (+ global catalog fallback, same convention as productsController).
 *   - Ambiguity: when several products match strongly, the resolver returns the
 *     ranked candidates instead of silently picking one (critical in POS).
 *   - The candidate path (customer site) works over a SANITIZED list — the
 *     caller supplies only { id, name, category, price } and the resolver
 *     never sees costs/inventory — and semantic product ids are validated
 *     against that exact candidate set (never invented).
 */

import { resolveProduct } from './ProductResolutionEngine';
import { semanticMatchWithPrefilter } from './SemanticMatcher';
import { fuzzySimilarity, normalizeForFuzzy } from './FuzzyMatcher';
import type { ResolutionStage } from '../types';

// ─── Types ────────────────────────────────────────────────────────────

export type MatchBy =
  | 'EXACT'
  | 'NORMALIZED'
  | 'ALIAS'
  | 'SKU'
  | 'BARCODE'
  | 'FUZZY'
  | 'SEMANTIC';

export type ResolveDecision = 'auto_select' | 'confirm' | 'product_picker' | 'new_product_suggestion' | 'unresolved';

export interface ResolvedMenuProduct {
  productId?: string;
  productName?: string;
  matchedBy?: MatchBy;
  confidence: number;
  decision: ResolveDecision;
  alternatives: Array<{ productId: string; productName: string; confidence: number }>;
}

export interface ResolveOptions {
  /** Allow the semantic (LLM) stage when deterministic stages fail. Default false. */
  allowSemantic?: boolean;
}

/** Minimal sanitized candidate shape (no costs/inventory). */
export interface ResolvableCandidate {
  id: string;
  name: string;
  category?: string;
  /** Optional machine-readable code (SKU/barcode) for code lookups. */
  code?: string;
  /** Optional alias arrays for alias matching. */
  searchAliases?: string[];
  voiceAliases?: string[];
  learnedAliases?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

const STAGE_TO_MATCH: Record<ResolutionStage, MatchBy> = {
  exact_name: 'EXACT',
  voice_alias: 'ALIAS',
  search_alias: 'ALIAS',
  learned_alias: 'ALIAS',
  sku: 'SKU',
  barcode: 'BARCODE',
  fuzzy: 'FUZZY',
  semantic: 'SEMANTIC',
};

/** Lower bound a match must reach to count (same value the engine uses). */
const FUZZY_MIN_SCORE = 0.62;
/**
 * Lower bound for accepting a SEMANTIC (LLM) pick. The LLM is the last resort
 * and never authoritative: below this it is a coin flip, so the resolver stays
 * `unresolved` (with ranked alternatives) instead of confirming a guess.
 */
const SEMANTIC_MIN_CONFIDENCE = 0.5;

// ─── DB path — tenant-scoped, delegates to the existing engine ───────

/**
 * Resolve a typed/query string against the restaurant's real product catalog
 * (tenant-scoped). Deterministic stages run first; the LLM semantic stage only
 * runs when `allowSemantic` is true and every deterministic stage missed.
 */
export async function resolveMenuProduct(
  restaurantId: string,
  query: string,
  options: ResolveOptions = {},
): Promise<ResolvedMenuProduct> {
  const result = await resolveProduct(query || '', restaurantId, {
    skipSemantic: !options.allowSemantic,
    skipNewProductDetection: true,
  });

  const alternatives = result.stages
    .filter((s) => s.alternatives && s.alternatives.length > 0)
    .flatMap((s) => (s.alternatives || []).map((a) => ({
      productId: a.productId,
      productName: a.productName || '',
      confidence: a.confidence,
    })));

  if (result.product) {
    return {
      productId: result.product.id,
      productName: result.product.name,
      matchedBy: result.matchedStage ? STAGE_TO_MATCH[result.matchedStage] : undefined,
      confidence: result.confidence,
      decision: result.decision,
      alternatives,
    };
  }

  return {
    confidence: result.confidence,
    decision: result.decision,
    alternatives,
  };
}

// ─── Candidate path — in-memory over a sanitized list ────────────────

/**
 * Resolve a query against a caller-supplied list of sanitized candidates.
 * Used by the customer-site menu search (and any client-side list) where the
 * resolver must never see costs, margins or inventory. Semantic candidates are
 * validated against the supplied set — the LLM can never invent a product.
 */
export async function resolveFromCandidates(
  query: string,
  candidates: ResolvableCandidate[],
  options: ResolveOptions = {},
): Promise<ResolvedMenuProduct> {
  const normalized = normalizeForFuzzy(query || '').toLowerCase();
  if (!normalized || candidates.length === 0) {
    return { confidence: 0, decision: 'unresolved', alternatives: [] };
  }

  const normName = (n: string) => normalizeForFuzzy(n).toLowerCase();

  // 1. EXACT — full normalized name equality.
  const exact = candidates.find((c) => normName(c.name) === normalized);
  if (exact) {
    return {
      productId: exact.id,
      productName: exact.name,
      matchedBy: 'EXACT',
      confidence: 1,
      decision: 'auto_select',
      alternatives: [],
    };
  }

  // 2. NORMALIZED — the query equals a candidate's name (case/space-insensitive
  //    after fuzzy normalization, which also strips diacritics).
  const normalizedHit = candidates.find((c) => normName(c.name) === normalized);
  if (normalizedHit) {
    return {
      productId: normalizedHit.id,
      productName: normalizedHit.name,
      matchedBy: 'NORMALIZED',
      confidence: 0.97,
      decision: 'auto_select',
      alternatives: [],
    };
  }

  // 3. ALIAS — search/voice/learned alias equality.
  const aliasHit = candidates.find((c) => {
    const aliases = [...(c.searchAliases || []), ...(c.voiceAliases || []), ...(c.learnedAliases || [])];
    return aliases.some((a) => normName(a) === normalized);
  });
  if (aliasHit) {
    return {
      productId: aliasHit.id,
      productName: aliasHit.name,
      matchedBy: 'ALIAS',
      confidence: 0.95,
      decision: 'auto_select',
      alternatives: [],
    };
  }

  // 4. SKU / code equality.
  const codeHit = candidates.find((c) => c.code && normName(c.code) === normalized);
  if (codeHit) {
    return {
      productId: codeHit.id,
      productName: codeHit.name,
      matchedBy: 'SKU',
      confidence: 0.98,
      decision: 'auto_select',
      alternatives: [],
    };
  }

  // 5. FUZZY — bounded distance over names + aliases; ties return candidates.
  const scored = candidates
    .map((c) => {
      const haystacks = [c.name, ...(c.searchAliases || []), ...(c.voiceAliases || []), ...(c.learnedAliases || [])];
      let best = 0;
      for (const h of haystacks) {
        const s = fuzzySimilarity(normalized, normName(h));
        if (s > best) best = s;
      }
      return { c, score: best };
    })
    .filter((x) => x.score >= FUZZY_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const top = scored[0];
    // Ambiguity: when the #1 and #2 candidates score within 0.05 of each other
    // (e.g. "paneer" → Paneer Tikka/Chilli/Roll), return the ranked picker
    // instead of silently choosing one — critical in POS billing.
    const second = scored[1];
    const tied = scored.length > 1 && top.score - second.score < 0.05;
    if (tied) {
      return {
        confidence: top.score,
        decision: 'product_picker',
        alternatives: scored.slice(0, 5).map((x) => ({ productId: x.c.id, productName: x.c.name, confidence: x.score })),
      };
    }
    return {
      productId: top.c.id,
      productName: top.c.name,
      matchedBy: 'FUZZY',
      confidence: top.score,
      decision: top.score >= 0.9 ? 'auto_select' : 'confirm',
      alternatives: [],
    };
  }

  // 6. SEMANTIC — LAST RESORT, only when the caller opted in.
  if (options.allowSemantic && query.trim().length >= 2) {
    const ranked = await semanticMatchWithPrefilter(
      {
        transcript: query,
        spokenName: query,
        restaurantId: '',
        candidates: candidates.slice(0, 50).map((c) => ({ id: c.id, name: c.name, category: c.category || '', unit: 'pcs' })),
      },
      50,
    );
    // Validate: only ids present in the supplied candidate set are trusted.
    const idSet = new Set(candidates.map((c) => c.id));
    const valid = ranked.filter((r) => idSet.has(r.productId));
    if (valid.length > 0) {
      const top = valid[0];
      const name = candidates.find((c) => c.id === top.productId)?.name || top.productName;
      const alternatives = valid.slice(0, 5).map((a) => ({
        productId: a.productId,
        productName: candidates.find((c) => c.id === a.productId)?.name || a.productName || '',
        confidence: a.confidence,
      }));
      // 11.5 — a semantic pick below the floor is a guess, not a match: surface
      // the ranked alternatives but never confirm a low-confidence selection.
      if (top.confidence < SEMANTIC_MIN_CONFIDENCE) {
        return { confidence: top.confidence, decision: 'unresolved', alternatives };
      }
      return {
        productId: top.productId,
        productName: name,
        matchedBy: 'SEMANTIC',
        confidence: top.confidence,
        decision: top.confidence >= 0.9 ? 'auto_select' : 'confirm',
        alternatives,
      };
    }
  }

  return { confidence: 0, decision: 'unresolved', alternatives: [] };
}
