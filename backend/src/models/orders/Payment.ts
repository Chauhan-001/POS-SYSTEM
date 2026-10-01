import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  /** Null while a pre-registration (plan purchase before account creation) order is pending. */
  restaurantId: mongoose.Types.ObjectId | null;
  subscriptionId?: mongoose.Types.ObjectId;
  /** Online customer order this payment settles (null for subscription payments). */
  orderId?: mongoose.Types.ObjectId | null;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  signature?: string;
  amount: number;
  currency: string;
  gateway: string;
  paymentMethod?: string;
  /** Billing cadence this payment settles (monthly = 30d, yearly = 365d). */
  billingPeriod?: 'monthly' | 'yearly';
  status: 'created' | 'success' | 'failed';
  invoiceNumber: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    razorpayOrderId: { type: String, required: true, index: true },
    razorpayPaymentId: { type: String },
    signature: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    gateway: { type: String, default: 'razorpay' },
    paymentMethod: { type: String },
    billingPeriod: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    status: { type: String, enum: ['created', 'success', 'failed'], default: 'created', index: true },
    invoiceNumber: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IPayment>('Payment', PaymentSchema);
