/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryManager.ts — THE single service for reading and writing the Marketing
 * Intelligence agent's memory (Phase 2 — MEMORY FOUNDATION).
 *
 * Layering rules enforced here:
 *   - Agent/loop code NEVER writes Mongo directly for memory — every write
 *     goes through this manager (validated + audited).
 *   - restaurantId/branchId ALWAYS come from the authenticated AiTenantContext
 *     parameter, never from input payloads and never from the LLM
 *     (spec §33). Input schemas are `.strict()` and tenant keys are rejected
 *     explicitly before parsing.
 *   - Retrieval is INDEXED MONGODB ONLY — no vector search, no embeddings.
 *   - Expired rows are excluded on read (exclusion-on-read; expiry timestamps
 *     are indexed). Long-term rows may be evergreen (expiresAt null).
 *   - Confidence floors and evidence references are preserved on every record
 *     so consumers can weigh memory against higher-priority sources
 *     (MEMORY_PRIORITY: current data > ML > analytics > validated historical
 *     evidence > long-term memory > LLM inference).
 *   - Every successful write is audited via the EXISTING auditService
 *     (never throws into the caller).
 *
 * This module does NOT implement learning/consolidation (Phase 8), ranking,
 * canonical BI signals or ML changes — writes happen only when explicit
 * service code calls recordEpisode/upsertLongTermMemory.
 */

import mongoose from 'mongoose';
import MemoryEpisodeModel from '../../models/memory/MemoryEpisode';
import RestaurantMemoryModel from '../../models/memory/RestaurantMemory';
import { auditService } from '../../modules/audit/auditService';
import type { AiTenantContext } from '../shared/tenantContext';
import {
  EpisodeInputSchema,
  LongTermMemoryInputSchema,
  findTenantKeysInInput,
  EPISODE_PRIORITY,
  LONG_TERM_PRIORITY,
  MEMORY_PRIORITY_STATEMENT,
  type AgentMemoryContext,
  type EpisodeInput,
  type EpisodeQueryOptions,
  type LongTermMemoryInput,
  type MemoryEpisodeRecord,
  type MemoryQueryOptions,
  type RestaurantMemoryRecord,
} from './memoryTypes';

/** Default TTL for episodic memory when the caller does not set one (30 days). */
export const DEFAULT_EPISODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Hard cap on rows returned by any retrieval call. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

/** Thrown for any invalid memory input — callers may surface this verbatim. */
export class MemoryValidationError extends Error {
  readonly code = 'memory_validation_failed';
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'MemoryValidationError';
    this.issues = issues;
  }
}

function requireTenant(tenant: AiTenantContext | undefined): {
  restaurantId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId | null;
} {
  if (!tenant?.restaurantId) {
    throw new MemoryValidationError('tenant context is required (restaurantId missing)');
  }
  if (!mongoose.Types.ObjectId.isValid(tenant.restaurantId)) {
    throw new MemoryValidationError('tenant restaurantId is not a valid id');
  }
  let branchId: mongoose.Types.ObjectId | null = null;
  if (tenant.branchId) {
    if (!mongoose.Types.ObjectId.isValid(tenant.branchId)) {
      throw new MemoryValidationError('tenant branchId is not a valid id');
    }
    branchId = new mongoose.Types.ObjectId(tenant.branchId);
  }
  return { restaurantId: new mongoose.Types.ObjectId(tenant.restaurantId), branchId };
}

/**
 * Reject tenant-identifying keys up front (defense in depth beyond the
 * strict schemas) so an LLM-supplied restaurantId can never slip through.
 */
function assertNoTenantKeys(raw: unknown): void {
  const offending = findTenantKeysInInput(raw);
  if (offending.length > 0) {
    throw new MemoryValidationError(
      `tenant identity comes from the authenticated context only — remove: ${offending.join(', ')}`,
      offending,
    );
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function parseEpisodeInput(raw: unknown): EpisodeInput {
  assertNoTenantKeys(raw);
  const parsed = EpisodeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new MemoryValidationError(`invalid episode memory: ${issues.join('; ')}`, issues);
  }
  return parsed.data;
}

function parseLongTermInput(raw: unknown): LongTermMemoryInput {
  assertNoTenantKeys(raw);
  const parsed = LongTermMemoryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new MemoryValidationError(`invalid long-term memory: ${issues.join('; ')}`, issues);
  }
  return parsed.data;
}

// ── doc → plain record mapping (mongoose documents never cross the API) ──────

