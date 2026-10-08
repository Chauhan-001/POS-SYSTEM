/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inventoryAgentic.test.ts — Phase 1 acceptance for the REAL agentic inventory
 * agent: the LLM selects read-only inventory tools through the shared bounded
 * loop + registry, the EXISTING deterministic analyzer consumes those exact
 * observations, and the structured assessment is validated server-side.
 *
 * Covers the required scenarios:
 *   1 status → stop            2 status → stockout     3 expiry → status → wastage
 *   4 invented quantity rejected   5 write tool rejected   6 LLM unavailable
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { floorSeverity, inventoryBaselineStopGuard, runInventoryAgentic } from '../inventoryAgentic';
import type { InventoryAgentResult } from '../inventoryAgent';
import { runBoundedAgentLoop, type LoopLlmFn } from '../loop/agentLoop';
import {
  inventoryAgentPolicy,
  INVENTORY_AGENT_ALLOWED_TOOLS,
  INVENTORY_AGENT_PROMPT_VERSION,
  resolveInventoryAgentTools,
} from '../policies/inventoryAgentPolicy';
import { ai } from '../../index';
import Product from '../../../models/catalog/Product';
import AIUsageLog from '../../../models/core/AIUsageLog';
import AuditLog from '../../../models/admin/AuditLog';
import { config } from '../../../config';
import { LlmError } from '../../shared/llmClient';

let mongod: MongoMemoryServer;

const TENANT_A = '507f1f77bcf86cd799439011';
const TENANT_B = '507f1f77bcf86cd799439022';
const FOREIGN_BRANCH = '507f1f77bcf86cd7994390bb';
const tenantA = { restaurantId: TENANT_A, actorId: 'actor-1' };

/** One scripted LLM decision. */
interface Script {
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  needMoreEvidence: boolean;
  plan?: string[];
}

/** Deterministic fake LLM — proves tool selection is driven by the model. */
function scriptedLlm(scripts: Script[]): LoopLlmFn {
  let index = 0;
  const fn = vi.fn(async () => {
    const script = scripts[Math.min(index, scripts.length - 1)];
    index += 1;
    return {
      value: {
        plan: script.plan ?? ['investigate'],
        toolCalls: script.toolCalls ?? [],
        needMoreEvidence: script.needMoreEvidence,
        reason: 'scripted',
      },
      model: 'fake-model',
      provider: 'fake',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  });
  return fn as unknown as LoopLlmFn;
}

/** Synthetic synthesis call (never hits a provider). */
const synthesisReturning = (value: unknown) => async () => ({
  value,
  model: 'fake-synth',
  provider: 'fake',
  latencyMs: 1,
  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
});

const goodSynthesis = {
  assessment: { title: 'Rice needs attention', summary: 'Stock is below the minimum level.', priority: 'high' },
  issues: [
    { type: 'low_stock', itemName: 'Rice', severity: 'high', evidenceRefs: ['getInventoryStatus'], explanation: 'Rice is below its minimum stock level.' },
  ],
  recommendations: [
    { actionType: 'reorder', itemName: 'Rice', rationale: 'Confirm the reorder quantity before creating a purchase order.', evidenceRefs: ['getInventoryStatus'] },
  ],
  confidence: 0.7,
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap(); // registers the real tools into the ONE shared registry
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Scope every cleanup to THIS tenant: mongoose keeps a single process-wide
  // connection, so a global deleteMany would wipe rows other test files wrote.
  const tenantOid = new mongoose.Types.ObjectId(TENANT_A);
  await Product.deleteMany({ restaurantId: tenantOid });
  await AIUsageLog.deleteMany({ restaurantId: tenantOid });
  await AuditLog.deleteMany({ restaurantId: TENANT_A });
  // One low-stock item so the deterministic analyzer has an authoritative row.
  await Product.create({
    restaurantId: TENANT_A,
    name: 'Rice',
    code: 'RICE',
    price: 0,
    category: 'Raw material',
    currentStock: 2,
    minStock: 5,
    maxStock: 20,
    unit: 'kg',
    averageCost: 40,
  });
});

