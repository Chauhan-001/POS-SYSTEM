/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryAgentLoop.test.ts — Phase 1 ↔ Phase 2 integration acceptance:
 * the bounded loop loads tenant-scoped memory at run start into WORKING
 * memory, injects it (with the source-priority rule) into prompts, degrades
 * gracefully when loading fails, and NEVER changes the deterministic ladder
 * output or the response contract.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { runBoundedAgentLoop, type LoopLlmFn, type LoopMemoryFn } from '../loop/agentLoop';
import { runMarketingAgent, runMarketingAgentDeterministic } from '../marketingAgent';
import { memoryManager } from '../../memory/memoryManager';
import { MEMORY_PRIORITY_STATEMENT, type AgentMemoryContext } from '../../memory/memoryTypes';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { z } from 'zod';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };

const TEST_POLICY = { agent: 'test_agent', allowedTools: [] } as const;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  if (!toolRegistry.has('memoryTestTool')) {
    toolRegistry.register({
      name: 'memoryTestTool',
      category: 'sales',
      access: 'read',
      meta: { description: 'Phase-2 memory integration test tool', source: 'test' },
      inputSchema: z.object({}).strict(),
      execute: async () => ({ available: true, value: 1 }),
    } as any);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.collection('memoryepisodes').deleteMany({});
  await mongoose.connection.db!.collection('restaurantmemories').deleteMany({});
});

const llmReturning = (value: unknown): LoopLlmFn =>
  async () => ({ value, model: 'fake-model', provider: 'fake', latencyMs: 1, usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } });

describe('memory loading at run start', () => {
  it('loads tenant-scoped memory into working memory before the first LLM call', async () => {
    await memoryManager.recordEpisode(tenantR1, {
      episodeType: 'campaign_launched',
      objective: 'lunch push last week',
      source: 'service',
      confidence: 0.85,
    });

    const prompts: string[] = [];
    const systems: string[] = [];
    const capturing: LoopLlmFn = async (req) => {
      prompts.push(req.prompt);
      systems.push(req.system);
      return { value: { needMoreEvidence: false }, model: 'fake', provider: 'fake', latencyMs: 1 };
    };

    const run = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'investigate lunch sales',
      tenant: tenantR1,
      llm: capturing,
    });

    expect(run.memory).toBeDefined();
    expect(run.memory!.episodes).toHaveLength(1);
    expect(run.memory!.episodes[0].episodeType).toBe('campaign_launched');
    expect(run.memory!.priorityStatement).toBe(MEMORY_PRIORITY_STATEMENT);
    expect(run.memory!.degraded).toBeFalsy();

    // Memory is in the user prompt (context, not authority) …
    expect(prompts[0]).toContain('Stored memory (contextual evidence only');
    expect(prompts[0]).toContain('campaign_launched');
    // … and the authority rules live in the system prompt.
    expect(systems[0]).toContain('Evidence priority: current business data > current ML');
    expect(systems[0]).toContain('memory alone is never sufficient reason');
  });

  it('memory is tenant-scoped: R2 run never sees R1 memory', async () => {
    await memoryManager.recordEpisode(tenantR1, {
      episodeType: 'manual_note',
      objective: 'R1 secret context',
      source: 'service',
      confidence: 0.9,
    });

    let captured = '';
    const llm: LoopLlmFn = async (req) => {
      captured = req.prompt;
      return { value: { needMoreEvidence: false }, model: 'fake', provider: 'fake', latencyMs: 1 };
    };

    const run = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: { restaurantId: R2 },
      llm,
    });

    expect(run.memory?.episodes).toHaveLength(0);
    expect(captured).toContain('(no recent episodes)');
    expect(captured).not.toContain('R1 secret context');
  });

  it('a FAILING memory loader degrades to an empty flagged context — the run continues', async () => {
    const failing: LoopMemoryFn = async () => {
      throw new Error('mongo unreachable');
    };
    const run = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ needMoreEvidence: false }),
      loadMemory: failing,
    });

    expect(run.status).toBe('completed_sufficient');
    expect(run.memory?.degraded).toBe(true);
    expect(run.memory?.episodes).toEqual([]);
    expect(run.memory?.reason).toContain('mongo unreachable');
  });

  it('runs with NO memory loader seam → default memoryManager path (connected DB)', async () => {
    const run = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ needMoreEvidence: false }),
    });
    expect(run.memory).toBeDefined();
    expect(run.memory?.degraded).toBeFalsy();
    expect(run.memory?.episodes).toEqual([]);
  });

  it('the loop NEVER writes memory back (no automatic learning in Phase 2)', async () => {
    const epCount = await mongoose.connection.db!.collection('memoryepisodes').countDocuments({});
    const ltCount = await mongoose.connection.db!.collection('restaurantmemories').countDocuments({});

    await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ toolCalls: [{ name: 'memoryTestTool', args: {} }], needMoreEvidence: false }),
    });

    expect(await mongoose.connection.db!.collection('memoryepisodes').countDocuments({})).toBe(epCount);
    expect(await mongoose.connection.db!.collection('restaurantmemories').countDocuments({})).toBe(ltCount);
  });

  it('working memory stays run-local: two runs get independent memory snapshots', async () => {
    await memoryManager.recordEpisode(tenantR1, {
      episodeType: 'manual_note',
      objective: 'shared context',
      source: 'service',
      confidence: 0.5,
    });

    const run1 = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ needMoreEvidence: false }),
    });
    const run2 = await runBoundedAgentLoop({
      policy: { agent: 'test_agent', allowedTools: ['memoryTestTool'] },
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ needMoreEvidence: false }),
    });

    expect(run1.runId).not.toBe(run2.runId);
    expect(run1.memory).not.toBe(run2.memory);
    expect(run1.memory!.loadedAt).not.toBe(run2.memory!.loadedAt);
    expect(run1.memory!.episodes[0].id).toBe(run2.memory!.episodes[0].id);
  });
});

