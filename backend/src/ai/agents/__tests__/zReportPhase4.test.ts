/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportPhase4.test.ts — Phase 4 (Daily Summary / Z-Report Intelligence)
 * acceptance: LLM projection + grounding, the deterministic narrative, the
 * bounded follow-up investigation, and the final critic.
 *
 * The LLM is MOCKED at the shared-client boundary only (`generateJsonWithMeta`)
 * — the same seam the repository's explanation tests use — so the fabrication,
 * malformed-output and provider-failure paths are exercised against the REAL
 * synthesis, grounding and critic code.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/llmClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/llmClient')>();
  return { ...actual, generateJsonWithMeta: vi.fn() };
});

import { generateJsonWithMeta, LlmError, type LlmJsonResult } from '../../shared/llmClient';
import { z } from 'zod';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { registerAllTools } from '../../tools/registerAllTools';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import type { BusinessSignal } from '../../intelligence/businessSignalTypes';
import { mergeEvidence, type EvidencePack } from '../evidenceMerger';
import type { ZReportEvidence, ZReportBatchResult } from '../zReportSignals';
import {
  allowedNumbersFor,
  buildZReportPromptFacts,
  computeReportConfidence,
  deterministicZReportNarrative,
  generateZReportNarrative,
  groundZReportNarrative,
  zReportNarrativeSchema,
  type ZReportNarrative,
} from '../zReportPrompts';
import { runZReportFollowUp, followUpAsBatch, Z_REPORT_FOLLOWUP_BUDGET_MS } from '../zReportFollowUp';
import { criticizeZReport, staleOnlyNumbers } from '../zReportCritic';
import { Z_REPORT_FOLLOWUP_MAX_TOOLS } from '../policies/zReportAgentPolicy';

const mockedGenerate = vi.mocked(generateJsonWithMeta);

const A = '507f1f77bcf86cd799439011';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const D = '2026-08-01';

const context = {
  restaurantId: A,
  businessDate: D,
  comparison: {
    businessDate: D,
    previousDate: '2026-07-31',
    weekStartDate: '2026-07-25',
    weekEndDate: '2026-07-31',
    monthStartDate: '2026-07-02',
    monthEndDate: '2026-07-31',
  },
  memory: {
    episodes: [],
    longTerm: [],
    priorityStatement: 'current business data > ML > analytics > memory',
    loadedAt: new Date().toISOString(),
  },
  promptVersion: 'z-report-daily-v1',
  generatedAt: new Date().toISOString(),
} as never;

function mkSignal(over: Partial<BusinessSignal> = {}): BusinessSignal {
  return {
    signalId: 'sales_growth:restaurant',
    code: 'sales_growth',
    category: 'sales',
    source: 'sales_context',
    statement: 'Net revenue rose 12.5% versus the previous day.',
    value: 11250,
    baseline: 10000,
    changePct: 0.125,
    direction: 'up',
    confidence: 0.85,
    sampleSize: 42,
    freshness: 'fresh',
    generatedAt: new Date().toISOString(),
    scope: { restaurantId: A, branchId: null, scope: 'tenant' },
    evidence: [{ kind: 'metric', ref: 'metric:x', value: 11250 }],
    ...over,
  };
}

