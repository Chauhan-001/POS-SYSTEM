/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Experiment Event — per-customer offer experiment ledger (audit P1 #4).
 *
 * Purpose: produce the exact rows Uplit's T-Learner needs from REAL ChitKuber
 * activity:
 *   - pre-treatment customer features (behavior before the offer)
 *   - treatment  (1 = offer assigned/served, 0 = eligible holdout)
 *   - purchase   (1 = redeemed AND billed, 0 = not)
 *   - assignment + redemption timestamps (future temporal holdouts)
 *
 * Idempotency: one row per (restaurantId, customerId, offerId, eventType);
 * event_type 'converted' rows are allowed to coexist with 'assigned' rows.
 * NEVER stores post-treatment inputs as features (leakage guard lives in the
 * Uplit ingest contract; this model only carries outcomes as labels).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OfferExperimentEventType = 'assigned' | 'converted';

export interface IOfferExperimentEvent extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  offerId?: mongoose.Types.ObjectId | null;
  customerId: string;
  eventType: OfferExperimentEventType;
  /** 1 when eventType='assigned' by definition; kept explicit for export. */
  treatment: 0 | 1;
  /** 1 when eventType='converted' (redeemed AND billed). */
  purchase: 0 | 1;
  /** Pre-treatment customer behavior snapshot at assignment time. */
  features: Record<string, unknown>;
  assignedAt?: Date | null;
  convertedAt?: Date | null;
  redeemedBillId?: mongoose.Types.ObjectId | null;
  // ── Controlled-experiment extension (additive; legacy rows keep null) ─────
  /** Experiment definition id (OfferExperiment.experimentId). Null = legacy
   *  default-experiment row (offerId-keyed, always treatment). */
  experimentId?: string | null;
  /** Variant the customer was assigned to ('control', 'variant-a', ...). */
  variantId?: string | null;
  /** When the customer actually saw/received the offer (≠ assignment). */
  exposedAt?: Date | null;
  /** Revenue attributed to the conversion (OUTCOME label — never a feature). */
  attributedRevenue?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const OfferExperimentEventSchema = new Schema<IOfferExperimentEvent>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', default: null },
    customerId: { type: String, required: true, trim: true },
    eventType: { type: String, enum: ['assigned', 'converted'], required: true },
    treatment: { type: Number, min: 0, max: 1, required: true },
    purchase: { type: Number, min: 0, max: 1, required: true },
    features: { type: Schema.Types.Mixed, default: {} },
    assignedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    redeemedBillId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
    experimentId: { type: String, default: null, trim: true, uppercase: true },
    variantId: { type: String, default: null, trim: true },
    exposedAt: { type: Date, default: null },
    attributedRevenue: { type: Number, default: null },
  },
  { timestamps: true },
);

// Legacy/default flow (experimentId null): one row per (tenant, customer,
// offer, event type) — replays are safe. Scoped with a partial filter so
// experiment-scoped rows (which may share offerId=null across experiments'
// control arms) are NOT constrained by this index.
OfferExperimentEventSchema.index(
  { restaurantId: 1, customerId: 1, offerId: 1, eventType: 1 },
  { unique: true, partialFilterExpression: { experimentId: { $type: 'null' } } },
);
// Experiment flow: one row per (tenant, customer, experiment, event type).
// $gt: '' matches every non-empty string (all supported partial operators).
OfferExperimentEventSchema.index(
  { restaurantId: 1, customerId: 1, experimentId: 1, eventType: 1 },
  { unique: true, partialFilterExpression: { experimentId: { $gt: '' } } },
);
OfferExperimentEventSchema.index({ restaurantId: 1, createdAt: -1 });

const OfferExperimentEvent =
  (mongoose.models.OfferExperimentEvent as mongoose.Model<IOfferExperimentEvent>) ||
  mongoose.model<IOfferExperimentEvent>('OfferExperimentEvent', OfferExperimentEventSchema);

export default OfferExperimentEvent;
