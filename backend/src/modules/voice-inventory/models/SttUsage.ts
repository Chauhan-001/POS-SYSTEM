/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SttUsage — Append-only usage & cost ledger for Speech-to-Text calls.
 *
 * Records per-call provider, model, audio duration (estimated), latency and
 * an estimated USD cost so restaurants and admins can track STT spend.
 * Never stores raw audio or transcripts beyond a preview excerpt.
 *
 * SECURITY:
 *   - No API keys, tokens, or raw audio are ever stored.
 *   - Only an admin or the owning restaurant can read these records.
 */

import mongoose, { Schema } from 'mongoose';

export type SttStatus = 'success' | 'empty' | 'error';

export interface ISttUsage {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  employeeId?: string;
  provider: string;
  model: string;
  status: SttStatus;
  /** Raw audio size in bytes (for cost estimation). */
  audioBytes: number;
  /** Estimated audio duration in seconds. */
  audioSeconds: number;
  /** End-to-end latency (ms) of the STT call. */
  latencyMs: number;
  /** Estimated cost in USD (4 decimals). */
  costUsd: number;
  /** Short excerpt of the transcript (≤ 200 chars) for debugging. */
  transcriptExcerpt?: string;
  error?: string;
  attemptHistory: Array<{
    key: string;
    status: 'ok' | 'skipped' | 'failed';
    error?: string;
    latencyMs?: number;
  }>;
  ipAddress?: string;
  createdAt: Date;
}

const SttUsageSchema = new Schema<ISttUsage>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    employeeId: { type: String, trim: true, default: null },
    provider: { type: String, required: true, trim: true, index: true },
    model: { type: String, required: true, trim: true, default: 'default' },
    status: { type: String, required: true, enum: ['success', 'empty', 'error'], default: 'error', index: true },
    audioBytes: { type: Number, required: true, default: 0 },
    audioSeconds: { type: Number, required: true, default: 0 },
    latencyMs: { type: Number, default: 0 },
    costUsd: { type: Number, required: true, default: 0 },
    transcriptExcerpt: { type: String, trim: true, default: null },
    attemptHistory: [
      {
        _id: false,
        key: { type: String, trim: true },
        status: { type: String, enum: ['ok', 'skipped', 'failed'] },
        error: { type: String, trim: true },
        latencyMs: { type: Number },
      },
    ],
    ipAddress: { type: String, trim: true, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SttUsageSchema.index({ restaurantId: 1, createdAt: -1 });
SttUsageSchema.index({ provider: 1, createdAt: -1 });
SttUsageSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<ISttUsage>('SttUsage', SttUsageSchema);