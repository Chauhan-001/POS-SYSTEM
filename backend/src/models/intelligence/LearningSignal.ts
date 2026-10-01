/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LearningSignal — Learning signal model for tracking promotion outcomes,
 * strategy fatigue, and preference trends.
 *
 * Used by the weekly learning cycle to:
 * - Record promotion acceptance/rejection signals
 * - Build strategy profiles
 * - Detect promotion fatigue
 * - Suppress underperforming strategies
 * - Track preference trends over time
 */

import mongoose from 'mongoose';

/**
 * Learning signal types
 */
export const LEARNING_SIGNAL_TYPES = [
  'promotion_accepted',
  'promotion_rejected',
  'promotion_fatigue',
  'strategy_preference',
  'outcome_measured',
  'promotion_redeemed',
  'incremental_sales',
  'incremental_contribution',
  'promotion_implemented',
] as const;

export type LearningSignalType = typeof LEARNING_SIGNAL_TYPES[number];

/**
 * Learning signal schema
 */
const LearningSignalSchema = new mongoose.Schema({
  signal: {
    type: String,
    enum: LEARNING_SIGNAL_TYPES,
    required: true,
  },
  strength: {
    type: String,
    enum: ['low', 'medium', 'moderate', 'strong'],
    default: 'medium',
  },
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  },
  promotionType: {
    type: String,
    default: '',
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  promotionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Promotion',
    default: null,
  },
  recommendationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdvisorRecommendation',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient querying by restaurant and signal type
LearningSignalSchema.index({ restaurantId: 1, signal: 1 });
LearningSignalSchema.index({ restaurantId: 1, promotionType: 1 });
LearningSignalSchema.index({ createdAt: -1 });

export default mongoose.model('LearningSignal', LearningSignalSchema);