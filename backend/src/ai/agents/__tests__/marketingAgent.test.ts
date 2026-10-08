/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgent.test.ts — acceptance for System #2, the AGENTIC INSIGHT agent.
 *
 * The deterministic targeting ladder is REMOVED. What must hold instead:
 *   E. the result is a structured insight card (never a targeting result);
 *   F. every insight carries the exact evidence sources that actually ran;
 *   G. unsupported numbers / unknown evidence refs are rejected server-side;
 *   M. an LLM failure produces an explicitly DEGRADED insight and never
 *      revives the removed deterministic engine;
 *   O. tenant isolation is preserved.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import {
  runMarketingAgent,
  evidenceFromToolData,
  marketingEvidenceStopGuard,
  marketingEvidenceSufficiencyGuard,
  classifyMarketingTask,
  MAX_BROAD_STOP_DEFERRALS,
} from '../marketingAgent';
import { LlmError, type LlmJsonRequest } from '../../shared/llmClient';
import { isUsableToolData, type LoopLlmFn } from '../loop/agentLoop';
import Offer from '../../../models/marketing/Offer';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Offer.deleteMany({ restaurantId: { $in: [R1, R2] } });
});

/** Scripted planning LLM (mirrors the shared loop contract). */
function scriptedLlm(toolNames: string[], needMoreEvidence = false): LoopLlmFn {
  return (async () => ({
    value: {
      plan: ['investigate'],
      toolCalls: toolNames.map((name) => ({ name, args: {} })),
      needMoreEvidence,
      reason: 'scripted',
    },
    model: 'fake-model',
    provider: 'fake',
    latencyMs: 1,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  })) as unknown as LoopLlmFn;
}

const synthesisReturning = (value: unknown) => async () => ({
  value,
  model: 'fake-synth',
  provider: 'fake',
  latencyMs: 1,
  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
});

