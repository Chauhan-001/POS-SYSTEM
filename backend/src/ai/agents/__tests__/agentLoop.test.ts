/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * agentLoop.test.ts — Phase 1 bounded loop acceptance:
 * LLM plans → policy gate → sanitized args → shared executor → observations
 * fed back → safe stop. Budgets (steps/tool calls/deadline/tokens) are
 * enforced, failures never throw (deterministic fallback stays possible),
 * and observability rows are tenant-scoped.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { z } from 'zod';

import { runBoundedAgentLoop, summarizeToolOutput, type LoopLlmFn } from '../loop/agentLoop';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { LlmError, generateJsonWithMeta } from '../../shared/llmClient';
import { config } from '../../../config';
import AIUsageLog from '../../../models/core/AIUsageLog';
import AuditLog from '../../../models/admin/AuditLog';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };

/** Recorded executions of the fake tool — proves who the tenant was. */
const executed: Array<{ args: Record<string, unknown>; tenantId: string; branchId?: string }> = [];

const TEST_POLICY = { agent: 'test_agent', allowedTools: ['testEvidenceTool'] } as const;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  if (!toolRegistry.has('testEvidenceTool')) {
    toolRegistry.register({
      name: 'testEvidenceTool',
      category: 'sales',
      access: 'read',
      meta: { description: 'Phase-1 test evidence tool', source: 'test' },
      inputSchema: z.object({ note: z.string().optional() }).strict(),
      execute: async (input: { note?: string }, ctx: { tenant: { restaurantId: string; branchId?: string } }) => {
        executed.push({ args: input as Record<string, unknown>, tenantId: ctx.tenant.restaurantId, branchId: ctx.tenant.branchId });
        return { available: true, note: input.note ?? null, value: 42 };
      },
    } as any);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  executed.length = 0;
});

const llmReturning = (value: unknown, usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }): LoopLlmFn =>
  vi.fn(async () => ({ value, model: 'fake-model', provider: 'fake', latencyMs: 1, usage }));

