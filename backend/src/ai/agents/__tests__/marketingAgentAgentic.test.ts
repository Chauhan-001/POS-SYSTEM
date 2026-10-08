/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentAgentic.test.ts — the agentic loop must remain genuinely
 * iterative after the architecture change:
 *
 *   C. tool choice is dynamic (no fixed ladder);
 *   D. a tool's result reaches the NEXT LLM step;
 *   + budgets bound every run;
 *   + the stop guard refuses to conclude without evidence;
 *   + tenant keys can never be supplied by the model;
 *   + the shared loop still records per-agent observability.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { runMarketingAgent } from '../marketingAgent';
import { runBoundedAgentLoop, type LoopLlmFn, type LoopMemoryFn } from '../loop/agentLoop';
import {
  marketingAgentPolicy,
  MARKETING_AGENT_BUDGET,
  MARKETING_AGENT_OBSERVATION_CHARS,
  MARKETING_AGENT_PROMPT_VERSION,
} from '../policies/marketingAgentPolicy';
import { MAX_BROAD_STOP_DEFERRALS } from '../marketingAgent';
import AIUsageLog from '../../../models/core/AIUsageLog';
import Offer from '../../../models/marketing/Offer';
import Customer from '../../../models/customers/Customer';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };

const noMemory: LoopMemoryFn = async () => ({
  episodes: [],
  longTerm: [],
  priorityStatement: 'probe',
  loadedAt: new Date().toISOString(),
  degraded: false,
});

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
  await Customer.deleteMany({ restaurantId: { $in: [R1, R2] } });
  await AIUsageLog.deleteMany({ restaurantId: { $in: [R1, R2] } });
});

/**
 * Seed REAL usable evidence in TWO different areas of the business:
 *   - one live offer         → marketing area (getActiveOffers)
 *   - one customer           → customers area (getCustomerSegments)
 *
 * Two usable areas is exactly what the sufficiency guard requires before a
 * whole-restaurant question may be concluded. Without it, a broad run is
 * (correctly) not allowed to claim sufficiency — that is the empty-source rule
 * these tests exist for.
 */
async function seedUsableEvidence(restaurantId: string = R1): Promise<void> {
  await Offer.create({
    restaurantId,
    title: 'Seeded live offer',
    description: 'Seeded offer used as usable marketing evidence.',
    type: 'percentage',
    value: 10,
    status: 'active',
  } as any);
  await Customer.create({
    restaurantId,
    name: 'Seeded usable customer',
    phone: '9800000001',
    visits: 3,
    totalSpend: 900,
    points: 120,
    lastVisit: new Date(),
  } as any);
}

/** One scripted decision per call, with captured prompts. */
function scripted(steps: Array<{ tools: string[]; more: boolean }>) {
  const prompts: string[] = [];
  let i = 0;
  const llm = (async (req: { prompt: string }) => {
    prompts.push(req.prompt);
    const s = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return {
      value: { plan: ['step'], toolCalls: s.tools.map((name) => ({ name, args: {} })), needMoreEvidence: s.more },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    };
  }) as unknown as LoopLlmFn;
  return { llm, prompts, get calls() { return i; } };
}

const noSynthesis = async () => ({
  value: null,
  model: 'fake',
  provider: 'fake',
  latencyMs: 1,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
});

