/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MemoryEpisode.ts — Short-term EPISODIC memory for the Marketing
 * Intelligence agent (Phase 2).
 *
 * One document = one restaurant-scoped event (agent run, campaign step,
 * experiment result, …) with its objective/context, optional outcome,
 * evidence references, confidence and an EXPIRY (episodes are short-term by
 * definition — every row has expiresAt, indexed for exclusion-on-read).
 *
 * Tenant/branch scoping mirrors IntelligenceSignal: restaurantId required,
 * branchId null = restaurant-global. The MODEL never derives identity — the
 * memoryManager injects restaurantId exclusively from the authenticated
 * AiTenantContext (spec §33).
 *
 * Retrieval is INDEXED MONGODB ONLY (no vector search, no embeddings).
 */

import mongoose from 'mongoose';
import type {
  EpisodeType,
  EpisodeOutcomeStatus,
  MemoryEvidenceRecord,
  MemorySource,
} from '../../ai/memory/memoryTypes';

export interface IMemoryOutcome {
  status: EpisodeOutcomeStatus;
  summary?: string;
  metrics?: Record<string, number>;
}

export interface IMemoryEpisode extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  /** null = restaurant-global scope. */
  branchId: mongoose.Types.ObjectId | null;
  episodeType: EpisodeType;
  objective?: string;
  context?: string;
  recommendationRef?: string;
  campaignRef?: string;
  outcome?: IMemoryOutcome;
  evidence: MemoryEvidenceRecord[];
  confidence: number;
  source: MemorySource;
  metadata: Record<string, unknown>;
  runId?: string;
  createdAt: Date;
  /** Required: every episode expires (indexed for exclusion-on-read). */
  expiresAt: Date;
}

const memoryEvidenceSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: ['tool_output', 'signal', 'metric', 'campaign', 'experiment', 'model', 'manual'],
    },
    ref: { type: String, required: true, maxlength: 200 },
    label: { type: String, maxlength: 300 },
    value: { type: Number },
    sampleSize: { type: Number, min: 0 },
    observedAt: { type: String, maxlength: 40 },
  },
  { _id: false },
);

const memoryOutcomeSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ['pending', 'success', 'failure', 'partial', 'superseded', 'unknown'],
    },
    summary: { type: String, maxlength: 1000 },
    metrics: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const memoryEpisodeSchema = new mongoose.Schema<IMemoryEpisode>(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    episodeType: { type: String, required: true },
    objective: { type: String, maxlength: 500 },
    context: { type: String, maxlength: 2000 },
    recommendationRef: { type: String, maxlength: 200 },
    campaignRef: { type: String, maxlength: 200 },
    outcome: { type: memoryOutcomeSchema, default: undefined },
    evidence: { type: [memoryEvidenceSchema], default: [] },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    source: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    runId: { type: String, maxlength: 64 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// ── Compound indexes for the retrieval patterns in memoryManager ─────────────
// recency within restaurant (default "recent episodes" query)
memoryEpisodeSchema.index({ restaurantId: 1, createdAt: -1 });
// branch-scoped recency (branch tenant: own branch + global)
memoryEpisodeSchema.index({ restaurantId: 1, branchId: 1, createdAt: -1 });
// type-filtered recency
memoryEpisodeSchema.index({ restaurantId: 1, episodeType: 1, createdAt: -1 });
// expiry exclusion scans (expired rows excluded on read)
memoryEpisodeSchema.index({ restaurantId: 1, expiresAt: 1 });
// confidence floor filtering
memoryEpisodeSchema.index({ restaurantId: 1, confidence: -1, createdAt: -1 });
// relevance filter: recommendation/campaign reference lookup
memoryEpisodeSchema.index({ restaurantId: 1, campaignRef: 1 });

export default mongoose.models.MemoryEpisode ||
  mongoose.model<IMemoryEpisode>('MemoryEpisode', memoryEpisodeSchema);
