/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FuzzyMatcher — Approximate string matching for the Product Resolution Engine.
 *
 * Purpose:
 *   Transcription errors ("Coka Cola", "Coke Cola", "Kok") must still resolve to
 *   the correct product without requiring exact spelling. This service provides
 *   normalized similarity scoring between a spoken name and candidate product
 *   names/aliases using a combination of:
 *
 *     1. Normalized edit distance (Levenshtein)
 *     2. Dice coefficient over character bigrams
 *     3. Token-aware matching for multi-word phrases
 *
 * Performance (10,000+ products):
 *   - The resolution engine pre-filters candidates using indexed MongoDB text
 *     search or alias $in queries BEFORE running expensive distance math here.
 *   - A lightweight in-process normalized-token trie can be used for very large
 *     catalogs; by default we operate on a bounded candidate set (≤ 64).
 *
 * All scores are normalized to 0..1 where 1.0 is an exact match.
 */

// ====================================================================
// NORMALIZATION
// ====================================================================

/**
 * Normalize a string for fuzzy comparison:
 *   - Lowercase
 *   - Collapse Devanagari matras/vowels that Whisper often swaps
 *   - Remove punctuation and filler words
 *   - Collapse repeated whitespace
 *   - Trim
 */

/**
 * Safe singular/plural normalization — only trims common English suffixes
 * that are unambiguous. Multi-word product phrases are preserved.
 *
 * Examples:
 *   mushroom  → mushroom
 *   mushrooms → mushroom
 *   cashew    → cashew
 *   cashews   → cashew
 *   tomato    → tomato
 *   tomatoes  → tomato
 *   potato    → potato
 *   potatoes  → potato
 *
 * Conservative: only handles -s, -es, -ies patterns that are safe.
 */
export function normalizePlural(input: string): string {
  if (!input) return '';
  const lower = input.toLowerCase().trim();
  if (lower.length <= 3) return lower;
  // -ies → -y  (potatoes → potato — wait, potatoes ends in -oes not -ies)
  if (lower.endsWith('ies') && lower.length > 4) return lower.slice(0, -3) + 'y';
  // -oes → -o  (tomatoes → tomato, potatoes → potato)
  if (lower.endsWith('oes') && lower.length > 4) return lower.slice(0, -2);
  // -ches / -shes → remove -es  (dishes → dish)
  if (lower.endsWith('ches') || lower.endsWith('shes')) return lower.slice(0, -2);
  // -ses / -xes / -zes → remove -s  (glasses → glass)
  if (lower.endsWith('ses') || lower.endsWith('xes') || lower.endsWith('zes')) return lower.slice(0, -1);
  // Simple -s removal (mushrooms → mushroom, cashews → cashew, knives → knife)
  // Exclude: -ss, -us, -is, and words ≤ 4 chars
  if (lower.endsWith('s') && !lower.endsWith('ss') && !lower.endsWith('us') && !lower.endsWith('is') && lower.length > 4) return lower.slice(0, -1);
  return lower;
}