describe('inventory agent policy', () => {
  it('A/C: allow-list is the authoritative + extended read-only inventory surface and resolves fail-closed', () => {
    expect([...INVENTORY_AGENT_ALLOWED_TOOLS]).toEqual([
      'getInventoryStatus',
      'getStockoutRisk',
      'getExpiryRisk',
      'getWastage',
      'getDemandForecast',
      'getSalesTrends',
      'getMenuPerformance',
      'getProductMargins',
      'getProductCombinations',
      'getFestivalContext',
      'getSportsContext',
    ]);
    const resolved = resolveInventoryAgentTools();
    expect(resolved.map((t) => t.name).sort()).toEqual([...INVENTORY_AGENT_ALLOWED_TOOLS].sort());
    expect(resolved.every((t) => t.access === 'read')).toBe(true);
    expect(inventoryAgentPolicy.agent).toBe('inventory_agent');
  });

  it('Extended surface: the model may investigate with the ML demand forecast and context tools', async () => {
    const seenPrompts: string[] = [];
    const capturingSynthesis = async (req: { prompt: string }) => {
      seenPrompts.push(req.prompt);
      return {
        value: {
          ...goodSynthesis,
          issues: [
            {
              type: 'stockout_risk',
              itemName: 'Rice',
              severity: 'high',
              evidenceRefs: ['getInventoryStatus', 'getDemandForecast'],
              explanation: 'Rice is below its minimum stock level and the demand outlook should be monitored.',
            },
          ],
        },
        model: 'fake-synth',
        provider: 'fake',
        latencyMs: 1,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      };
    };
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Why is demand changing and which items should I prepare for?',
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: true },
          {
            toolCalls: [
              { name: 'getDemandForecast' },
              { name: 'getSalesTrends' },
              { name: 'getFestivalContext' },
            ],
            needMoreEvidence: false,
          },
        ]) as never,
        synthesisLlm: capturingSynthesis,
      },
    );

    // All five tool calls ran — core baseline + the extended surface.
    expect(result.toolsUsed).toEqual(['getInventoryStatus', 'getDemandForecast', 'getSalesTrends', 'getFestivalContext']);
    expect(result.investigation.steps.map((s) => s.tool)).toEqual([
      'getInventoryStatus',
      'getDemandForecast',
      'getSalesTrends',
      'getFestivalContext',
    ]);
    // The ML forecast ran against an empty prediction store, so it is honestly
    // "checked but unavailable" — never treated as evidence of healthy demand.
    expect(result.toolAvailability?.getDemandForecast).toBe(false);
    expect(result.toolAvailability?.getInventoryStatus).toBe(true);
    // An unsupported claim (forecast had NO data) is dropped, not smuggled in.
    expect(result.issues.every((i) => i.evidenceRefs.length > 0)).toBe(true);
    expect(result.mode).toBe('agentic');
    // The synthesis call received the extended observations as bounded facts.
    expect(seenPrompts).toHaveLength(1);
    expect(seenPrompts[0]).toContain('contextSignals');
    expect(seenPrompts[0]).toContain('getDemandForecast');
    expect(seenPrompts[0]).toContain('available');
  });

  it('E/5: a write tool the model asks for is REJECTED by policy and never executed', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Adjust stock for rice',
        llm: scriptedLlm([{ toolCalls: [{ name: 'adjustStockTool', args: { qty: 10 } }], needMoreEvidence: false }]),
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    // No LLM-selected tool ran; the deterministic fallback executed its own four
    // read-only tools, and `toolsUsed` reports exactly that.
    expect(result.toolsUsed).toEqual(['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage']);
    expect(result.investigation.rejections.map((r) => r.ref)).toContain('adjustStockTool');
    expect(result.investigation.rejections[0].stage).toBe('policy');
    // No write tool can be executed because none exists in the registry.
    expect(result.mode).toBe('deterministic_fallback');
  });

  it('C/D: tenant args are stripped and a foreign branch fails safely at the tool boundary', async () => {
    const run = await runBoundedAgentLoop({
      policy: inventoryAgentPolicy as never,
      objective: 'probe',
      tenant: tenantA,
      captureToolData: true,
      llm: scriptedLlm([
        {
          toolCalls: [
            { name: 'getInventoryStatus', args: { restaurantId: TENANT_B, branchId: FOREIGN_BRANCH } },
          ],
          needMoreEvidence: false,
        },
      ]),
    });

    // The LLM-supplied tenant key never reaches the tool.
    expect(run.toolCalls[0].args).not.toHaveProperty('restaurantId');
    // The foreign branch is rejected by the tool's own tenant check.
    expect(run.toolCalls[0].ok).toBe(false);
    expect(run.toolCalls[0].code).toBe('TOOL_TENANT_MISMATCH');
  });
});