describe('runMarketingAgent — agentic insight contract', () => {
  it('E: returns a structured insight card (no targeting result fields)', async () => {
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        task: 'Which campaign deserves attention?',
        llm: scriptedLlm(['getActiveOffers']),
        synthesisLlm: synthesisReturning({
          title: 'Offer history is thin',
          summary: 'The offer history for this restaurant does not yet show a campaign worth reviewing.',
          priority: 'medium',
          recommendation: 'Review the offer list before planning the next campaign.',
          evidenceRefs: ['getActiveOffers'],
          confidence: 0.6,
        }),
      },
    );

    expect(result.mode).toBe('agentic_insight');
    expect(result.insights).toHaveLength(1);
    const insight = result.insights[0];
    expect(insight.type).toBe('agentic_insight');
    expect(insight.id).toMatch(/^insight_/);
    expect(insight.title).toBeTruthy();
    expect(insight.summary).toBeTruthy();
    expect(insight.priority).toBe('medium');
    expect(insight.recommendation).toContain('offer list');
    expect(insight.confidence).toBeCloseTo(0.6);
    expect(insight.degraded).toBe(false);
    // The removed deterministic contract must not reappear.
    for (const gone of ['targetingSource', 'targets', 'offerDraft', 'nextActions', 'targetingScope']) {
      expect(insight as unknown as Record<string, unknown>).not.toHaveProperty(gone);
    }
    // Investigation trace is concise metadata — no hidden reasoning.
    expect(insight.steps[0]).toMatchObject({ tool: 'getActiveOffers', ok: true });
    expect(typeof insight.steps[0].purpose).toBe('string');
    expect(JSON.stringify(insight)).not.toMatch(/chain.?of.?thought|reasoning/i);
  });

  it('F: evidence refs are exactly the tools that ran', async () => {
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        // Narrow question: one step is sufficient, so the recorded run and the
        // insight describe exactly the same tool calls.
        task: 'How did my offers perform?',
        llm: scriptedLlm(['getActiveOffers', 'getSalesTrends']),
        synthesisLlm: synthesisReturning({
          title: 'Sales context',
          summary: 'Recent sales and offer history were reviewed for this restaurant.',
          priority: 'low',
          recommendation: 'Keep monitoring weekly sales.',
          evidenceRefs: ['getActiveOffers', 'getSalesTrends'],
          confidence: 0.5,
        }),
      },
    );
    const insight = result.insights[0];
    expect([...insight.toolsUsed].sort()).toEqual(['getActiveOffers', 'getSalesTrends']);
    expect(insight.evidence.map((e) => e.ref).sort()).toEqual(['getActiveOffers', 'getSalesTrends']);
    expect(insight.evidence.every((e) => e.label.length > 0)).toBe(true);
    expect(result.investigation.toolNames).toEqual(insight.toolsUsed);
  });

  it('G: unsupported numbers are stripped and unknown refs are repaired', async () => {
    await Offer.create({ restaurantId: R1, title: 'Live offer', description: '10% off', type: 'percentage', value: 10, status: 'active' } as any);

    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        llm: scriptedLlm(['getActiveOffers']),
        synthesisLlm: synthesisReturning({
          title: 'Revenue grew 99999% this week',
          summary: 'Sales are up 88888% and margin is 77% — act now.',
          priority: 'high',
          recommendation: 'Discount everything by 42%.',
          // getSalesTrends never ran in this investigation.
          evidenceRefs: ['getSalesTrends'],
          confidence: 0.9,
        }),
      },
    );

    const insight = result.insights[0];
    const narrative = JSON.stringify({ t: insight.title, s: insight.summary, r: insight.recommendation });
    expect(narrative).not.toContain('99999');
    expect(narrative).not.toContain('88888');
    expect(narrative).not.toContain('42');
    // The unexecuted ref cannot be cited: it is repaired to the tools that ran.
    expect(insight.evidence.every((e) => insight.toolsUsed.includes(e.ref))).toBe(true);
    expect(insight.evidence.map((e) => e.ref)).toEqual(['getActiveOffers']);
    expect(insight.degradedReason ?? '').toMatch(/evidenceRefs:repaired/);
  });

  it('M: an LLM failure is an explicit DEGRADED insight — never the removed engine', async () => {
    const failing: LoopLlmFn = async () => {
      throw new LlmError('LLM request timed out', 'timeout');
    };
    const result = await runMarketingAgent({ tenant: tenantR1 }, { llm: failing });

    expect(result.mode).toBe('agentic_insight');
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('llm_failed');
    const insight = result.insights[0];
    expect(insight.degraded).toBe(true);
    expect(insight.toolsUsed).toEqual([]);
    expect(insight.confidence).toBe(0);
    expect(insight.recommendation).toBeNull();
    expect(result.investigation.status).toBe('failed');
    expect(result.investigation.degraded).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/CAUSAL_UPLIFT|RESPONSE_MODEL|ML_SEGMENTS/);
    expect(serialized).not.toMatch(/targetingSource/);
  });

  it('M: a synthesis failure keeps real evidence and degrades honestly', async () => {
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        llm: scriptedLlm(['getActiveOffers']),
        synthesisLlm: async () => {
          throw new LlmError('provider 500', 'http_error', 500);
        },
      },
    );
    const insight = result.insights[0];
    expect(result.degraded).toBe(true);
    expect(insight.degraded).toBe(true);
    // Stable machine code — never the provider's own 'synthesis_http_error:500'.
    expect(insight.reasonCode).toBe('LLM_HTTP_ERROR');
    expect(insight.degradedReason).toBe('LLM_HTTP_ERROR');
    expect(result.reasonCode).toBe('LLM_HTTP_ERROR');
    expect(insight.summaryStatus).toBe('unavailable');
    expect(result.investigation.summaryStatus).toBe('unavailable');
    expect(result.investigation.reasonCode).toBe('LLM_HTTP_ERROR');
    // Evidence that really ran is still reported; nothing is invented.
    expect(insight.toolsUsed).toEqual(['getActiveOffers']);
    expect(insight.evidence.map((e) => e.ref)).toEqual(['getActiveOffers']);
    expect(insight.recommendation).toBeNull();
    // Owner-facing copy only — no provider status codes anywhere in the prose.
    expect(insight.title).toMatch(/temporarily unavailable/i);
    expect(insight.summary).toMatch(/no information was invented/i);
    const prose = JSON.stringify({ t: insight.title, s: insight.summary, r: insight.recommendation });
    expect(prose).not.toMatch(/429|500|rate_limited|http_error|synthesis_/i);
  });

  it('M: disableLlm skips the loop entirely with an explicit reason', async () => {
    const result = await runMarketingAgent({ tenant: tenantR1 }, { disableLlm: true });
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('llm_disabled');
    expect(result.insights[0].degradedReason).toBe('llm_disabled');
    expect(result.investigation.toolCallsUsed).toBe(0);
    expect(result.investigation.llmCalls).toBe(0);
  });

  it('O: tenant isolation — R2 never sees R1 offer evidence', async () => {
    await Offer.create({ restaurantId: R1, title: 'R1 only offer', description: 'x', type: 'percentage', value: 10, status: 'active' } as any);
    const seen: string[] = [];
    const capturing: LoopLlmFn = (async () => ({
      value: { toolCalls: [{ name: 'getActiveOffers', args: {} }], needMoreEvidence: false },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    })) as unknown as LoopLlmFn;

    const r2 = await runMarketingAgent(
      { tenant: tenantR2 },
      {
        llm: capturing,
        synthesisLlm: synthesisReturning({
          title: 'No offers yet',
          summary: 'This restaurant has no active offers to review.',
          priority: 'normal',
          recommendation: 'Create an offer when ready.',
          evidenceRefs: ['getActiveOffers'],
          confidence: 0.4,
        }),
      },
    );
    // The tool ran under R2's tenant scope: R1's offer must never appear.
    const serialized = JSON.stringify(r2);
    expect(serialized).not.toContain('R1 only offer');
    expect(r2.investigation.runId).toBeTruthy();
    seen.push(r2.investigation.runId);
    expect(seen).toHaveLength(1);
  });
});

