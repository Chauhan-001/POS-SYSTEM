/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationExplanation.test.ts — PHASE 7 acceptance.
 * The load-bearing assertions: fabricated numbers are stripped, LLM failure
 * degrades to a usable deterministic explanation, malformed output is
 * rejected, and the schema cannot carry chain-of-thought.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../shared/llmClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/llmClient')>();
  return {
    ...actual,
    generateJsonWithMeta: vi.fn(),
  };
});

import { generateJsonWithMeta, LlmError, type LlmJsonResult } from '../../shared/llmClient';
import {
  buildExplanationFacts,
  deterministicExplanation,
  explainRecommendation,
  explanationSchema,
  stripUngroundedNumbers,
  type ExplanationFacts,
} from '../recommendationExplanation';
import type { RankingResult } from '../recommendationRanking';

const mockedGenerate = vi.mocked(generateJsonWithMeta);

const facts: ExplanationFacts = {
  restaurantName: 'Urban Tadka',
  currency: '₹',
  recommendations: [
    {
      rank: 1,
      title: 'Lunch combo',
      strategyLabel: 'product combo',
      description: 'Pair two high-demand dishes',
      action: 'create_combo',
      engineScore: 88,
      confidencePct: 75,
      discountPct: 10,
      marginPct: 55,
      incrementalRevenue: 12000,
      breakEvenUnits: 5,
      paybackDays: 3,
      economicallySafe: true,
      risks: ['Stock risk'],
      prerequisites: ['Prep capacity'],
      signalCodes: ['basket_pair_strength'],
      mlKinds: ['basket'],
      memoryStatements: ['Combos worked on weekends.'],
      evidenceDescriptions: ['pair observed 25 times'],
    },
    {
      rank: 2,
      title: 'Win-back',
      strategyLabel: 'win-back campaign',
      description: 'Reach inactive customers',
      action: 'create_campaign',
      engineScore: 80,
      confidencePct: 70,
      discountPct: 15,
      marginPct: 50,
      incrementalRevenue: 9000,
      breakEvenUnits: 4,
      paybackDays: 5,
      economicallySafe: true,
      risks: [],
      prerequisites: [],
      signalCodes: ['customer_inactive_high'],
      mlKinds: ['segment'],
      memoryStatements: [],
      evidenceDescriptions: [],
    },
  ],
  unusedSignals: ['weather_shift'],
  mlDegradations: ['uplift evidence is not usable yet: experiment too small'],
  droppedStrategies: [],
};

describe('1. number grounding', () => {
  it('strips numbers that were not supplied as facts', () => {
    const allowed = new Set(['10', '55', '88']);
    const { text, stripped } = stripUngroundedNumbers('Discount of 10% drives 45% growth and 88 points', allowed);
    expect(text).toContain('10%');
    expect(text).toContain('88');
    expect(text).not.toContain('45');
    expect(stripped).toContain('45');
  });

  it('removes the dangling unit an invented number leaves behind', () => {
    const allowed = new Set(['20']);
    const { text } = stripUngroundedNumbers('Daily revenue is 35% below baseline, offer 20% off.', allowed);
    expect(text).not.toContain('35');
    expect(text).not.toMatch(/\s%/); // no orphaned percent sign
    expect(text).toContain('20%');
    expect(text).toContain('below baseline');
  });

  it('keeps the sentence readable when an invented count is removed', () => {
    const allowed = new Set<string>();
    const { text } = stripUngroundedNumbers('It reached 120 customers last week.', allowed);
    expect(text).not.toContain('120');
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).toContain('last week');
  });

  it('accepts rounded forms of supplied numbers', () => {
    const allowed = new Set(['12000', '12000.4']);
    const r = stripUngroundedNumbers('Extra revenue of 12000', allowed);
    expect(r.text).toContain('12000');
    expect(r.stripped).toEqual([]);
  });

  it('the deterministic explanation states only supplied numbers', () => {
    const rec = facts.recommendations[0];
    const out = deterministicExplanation(facts, rec);
    const text = [out.recommendation, out.whyItFits, out.offerDescription, out.campaignCopy, ...out.evidenceSummary].join(' ');
    expect(text).toContain('10%'); // discount from facts
    expect(text).toContain('55%'); // margin from facts
    // Nothing invented: every number in the text exists among the facts
    // (25 comes from the supplied evidence description "pair observed 25 times").
    const allowed = new Set(['1', '10', '55', '5', '3', '12000', '25']);
    const { stripped } = stripUngroundedNumbers(text, allowed);
    expect(stripped).toEqual([]);
  });
});

describe('2. deterministic fallback', () => {
  it('produces a usable explanation without the LLM', async () => {
    const result = await explainRecommendation({ facts, disableLlm: true });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('llm_disabled');
    expect(result.explanation.recommendation.length).toBeGreaterThan(5);
    expect(result.explanation.offerDescription).toContain('₹');
    const parsed = explanationSchema.safeParse(result.explanation);
    expect(parsed.success).toBe(true);
  });

  it('states missing evidence honestly', () => {
    const bare = {
      ...facts,
      recommendations: [
        {
          ...facts.recommendations[0],
          signalCodes: [],
          mlKinds: [],
          memoryStatements: [],
          evidenceDescriptions: [],
        },
      ],
    };
    const out = deterministicExplanation(bare, bare.recommendations[0]);
    expect(out.evidenceSummary.join(' ')).toContain('No supporting evidence is available');
  });

  it('flags unsafe economics instead of hiding them', () => {
    const unsafe = {
      ...facts,
      recommendations: [{ ...facts.recommendations[0], economicallySafe: false }],
    };
    const out = deterministicExplanation(unsafe, unsafe.recommendations[0]);
    expect(out.whyItFits).toContain('Careful');
    expect(out.whyItFits).toContain('does NOT meet');
  });
});

