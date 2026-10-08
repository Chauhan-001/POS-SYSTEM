/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * domains.ts — the DOMAIN CAPABILITY LAYER (task §4).
 *
 * The Marketing Manager must NOT see 22 low-level database tools: it sees the
 * business domains below. Each capability:
 *   - declares the business QUESTION it answers,
 *   - runs a BOUNDED internal plan of existing read-only tools,
 *   - derives findings DETERMINISTICALLY (no LLM, no arithmetic of its own —
 *     it reuses the canonical normalizers through `investigateBusiness`),
 *   - returns a `DomainInvestigation` and NEVER throws (failures become
 *     `status:'unavailable'` + a machine reason).
 *
 * Declared-only domains (feedback, competition): the capability is REGISTERED
 * and visible — its implementation is deferred, so it reports
 * `implemented:false` + `DOMAIN_NOT_IMPLEMENTED` rather than being silently
 * absent. A missing domain must never look like a healthy domain.
 *
 * These capabilities ARE tools in the ONE shared registry (category 'domain'),
 * so the existing policy boundary, zod validation, timeout clamp and tenant
 * scoping apply unchanged — no second registry, no second executor.
 */

import { z } from 'zod';
import type { ToolContext, ToolDefinition } from '../tools/registry/toolTypes';
import { toolRegistry } from '../tools/registry/toolRegistry';
import { executeTool } from '../tools/registry/toolExecutor';
import { investigateBusiness, type BusinessDimension } from '../intelligence/businessIntelligenceService';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';
import {
  basketEvidence,
  forecastEvidence,
  responseEvidence,
  segmentEvidence,
  summarizeMlEvidence,
  upliftEvidence,
  type MlEvidence,
  type MlSignalSummary,
} from '../intelligence/mlSemantics';
import type {
  DomainCapabilityDescriptor,
  DomainFinding,
  DomainInvestigation,
  IntelligenceDomain,
} from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const domainInputSchema = z
  .object({
    /** Analysis window (bounded). Tenant identity is NEVER an argument. */
    lookbackDays: z.number().int().min(7).max(365).optional(),
  })
  .strict();

export type DomainInput = z.infer<typeof domainInputSchema>;

/** Evidence ref for a canonical signal (stable across runs). */
export function signalRef(s: BusinessSignal): string {
  return `signal:${s.signalId}`;
}

/** Deterministic finding from a canonical signal. Statement reused verbatim. */
function findingFromSignal(domain: IntelligenceDomain, s: BusinessSignal): DomainFinding {
  return {
    code: s.code,
    domain,
    statement: s.statement,
    confidence: s.confidence,
    evidenceRefs: [signalRef(s)],
  };
}

export function findingsFromSignals(domain: IntelligenceDomain, signals: BusinessSignal[]): DomainFinding[] {
  return signals.map((s) => findingFromSignal(domain, s));
}

interface DomainSpec {
  domain: IntelligenceDomain;
  toolName: string;
  question: string;
  sources: string[];
  /** Canonical signal dimensions this domain reads (empty → custom executor). */
  dimensions: BusinessDimension[];
  implemented: boolean;
  /** Declared-only reason shown to the owner. */
  declaredNote?: string;
}

/**
 * The canonical domain catalog. `dimensions` maps each domain onto the EXISTING
 * canonical investigation dimensions — the domain layer adds no new data path.
 */