describe('bounded agent loop', () => {
  it('plans → executes an allowed tool through the shared executor → stops on sufficient evidence', async () => {
    const llm = llmReturning({
      plan: ['gather evidence'],
      toolCalls: [{ name: 'testEvidenceTool', args: { note: 'x' } }],
      needMoreEvidence: false,
      reason: 'enough',
    });

    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(run.status).toBe('completed_sufficient');
    expect(run.toolCalls).toHaveLength(1);
    expect(run.toolCalls[0].ok).toBe(true);
    expect(run.observations[0].summary).toContain('available=true');
    expect(run.plan).toEqual(['gather evidence']);
    expect(run.budget.stepsUsed).toBe(1);
    expect(run.llm.calls).toBe(1);

    // Observability: one AIUsageLog row for the LLM call + one audit row for the run.
    // Usage rows are attributed to the agent that actually ran (the loop is
    // shared, so TEST_POLICY's agent name is what lands in `feature`).
    const usageRows = await AIUsageLog.find({ feature: TEST_POLICY.agent, requestId: run.runId });
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].totalTokens).toBe(15);
    expect(usageRows[0].restaurantId?.toHexString()).toBe(R1);
    const auditRows = await AuditLog.find({ entityType: 'agent_run', entityId: run.runId });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('TENANT ISOLATION: strips restaurantId from LLM args and injects the server tenant', async () => {
    const llm = llmReturning({
      toolCalls: [{ name: 'testEvidenceTool', args: { note: 'hi', restaurantId: R2, tenantId: R2 } }],
      needMoreEvidence: false,
    });

    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(run.status).toBe('completed_sufficient');
    expect(run.tenant.restaurantId).toBe(R1);
    expect(executed).toHaveLength(1);
    expect(executed[0].tenantId).toBe(R1); // tool saw the AUTHENTICATED tenant
    expect('restaurantId' in executed[0].args).toBe(false); // LLM-supplied tenant key stripped
    expect('tenantId' in executed[0].args).toBe(false);
    expect(run.toolCalls[0].args).not.toHaveProperty('restaurantId');
  });

  it('FAILS CLOSED: a tool outside the policy is never executed (recorded as a policy rejection)', async () => {
    const llm = llmReturning({
      toolCalls: [{ name: 'dropDatabase' }, { name: 'testEvidenceTool', args: {} }],
      needMoreEvidence: false,
    });

    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(run.status).toBe('completed_sufficient');
    expect(run.rejections).toHaveLength(1);
    expect(run.rejections[0]).toMatchObject({ ref: 'dropDatabase', stage: 'policy' });
    expect(run.toolCalls.map((t) => t.tool)).toEqual(['testEvidenceTool']); // only the allowed one ran
    expect(executed).toHaveLength(1);
  });

  it('stops at the MAX TOOL CALL budget', async () => {
    const llm = llmReturning({ toolCalls: [{ name: 'testEvidenceTool', args: {} }], needMoreEvidence: true });
    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm,
      budget: { maxToolCalls: 2, maxSteps: 5 },
    });

    expect(run.status).toBe('stopped_max_tool_calls');
    expect(run.toolCalls).toHaveLength(2);
    expect(run.rejections.some((r) => r.stage === 'budget')).toBe(true);
  });

  it('a STOP GUARD defers a premature stop once and the model decides again', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({
        value: { toolCalls: [{ name: 'testEvidenceTool' }], needMoreEvidence: false },
        model: 'fake-model',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        value: { toolCalls: [], needMoreEvidence: false },
        model: 'fake-model',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
    let objections = 0;

    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm: llm as unknown as LoopLlmFn,
      stopGuard: () => {
        objections += 1;
        return objections === 1 ? 'the baseline was never read' : null;
      },
    });

    expect(run.status).toBe('completed_sufficient');
    expect(run.budget.stepsUsed).toBe(2);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(run.uncertainties.some((u) => u.reason.includes('stop_deferred'))).toBe(true);
  });

  it('a STOP GUARD is bounded by maxSteps (never an infinite loop)', async () => {
    const llm = llmReturning({ toolCalls: [], needMoreEvidence: false });
    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm,
      budget: { maxSteps: 1 },
      stopGuard: () => 'always objects',
    });

    expect(run.status).toBe('stopped_max_steps');
    expect(run.error?.code).toBe('stop_guard');
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('stops at MAX STEPS and feeds observations back into each subsequent prompt', async () => {
    const prompts: string[] = [];
    const llm: LoopLlmFn = vi.fn(async (req) => {
      prompts.push(req.prompt);
      return { value: { toolCalls: [], needMoreEvidence: true }, model: 'fake-model', provider: 'fake', latencyMs: 1 };
    });

    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'grow lunch sales',
      tenant: tenantR1,
      llm,
      budget: { maxSteps: 2 },
    });

    expect(run.status).toBe('stopped_max_steps');
    expect(run.budget.stepsUsed).toBe(2);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toContain('Objective: grow lunch sales');
    expect(prompts[1]).toContain('Step 2 of 2');
  });

  it('stops immediately when the wall-clock deadline is already reached (no LLM call)', async () => {
    const llm = llmReturning({ needMoreEvidence: false });
    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm,
      budget: { durationMs: 0 },
    });

    expect(run.status).toBe('stopped_budget');
    expect(llm).not.toHaveBeenCalled();
  });

  it('stops on the TOKEN budget after the spending call', async () => {
    const llm = llmReturning(
      { toolCalls: [], needMoreEvidence: true },
      { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    );
    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm,
      budget: { maxTokens: 10 },
    });

    expect(run.status).toBe('stopped_budget');
    expect(run.error?.code).toBe('token_budget');
    expect(run.budget.tokensUsed).toBe(200);
  });

  it('GRACEFUL LLM FAILURE: typed timeout → status failed, never throws, failure usage row written', async () => {
    const failing: LoopLlmFn = vi.fn(async () => {
      throw new LlmError('LLM request timed out', 'timeout');
    });

    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm: failing });

    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('timeout');
    const usageRows = await AIUsageLog.find({ feature: TEST_POLICY.agent, requestId: run.runId, success: false });
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].errorType).toBe('timeout');
  });

  it('GRACEFUL LLM FAILURE: unexpected error → contained as status failed (never throws)', async () => {
    const failing: LoopLlmFn = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm: failing });
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('http_error');
  });

  it('LLM NOT CONFIGURED (default client path) → llm_unavailable, zero LLM calls', async () => {
    const key = config.ai.apiKey;
    const fallbackKeys = config.ai.fallbackApiKeys;
    config.ai.apiKey = '';
    // The client's key pool includes the env fallbacks, so "not configured"
    // now means an EMPTY pool — clearing only the primary is not enough.
    config.ai.fallbackApiKeys = [];
    try {
      const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1 });
      expect(run.status).toBe('llm_unavailable');
      expect(run.error?.code).toBe('not_configured');
      expect(run.llm.calls).toBe(0);
      const rows = await AIUsageLog.find({ requestId: run.runId, errorType: 'not_configured' });
      expect(rows).toHaveLength(1);
    } finally {
      config.ai.apiKey = key;
      config.ai.fallbackApiKeys = fallbackKeys;
    }
  });

  it('invalid LLM decisions twice in a row → failed with invalid_plan (bounded, no infinite retry)', async () => {
    const llm = llmReturning('definitely not a plan object');
    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('invalid_plan');
    expect(llm).toHaveBeenCalledTimes(2);
    expect(run.uncertainties.filter((u) => u.reason.startsWith('llm_invalid_plan'))).toHaveLength(2);
  });

  it('PROVIDER JSON-VALIDATION 400 → ONE bounded retry, then the plan succeeds', async () => {
    // Reproduces the live Groq-style failure: JSON mode returns HTTP 400 when
    // the model emits invalid JSON. That is retryable, but only once.
    let calls = 0;
    const llm: LoopLlmFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new LlmError(
          'LLM request failed (HTTP 400) — invalid_request_error: Failed to validate JSON.',
          'http_error',
          400,
        );
      }
      return {
        value: { toolCalls: [{ name: 'testEvidenceTool', args: { note: 'retry' } }], needMoreEvidence: false },
        model: 'fake-model', provider: 'fake', latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    });

    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(llm).toHaveBeenCalledTimes(2);
    expect(executed).toHaveLength(1);
    expect(executed[0].tenantId).toBe(R1);
    expect(run.uncertainties.some((u) => u.reason.startsWith('llm_json_validation_retry'))).toBe(true);
    expect(run.status).not.toBe('failed');
  });

  it('non-retryable provider errors (401) are NOT retried', async () => {
    const llm: LoopLlmFn = vi.fn(async () => {
      throw new LlmError('LLM request failed (HTTP 401) — invalid_api_key', 'http_error', 401);
    });
    const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1, llm });

    expect(llm).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('http_error');
  });

  it('an unregistered policy entry fails the run closed before any LLM call', async () => {
    const llm = llmReturning({ needMoreEvidence: false });
    const run = await runBoundedAgentLoop({
      policy: { agent: 'broken', allowedTools: ['toolThatIsNotRegistered'] },
      objective: 'obj',
      tenant: tenantR1,
      llm,
    });

    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('policy_resolution_failed');
    expect(llm).not.toHaveBeenCalled();
  });

  it('working memory stays typed and empty slots stay empty (no Phase-2/4 data)', async () => {
    const run = await runBoundedAgentLoop({
      policy: TEST_POLICY,
      objective: 'obj',
      tenant: tenantR1,
      llm: llmReturning({ needMoreEvidence: false }),
    });
    expect(run.candidates).toEqual([]);
    expect(run.signals).toEqual([]);
    expect(typeof run.runId).toBe('string');
    expect(run.startedAt).toBeTruthy();
    expect(run.endedAt).toBeTruthy();
  });
});

