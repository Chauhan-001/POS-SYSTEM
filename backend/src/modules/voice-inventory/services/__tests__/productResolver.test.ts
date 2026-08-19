/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — ProductResolver tests. Deterministic-first: an exact/normalized/
 * alias/SKU/fuzzy match MUST NOT trigger an LLM call. The semantic stage only
 * runs on opt-in and its product ids are validated against the candidate set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveProductMock = vi.hoisted(() => vi.fn());
const semanticMock = vi.hoisted(() => vi.fn());
vi.mock('../ProductResolutionEngine', () => ({ resolveProduct: resolveProductMock }));
vi.mock('../SemanticMatcher', () => ({ semanticMatchWithPrefilter: semanticMock }));

import { resolveFromCandidates, resolveMenuProduct } from '../ProductResolver';

const CANDIDATES = [
  { id: 'p1', name: 'Paneer Tikka', category: 'Starters', code: 'SKU-PT' },
  { id: 'p2', name: 'Paneer Chilli', category: 'Starters', code: 'SKU-PC' },
  { id: 'p3', name: 'Paneer Roll', category: 'Starters', code: 'SKU-PR', searchAliases: ['Paneer Frankie'] },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Phase 11 — deterministic candidate resolution (no LLM)', () => {
  it('resolves an exact name match', async () => {
    const r = await resolveFromCandidates('Paneer Tikka', CANDIDATES);
    expect(r.productId).toBe('p1');
    expect(r.matchedBy).toBe('EXACT');
    expect(r.decision).toBe('auto_select');
    expect(semanticMock).not.toHaveBeenCalled();
  });

  it('resolves a case/whitespace-insensitive normalized match', async () => {
    const r = await resolveFromCandidates('  paneer  tikka ', CANDIDATES);
    expect(r.productId).toBe('p1');
    expect(r.matchedBy).toBe('EXACT');
  });

  it('resolves a search alias without calling the LLM', async () => {
    const r = await resolveFromCandidates('paneer frankie', CANDIDATES);
    expect(r.productId).toBe('p3');
    expect(r.matchedBy).toBe('ALIAS');
    expect(semanticMock).not.toHaveBeenCalled();
  });

  it('resolves a SKU/code without calling the LLM', async () => {
    const r = await resolveFromCandidates('SKU-PC', CANDIDATES);
    expect(r.productId).toBe('p2');
    expect(r.matchedBy).toBe('SKU');
    expect(semanticMock).not.toHaveBeenCalled();
  });

  it('resolves a fuzzy spelling variation deterministically', async () => {
    const r = await resolveFromCandidates('paneer tikkaa', CANDIDATES);
    expect(r.productId).toBe('p1');
    expect(r.matchedBy).toBe('FUZZY');
    expect(semanticMock).not.toHaveBeenCalled();
  });

  it('returns ranked candidates instead of guessing on ambiguity', async () => {
    // "paneer" ties across all three — must be product_picker, never a silent pick.
    const r = await resolveFromCandidates('paneer', CANDIDATES);
    expect(r.decision).toBe('product_picker');
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2);
  });

  it('returns unresolved for a nonexistent product', async () => {
    const r = await resolveFromCandidates('Sushi Platter', CANDIDATES);
    expect(r.decision).toBe('unresolved');
    expect(r.productId).toBeUndefined();
  });
});

describe('Phase 11 — semantic stage (opt-in, validated)', () => {
  it('uses the LLM only when deterministic stages miss AND allowSemantic is set', async () => {
    semanticMock.mockResolvedValueOnce([{ productId: 'p2', productName: 'Paneer Chilli', confidence: 0.93, reason: 'matches' }]);
    const r = await resolveFromCandidates('spicy paneer', CANDIDATES, { allowSemantic: true });
    expect(semanticMock).toHaveBeenCalledTimes(1);
    expect(r.matchedBy).toBe('SEMANTIC');
    expect(r.productId).toBe('p2');
  });

  it('never calls the LLM when allowSemantic is false', async () => {
    await resolveFromCandidates('spicy paneer', CANDIDATES);
    expect(semanticMock).not.toHaveBeenCalled();
  });

  it('rejects a semantic productId that is not in the candidate set', async () => {
    // The LLM "invents" Sushi Platter — must be dropped.
    semanticMock.mockResolvedValueOnce([
      { productId: 'p2', productName: 'Paneer Chilli', confidence: 0.9, reason: 'matches' },
      { productId: 'invented-1', productName: 'Spicy Paneer Pizza', confidence: 0.99, reason: 'hallucinated' },
    ]);
    const r = await resolveFromCandidates('spicy paneer', CANDIDATES, { allowSemantic: true });
    expect(r.productId).toBe('p2'); // invented id never wins
    expect(r.alternatives.every((a) => CANDIDATES.some((c) => c.id === a.productId))).toBe(true);
  });

  it('returns unresolved when the semantic stage fails entirely', async () => {
    semanticMock.mockResolvedValueOnce([]);
    const r = await resolveFromCandidates('zzz unknown', CANDIDATES, { allowSemantic: true });
    expect(r.decision).toBe('unresolved');
  });

  it('never confirms a semantic pick below the confidence floor', async () => {
    // The LLM "matches" a product at confidence 0.05 — that is a guess, so the
    // resolver stays unresolved and only surfaces ranked alternatives.
    semanticMock.mockResolvedValueOnce([
      { productId: 'p1', productName: 'Paneer Tikka', confidence: 0.05, reason: 'weak' },
    ]);
    const r = await resolveFromCandidates('zzzznope', CANDIDATES, { allowSemantic: true });
    expect(r.decision).toBe('unresolved');
    expect(r.productId).toBeUndefined();
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 11 — DB path delegates to the engine with correct options', () => {
  it('maps the engine matchedStage and skips semantic for deterministic hits', async () => {
    resolveProductMock.mockResolvedValueOnce({
      spokenName: 'Paneer Tikka',
      outcome: 'EXISTING_PRODUCT',
      product: { id: 'p1', name: 'Paneer Tikka' },
      confidence: 1,
      matchedStage: 'exact_name',
      decision: 'auto_select',
      stages: [],
    });
    const r = await resolveMenuProduct('restA', 'Paneer Tikka');
    expect(r.productId).toBe('p1');
    expect(r.matchedBy).toBe('EXACT');
    // skipSemantic must be true (allowSemantic default false) + skipNewProductDetection
    expect(resolveProductMock.mock.calls[0][2].skipSemantic).toBe(true);
    expect(resolveProductMock.mock.calls[0][2].skipNewProductDetection).toBe(true);
  });

  it('enables semantic only when allowSemantic is true', async () => {
    resolveProductMock.mockResolvedValueOnce({
      spokenName: 'q', outcome: 'UNKNOWN_OR_AMBIGUOUS', confidence: 0.2, decision: 'unresolved', stages: [],
    });
    await resolveMenuProduct('restA', 'q', { allowSemantic: true });
    expect(resolveProductMock.mock.calls[0][2].skipSemantic).toBe(false);
  });
});
