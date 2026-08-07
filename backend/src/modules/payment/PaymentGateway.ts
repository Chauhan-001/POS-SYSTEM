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

export abstract class PaymentGateway {
  abstract getKeyId(): string;
  abstract createOrder(options: CreateOrderOptions): Promise<{ id: string; amount: number; currency: string; receipt: string }>;
  abstract verifySignature(options: VerifySignatureOptions): boolean;
  abstract verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean;
}
