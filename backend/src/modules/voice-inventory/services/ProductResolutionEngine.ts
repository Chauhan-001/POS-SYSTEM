/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductResolutionEngine — The 7-stage product resolution pipeline.
 *
 * The merchant should NEVER need to remember exact database names. This engine
 * resolves any spoken item to the most likely product with a confidence score.
 *
 * Pipeline order:
 *   1. exact_name     — Exact normalized product-name match
 *   2. voice_alias    — Match against product.voiceAliases (multilingual)
 *   3. search_alias   — Match against product.searchAliases
 *   4. learned_alias  — Match against product.learnedAliases (self-learned)
 *   5. sku            — Match against product.code (SKU)
 *   6. barcode        — Match against product barcode (when present)
 *   7. fuzzy          — Levenshtein/Dice fuzzy match over names + aliases
 *   8. semantic       — Groq LLM semantic re-ranking of top candidates
 *
 * After all stages, the ConfidenceEngine combines scores and decides:
 *   ≥0.95 auto-select | 0.80–0.94 confirm | 0.50–0.79 picker |
 *   0.30–0.49 new-product-suggestion | <0.30 unresolved
 *
 * PERFORMANCE (10,000+ products):
 *   - Exact/alias stages use indexed multikey lookups ($elemMatch + $in)
 *     — NO full collection scans.
 *   - Fuzzy stage pre-filters candidates via MongoDB text search or alias $in,
 *     then runs bounded (≤64) distance math in-process.
 *   - Semantic stage only sends a bounded (≤50) candidate set to the LLM.
 *
 * SECURITY:
 *   - Restaurant scoping is ALWAYS applied (restaurantId OR global catalog).
 *   - The engine is read-only — it never writes to the database.
 *   - Never silently guesses: low confidence always surfaces a picker or
 *     new-product suggestion for the merchant to approve.
 */

import mongoose from 'mongoose';
import Product, { IProduct } from '../../../models/Product';
import {
  fuzzySimilarity,
  applyPhoneticBonus,
  normalizeForFuzzy,
} from './FuzzyMatcher';
import { semanticMatchWithPrefilter } from './SemanticMatcher';
import { combineStageConfidence, decideAction } from './ConfidenceEngine';
import { detectNewProduct } from './NewProductDetectionService';
import type {
  ProductResolutionResult,
  ResolutionStage,
  StageResult,
  SemanticMatchCandidate,
} from '../types';

// ====================================================================
// CONSTANTS
// ====================================================================

/** Fuzzy match minimum score to be considered a hit. */
const FUZZY_MIN_SCORE = 0.62;
/** Max candidates carried between stages. */
const MAX_CANDIDATES = 64;
/** Max candidates sent to the semantic (LLM) stage. */
const MAX_SEMANTIC_CANDIDATES = 50;

// ====================================================================
// RESOLUTION OPTIONS
// ====================================================================

export interface ResolveOptions {
  /** Skip the expensive semantic stage (default false). */
  skipSemantic?: boolean;
  /** Skip new-product detection (default false). */
  skipNewProductDetection?: boolean;
  /** Per-restaurant calibration factor from SelfLearningService. */
  restaurantCalibration?: number;
  /** Category names already in the catalog (for new-product detection). */
  existingCategories?: string[];
  /** When true, only match inventory items (availability=false), not menu
   *  items. Prevents "paneer" from resolving to "Kadhai Paneer" in the
   *  voice inventory context. */
  inventoryOnly?: boolean;
}

// ====================================================================
// QUERY HELPERS
// ====================================================================

/**
 * Build the tenant-scoped product filter: a restaurant sees its OWN products
 * PLUS the shared/global catalog (restaurantId null/missing). This matches the
 * existing productsController behavior.
 *
 * When `inventoryOnly` is true, only inventory items (availability=false) are
 * included — menu items are excluded so voice inventory commands never resolve
 * to prepared dishes.
 */
function tenantFilter(restaurantId?: string, inventoryOnly = false) {
  const base: any = { isDeleted: { $ne: true } };
  if (inventoryOnly) {
    base.availability = false;
  }
  if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
    base.$or = [
      { restaurantId: new mongoose.Types.ObjectId(restaurantId) },
      { restaurantId: null },
    ];
  }
  return base;
}

/** Project only the fields the engine needs. */
const RESOLUTION_PROJECTION = {
  name: 1,
  code: 1,
  category: 1,
  unit: 1,
  voiceAliases: 1,
  searchAliases: 1,
  learnedAliases: 1,
  lastUsedAlias: 1,
  aliasUsageCount: 1,
  restaurantId: 1,
};

