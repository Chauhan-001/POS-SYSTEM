/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Subscription Service Unit Tests
 *
 * Covers:
 *   - State transitions (trial → grace → suspended)
 *   - Webhook idempotency
 *   - Plan management (auto-seed, change, extend)
 *   - Payment flow (verify, renew, create order)
 *   - Edge cases (no subscription, expired trial without grace, etc.)
 *
 * All Mongoose models are mocked — no database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionService } from '../subscriptionService';

// ─── Mock Mongoose Models ─────────────────────────────────────
const mockSave = vi.fn();
const mockExec = vi.fn();

vi.mock('../../../models/Subscription', () => {
  const Subscription: Record<string, any> = vi.fn();
  Subscription.findOne = vi.fn(() => ({ exec: mockExec }));
  Subscription.findOneAndUpdate = vi.fn(() => ({ exec: mockExec }));
  Subscription.create = vi.fn();
  Subscription.deleteOne = vi.fn();
  return { default: Subscription, ISubscription: Symbol('ISubscription') };
});

vi.mock('../../../models/SubscriptionPlan', () => {
  const SubscriptionPlan: Record<string, any> = vi.fn();
  SubscriptionPlan.find = vi.fn(() => ({ sort: vi.fn(() => ({ exec: mockExec })) }));
  SubscriptionPlan.findOne = vi.fn(() => ({ exec: mockExec }));
  SubscriptionPlan.create = vi.fn();
  return { default: SubscriptionPlan };
});

vi.mock('../../../models/Payment', () => {
  const Payment: Record<string, any> = vi.fn();
  Payment.findOne = vi.fn(() => ({ exec: mockExec }));
  Payment.create = vi.fn().mockResolvedValue({ _id: 'pay_mock_id', invoiceNumber: 'SUB-2026-000001' });
  Payment.find = vi.fn(() => ({
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({ exec: mockExec })),
      exec: mockExec,
    })),
  }));
  return { default: Payment };
});

vi.mock('../../../models/Invoice', () => {
  const Invoice: Record<string, any> = vi.fn();
  Invoice.findOne = vi.fn(() => ({ exec: mockExec }));
  Invoice.create = vi.fn(() => ({ invoiceNumber: 'SUB-2026-000001' }));
  Invoice.find = vi.fn(() => ({ sort: vi.fn(() => ({ exec: mockExec })) }));
  return { default: Invoice };
});

vi.mock('../../../models/InvoiceCounter', () => {
  const InvoiceCounter: Record<string, any> = vi.fn();
  InvoiceCounter.findOneAndUpdate = vi.fn(() => ({ exec: mockExec }));
  return { default: InvoiceCounter };
});

vi.mock('../../../models/Restaurant', () => {
  const Restaurant: Record<string, any> = vi.fn();
  Restaurant.findById = vi.fn(() => ({ exec: mockExec }));
  return { default: Restaurant };
});

vi.mock('../../../models/WebhookEvent', () => {
  const WebhookEvent: Record<string, any> = vi.fn();
  WebhookEvent.findOne = vi.fn(() => ({ exec: mockExec }));
  WebhookEvent.create = vi.fn();
  WebhookEvent.updateOne = vi.fn(() => ({ exec: mockExec }));
  return { default: WebhookEvent };
});

vi.mock('../../../models/AuditLog', () => {
  const AuditLog: Record<string, any> = vi.fn();
  AuditLog.create = vi.fn();
  return { default: AuditLog };
});

vi.mock('../../payment/RazorpayGateway', () => {
  const paymentGateway = {
    getKeyId: vi.fn(() => 'rzp_test_mockkey'),
    createOrder: vi.fn(() => Promise.resolve({
      id: 'order_mock123',
      amount: 49900,
      currency: 'INR',
      receipt: 'rcpt_mock',
    })),
    verifySignature: vi.fn(() => true),
    verifyWebhookSignature: vi.fn(() => true),
  };
  return { paymentGateway };
});