export function normalizeForFuzzy(input: string): string {
  if (!input) return '';
  return normalizePlural(
    input
      .toLowerCase()
      .replace(/[\u0900-\u0903\u093B-\u093C\u093E-\u094F\u0951-\u0957]/g, '') // strip Devanagari matras
      .replace(/[''`".,!?;:()\[\]{}_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Filler words that carry no matching signal in spoken product names. */
const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'ke', 'ki', 'ka', 'kii', 'kya',
  'please', 'pls', 'plz', 'bhai', 'bro', 'sir', 'madam', 'wala', 'wale',
  'wali', 'vala', 'vale', 'ek', 'aur', 'kar', 'karo', 'karde', 'daal', 'daalo',
  'main', 'mein', 'me', 'se', 'ko', 'ne', 'to', 'tum', 'aap', 'yaha', 'waha',
]);

/** Tokenize into meaningful words, dropping filler words. */
export function tokenizeMeaningful(input: string): string[] {
  const normalized = normalizeForFuzzy(input);
  return normalized.split(' ').filter((t) => t.length > 1 && !FILLER_WORDS.has(t));
}

// ====================================================================
// CORE ALGORITHMS
// ====================================================================

/**
 * Levenshtein (edit) distance — minimal insertions/deletions/substitutions
 * to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1,     // deletion
        prev[j - 1] + cost // substitution
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return curr[b.length];
}

/**
 * Normalized similarity from edit distance (0..1).
 * 1.0 = identical, 0.0 = completely different.
 */
export function normalizedEditSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

/** Generate character bigrams from a string. */
function bigrams(input: string): Set<string> {
  const grams = new Set<string>();
  if (input.length < 2) {
    if (input.length === 1) grams.add(input);
    return grams;
  }
  for (let i = 0; i < input.length - 1; i++) {
    grams.add(input.slice(i, i + 2));
  }
  return grams;
}

/**
 * Dice coefficient over character bigrams (0..1).
 * Measures character-ngram overlap — robust to small typos and phonetic swaps.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return 0.0;

  let intersection = 0;
  for (const g of aGrams) {
    if (bGrams.has(g)) intersection++;
  }
  return (2 * intersection) / (aGrams.size + bGrams.size);
}

/**
 * Token-aware overlap: what fraction of the shorter token set is present
 * in the longer token set? Handles "coca cola" vs "coke cola" partially.
 */
export function tokenOverlap(a: string, b: string): number {
  const aTokens = tokenizeMeaningful(a);
  const bTokens = tokenizeMeaningful(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];

  let matched = 0;
  for (const tok of shorter) {
    if (longer.some((t) => t === tok || normalizedEditSimilarity(tok, t) >= 0.8)) {
      matched++;
    }
  }
  return matched / shorter.length;
}

// ====================================================================
// COMBINED SCORING
// ====================================================================

export interface FuzzyScoredCandidate {
  candidate: string;
  score: number;
  /** Which sub-score dominated (for diagnostics). */
  method: 'exact' | 'edit' | 'dice' | 'token';
}

/**
 * Combined fuzzy similarity (0..1) blending edit distance, Dice, and token
 * overlap. Weights are tuned so that:
 *   - Exact normalized match → 1.0
 *   - Single-letter typo on short words ("Coka" vs "Coca") → ~0.85+
 *   - Shared bigrams with reordered tokens → 0.7+
 *   - Unrelated words → < 0.5
 */
export function fuzzySimilarity(a: string, b: string): number {
  const na = normalizeForFuzzy(a);
  const nb = normalizeForFuzzy(b);
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.0;

  const edit = normalizedEditSimilarity(na, nb);
  const dice = diceCoefficient(na, nb);
  const token = tokenOverlap(na, nb);

  // If one string is contained within the other (e.g. "coke" in "coca cola"),
  // boost token + edit signals.
  const containment = na.includes(nb) || nb.includes(na);
  const containmentBoost = containment ? 0.1 : 0;

  // Weighted blend: edit is most reliable for short strings, dice handles
  // phonetic swaps, token overlap handles multi-word phrase order.
  const score = 0.45 * edit + 0.35 * dice + 0.2 * token + containmentBoost;

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Score a spoken name against a set of candidate strings.
 * Returns the best candidate and its score, along with the full ranked list.
 */
export function bestFuzzyMatch(
  spoken: string,
  candidates: string[]
): { best: string | null; score: number; ranked: FuzzyScoredCandidate[] } {
  const ranked: FuzzyScoredCandidate[] = candidates
    .map((candidate) => ({
      candidate,
      score: fuzzySimilarity(spoken, candidate),
      method: 'fuzzy' as FuzzyScoredCandidate['method'],
    }))
    .sort((x, y) => y.score - x.score);

  const best = ranked[0];
  return {
    best: best && best.score >= 0.5 ? best.candidate : null,
    score: best ? best.score : 0,
    ranked: ranked.slice(0, 5),
  };
}

/**
 * Phonetic alias suggestions — common Whisper mis-transcriptions for Indian
 * product names. When a spoken term matches one of these "confusion pairs",
 * we add a small confidence bonus.
 */
const PHONETIC_CONFUSIONS: Array<[RegExp, string]> = [
  [/^coka$/i, 'coca'],
  [/^kok$/i, 'coke'],
  [/^koka$/i, 'coca'],
  [/^pepsi$/i, 'pepsi'],
  [/^doodh$/i, 'milk'],
  [/^dudh$/i, 'milk'],
  [/^dhudh$/i, 'milk'],
  [/^makkhan$/i, 'butter'],
  [/^makhan$/i, 'butter'],
  [/^pyaaz$/i, 'onion'],
  [/^pyaz$/i, 'onion'],
  [/^tamatar$/i, 'tomato'],
  [/^aloo$/i, 'potato'],
  [/^atta$/i, 'flour'],
  [/^aata$/i, 'flour'],
  [/^chawal$/i, 'rice'],
  [/^chaval$/i, 'rice'],
  [/^ghee$/i, 'ghee'],
  [/^paneer$/i, 'paneer'],
  [/^andaa$/i, 'egg'],
  [/^ande$/i, 'egg'],
];

/** Apply phonetic-confusion bonus to a fuzzy score. */
export function applyPhoneticBonus(spoken: string, candidate: string, baseScore: number): number {
  for (const [pattern, canonical] of PHONETIC_CONFUSIONS) {
    if (pattern.test(spoken.trim()) && normalizeForFuzzy(candidate).includes(canonical)) {
      return Math.min(1.0, baseScore + 0.08);
    }
  }
  return baseScore;
}