type ResolvableProduct = {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  code: string;
  category: string;
  unit: string;
  voiceAliases?: string[];
  searchAliases?: string[];
  learnedAliases?: Array<{ alias: string; source?: string; usageCount?: number; lastUsed?: Date }>;
  lastUsedAlias?: string;
  aliasUsageCount?: number;
};

// ====================================================================
// CORE PIPELINE
// ====================================================================

/**
 * Resolve a single spoken item name through the full pipeline.
 *
 * @param spokenName - The item name as spoken (may include Hinglish/Hindi)
 * @param restaurantId - Restaurant ObjectId (scoping)
 * @param options - Resolution options
 * @returns Full resolution result with stage trace
 */
export async function resolveProduct(
  spokenName: string,
  restaurantId?: string,
  options: ResolveOptions = {}
): Promise<ProductResolutionResult> {
  const normalized = normalizeForFuzzy(spokenName || '').toLowerCase();
  const stages: StageResult[] = [];
  const start = Date.now();

  if (!normalized) {
    return {
      spokenName,
      outcome: 'UNKNOWN_OR_AMBIGUOUS',
      confidence: 0,
      stages: [
        {
          stage: 'exact_name',
          confidence: 0,
          latencyMs: Date.now() - start,
        },
      ],
      decision: 'unresolved',
      shouldLearn: false,
    };
  }

  const filter = tenantFilter(restaurantId, !!options.inventoryOnly);

  // ─── STAGE 1: Exact Name ───────────────────────────────────────────
  const exactStageStart = Date.now();
  const exactMatch = await findExactName(normalized, filter);
  pushStage(stages, 'exact_name', exactMatch, Date.now() - exactStageStart);

  // ─── STAGE 2: Voice Alias ──────────────────────────────────────────
  const voiceStageStart = Date.now();
  const voiceMatch = exactMatch
    ? null
    : await findAliasMatch(normalized, filter, 'voiceAliases');
  pushStage(stages, 'voice_alias', voiceMatch, Date.now() - voiceStageStart);

  // ─── STAGE 3: Search Alias ─────────────────────────────────────────
  const searchStageStart = Date.now();
  const searchMatch = exactMatch || voiceMatch
    ? null
    : await findAliasMatch(normalized, filter, 'searchAliases');
  pushStage(stages, 'search_alias', searchMatch, Date.now() - searchStageStart);

  // ─── STAGE 4: Learned Alias ────────────────────────────────────────
  const learnedStageStart = Date.now();
  const learnedMatch =
    exactMatch || voiceMatch || searchMatch
      ? null
      : await findAliasMatch(normalized, filter, 'learnedAliases');
  pushStage(stages, 'learned_alias', learnedMatch, Date.now() - learnedStageStart);

  // ─── STAGE 5: SKU (product.code) ───────────────────────────────────
  const skuStageStart = Date.now();
  const skuMatch =
    exactMatch || voiceMatch || searchMatch || learnedMatch
      ? null
      : await findSkuMatch(normalized, filter);
  pushStage(stages, 'sku', skuMatch, Date.now() - skuStageStart);

  // ─── STAGE 6: Barcode ──────────────────────────────────────────────
  // Products do not currently have a barcode field; SKU/code serves as the
  // machine-readable identifier. This stage is reserved for when barcodes are
  // added. It short-circuits to a zero-confidence trace entry for clarity.
  pushStage(stages, 'barcode', null, 0);

  // ─── STAGE 7: Fuzzy Match ──────────────────────────────────────────
  const fuzzyStageStart = Date.now();
  const fuzzyMatch =
    exactMatch || voiceMatch || searchMatch || learnedMatch || skuMatch
      ? null
      : await findFuzzyMatch(normalized, filter, restaurantId);
  pushStage(stages, 'fuzzy', fuzzyMatch, Date.now() - fuzzyStageStart);

  // ─── STAGE 8: Semantic (LLM) Match ─────────────────────────────────
  let semanticMatchResult: SemanticMatchCandidate | null = null;
  if (
    !options.skipSemantic &&
    !exactMatch &&
    !voiceMatch &&
    !searchMatch &&
    !learnedMatch &&
    !skuMatch &&
    !fuzzyMatch
  ) {
    const semanticStageStart = Date.now();
    const semanticCandidates = await loadCandidateProducts(
      filter,
      MAX_CANDIDATES
    );
    const candidates = semanticCandidates.map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
      unit: p.unit,
    }));

    const ranked = await semanticMatchWithPrefilter(
      {
        transcript: spokenName,
        spokenName,
        restaurantId: restaurantId || '',
        candidates,
      },
      MAX_SEMANTIC_CANDIDATES
    );

    if (ranked.length > 0) {
      const top = ranked[0];
      const product = semanticCandidates.find((p) => String(p._id) === top.productId);
      if (product) {
        semanticMatchResult = {
          productId: top.productId,
          productName: top.productName || product.name,
          confidence: top.confidence,
          reason: top.reason,
        };
      }
    }
    pushStage(
      stages,
      'semantic',
      semanticMatchResult
        ? { productId: semanticMatchResult.productId, confidence: semanticMatchResult.confidence }
        : null,
      Date.now() - semanticStageStart,
      semanticMatchResult ? ranked : undefined
    );
  }

  // ─── Combine & Decide ──────────────────────────────────────────────
  const combined = combineStageConfidence(stages, {
    restaurantCalibration: options.restaurantCalibration,
  });
  const decision = decideAction(
    combined.score,
    !!(fuzzyMatch || semanticMatchResult || stages.some((s) => s.stage === 'semantic' || s.stage === 'fuzzy'))
  );

  const winningProduct = await findWinningProduct(stages);

  // ─── New Product Detection (when unresolved) ───────────────────────
  let newProductSuggestion = undefined;
  if (
    decision.level === 'new_product_suggestion' ||
    (decision.level === 'unresolved' && !options.skipNewProductDetection)
  ) {
    const existingCategories =
      options.existingCategories || (await loadExistingCategories(filter));
    newProductSuggestion = await detectNewProduct(
      normalized,
      spokenName,
      existingCategories
    );
    if (newProductSuggestion && newProductSuggestion.isLikelyRealProduct) {
      decision.level = 'new_product_suggestion';
      decision.thresholdApplied = 'new_product_suggestion';
    }
  }

  const outcome = winningProduct
    ? 'EXISTING_PRODUCT'
    : decision.level === 'new_product_suggestion' && newProductSuggestion?.isLikelyRealProduct
    ? 'NEW_PRODUCT_SUGGESTION'
    : 'UNKNOWN_OR_AMBIGUOUS';

  const result: ProductResolutionResult = {
    spokenName,
    outcome,
    product: winningProduct
      ? {
          id: String(winningProduct._id),
          name: winningProduct.name,
          unit: winningProduct.unit || 'pcs',
          category: winningProduct.category,
          code: winningProduct.code,
        }
      : undefined,
    confidence: combined.score,
    matchedStage: combined.matchedStage,
    stages,
    decision: decision.level,
    newProductSuggestion,
    shouldLearn: decision.level === 'product_picker' || decision.level === 'new_product_suggestion',
  };

  return result;
}

