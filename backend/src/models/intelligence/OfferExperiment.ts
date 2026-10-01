/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferExperiment — the DEFINITION of a controlled offer experiment
 * (control vs treatment variants), complementing OfferExperimentEvent which
 * remains the per-customer event ledger (assignments/conversions).
 *
 * Design notes:
 *  - Variants carry an explicit kind. A valid experiment has exactly one
 *    'control' variant — no offer / standard offer — documented per experiment.
 *    Comparing two treatments is allowed, but analysis must then never claim
 *    incrementality over "no promotion" (spec §22/§38).
 *  - Allocation fractions sum to 1. Assignment is a stable hash of
 *    (tenant, experiment, customer) — a customer never flips variants.
 *  - primaryMetric names the ONE metric that decides the result; everything
 *    else is secondary (spec §24).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ExperimentVariantKind = 'control' | 'treatment';
export type ExperimentStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type ExperimentPrimaryMetric =
  | 'redemption_rate'
  | 'revenue'
  | 'contribution'
  | 'aov';

export interface IOfferExperimentVariant {
  /** Stable variant id used in event rows ('control', 'variant-a', ...). */
  id: string;
  name: string;
  kind: ExperimentVariantKind;
  /** Offer served to this arm (null for a no-offer control). */
  offerId: mongoose.Types.ObjectId | null;
  /** Share of eligible customers, 0..1 — all variants sum to 1. */
  allocation: number;
}

export interface IOfferExperiment extends Document {
  experimentId: string; // unique per tenant, human-readable
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  objective: string;
  /** What the control arm represents (no offer / standard offer) — required. */
  controlDescription: string;
  variants: IOfferExperimentVariant[];
  primaryMetric: ExperimentPrimaryMetric;
  secondaryMetrics: ExperimentPrimaryMetric[];
  /** Days after exposure in which a conversion is attributed. */
  attributionWindowDays: number;
  /** Per-arm minimum sample for a conclusive result (analysis is honest below it). */
  minSampleSizePerArm: number;
  status: ExperimentStatus;
  startAt: Date | null;
  endAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const VariantSchema = new Schema<IOfferExperimentVariant>(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['control', 'treatment'], required: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', default: null },
    allocation: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const OfferExperimentSchema = new Schema<IOfferExperiment>(
  {
    experimentId: { type: String, required: true, trim: true, uppercase: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    objective: { type: String, required: true, trim: true },
    controlDescription: { type: String, required: true, trim: true },
    variants: { type: [VariantSchema], validate: (v: unknown[]) => v.length >= 2 },
    primaryMetric: {
      type: String,
      enum: ['redemption_rate', 'revenue', 'contribution', 'aov'],
      required: true,
    },
    secondaryMetrics: {
      type: [String],
      enum: ['redemption_rate', 'revenue', 'contribution', 'aov'],
      default: [],
    },
    attributionWindowDays: { type: Number, required: true, min: 1, max: 30 },
    minSampleSizePerArm: { type: Number, required: true, min: 1, default: 100 },
    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
      default: 'draft',
      index: true,
    },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    createdBy: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// One definition per (tenant, experimentId); experimentIds unique per tenant.
OfferExperimentSchema.index({ restaurantId: 1, experimentId: 1 }, { unique: true });

export default mongoose.model<IOfferExperiment>('OfferExperiment', OfferExperimentSchema);
