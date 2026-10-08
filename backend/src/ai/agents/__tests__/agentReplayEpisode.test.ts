/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentReplayEpisode.test.ts — every AI Insights investigation must be
 * recorded as a REPLAYABLE episode: per step, the evidence the model saw, the
 * tool it chose, the reason it gave and the call that actually executed —
 * stored in the EXISTING audit row (no second observability system), and
 * readable back tenant-scoped through the shared read model.
 *
 * Proven here:
 *   1. opting in records a chain whose step N+1 "seen" contains step N's result;
 *   2. deferred stops and the final decision are both recorded;
 *   3. the recorded summaries are the bounded renderings, never raw payloads;
 *   4. non-opted agents (the inventory policy) still record NO replay;
 *   5. the read model round-trips list → detail, tenant-scoped and 404-safe.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { runMarketingAgent, MAX_BROAD_STOP_DEFERRALS } from '../marketingAgent';
import { runBoundedAgentLoop, type LoopLlmFn, type LoopMemoryFn } from '../loop/agentLoop';
import { marketingAgentPolicy } from '../policies/marketingAgentPolicy';
import { inventoryAgentPolicy } from '../policies/inventoryAgentPolicy';
import { listReplayEpisodes, getReplayEpisode } from '../../observability/agentUsage';
import AuditLog from '../../../models/admin/AuditLog';

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
  await AuditLog.deleteMany({ entityType: 'agent_run' });
});

/** Scripted planner: each decision reads the evidence out of its own prompt. */
function scripted(steps: Array<{ tools: string[]; more: boolean; reason?: string }>) {
  const prompts: string[] = [];
  let i = 0;
  const llm = (async (req: { prompt: string }) => {
    prompts.push(req.prompt);
    const s = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return {
      value: {
        plan: ['investigate'],
        toolCalls: s.tools.map((name) => ({ name, args: {} })),
        needMoreEvidence: s.more,
        reason: s.reason,
      },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    };
  }) as unknown as LoopLlmFn;
  return { llm, prompts };
}

const noSynthesis = async () => ({
  value: { title: 't', summary: 's' },
  model: 'fake',
  provider: 'fake',
  latencyMs: 1,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
});