function toEpisodeRecord(doc: InstanceType<typeof MemoryEpisodeModel>): MemoryEpisodeRecord {
  const d = doc as unknown as {
    _id: mongoose.Types.ObjectId;
    restaurantId: mongoose.Types.ObjectId;
    branchId: mongoose.Types.ObjectId | null;
    episodeType: MemoryEpisodeRecord['episodeType'];
    objective?: string;
    context?: string;
    recommendationRef?: string;
    campaignRef?: string;
    outcome?: MemoryEpisodeRecord['outcome'];
    evidence: MemoryEpisodeRecord['evidence'];
    confidence: number;
    source: MemoryEpisodeRecord['source'];
    metadata: Record<string, unknown>;
    runId?: string;
    createdAt: Date;
    expiresAt: Date;
  };
  return {
    id: String(d._id),
    restaurantId: String(d.restaurantId),
    branchId: d.branchId ? String(d.branchId) : null,
    episodeType: d.episodeType,
    objective: d.objective,
    context: d.context,
    recommendationRef: d.recommendationRef,
    campaignRef: d.campaignRef,
    outcome: d.outcome,
    evidence: d.evidence ?? [],
    confidence: d.confidence,
    source: d.source,
    metadata: d.metadata ?? {},
    runId: d.runId,
    createdAt: d.createdAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    priority: EPISODE_PRIORITY,
  };
}

function toMemoryRecord(doc: InstanceType<typeof RestaurantMemoryModel>): RestaurantMemoryRecord {
  const d = doc as unknown as {
    _id: mongoose.Types.ObjectId;
    restaurantId: mongoose.Types.ObjectId;
    branchId: mongoose.Types.ObjectId | null;
    memoryType: RestaurantMemoryRecord['memoryType'];
    entityRef: string;
    value: Record<string, unknown>;
    confidence: number;
    sampleSize?: number;
    evidence: RestaurantMemoryRecord['evidence'];
    source: RestaurantMemoryRecord['source'];
    status: RestaurantMemoryRecord['status'];
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    lastValidatedAt?: Date;
    expiresAt?: Date | null;
  };
  return {
    id: String(d._id),
    restaurantId: String(d.restaurantId),
    branchId: d.branchId ? String(d.branchId) : null,
    memoryType: d.memoryType,
    entityRef: d.entityRef ?? '',
    value: d.value,
    confidence: d.confidence,
    sampleSize: d.sampleSize,
    evidence: d.evidence ?? [],
    source: d.source,
    status: d.status,
    tags: d.tags ?? [],
    metadata: d.metadata ?? {},
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    lastValidatedAt: d.lastValidatedAt?.toISOString(),
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    priority: LONG_TERM_PRIORITY,
  };
}

// ── shared query shaping ─────────────────────────────────────────────────────

/**
 * Branch scoping (never widens tenant isolation):
 *   branch tenant  → own branch OR restaurant-global rows (branchScope auto)
 *   restaurant tenant → every branch of that restaurant
 *   'global' → only restaurant-global rows; 'all' → every branch (restaurant
 *   tenants only — a branch tenant asking for 'all' is downgraded to auto).
 */
function branchClause(
  scope: { restaurantId: mongoose.Types.ObjectId; branchId: mongoose.Types.ObjectId | null },
  branchScope: 'auto' | 'global' | 'all' | undefined,
): Record<string, unknown> {
  if (branchScope === 'global') return { branchId: null };
  if (scope.branchId) {
    // Branch tenant: 'all' cannot widen past its own branch.
    return { $or: [{ branchId: null }, { branchId: scope.branchId }] };
  }
  // Restaurant tenant: all branches + global (explicit 'global' handled above).
  return {};
}

