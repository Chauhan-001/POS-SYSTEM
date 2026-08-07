import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
  restaurantId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  invoiceNumber: string;
  plan: string;
  amount: number;
  tax: number;
  generatedAt: Date;
  pdfUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    plan: { type: String, required: true },
    amount: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    pdfUrl: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);
