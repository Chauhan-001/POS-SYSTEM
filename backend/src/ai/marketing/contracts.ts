/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * contracts.ts — the target contracts for the canonical Marketing Agent path.
 *
 * These types are the single vocabulary every layer of the rebuild compiles
 * against: the signal scanner digest, the domain capability layer, the
 * Marketing Manager loop, the Situation Model, deterministic validation, the
 * Final Critic and the `/analyze` response.
 *
 * HARD RULES encoded here (spec §2/§9/§26):
 *   - NO chain-of-thought field exists anywhere in this contract. The agent
 *     returns structured findings, evidence references and verdicts only.
 *   - EVERY fact carries `evidenceRefs` so nothing can be asserted without a
 *     traceable source.
 *   - A domain that was not measured reports `unavailable` — never "healthy".
 *   - `implemented:false` marks a DECLARED-ONLY capability (no definition yet);
 *     consumers must disclose it instead of treating it as empty evidence.
 */

import { z } from 'zod';
import type { BusinessSignal } from '../intelligence/businessSignalTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Domains
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The domain-level intelligence surface the Marketing Manager investigates.
 * These are DOMAINS, not database tools: each one answers a business question
 * and internally decides which low-level read-only tools to call.
 */
export const INTELLIGENCE_DOMAINS = [
  'sales',
  'products',
  'inventory',
  'customers',
  'feedback',
  'marketing_history',
  'context',
  'competition',
  'ml',
] as const;

export type IntelligenceDomain = (typeof INTELLIGENCE_DOMAINS)[number];

