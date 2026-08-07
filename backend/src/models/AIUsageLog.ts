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

export interface IAIUsageLog extends Document {
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