vi.mock('../../../services/entitlementService', () => ({
  entitlementService: {
    getBranchUsage: vi.fn(() => Promise.resolve({
      usage: { totalBranches: 0, activeBranches: 0, remainingBranches: 'unlimited' },
    })),
    validatePlanDowngrade: vi.fn(() => Promise.resolve({ allowed: true })),
    canUseFeature: vi.fn(() => Promise.resolve({ allowed: true })),
    getSubscriptionLimits: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('../../../config', () => ({
  config: {
    razorpay: {
      keyId: 'rzp_test_mockkey',
      keySecret: 'mocksecret',
      webhookSecret: 'whsec_mock',
    },
    // Required by subscriptionService.ts at module load (TRIAL_DAYS).
    subscription: { trialDays: 7 },
    nodeEnv: 'test',
  },
}));

// Helpers
function mockSub(overrides: Record<string, any> = {}) {
  return {
    _id: 'sub_id_123',
    restaurantId: 'rest_id_123',
    plan: 'professional',
    status: 'trial',
    trialStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
    trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),    // 7 days from now
    graceEnd: new Date(Date.now() + 17 * 24 * 60 * 60 * 1000),   // 17 days from now
    expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    subscriptionStart: null,
    renewalDate: null,
    startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    maxUsers: 5,
    maxDevices: 3,
    features: [
      'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty',
      'reservations', 'multi_branch', 'analytics', 'custom_branding',
      'advanced_reports', 'expense_tracking', 'api_access', 'priority_support',
    ],
    subscriptionId: null,
    save: mockSave,
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockPlan(overrides: Record<string, any> = {}) {
  return {
    _id: 'plan_id_123',
    planId: 'professional',
    name: 'Professional Plan',
    description: 'Test plan',
    price: 499,
    maxUsers: 10,
    maxDevices: 3,
    features: ['core_pos', 'ai'],
    aiEnabled: true,
    trialDays: 7,
    sortOrder: 1,
    isActive: true,
    isDefault: true,
    ...overrides,
  };
}

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionService();
  });

  // ═══════════════════════════════════════════════════════════
  // STATE TRANSITIONS
  // ═══════════════════════════════════════════════════════════

  describe('state transitions', () => {
    it('creates a subscription in trial if none exists', async () => {
      // Mock: no existing subscription
      mockExec.mockResolvedValueOnce(null);

      // Mock: create subscription returns a trial sub
      const Subscription = (await import('../../../models/Subscription')).default;
      (Subscription.create as any).mockResolvedValueOnce(mockSub());

      // Mock: restaurant lookup
      mockExec.mockResolvedValueOnce({ name: 'Test Restaurant' });

      const result = await service.getSubscriptionStatus('rest_id_new');

      expect(result.status).toBe('trial');
      expect(result.plan).toBe('professional');
      expect(Subscription.create).toHaveBeenCalled();
    });

    it('transitions trial → grace when trial ends and grace not ended', async () => {
      const sub = mockSub({
        trialEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        graceEnd: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000), // 9 days from now
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('grace');
      expect(mockSave).toHaveBeenCalled();
    });

    it('transitions trial → suspended when trial AND grace both ended', async () => {
      const sub = mockSub({
        trialEnd: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000), // 11 days ago
        graceEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),  // 1 day ago
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('suspended');
      expect(mockSave).toHaveBeenCalled();
    });

    it('transitions trial → grace with new graceEnd when trial ends but no graceEnd set', async () => {
      const sub = mockSub({
        trialEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        graceEnd: undefined,
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('grace');
      expect(sub.graceEnd).toBeDefined(); // graceEnd was set
      expect(mockSave).toHaveBeenCalled();
    });

    it('transitions active → grace when subscription expires', async () => {
      const sub = mockSub({
        status: 'active',
        expiryDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('grace');
      expect(mockSave).toHaveBeenCalled();
    });

    it('transitions grace → suspended when grace ends', async () => {
      const sub = mockSub({
        status: 'grace',
        trialEnd: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
        graceEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('suspended');
      expect(mockSave).toHaveBeenCalled();
    });

    it('does NOT transition when dates are in the future', async () => {
      const sub = mockSub(); // trial, all dates in future
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('trial');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('returns all features during trial (full trial access)', async () => {
      const sub = mockSub(); // trial status
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('trial');
      expect(result.features).toEqual(expect.arrayContaining([
        'inventory', 'analytics', 'loyalty', 'ai', 'reservations',
        'multi_branch', 'expense_tracking',
      ]));
    });

    it('upgrades legacy trial subscriptions to full features', async () => {
      const sub = mockSub({ features: ['core_pos', 'basic_reports'] }); // legacy minimal list
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('trial');
      expect(result.features).toEqual(expect.arrayContaining(['inventory', 'analytics', 'loyalty']));
      expect(mockSave).toHaveBeenCalled(); // migration persisted full features
    });

    it('does NOT transition active subscription with future expiry', async () => {
      const sub = mockSub({
        status: 'active',
        expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      });
      mockExec.mockResolvedValueOnce(sub);
      mockExec.mockResolvedValueOnce({ name: 'Test' });

      const result = await service.getSubscriptionStatus('rest_id_123');

      expect(result.status).toBe('active');
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // WEBHOOK IDEMPOTENCY
  // ═══════════════════════════════════════════════════════════

  describe('webhook idempotency', () => {
    it('rejects invalid webhook signature', async () => {
      const { paymentGateway } = await import('../../payment/RazorpayGateway');
      (paymentGateway.verifyWebhookSignature as any).mockReturnValueOnce(false);

      const result = await service.handleWebhook(
        JSON.stringify({ event: 'payment.captured' }),
        'invalid_sig'
      );

      expect(result).toEqual({ received: true, error: 'Invalid signature' });
    });

    it('rejects invalid JSON body', async () => {
      const result = await service.handleWebhook('not-json', 'sig');

      expect(result).toEqual({ received: true, error: 'Invalid JSON' });
    });

    it('skips duplicate event (idempotent)', async () => {
      const existingEvent = {
        _id: 'evt_id_1',
        status: 'processed',
      };
      mockExec.mockResolvedValueOnce(existingEvent); // WebhookEvent.findOne

      const result = await service.handleWebhook(
        JSON.stringify({ id: 'evt_id_1', event: 'payment.captured' }),
        'valid_sig'
      );

      expect(result).toEqual({ received: true, idempotent: true });
    });

    it('processes payment.captured webhook and activates subscription', async () => {
      // First call: WebhookEvent.findOne returns null (new event)
      mockExec.mockResolvedValueOnce(null);

      const payment = {
        _id: 'payment_id_1',
        restaurantId: 'rest_id_123',
        invoiceNumber: 'SUB-2026-000001',
        razorpayPaymentId: undefined,
        status: 'created',
        amount: 499,
        paymentMethod: undefined,
        save: mockSave,
      };

      // Payment.findOne by razorpayOrderId
      mockExec.mockResolvedValueOnce(payment);
      // Invoice.findOne for existing check
      mockExec.mockResolvedValueOnce(null);
      // Subscription.findOne for existing
      mockExec.mockResolvedValueOnce(mockSub({ status: 'suspended' }));

      const result = await service.handleWebhook(
        JSON.stringify({
          id: 'evt_id_2',
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: 'pay_mock123',
                order_id: 'order_mock123',
                method: 'upi',
              },
            },
          },
        }),
        'valid_sig'
      );

      expect(result).toEqual({ received: true });
      expect(payment.status).toBe('success');
      expect(payment.paymentMethod).toBe('upi');
      expect(mockSave).toHaveBeenCalled();
    });

    it('skips processing when no pending payment found for webhook', async () => {
      mockExec.mockResolvedValueOnce(null); // WebhookEvent.findOne
      mockExec.mockResolvedValueOnce(null); // Payment.findOne - no pending payment

      const result = await service.handleWebhook(
        JSON.stringify({
          id: 'evt_id_3',
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_mock', order_id: 'order_mock' } } },
        }),
        'valid_sig'
      );

      expect(result).toEqual({ received: true });
    });

    it('handles order.paid event type', async () => {
      mockExec.mockResolvedValueOnce(null);

      const payment = {
        _id: 'payment_id_2',
        restaurantId: 'rest_id_123',
        invoiceNumber: 'SUB-2026-000002',
        status: 'created',
        amount: 499,
        save: mockSave,
      };
      mockExec.mockResolvedValueOnce(payment);
      mockExec.mockResolvedValueOnce(null); // Invoice.findOne
      mockExec.mockResolvedValueOnce(mockSub({ status: 'suspended' }));

      const result = await service.handleWebhook(
        JSON.stringify({
          id: 'evt_id_4',
          event: 'order.paid',
          payload: {
            order: { entity: { id: 'order_mock' } },
            payment: { entity: { id: 'pay_mock', order_id: 'order_mock' } },
          },
        }),
        'valid_sig'
      );

      expect(result).toEqual({ received: true });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PLAN MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  describe('plan management', () => {
    it('auto-seeds default plan when no plans exist', async () => {
      mockExec.mockResolvedValueOnce([]); // No plans found

      const SubscriptionPlan = (await import('../../../models/SubscriptionPlan')).default;
      (SubscriptionPlan.create as any).mockResolvedValueOnce(mockPlan());

      const plans = await service.getPlans();

      expect(plans).toHaveLength(1);
      expect(SubscriptionPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'professional', isDefault: true })
      );
    });

    it('returns existing plans when they exist', async () => {
      mockExec.mockResolvedValueOnce([mockPlan(), mockPlan({
        planId: 'enterprise',
        name: 'Enterprise',
        price: 999,
        isDefault: false,
      })]);

      const plans = await service.getPlans();

      expect(plans).toHaveLength(2);
      expect(plans[0].planId).toBe('professional');
      expect(plans[1].planId).toBe('enterprise');
    });

    it('changes plan successfully', async () => {
      mockExec
        .mockResolvedValueOnce(mockPlan({ planId: 'enterprise', price: 999, maxDevices: 10, maxUsers: 50, features: ['core_pos', 'ai', 'analytics'] }))
        .mockResolvedValueOnce(mockSub()) // Current subscription found
        .mockResolvedValueOnce(mockPlan({ planId: 'professional', price: 499 })) // Current plan lookup
        .mockResolvedValueOnce(mockSub()); // Updated subscription from findOneAndUpdate

      const result = await service.changePlan('rest_id_123', 'enterprise');

      expect(result).toBeDefined();
      expect(result.plan).toBe('professional'); // from the mocked return
    });

    it('throws when changing to non-existent plan', async () => {
      mockExec.mockResolvedValueOnce(null); // Plan not found

      await expect(service.changePlan('rest_id_123', 'nonexistent'))
        .rejects.toThrow('Plan not found');
    });

    it('throws when subscription not found on change plan', async () => {
      mockExec.mockResolvedValueOnce(mockPlan()); // Plan found
      mockExec.mockResolvedValueOnce(null); // Subscription oneAndUpdate returns null

      await expect(service.changePlan('rest_id_123', 'professional'))
        .rejects.toThrow('Subscription not found');
    });

    it('extends trial period and resets status from suspended', async () => {
      const sub = mockSub({
        status: 'suspended',
        trialEnd: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      });
      mockExec.mockResolvedValueOnce(sub); // Subscription.findOne

      const result = await service.extendTrial('rest_id_123', 7);

      expect(result.status).toBe('trial');
      expect(mockSave).toHaveBeenCalled();
    });

    it('extends trial period from grace status', async () => {
      const sub = mockSub({
        status: 'grace',
        trialEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
      mockExec.mockResolvedValueOnce(sub);

      const result = await service.extendTrial('rest_id_123', 14);

      expect(result.status).toBe('trial');
      expect(mockSave).toHaveBeenCalled();
    });

    it('throws extendTrial when no subscription exists', async () => {
      mockExec.mockResolvedValueOnce(null);

      await expect(service.extendTrial('rest_id_nonexistent', 7))
        .rejects.toThrow('Subscription not found');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PAYMENT FLOW
  // ═══════════════════════════════════════════════════════════

  describe('payment flow', () => {
    it('creates an order successfully', async () => {
      mockExec.mockResolvedValueOnce(mockPlan()); // Plan found
      mockExec.mockResolvedValueOnce(mockSub()); // Existing subscription
      mockExec.mockResolvedValueOnce({ sequence: 1001, name: 'subscription' }); // InvoiceCounter

      const result = await service.createOrder('rest_id_123', 'professional');

      expect(result.orderId).toBe('order_mock123');
      expect(result.amount).toBe(49900);
      expect(result.currency).toBe('INR');
      expect(result.keyId).toBe('rzp_test_mockkey');
      expect(result.invoiceNumber).toContain('SUB-');
    });

    it('throws createOrder when no plan found', async () => {
      mockExec.mockResolvedValueOnce(null); // Plan not found
      mockExec.mockResolvedValueOnce(null); // Default plan not found

      await expect(service.createOrder('rest_id_123', 'nonexistent'))
        .rejects.toThrow('No subscription plan found');
    });

    it('verifies payment and activates subscription', async () => {
      const payment = {
        _id: 'payment_id_4',
        restaurantId: 'rest_id_123',
        invoiceNumber: 'SUB-2026-000010',
        razorpayPaymentId: undefined,
        signature: undefined,
        status: 'created',
        amount: 499,
        save: mockSave,
      };
      mockExec.mockResolvedValueOnce(payment); // Payment.findOne
      mockExec.mockResolvedValueOnce(mockSub({ status: 'grace' })); // Subscription.findOne

      const result = await service.verifyPayment(
        'rest_id_123',
        'order_mock123',
        'pay_mock123',
        'sig_mock123'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('activated');
      expect(result.invoice).toBe('SUB-2026-000001');
    });

    it('is idempotent when payment already verified', async () => {
      const payment = {
        _id: 'payment_id_3',
        status: 'success', // Already success
      };
      mockExec.mockResolvedValueOnce(payment);

      const result = await service.verifyPayment(
        'rest_id_123',
        'order_mock123',
        'pay_mock123',
        'sig_mock123'
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Payment already verified');
    });

    it('throws when payment record not found', async () => {
      mockExec.mockResolvedValueOnce(null); // Payment not found

      await expect(service.verifyPayment('rest_id_123', 'order_nonexistent', 'pay_mock', 'sig_mock'))
        .rejects.toThrow('Payment record not found');
    });

    it('throws on invalid payment signature', async () => {
      const { paymentGateway } = await import('../../payment/RazorpayGateway');
      (paymentGateway.verifySignature as any).mockReturnValueOnce(false);

      await expect(service.verifyPayment('rest_id_123', 'order_mock', 'pay_mock', 'bad_sig'))
        .rejects.toThrow('Invalid payment signature');
    });

    it('manually renews subscription', async () => {
      const sub = mockSub({
        status: 'suspended',
        expiryDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Expired 10 days ago
      });
      mockExec.mockResolvedValueOnce(sub); // Subscription.findOne (existingSub)
      mockExec.mockResolvedValueOnce(null); // SubscriptionPlan.findOne — no plan found, fallback to 499
      mockExec.mockResolvedValueOnce({ sequence: 1001 }); // InvoiceCounter
      // Payment.create is mocked, no mockExec needed
      // Invoice.create is mocked, no mockExec needed
      mockExec.mockResolvedValueOnce(sub); // Subscription.findOneAndUpdate (result)

      const result = await service.manualRenew('rest_id_123');

      expect(result).toBeDefined();
      expect(result.invoiceNumber).toContain('SUB-');
      expect(result.amount).toBeGreaterThan(0);
      expect(result.subscription.status).toBe('suspended');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('checkSubscriptionActive returns true when no subscription exists', async () => {
      mockExec.mockResolvedValueOnce(null);

      const result = await service.checkSubscriptionActive('rest_id_new');

      expect(result).toBe(true);
    });

    it('checkSubscriptionActive returns false for suspended', async () => {
      mockExec.mockResolvedValueOnce(mockSub({ status: 'suspended' }));

      const result = await service.checkSubscriptionActive('rest_id_123');

      expect(result).toBe(false);
    });

    it('checkSubscriptionActive returns true for trial', async () => {
      mockExec.mockResolvedValueOnce(mockSub({ status: 'trial' }));

      const result = await service.checkSubscriptionActive('rest_id_123');

      expect(result).toBe(true);
    });

    it('checkSubscriptionActive returns true for active', async () => {
      mockExec.mockResolvedValueOnce(mockSub({ status: 'active' }));

      const result = await service.checkSubscriptionActive('rest_id_123');

      expect(result).toBe(true);
    });

    it('checkSubscriptionActive returns true for grace', async () => {
      mockExec.mockResolvedValueOnce(mockSub({ status: 'grace' }));

      const result = await service.checkSubscriptionActive('rest_id_123');

      expect(result).toBe(true);
    });

    it('getSubscriptionHistory returns payments and invoices', async () => {
      const mockPayments = [{ _id: 'pay_1', amount: 499, status: 'success' }];
      const mockInvoices = [{ _id: 'inv_1', invoiceNumber: 'SUB-2026-000001' }];

      // Two sequential mockResolvedValueOnce for the two find calls
      mockExec
        .mockResolvedValueOnce(mockPayments)
        .mockResolvedValueOnce(mockInvoices);

      const result = await service.getSubscriptionHistory('rest_id_123');

      expect(result.payments).toHaveLength(1);
      expect(result.invoices).toHaveLength(1);
      expect(result.payments[0].amount).toBe(499);
    });

    it('getPaymentHistory returns limited payments', async () => {
      mockExec.mockResolvedValueOnce([{ _id: 'pay_1' }, { _id: 'pay_2' }]);

      const result = await service.getPaymentHistory('rest_id_123');

      expect(result).toHaveLength(2);
    });
  });
});
