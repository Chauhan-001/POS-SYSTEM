/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeedbackAnalysis — AI-derived intelligence for one ReceiptFeedback row.
 *
 * One document per ReceiptFeedback (1:1 via the unique feedbackId). It stores:
 *   - aspect-level sentiment (14 restaurant aspects, evidence-quoted)
 *   - recurring-issue categories with severity
 *   - a local hashed embedding of the comment for in-process RAG retrieval
 *
 * Rows whose comment is absent still get an analysis: sentiment is derived
 * from the star rating alone and aspects stay empty (`source: 'rating_only'`).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type FeedbackSentiment = 'positive' | 'mixed' | 'neutral' | 'negative';
export type FeedbackIssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AnalysisSource = 'ai' | 'local' | 'rating_only';

export interface IFeedbackAspect {
  aspect: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;       // -1..1
  evidence: string;    // verbatim quote from the comment
}

export interface IFeedbackIssue {
  category: string;    // e.g. waiting_time, food_temperature
  severity: FeedbackIssueSeverity;
  evidence: string;
}

export interface IFeedbackAnalysis extends Document {
  restaurantId: mongoose.Types.ObjectId;
  feedbackId: mongoose.Types.ObjectId;
  overallSentiment: FeedbackSentiment;
  sentimentScore: number;              // -1..1
  aspects: IFeedbackAspect[];
  issues: IFeedbackIssue[];
  summary: string;
  suggestedAction: string;
  embedding: number[];                 // local hashed embedding of the comment
  feedbackCreatedAt: Date;             // when the customer actually submitted it (trends)
  source: AnalysisSource;
  modelId: string;                     // model id when source === 'ai' (named modelId: `model` collides with Document.model())
  analyzedAt: Date;
}

const FeedbackAnalysisSchema = new Schema<IFeedbackAnalysis>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    feedbackId: { type: Schema.Types.ObjectId, ref: 'ReceiptFeedback', required: true, unique: true },
    overallSentiment: { type: String, enum: ['positive', 'mixed', 'neutral', 'negative'], required: true },
    sentimentScore: { type: Number, required: true, min: -1, max: 1 },
    aspects: { type: [{ aspect: String, sentiment: String, score: Number, evidence: String }], default: [] },
    issues: { type: [{ category: String, severity: String, evidence: String }], default: [] },
    summary: { type: String, default: '' },
    suggestedAction: { type: String, default: '' },
    embedding: { type: [Number], default: [] },
    feedbackCreatedAt: { type: Date, required: true },
    source: { type: String, enum: ['ai', 'local', 'rating_only'], default: 'rating_only' },
    modelId: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

FeedbackAnalysisSchema.index({ restaurantId: 1, analyzedAt: -1 });

export default mongoose.model<IFeedbackAnalysis>('FeedbackAnalysis', FeedbackAnalysisSchema);