describe('3. LLM path with grounding and validation', () => {
  beforeEach(() => {
    mockedGenerate.mockReset();
  });
  afterEach(() => {
    mockedGenerate.mockReset();
  });

  const llmOk = (value: unknown): LlmJsonResult<unknown> => ({
    value,
    model: 'fake-model',
    provider: 'fake',
    latencyMs: 12,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  });

  it('accepts a valid, grounded explanation', async () => {
    mockedGenerate.mockResolvedValue(
      llmOk({
        recommendation: 'Run a lunch combo at a 10% discount.',
        evidenceSummary: ['Basket pair evidence supports it.'],
        whyItFits: 'It keeps a 55% projected margin.',
        whyAlternatives: 'The win-back campaign ranked lower.',
        offerDescription: 'Two-dish lunch combo at 10% off.',
        campaignCopy: 'Lunch combo today!',
      }),
    );
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('llm');
    expect(result.model).toBe('fake-model');
    expect(result.explanation.recommendation).toContain('10%');
  });

  it('strips fabricated numbers from otherwise valid output', async () => {
    mockedGenerate.mockResolvedValue(
      llmOk({
        recommendation: 'Run a lunch combo at a 10% discount to gain 45% traffic.',
        evidenceSummary: ['Expected 99 new customers.'],
        whyItFits: 'It keeps a 55% projected margin.',
        whyAlternatives: 'Other options were weaker.',
        offerDescription: 'Combo at 10% off.',
        campaignCopy: 'Try it!',
      }),
    );
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('llm');
    const text = [result.explanation.recommendation, result.explanation.whyItFits, ...result.explanation.evidenceSummary].join(' ');
    expect(text).not.toContain('45');
    expect(text).not.toContain('99');
    expect(text).toContain('10%');
  });

  it('rejects malformed output and falls back', async () => {
    mockedGenerate.mockResolvedValue(llmOk({ recommendation: 'ok' })); // missing fields
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('invalid_schema');
  });

  it('rejects extra fields (no smuggled chain-of-thought)', async () => {
    mockedGenerate.mockResolvedValue(
      llmOk({
        recommendation: 'Run a combo.',
        evidenceSummary: [],
        whyItFits: 'Fits.',
        whyAlternatives: 'None.',
        offerDescription: 'Offer.',
        campaignCopy: 'Copy.',
        chainOfThought: 'my private reasoning',
      }),
    );
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('invalid_schema');
    expect(JSON.stringify(result.explanation)).not.toContain('private reasoning');
  });

  it('degrades on LLM timeout / provider errors', async () => {
    mockedGenerate.mockRejectedValue(new LlmError('timed out', 'timeout'));
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('llm_timeout');
  });

  it('degrades when the LLM is not configured', async () => {
    mockedGenerate.mockRejectedValue(new LlmError('LLM not configured (AI_API_KEY unset)', 'not_configured'));
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('llm_not_configured');
  });

  it('falls back when grounding removes the substance (invented text)', async () => {
    mockedGenerate.mockResolvedValue(
      llmOk({
        recommendation: '123',
        evidenceSummary: [],
        whyItFits: '456',
        whyAlternatives: '789',
        offerDescription: '1011',
        campaignCopy: '1213',
      }),
    );
    const result = await explainRecommendation({ facts });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('ungrounded_output');
  });

  it('handles a missing target rank gracefully', async () => {
    const result = await explainRecommendation({ facts, rank: 9 });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toBe('no_recommendation');
  });
});

describe('4. facts building from ranking', () => {
  it('maps ranked recommendations into grounded facts', () => {
    const ranking: RankingResult = {
      recommendations: [
        {
          rank: 1,
          id: 'c1',
          type: 'CREATE_COMBO',
          strategy: 'CREATE_COMBO',
          strategyLabel: 'product combo',
          title: 'Combo',
          description: 'Pair two dishes',
          recommendedAction: 'create_combo',
          engineScore: 88,
          rankScore: 95,
          confidence: 0.75,
          priority: 'high',
          economics: {
            discountPercent: 10,
            projectedContributionMargin: 55,
            incrementalRevenue: 12000,
            incrementalUnits: 20,
            breakEvenIncrementalUnits: 5,
            paybackPeriodDays: 3,
            economicallySafe: true,
          },
          cannibalization: { rate: 0.1, incrementalVsCannibalized: 2 },
          target: { productIds: ['p1'], productNames: ['A'], categoryIds: [], segmentIds: [] },
          risks: ['Stock risk'],
          prerequisites: ['Prep'],
          evidence: [{ description: 'pair observed', value: 25 }],
          provenance: { sourceSignals: ['s1'], signalCodes: ['basket_pair_strength'], mlKinds: ['basket'], memoryRefs: [] },
          why: ['strong'],
        },
      ],
      strategies: ['CREATE_COMBO'],
      considered: 5,
      diversityRelaxed: false,
      notes: [],
      generatedAt: new Date().toISOString(),
    };
    const built = buildExplanationFacts({ ranking, restaurantName: 'Urban Tadka', currency: '₹', mlDegradations: ['uplift: too small'] });
    expect(built.recommendations).toHaveLength(1);
    expect(built.recommendations[0].incrementalRevenue).toBe(12000);
    expect(built.recommendations[0].breakEvenUnits).toBe(5);
    expect(built.mlDegradations).toContain('uplift: too small');
    // Infinite payback is normalized to 0 for grounding (never "Infinity").
    expect(Number.isFinite(built.recommendations[0].paybackDays)).toBe(true);
  });
});