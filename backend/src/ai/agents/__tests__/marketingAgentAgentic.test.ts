/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentAgentic.test.ts — Phase 1 integration acceptance:
 * runMarketingAgent gains an optional bounded LLM investigation WITHOUT
 * changing the deterministic ladder output, the response contract, or the
 * fallback behavior (any LLM failure ⇒ exact deterministic result).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { runMarketingAgent, runMarketingAgentDeterministic } from '../marketingAgent';
import { LlmError } from '../../shared/llmClient';
import type { LoopLlmFn } from '../loop/agentLoop';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const healthyLlm: LoopLlmFn = async () => ({
  value: { plan: ['check active offers'], toolCalls: [{ name: 'getActiveOffers', args: {} }], needMoreEvidence: false },
  model: 'fake-model',
  provider: 'fake',
  latencyMs: 1,
  usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
});

const failingLlm: LoopLlmFn = async () => {
  throw new LlmError('LLM request timed out', 'timeout');
};

describe('runMarketingAgent Phase 1 integration', () => {
  it('DEFAULT (no agentic flag) stays fully deterministic — no investigation attached, contract intact', async () => {
    const result = await runMarketingAgent({ tenant: tenantR1 });

    expect(result.investigation).toBeUndefined();
    expect(result.targetingSource).toBe('NONE');
    expect(result.targets).toEqual([]);
    expect(result.offerDraft).toBeNull();
    expect(result.nextActions.length).toBeGreaterThan(0);
    expect(typeof result.generatedAt).toBe('string');
  });

  it('runMarketingAgentDeterministic is the unchanged ladder (direct contract)', async () => {
    const result = await runMarketingAgentDeterministic({ tenant: tenantR1 });
    expect(result.targetingSource).toBe('NONE');
    expect(result.targetingScope).toMatch(/no ML signal/i);
  });

  it('agentic + healthy LLM: investigation records the tool the LLM selected; ladder output unchanged', async () => {
    const deterministic = await runMarketingAgentDeterministic({ tenant: tenantR1 });
    const agentic = await runMarketingAgent({ tenant: tenantR1 }, { agentic: true, llm: healthyLlm });

    expect(agentic.investigation).toBeDefined();
    expect(agentic.investigation?.status).toBe('completed_sufficient');
    expect(agentic.investigation?.toolNames).toContain('getActiveOffers');
    expect(agentic.investigation?.llmCalls).toBe(1);
    expect(agentic.investigation?.runId).toBeTruthy();

    // The LLM layer must NOT change authoritative targeting output.
    expect(agentic.targetingSource).toBe(deterministic.targetingSource);
    expect(agentic.targetingReason).toBe(deterministic.targetingReason);
    expect(agentic.targets).toEqual(deterministic.targets);
    expect(agentic.offerDraft).toEqual(deterministic.offerDraft);
    expect(agentic.nextActions).toEqual(deterministic.nextActions);
  });

  it('agentic + LLM FAILURE → deterministic fallback: identical result, failure recorded on investigation', async () => {
    const deterministic = await runMarketingAgentDeterministic({ tenant: tenantR1 });
    const agentic = await runMarketingAgent({ tenant: tenantR1 }, { agentic: true, llm: failingLlm });

    expect(agentic.investigation?.status).toBe('failed');
    expect(agentic.investigation?.status).not.toBe('completed_sufficient');
    expect(agentic.targetingSource).toBe(deterministic.targetingSource);
    expect(agentic.targets).toEqual(deterministic.targets);
    expect(agentic.nextActions).toEqual(deterministic.nextActions);
    // Full response contract preserved for the frontend.
    for (const key of [
      'targetingSource',
      'targetingReason',
      'targetingScope',
      'targets',
      'offerDraft',
      'festivalContext',
      'sportsContext',
      'sportsSignals',
      'competitionContext',
      'competitionSignals',
      'basketContext',
      'demandContext',
      'nextActions',
      'generatedAt',
    ]) {
      expect(agentic).toHaveProperty(key);
    }
  });

  it('agentic + LLM not configured (not_configured kind) → llm_unavailable, ladder untouched', async () => {
    const notConfigured: LoopLlmFn = async () => {
      throw new LlmError('LLM not configured (AI_API_KEY unset)', 'not_configured');
    };
    const agentic = await runMarketingAgent({ tenant: tenantR1 }, { agentic: true, llm: notConfigured });
    expect(agentic.investigation?.status).toBe('llm_unavailable');
    expect(agentic.targetingSource).toBe('NONE');
  });

  it('loop budgets are bounded (maxSteps=1 forces a single LLM call)', async () => {
    let calls = 0;
    const chatty: LoopLlmFn = async () => {
      calls += 1;
      return { value: { needMoreEvidence: true }, model: 'fake-model', provider: 'fake', latencyMs: 1 };
    };
    const result = await runMarketingAgent(
      { tenant: tenantR1 },
      { agentic: true, llm: chatty, loopBudget: { maxSteps: 1, maxToolCalls: 1, durationMs: 4_000 } },
    );
    expect(calls).toBe(1);
    expect(result.investigation?.status).toBe('stopped_max_steps');
    expect(result.targetingSource).toBe('NONE');
  });
});
