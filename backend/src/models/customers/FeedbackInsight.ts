/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeedbackInsight — cached executive AI summary across a restaurant's
 * receipt-QR feedback. One document per restaurant is kept (latest wins);
 * regeneration overwrites the previous snapshot so the panel always reads
 * one row.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IFeedbackInsight extends Document {
  restaurantId: mongoose.Types.ObjectId;
  headline: string;
  paragraphs: string[];
  recommendations: string[];
  source: 'ai' | 'local';
  generatedAt: Date;
}

const FeedbackInsightSchema = new Schema<IFeedbackInsight>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true, index: true },
    headline: { type: String, required: true },
    paragraphs: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    source: { type: String, enum: ['ai', 'local'], default: 'local' },
    generatedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model<IFeedbackInsight>('FeedbackInsight', FeedbackInsightSchema);