describe('marketingEvidenceSufficiencyGuard (broad vs narrow evidence depth)', () => {
  const oneSource = {
    toolCalls: [{ tool: 'getSalesTrends', ok: true }],
    toolData: [{ step: 1, tool: 'getSalesTrends', ok: true, data: { available: true } }],
    uncertainties: [],
  } as never;
  const twoSources = {
    toolCalls: [{ tool: 'getSalesTrends', ok: true }, { tool: 'getMenuPerformance', ok: true }],
    toolData: [
      { step: 1, tool: 'getSalesTrends', ok: true, data: { available: true } },
      { step: 2, tool: 'getMenuPerformance', ok: true, data: { available: true } },
    ],
    observations: [],
    uncertainties: [],
  } as never;
  /** Two sources from DIFFERENT areas that both executed fine but had no data. */
  const twoEmptySources = {
    toolCalls: [
      { tool: 'getSalesTrends', ok: true },
      { tool: 'getMenuPerformance', ok: true },
    ],
    toolData: [
      { step: 1, tool: 'getSalesTrends', ok: true, data: { available: false, reason: 'NO_SALES_DATA' } },
      { step: 2, tool: 'getMenuPerformance', ok: true, data: { available: false, reason: 'NO_MENU_PERFORMANCE_DATA' } },
    ],
    observations: [],
    uncertainties: [],
  } as never;

  const deferral = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ step: i + 1, reason: 'stop_deferred: broad question' }));

  it('classifies whole-restaurant questions as broad and single-area questions as narrow', () => {
    expect(classifyMarketingTask('Find the most important marketing opportunity for this restaurant.')).toBe('broad');
    expect(classifyMarketingTask('Analyze my restaurant and find the most important marketing opportunity.')).toBe('broad');
    expect(classifyMarketingTask('What marketing issue should I pay attention to this week?')).toBe('broad');
    expect(classifyMarketingTask(undefined)).toBe('broad');
    expect(classifyMarketingTask('How did my offers perform?')).toBe('narrow');
    expect(classifyMarketingTask('How did my offers perform this month?')).toBe('narrow');
    expect(classifyMarketingTask('Which campaign deserves attention?')).toBe('narrow');
    // Two areas at once is a cross-area comparison, not a single-area question.
    expect(classifyMarketingTask('Compare my offers and my menu performance.')).toBe('broad');
  });

  const broadGuard = () =>
    marketingEvidenceSufficiencyGuard('Find the most important marketing opportunity for this restaurant.');

  it('defers a broad-question stop while every usable source reads ONE area, and accepts cross-area evidence', () => {
    const guard = broadGuard();
    expect(guard(oneSource)).toMatch(/broad question/i);
    expect(guard(oneSource)).toMatch(/SAME area/i);
    // The objection names the areas that are still unread (prompt-only guidance).
    expect(guard(oneSource)).toMatch(/areas you have NOT read yet/i);
    // A deferral is not a free pass: the objection keeps coming back until the
    // model actually broadens the evidence or the bound is reached.
    expect(guard({ ...(oneSource as object), uncertainties: deferral(1) } as never)).toMatch(/SAME area/i);
    // Two complementary sources from DIFFERENT areas are enough.
    expect(guard(twoSources)).toBeNull();
    // Bounded: after MAX_BROAD_STOP_DEFERRALS the stop is accepted as-is.
    expect(guard({ ...(oneSource as object), uncertainties: deferral(MAX_BROAD_STOP_DEFERRALS) } as never)).toBeNull();
  });

  it('an EMPTY source is not evidence — "not enough data" is deferred while other areas are unread', () => {
    const guard = broadGuard();
    // Both sources executed perfectly and reported nothing: this is exactly the
    // case that used to be reported to the owner as "not enough data".
    expect(guard(twoEmptySources)).toMatch(/no usable data/i);
    expect(guard(twoEmptySources)).toMatch(/does NOT mean the others are empty/i);
    expect(guard(twoEmptySources)).toMatch(/areas you have NOT read yet/i);
    // Even once one empty source has been read and a different area added, an
    // all-empty evidence set stays insufficient.
    const offersEmpty = {
      toolCalls: [
        { tool: 'getSalesTrends', ok: true },
        { tool: 'getMenuPerformance', ok: true },
        { tool: 'getOfferPerformance', ok: true },
      ],
      toolData: [
        { step: 1, tool: 'getSalesTrends', ok: true, data: { available: false, reason: 'NO_SALES_DATA' } },
        { step: 2, tool: 'getMenuPerformance', ok: true, data: { available: false, reason: 'NO_MENU_PERFORMANCE_DATA' } },
        { step: 3, tool: 'getOfferPerformance', ok: true, data: { available: false, reason: 'NO_OFFER_PERFORMANCE_DATA' } },
      ],
      observations: [],
      uncertainties: [],
    } as never;
    expect(guard(offersEmpty)).toMatch(/no usable data/i);
    // ...and a run that genuinely cannot broaden any further is still bounded.
    expect(guard({ ...(offersEmpty as object), uncertainties: deferral(MAX_BROAD_STOP_DEFERRALS) } as never)).toBeNull();
  });

  it('never forces a second source for a narrow question and still requires evidence', () => {
    const guard = marketingEvidenceSufficiencyGuard('How did my offers perform?');
    expect(guard(oneSource)).toBeNull();
    // A focused question may legitimately be answered from ONE specialized
    // source even when that source reports nothing — the empty-source rule is
    // about whole-restaurant questions.
    expect(guard(twoEmptySources)).toBeNull();
    expect(guard({ toolCalls: [], toolData: [], uncertainties: [] } as never)).toMatch(/no read-only tool/i);
  });
});