function expiryClause(includeExpired: boolean | undefined): Record<string, unknown> {
  if (includeExpired) return {};
  // $or-shape: never expires (null/absent — long-term evergreen facts) OR
  // expires in the future. Episodes always carry expiresAt.
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Write one episodic memory. Branch scope: input.branchId (must match the
 * authenticated tenant's branch) or the tenant's own branch; restaurant
 * tenants may scope explicitly or leave it global.
 */
export async function recordEpisode(
  tenant: AiTenantContext,
  rawInput: unknown,
): Promise<MemoryEpisodeRecord> {
  const scope = requireTenant(tenant);
  const input = parseEpisodeInput(rawInput);

  let branchId = scope.branchId;
  const raw = rawInput as { branchId?: unknown } | undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.branchId !== undefined) {
    const requested = String(raw.branchId);
    if (!mongoose.Types.ObjectId.isValid(requested)) {
      throw new MemoryValidationError('episode branchId is not a valid id');
    }
    if (scope.branchId && requested !== String(scope.branchId)) {
      throw new MemoryValidationError('episode branchId does not match the authenticated branch scope');
    }
    branchId = new mongoose.Types.ObjectId(requested);
  }

  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_EPISODE_TTL_MS);

  const doc = await MemoryEpisodeModel.create({
    restaurantId: scope.restaurantId,
    branchId,
    episodeType: input.episodeType,
    objective: input.objective,
    context: input.context,
    recommendationRef: input.recommendationRef,
    campaignRef: input.campaignRef,
    outcome: input.outcome,
    evidence: input.evidence,
    confidence: input.confidence,
    source: input.source,
    metadata: input.metadata,
    runId: input.runId,
    expiresAt,
  });

  const record = toEpisodeRecord(doc);
  await auditMemoryWrite({
    action: 'agent_memory_episode_recorded',
    entityType: 'memory_episode',
    entityId: record.id,
    tenant,
    details: {
      episodeType: record.episodeType,
      source: record.source,
      confidence: record.confidence,
      evidenceCount: record.evidence.length,
      branchScoped: record.branchId !== null,
      expiresAt: record.expiresAt,
    },
  });
  return record;
}

/**
 * Retrieve recent episodes for the authenticated tenant.
 * Indexed filter: restaurant (+branch) → type → recency → confidence →
 * expiry exclusion → relevance (relatedTo).
 */
export async function getRecentEpisodes(
  tenant: AiTenantContext,
  opts: EpisodeQueryOptions = {},
): Promise<MemoryEpisodeRecord[]> {
  const scope = requireTenant(tenant);
  const filter: Record<string, unknown> = {
    restaurantId: scope.restaurantId,
  };
  // Branch scope and expiry go through $and so a later $or (relatedTo) can
  // never overwrite them — tenant isolation must not be order-dependent.
  const and: Record<string, unknown>[] = [branchClause(scope, opts.branchScope)];
  const expiry = expiryClause(opts.includeExpired);
  if (Object.keys(expiry).length > 0) and.push(expiry);
  if (opts.episodeTypes && opts.episodeTypes.length > 0) {
    filter.episodeType = { $in: opts.episodeTypes };
  }
  if (typeof opts.minConfidence === 'number') {
    filter.confidence = { $gte: Math.max(0, Math.min(1, opts.minConfidence)) };
  }
  if (opts.sinceDays && Number.isFinite(opts.sinceDays)) {
    filter.createdAt = { $gte: new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000) };
  }
  if (opts.relatedTo) {
    and.push({ $or: [{ recommendationRef: opts.relatedTo }, { campaignRef: opts.relatedTo }] });
  }
  filter.$and = and;

  const docs = await MemoryEpisodeModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(clampLimit(opts.limit))
    .lean()
    .exec();
  return docs.map((d) => toEpisodeRecord(d as never));
}

/**
 * Write/update one long-term memory (upsert on restaurant+branch+type+entity).
 * lastValidatedAt refreshes on every write so staleness stays observable.
 */
export async function upsertLongTermMemory(
  tenant: AiTenantContext,
  rawInput: unknown,
): Promise<RestaurantMemoryRecord> {
  const scope = requireTenant(tenant);
  const input = parseLongTermInput(rawInput);

  let branchId = scope.branchId;
  const raw = rawInput as { branchId?: unknown } | undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.branchId !== undefined) {
    const requested = String(raw.branchId);
    if (!mongoose.Types.ObjectId.isValid(requested)) {
      throw new MemoryValidationError('memory branchId is not a valid id');
    }
    if (scope.branchId && requested !== String(scope.branchId)) {
      throw new MemoryValidationError('memory branchId does not match the authenticated branch scope');
    }
    branchId = new mongoose.Types.ObjectId(requested);
  }

  const now = new Date();
  const filter = {
    restaurantId: scope.restaurantId,
    branchId,
    memoryType: input.memoryType,
    entityRef: input.entityRef,
  };
  const update = {
    $set: {
      value: input.value,
      confidence: input.confidence,
      sampleSize: input.sampleSize,
      evidence: input.evidence,
      source: input.source,
      status: input.status,
      tags: input.tags,
      metadata: input.metadata,
      expiresAt: input.expiresAt ?? null,
      lastValidatedAt: input.lastValidatedAt ?? now,
    },
    $setOnInsert: { createdAt: now },
  };

  const doc = await RestaurantMemoryModel.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  }).exec();

  const record = toMemoryRecord(doc!);
  await auditMemoryWrite({
    action: 'agent_memory_longterm_upserted',
    entityType: 'restaurant_memory',
    entityId: record.id,
    tenant,
    details: {
      memoryType: record.memoryType,
      entityRef: record.entityRef,
      source: record.source,
      status: record.status,
      confidence: record.confidence,
      sampleSize: record.sampleSize ?? null,
      evidenceCount: record.evidence.length,
      branchScoped: record.branchId !== null,
      lastValidatedAt: record.lastValidatedAt,
    },
  });
  return record;
}

