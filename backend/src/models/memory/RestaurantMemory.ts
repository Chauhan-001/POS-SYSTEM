/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RestaurantMemory.ts — LONG-TERM restaurant-specific memory for the
 * Marketing Intelligence agent (Phase 2).
 *
 * One document = one validated, structured fact/pattern for a restaurant
 * (optionally branch-scoped, optionally about one subject via entityRef).
 * Long-term memory carries confidence, sampleSize, evidence references,
 * source, validity status and validation/expiry timestamps.
 *
 * HARD RULES:
 *   - restaurantId is injected exclusively from the authenticated
 *     AiTenantContext by the memoryManager (spec §33) — never from an LLM.
 *   - Memory is contextual evidence, never authority over current data.
 *   - Indexed MongoDB retrieval only — no vector search, no embeddings.
 *
 * Upsert key: { restaurantId, branchId, memoryType, entityRef } — enforced by
 * a UNIQUE compound index so concurrent writers cannot duplicate a memory.
 */

import mongoose from 'mongoose';
import type {
  LongTermMemoryType,
  MemoryEvidenceRecord,
  MemorySource,
  MemoryStatus,
} from '../../ai/memory/memoryTypes';

export interface IRestaurantMemory extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  /** null = restaurant-global scope. */
  branchId: mongoose.Types.ObjectId | null;
  memoryType: LongTermMemoryType;
  /** Subject of the memory ('' = restaurant-wide for this type). */
  entityRef: string;
  value: Record<string, unknown>;
  confidence: number;
  sampleSize?: number;
  evidence: MemoryEvidenceRecord[];
  source: MemorySource;
  status: MemoryStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastValidatedAt?: Date;
  /** null/absent = no expiry (long-term facts may be evergreen). */
  expiresAt?: Date | null;
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

const restaurantMemorySchema = new mongoose.Schema<IRestaurantMemory>(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    memoryType: { type: String, required: true },
    entityRef: { type: String, default: '', maxlength: 200 },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    sampleSize: { type: Number, min: 0 },
    evidence: { type: [memoryEvidenceSchema], default: [] },
    source: { type: String, required: true },
    status: { type: String, required: true, enum: ['active', 'superseded', 'invalidated'], default: 'active' },
    tags: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastValidatedAt: { type: Date },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ── Upsert key: one memory per (restaurant, branch scope, type, subject) ─────
restaurantMemorySchema.index(
  { restaurantId: 1, branchId: 1, memoryType: 1, entityRef: 1 },
  { unique: true },
);
// active, non-expired retrieval by type (default long-term query)
restaurantMemorySchema.index({ restaurantId: 1, status: 1, expiresAt: 1, confidence: -1 });
// recency / lastValidated ordering
restaurantMemorySchema.index({ restaurantId: 1, updatedAt: -1 });
// branch-scoped retrieval
restaurantMemorySchema.index({ restaurantId: 1, branchId: 1, memoryType: 1 });
// relevance tag filter (multikey index)
restaurantMemorySchema.index({ restaurantId: 1, tags: 1 });

export default mongoose.models.RestaurantMemory ||
  mongoose.model<IRestaurantMemory>('RestaurantMemory', restaurantMemorySchema);
