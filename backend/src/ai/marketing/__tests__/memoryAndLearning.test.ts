/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryAndLearning.test.ts — Phases 14 & 15.
 *
 * The rules that matter and are easy to regress:
 *   - an analysis episode is EVIDENCE-BACKED and contains no prompt, model
 *     output or chain-of-thought;
 *   - a failed / empty analysis is still learnable (honest outcome status);
 *   - causality is claimed ONLY for a control-group measurement;
 *   - a measured outcome is learned from EXACTLY ONCE (atomic claim);
 *   - an outcome with no usable variance is counted, never guessed;
 *   - a per-item pattern is arithmetic, bounded, and upserts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  analysisEpisodeInput,
  collectEpisodeEvidence,
  recordAnalysisMemory,
  MAX_RECOMMENDATION_EVENTS,
} from '../memoryWriteback';
import {
  verdictForOutcome,
  outcomeSummary,
  productPatternReading,
  productPatternConfidence,
  linkMeasuredOutcomesToMemory,
  consolidateProductPatterns,
  MIN_PRODUCT_PATTERN_CONFIDENCE,
} from '../outcomeLearning';
import { buildSituationModel } from '../situationModel';
import { runMarketingAnalyze } from '../analyze';
import { getRecentEpisodes } from '../../memory/memoryManager';
import RecommendationOutcomeModel from '../../../models/intelligence/RecommendationOutcome';