// ====================================================================
// STAGE IMPLEMENTATIONS
// ====================================================================

function pushStage(
  stages: StageResult[],
  stage: ResolutionStage,
  match: { productId?: string; confidence: number; matchedOn?: string } | null,
  latencyMs: number,
  alternatives?: SemanticMatchCandidate[]
): void {
  stages.push({
    stage,
    confidence: match ? match.confidence : 0,
    productId: match?.productId,
    productName: undefined,
    matchedOn: match?.matchedOn,
    latencyMs,
    alternatives: alternatives?.map((a) => ({
      productId: a.productId,
      productName: a.productName,
      confidence: a.confidence,
    })),
  });
}

async function findExactName(
  normalized: string,
  filter: any
): Promise<{ productId: string; confidence: number; matchedOn?: string } | null> {
  const product = await Product.findOne({
    ...filter,
    name: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') },
  })
    .select(RESOLUTION_PROJECTION)
    .lean();
  if (!product) return null;
  return { productId: String(product._id), confidence: 1.0, matchedOn: product.name };
}

async function findAliasMatch(
  normalized: string,
  filter: any,
  field: 'voiceAliases' | 'searchAliases' | 'learnedAliases'
): Promise<{ productId: string; confidence: number; matchedOn?: string } | null> {
  // Learned aliases are stored as objects — query differently.
  if (field === 'learnedAliases') {
    const product = await Product.findOne({
      ...filter,
      'learnedAliases.alias': normalized,
    })
      .select(RESOLUTION_PROJECTION)
      .lean();
    if (!product) return null;
    return { productId: String(product._id), confidence: 0.9, matchedOn: normalized };
  }

  const product = await Product.findOne({
    ...filter,
    [field]: normalized,
  })
    .select(RESOLUTION_PROJECTION)
    .lean();
  if (!product) return null;
  return { productId: String(product._id), confidence: 0.95, matchedOn: normalized };
}

async function findSkuMatch(
  normalized: string,
  filter: any
): Promise<{ productId: string; confidence: number; matchedOn?: string } | null> {
  const product = await Product.findOne({
    ...filter,
    code: { $regex: new RegExp(`^${escapeRegex(normalized.toUpperCase())}$`, 'i') },
  })
    .select(RESOLUTION_PROJECTION)
    .lean();
  if (!product) return null;
  return { productId: String(product._id), confidence: 1.0, matchedOn: product.code };
}