describe('marketingEvidenceStopGuard', () => {
  it('objects while no usable evidence exists and stays silent once evidence is captured', () => {
    expect(
      marketingEvidenceStopGuard({ toolCalls: [], toolData: [] } as never),
    ).toMatch(/no read-only tool has been called/i);
    expect(
      marketingEvidenceStopGuard({
        toolCalls: [{ tool: 'getActiveOffers', ok: false }],
        toolData: [],
      } as never),
    ).toMatch(/no read-only source has returned usable data/i);
    expect(
      marketingEvidenceStopGuard({
        toolCalls: [{ tool: 'getActiveOffers', ok: true }],
        toolData: [{ step: 1, tool: 'getActiveOffers', ok: true, data: { available: true } }],
      } as never),
    ).toBeNull();
  });
});

describe('isUsableToolData', () => {
  it('a successful call that reported NO data is not usable evidence', () => {
    // The shared tool contract: an empty source says "nothing to report".
    expect(isUsableToolData({ available: false, reason: 'NO_SALES_DATA' })).toBe(false);
    expect(isUsableToolData({ available: false })).toBe(false);
    expect(isUsableToolData({ available: false, reason: 'NO_OFFER_PERFORMANCE_DATA' })).toBe(false);
    expect(isUsableToolData({ available: true, reason: 'NO_CANDIDATES' })).toBe(false);
    expect(isUsableToolData({ available: true, reason: 'NO_CANDIDATES', candidates: [] })).toBe(false);
    expect(isUsableToolData(null)).toBe(false);
    expect(isUsableToolData(undefined)).toBe(false);
    // Real data, and unknown shapes, are usable (conservative by design).
    expect(isUsableToolData({ available: true, items: [1] })).toBe(true);
    expect(isUsableToolData({ totalSales: 42 })).toBe(true);
    expect(isUsableToolData('plain')).toBe(true);
  });
});

