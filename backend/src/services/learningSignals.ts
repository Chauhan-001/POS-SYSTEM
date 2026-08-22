/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Learning Signals — Tracks explicit and implicit learning signals from promotion
 * outcomes. These signals feed strategy profiles, fatigue detection, and
 * recommendation ranking.
 *
 * Signals are recorded automatically from outcome measurements and can also
 * be provided explicitly by owner feedback.
 */

import mongoose from 'mongoose';
import IRecommendationOutcome from '../models/RecommendationOutcome';

export type LearningSignal =
  | 'promotion_accepted'
  | 'promotion_rejected'
  | 'promotion_implemented'
  | 'promotion_redeemed'
  | 'incremental_sales'
  | 'incremental_contribution'
  | 'customer_response'
  | 'aov_change'
  | 'inventory_impact'
  | 'wastage_impact'
  | 'repeat_purchase_impact';

export interface LearningSignalRecord {
  signal: LearningSignal;
  strength: 'weak' | 'moderate' | 'strong';
  restaurantId: string;
  promotionType?: string;
  productId?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

const learningSignalSchema = new Schema({
  signal: { type: String, required: true },
  strength: { type: String, enum: ['weak', 'moderate', 'strong'], required: true },
  restaurantId: { type: Schema.Types.ObjectId, required: true, index: true },
  promotionType: { type: String },
  productId: { type: Schema.Types.ObjectId },
  timestamp: { type: Date, default: Date.now, index: true },
  metadata: { type: Map, of: Schema.Types.Mixed },
});

export default mongoose.model('LearningSignal', learningSignalSchema);