describe('agentic loop behaviour (System #2)', () => {
  it('C: tool choice is dynamic — different scripts produce different tool sets', async () => {
    const a = await runMarketingAgent(
      { tenant: tenantR1 },
      // Narrow question: one focused source is legitimately enough.
      { task: 'How did my offers perform?', llm: scripted([{ tools: ['getActiveOffers'], more: false }]).llm, synthesisLlm: noSynthesis },
    );
    const b = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        // Also a focused question, so the run is a single decision: this test
        // is about tool CHOICE being dynamic, not about breadth.
        task: 'How did my menu performance look?',
        llm: scripted([{ tools: ['getSalesTrends', 'getMenuPerformance'], more: false }]).llm,
        synthesisLlm: noSynthesis,
      },
    );
    expect(a.investigation.toolNames).toEqual(['getActiveOffers']);
    expect(b.investigation.toolNames).toEqual(['getSalesTrends', 'getMenuPerformance']);
  });

  it('TEST 6: a NARROW question may legitimately finish after one tool (no forced extra calls)', async () => {
    const s = scripted([{ tools: ['getActiveOffers'], more: false }]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'How did my offers perform?', llm: s.llm, synthesisLlm: noSynthesis },
    );
    expect(r.investigation.toolCallsUsed).toBe(1);
    expect(r.investigation.toolNames).toHaveLength(1);
    expect(r.investigation.stepsUsed).toBe(1);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('TEST 1: a BROAD question normally investigates more than one complementary source', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getSalesTrends'], more: true },
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for this restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    // No exact sequence is asserted — only that the investigation was not
    // concluded from a single isolated source, and that the choice was the
    // model's (it drove every call).
    const sources = new Set(r.investigation.toolNames);
    expect(sources.size).toBeGreaterThan(1);
    expect(r.investigation.status).toBe('completed_sufficient');
    // One planning step per source, all chosen by the model itself.
    expect(s.prompts).toHaveLength(3);
    expect(r.investigation.stepsUsed).toBe(3);
  });

  it('TEST 1b: a broad question cannot be concluded from one area — the stop is deferred, then accepted once a second area has data', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getActiveOffers'], more: false },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for this restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    // The model saw the objection in its second prompt and chose the next source.
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[1]).toContain('stop_deferred');
    expect(s.prompts[1]).toMatch(/broad question/i);
    expect(s.prompts[1]).toMatch(/SAME area/i);
    expect(new Set(r.investigation.toolNames).size).toBe(2);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('TEST 3: the second tool selection is driven by what the first tool returned', async () => {
    await seedUsableEvidence();
    const seen: string[] = [];
    // A fake planner that READS the previous observation out of its prompt and
    // picks its next tool from it — the strongest proof of sequential reasoning.
    const planner = (async (req: { prompt: string }) => {
      const sawObservation = /getActiveOffers:/.test(req.prompt);
      const name = sawObservation ? 'getCustomerSegments' : 'getActiveOffers';
      seen.push(name);
      return {
        value: { plan: ['investigate'], toolCalls: [{ name, args: {} }], needMoreEvidence: !sawObservation },
        model: 'fake-model',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      };
    }) as unknown as LoopLlmFn;

    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for this restaurant.', llm: planner, synthesisLlm: noSynthesis },
    );

    // The second choice exists ONLY because the first result was readable.
    expect(seen).toEqual(['getActiveOffers', 'getCustomerSegments']);
    expect(r.investigation.toolNames).toEqual(['getActiveOffers', 'getCustomerSegments']);
    expect(r.investigation.stepsUsed).toBe(2);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('D: result A reaches the next LLM step and drives tool B', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent({ tenant: tenantR1 }, { llm: s.llm, synthesisLlm: noSynthesis });

    expect(s.prompts).toHaveLength(2);
    // Step 2's prompt carries the step-1 observation, rendered by the server.
    expect(s.prompts[1]).toContain('Evidence so far');
    expect(s.prompts[1]).toContain('getActiveOffers:');
    expect(s.prompts[1]).toContain('available=true');
    expect(r.investigation.stepsUsed).toBe(2);
    expect(r.investigation.llmCalls).toBe(2);
    expect(r.investigation.toolNames).toEqual(['getActiveOffers', 'getCustomerSegments']);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('stop guard defers a stop with zero evidence, then completes after evidence', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: [], more: false },
      { tools: ['getActiveOffers', 'getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent({ tenant: tenantR1 }, { llm: s.llm, synthesisLlm: noSynthesis });

    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[1]).toContain('stop_deferred');
    expect(s.prompts[1]).toMatch(/no read-only tool has been called/i);
    expect(r.investigation.status).toBe('completed_sufficient');
    expect(r.investigation.toolCallsUsed).toBe(2);
  });

  it('budgets bound the run (maxSteps=1 → a single LLM call)', async () => {
    const s = scripted([{ tools: ['getActiveOffers'], more: true }]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { llm: s.llm, loopBudget: { maxSteps: 1 }, synthesisLlm: noSynthesis },
    );
    expect(s.calls).toBe(1);
    expect(r.investigation.status).toBe('stopped_max_steps');
    expect(r.investigation.stepsUsed).toBe(1);
  });

  it('the model can never supply tenant identifiers to a tool', async () => {
    const llm = (async () => ({
      value: {
        toolCalls: [{ name: 'getActiveOffers', args: { restaurantId: R2, tenantId: R2 } }],
        needMoreEvidence: false,
      },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    })) as unknown as LoopLlmFn;

    const run = await runBoundedAgentLoop({
      policy: marketingAgentPolicy,
      objective: 'tenant probe',
      tenant: tenantR1,
      llm,
      loadMemory: noMemory,
    });
    expect(run.toolCalls[0].args).not.toHaveProperty('restaurantId');
    expect(run.toolCalls[0].args).not.toHaveProperty('tenantId');
  });

  it('records per-agent observability for the insight run', async () => {
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { llm: scripted([{ tools: ['getActiveOffers'], more: false }]).llm, synthesisLlm: noSynthesis, requestId: 'req-insight' },
    );
    const rows = await AIUsageLog.find({ restaurantId: R1 }).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.feature === 'marketing_agent')).toBe(true);
    expect(rows.some((row) => row.promptVersion === MARKETING_AGENT_PROMPT_VERSION)).toBe(true);
    expect(r.investigation.requestId).toBe('req-insight');
    expect(r.investigation.runId).toBeTruthy();
  });
});

