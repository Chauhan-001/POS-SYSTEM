/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReceiptFeedback — feedback submitted from the public receipt landing page
 * (the QR printed on the customer's bill). Anonymous by design: the public
 * page never exposes (or collects) customer PII, so feedback rows carry no
 * name/phone — only the restaurant + bill they belong to.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IReceiptFeedback extends Document {
  restaurantId: mongoose.Types.ObjectId;
  billId: mongoose.Types.ObjectId;
  rating: number;        // 1–5 stars
  comment?: string;      // free text (optional)
  createdAt: Date;
}

const ReceiptFeedbackSchema = new Schema<IReceiptFeedback>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ReceiptFeedbackSchema.index({ restaurantId: 1, billId: 1 });

export default mongoose.model<IReceiptFeedback>('ReceiptFeedback', ReceiptFeedbackSchema);