describe('evidenceFromToolData', () => {
  it('keeps the first observation per tool and collects its numbers for grounding', () => {
    const evidence = evidenceFromToolData([
      { step: 1, tool: 'getSalesTrends', ok: true, data: { available: true, orders: 42, label: 'week 3' } },
      { step: 2, tool: 'getSalesTrends', ok: true, data: { available: true, orders: 999 } },
      { step: 3, tool: 'getActiveOffers', ok: true, data: { available: false } },
    ]);
    expect(evidence.toolsUsed).toEqual(['getSalesTrends', 'getActiveOffers']);
    expect(evidence.sources.map((s) => s.ref)).toEqual(['getSalesTrends', 'getActiveOffers']);
    expect(evidence.allowedNumbers.has('42')).toBe(true);
    expect(evidence.allowedNumbers.has('3')).toBe(true);
    expect(evidence.facts).toHaveLength(2);
  });
});

describe('synthesis outcome states (TEST 4 / TEST 5 / TEST 7)', () => {
  const captureSynthesis = (requests: LlmJsonRequest[], value: unknown) =>
    async (req: LlmJsonRequest) => {
      requests.push(req);
      return {
        value,
        model: 'fake-synth',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      };
    };

  it('TEST 4 — synthesis 429 keeps the evidence, degrades structurally, and leaks no technical detail', async () => {
    const requests: LlmJsonRequest[] = [];
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        task: 'Find the most important marketing opportunity for this restaurant.',
        llm: scriptedLlm(['getSalesTrends', 'getMenuPerformance']),
        synthesisLlm: async (req) => {
          requests.push(req);
          throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
        },
      },
    );
    const insight = result.insights[0];

    // The investigation is never thrown away.
    expect([...insight.toolsUsed].sort()).toEqual(['getMenuPerformance', 'getSalesTrends']);
    expect(insight.evidence.map((e) => e.ref).sort()).toEqual(['getMenuPerformance', 'getSalesTrends']);
    expect(result.investigation.toolNames.length).toBeGreaterThan(0);

    // Structured degraded state (spec shape) — not a prose error.
    expect(result.degraded).toBe(true);
    expect(insight.summaryStatus).toBe('unavailable');
    expect(result.investigation.summaryStatus).toBe('unavailable');
    expect(insight.reasonCode).toBe('LLM_RATE_LIMITED');
    expect(result.investigation.reasonCode).toBe('LLM_RATE_LIMITED');
    expect(result.reasonCode).toBe('LLM_RATE_LIMITED');
    expect(insight.recommendation).toBeNull();

    // No fabricated summary and no provider internals in owner-facing text.
    expect(insight.title).toMatch(/temporarily unavailable/i);
    expect(insight.summary).toMatch(/no information was invented/i);
    const prose = JSON.stringify({ t: insight.title, s: insight.summary, r: insight.recommendation });
    expect(prose).not.toMatch(/429|rate_limited|rate.?limit|provider|synthesis_/i);

    // The single bounded 429 retry is opted in on the shared client.
    expect(requests).toHaveLength(1);
    expect(requests[0].retryOnRateLimit).toBe(true);
  });

  it('TEST 5 — successful synthesis is owner-facing, grounded and free of internal tool ids', async () => {
    await Offer.create({
      restaurantId: R1,
      title: 'Visible offer',
      description: 'x',
      type: 'percentage',
      value: 10,
      status: 'active',
    } as any);
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        task: 'Find the most important marketing opportunity for this restaurant.',
        llm: scriptedLlm(['getActiveOffers', 'getSalesTrends']),
        synthesisLlm: synthesisReturning({
          title: 'One live offer with a thin sales context',
          summary: 'A live offer exists for this restaurant and recent sales were reviewed alongside it.',
          priority: 'medium',
          recommendation: 'Review the live offer before planning the next campaign.',
          evidenceRefs: ['getActiveOffers', 'getSalesTrends'],
          confidence: 0.55,
        }),
      },
    );
    const insight = result.insights[0];
    expect(result.degraded).toBe(false);
    expect(insight.summaryStatus).toBe('ok');
    expect(result.investigation.summaryStatus).toBe('ok');
    expect(insight.reasonCode).toBeUndefined();
    expect(insight.summary).toContain('live offer');
    expect(insight.recommendation).toContain('Review the live offer');
    expect([...insight.toolsUsed].sort()).toEqual(['getActiveOffers', 'getSalesTrends']);
    // Concise owner prose — internal tool ids never reach the narrative.
    const prose = JSON.stringify({ t: insight.title, s: insight.summary, r: insight.recommendation });
    expect(prose).not.toMatch(/get[A-Z]/);
  });

  it('TEST 7 — an unavailable source cannot become "no problem", and is still reported as checked', async () => {
    const synthesisRequests: LlmJsonRequest[] = [];
    const loopRequests: LlmJsonRequest[] = [];
    const scripted = scriptedLlm(['getOfferPerformance']);
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        // Narrow question: one specialized source is legitimately sufficient.
        task: 'How did my offers perform?',
        llm: (async (req: LlmJsonRequest) => {
          loopRequests.push(req);
          return scripted(req);
        }) as unknown as LoopLlmFn,
        synthesisLlm: captureSynthesis(synthesisRequests, {
          title: 'Offer performance could not be assessed',
          summary: 'The offer performance data was unavailable for this restaurant, so nothing could be concluded.',
          priority: 'normal',
          recommendation: 'Record offer history before reviewing performance.',
          evidenceRefs: ['getOfferPerformance'],
          confidence: 0.3,
        }),
      },
    );

    // The tool really reported an unavailable state for this tenant...
    // (the evidence JSON is embedded as a string, so the quotes are escaped)
    expect(synthesisRequests[0].prompt).toMatch(/\\?"available\\?":false/);
    expect(synthesisRequests[0].prompt).toContain('NO_OFFER_PERFORMANCE_DATA');
    // ...the synthesis contract keeps the "unavailable is not healthy" rule...
    expect(synthesisRequests[0].system).toMatch(/available=false/);
    expect(synthesisRequests[0].system).toMatch(/NOT evidence that the business is healthy/i);
    // ...and the agent's own role rules forbid inventing an all-clear.
    expect(loopRequests[0].system).toMatch(/never turn "this could not be assessed" into "there is no problem"/i);

    // The checked source is preserved so the UI can say what was inspected.
    const insight = result.insights[0];
    expect(insight.toolsUsed).toEqual(['getOfferPerformance']);
    expect(insight.evidence.map((e) => e.ref)).toEqual(['getOfferPerformance']);
    // No reassurance is ever fabricated by the system itself.
    expect(JSON.stringify(result)).not.toMatch(/no risk|no problem|all good|nothing to worry/i);
  });
});