describe('observation compaction', () => {
  it('keeps headline keys and clips long payloads (no raw datasets into prompts)', () => {
    const big = { available: true, reason: null, rows: new Array(200).fill(0).map((_, i) => ({ id: i, name: `row-${i}` })) };
    const summary = summarizeToolOutput(big);
    expect(summary).toContain('available=true');
    expect(summary.length).toBeLessThan(800);
    expect(summarizeToolOutput(null)).toBe('no data');
    expect(summarizeToolOutput(7)).toBe('7');
  });
});

describe('default client wiring', () => {
  it('uses the shared llmClient when no test seam is provided (contract check, no network)', async () => {
    // With an EMPTY key pool (primary + fallbacks cleared) the shared client
    // reports not_configured → loop degrades to llm_unavailable WITHOUT any
    // network I/O.
    const key = config.ai.apiKey;
    const fallbackKeys = config.ai.fallbackApiKeys;
    config.ai.apiKey = '';
    config.ai.fallbackApiKeys = [];
    try {
      const run = await runBoundedAgentLoop({ policy: TEST_POLICY, objective: 'obj', tenant: tenantR1 });
      expect(run.status).toBe('llm_unavailable');
    } finally {
      config.ai.apiKey = key;
      config.ai.fallbackApiKeys = fallbackKeys;
    }
    expect(typeof generateJsonWithMeta).toBe('function');
  });
});
