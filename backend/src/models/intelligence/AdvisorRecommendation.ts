/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AdvisorRecommendation — outcome-tracking record for the Business Advisor.
 *
 * Every recommendation shown to an owner is persisted so its journey can be
 * followed: shown → accepted/rejected/dismissed → actionTaken → outcome.
 * Only aggregate facts are ever stored here — never customer PII.
 */

import mongoose from 'mongoose';

export type AdvisorGoal =
  | 'increase_sales'
  | 'move_inventory'
  | 'bring_customers_back'
  | 'increase_profit'
  | 'increase_aov'
  | 'create_offer'
  | 'create_combo';

export type AdvisorStatus =
  | 'shown'
  | 'accepted'
  | 'rejected'
  | 'dismissed'
  | 'expired'
  | 'converted'    // Offer was successfully created from this recommendation
  | 'cooldown'     // Campaign finished — cooling down before re-evaluation
  | 'reevaluate'   // Cooldown finished — eligible for re-recommendation

export interface AdvisorEconomics {
  /** Selling price of the recommended offer/combo (₹). */
  price?: number;
  /** Deterministic estimated gross margin (%) after discount — never LLM-invented. */
  marginPercent?: number;
  /** Effective discount (%) or ₹ amount the recommendation implies. */
  discount?: number;
  /** Existing AOV the recommendation builds on (₹). */
  currentAov?: number;
  /** Projected AOV after the action, derived from the same facts. */
  projectedAov?: number;
}

export interface IAdvisorRecommendation extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  /** Optional branch scope — when set the recommendation is branch-specific. */
  branchId?: mongoose.Types.ObjectId;
  goal: AdvisorGoal;
  recommendationType: string;
  title: string;
  /** Short owner-friendly "what to do". */
  why: string;
  /** Actual restaurant data that supports the recommendation (strings, no PII). */
  evidence: string[];
  economics?: AdvisorEconomics;
  expectedImpact: string;
  risk?: string;
  confidence: 'Low' | 'Medium' | 'High';
  /** Deterministic score (0-100) — evidence strength, not LLM opinion. */
  score: number;
  /** Deterministic signals that produced the candidate. */
  supportingSignals: string[];
  /**
   * The exact OfferSuggestion-shaped payload, when this recommendation maps
   * onto the existing offer engine ("Create Offer" / "Create Combo" action).
   * Lets the frontend open the existing preview → create flow unchanged.
   */
  offerSuggestion?: any;
  status: AdvisorStatus;
  actionTaken?: string;
  /** Measurable result recorded later (e.g. "AOV ₹280 → ₹315"). */
  outcome?: string;
  /**
   * Stable fingerprint for deduplication — identifies the underlying business
   * opportunity (not the specific instance). Allows the system to recognize
   * that two recommendations represent the same opportunity.
   */
  fingerprint?: string;
  /** Offer ID when this recommendation was converted into an offer. */
  offerId?: mongoose.Types.ObjectId;
  /** Campaign ID when a campaign was created from the converted offer. */
  campaignId?: mongoose.Types.ObjectId;
  /** Timestamp when the recommendation was converted to an offer. */
  convertedAt?: Date;
  /** Timestamp when the associated campaign completed. */
  campaignCompletedAt?: Date;
  /** Timestamp when cooldown expires and recommendation becomes eligible again. */
  cooldownExpiresAt?: Date;
  /** Number of times this opportunity has been recommended (instance count). */
  instanceCount: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

const advisorRecommendationSchema = new mongoose.Schema<IAdvisorRecommendation>(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    goal: { type: String, enum: ['increase_sales', 'move_inventory', 'bring_customers_back', 'increase_profit', 'increase_aov', 'create_offer', 'create_combo'], required: true },
    recommendationType: { type: String, required: true },
    title: { type: String, required: true },
    why: { type: String, required: true },
    evidence: { type: [String], default: [] },
    economics: {
      price: Number,
      marginPercent: Number,
      discount: Number,
      currentAov: Number,
      projectedAov: Number,
    },
    expectedImpact: { type: String, default: '' },
    risk: { type: String, default: '' },
    confidence: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    score: { type: Number, default: 0 },
    supportingSignals: { type: [String], default: [] },
    offerSuggestion: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['shown', 'accepted', 'rejected', 'dismissed', 'expired', 'converted', 'cooldown', 'reevaluate'], default: 'shown' },
    actionTaken: { type: String, default: '' },
    outcome: { type: String, default: '' },
    fingerprint: { type: String, trim: true, index: true },
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    convertedAt: { type: Date, default: null },
    campaignCompletedAt: { type: Date, default: null },
    cooldownExpiresAt: { type: Date, default: null },
    instanceCount: { type: Number, default: 1, min: 0 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

advisorRecommendationSchema.index({ restaurantId: 1, goal: 1, createdAt: -1 });
advisorRecommendationSchema.index({ restaurantId: 1, status: 1 });
advisorRecommendationSchema.index({ restaurantId: 1, fingerprint: 1, status: 1 });

export default mongoose.models.AdvisorRecommendation || mongoose.model<IAdvisorRecommendation>('AdvisorRecommendation', advisorRecommendationSchema);
