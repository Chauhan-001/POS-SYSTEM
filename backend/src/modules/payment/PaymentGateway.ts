export interface CreateOrderOptions {
  amount: number; // in smallest currency unit (paise)
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface VerifySignatureOptions {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface RefundOptions {
  /** Provider payment id to refund against (e.g. Razorpay payment_id). */
  paymentId: string;
  /** Amount in smallest currency unit (paise). Omit for full refund. */
  amount?: number;
  notes?: Record<string, string>;
}

export interface RefundResult {
  /** Provider refund id — the ONLY proof a refund was accepted. */
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export abstract class PaymentGateway {
  abstract getKeyId(): string;
  abstract createOrder(options: CreateOrderOptions): Promise<{ id: string; amount: number; currency: string; receipt: string }>;
  abstract verifySignature(options: VerifySignatureOptions): boolean;
  abstract verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean;
  /** Initiate a refund. Throws on gateway failure (never fakes success). */
  abstract refund(options: RefundOptions): Promise<RefundResult>;
}