export const DOMAIN_SPECS: DomainSpec[] = [
  {
    domain: 'sales',
    toolName: 'investigateSalesDomain',
    question: 'How is revenue, average order value and demand shape moving, and where is it weak or strong?',
    sources: ['getSalesTrends'],
    dimensions: ['sales'],
    implemented: true,
  },
  {
    domain: 'products',
    toolName: 'investigateProductsDomain',
    question: 'Which menu items are high-demand/low-margin, declining, slow-moving or strongly paired?',
    sources: ['getMenuPerformance', 'getProductMargins', 'getMarketBasketSignals'],
    dimensions: ['menu', 'margin', 'basket'],
    implemented: true,
  },
  {
    domain: 'inventory',
    toolName: 'investigateInventoryDomain',
    question: 'What is exposed to waste, expiry or stockout, and does it constrain a promotion?',
    sources: ['getInventoryStatus', 'getExpiryRisk', 'getStockoutRisk'],
    dimensions: ['inventory'],
    implemented: true,
  },
  {
    domain: 'customers',
    toolName: 'investigateCustomersDomain',
    question: 'Which customer groups exist, who is lapsing, and who is worth targeting?',
    sources: ['getCustomerSegments', 'getRetentionSignals'],
    dimensions: ['customer'],
    implemented: true,
  },
  {
    domain: 'marketing_history',
    toolName: 'investigateMarketingHistoryDomain',
    question: 'How have past offers and campaigns actually performed, and what is running right now?',
    sources: ['getOfferPerformance', 'getCampaignPerformance', 'getActiveOffers'],
    dimensions: ['marketing'],
    implemented: true,
  },
  {
    domain: 'context',
    toolName: 'investigateContextDomain',
    question: 'Which external factors (festivals, sports fixtures, weather) change demand right now?',
    sources: ['getFestivalContext', 'getSportsContext', 'getWeatherContext'],
    dimensions: ['context'],
    implemented: true,
  },
  {
    domain: 'ml',
    toolName: 'investigateMlDomain',
    question: 'What do the models currently say about uplift, response, segments, demand and baskets?',
    sources: [
      'getUpliftSignals',
      'getOfferResponseBatchScores',
      'getMLCustomerSegments',
      'getDemandForecast',
      'getMarketBasketSignals',
    ],
    dimensions: [],
    implemented: true,
  },
  {
    domain: 'feedback',
    toolName: 'investigateFeedbackDomain',
    question: 'What do guest ratings and comments say, and which issues recur?',
    sources: [],
    dimensions: [],
    implemented: false,
    declaredNote:
      'Feedback Intelligence is DECLARED ONLY: no feedback ingestion/summarisation is implemented yet. Guest ratings and review text are not analysed, so nothing may be concluded about satisfaction or complaints from this domain.',
  },
  {
    domain: 'competition',
    toolName: 'investigateCompetitionDomain',
    question: 'What are nearby competitors doing, and does it change our offer positioning?',
    sources: [],
    dimensions: [],
    implemented: false,
    declaredNote:
      'Competition Intelligence is DECLARED ONLY: no competitor data provider is integrated (directory scraping is out of scope), so no competitor fact may be asserted.',
  },
];

function specFor(domain: IntelligenceDomain): DomainSpec {
  const spec = DOMAIN_SPECS.find((s) => s.domain === domain);
  if (!spec) throw new Error(`Unknown intelligence domain: ${domain}`);
  return spec;
}

/** The capability catalog the Marketing Manager chooses from. */
export function domainCapabilityCatalog(): DomainCapabilityDescriptor[] {
  return DOMAIN_SPECS.map((s) => ({
    domain: s.domain,
    question: s.question,
    sources: s.sources,
    implemented: s.implemented,
  }));
}

/** Domain tool names — the Marketing Manager policy allow-list. */
export const MARKETING_DOMAIN_TOOLS: readonly string[] = DOMAIN_SPECS.map((s) => s.toolName);

// ─────────────────────────────────────────────────────────────────────────────
// Domain executors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signal-backed domain: runs the canonical investigation restricted to this
 * domain's dimensions. Zero signals is reported as `unavailable` WITH the
 * underlying reason — never as "no problem".
 */
