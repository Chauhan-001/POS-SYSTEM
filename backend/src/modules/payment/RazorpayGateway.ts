import Razorpay from 'razorpay';
import crypto from 'crypto';
import { PaymentGateway, CreateOrderOptions, VerifySignatureOptions, RefundOptions, RefundResult } from './PaymentGateway';
import { config } from '../../config';
import { CircuitBreaker } from '../../utils/CircuitBreaker';

// ─── Razorpay Circuit Breaker ───────────────────────────────────────
// Protects against cascading failures from the Razorpay payment API.
// Payment timeouts/failures should NOT block the rest of the app.
const razorpayCircuitBreaker = new CircuitBreaker({
  name: 'Razorpay',
  failureThreshold: 3,        // Trip after 3 consecutive failures
  cooldownMs: 15_000,         // Try again after 15 seconds
  timeoutMs: 10_000,          // 10 seconds max per Razorpay API call
  maxConcurrency: 3,          // Max 3 concurrent payment API calls
});

/**
 * RazorpayGateway — Production-ready Razorpay integration.
 * 
 * All credentials come from `config.razorpay` (sourced from env vars).
 * No hardcoded defaults in production — will throw if keys are missing.
 */
export class RazorpayGateway extends PaymentGateway {
  private razorpay: any;
  private keyId: string;

  constructor() {
    super();
    this.keyId = config.razorpay.keyId;
    const keySecret = config.razorpay.keySecret;

    if (!keySecret && config.nodeEnv === 'production') {
      throw new Error('RAZORPAY_KEY_SECRET is required in production');
    }

    this.razorpay = new Razorpay({
      key_id: this.keyId,
      key_secret: keySecret,
    });
  }

  getKeyId(): string {
    return this.keyId;
  }

  async createOrder(options: CreateOrderOptions): Promise<{ id: string; amount: number; currency: string; receipt: string }> {
    const result = await razorpayCircuitBreaker.execute(
      async () => {
        const order = await this.razorpay.orders.create({
          amount: options.amount,
          currency: options.currency || 'INR',
          receipt: options.receipt,
          notes: options.notes || {},
        });
        console.log('[RazorpayGateway] Order created:', order.id);
        return {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
        };
      },
      // Fallback: return a mock order in dev, or throw a clear error in production
      () => {
        if (config.nodeEnv !== 'production') {
          console.warn('[RazorpayGateway] Circuit breaker fallback — using mock order (dev mode)');
          return {
            id: `order_${crypto.randomBytes(8).toString('hex')}`,
            amount: options.amount,
            currency: options.currency || 'INR',
            receipt: options.receipt,
          };
        }
        throw new Error('Payment gateway is temporarily unavailable. Please try again later.');
      },
    );

    return result.data;
  }

  verifySignature(options: VerifySignatureOptions): boolean {
    const keySecret = config.razorpay.keySecret;
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${options.orderId}|${options.paymentId}`)
      .digest('hex');
    return generatedSignature === options.signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      return expectedSignature === signature;
    } catch (error) {
      console.error('[RazorpayGateway] Webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Initiate a provider refund. The returned refund id is the ONLY confirmation
   * that the gateway accepted the refund — callers must persist it and never
   * fabricate success.
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    const result = await razorpayCircuitBreaker.execute(
      async () => {
        const refund = await this.razorpay.refunds.create({
          payment_id: options.paymentId,
          amount: options.amount, // paise; omitted → full refund
          notes: options.notes || {},
        });
        console.log('[RazorpayGateway] Refund created:', refund.id);
        return {
          id: refund.id,
          status: refund.status,
          amount: refund.amount,
          currency: refund.currency || 'INR',
        };
      },
      () => {
        throw new Error('Payment gateway is temporarily unavailable. Refund not initiated — nothing was refunded.');
      },
    );
    return result.data;
  }
}

export const paymentGateway = new RazorpayGateway();
