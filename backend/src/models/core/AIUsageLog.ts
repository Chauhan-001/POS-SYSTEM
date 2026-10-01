/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIUsageLog Model — Tracks every AI feature call made through the AI module.
 *
 * Extended in Phase 2.7 to support:
 *   - Token tracking (inputTokens, outputTokens, totalTokens)
 *   - Cost tracking (cost)
 *   - Model/Provider tracking (model, provider)
 *   - Error categorization (errorType, retried, cancelled, timeout)
 *
 * Purpose:
 *   Provides the real data source for the Admin Dashboard "AI Usage" page
 *   and all AI analytics across the platform. Each AI request (summary,
 *   closing, health, purchase recs, low-stock, waste, voice, weather,
 *   offers, OCR, forecasting, etc.) writes one append-only entry.
 *
 * Queryable for:
 *   - Total AI requests (all-time / per period)
 *   - Daily/weekly/monthly/yearly AI usage trend charts
 *   - Per-feature adoption and fallback/cache rates
 *   - Token usage analytics (input/output/total)
 *   - Cost analytics per model/feature/restaurant
 *   - Latency statistics (avg, p50, p95, p99)
 *   - Error rate and error type breakdown
 *   - Model usage and provider comparison
 *
 * NOTE: Voice-inventory interactions are additionally tracked in the
 * VoiceAuditLog collection (source: 'voice' | 'ai_suggested') and are
 * aggregated together with this collection in the admin analytics.
 */

import mongoose, { Schema, Document } from 'mongoose';

// Omit 'model': Mongoose's Document already declares a `model` method, which
// would clash with this interface's data field of the same name.
export interface IAIUsageLog extends Omit<Document, 'model'> {
  restaurantId: mongoose.Types.ObjectId | null;
  ownerId: mongoose.Types.ObjectId | null;
  feature: string;
  success: boolean;
  fallback: boolean;
  cached: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  model: string;
  provider: string;
  errorType: string | null;
  retried: boolean;
  cancelled: boolean;
  timeout: boolean;
  /** Phase 8 — stable prompt version that produced this call (e.g. offers-v3). */
  promptVersion: string;
  /** Phase 8 — explicit user refresh (cache busted) for this call. */
  cacheBust: boolean;
  /** Phase 8 — fact-consistency validation outcome (null when not validated). */
  validationPassed: boolean | null;
  validationFailed: boolean | null;
  /** Phase 8 — why the deterministic fallback was used (provider down, schema mismatch, fact INVALID, …). */
  fallbackReason: string | null;
  /** Phase 8 — privacy-safe prompt hash (never the full prompt). */
  promptHash: string;
  /** Phase 8 — correlation id for this request. */
  requestId: string;
  createdAt: Date;
}

const AIUsageLogSchema = new Schema<IAIUsageLog>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    success: {
      type: Boolean,
      default: true,
    },
    fallback: {
      type: Boolean,
      default: false,
    },
    cached: {
      type: Boolean,
      default: false,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    inputTokens: {
      type: Number,
      default: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    cost: {
      type: Number,
      default: 0,
    },
    model: {
      type: String,
      default: '',
      index: true,
    },
    provider: {
      type: String,
      default: '',
      index: true,
    },
    errorType: {
      type: String,
      default: null,
      index: true,
    },
    retried: {
      type: Boolean,
      default: false,
    },
    cancelled: {
      type: Boolean,
      default: false,
    },
    timeout: {
      type: Boolean,
      default: false,
    },
    promptVersion: {
      type: String,
      default: '',
      index: true,
    },
    cacheBust: {
      type: Boolean,
      default: false,
    },
    validationPassed: {
      type: Boolean,
      default: null,
    },
    validationFailed: {
      type: Boolean,
      default: null,
    },
    fallbackReason: {
      type: String,
      default: null,
    },
    promptHash: {
      type: String,
      default: '',
      index: true,
    },
    requestId: {
      type: String,
      default: '',
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Compound indexes for efficient analytics queries
AIUsageLogSchema.index({ createdAt: -1 });
AIUsageLogSchema.index({ restaurantId: 1, createdAt: -1 });
AIUsageLogSchema.index({ ownerId: 1, createdAt: -1 });
AIUsageLogSchema.index({ feature: 1, createdAt: -1 });
AIUsageLogSchema.index({ model: 1, createdAt: -1 });
AIUsageLogSchema.index({ provider: 1, createdAt: -1 });
AIUsageLogSchema.index({ errorType: 1, createdAt: -1 });
AIUsageLogSchema.index({ success: 1, createdAt: -1 });
AIUsageLogSchema.index({ cached: 1, createdAt: -1 });
// Compound indexes for cost/token analytics
AIUsageLogSchema.index({ restaurantId: 1, feature: 1, createdAt: -1 });
AIUsageLogSchema.index({ model: 1, provider: 1, createdAt: -1 });

export default mongoose.model<IAIUsageLog>('AIUsageLog', AIUsageLogSchema);