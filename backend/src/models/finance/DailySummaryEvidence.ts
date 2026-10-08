/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailySummaryEvidence Model — persisted output of ONE Daily Summary
 * (Z-Report Intelligence) run.
 *
 * Deliberately SEPARATE from the deterministic `DailySummary` (finance):
 * that model stays the authoritative daily sales snapshot written by
 * billService.bumpDailySummary and is never touched by AI. This model stores
 * the AI pipeline's normalized evidence + validated report so a generated
 * summary can be re-read, audited and replayed without re-running the LLM.
 *
 * Tenant safety: every query MUST scope by restaurantId (JWT-derived) and,
 * where a branch was requested, by the validated branchId. The unique index
 * includes runId, so a REGENERATE always inserts a new document (fresh run)
 * instead of overwriting history; "latest" is the newest createdAt for the
 * tenant/branch/date.
 *
 * Storage discipline: the evidencePack holds NORMALIZED BusinessSignal[]
 * (statements, values, evidence refs) — never raw tool payloads.
 */

import mongoose, { Schema } from 'mongoose';

export interface IDailySummaryEvidence extends Document {
  /** Owning restaurant — from authenticated context, never client input. */
  restaurantId: mongoose.Types.ObjectId;
  /** Validated branch (null = restaurant-wide). */
  branchId: mongoose.Types.ObjectId | null;
  /** Business date the report describes, 'YYYY-MM-DD'. */
  businessDate: string;
  /** Correlation id of the pipeline run (one doc per run — regenerate = new doc). */
  runId: string;
  agent: string;
  promptVersion: string;
  /** Normalized EvidencePack (signals with evidence refs, conflicts, missing data). */
  evidencePack: Schema.Types.Mixed;
  /** Critic-validated report sections (or the deterministic fallback report). */
  report: Schema.Types.Mixed;
  /** 0..1 overall confidence reported by the pipeline. */
  confidence: number;
  /** True when any authoritative source was unavailable/degraded. */
  degraded: boolean;
  /** Human-readable degradation lines (missing sources, fallback reasons). */
  degradations: [string];
  /** Whether the persisted report came from the LLM or the deterministic fallback. */
  reportSource: 'llm' | 'deterministic';
  generationMetadata: {
    durationMs?: number;
    batch1Ms?: number;
    batch2Ms?: number;
    batch3Ms?: number;
    followUpMs?: number;
    llmMs?: number;
    toolCalls?: number;
    toolFailures?: number;
    llmTokens?: number;
    llmCostUsd?: number;
    conflictsDetected?: number;
    followUpRounds?: number;
    validationStatus?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const DailySummaryEvidenceSchema = new Schema<IDailySummaryEvidence>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    businessDate: { type: String, required: true, trim: true },
    runId: { type: String, required: true, trim: true },
    agent: { type: String, required: true, default: 'z_report', trim: true },
    promptVersion: { type: String, required: true, trim: true },
    evidencePack: { type: Schema.Types.Mixed, required: true },
    report: { type: Schema.Types.Mixed, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    degraded: { type: Boolean, required: true, default: false },
    degradations: { type: [String], default: [] },
    reportSource: { type: String, required: true, enum: ['llm', 'deterministic'] },
    generationMetadata: {
      durationMs: { type: Number },
      batch1Ms: { type: Number },
      batch2Ms: { type: Number },
      batch3Ms: { type: Number },
      followUpMs: { type: Number },
      llmMs: { type: Number },
      toolCalls: { type: Number },
      toolFailures: { type: Number },
      llmTokens: { type: Number },
      llmCostUsd: { type: Number },
      conflictsDetected: { type: Number },
      followUpRounds: { type: Number },
      validationStatus: { type: String },
    },
  },
  { timestamps: true }
);

// One document PER RUN (runId in the index): regenerating never clobbers
// history, and a tenant+branch+date lookup always includes restaurantId so
// cross-tenant reads are impossible by construction.
DailySummaryEvidenceSchema.index(
  { restaurantId: 1, branchId: 1, businessDate: 1, runId: 1 },
  { unique: true }
);
// "Latest report for this tenant/branch/date" reads.
DailySummaryEvidenceSchema.index({ restaurantId: 1, branchId: 1, businessDate: 1, createdAt: -1 });

export default mongoose.model<IDailySummaryEvidence>('DailySummaryEvidence', DailySummaryEvidenceSchema);