async function investigateSignalDomain(
  spec: DomainSpec,
  ctx: ToolContext,
  lookbackDays: number | undefined,
): Promise<DomainInvestigation> {
  const startedAt = Date.now();
  const base: Pick<DomainInvestigation, 'domain' | 'question' | 'implemented' | 'generatedAt'> = {
    domain: spec.domain,
    question: spec.question,
    implemented: spec.implemented,
    generatedAt: new Date().toISOString(),
  };

  try {
    const investigation = await investigateBusiness({
      tenant: ctx.tenant,
      branchId: ctx.tenant.branchId,
      dimensions: spec.dimensions,
      budgetMs: ctx.timeoutMs ?? 12_000,
      lookbackDays,
      executionId: ctx.executionId,
    });

    const signals = investigation.signals;
    const findings = findingsFromSignals(spec.domain, signals);
    const evidenceRefs = signals.map(signalRef);
    const failedDimension = investigation.dimensions.find((d) => d.status === 'error');
    const limits: string[] = [
      'Findings come only from the canonical normalizers of the read-only tools listed for this domain.',
    ];
    if (investigation.toolErrors.length) {
      limits.push(`Unreadable sources: ${investigation.toolErrors.map((e) => `${e.tool}(${e.code})`).join(', ')}`);
    }

    if (findings.length === 0) {
      return {
        ...base,
        status: 'unavailable',
        findings: [],
        signals: [],
        evidenceRefs: [],
        reasonCode: failedDimension?.reason ?? 'NO_DATA_IN_DOMAIN',
        degradedReason: failedDimension
          ? `The sources behind this domain could not be read (${failedDimension.reason}).`
          : 'No usable evidence was produced for this domain in the analysed window.',
        limits,
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      ...base,
      status: failedDimension ? 'partial' : 'ok',
      findings,
      signals,
      evidenceRefs,
      reasonCode: failedDimension?.reason,
      degradedReason: failedDimension ? `One source in this domain failed (${failedDimension.reason}).` : undefined,
      limits,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ...base,
      status: 'unavailable',
      findings: [],
      signals: [],
      evidenceRefs: [],
      reasonCode: 'DOMAIN_ERROR',
      degradedReason: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
      durationMs: Date.now() - startedAt,
    };
  }
}

const ML_TOOL_NAMES = {
  uplift: 'getUpliftSignals',
  response: 'getOfferResponseBatchScores',
  segment: 'getMLCustomerSegments',
  demand: 'getDemandForecast',
  basket: 'getMarketBasketSignals',
} as const;

/**
 * Fetch + classify ML evidence through the shared registry. Exported because
 * ML enrichment (Phase 9) must use the SAME fetch even when the model never
 * chose the ML domain — one fetch path, one set of semantics.
 */
export async function fetchMlEvidence(
  ctx: ToolContext,
  lookbackDays?: number,
): Promise<{ evidence: MlEvidence[]; summary: MlSignalSummary; errors: string[] }> {
  const errors: string[] = [];
  const timeoutMs = Math.max(1_000, Math.min(ctx.timeoutMs ?? 4_000, 8_000));

  const runOne = async (toolName: string): Promise<Record<string, unknown> | null> => {
    const tool = toolRegistry.get(toolName);
    if (!tool) {
      errors.push(`${toolName}: TOOL_NOT_FOUND`);
      return null;
    }
    const res = await executeTool(tool, {}, { ...ctx, timeoutMs });
    if (!res.ok) {
      errors.push(`${toolName}: ${res.code}`);
      return null;
    }
    return res.data as Record<string, unknown>;
  };

  const [uplift, response, segment, demand, basket] = await Promise.all([
    runOne(ML_TOOL_NAMES.uplift),
    runOne(ML_TOOL_NAMES.response),
    runOne(ML_TOOL_NAMES.segment),
    runOne(ML_TOOL_NAMES.demand),
    runOne(ML_TOOL_NAMES.basket),
  ]);

  const evidence: MlEvidence[] = [
    upliftEvidence(uplift as never),
    responseEvidence(response as never),
    segmentEvidence(segment as never),
    forecastEvidence(demand as never),
    basketEvidence(basket as never),
  ];
  return { evidence, summary: summarizeMlEvidence(evidence), errors };
}

/** ML domain: available/missing model evidence as explicit, non-causal findings. */
async function investigateMlDomain(
  spec: DomainSpec,
  ctx: ToolContext,
  lookbackDays: number | undefined,
): Promise<DomainInvestigation> {
  const startedAt = Date.now();
  const base = {
    domain: spec.domain,
    question: spec.question,
    implemented: spec.implemented,
    generatedAt: new Date().toISOString(),
  };
  const { evidence, summary, errors } = await fetchMlEvidence(ctx, lookbackDays);

  const findings: DomainFinding[] = [];
  for (const e of evidence) {
    if (!e.available) continue;
    const causal = e.kind === 'causal_uplift' && e.causal === true;
    const detail = [e.modelId ? `model ${e.modelId}` : null, e.evaluationStatus ? `evaluation ${e.evaluationStatus}` : null]
      .filter(Boolean)
      .join(', ');
    findings.push({
      code: `ml_${e.kind}_available`,
      domain: 'ml',
      statement:
        `${e.kind} model evidence is available${detail ? ` (${detail})` : ''}. ` +
        (causal
          ? 'This passed the experiment gate, so it is the only kind usable for a causal claim.'
          : 'This is NOT causal evidence and may not be presented as measured uplift.'),
      confidence: 0.7,
      evidenceRefs: [`ml:${e.kind}`],
    });
  }
  for (const kind of summary.missingKinds) {
    findings.push({
      code: `ml_${kind}_unavailable`,
      domain: 'ml',
      statement: `${kind} model evidence is not available right now — no conclusion may use it.`,
      confidence: 0.6,
      evidenceRefs: [`ml:${kind}`],
    });
  }

  return {
    ...base,
    status: summary.availableKinds.length ? 'ok' : 'unavailable',
    findings,
    signals: [],
    evidenceRefs: evidence.filter((e) => e.available).map((e) => `ml:${e.kind}`),
    reasonCode: summary.availableKinds.length ? undefined : 'NO_ML_EVIDENCE',
    degradedReason: summary.availableKinds.length
      ? undefined
      : `No model evidence is currently usable${errors.length ? ` (${errors.join(', ')})` : ''}.`,
    limits: ['ML evidence is a prediction, never a measured outcome; ranking still obeys deterministic economics.'],
    durationMs: Date.now() - startedAt,
  };
}

/** Declared-only domain: registered, visible, honestly unimplemented. */
function declaredDomainInvestigation(spec: DomainSpec, startedAt: number): DomainInvestigation {
  return {
    domain: spec.domain,
    status: 'unavailable',
    question: spec.question,
    findings: [],
    signals: [],
    evidenceRefs: [],
    reasonCode: 'DOMAIN_NOT_IMPLEMENTED',
    degradedReason: spec.declaredNote,
    limits: ['This capability is declared but has no implementation yet — it must be disclosed, not treated as empty.'],
    implemented: false,
    durationMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Execute one domain capability (deterministic; never throws). */
export async function investigateDomain(
  domain: IntelligenceDomain,
  ctx: ToolContext,
  lookbackDays?: number,
): Promise<DomainInvestigation> {
  const spec = specFor(domain);
  const startedAt = Date.now();
  if (!spec.implemented) return declaredDomainInvestigation(spec, startedAt);
  if (spec.domain === 'ml') return investigateMlDomain(spec, ctx, lookbackDays);
  return investigateSignalDomain(spec, ctx, lookbackDays);
}

function domainToolDefinition(spec: DomainSpec): ToolDefinition<DomainInput, DomainInvestigation> {
  return {
    name: spec.toolName,
    category: 'domain',
    access: 'read',
    meta: {
      description: `${spec.question}${spec.implemented ? '' : ' (DECLARED ONLY — not implemented yet; returns an explicit not-implemented result).'}`,
      source: spec.implemented ? spec.sources.join(', ') || 'canonical domain layer' : 'declared capability (no implementation)',
    },
    inputSchema: domainInputSchema,
    timeoutMs: 20_000,
    async execute(input, ctx) {
      return investigateDomain(spec.domain, ctx, input.lookbackDays);
    },
  };
}

let registered = false;

/** Register the domain capabilities in the ONE shared registry (idempotent). */
export function registerMarketingDomainTools(): void {
  if (registered) return;
  for (const spec of DOMAIN_SPECS) {
    if (!toolRegistry.has(spec.toolName)) toolRegistry.register(domainToolDefinition(spec));
  }
  registered = true;
}

/** Tool name for a domain (used by the orchestrator to read captured output). */
export function domainToolName(domain: IntelligenceDomain): string {
  return specFor(domain).toolName;
}

export function domainNameForTool(toolName: string): IntelligenceDomain | undefined {
  return DOMAIN_SPECS.find((s) => s.toolName === toolName)?.domain;
}