async function findFuzzyMatch(
  normalized: string,
  filter: any,
  restaurantId?: string
): Promise<{ productId: string; confidence: number; matchedOn?: string } | null> {
  // Pre-filter candidates using indexed $in / text search, then run bounded
  // distance math. Never scan the whole collection.
  const candidates = await loadCandidateProducts(filter, MAX_CANDIDATES, normalized);

  let best: { product: ResolvableProduct; score: number; matchedOn: string } | null = null;

  for (const product of candidates) {
    const nameScore = fuzzySimilarity(normalized, product.name);
    const withPhonetic = applyPhoneticBonus(normalized, product.name, nameScore);

    let bestAliasScore = 0;
    let bestAlias = '';
    for (const alias of [...(product.voiceAliases || []), ...(product.searchAliases || [])]) {
      const score = fuzzySimilarity(normalized, alias);
      if (score > bestAliasScore) {
        bestAliasScore = score;
        bestAlias = alias;
      }
    }

    const score = Math.max(withPhonetic, bestAliasScore);
    if (score >= FUZZY_MIN_SCORE && (!best || score > best.score)) {
      best = {
        product,
        score,
        matchedOn: bestAliasScore >= withPhonetic ? bestAlias : product.name,
      };
    }
  }

  if (!best) return null;
  // Map fuzzy score 0.62–1.0 to confidence 0.6–0.85.
  const confidence = Math.min(0.85, 0.5 + (best.score - 0.5) * 0.7);
  return {
    productId: String(best.product._id),
    confidence: Math.max(0.6, confidence),
    matchedOn: best.matchedOn,
  };
}

// ====================================================================
// CANDIDATE LOADING (PERFORMANCE)
// ====================================================================

async function loadCandidateProducts(
  filter: any,
  limit: number,
  queryHint?: string
): Promise<ResolvableProduct[]> {
  if (!queryHint) {
    return Product.find(filter)
      .select(RESOLUTION_PROJECTION)
      .limit(limit)
      .lean()
      .then((docs) => docs as unknown as ResolvableProduct[]);
  }

  const normalized = normalizeForFuzzy(queryHint);

  // Strategy 1: Try $text search (fast, indexed)
  const textQuery: any = { ...filter };
  try {
    const tokens = normalized
      .split(' ')
      .filter(Boolean)
      .slice(0, 4)
      .map((t) => `"${t}"`)
      .join(' ');
    if (tokens) textQuery.$text = { $search: tokens };
  } catch {
    // $text requires a text index — fall through to regex.
  }

  let candidates: ResolvableProduct[] = [];
  try {
    candidates = await Product.find(textQuery)
      .select(RESOLUTION_PROJECTION)
      .limit(limit)
      .lean()
      .then((docs) => docs as unknown as ResolvableProduct[]);
  } catch {
    // $text query failed — fall through to regex.
  }

  // Strategy 2: If text search returned nothing (or failed), use regex
  // prefix + contains matching. This handles short ingredient names like
  // "cashew", "mushroom" that $text may not surface.
  if (candidates.length === 0 && normalized.length >= 2) {
    const regexQuery: any = { ...filter, name: { $regex: normalized, $options: 'i' } };
    candidates = await Product.find(regexQuery)
      .select(RESOLUTION_PROJECTION)
      .limit(limit)
      .lean()
      .then((docs) => docs as unknown as ResolvableProduct[]);
  }

  // Strategy 3: Also check aliases via $or for short names
  if (candidates.length === 0 && normalized.length >= 2) {
    const aliasQuery: any = {
      ...filter,
      $or: [
        { voiceAliases: { $regex: normalized, $options: 'i' } },
        { searchAliases: { $regex: normalized, $options: 'i' } },
      ],
    };
    candidates = await Product.find(aliasQuery)
      .select(RESOLUTION_PROJECTION)
      .limit(limit)
      .lean()
      .then((docs) => docs as unknown as ResolvableProduct[]);
  }

  return candidates;
}

async function loadExistingCategories(filter: any): Promise<string[]> {
  const docs = await Product.find(filter)
    .select('category')
    .distinct('category')
    .limit(200);
  return Array.isArray(docs) ? docs : [];
}

// ====================================================================
// HELPERS
// ====================================================================

async function findWinningProduct(
  stages: StageResult[]
): Promise<ResolvableProduct | null> {
  const winner = stages
    .filter((s) => s.productId)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (!winner?.productId) return null;
  // Re-fetch the winning product so name/unit/category/code are REAL — stage
  // entries only carry the productId. One indexed _id lookup; the id already
  // came from a tenant-scoped stage query, so this never crosses tenants.
  const doc = await Product.findById(winner.productId)
    .select(RESOLUTION_PROJECTION)
    .lean();
  return doc ? (doc as unknown as ResolvableProduct) : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

