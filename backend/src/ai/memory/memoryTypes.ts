/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryTypes.ts — Typed memory structures for the Marketing Intelligence
 * agent (Phase 2 — MEMORY FOUNDATION).
 *
 * Three layers (spec §33):
 *   1. WORKING memory      — already exists in shared/agentRunContext.ts
 *                            (per-run, never persisted). NOT duplicated here.
 *   2. EPISODIC memory     — MemoryEpisode (short-term, expiring events).
 *   3. LONG-TERM memory    — RestaurantMemory (validated, structured facts).
 *
 * HARD RULES:
 *   - restaurantId NEVER comes from the LLM or from input payloads. Every
 *     input schema is `.strict()` and tenant-identifying keys are rejected
 *     explicitly below (reusing Phase 1 FORBIDDEN_LLM_ARG_KEYS). The tenant
 *     always comes from the authenticated AiTenantContext.
 *   - Memory is CONTEXTUAL EVIDENCE, never authority (see MEMORY_PRIORITY):
 *     current business data > current ML > current analytics > validated
 *     historical evidence > long-term memory > LLM inference.
 *   - No embeddings, no vector search — retrieval is indexed MongoDB only.
 *   - No unsupported LLM claims as facts: LLM-sourced memories are capped at
 *     low confidence and require at least one evidence reference.
 */

import { z } from 'zod';
import { FORBIDDEN_LLM_ARG_KEYS } from '../shared/agentRunContext';

// ─────────────────────────────────────────────────────────────────────────────
// Source priority (spec §3 — memory never overrides current data)
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered from MOST to LEAST authoritative. Lower rank = more authority. */
export const MEMORY_PRIORITY = [
  'current_business_data',
  'current_ml',
  'current_analytics',
  'validated_historical_evidence',
  'long_term_memory',
  'llm_inference',
] as const;

export type MemoryPrioritySource = (typeof MEMORY_PRIORITY)[number];

/** Human/LLM-readable priority statement — injected into the agent prompt. */
export const MEMORY_PRIORITY_STATEMENT =
  'current authoritative business data > current ML > current analytics > validated historical evidence > long-term memory > LLM inference';

/** Rank (0 = highest authority). Unknown sources rank last. */
export function memoryPriorityRank(source: string): number {
  const i = (MEMORY_PRIORITY as readonly string[]).indexOf(source);
  return i === -1 ? MEMORY_PRIORITY.length : i;
}

/** Priority label carried by retrieved memory records (contextual evidence). */
export const EPISODE_PRIORITY: MemoryPrioritySource = 'validated_historical_evidence';
export const LONG_TERM_PRIORITY: MemoryPrioritySource = 'long_term_memory';

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

/** Event/episode types recorded in short-term episodic memory. */
export const EPISODE_TYPES = [
  'agent_run',
  'recommendation_issued',
  'campaign_proposed',
  'campaign_launched',
  'campaign_completed',
  'offer_sent',
  'offer_redeemed',
  'experiment_result',
  'manual_note',
] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];

/** Long-term restaurant memory types (structured, validated facts). */
export const LONG_TERM_MEMORY_TYPES = [
  'customer_behavior_pattern',
  'campaign_performance_pattern',
  'seasonality_pattern',
  'price_sensitivity_pattern',
  'promotion_fatigue_pattern',
  'channel_preference_pattern',
  'branch_performance_pattern',
  'audience_response_pattern',
  /**
   * Phase 15: per-item demand/margin pattern ("product X: high demand, weak
   * margin"). Computed arithmetically from menu engineering — never from an
   * LLM — and keyed by `product:<id>` so it upserts rather than accumulating.
   */
  'product_performance_pattern',
] as const;
export type LongTermMemoryType = (typeof LONG_TERM_MEMORY_TYPES)[number];

