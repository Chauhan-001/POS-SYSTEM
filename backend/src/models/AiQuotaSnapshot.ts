/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AiQuotaSnapshot Model — Persists per-API-key LLM quota snapshots so the
 * admin dashboard quota cards keep their rate-limit history across backend
 * restarts.
 *
 * SECURITY: the raw API key is NEVER stored. Each document stores:
 *   - keyFingerprint: a one-way SHA-256 hash of the key (first 16 hex chars)
 *   - label:          the masked display form (e.g. 'gsk_Ab…Cd')
 * This is enough to re-link snapshots to configured keys on startup.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IQuotaWindow {
  window: string;
  limit: number;
  remaining: number | null;
  resetSeconds: number | null;
}

export interface IAiQuotaSnapshot extends Document {
  keyFingerprint: string;
  label: string;
  index: number;
  isPrimary: boolean;
  // Stored as `modelName` because Mongoose's Document interface already owns
  // a `model` method (same clash AIUsageLog.ts has with its `model: string`).
  modelName: string;
  baseUrl: string;
  windows: IQuotaWindow[];
  tokensUsedRuntime: number;
  rateLimitHits: number;
  lastRateLimitAt: string | null;
  lastUsedAt: string | null;
  parked: boolean;
}

// NOTE: no Schema<T> generic here (matches the codebase convention in e.g.
// AIUsageLog.ts) — the strict generic makes `default: null` fields infer as
// `null`, which then conflicts with `string | null` in the interface.
const QuotaWindowSchema = new Schema(
  {
    window: { type: String, required: true },
    limit: { type: Number, default: 0 },
    remaining: { type: Number, default: null },
    resetSeconds: { type: Number, default: null },
  },
  { _id: false },
);

const AiQuotaSnapshotSchema = new Schema(
  {
    keyFingerprint: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true, trim: true },
    index: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
    modelName: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
    windows: { type: [QuotaWindowSchema], default: [] },
    tokensUsedRuntime: { type: Number, default: 0 },
    rateLimitHits: { type: Number, default: 0 },
    lastRateLimitAt: { type: String, default: null },
    lastUsedAt: { type: String, default: null },
    parked: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
  },
);

export default mongoose.model<IAiQuotaSnapshot>('AiQuotaSnapshot', AiQuotaSnapshotSchema);