let mongod: MongoMemoryServer;
const R1 = '507f1f77bcf86cd799439011';
const tenant = { restaurantId: R1, actorId: 'actor-1' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const EMPTY_SITUATION = buildSituationModel({ objective: 'g', investigations: [] });

const INVESTIGATION = {
  runId: 'run-1',
  status: 'completed_sufficient',
  stepsUsed: 3,
  toolCallsUsed: 3,
  llmCalls: 3,
  domainsInvestigated: ['sales'] as never,
  domainsUnavailable: [],
  domainOrder: ['sales'] as never,
  stopGuardObjections: [],
  rejections: [],
  tokensUsed: 0,
  costUsd: 0,
};

function recommendation(id = 'rec-1') {
  return {
    recommendation: { rank: 1, id, type: 'CREATE_PROMOTION', title: 'Promote X', confidence: 0.7 },
    validation: { candidateId: id, passed: true, rejectionCodes: [], checks: [] },
    critic: {
      candidateId: id,
      verdict: 'PASS' as const,
      reasons: [],
      confidenceDelta: 0,
      source: 'llm' as const,
      strippedClaims: [],
    },
  } as unknown as import('../contracts').AnalyzedRecommendation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 14 — the episode payload
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 14 — analysis episode payload', () => {
  it('records an evidence-backed episode with no prompt, model output or reasoning', () => {
    const situation = buildSituationModel({
      objective: 'g',
      investigations: [
        {
          domain: 'products',
          status: 'ok',
          question: 'q',
          findings: [
            {
              code: 'product_slow_moving',
              domain: 'products',
              statement: 'Paneer Tikka is moving slowly',
              confidence: 0.8,
              evidenceRefs: ['signal:sig-1'],
            },
          ],
          signals: [],
          evidenceRefs: [],
          implemented: true,
          durationMs: 1,
          generatedAt: new Date().toISOString(),
        },
      ],
    });
    const payload = analysisEpisodeInput({
      tenant,
      runId: 'run-1',
      objective: 'Find the best action',
      status: 'completed',
      situation,
      investigation: INVESTIGATION as never,
      recommendations: [recommendation()],
      directionPolicyApplied: true,
      rejectedCount: 2,
      degradations: [],
    }) as Record<string, unknown>;

    // Evidence-backed, not narrative.
    expect((payload.evidence as unknown[]).length).toBeGreaterThan(0);
    expect(payload.source).toBe('service');
    expect(payload.runId).toBe('run-1');

    // NO chain-of-thought / prompt surface may exist.
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ['chainofthought', 'chain_of_thought', 'reasoning', 'thinking', 'prompt', 'scratchpad']) {
      expect(serialized).not.toContain(forbidden);
    }

    // Recommendation issued but not yet measured → pending.
    expect((payload.outcome as { status: string }).status).toBe('pending');
    expect((payload.outcome as { metrics: Record<string, number> }).metrics.recommendations).toBe(1);
    expect((payload.outcome as { metrics: Record<string, number> }).metrics.rejected).toBe(2);
  });

  it('keeps a failed or empty analysis learnable, with an honest outcome status', () => {
    const failed = analysisEpisodeInput({
      tenant,
      runId: 'run-2',
      objective: 'o',
      status: 'failed',
      situation: EMPTY_SITUATION,
      investigation: INVESTIGATION as never,
      recommendations: [],
      directionPolicyApplied: false,
      rejectedCount: 0,
      degradations: ['nothing could be investigated'],
    }) as { outcome: { status: string } };
    expect(failed.outcome.status).toBe('failure');

    const thin = analysisEpisodeInput({
      tenant,
      runId: 'run-3',
      objective: 'o',
      status: 'completed_degraded',
      situation: EMPTY_SITUATION,
      investigation: INVESTIGATION as never,
      recommendations: [],
      directionPolicyApplied: false,
      rejectedCount: 0,
      degradations: [],
    }) as { outcome: { status: string } };
    // No evidence and no recommendation → partial, never "success".
    expect(thin.outcome.status).toBe('partial');
  });

  it('deduplicates and bounds the evidence references', () => {
    const situation = buildSituationModel({ objective: 'g', investigations: [] });
    const facts = Array.from({ length: 30 }, (_, i) => ({
      statement: `fact ${i}`,
      domain: 'sales' as const,
      confidence: 0.5,
      evidenceRefs: [`signal:s${i}`],
    }));
    const deduped = collectEpisodeEvidence({ ...situation, opportunities: [...facts, ...facts] });
    expect(deduped.length).toBeLessThanOrEqual(20);
    expect(new Set(deduped.map((e) => e.ref)).size).toBe(deduped.length);
  });

  it('writes the episode and its recommendation events, and stores no reasoning', async () => {
    const situation = buildSituationModel({
      objective: 'g',
      investigations: [
        {
          domain: 'sales',
          status: 'ok',
          question: 'q',
          findings: [
            { code: 'sales_category_weak', domain: 'sales', statement: 'Desserts are weak', confidence: 0.8, evidenceRefs: ['signal:s1'] },
          ],
          signals: [],
          evidenceRefs: [],
          implemented: true,
          durationMs: 1,
          generatedAt: new Date().toISOString(),
        },
      ],
    });
    const result = await recordAnalysisMemory({
      tenant,
      runId: 'run-write-1',
      objective: 'objective text',
      status: 'completed',
      situation,
      investigation: INVESTIGATION as never,
      recommendations: [recommendation('rec-w1'), recommendation('rec-w2')],
      directionPolicyApplied: true,
      rejectedCount: 0,
      degradations: [],
    });
    expect(result.episodeWritten).toBe(true);
    expect(result.episodeId).toBeTruthy();
    expect(result.recommendationsRecorded).toBe(2);

    // Read the stored episode back: evidence present, no reasoning surface.
    const episodes = await getRecentEpisodes(tenant, { episodeTypes: ['agent_run'], limit: 5 });
    const stored = episodes.find((e) => e.id === result.episodeId);
    expect(stored).toBeDefined();
    expect(stored?.evidence.length).toBeGreaterThan(0);
    expect(stored?.runId).toBe('run-write-1');
    const serialized = JSON.stringify(stored).toLowerCase();
    for (const forbidden of ['chainofthought', 'chain_of_thought', 'scratchpad']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(MAX_RECOMMENDATION_EVENTS).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 15 — outcome → memory
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 15 — outcome verdicts and causality', () => {
  it('treats only a control-group measurement as causal', () => {
    const gated = verdictForOutcome({ attributionMethod: 'control_vs_test', variance: { contributionDiff: 120 } });
    expect(gated?.gated).toBe(true);
    expect(gated?.positive).toBe(true);

    const correlated = verdictForOutcome({ attributionMethod: 'pre_post', variance: { contributionDiff: 120 } });
    expect(correlated?.gated).toBe(false);
    expect(correlated?.positive).toBe(true);
  });

  it('returns null when no usable variance exists — never guesses', () => {
    expect(verdictForOutcome({ attributionMethod: 'pre_post', variance: {} })).toBeNull();
    expect(verdictForOutcome({ attributionMethod: 'pre_post', variance: null })).toBeNull();
  });

  it('labels a non-gated result as an association, not incrementality', () => {
    const text = outcomeSummary({
      promotionType: 'percentage',
      attributionMethod: 'pre_post',
      status: 'measured',
      variance: { contributionDiff: -50 },
    });
    expect(text).toContain('NOT a controlled experiment');
    expect(text).not.toContain('incremental effect');
    const gated = outcomeSummary({
      promotionType: 'percentage',
      attributionMethod: 'control_vs_test',
      status: 'completed',
      variance: { contributionDiff: 50 },
    });
    expect(gated).toContain('incremental effect');
  });
});

describe('Phase 15 — measured outcomes are learned from exactly once', () => {
  it('links a control-group outcome, then does not link it again', async () => {
    // `new Model().save()` (rather than `create()`) so the schema defaults —
    // notably `variance` → 0 — are applied exactly as they are in production.
    await new RecommendationOutcomeModel({
      recommendationId: 'rec-outcome-1',
      restaurantId: R1,
      promotedAt: new Date(),
      measurementWindowDays: 30,
      implemented: true,
      status: 'completed',
      metrics: { orders: 120, revenue: 45000, contribution: 9000 },
      baseline: {
        method: 'control_vs_test',
        comparisonPeriodStart: new Date(Date.now() - 60 * 86400000),
        comparisonPeriodEnd: new Date(Date.now() - 30 * 86400000),
        baselineValue: 40000,
        documentedAssumptions: ['same branch mix'],
      },
      variance: { contributionDiff: 800, orderUpliftPercentDiff: 6, newCustomerDiff: 0, repeatPurchaseDiff: 0, aovDiff: 0 },
      attributionMethod: 'control_vs_test',
      promotionType: 'percentage',
      learningSignals: [],
    }).save();

    const first = await linkMeasuredOutcomesToMemory(tenant);
    expect(first.scanned).toBe(1);
    expect(first.linked).toBe(1);
    expect(first.positive).toBe(1);
    expect(first.causal).toBe(1);

    // Idempotent: the row was claimed, so it is never learned from twice.
    const second = await linkMeasuredOutcomesToMemory(tenant);
    expect(second.scanned).toBe(0);
    expect(second.linked).toBe(0);
  });

  it('counts an outcome with no usable variance instead of inventing one', async () => {
    await new RecommendationOutcomeModel({
      recommendationId: 'rec-outcome-2',
      restaurantId: R1,
      promotedAt: new Date(),
      measurementWindowDays: 30,
      implemented: true,
      status: 'measured',
      metrics: { orders: 10 },
      baseline: {
        method: 'time_series',
        comparisonPeriodStart: new Date(Date.now() - 60 * 86400000),
        comparisonPeriodEnd: new Date(Date.now() - 30 * 86400000),
        baselineValue: 100,
        documentedAssumptions: [],
      },
      // No variance fields at all.
      attributionMethod: 'time_series',
      promotionType: 'combo',
      learningSignals: [],
    }).save();

    const res = await linkMeasuredOutcomesToMemory(tenant);
    // The schema DEFAULTS variance to 0, so this row looks like a measured zero
    // delta. A zero carries no directional evidence, so it must not become a
    // "positive" learning signal — it is counted and left unclaimed.
    expect(res.unusable).toBe(1);
    expect(res.linked).toBe(0);
    expect(res.positive).toBe(0);
    expect(res.negative).toBe(0);
  });

  it('never throws and reports why when the read fails', async () => {
    const res = await linkMeasuredOutcomesToMemory({ restaurantId: 'not-an-object-id' });
    expect(res.linked).toBe(0);
    expect(res.reasons.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 15 — product patterns
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 15 — product-level patterns', () => {
  it('reads demand/margin from percentiles with an explicit middle band', () => {
    expect(productPatternReading({ popularityPercentile: 80, marginPercentile: 20 })).toEqual({ demand: 'high', margin: 'weak' });
    expect(productPatternReading({ popularityPercentile: 50, marginPercentile: 50 })).toEqual({ demand: 'middle', margin: 'middle' });
    expect(productPatternReading({ popularityPercentile: 10, marginPercentile: 90 })).toEqual({ demand: 'low', margin: 'strong' });
  });

  it('keeps confidence floored and bounded', () => {
    expect(productPatternConfidence(0)).toBe(MIN_PRODUCT_PATTERN_CONFIDENCE);
    expect(productPatternConfidence(1_000)).toBeLessThanOrEqual(0.9);
    expect(productPatternConfidence(1_000)).toBeGreaterThan(MIN_PRODUCT_PATTERN_CONFIDENCE);
  });

  it('reports honestly (no patterns) when an item has no trading history', async () => {
    const res = await consolidateProductPatterns(tenant, { force: true });
    expect(res.written).toBe(0);
    expect(res.reasons.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring: a real analyze run learns and is learnable
// ─────────────────────────────────────────────────────────────────────────────

describe('analyze run wires Phase 14 + 15', () => {
  it('discloses the memory write and the learning it absorbed', async () => {
    const result = await runMarketingAnalyze({ tenant, disableLlm: true, requestId: 'test-learn-1' });

    expect(result.memoryWrite.attempted).toBe(true);
    expect(result.memoryWrite.episodeWritten).toBe(true);
    expect(result.memoryWrite.episodeId).toBeTruthy();

    expect(result.outcomeLearning).toBeDefined();
    expect(typeof result.outcomeLearning.outcomesLinked).toBe('number');
    expect(typeof result.outcomeLearning.productPatternsSkippedFresh).toBe('boolean');

    // Feedback-trend learning is absent by design and must say so.
    expect(result.degradations.join(' ')).toContain('feedback-trend learning is not implemented');
  }, 60_000);
});