/** Who/what produced the memory. Deterministic sources rank above LLM. */
export const MEMORY_SOURCES = [
  'agent_run',
  'deterministic_agent',
  'service',
  'scheduler',
  'human',
  'llm',
] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Validity status of a long-term memory. */
export const MEMORY_STATUSES = ['active', 'superseded', 'invalidated'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** Outcome status attached to an episode. */
export const EPISODE_OUTCOME_STATUSES = [
  'pending',
  'success',
  'failure',
  'partial',
  'superseded',
  'unknown',
] as const;
export type EpisodeOutcomeStatus = (typeof EPISODE_OUTCOME_STATUSES)[number];

/** Maximum confidence an LLM-sourced memory may ever carry. */
export const MAX_LLM_MEMORY_CONFIDENCE = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Evidence references (reuses the IntelligenceSignal evidence conventions:
// description/ref, numeric value, sampleSize, confidence — spec §7)
// ─────────────────────────────────────────────────────────────────────────────

export const MemoryEvidenceSchema = z
  .object({
    /** What kind of thing the evidence points at. */
    kind: z.enum(['tool_output', 'signal', 'metric', 'campaign', 'experiment', 'model', 'manual']),
    /** Stable reference, e.g. 'campaign:6543…', 'signal:SALES_DAILY_REVENUE'. */
    ref: z.string().min(1).max(200),
    /** Optional human-readable label. */
    label: z.string().max(300).optional(),
    /** Optional observed numeric value. */
    value: z.number().finite().optional(),
    /** Optional sample size backing the evidence. */
    sampleSize: z.number().int().min(0).optional(),
    /** Optional ISO timestamp of the observation. */
    observedAt: z.string().max(40).optional(),
  })
  .strict();

export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Input schemas — STRICT: tenant keys are never accepted (spec §33)
// ─────────────────────────────────────────────────────────────────────────────

const optionalDate = z
  .union([z.date(), z.string()])
  .refine((v) => (v instanceof Date ? !Number.isNaN(v.getTime()) : !Number.isNaN(Date.parse(v))), {
    message: 'invalid date',
  })
  .transform((v) => (v instanceof Date ? v : new Date(v)));

/** Episode (short-term, branch/global scoped by the AUTHENTICATED tenant). */
export const EpisodeInputSchema = z
  .object({
    episodeType: z.enum(EPISODE_TYPES),
    /**
     * Optional branch scope. NOT a tenant-identity key: the manager verifies
     * it matches the authenticated tenant's branch (branch tenants cannot
     * cross branches) before persisting.
     */
    branchId: z.string().max(64).optional(),
    /** What the run/actor was trying to do. */
    objective: z.string().max(500).optional(),
    /** Free-form situational context. */
    context: z.string().max(2000).optional(),
    /** Recommendation / campaign references (opaque ids, no tenant data). */
    recommendationRef: z.string().max(200).optional(),
    campaignRef: z.string().max(200).optional(),
    /** Outcome information (Phase 8 will fill this from real results). */
    outcome: z
      .object({
        status: z.enum(EPISODE_OUTCOME_STATUSES),
        summary: z.string().max(1000).optional(),
        /** Numeric outcome metrics (redemption rate, lift, …). */
        metrics: z.record(z.string(), z.number().finite()).optional(),
      })
      .strict()
      .optional(),
    /** Evidence references backing this episode. */
    evidence: z.array(MemoryEvidenceSchema).max(20).default([]),
    /** Confidence 0..1 in the recorded content. */
    confidence: z.number().min(0).max(1).default(1),
    /** Producer of this memory. */
    source: z.enum(MEMORY_SOURCES),
    /** Small structured extras — never secrets, never tenant identity. */
    metadata: z.record(z.string(), z.unknown()).default({}),
    /** Correlates the episode to the agent run that produced it. */
    runId: z.string().max(64).optional(),
    /** Explicit expiry (allowed to be in the past — TTL semantics are data). */
    expiresAt: optionalDate.optional(),
  })
  .strict()
  .refine(
    (d) =>
      !((d.source === 'llm') && d.confidence > MAX_LLM_MEMORY_CONFIDENCE),
    { message: `llm-sourced memory confidence may not exceed ${MAX_LLM_MEMORY_CONFIDENCE}` },
  )
  .refine((d) => d.source !== 'llm' || d.evidence.length > 0, {
    message: 'llm-sourced memory requires at least one evidence reference',
  });

export type EpisodeInput = z.infer<typeof EpisodeInputSchema>;

/** Long-term restaurant memory (structured value, validated). */
export const LongTermMemoryInputSchema = z
  .object({
    memoryType: z.enum(LONG_TERM_MEMORY_TYPES),
    /**
     * Optional branch scope. NOT a tenant-identity key: the manager verifies
     * it matches the authenticated tenant's branch before persisting.
     */
    branchId: z.string().max(64).optional(),
    /**
     * Optional subject of the memory (e.g. 'segment:vip', 'product:paneer-tikka').
     * Empty string = restaurant-wide memory of this type.
     */
    entityRef: z.string().max(200).default(''),
    /** Structured value — the validated fact/aggregate itself. */
    value: z.record(z.string(), z.unknown()),
    /** Confidence 0..1. */
    confidence: z.number().min(0).max(1),
    /** Sample size behind the value, where applicable. */
    sampleSize: z.number().int().min(0).optional(),
    /** Evidence references backing this memory. */
    evidence: z.array(MemoryEvidenceSchema).max(20).default([]),
    /** Producer of this memory. */
    source: z.enum(MEMORY_SOURCES),
    /** Validity status (default active). */
    status: z.enum(MEMORY_STATUSES).default('active'),
    /** Free-form relevance tags for retrieval filters. */
    tags: z.array(z.string().max(40)).max(20).default([]),
    /** Small structured extras — never secrets, never tenant identity. */
    metadata: z.record(z.string(), z.unknown()).default({}),
    /** Explicit expiry (null/absent = no expiry). */
    expiresAt: optionalDate.optional(),
    /** When the value was last validated against current data. */
    lastValidatedAt: optionalDate.optional(),
  })
  .strict()
  .refine(
    (d) =>
      !((d.source === 'llm') && d.confidence > MAX_LLM_MEMORY_CONFIDENCE),
    { message: `llm-sourced memory confidence may not exceed ${MAX_LLM_MEMORY_CONFIDENCE}` },
  )
  .refine((d) => d.source !== 'llm' || d.evidence.length > 0, {
    message: 'llm-sourced memory requires at least one evidence reference',
  });

export type LongTermMemoryInput = z.infer<typeof LongTermMemoryInputSchema>;

/**
 * Reject tenant-identifying keys BEFORE parsing so the failure message is
 * explicit: restaurant identity comes from the authenticated context only.
 * Returns the offending keys (empty array = clean).
 */
export function findTenantKeysInInput(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const keys = Object.keys(raw as Record<string, unknown>);
  const forbidden = new Set<string>(FORBIDDEN_LLM_ARG_KEYS as readonly string[]);
  forbidden.add('restaurant');
  forbidden.add('tenant');
  return keys.filter((k) => forbidden.has(k));
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieved record views (plain JSON — no mongoose documents cross the API)
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryEvidenceRecord {
  kind: 'tool_output' | 'signal' | 'metric' | 'campaign' | 'experiment' | 'model' | 'manual';
  ref: string;
  label?: string;
  value?: number;
  sampleSize?: number;
  observedAt?: string;
}

export interface MemoryEpisodeRecord {
  id: string;
  restaurantId: string;
  /** null = restaurant-global scope. */
  branchId: string | null;
  episodeType: EpisodeType;
  objective?: string;
  context?: string;
  recommendationRef?: string;
  campaignRef?: string;
  outcome?: {
    status: EpisodeOutcomeStatus;
    summary?: string;
    metrics?: Record<string, number>;
  };
  evidence: MemoryEvidenceRecord[];
  confidence: number;
  source: MemorySource;
  metadata: Record<string, unknown>;
  runId?: string;
  createdAt: string;
  expiresAt: string;
  /** Source-priority label — contextual evidence, never authority. */
  priority: MemoryPrioritySource;
}

export interface RestaurantMemoryRecord {
  id: string;
  restaurantId: string;
  /** null = restaurant-global scope. */
  branchId: string | null;
  memoryType: LongTermMemoryType;
  entityRef: string;
  value: Record<string, unknown>;
  confidence: number;
  sampleSize?: number;
  evidence: MemoryEvidenceRecord[];
  source: MemorySource;
  status: MemoryStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  expiresAt: string | null;
  /** Source-priority label — contextual evidence, never authority. */
  priority: MemoryPrioritySource;
}

/**
 * Memory context loaded into WORKING memory at the start of a run.
 * It is a run-local snapshot: it never persists back automatically
 * (consolidation is Phase 8, evidence-gated).
 */
export interface AgentMemoryContext {
  episodes: MemoryEpisodeRecord[];
  longTerm: RestaurantMemoryRecord[];
  /** Priority statement injected into prompts. */
  priorityStatement: string;
  /** ISO timestamp of when the snapshot was taken (null until loaded). */
  loadedAt: string;
  /** True when loading failed/degraded — the run continues without memory. */
  degraded?: boolean;
  /** Why loading degraded (never contains tenant data). */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval options (indexed MongoDB filters — NO vector search)
// ─────────────────────────────────────────────────────────────────────────────

export interface EpisodeQueryOptions {
  /** Only episodes newer than N days. */
  sinceDays?: number;
  /** Restrict to specific episode types. */
  episodeTypes?: EpisodeType[];
  /** Minimum confidence (0..1). */
  minConfidence?: number;
  /** Match recommendationRef or campaignRef. */
  relatedTo?: string;
  /** Max rows (1..50, default 10). */
  limit?: number;
  /** Include expired rows (audit/debug only). */
  includeExpired?: boolean;
  /**
   * Branch scoping:
   *  'auto'   (default) — branch tenant sees own branch + global; restaurant
   *                       tenant sees every branch of the restaurant.
   *  'global' — only restaurant-global rows.
   *  'all'    — every branch of the restaurant (restaurant-level callers).
   */
  branchScope?: 'auto' | 'global' | 'all';
}

export interface MemoryQueryOptions {
  /** Only memories created/updated within N days. */
  sinceDays?: number;
  /** Restrict to specific memory types. */
  memoryTypes?: LongTermMemoryType[];
  /** Exact subject match (e.g. 'segment:vip'). */
  entityRef?: string;
  /** Relevance filter: at least one tag must match. */
  tags?: string[];
  /** Minimum confidence (0..1). */
  minConfidence?: number;
  /** Validity status filter (default 'active'). */
  status?: MemoryStatus;
  /** Max rows (1..50, default 10). */
  limit?: number;
  /** Include expired rows (audit/debug only). */
  includeExpired?: boolean;
  /** Branch scoping — see EpisodeQueryOptions.branchScope. */
  branchScope?: 'auto' | 'global' | 'all';
}