/**
 * Retrieve relevant long-term memories for the authenticated tenant.
 * Indexed filter: restaurant (+branch) → status → type/tags/entity →
 * recency → confidence → expiry exclusion.
 */
export async function getRelevantMemories(
  tenant: AiTenantContext,
  opts: MemoryQueryOptions = {},
): Promise<RestaurantMemoryRecord[]> {
  const scope = requireTenant(tenant);
  const filter: Record<string, unknown> = {
    restaurantId: scope.restaurantId,
    status: opts.status ?? 'active',
  };
  const and: Record<string, unknown>[] = [branchClause(scope, opts.branchScope)];
  const expiry = expiryClause(opts.includeExpired);
  if (Object.keys(expiry).length > 0) and.push(expiry);
  if (opts.memoryTypes && opts.memoryTypes.length > 0) {
    filter.memoryType = { $in: opts.memoryTypes };
  }
  if (opts.entityRef !== undefined) {
    filter.entityRef = opts.entityRef;
  }
  if (opts.tags && opts.tags.length > 0) {
    filter.tags = { $in: opts.tags };
  }
  if (typeof opts.minConfidence === 'number') {
    filter.confidence = { $gte: Math.max(0, Math.min(1, opts.minConfidence)) };
  }
  if (opts.sinceDays && Number.isFinite(opts.sinceDays)) {
    filter.updatedAt = { $gte: new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000) };
  }
  filter.$and = and;

  const docs = await RestaurantMemoryModel.find(filter)
    .sort({ updatedAt: -1 })
    .limit(clampLimit(opts.limit))
    .lean()
    .exec();
  return docs.map((d) => toMemoryRecord(d as never));
}

/**
 * Load the memory snapshot used at the START of an agent run: recent
 * episodic memories + relevant long-term memories, tenant/branch scoped,
 * expired excluded. NEVER throws — degrades to an empty, flagged context so
 * the agent always starts (memory is context, never a gate).
 */
export async function loadMemoryContext(
  tenant: AiTenantContext,
  opts: { episodeLimit?: number; memoryLimit?: number; sinceDays?: number } = {},
): Promise<AgentMemoryContext> {
  const loadedAt = new Date().toISOString();
  // No DB connection → degrade immediately instead of waiting out mongoose's
  // buffering timeout (memory must never stall a run).
  if (mongoose.connection.readyState !== 1) {
    return {
      episodes: [],
      longTerm: [],
      priorityStatement: MEMORY_PRIORITY_STATEMENT,
      loadedAt,
      degraded: true,
      reason: 'database not connected',
    };
  }
  try {
    const [episodes, longTerm] = await Promise.all([
      getRecentEpisodes(tenant, {
        limit: opts.episodeLimit ?? 5,
        sinceDays: opts.sinceDays ?? 60,
      }),
      getRelevantMemories(tenant, {
        limit: opts.memoryLimit ?? 5,
        minConfidence: 0.3,
      }),
    ]);
    return { episodes, longTerm, priorityStatement: MEMORY_PRIORITY_STATEMENT, loadedAt };
  } catch (err) {
    return {
      episodes: [],
      longTerm: [],
      priorityStatement: MEMORY_PRIORITY_STATEMENT,
      loadedAt,
      degraded: true,
      reason: err instanceof Error ? err.message.slice(0, 300) : 'memory load failed',
    };
  }
}

/** Audit one memory write through the EXISTING audit trail (never throws). */
async function auditMemoryWrite(input: {
  action: string;
  entityType: string;
  entityId: string;
  tenant: AiTenantContext;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await auditService.log({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      restaurantId: input.tenant.restaurantId,
      branchId: input.tenant.branchId,
      success: true,
      status: 'success',
      comments: 'Marketing agent memory write (Phase 2) — metadata only, no payload values.',
      details: {
        agent: 'marketing_agent',
        ...input.details,
      },
    });
  } catch {
    // Observability must never break the memory path.
  }
}

/** The single memory service surface (agent code must not bypass it). */
export const memoryManager = {
  recordEpisode,
  getRecentEpisodes,
  upsertLongTermMemory,
  getRelevantMemories,
  loadMemoryContext,
  MemoryValidationError,
  DEFAULT_EPISODE_TTL_MS,
};

export default memoryManager;