describe('runMarketingAgent integration (Phase 1 contract intact)', () => {
  it('agentic run reports memory counts on investigation; ladder output unchanged', async () => {
    await memoryManager.recordEpisode(tenantR1, {
      episodeType: 'campaign_launched',
      objective: 'prior push',
      source: 'service',
      confidence: 0.8,
    });
    await memoryManager.upsertLongTermMemory(tenantR1, {
      memoryType: 'seasonality_pattern',
      value: { festivalLiftPct: 15 },
      confidence: 0.7,
      source: 'service',
      evidence: [{ kind: 'metric', ref: 'metric:x', value: 15 }],
    });

    const deterministic = await runMarketingAgentDeterministic({ tenant: tenantR1 });
    const agentic = await runMarketingAgent({ tenant: tenantR1 }, { agentic: true, llm: llmReturning({ needMoreEvidence: false }) });

    expect(agentic.investigation?.memory).toEqual({ episodes: 1, longTerm: 1, degraded: false });
    // Deterministic ladder output is byte-for-byte identical.
    expect(agentic.targetingSource).toBe(deterministic.targetingSource);
    expect(agentic.targetingReason).toBe(deterministic.targetingReason);
    expect(agentic.targets).toEqual(deterministic.targets);
    expect(agentic.nextActions).toEqual(deterministic.nextActions);
    expect(agentic.offerDraft).toEqual(deterministic.offerDraft);
  });

  it('memory load failure still yields investigation.memory (degraded flag) with intact contract', async () => {
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      {
        agentic: true,
        llm: llmReturning({ needMoreEvidence: false }),
        loadMemory: async () => {
          throw new Error('loader down');
        },
      },
    );
    expect(result.investigation?.memory).toEqual({ episodes: 0, longTerm: 0, degraded: true });
    expect(result.targetingSource).toBeDefined();
    expect(Array.isArray(result.nextActions)).toBe(true);
  });

  it('default (non-agentic) run stays fully deterministic — no investigation, contract intact', async () => {
    const result = await runMarketingAgent({ tenant: tenantR1 });
    expect(result.investigation).toBeUndefined();
    expect(result.targetingSource).toBe('NONE');
    expect(result.generatedAt).toBeTruthy();
  });
});