/** Per-domain outcome. `unavailable` is a first-class, honest result. */
export const DOMAIN_STATUSES = ['ok', 'partial', 'unavailable'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** A single traceable piece of evidence. `ref` is stable and machine-usable. */
export interface DomainEvidenceRef {
  /** Stable reference, e.g. `signal:product_low_margin:abc123` or `tool:getUpsell`. */
  ref: string;
  /** Owner-readable label. No ids, no PII. */
  label: string;
  kind: 'signal' | 'tool' | 'ml' | 'memory' | 'declared';
  domain: IntelligenceDomain;
}

/** A deterministic, evidence-backed observation (never advice). */
export interface DomainFinding {
  code: string;
  domain: IntelligenceDomain;
  statement: string;
  confidence: number;
  evidenceRefs: string[];
}

/**
 * One domain investigation result. Produced deterministically from tool
 * output — the LLM never authors findings, it only decides WHICH domain to
 * investigate next.
 */
export interface DomainInvestigation {
  domain: IntelligenceDomain;
  status: DomainStatus;
  /** The business question this domain answers. */
  question: string;
  findings: DomainFinding[];
  signals: BusinessSignal[];
  evidenceRefs: string[];
  /** Present when status !== 'ok'. Machine-readable where possible. */
  reasonCode?: string;
  /** Owner-safe explanation of the limitation. */
  degradedReason?: string;
  /** Explicit caveats/limits (e.g. coverage not checked yet). */
  limits?: string[];
  /** FALSE for DECLARED-ONLY capabilities (no implementation yet). */
  implemented: boolean;
  durationMs: number;
  generatedAt: string;
}

/** The domain catalog entry shown to the model and the owner. */
export interface DomainCapabilityDescriptor {
  domain: IntelligenceDomain;
  /** The question this domain answers — this is what the model chooses on. */
  question: string;
  /** Underlying authoritative sources (names only). */
  sources: string[];
  /** FALSE when the capability is declared but not implemented yet. */
  implemented: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Situation model
// ─────────────────────────────────────────────────────────────────────────────

/** A fact the run could establish, always tied to evidence. */
export interface SituationFact {
  statement: string;
  domain: IntelligenceDomain;
  confidence: number;
  evidenceRefs: string[];
}

/** A direction the candidate engine should explore (never an offer itself). */
export interface CandidateDirection {
  /** Short machine code, e.g. `protect_slow_item_margin`. */
  direction: string;
  domain: IntelligenceDomain;
  objective: string;
  mechanism: string;
  target: {
    productIds: string[];
    productNames: string[];
    categoryIds: string[];
    segmentIds: string[];
  };
  evidenceRefs: string[];
}

/**
 * The structured understanding the run reached. This is NOT hidden reasoning:
 * every entry is a claim with evidence, and unresolved disagreement is
 * surfaced as a contradiction rather than silently resolved.
 */
export interface SituationModel {
  objective: string;
  /** Domains that actually contributed evidence. */
  investigatedDomains: Array<{
    domain: IntelligenceDomain;
    status: DomainStatus;
    findingCount: number;
    signalCount: number;
    reasonCode?: string;
    degradedReason?: string;
    implemented: boolean;
  }>;
  /** Domains with NO usable evidence — conclusions may not be drawn from them. */
  unavailableDomains: IntelligenceDomain[];
  confirmedFacts: SituationFact[];
  opportunities: SituationFact[];
  risks: SituationFact[];
  /** Explicit, unresolved disagreement between domains. */
  contradictions: string[];
  uncertainties: string[];
  missingEvidence: string[];
  topSignals: BusinessSignal[];
  candidateDirections: CandidateDirection[];
  confidence: number;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic validation + critic (LLM-facing parts are zod-validated)
// ─────────────────────────────────────────────────────────────────────────────

export const VALIDATION_CHECK_NAMES = [
  'economic_safety',
  'business_constraints',
  'promotion_fatigue',
  'inventory_feasibility',
  'marketing_conflict',
  'customer_eligibility',
  'safety',
] as const;
export type ValidationCheckName = (typeof VALIDATION_CHECK_NAMES)[number];

export type ValidationStatus = 'pass' | 'fail' | 'not_implemented' | 'skipped';

export interface ValidationCheck {
  name: ValidationCheckName;
  status: ValidationStatus;
  detail: string;
}

/** The authoritative verdict for one candidate. The LLM can never override it. */
export interface CandidateValidation {
  candidateId: string;
  passed: boolean;
  /** Machine-readable reasons for rejection (empty when passed). */
  rejectionCodes: string[];
  checks: ValidationCheck[];
}

export const CRITIC_VERDICTS = ['PASS', 'DOWNGRADE', 'REJECT'] as const;

/**
 * The Final Critic's output, parsed STRICTLY. `.strict()` is load-bearing: a
 * model that returns a `reasoning`/`chainOfThought`/`thinking` field fails
 * validation, which is how the no-hidden-reasoning rule is enforced at runtime
 * rather than by convention.
 */
export const criticVerdictSchema = z
  .object({
    candidateId: z.string().min(1).max(120),
    verdict: z.enum(CRITIC_VERDICTS),
    /** Downward-only confidence adjustment (0..1). */
    confidenceDelta: z.number().min(-1).max(0).optional(),
    reasons: z.array(z.string().min(1).max(300)).max(6),
  })
  .strict();

export const criticResponseSchema = z
  .object({ verdicts: z.array(criticVerdictSchema).max(12) })
  .strict();

export type CriticVerdictOutput = z.infer<typeof criticVerdictSchema>;

/** The critic's applied outcome for one recommendation. */
export interface CriticVerdict {
  candidateId: string;
  verdict: (typeof CRITIC_VERDICTS)[number];
  reasons: string[];
  confidenceDelta: number;
  /** 'llm' when the model reviewed it; 'deterministic_fallback' otherwise. */
  source: 'llm' | 'deterministic_fallback';
  /** Numbers the model stated that could NOT be grounded — stripped. */
  strippedClaims: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Request / response
// ─────────────────────────────────────────────────────────────────────────────

export const analyzeRequestSchema = z
  .object({
    /** Optional owner question. Never trusted raw — bounded + sanitized. */
    goal: z.string().min(1).max(300).optional(),
    lookbackDays: z.number().int().min(7).max(365).optional(),
    /** Final shortlist size (the spec target is 8–10). */
    limit: z.number().int().min(1).max(12).optional(),
  })
  .strict();

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const ANALYZE_STATUSES = [
  /** Investigation completed and the shortlist was produced. */
  'completed',
  /** Completed with disclosed degradations (missing domains / ML / memory). */
  'completed_degraded',
  /** The LLM was unavailable — deterministic layers only, disclosed. */
  'degraded_no_llm',
  /** Nothing usable could be produced. */
  'failed',
] as const;
export type AnalyzeStatus = (typeof ANALYZE_STATUSES)[number];

/** Bounded investigation telemetry (never prompts, never raw payloads). */
export interface InvestigationSummary {
  runId: string;
  status: string;
  stepsUsed: number;
  toolCallsUsed: number;
  llmCalls: number;
  domainsInvestigated: IntelligenceDomain[];
  domainsUnavailable: IntelligenceDomain[];
  domainOrder: IntelligenceDomain[];
  stopGuardObjections: string[];
  rejections: Array<{ ref: string; reason: string; stage: string }>;
  tokensUsed: number;
  costUsd: number;
  errorCode?: string;
}

export interface AnalyzedRecommendation {
  /** Ranked, deterministic recommendation (engine economics carried verbatim). */
  recommendation: {
    rank: number;
    id: string;
    type: string;
    strategy: string;
    strategyLabel: string;
    title: string;
    description: string;
    recommendedAction: string;
    engineScore: number;
    confidence: number;
    priority: string;
    economics: unknown;
    target: unknown;
    risks: string[];
    prerequisites: string[];
    why: string[];
    provenance: unknown;
  };
  /** Deterministic validation verdict — authoritative, LLM cannot override. */
  validation: CandidateValidation;
  /** Independent critic review. */
  critic: CriticVerdict;
}

/**
 * What the investigated directions did to the deterministic engine (Phase 8).
 * Always reported, so a direction can never look satisfied when it was not.
 */
export interface DirectionPolicyReport {
  /** True when engine generation was restricted to `types`. */
  applied: boolean;
  /** The engine promotion types generation was restricted to (empty = unrestricted). */
  types: string[];
  /** Directions with no engine representation at all (reported, never forced). */
  unrepresentableDirections: string[];
  /** Directions that produced at least one candidate. */
  realisedDirections: string[];
  /** Directions that produced no candidate (never padded). */
  unrealisedDirections: string[];
  /** True when the restricted run produced nothing and the unrestricted engine was used. */
  fallbackUsed: boolean;
  note: string;
}

export interface AnalyzeResponse {
  mode: 'marketing_analyze';
  runId: string;
  status: AnalyzeStatus;
  objective: string;
  situation: SituationModel;
  investigation: InvestigationSummary;
  recommendations: AnalyzedRecommendation[];
  /** How the investigated directions constrained the candidate engine. */
  directionPolicy: DirectionPolicyReport;
  /** Number of candidates the deterministic layers rejected, with reasons. */
  rejected: Array<{ candidateId: string; title: string; codes: string[] }>;
  /**
   * Outcome of the REAL per-product validation sources (Phase 10), so the
   * owner can see whether feasibility was actually assessed or skipped.
   */
  validationSources: {
    stockout: { status: 'ok' | 'unavailable'; detail: string };
    activeOffers: { status: 'ok' | 'unavailable'; detail: string };
  };
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  degradations: string[];
  /** Memory counts only (statements are surfaced in the situation model). */
  memory: { episodes: number; longTerm: number; degraded: boolean };
  /** PHASE 14 — what this analysis wrote to memory (always disclosed). */
  memoryWrite: {
    attempted: boolean;
    episodeWritten: boolean;
    episodeId?: string;
    recommendationsRecorded: number;
    reason?: string;
  };
  /**
   * PHASE 15 — learning folded into memory from ALREADY-MEASURED outcomes, and
   * per-item patterns refreshed. Counts only; the numbers themselves live in
   * the measured outcome rows and the stored memory.
   */
  outcomeLearning: {
    outcomesLinked: number;
    outcomesPositive: number;
    outcomesNegative: number;
    /** Rows with no usable variance — counted, never guessed. */
    outcomesUnusable: number;
    /** Outcomes measured against a control group (the only causal ones). */
    causalOutcomes: number;
    productPatternsWritten: number;
    productPatternsSkippedFresh: boolean;
    notes: string[];
  };
  /** The owner-approval reminder. Nothing here creates or sends anything. */
  approvalRequired: true;
  generatedAt: string;
}