describe('agentic investigation scenarios', () => {
  it('1: LLM chooses getInventoryStatus and stops → single-tool answer', async () => {
    const llm = scriptedLlm([
      { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false },
    ]);
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      { task: 'What inventory risks should I handle today?', llm: llm as never, synthesisLlm: synthesisReturning(goodSynthesis) },
    );

    expect(result.mode).toBe('agentic');
    expect(result.toolsUsed).toEqual(['getInventoryStatus']);
    expect(result.evidenceSources.inventory).toBe(true);
    expect(result.evidenceSources.expiry).toBe(false);
    expect(result.purchaseRecommendations.length).toBeGreaterThan(0);
    expect((llm as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('2: status → stockout → recommendation grounded in BOTH tools', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which items are likely to stock out soon?',
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: true },
          { toolCalls: [{ name: 'getStockoutRisk', args: { horizonDays: 14 } }], needMoreEvidence: false },
        ]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          issues: [
            { type: 'low_stock', itemName: 'Rice', severity: 'high', evidenceRefs: ['getInventoryStatus', 'getStockoutRisk'], explanation: 'Rice is below minimum stock.' },
          ],
          recommendations: [
            { actionType: 'reorder', itemName: 'Rice', rationale: 'Replenish before depletion.', evidenceRefs: ['getInventoryStatus', 'getStockoutRisk'] },
          ],
        }),
      },
    );

    expect(result.toolsUsed).toEqual(['getInventoryStatus', 'getStockoutRisk']);
    expect(result.investigation.steps.map((s) => s.tool)).toEqual(['getInventoryStatus', 'getStockoutRisk']);
    expect(result.issues[0].evidenceRefs).toContain('getStockoutRisk');
    expect(result.recommendations[0].evidenceRefs).toContain('getInventoryStatus');
  });

  it('3: expiry → status → wastage order is the LLM\'s own choice (not a ladder)', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getExpiryRisk', args: { horizonDays: 30 } }], needMoreEvidence: true },
          { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: true },
          { toolCalls: [{ name: 'getWastage', args: { days: 60 } }], needMoreEvidence: false },
        ]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.toolsUsed).toEqual(['getExpiryRisk', 'getInventoryStatus', 'getWastage']);
    expect(result.investigation.stepsUsed).toBe(3);
    expect(result.assessment).not.toBeNull();
  });

  it('4: an invented reorder quantity never becomes authoritative', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What should I reorder first?',
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false },
        ]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          recommendations: [
            {
              actionType: 'reorder',
              itemName: 'Rice',
              // The model invents 500 — the deterministic row says otherwise.
              rationale: 'Reorder 500 kg of Rice immediately.',
              evidenceRefs: ['getInventoryStatus'],
            },
          ],
          assessment: { title: 'Rice', summary: 'Order 500 kg of rice now.', priority: 'critical' },
        }),
      },
    );

    const rec = result.recommendations[0];
    expect(rec.authoritative?.suggestedQty).toBeDefined();
    expect(rec.authoritative!.suggestedQty).not.toContain('500');
    expect(rec.rationale).not.toContain('500');
    expect(rec.authoritative!.suggestedQty).toBe(result.purchaseRecommendations[0].suggestedQty);
    expect(rec.requiresApproval).toBe(true);
  });

  it('K/M: evidence refs must name tools that actually ran, and each item keeps refs', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which inventory issue needs attention most?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          // Claims evidence from a tool that was never called.
          issues: [
            { type: 'expiry_risk', itemName: 'Rice', severity: 'critical', evidenceRefs: ['getExpiryRisk'], explanation: 'Rice expires soon.' },
          ],
        }),
      },
    );

    // The mis-cited ref is REPAIRED to the tool that actually ran (recorded as
    // such), so the row survives without inventing evidence.
    expect(result.issues.some((i) => i.evidenceRefs.includes('getExpiryRisk'))).toBe(false);
    for (const i of result.issues) {
      expect(i.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of i.evidenceRefs) expect(result.toolsUsed).toContain(ref);
    }
    expect(result.degradedReason).toContain('synthesis_partially_rejected');
    expect(result.degradedReason).toContain('ref_repaired');
  });

  it('G/H: a TOOL FAILURE degrades safely, is reported, and fabricates no data', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([
          {
            // horizonDays is out of the tool's declared range (1–90) → the
            // shared executor refuses the call (input validation failure).
            toolCalls: [{ name: 'getExpiryRisk', args: { horizonDays: 999 } }, { name: 'getInventoryStatus' }],
            needMoreEvidence: false,
          },
        ]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    const failed = result.investigation.steps.find((s) => s.tool === 'getExpiryRisk');
    expect(failed?.ok).toBe(false);
    // Only the successful observation feeds the analyzer; nothing is invented.
    expect(result.toolsUsed).toEqual(['getInventoryStatus']);
    expect(result.expiryRisks).toEqual([]);
    expect(result.evidenceSources.expiry).toBe(false);
  });

  it('J: malformed synthesis falls back to the deterministic assessment (no broken output)', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({ nonsense: true }),
      },
    );

    expect(result.mode).toBe('agentic');
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('synthesis_invalid_schema');
    expect(result.assessment?.summary).toBe(result.summary);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('6/I: LLM unavailable → existing deterministic agent result with explicit fallback mode', async () => {
    const key = config.ai.apiKey;
    const fallbackKeys = config.ai.fallbackApiKeys;
    config.ai.apiKey = '';
    // An empty POOL is what "LLM unavailable" means now — the client rotates
    // through AI_API_KEY_FALLBACK(S) as well, so the primary alone is not it.
    config.ai.fallbackApiKeys = [];
    try {
      const result = await runInventoryAgentic({ tenant: tenantA }, { task: 'What inventory risks should I handle today?' });

      expect(result.mode).toBe('deterministic_fallback');
      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain('llm_unavailable');
      // The deterministic agent still produced the authoritative data.
      expect(result.evidenceSources.inventory).toBe(true);
      expect(result.purchaseRecommendations.length).toBeGreaterThan(0);
      // The deterministic fallback executed its own four read-only tools.
      expect(result.toolsUsed).toEqual(['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage']);
    } finally {
      config.ai.apiKey = key;
      config.ai.fallbackApiKeys = fallbackKeys;
    }
  });

  it('P: maxToolCalls is enforced — extra tool requests are refused', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        loopBudget: { maxToolCalls: 1 },
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getInventoryStatus' }, { name: 'getStockoutRisk' }], needMoreEvidence: false },
        ]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.investigation.toolCallsUsed).toBeLessThanOrEqual(1);
    expect(result.toolsUsed).toHaveLength(1);
  });

  it('O: observability rows are written for the inventory agent', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        requestId: 'inv-req-1',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    const usage = await AIUsageLog.find({ requestId: result.investigation.runId });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0].feature).toBe('inventory_agent');
    expect(usage[0].success).toBe(true);

    const audit = await AuditLog.findOne({ entityId: result.investigation.runId });
    expect(audit).toBeTruthy();
    expect((audit!.details as { agent?: string }).agent).toBe('inventory_agent');
    // No payloads/chain-of-thought persisted.
    expect(JSON.stringify(audit!.details)).not.toContain('chain');
  });

  it('returns no chain-of-thought, only structured decision metadata', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which items are likely to stock out soon?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.investigation.steps[0]).toMatchObject({
      tool: 'getInventoryStatus',
      purpose: expect.any(String),
    });
    expect(Object.keys(result.investigation.steps[0]).sort()).toEqual(['durationMs', 'ok', 'purpose', 'tool']);
  });

  it('N: the deterministic result shape stays the contract for agentic runs', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    // Existing fields (consumed by current callers) remain present and authoritative.
    expect(result.status).toBe('ready');
    expect(typeof result.summary).toBe('string');
    expect(Array.isArray(result.purchaseRecommendations)).toBe(true);
    expect(Array.isArray(result.stockoutPredictions)).toBe(true);
    expect(Array.isArray(result.expiryRisks)).toBe(true);
    expect(Array.isArray(result.wastageSignals)).toBe(true);
    expect(Array.isArray(result.nextActions)).toBe(true);
    expect(result.evidenceSources).toBeTruthy();
    expect(result.generatedAt).toBeTruthy();
  });

  it('budget Q: exceeding maxSteps stops the loop safely', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Investigate everything',
        loopBudget: { maxSteps: 1 },
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: true }]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.investigation.stepsUsed).toBe(1);
    expect(result.mode).toBe('agentic');
  });

  it('fallback evidence refs only name tools that actually ran', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Why is wastage a concern?',
        // Only getWastage is investigated by the LLM, and synthesis fails →
        // the deterministic fallback supplies the rows and its own tool set.
        llm: scriptedLlm([{ toolCalls: [{ name: 'getWastage' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({ nonsense: true }),
      },
    );
    expect(result.mode).toBe('agentic'); // tools ran agentically; only synthesis degraded

    // The fallback runs the deterministic tools; the invariant that matters is
    // that every ref names a tool that actually ran.
    for (const issue of result.issues) {
      expect(issue.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of issue.evidenceRefs) expect(result.toolsUsed).toContain(ref);
    }
    for (const rec of result.recommendations) {
      for (const ref of rec.evidenceRefs) expect(result.toolsUsed).toContain(ref);
    }
  });

  it('fallback issues reflect the authoritative reorder findings, not a blanket "no risk"', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What should I reorder first?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({ broken: true }),
      },
    );

    expect(result.purchaseRecommendations.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'low_stock' || i.type === 'out_of_stock')).toBe(true);
    expect(result.issues.some((i) => i.type === 'no_immediate_risk')).toBe(false);
  });

  it('a retryable provider JSON 400 on synthesis is retried ONCE and still ships agentically', async () => {
    let calls = 0;
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: (async () => {
          calls += 1;
          if (calls === 1) {
            throw new LlmError('Failed to validate JSON. Please adjust your prompt.', 'http_error', 400);
          }
          return { value: goodSynthesis, model: 'fake-synth', provider: 'fake', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
        }) as never,
      },
    );

    expect(calls).toBe(2);
    expect(result.mode).toBe('agentic');
    expect(result.degraded).toBe(false);
    expect(result.assessment?.title).toBe('Rice needs attention');
  });

  it('a NON-retryable synthesis failure degrades without retrying', async () => {
    let calls = 0;
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: (async () => {
          calls += 1;
          throw new LlmError('rate limited', 'rate_limited');
        }) as never,
      },
    );

    expect(calls).toBe(1);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('synthesis_rate_limited');
    // The deterministic rows still ship, grounded in the tools that ran.
    expect(result.purchaseRecommendations.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.evidenceRefs.every((r) => result.toolsUsed.includes(r)))).toBe(true);
  });

  it('an empty evidence set reports data_unavailable — never "no_immediate_risk"', async () => {
    await Product.deleteMany({ restaurantId: new mongoose.Types.ObjectId(TENANT_A) });
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getExpiryRisk' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({ nonsense: true }),
      },
    );

    expect(result.status).toBe('insufficient_data');
    expect(result.issues.some((i) => i.type === 'data_unavailable')).toBe(true);
    expect(result.issues.some((i) => i.type === 'no_immediate_risk')).toBe(false);
    expect(result.assessment?.title.toLowerCase()).toContain('unavailable');
  });

  it('a long issue list is capped, not voided, and the cap is recorded', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      type: 'low_stock',
      itemName: 'Rice',
      severity: 'high',
      evidenceRefs: ['getInventoryStatus'],
      explanation: `Finding ${i + 1} about Rice.`,
    }));
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({ ...goodSynthesis, issues: many }),
      },
    );

    expect(result.mode).toBe('agentic');
    expect(result.degraded).toBe(false);
    expect(result.issues).toHaveLength(8);
    expect(result.degradedReason).toContain('truncated');
  });

  it('the synthesis facts distinguish NOT-investigated sources from empty ones', async () => {
    let prompt = '';
    await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getExpiryRisk' }], needMoreEvidence: false }]) as never,
        synthesisLlm: (async (req: { prompt: string }) => {
          prompt = req.prompt;
          return { value: goodSynthesis, model: 'fake-synth', provider: 'fake', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
        }) as never,
      },
    );

    // Empty because the tool ran and found nothing...
    expect(prompt).toContain('"expiryRisk":{"investigated":true,"available":false');
    // ...is a different statement from "never looked at".
    expect(prompt).toContain('"inventoryStatus":{"investigated":false');
  });

  it('D2/B: a row without evidence refs is dropped, and the deterministic floor still ships', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          assessment: { title: 'Inventory', summary: 'Stock is low for Rice.', priority: 'normal' },
          issues: [{ type: 'low_stock', itemName: 'Rice', severity: 'high', explanation: 'Rice is low.' }],
          recommendations: [{ actionType: 'reorder', itemName: 'Rice', rationale: 'Reorder it.' }],
          confidence: 0.5,
        }),
      },
    );

    // The model's UNSUPPORTED row (no evidenceRefs) never ships as-is…
    expect(result.issues.some((i) => i.explanation === 'Rice is low.')).toBe(false);
    expect(result.recommendations.some((r) => r.rationale === 'Reorder it.')).toBe(false);
    expect(result.degradedReason).toContain('missing_evidence_ref');
    // …but D2 keeps the authoritative deterministic row the model failed to cite.
    expect(result.issues.map((i) => i.explanation)).toContain('Below minimum stock (2 of 5 kg).');
    expect(result.recommendations[0].actionType).toBe('reorder');
    expect(result.recommendations[0].authoritative?.suggestedQty).toBeDefined();
  });

  it('the baseline stop guard objects only when an empty source is unaccompanied by a real baseline read', () => {
    const toolData = [{ step: 1, tool: 'getExpiryRisk', ok: true, data: { available: false, reason: 'NO_EXPIRY_RISK' } }];
    expect(
      inventoryBaselineStopGuard({ toolCalls: [{ tool: 'getExpiryRisk', ok: true }], toolData } as never),
    ).toContain('getInventoryStatus');
    // The baseline WAS read → the model may conclude.
    expect(
      inventoryBaselineStopGuard({
        toolCalls: [{ tool: 'getExpiryRisk', ok: true }, { tool: 'getInventoryStatus', ok: true }],
        toolData,
      } as never),
    ).toBeNull();
    // A FAILED baseline read is not an inspection.
    expect(
      inventoryBaselineStopGuard({ toolCalls: [{ tool: 'getInventoryStatus', ok: false }], toolData } as never),
    ).toContain('getInventoryStatus');
    // Nothing came back empty → nothing to object to.
    expect(
      inventoryBaselineStopGuard({
        toolCalls: [],
        toolData: [{ step: 1, tool: 'getWastage', ok: true, data: { available: true } }],
      } as never),
    ).toBeNull();
  });

  it('an empty tool result defers the model\'s stop so it can read the authoritative baseline', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which items are likely to stock out soon?',
        llm: scriptedLlm([
          // Step 1: the model picks the specialist tool and wants to stop…
          { toolCalls: [{ name: 'getExpiryRisk' }], needMoreEvidence: false },
          // …the guard objects, so it gets one more step and chooses the baseline.
          { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false },
        ]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.investigation.stepsUsed).toBe(2);
    expect(result.investigation.status).toBe('completed_sufficient');
    expect(result.toolsUsed).toEqual(['getExpiryRisk', 'getInventoryStatus']);
    // The authoritative reorder rows now exist, so "no risk" cannot be claimed.
    expect(result.purchaseRecommendations.length).toBeGreaterThan(0);
  });

  it('the planner prompt is the INVENTORY agent and the synthesis prompt carries the exact ref vocabulary', async () => {
    let loopSystem = '';
    let synthesisSystem = '';
    const loopLlm = (async (req: { system: string }) => {
      loopSystem = req.system;
      return {
        value: { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false },
        model: 'fake',
        provider: 'fake',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    }) as unknown as LoopLlmFn;
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: loopLlm,
        synthesisLlm: (async (req: { system: string }) => {
          synthesisSystem = req.system;
          return {
            value: goodSynthesis,
            model: 'fake-synth',
            provider: 'fake',
            usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          };
        }) as never,
      },
    );

    // The model is prompted as the inventory agent — not the marketing planner.
    expect(loopSystem).toContain('Inventory Agent');
    expect(loopSystem).not.toContain('Marketing Intelligence');
    // An empty specialist tool must not be read as "stock is healthy".
    expect(loopSystem).toContain('authoritative CURRENT baseline');
    // Synthesis may only cite tools that ran.
    expect(synthesisSystem).toContain('may contain ONLY these exact tool names');
    expect(synthesisSystem).toContain('getInventoryStatus');
    expect(result.mode).toBe('agentic');
    expect(result.degraded).toBe(false);
  });

  it('L: a model sentence with an unsupported number is stripped, not shown', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Why is wastage a concern?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          assessment: { title: 'Inventory', summary: 'You lost 9876 units last month.', priority: 'normal' },
        }),
      },
    );

    expect(result.assessment!.summary).not.toContain('9876');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Post-audit correctness remediation (D1–D8)