function packOf(signals: BusinessSignal[], over: Partial<EvidencePack> = {}): EvidencePack {
  const batch = (batchNo: 1 | 2): ZReportBatchResult => ({
    batch: batchNo,
    signals: [],
    toolErrors: [],
    unavailable: [],
    caveats: [],
    durationMs: 1,
  });
  const evidence: ZReportEvidence = {
    restaurantId: A,
    businessDate: D,
    batch1: { ...batch(1), signals },
    batch2: batch(2),
    batch3: null,
    followUp: null,
    batch3Reason: 'not triggered (no notable movement)',
    caveats: [],
    generatedAt: new Date().toISOString(),
  };
  const merged = mergeEvidence(evidence);
  return { ...merged, ...over };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt projection — no tenant metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('buildZReportPromptFacts', () => {
  it('exposes evidence handles and never tenant or security identifiers', () => {
    const pack = packOf([mkSignal(), mkSignal({ signalId: 'w:1', code: 'inventory_wastage', category: 'inventory', source: 'inventory_context', subject: { type: 'ingredient', id: 'Paneer', label: 'Paneer' }, statement: 'Paneer wastage was 6 kg.' })]);
    const { facts, evidenceIds } = buildZReportPromptFacts(context, pack, ['Uplift evidence is unavailable: the experiment is small.']);

    expect(facts.businessDate).toBe(D);
    expect(facts.previousDate).toBe('2026-07-31');
    expect(facts.evidence.length).toBe(2);
    expect([...evidenceIds.keys()]).toEqual(['E1', 'E2']);
    expect(facts.evidence.every((e) => /^E\d+$/.test(e.id))).toBe(true);
    // Tenant/security metadata must not reach the model.
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain(A);
    expect(serialized).not.toContain('restaurantId');
    expect(serialized).not.toContain('branchId');
    expect(serialized).not.toContain('signalId');
    expect(facts.predictiveEvidence).toHaveLength(1);
  });

  it('orders the strongest evidence first and converts ratios into percentages', () => {
    const pack = packOf([
      mkSignal({ signalId: 'low', confidence: 0.3 }),
      mkSignal({ signalId: 'high', confidence: 0.95, changePct: 0.5 }),
    ]);
    const { facts, evidenceIds } = buildZReportPromptFacts(context, pack, []);
    expect(evidenceIds.get('E1')?.signalId).toBe('high');
    expect(facts.evidence[0].changePercent).toBe(50);
  });
});

describe('allowedNumbersFor', () => {
  it('allows the pack measurements, statement numbers and the summarized dates', () => {
    const pack = packOf([mkSignal()]);
    const allowed = allowedNumbersFor(context, pack, []);
    // The run in the test file itself is not an allowed number (only tokens
    // that the evidence actually contains are quotable).
    expect(allowed.has('11250')).toBe(true);
    expect(allowed.has('10000')).toBe(true);
    expect(allowed.has('12.5')).toBe(true);
    expect(allowed.has('2026')).toBe(true); // date component
    expect(allowed.has('999999')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic narrative
// ─────────────────────────────────────────────────────────────────────────────

describe('deterministicZReportNarrative', () => {
  const richPack = packOf([
    mkSignal({ signalId: 'cash', code: 'cash_over_short', source: 'cash_ledger', confidence: 0.9, statement: 'Closing drawer variance on 2026-08-01: short by 15.' }),
    mkSignal({ signalId: 'refunds', code: 'refund_spike', statement: 'Refunds were 10.6% of net sales.', value: 450 }),
    mkSignal({ signalId: 'wastage', code: 'inventory_wastage_spike', category: 'inventory', source: 'inventory_context', subject: { type: 'ingredient', id: 'Paneer', label: 'Paneer' }, statement: 'Paneer wastage rose to 6 kg from 3 kg (+100%).' }),
    mkSignal({ signalId: 'decline', code: 'sales_decline', statement: 'Net revenue fell 18% versus the previous day.', changePct: -0.18 }),
  ]);

  it('addresses every must-address evidence code and stays schema-valid', () => {
    const narrative = deterministicZReportNarrative(context, richPack);
    expect(zReportNarrativeSchema.safeParse(narrative).success).toBe(true);
    const attention = narrative.needsAttention.join(' ');
    expect(attention).toMatch(/cash|drawer|till|variance/i);
    expect(attention).toMatch(/refund/i);
    expect(attention).toMatch(/wast|spoil/i);
    expect(narrative.headline).toContain(D);
  });

  it('is grounded by construction: no number appears outside the allowed set', () => {
    const narrative = deterministicZReportNarrative(context, richPack);
    const allowed = allowedNumbersFor(context, richPack, []);
    const text = [narrative.headline, ...narrative.whatHappened, ...narrative.whatMattered, ...narrative.needsAttention, ...narrative.focusNext].join(' ');
    for (const tok of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      const clean = tok.replace(/,/g, '');
      expect(allowed.has(tok) || allowed.has(clean), `ungrounded token ${tok}`).toBe(true);
    }
  });

  it('discloses unavailable reads, failed reads, conflicts and staleness in the caveats', () => {
    const pack = packOf([
      mkSignal({ signalId: 'stale', freshness: 'stale' }),
      mkSignal({ signalId: 'conflict-a', value: 100 }),
      mkSignal({ signalId: 'conflict-b', value: 40, source: 'cash_ledger' }),
    ]);
    const withGaps = {
      ...pack,
      unavailable: ['batch1:inventory_context'],
      toolErrors: [{ tool: 'getExpiryRisk', code: 'TOOL_FAILED', message: 'boom' }],
    };
    const narrative = deterministicZReportNarrative(context, withGaps);
    const caveats = narrative.caveats.join(' ');
    expect(caveats).toMatch(/not available/i);
    expect(caveats).toMatch(/failed/i);
    expect(caveats).toMatch(/inconsistently|disagree/i);
    expect(caveats).toMatch(/excluded|no longer current/i);
  });

  it('produces an honest empty report when nothing usable exists', () => {
    const empty = packOf([]);
    const narrative = deterministicZReportNarrative(context, empty);
    expect(narrative.headline).toContain(D);
    expect(narrative.caveats.length).toBeGreaterThan(0);
    expect(computeReportConfidence(empty)).toBe(0);
  });
});

describe('computeReportConfidence', () => {
  it('reflects evidence strength and penalises degraded runs', () => {
    const strong = packOf([mkSignal({ confidence: 0.9 }), mkSignal({ signalId: 'b', confidence: 0.8 })]);
    const degraded = { ...strong, unavailable: ['batch1:x'], toolErrors: [{ tool: 't', code: 'TOOL_FAILED', message: 'x' }] };
    const strongScore = computeReportConfidence(strong);
    expect(strongScore).toBeGreaterThan(0.7);
    expect(computeReportConfidence(degraded)).toBeCloseTo(strongScore - 0.1, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grounding enforcement (server-side, independent of prompt wording)
// ─────────────────────────────────────────────────────────────────────────────

describe('groundZReportNarrative', () => {
  const clean: ZReportNarrative = {
    headline: 'Revenue rose 12.5% over the previous day.',
    whatHappened: ['Net revenue was 11,250 versus 10,000.'],
    whatMattered: ['The day closed stronger than the day before.'],
    needsAttention: ['Nothing unusual stands out in the evidence.'],
    focusNext: ['Keep the same staffing pattern tomorrow.'],
    caveats: [],
  };

  it('keeps grounded numbers and strips fabricated ones', () => {
    const allowed = allowedNumbersFor(context, packOf([mkSignal()]), []);
    const result = groundZReportNarrative(
      { ...clean, whatHappened: ['Net revenue was 11,250 versus 10,000, up 700% on 999999 orders.'] },
      allowed,
    );
    expect(result.stripped).toBeGreaterThan(0);
    expect(result.narrative.whatHappened[0]).not.toContain('999999');
    expect(result.narrative.whatHappened[0]).toContain('11,250');
    expect(result.issues.filter((i) => i.includes('malformed') || i.includes('causal'))).toEqual([]);
  });

  it('flags unsupported causal language and malformed text', () => {
    const allowed = allowedNumbersFor(context, packOf([mkSignal()]), []);
    const causal = groundZReportNarrative({ ...clean, whatMattered: ['Revenue rose because of the festival.'] }, allowed);
    expect(causal.issues.some((i) => i.includes('unsupported_causal_language'))).toBe(true);

    // Two fabricated values stripped from one sentence leave a double
    // connector — broken owner copy that must be rejected, not shipped.
    const malformed = groundZReportNarrative({ ...clean, headline: 'Revenue fell from 999999 to 888888.' }, allowed);
    expect(malformed.issues.length).toBeGreaterThan(0);
    expect(malformed.narrative.headline).not.toContain('999999');
  });

  it('accepts a sentence-ending percentage but still rejects percent residue', () => {
    const allowed = allowedNumbersFor(context, packOf([mkSignal()]), []);
    const ok = groundZReportNarrative({ ...clean, whatHappened: ['Net revenue rose 12.5%.'] }, allowed);
    expect(ok.issues.filter((i) => i.includes('dangling_percent'))).toEqual([]);
    const residue = groundZReportNarrative({ ...clean, whatHappened: ['Net revenue moved by 888888%.'] }, allowed);
    expect(residue.narrative.whatHappened[0]).not.toContain('888888');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation (mocked shared LLM client)
// ─────────────────────────────────────────────────────────────────────────────

describe('generateZReportNarrative', () => {
  const pack = packOf([mkSignal()]);
  const llmResult = (value: unknown): LlmJsonResult<unknown> => ({
    value,
    model: 'test-model',
    provider: 'test-provider',
    latencyMs: 12,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  });

  beforeEach(() => {
    mockedGenerate.mockReset();
  });

  it('accepts a grounded LLM narrative and reports it as LLM-sourced', async () => {
    mockedGenerate.mockResolvedValue(
      llmResult({
        headline: 'Revenue rose 12.5% over the previous day.',
        whatHappened: ['Net revenue was 11,250 versus 10,000 on 2026-08-01.'],
        whatMattered: ['The day closed stronger than the day before.'],
        needsAttention: ['Nothing unusual stands out.'],
        focusNext: ['Repeat the same staffing tomorrow.'],
        caveats: [],
      }),
    );
    const result = await generateZReportNarrative({ context, pack });
    expect(result.source).toBe('llm');
    expect(result.llmAttempted).toBe(true);
    expect(result.model).toBe('test-model');
    expect(result.usage?.totalTokens).toBe(30);
    expect(result.validationIssues).toEqual([]);
  });

  it('falls back when the model invents numbers it was never given', async () => {
    mockedGenerate.mockResolvedValue(
      llmResult({
        headline: 'Revenue exploded by 987654% on 2026-08-01.',
        whatHappened: ['Net revenue was 11,250.'],
        whatMattered: ['Strong day.'],
        needsAttention: ['Watch costs.'],
        focusNext: ['Keep going.'],
        caveats: [],
      }),
    );
    const result = await generateZReportNarrative({ context, pack });
    // Either the fabrication is stripped and the remainder is accepted, or the
    // report is rejected — in BOTH cases no invented number may survive.
    expect(JSON.stringify(result.narrative)).not.toContain('987654');
    if (result.source === 'llm') expect(result.strippedNumbers).toBeGreaterThan(0);
    else expect(result.degradedReason).toContain('rejected');
  });

  it('rejects unsupported causal claims outright', async () => {
    mockedGenerate.mockResolvedValue(
      llmResult({
        headline: 'Revenue rose 12.5% because of the festival.',
        whatHappened: ['Net revenue was 11,250.'],
        whatMattered: ['Demand was driven by the weekend.'],
        needsAttention: ['Watch costs.'],
        focusNext: ['Keep going.'],
        caveats: [],
      }),
    );
    const result = await generateZReportNarrative({ context, pack });
    expect(result.source).toBe('deterministic');
    expect(result.degradedReason).toContain('unsupported_causal_language');
    expect(JSON.stringify(result.narrative)).not.toMatch(/because of|driven by/i);
  });

  it('falls back on provider failure and on malformed output, never throwing', async () => {
    mockedGenerate.mockRejectedValue(new LlmError('timeout', 'timeout'));
    const timedOut = await generateZReportNarrative({ context, pack });
    expect(timedOut.source).toBe('deterministic');
    expect(timedOut.degradedReason).toBe('llm_timeout');

    mockedGenerate.mockResolvedValue(llmResult({ headline: 'Bad shape' }));
    const malformed = await generateZReportNarrative({ context, pack });
    expect(malformed.source).toBe('deterministic');
    expect(malformed.degradedReason).toBe('invalid_schema');
  });

  it('does not call the LLM when the pack has no evidence or the LLM is disabled', async () => {
    const empty = await generateZReportNarrative({ context, pack: packOf([]) });
    expect(empty.degradedReason).toBe('no_evidence');

    const disabled = await generateZReportNarrative({ context, pack, disableLlm: true });
    expect(disabled.degradedReason).toBe('llm_disabled');
    expect(mockedGenerate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bounded follow-up investigation
// ─────────────────────────────────────────────────────────────────────────────

const registryTools = (toolRegistry as unknown as { tools: Map<string, ToolDefinition<unknown, unknown>> }).tools;
const ORIGINALS = new Map<string, ToolDefinition<unknown, unknown> | undefined>();
const SEEN: string[] = [];

const ML_TOOLS = ['getMLCustomerSegments', 'getUpliftSignals', 'getOfferResponseBatchScores', 'getMarketBasketSignals'] as const;

function stubRegistry(name: string, mode: 'available' | 'unavailable' | 'throw' = 'unavailable') {
  const def = {
    name,
    category: 'ml',
    access: 'read',
    meta: { description: `stub ${name}`, source: 'test' },
    inputSchema: z.object({ limit: z.number().optional(), segment: z.string().optional() }).strict(),
    outputSchema: z.any(),
    execute: async () => {
      SEEN.push(name);
      if (mode === 'throw') throw new Error(`${name} exploded`);
      if (mode === 'unavailable') return { available: false, detail: 'NOT_TRAINED', modelId: name };
      return { available: true, modelId: name, modelVersion: 'v1', evaluationStatus: 'ok', freshnessAgeDays: 1 };
    },
  };
  if (!ORIGINALS.has(name)) ORIGINALS.set(name, registryTools.get(name));
  registryTools.set(name, def as never);
}

beforeAll(() => {
  registerAllTools();
  for (const t of ML_TOOLS) stubRegistry(t, 'unavailable');
});

afterAll(() => {
  for (const [name, def] of ORIGINALS) {
    if (def) registryTools.set(name, def);
    else registryTools.delete(name);
  }
});

describe('runZReportFollowUp', () => {
  const tenant = { restaurantId: A, actorId: 'tester' } as never;

  beforeEach(() => {
    SEEN.length = 0;
    for (const t of ML_TOOLS) stubRegistry(t, 'unavailable');
  });

  it('does nothing when nothing is unclear (no tools, no reasons, no cost)', async () => {
    const result = await runZReportFollowUp({ tenant, context, pack: packOf([mkSignal()]) });
    expect(result.reasons).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(SEEN).toEqual([]);
  });

  it('investigates a sales decline with ML targeting evidence only, never re-reading facts', async () => {
    const result = await runZReportFollowUp({
      tenant,
      context,
      pack: packOf([mkSignal({ code: 'sales_decline', signalId: 'decline', changePct: -0.2 })]),
      alreadyFetched: ['getSalesTrends'],
    });
    expect(result.reasons.join(' ')).toContain('movement_targeting_context');
    expect(result.toolNames).toEqual(['getMLCustomerSegments', 'getUpliftSignals']);
    expect(SEEN).toEqual(['getMLCustomerSegments', 'getUpliftSignals']);
    expect(result.mlEvidence).toHaveLength(2);
    // Both stubs report themselves untrained → honest degradation, no invention.
    expect(result.mlSummary?.hasCausalEvidence).toBe(false);
    expect(result.mlLines.join(' ')).toMatch(/unavailable/i);
    expect(result.unavailable).toContain('ml_evidence');
    expect(result.degraded).toBe(true);
  });

  it('never exceeds the policy tool ceiling and deduplicates across rules', async () => {
    const result = await runZReportFollowUp({
      tenant,
      context,
      pack: packOf([
        mkSignal({ code: 'sales_decline', signalId: 'decline' }),
        mkSignal({ code: 'inventory_wastage_spike', signalId: 'w', freshness: 'aging' }),
        mkSignal({ signalId: 'c-a', value: 100 }),
        mkSignal({ signalId: 'c-b', value: 40, source: 'cash_ledger' }),
      ]),
    });
    expect(result.toolNames.length).toBeLessThanOrEqual(Z_REPORT_FOLLOWUP_MAX_TOOLS);
    expect(new Set(result.toolNames).size).toBe(result.toolNames.length);
    expect(result.toolNames).toContain('getOfferResponseBatchScores');
  });

  it('skips tools an earlier batch already fetched (no duplicate reads)', async () => {
    const result = await runZReportFollowUp({
      tenant,
      context,
      pack: packOf([mkSignal({ code: 'inventory_wastage_spike', signalId: 'w' })]),
      alreadyFetched: ['getMarketBasketSignals', 'getMLCustomerSegments', 'getUpliftSignals', 'getOfferResponseBatchScores'],
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(SEEN).toEqual([]);
    expect(result.unavailable).toContain('followup');
  });

  it('surfaces ML tool failures without failing the run', async () => {
    stubRegistry('getMLCustomerSegments', 'throw');
    const result = await runZReportFollowUp({ tenant, context, pack: packOf([mkSignal({ code: 'sales_decline', signalId: 'decline' })]) });
    expect(result.toolErrors.some((e) => e.tool === 'getMLCustomerSegments' && e.code === 'TOOL_FAILED')).toBe(true);
    // The failed model is still represented as unavailable evidence.
    expect(result.mlEvidence.length).toBe(2);
    expect(result.signals).toEqual([]);
  });

  it('honours the deterministic disable seam and adapts to a batch result', async () => {
    const disabled = await runZReportFollowUp({ tenant, context, pack: packOf([mkSignal({ code: 'sales_decline' })]), disable: true });
    expect(disabled.reasons).toEqual([]);
    expect(SEEN).toEqual([]);

    const batch = followUpAsBatch({ ...disabled, signals: [mkSignal()], durationMs: 7 }, ['follow-up disclosure']);
    expect(batch.batch).toBe('followup');
    expect(batch.durationMs).toBe(7);
    expect(batch.caveats).toEqual(['follow-up disclosure']);
  });

  it('resolves tools through the policy boundary and reports a broken registry', async () => {
    const saved = registryTools.get('getOfferResponseBatchScores');
    registryTools.delete('getOfferResponseBatchScores');
    try {
      const result = await runZReportFollowUp({
        tenant,
        context,
        pack: packOf([mkSignal({ signalId: 'c-a', value: 100 }), mkSignal({ signalId: 'c-b', value: 10, source: 'cash_ledger' })]),
      });
      expect(result.toolErrors.some((e) => e.tool === 'resolveZReportAgentTools')).toBe(true);
      expect(result.degraded).toBe(true);
      expect(SEEN).toEqual([]);
    } finally {
      if (saved) registryTools.set('getOfferResponseBatchScores', saved);
    }
  });
});

describe('mergeEvidence with follow-up evidence', () => {
  it('includes follow-up signals, sources and the ML picture in the pack', async () => {
    const tenant = { restaurantId: A, actorId: 'tester' } as never;
    const followUp = await runZReportFollowUp({
      tenant,
      context,
      pack: packOf([mkSignal({ code: 'sales_decline', signalId: 'decline' })]),
    });
    const evidence: ZReportEvidence = {
      restaurantId: A,
      businessDate: D,
      batch1: { batch: 1, signals: [mkSignal()], toolErrors: [], unavailable: [], caveats: ['batch disclosure'], durationMs: 1 },
      batch2: { batch: 2, signals: [], toolErrors: [], unavailable: [], caveats: [], durationMs: 2 },
      batch3: null,
      followUp: followUpAsBatch(followUp, ['follow-up disclosure']),
      batch3Reason: 'not triggered (no notable movement)',
      caveats: [],
      generatedAt: new Date().toISOString(),
    };
    const pack = mergeEvidence(evidence, undefined, followUp.mlSummary);
    expect(pack.sources.followUp?.signals).toBe(followUp.signals.length);
    expect(pack.caveats).toContain('follow-up disclosure');
    expect(pack.caveats).toContain('batch disclosure');
    expect(pack.unavailable.some((u) => u.startsWith('followUp:'))).toBe(true);
    expect(pack.ml?.availableKinds).toEqual([]);
    expect(pack.ml?.missingKinds.length).toBeGreaterThan(0);
    expect(pack.ml?.hasCausalEvidence).toBe(false);
    expect(Z_REPORT_FOLLOWUP_BUDGET_MS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Final critic
// ─────────────────────────────────────────────────────────────────────────────

describe('criticizeZReport', () => {
  const richPack = packOf([
    mkSignal({ signalId: 'cash', code: 'cash_over_short', source: 'cash_ledger', confidence: 0.9, statement: 'Closing drawer variance: short by 15.' }),
    mkSignal({ signalId: 'decline', code: 'sales_decline', statement: 'Net revenue fell 18%.', changePct: -0.18 }),
  ]);

  const accept = (narrative: ZReportNarrative, pack = richPack, source: 'llm' | 'deterministic' = 'deterministic') =>
    criticizeZReport({ narrative, pack, context, allowedNumbers: allowedNumbersFor(context, pack, []), source });

  it('ACCEPTS the deterministic narrative built from the same pack (self-consistency invariant)', () => {
    const narrative = deterministicZReportNarrative(context, richPack);
    const verdict = accept(narrative);
    expect(verdict.issues).toEqual([]);
    expect(verdict.verdict).toBe('accept');
    expect(verdict.checks.length).toBeGreaterThanOrEqual(7);
  });

  it('BLOCKS ungrounded numbers in an LLM narrative', () => {
    const narrative: ZReportNarrative = {
      headline: 'Revenue fell 18%.',
      whatHappened: ['Net revenue fell 18%.'],
      whatMattered: ['The day was weaker.'],
      needsAttention: ['The cash drawer was short by 15.'],
      focusNext: ['Watch it tomorrow.'],
      caveats: [],
    };
    const verdict = accept({ ...narrative, whatMattered: ['Revenue dropped by 4321%.'] }, richPack, 'llm');
    expect(verdict.verdict).toBe('repair');
    expect(verdict.issues.some((i) => i.code === 'ungrounded_number')).toBe(true);
  });

  it('BLOCKS a narrative that ignores drawer variance and revenue decline', () => {
    const verdict = accept({
      headline: 'A normal day by the evidence we have.',
      whatHappened: ['Nothing unusual was recorded.'],
      whatMattered: ['Operations ran as usual.'],
      needsAttention: ['Nothing unusual stands out.'],
      focusNext: ['Repeat today tomorrow.'],
      caveats: [],
    });
    expect(verdict.verdict).toBe('repair');
    expect(verdict.issues.some((i) => i.code === 'unaddressed:cash_over_short')).toBe(true);
    expect(verdict.issues.some((i) => i.code === 'unaddressed:sales_decline')).toBe(true);
  });

  it('BLOCKS causation without gated causal evidence', () => {
    const verdict = accept({
      headline: 'Revenue fell 18% because of the rain.',
      whatHappened: ['Net revenue fell 18%.'],
      whatMattered: ['Traffic was driven by weather.'],
      needsAttention: ['The cash drawer was short by 15.'],
      focusNext: ['Watch it tomorrow.'],
      caveats: [],
    });
    expect(verdict.issues.some((i) => i.code === 'unsupported_causal_language')).toBe(true);
  });

  it('BLOCKS undisclosed conflicts, staleness and unusable packs', () => {
    const conflictPack = packOf([mkSignal({ signalId: 'a', value: 100 }), mkSignal({ signalId: 'b', value: 40, source: 'cash_ledger' })]);
    const narrative = deterministicZReportNarrative(context, conflictPack);
    const undisclosed = accept({ ...narrative, caveats: [], whatMattered: ['Everything looks consistent.'], needsAttention: ['Nothing unusual stands out.'], headline: 'A steady day.', whatHappened: ['Operations ran as usual.'] }, conflictPack);
    expect(undisclosed.issues.some((i) => i.code === 'undisclosed_conflict')).toBe(true);

    const stalePack = packOf([mkSignal({ signalId: 'stale', freshness: 'stale' })]);
    const staleVerdict = accept(
      { headline: 'Revenue rose 12.5%.', whatHappened: ['Net revenue was 11,250.'], whatMattered: ['Strong day.'], needsAttention: ['Nothing unusual stands out.'], focusNext: ['Keep going.'], caveats: [] },
      stalePack,
    );
    expect(staleVerdict.issues.some((i) => i.code === 'undisclosed_stale_evidence')).toBe(true);
    expect(staleOnlyNumbers(stalePack).has('11250')).toBe(true);

    const unusable = { ...packOf([mkSignal()]), usable: false, unavailable: ['batch1:x'], toolErrors: [{ tool: 't', code: 'TOOL_FAILED', message: 'x' }] };
    const unusableVerdict = accept(
      { headline: 'A steady day for the restaurant.', whatHappened: ['Operations ran as usual.'], whatMattered: ['Nothing unusual.'], needsAttention: ['Nothing unusual stands out.'], focusNext: ['Keep going.'], caveats: [] },
      unusable,
    );
    expect(unusableVerdict.issues.some((i) => i.code === 'undisclosed_degradation' && i.blocking)).toBe(true);
    expect(unusableVerdict.issues.some((i) => i.code === 'unusable_pack_not_stated')).toBe(true);
  });

  it('does not flag an LLM narrative that discloses everything the pack requires', () => {
    const narrative: ZReportNarrative = {
      headline: 'Revenue fell 18% and the cash drawer was short by 15 on 2026-08-01.',
      whatHappened: ['Net revenue fell 18%.', 'The cash drawer was short by 15.'],
      whatMattered: ['Both readings matter for tomorrow.'],
      needsAttention: ['Recheck the cash drawer count against the closing report.', 'Review what moved revenue down 18%.'],
      focusNext: ['Recheck the drawer before the next shift.'],
      caveats: ['Reads that were not available are excluded from this summary.'],
    };
    const verdict = accept(narrative, richPack, 'llm');
    expect(verdict.issues.filter((i) => i.blocking)).toEqual([]);
    expect(verdict.verdict).toBe('accept');
  });
});