describe('replayable investigation episodes (System #2 observability)', () => {
  it('records a chain whose step N+1 "seen" carries step N\'s result and reason', async () => {
    const s = scripted([
      { tools: ['getActiveOffers'], more: true, reason: 'start from the live offers' },
      { tools: ['getSalesTrends'], more: false, reason: 'offers looked odd — check revenue' },
    ]);
    // A focused question, so the run is exactly the two model-chosen steps this
    // test replays (breadth is exercised in marketingAgentAgentic.test.ts).
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'How did my offers perform?', llm: s.llm, synthesisLlm: noSynthesis },
    );

    const row = await AuditLog.findOne({ entityType: 'agent_run', entityId: r.investigation.runId }).lean();
    expect(row).toBeTruthy();
    const replay = (row!.details as any)?.replay;
    expect(replay).toBeTruthy();
    expect(replay.promptVersion).toBe('marketing-insight-v3');
    expect(replay.steps).toHaveLength(2);

    // Step 1: nothing seen yet, one tool requested+executed, reason recorded.
    expect(replay.steps[0].step).toBe(1);
    expect(replay.steps[0].seen).toEqual([]);
    expect(replay.steps[0].requested).toEqual(['getActiveOffers']);
    expect(replay.steps[0].reason).toBe('start from the live offers');
    expect(replay.steps[0].needMoreEvidence).toBe(true);
    expect(replay.steps[0].executed).toEqual([{ tool: 'getActiveOffers', ok: true }]);

    // Step 2: the model SAW step 1's observation before deciding — the
    // replayable proof that later choices depend on earlier results.
    expect(replay.steps[1].seen).toHaveLength(1);
    expect(replay.steps[1].seen[0].tool).toBe('getActiveOffers');
    expect(replay.steps[1].seen[0].ok).toBe(true);
    expect(typeof replay.steps[1].seen[0].summary).toBe('string');
    expect(replay.steps[1].reason).toBe('offers looked odd — check revenue');
    expect(replay.steps[1].needMoreEvidence).toBe(false);
    expect(replay.steps[1].executed).toEqual([{ tool: 'getSalesTrends', ok: true }]);
  });

  it('records every deferred stop (objection) and the eventually accepted stop', async () => {
    // Broad question + empty sources → the sufficiency guard refuses to conclude
    // "not enough data" and defers the stop, up to its own bound.
    const s = scripted([
      { tools: ['getSalesTrends'], more: false, reason: 'looks sufficient' },
      { tools: ['getMenuPerformance'], more: false, reason: 'cross-checked now' },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'Find the most important marketing opportunity for my restaurant.', llm: s.llm, synthesisLlm: noSynthesis },
    );

    const replay = ((await AuditLog.findOne({ entityType: 'agent_run', entityId: r.investigation.runId }).lean())!
      .details as any).replay;
    // One deferred stop per bound, then the stop that is finally accepted.
    expect(replay.steps).toHaveLength(MAX_BROAD_STOP_DEFERRALS + 1);
    expect(replay.steps[0].stopObjection).toMatch(/no usable data/i);
    expect(replay.steps[0].needMoreEvidence).toBe(false);
    expect(replay.steps[MAX_BROAD_STOP_DEFERRALS - 1].stopObjection).toMatch(/no usable data/i);
    expect(replay.steps[MAX_BROAD_STOP_DEFERRALS].stopObjection).toBeUndefined();
    expect(r.investigation.status).toBe('completed_sufficient');
  });

  it('records bounded summaries, never raw tool payloads', async () => {
    const s = scripted([{ tools: ['getActiveOffers'], more: false }]);
    const r = await runMarketingAgent({ tenant: tenantR1 }, { task: 'probe privacy', llm: s.llm, synthesisLlm: noSynthesis });
    const replay = ((await AuditLog.findOne({ entityType: 'agent_run', entityId: r.investigation.runId }).lean())!
      .details as any).replay;

    // The chain holds observation SUMMARIES only; the run's captured toolData
    // (full payloads) must never appear inside the replay document.
    const serialized = JSON.stringify(replay);
    expect(serialized.length).toBeLessThan(60_000);
    // No zod'd args, no full dataset fields: executed entries are name/outcome only.
    for (const st of replay.steps) {
      for (const ex of st.executed) {
        expect(Object.keys(ex).sort()).toEqual(['code', 'deduped', 'ok', 'tool'].filter((k) => (ex as any)[k] !== undefined || k === 'tool' || k === 'ok').sort());
      }
    }
  });

  it('agents that did not opt in record NO replay (inventory policy stays byte-identical)', async () => {
    const llm = (async () => ({
      value: { toolCalls: [{ name: 'getInventoryStatus', args: {} }], needMoreEvidence: false },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    })) as unknown as LoopLlmFn;

    const run = await runBoundedAgentLoop({
      policy: inventoryAgentPolicy,
      objective: 'inventory probe',
      tenant: tenantR1,
      llm,
      loadMemory: noMemory,
    });
    expect(run.status).toBe('completed_sufficient');
    expect(run.replay).toBeUndefined();

    const row = await AuditLog.findOne({ entityType: 'agent_run', entityId: run.runId }).lean();
    expect((row!.details as any).replay).toBeUndefined();
    // And the read model does not list it as replayable.
    const list = await listReplayEpisodes(R1, { agent: 'inventory_agent' });
    expect(list).toHaveLength(0);
  });

  it('read model round-trips list → detail, tenant-scoped and 404-safe', async () => {
    const s = scripted([
      { tools: ['getSalesTrends'], more: true },
      { tools: ['getMenuPerformance'], more: false },
    ]);
    const r = await runMarketingAgent(
      { tenant: tenantR1 },
      { task: 'How did my menu performance look?', llm: s.llm, synthesisLlm: noSynthesis },
    );

    // Own tenant sees the episode in the list…
    const list = await listReplayEpisodes(R1, { agent: 'marketing_agent' });
    expect(list).toHaveLength(1);
    expect(list[0].runId).toBe(r.investigation.runId);
    expect(list[0].agent).toBe('marketing_agent');
    expect(list[0].objective).toBe('How did my menu performance look?');
    expect(list[0].promptVersion).toBe('marketing-insight-v3');
    expect(list[0].stepsUsed).toBe(2);
    expect(list).not.toContainEqual(expect.objectContaining({ steps: expect.anything() }));

    // …and can fetch the full chain with steps.
    const episode = await getReplayEpisode(R1, r.investigation.runId);
    expect(episode).toBeTruthy();
    expect(episode!.steps).toHaveLength(2);
    expect(episode!.steps[1].seen[0].tool).toBe('getSalesTrends');
    expect(episode!.status).toBe(r.investigation.status);

    // Another restaurant gets nothing — tenant isolation holds for replays.
    expect(await getReplayEpisode(R2, r.investigation.runId)).toBeNull();
    const listR2 = await listReplayEpisodes(R2, { agent: 'marketing_agent' });
    expect(listR2).toHaveLength(0);

    // Unknown run id → null (the route turns this into a clean 404).
    expect(await getReplayEpisode(R1, '507f1f77bcf86cd799439999')).toBeNull();
  });
});