// ───────────────────────────────────────────────────────────────────────────
describe('post-audit correctness remediation (D1–D8)', () => {
  it('D1/A: an unavailable expiry source can never become "no expiry risk"', async () => {
    const runWith = (summary: string) =>
      runInventoryAgentic(
        { tenant: tenantA },
        {
          task: 'Which ingredients are close to expiry?',
          // Only the baseline is read → expiry was never investigated/available.
          llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
          synthesisLlm: synthesisReturning({
            ...goodSynthesis,
            assessment: { title: 'Check', summary, priority: 'normal' },
          }),
        },
      );

    // Whole-sentence all-clear → replaced by an explicit uncertainty statement.
    const allClear = await runWith('No ingredients are close to expiry.');
    expect(allClear.assessment!.summary).not.toMatch(/close to expiry/i);
    expect(allClear.assessment!.summary).toBe('Expiry status could not be determined from the available data.');

    // Mixed sentence: only the unsupported claim is removed.
    const mixed = await runWith('No ingredients are close to expiry. Rice is below its minimum stock.');
    expect(mixed.assessment!.summary).not.toMatch(/close to expiry/i);
    expect(mixed.assessment!.summary).toContain('Rice');
  });

  it('D2/B: an empty model list cannot hide the authoritative deterministic rows', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          assessment: { title: 'Nothing to show', summary: 'Stock is below the minimum level.', priority: 'low' },
          issues: [],
          recommendations: [],
          confidence: 0.9,
        }),
      },
    );

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'low_stock' && i.itemName === 'Rice')).toBe(true);
    expect(result.recommendations[0].actionType).toBe('reorder');
    expect(result.degradedReason).toContain('synthesisCoverage');
  });

  it('D3/C: authoritative stock / minimum / maximum / cost numbers survive grounding', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'How much stock do I have?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          assessment: {
            title: 'Stock check',
            summary: 'Current stock is 2 kg, below the minimum of 5 kg and the maximum of 20 kg. Average cost is 40 per unit.',
            priority: 'medium',
          },
        }),
      },
    );

    const summary = result.assessment!.summary;
    expect(summary).toContain('2 kg'); // stock quantity
    expect(summary).toContain('5'); // minimum stock
    expect(summary).toContain('20'); // maximum stock
    expect(summary).toContain('40'); // cost
    expect(summary).not.toMatch(/below the minimum of\s*(?:kg|$)/i);
  });

  it('D3/D: unsupported numbers are removed while supported values remain', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'How much stock do I have?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          assessment: {
            title: 'Stock check',
            summary: 'Rice stock is 2 kg, but 9876 units and 77% were lost. Average cost is 40 per unit.',
            priority: 'medium',
          },
        }),
      },
    );

    const summary = result.assessment!.summary;
    expect(summary).not.toContain('9876'); // never in the evidence
    expect(summary).not.toContain('77'); // no percentage is authoritative here
    expect(summary).toContain('2 kg'); // authoritative stock value survives
    expect(summary).toContain('40'); // authoritative cost survives
  });

  it('D4/E: the synthesis LLM call is written to AIUsageLog (one row per run)', async () => {
    const version = `${INVENTORY_AGENT_PROMPT_VERSION}-synthesis`;
    const before = await AIUsageLog.countDocuments({ feature: 'inventory_agent', promptVersion: version });

    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    const after = await AIUsageLog.countDocuments({ feature: 'inventory_agent', promptVersion: version });
    expect(after).toBe(before + 1);

    const row = await AIUsageLog.findOne({ requestId: result.investigation.runId, promptVersion: version });
    expect(row).toBeTruthy();
    expect(row!.feature).toBe('inventory_agent');
    expect(row!.success).toBe(true);
    expect(row!.model).toBe('fake-synth');
    expect(row!.totalTokens).toBe(30);
    expect(String(row!.promptHash || '').length).toBeGreaterThan(0);
    // Privacy: the prompt itself is never persisted (hash only).
    expect(JSON.stringify(row)).not.toContain('FACTS (the only allowed');
  });

  it('D4/E: a failed synthesis call is logged as a failed row', async () => {
    const version = `${INVENTORY_AGENT_PROMPT_VERSION}-synthesis`;
    const before = await AIUsageLog.countDocuments({ feature: 'inventory_agent', promptVersion: version, success: false });
    await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: (async () => {
          throw new LlmError('rate limited', 'rate_limited');
        }) as never,
      },
    );
    const after = await AIUsageLog.countDocuments({ feature: 'inventory_agent', promptVersion: version, success: false });
    expect(after).toBe(before + 1);
  });

  it('D5/F: a loop failure AFTER evidence capture is reported as degraded', async () => {
    let calls = 0;
    const llm = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          value: { toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: true },
          model: 'fake',
          provider: 'fake',
          latencyMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      // Step 2: provider failure → the loop terminates as `failed`…
      throw new LlmError('rate limited', 'rate_limited');
    }) as unknown as LoopLlmFn;

    const result = await runInventoryAgentic(
      { tenant: tenantA },
      { task: 'What inventory risks should I handle today?', llm, synthesisLlm: synthesisReturning(goodSynthesis) },
    );

    // …but evidence WAS captured, so the result is a PARTIAL agentic result.
    expect(result.mode).toBe('agentic');
    expect(result.toolsUsed).toEqual(['getInventoryStatus']);
    expect(result.investigation.status).toBe('failed');
    expect(result.investigation.degraded).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('agent_loop_failed_after_evidence');
  });

  it('D6/G: an identical repeated tool call is served from cache, still bounded', async () => {
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([
          { toolCalls: [{ name: 'getExpiryRisk', args: { horizonDays: 30 } }], needMoreEvidence: true },
          {
            toolCalls: [
              { name: 'getExpiryRisk', args: { horizonDays: 30 } }, // identical repeat
              { name: 'getInventoryStatus' },
            ],
            needMoreEvidence: false,
          },
        ]) as never,
        synthesisLlm: synthesisReturning(goodSynthesis),
      },
    );

    expect(result.investigation.steps).toHaveLength(3);
    expect(result.investigation.dedupedCalls).toBe(1); // served, not re-executed
    expect(result.investigation.toolCallsUsed).toBe(3); // still consumes budget
    // Evidence is captured once per unique tool — no duplicate collection.
    expect(result.toolsUsed).toEqual(['getExpiryRisk', 'getInventoryStatus']);
    expect(result.investigation.toolNames).toEqual(['getExpiryRisk', 'getExpiryRisk', 'getInventoryStatus']);
  });

  it('D7/H: an evidence ref must SUPPORT the claim, not merely have "run"', async () => {
    // (a) The capability the claim is about was never investigated.
    const unsupported = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'Which ingredients are close to expiry?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          issues: [
            { type: 'expiry_risk', itemName: 'Rice', severity: 'critical', evidenceRefs: ['getInventoryStatus'], explanation: 'Rice expires soon.' },
          ],
        }),
      },
    );
    expect(unsupported.issues.some((i) => i.type === 'expiry_risk')).toBe(false);
    expect(unsupported.degradedReason).toContain('source_not_investigated');
    // The authoritative row still ships (D2) instead of the unsupported claim.
    expect(unsupported.issues.some((i) => i.type === 'low_stock')).toBe(true);

    // (b) A row citing BOTH a supporting and a non-supporting tool keeps only
    //     the supporting ref.
    const mixed = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What should I reorder?',
        llm: scriptedLlm([
          {
            toolCalls: [{ name: 'getInventoryStatus' }, { name: 'getWastage', args: { days: 60 } }],
            needMoreEvidence: false,
          },
        ]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          issues: [
            {
              type: 'low_stock',
              itemName: 'Rice',
              severity: 'high',
              evidenceRefs: ['getWastage', 'getInventoryStatus'],
              explanation: 'Rice is below minimum stock.',
            },
          ],
        }),
      },
    );
    const row = mixed.issues.find((i) => i.itemName === 'Rice');
    expect(row?.evidenceRefs).toEqual(['getInventoryStatus']);
    expect(mixed.degradedReason).toContain('non_supporting_ref_dropped');
  });

  it('D8/I: severity can never be downgraded below the authoritative severity', async () => {
    const det = (over: Partial<Record<string, unknown>>) =>
      ({
        mode: 'deterministic',
        status: 'ready',
        summary: 's',
        purchaseRecommendations: [],
        stockoutPredictions: [],
        expiryRisks: [],
        wastageSignals: [],
        nextActions: [],
        evidenceSources: { inventory: true, demandForecast: false, expiry: false, wastage: false },
        generatedAt: new Date().toISOString(),
        ...over,
      }) as unknown as InventoryAgentResult;

    const critical = det({
      expiryRisks: [{ itemId: 'i1', itemName: 'Paneer', currentStock: 1, expiryDate: new Date(), daysUntilExpiry: 1, severity: 'critical', canPromote: false, recommendedActions: [] }],
    });
    const high = det({
      stockoutPredictions: [{ item: 'Basmati', daysUntilOut: 1, severity: 'warning', currentStock: 3, unit: 'kg', suggestedAction: 'x' }],
    });
    const medium = det({
      purchaseRecommendations: [{ item: 'Rice', reason: 'below min', suggestedQty: '18 kg', urgency: 'medium', estimatedCost: 720 }],
    });
    const highPurchase = det({
      purchaseRecommendations: [{ item: 'Basmati', reason: 'out of stock', suggestedQty: '30 kg', urgency: 'high', estimatedCost: 2700 }],
    });

    // critical → low is impossible; high → normal is impossible;
    // medium → low is impossible.
    expect(floorSeverity('low', 'expiry_risk', 'Paneer', undefined, critical)).toBe('critical');
    expect(floorSeverity('low', 'stockout_risk', 'Basmati', undefined, high)).toBe('high');
    expect(floorSeverity('low', 'low_stock', 'Rice', undefined, medium)).toBe('medium');
    expect(floorSeverity('low', 'low_stock', 'Basmati', undefined, highPurchase)).toBe('high');
    // The model may RAISE urgency — never lower it.
    expect(floorSeverity('critical', 'low_stock', 'Rice', undefined, medium)).toBe('critical');
    // Informational rows stay informational; unknown rows use a conservative floor.
    expect(floorSeverity('critical', 'no_immediate_risk', undefined, undefined, medium)).toBe('normal');
    expect(floorSeverity('low', 'some_other_observation', undefined, undefined, medium)).toBe('medium');
  });

  it('D8/I: the floor is actually wired into the synthesis (integration)', async () => {
    await Product.create({
      restaurantId: new mongoose.Types.ObjectId(TENANT_A),
      name: 'Basmati',
      code: 'BASMATI',
      price: 0,
      category: 'Raw material',
      currentStock: 0,
      minStock: 5,
      maxStock: 30,
      unit: 'kg',
      averageCost: 90,
    });
    const result = await runInventoryAgentic(
      { tenant: tenantA },
      {
        task: 'What inventory risks should I handle today?',
        llm: scriptedLlm([{ toolCalls: [{ name: 'getInventoryStatus' }], needMoreEvidence: false }]) as never,
        synthesisLlm: synthesisReturning({
          ...goodSynthesis,
          issues: [
            { type: 'low_stock', itemName: 'Rice', severity: 'low', evidenceRefs: ['getInventoryStatus'], explanation: 'Rice is below minimum stock.' },
            { type: 'low_stock', itemName: 'Basmati', severity: 'low', evidenceRefs: ['getInventoryStatus'], explanation: 'Basmati is out of stock.' },
          ],
        }),
      },
    );

    expect(result.issues.find((i) => i.itemName === 'Rice')?.severity).toBe('medium');
    expect(result.issues.find((i) => i.itemName === 'Basmati')?.severity).toBe('high');
  });
});