/**
 * SYSTEM #2 DEPTH — the AI Insights agent must be a genuinely deep, sequential
 * investigation, not the previous shallow 3-step / 6-call window.
 *
 * These tests exercise the ceilings, the sufficiency stop condition, the
 * evidence-area requirement for broad questions, and the fact that a later
 * decision can read the DETAIL (not only the headline) of an earlier result.
 */
describe('deepened agentic investigation (System #2 depth)', () => {
  it('budgets are generous CEILINGS (14 steps / 12 calls / 90s), not the shallow window', () => {
    expect(MARKETING_AGENT_BUDGET.maxSteps).toBe(14);
    expect(MARKETING_AGENT_BUDGET.maxToolCalls).toBe(12);
    expect(MARKETING_AGENT_BUDGET.durationMs).toBe(90_000);
    // The step ceiling must exceed the tool-call ceiling: the sufficiency guard
    // can defer a premature stop, and a deferral costs a step without a call.
    expect(MARKETING_AGENT_BUDGET.maxSteps!).toBeGreaterThan(MARKETING_AGENT_BUDGET.maxToolCalls!);
    // Token ceiling must be able to carry a deep run (each plan re-sends the
    // catalog + every observation, then the synthesis re-sends every source).
    expect(MARKETING_AGENT_BUDGET.maxTokens).toBeGreaterThanOrEqual(40_000);
    expect(MARKETING_AGENT_PROMPT_VERSION).toBe('marketing-insight-v3');
  });

  it('runs DEEP (6 sequential steps) and completes on sufficiency, not on a small step count', async () => {
    await seedUsableEvidence();
    // One source per step, alternating evidence areas, so the run is a real
    // chain rather than one fan-out. The model drives the stop at step 6, when
    // usable evidence exists in more than one area.
    const s = scripted([
      { tools: ['getSalesTrends'], more: true },
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getMenuPerformance'], more: true },
      { tools: ['getCustomerSegments'], more: true },
      { tools: ['getInventoryStatus'], more: true },
      { tools: ['getFestivalContext'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for my restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    expect(r.investigation.stepsUsed).toBe(6);
    expect(r.investigation.toolCallsUsed).toBe(6);
    expect(r.investigation.toolNames).toHaveLength(6);
    expect(r.investigation.llmCalls).toBe(6);
    expect(s.prompts).toHaveLength(6);
    expect(r.investigation.status).toBe('completed_sufficient');
    // Well beyond the previous 2-4 tool / 3-step shallow behaviour.
    expect(r.investigation.toolCallsUsed).toBeGreaterThan(4);
  });

  it('still stops EARLY when the model judges the evidence sufficient', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for my restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    // No tool is called just because budget remains.
    expect(r.investigation.toolCallsUsed).toBe(2);
    expect(r.investigation.stepsUsed).toBe(2);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('a broad question cannot be concluded from the SAME evidence area alone', async () => {
    await seedUsableEvidence();
    // getActiveOffers and getOfferPerformance both read the marketing area; the
    // second returns no data for this seeded tenant (no redemption history), so
    // the usable evidence still comes from a single area.
    const s = scripted([
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getOfferPerformance'], more: false },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for my restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    // Step 2's stop was objected to because every usable source read one area...
    expect(s.prompts).toHaveLength(3);
    expect(s.prompts[2]).toContain('stop_deferred');
    expect(s.prompts[2]).toMatch(/SAME area/i);
    // ...and the model then crossed into a second area before concluding.
    expect(r.investigation.toolNames).toEqual(['getActiveOffers', 'getOfferPerformance', 'getCustomerSegments']);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('a later step can read the DETAIL of an earlier result (raised observation clip)', async () => {
    // A distinctive marker sits deep inside a long offer description, i.e.
    // beyond the loop's historical 600-char observation clip.
    const marker = 'DEEP_DETAIL_MARKER_9X7';
    await Offer.create({
      restaurantId: R1,
      title: 'Detail probe offer',
      description: `${'z'.repeat(900)} ${marker}`,
      type: 'percentage',
      value: 10,
      status: 'active',
    } as any);

    const capture = () => {
      const prompts: string[] = [];
      let i = 0;
      const llm = (async (req: { prompt: string }) => {
        prompts.push(req.prompt);
        i += 1;
        return {
          value: {
            toolCalls: [{ name: i === 1 ? 'getActiveOffers' : 'getSalesTrends', args: {} }],
            needMoreEvidence: i === 1,
          },
          model: 'fake-model',
          provider: 'fake',
          latencyMs: 1,
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
        };
      }) as unknown as LoopLlmFn;
      return { llm, prompts };
    };

    // The AGENT (production configuration) opts into the deeper clip.
    const agent = capture();
    await runMarketingAgent({ tenant: tenantR1 }, { llm: agent.llm, synthesisLlm: noSynthesis });
    expect(agent.prompts[1]).toContain('getActiveOffers:');
    expect(agent.prompts[1]).toContain(marker);

    // Control: the historical 600-char default does NOT carry that detail.
    const control = capture();
    await runBoundedAgentLoop({
      policy: marketingAgentPolicy,
      objective: 'detail probe',
      tenant: tenantR1,
      llm: control.llm,
      loadMemory: noMemory,
      observationChars: 600,
    });
    expect(control.prompts[1]).toContain('getActiveOffers:');
    expect(control.prompts[1]).not.toContain(marker);

    expect(MARKETING_AGENT_OBSERVATION_CHARS).toBeGreaterThan(600);
  });

  it('a repeated identical read is served from cache instead of re-executed', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for my restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );
    // The repeat is still recorded (budget is consumed, so it can never loop)
    // but the tool was NOT executed again — a long run must not burn its
    // tool-call ceiling re-reading a source it already has.
    expect(r.investigation.dedupedCalls).toBe(1);
    expect(r.investigation.toolCallsUsed).toBe(3);
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('the deep ceilings still bound a runaway run (steps, then tool calls)', async () => {
    // Never happy with the evidence → the STEP ceiling stops the run (no tool
    // calls are requested, so the tool ceiling cannot bind first).
    const greedy = scripted([{ tools: [], more: true }]);
    const bySteps = await runMarketingAgent(
      { tenant: tenantR1 },
      { llm: greedy.llm, synthesisLlm: noSynthesis },
    );
    expect(bySteps.investigation.status).toBe('stopped_max_steps');
    expect(bySteps.investigation.stepsUsed).toBe(14);
    expect(bySteps.investigation.toolCallsUsed).toBe(0);

    // A step that requests many tools at once is still capped in total.
    const fanOut = scripted([
      { tools: ['getSalesTrends', 'getMenuPerformance', 'getProductMargins', 'getProductCombinations', 'getInventoryStatus', 'getStockoutRisk', 'getCustomerSegments', 'getActiveOffers'], more: true },
      { tools: ['getOfferPerformance', 'getCampaignPerformance', 'getRetentionSignals', 'getDemandForecast'], more: true },
      { tools: ['getFestivalContext'], more: true },
    ]);
    const byTools = await runMarketingAgent(
      { tenant: tenantR1 },
      { llm: fanOut.llm, synthesisLlm: noSynthesis },
    );
    expect(byTools.investigation.toolCallsUsed).toBe(12);
    expect(byTools.investigation.status).toBe('stopped_max_tool_calls');
  });
});

/**
 * EMPTY SOURCES AND COVERAGE — the behaviour this agent was reported to get
 * wrong: it read one or two sources, found them empty, and answered "not
 * enough data" instead of investigating the areas it had not touched yet.
 */
describe('empty sources, coverage guidance and breadth (System #2 breadth)', () => {
  const broadTask = 'What marketing issue should I pay attention to this week?';

  it('an all-empty investigation keeps being told to investigate, instead of concluding "not enough data"', async () => {
    // No seeded evidence at all: every source this run reads reports NO data.
    // The model reads one source, then simply keeps asking to stop — exactly
    // the behaviour that used to be reported to the owner as "not enough data".
    let i = 0;
    const prompts: string[] = [];
    const llm = (async (req: { prompt: string }) => {
      prompts.push(req.prompt);
      const first = i === 0;
      i += 1;
      return {
        value: {
          plan: ['investigate'],
          toolCalls: first ? [{ name: 'getSalesTrends', args: {} }] : [],
          needMoreEvidence: false,
        },
        model: 'fake-model',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      };
    }) as unknown as LoopLlmFn;

    const r = await runMarketingAgent({ tenant: tenantR1 }, { task: broadTask, llm, synthesisLlm: noSynthesis });

    // Every stop after the first empty read is deferred: an empty source is not
    // an answer. The run is bounded (MAX_BROAD_STOP_DEFERRALS), never infinite.
    const deferrals = r.investigation.stepsUsed - 1;
    expect(deferrals).toBe(MAX_BROAD_STOP_DEFERRALS);
    expect(prompts[1]).toContain('stop_deferred');
    expect(prompts[1]).toMatch(/no usable data/i);
    expect(prompts[1]).toMatch(/does NOT mean the others are empty/i);
    // The objection names the areas that are still unread (prompt-only guidance).
    expect(prompts[1]).toMatch(/areas you have NOT read yet/i);
    // Only the model's own call ran: the guard never executes a tool itself.
    expect(r.investigation.toolNames).toEqual(['getSalesTrends']);
  });

  it('the source-coverage block reaches every planning prompt and marks empty reads as such', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getSalesTrends'], more: true },
      { tools: ['getActiveOffers'], more: true },
      { tools: ['getCustomerSegments'], more: false },
    ]);
    await runMarketingAgent({ tenant: tenantR1 }, { task: broadTask, llm: s.llm, synthesisLlm: noSynthesis });

    // Step 1: nothing read yet — every source is still available.
    expect(s.prompts[0]).toContain('Source coverage');
    expect(s.prompts[0]).toContain('Read with usable data: (none yet)');
    expect(s.prompts[0]).toMatch(/NOT yet read:/);
    // Step 2: the empty sales read is distinguished from the rest, and the
    // unread sources (including the marketing area) are still listed.
    expect(s.prompts[1]).toContain('Read but returned NO data: sales/getSalesTrends');
    expect(s.prompts[1]).toContain('Read with usable data: (none yet)');
    // `getActiveOffers` is still unread at this point, so it is listed as such.
    expect(s.prompts[1]).toMatch(/NOT yet read:[^\n]*getActiveOffers/);
    expect(s.prompts[1]).toMatch(/says NOTHING about the others/i);
    // Step 3: a usable read is now reported as usable, not as checked-and-empty.
    expect(s.prompts[2]).toContain('Read with usable data: marketing/getActiveOffers');
    expect(s.prompts[2]).toContain('Read but returned NO data: sales/getSalesTrends');

    // Control: the shared loop only adds this when the agent opts in.
    const control = scripted([{ tools: ['getActiveOffers'], more: false }]);
    await runBoundedAgentLoop({
      policy: marketingAgentPolicy,
      objective: broadTask,
      tenant: tenantR1,
      llm: control.llm,
      loadMemory: noMemory,
    });
    expect(control.prompts[0]).not.toContain('Source coverage');
  });

  it('a broad run that finds real data in two areas still concludes without spending the whole budget', async () => {
    await seedUsableEvidence();
    const s = scripted([
      { tools: ['getActiveOffers'], more: false },
      { tools: ['getCustomerSegments', 'getMenuPerformance'], more: false },
    ]);
    const r = await runMarketingAgent({ tenant: tenantR1 }, { task: broadTask, llm: s.llm, synthesisLlm: noSynthesis });

    // Exactly one deferral, then the model's own stop is accepted.
    expect(r.investigation.stepsUsed).toBe(2);
    expect(r.investigation.status).toBe('completed_sufficient');
    // The empty source from step 2 is still recorded as checked.
    expect(r.investigation.toolNames).toEqual(['getActiveOffers', 'getCustomerSegments', 'getMenuPerformance']);
  });
});
