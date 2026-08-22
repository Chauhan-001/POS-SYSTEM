import Subscription, { ISubscription } from '../../models/Subscription';
import Payment from '../../models/Payment';
import Invoice from '../../models/Invoice';
import InvoiceCounter from '../../models/InvoiceCounter';
import SubscriptionPlan from '../../models/SubscriptionPlan';
import Restaurant from '../../models/Restaurant';
import Branch from '../../models/Branch';
import Device from '../../models/Device';
import WebhookEvent from '../../models/WebhookEvent';
import AuditLog from '../../models/AuditLog';
import { paymentGateway } from '../payment/RazorpayGateway';
import mongoose from 'mongoose';
import { config } from '../../config';
import { entitlementService } from '../../services/entitlementService';
import { effectiveFeatures } from '../../utils/subscriptionFeatures';
import crypto from 'crypto';

export const SUBSCRIPTION_DURATION_DAYS = 30;
export const SUBSCRIPTION_DURATION_DAYS_YEARLY = 365;
/**
 * Warning window after a subscription expires: the restaurant keeps full
 * access for these days, then falls back to the free tier (core POS only)
 * instead of being suspended outright.
 */
export const GRACE_PERIOD_DAYS = 2;
// Single source of truth for the free-trial length (config.subscription.trialDays).
const TRIAL_DAYS = config.subscription.trialDays;

import { ALL_FEATURES } from '../../constants/planFeatures';

export type BillingPeriod = 'monthly' | 'yearly';

/** True when the value is a supported billing cadence. */
export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === 'monthly' || value === 'yearly';
}

/** Number of days a paid billing period lasts. Monthly = 30d, yearly = 365d. */
export function billingDurationDays(period?: string): number {
  return period === 'yearly' ? SUBSCRIPTION_DURATION_DAYS_YEARLY : SUBSCRIPTION_DURATION_DAYS;
}

/**
 * Price a plan charges for a given billing cadence. Yearly billing uses the
 * plan's yearly price when set, otherwise falls back to the monthly price.
 */
export function planPriceForPeriod(plan: any, period?: string): number {
  if (period === 'yearly' && typeof plan?.yearlyPrice === 'number' && plan.yearlyPrice > 0) {
    return plan.yearlyPrice;
  }
  return typeof plan?.price === 'number' ? plan.price : 0;
}

/**
 * Every feature unlocked during the free trial (config.subscription.trialDays,
 * default 14 days). Trial subscribers get the full product — feature
 * restrictions apply only after a paid plan is selected. Mirrors admin
 * onboarding 'trial' mode. Derived from the central catalog so new features
 * never drift.
 */
const ALL_TRIAL_FEATURES = ALL_FEATURES;

export class SubscriptionService {
  async getPlans() {
    let plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 }).exec();
    if (plans.length === 0) {
      // Seed default Professional plan if none exist
      const defaultPlan = await SubscriptionPlan.create({
        planId: 'professional',
        name: 'Professional Plan',
        description: 'Complete SaaS POS with AI, Inventory & Multi-Device support',
        price: 499,
        maxUsers: 10,
        maxDevices: 3,
        features: ['core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty'],
        aiEnabled: true,
        trialDays: TRIAL_DAYS,
        sortOrder: 1,
        isActive: true,
        isDefault: true,
      });
      plans = [defaultPlan];
    }
    return plans;
  }

  /**
   * Ensure the platform's Free tier plan exists (core POS only). Restaurants
   * whose subscription period expires fall back to this plan after the 2-day
   * warning window. Idempotent — never clobbers admin edits to the plan.
   */
  async ensureFreePlan(): Promise<void> {
    try {
      const existing = await SubscriptionPlan.findOne({ planId: 'free' }).lean().exec();
      if (existing) return;
      await SubscriptionPlan.create({
        planId: 'free',
        name: 'Free Plan',
        description: 'Core POS features — billing, orders, tables and payments. Upgrade anytime to unlock more.',
        price: 0,
        yearlyPrice: 0,
        maxUsers: 3,
        maxDevices: 1,
        features: ['core_pos'],
        aiEnabled: false,
        trialDays: 0,
        sortOrder: 0,
        isActive: true,
        isDefault: false,
        status: 'active',
        planType: 'free',
        visibility: 'public',
        limits: {
          maxRestaurants: 1,
          maxBranches: 1,
          maxDevicesPerBranch: 1,
          maxProducts: 0,
          maxCustomers: 0,
          maxMonthlyOrders: 0,
          maxStorageMB: 100,
          maxAIRequests: 0,
          maxVoiceRequests: 0,
          maxImages: 0,
          maxExports: 0,
        },
      });
      console.log('[SubscriptionService] Seeded the Free tier plan (core POS only)');
    } catch (error) {
      console.error('[SubscriptionService] ensureFreePlan failed:', error);
    }
  }

  /**
   * Move a subscription to the Free tier (core POS only) after the 2-day
   * expiry warning elapses. The restaurant keeps working — premium features
   * are simply no longer entitled (requireFeature gates them).
   */
  private async shiftToFreeTier(sub: ISubscription): Promise<void> {
    let freeFeatures: string[] = ['core_pos'];
    let freeLimits: Record<string, number> = {
      maxRestaurants: 1, maxBranches: 1, maxDevicesPerBranch: 1,
      maxProducts: 0, maxCustomers: 0, maxMonthlyOrders: 0, maxStorageMB: 100,
      maxAIRequests: 0, maxVoiceRequests: 0, maxImages: 0, maxExports: 0,
    };
    let freeMaxUsers = 3;
    let freeMaxDevices = 1;
    try {
      const freePlan = await SubscriptionPlan.findOne({ planId: 'free' }).exec();
      if (freePlan) {
        if (freePlan.features?.length) freeFeatures = freePlan.features;
        if (freePlan.limits) freeLimits = freePlan.limits as unknown as Record<string, number>;
        if (typeof freePlan.maxUsers === 'number') freeMaxUsers = freePlan.maxUsers;
        if (typeof freePlan.maxDevices === 'number') freeMaxDevices = freePlan.maxDevices;
      }
    } catch (error) {
      console.error('[SubscriptionService] shiftToFreeTier plan lookup failed:', error);
    }

    sub.plan = 'free';
    sub.status = 'active';
    sub.billingPeriod = 'monthly';
    sub.expiryDate = null;
    sub.renewalDate = null;
    sub.graceEnd = null;
    sub.trialEnd = null;
    sub.features = freeFeatures;
    sub.maxUsers = freeMaxUsers;
    sub.maxDevices = freeMaxDevices;
    sub.limits = freeLimits as any;
    sub.pendingPlan = null;
    sub.pendingEffectiveDate = null;

    try {
      await AuditLog.create({
        action: 'subscription.downgraded_to_free',
        entityType: 'Subscription',
        entityId: sub.restaurantId.toString(),
        performedBy: 'system',
        details: {
          reason: 'Subscription period expired and the 2-day warning elapsed',
          plan: 'free',
          features: freeFeatures,
        },
      });
    } catch { /* non-blocking */ }
  }

  /**
   * Get or create subscription for a restaurant.
   * Also evaluates and transitions state based on dates.
   */
  async getSubscriptionStatus(restaurantId: string) {
    let sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      sub = await Subscription.create({
        restaurantId,
        plan: 'professional',
        status: 'trial',
        trialStart: new Date(),
        trialEnd: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        expiryDate: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        graceEnd: new Date(Date.now() + (TRIAL_DAYS + GRACE_PERIOD_DAYS) * 24 * 60 * 60 * 1000),
        startDate: new Date(),
        maxUsers: 5,
        maxDevices: 3,
        features: ALL_TRIAL_FEATURES,
      });
    }

    // Apply a scheduled (future-dated) plan change when it becomes due.
    if (sub.pendingPlan && sub.pendingEffectiveDate && new Date() >= sub.pendingEffectiveDate) {
      try {
        await this.applyPendingPlanChange(sub);
        await sub.save();
      } catch (error) {
        console.error('[SubscriptionService] Pending plan change failed:', error);
      }
    }

    // Evaluate state transitions
    const now = new Date();
    let changed = false;

    // Free trial unlocks every feature — upgrade any legacy trial rows that
    // were created with only basic features so gated endpoints work too.
    // (Runs before the transition check so rows entering the grace period
    // keep full access.)
    if (sub.status === 'trial' && ALL_TRIAL_FEATURES.some((f) => !(sub.features || []).includes(f))) {
      sub.features = ALL_TRIAL_FEATURES;
      sub.updatedAt = now;
      await sub.save();
      console.log(`[SubscriptionService] Trial features upgraded for ${restaurantId}: full access enabled`);
    }

    if (sub.status === 'trial' && sub.trialEnd && now > sub.trialEnd) {
      // A cash-paid onboarding (gateway 'cash', status 'success') already
      // collected the plan payment — its trial converts to the paid plan
      // (active) with a fresh billing period instead of the grace/free fallback.
      const hasCashPayment = await Payment.exists({
        subscriptionId: sub._id,
        gateway: 'cash',
        status: 'success',
      }).exec();
      if (hasCashPayment) {
        const period = isBillingPeriod(sub.billingPeriod) ? sub.billingPeriod : 'monthly';
        const expiry = new Date(now.getTime() + billingDurationDays(period) * 24 * 60 * 60 * 1000);
        sub.status = 'active';
        sub.trialEnd = undefined;
        sub.subscriptionStart = now;
        sub.expiryDate = expiry;
        sub.renewalDate = expiry;
        sub.graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        changed = true;
        console.log(`[SubscriptionService] Cash trial ended for ${restaurantId} → active (paid plan)`);
      } else if (sub.graceEnd && now < sub.graceEnd) {
        sub.status = 'grace';
        changed = true;
      } else if (sub.graceEnd && now > sub.graceEnd) {
        // 2-day warning elapsed — fall back to the free tier (core POS only).
        await this.shiftToFreeTier(sub);
        changed = true;
      } else {
        // Trial ended but no graceEnd set — start the 2-day warning now
        sub.status = 'grace';
        sub.graceEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        changed = true;
      }
    } else if (sub.status === 'active' && sub.expiryDate && now > sub.expiryDate) {
      // Expired — start the 2-day warning before falling back to the free tier.
      sub.status = 'grace';
      sub.graceEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      changed = true;
    } else if (sub.status === 'grace' && sub.graceEnd && now > sub.graceEnd) {
      // 2-day warning elapsed — fall back to the free tier (core POS only).
      await this.shiftToFreeTier(sub);
      changed = true;
    }

    if (changed) {
      sub.updatedAt = now;
      await sub.save();
      console.log(`[SubscriptionService] State changed for ${restaurantId}: → ${sub.status}`);
    }

    const restaurant = await Restaurant.findById(restaurantId).exec();

    // Get branch usage info
    const branchUsage = await entitlementService.getBranchUsage(restaurantId);

    // Real current-device count (active terminals registered to this restaurant).
    // Only query when restaurantId is a valid ObjectId — legacy rows may hold
    // plain-string ids that would otherwise raise a CastError.
    let currentDevices = 0;
    if (mongoose.isValidObjectId(restaurantId)) {
      currentDevices = await Device.countDocuments({ restaurantId, isActive: true }).exec();
    }

    // Resolve plan limits from subscription snapshot or plan
    const plan = sub.plan
      ? await SubscriptionPlan.findOne({ planId: sub.plan }).exec()
      : null;
    const effectiveLimits = sub.limits || plan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };

    return {
      restaurantId,
      restaurantName: restaurant?.name || 'Restaurant',
      plan: sub.plan,
      billingPeriod: sub.billingPeriod || 'monthly',
      pendingPlan: sub.pendingPlan || null,
      pendingEffectiveDate: sub.pendingEffectiveDate?.toISOString() || null,
      status: sub.status,
      trialStart: sub.trialStart,
      trialEnd: sub.trialEnd,
      subscriptionStart: sub.subscriptionStart,
      expiryDate: sub.expiryDate,
      renewalDate: sub.renewalDate,
      graceEnd: sub.graceEnd,
      maxUsers: sub.maxUsers,
      maxDevices: sub.maxDevices,
      currentDevices,
      features: sub.status === 'trial' ? ALL_TRIAL_FEATURES : effectiveFeatures(sub.features, sub.grantedFeatures),
      grantedFeatures: sub.grantedFeatures || [],
      limits: effectiveLimits,
      branchUsage: branchUsage.usage,
    };
  }

  async createOrder(restaurantId: string, planId: string, billingPeriod: string = 'monthly') {
    const plan = await SubscriptionPlan.findOne({ planId }).exec()
      || await SubscriptionPlan.findOne({ isDefault: true }).exec();
    if (!plan) {
      throw new Error('No subscription plan found');
    }

    const period = isBillingPeriod(billingPeriod) ? billingPeriod : 'monthly';
    const periodPrice = planPriceForPeriod(plan, period);
    const amount = periodPrice * 100; // Convert to paise
    const receipt = `sub_${crypto.randomBytes(8).toString('hex')}`;

    const order = await paymentGateway.createOrder({
      amount,
      currency: 'INR',
      receipt,
      notes: { restaurantId, planId: plan.planId },
    });

    const sub = await Subscription.findOne({ restaurantId }).exec();

    // Generate atomic invoice number
    const counter = await InvoiceCounter.findOneAndUpdate(
      { name: 'subscription' },
      { $inc: { sequence: 1 } },
      { upsert: true, new: true }
    ).exec();
    const invoiceNumber = `SUB-${new Date().getFullYear()}-${String(counter.sequence).padStart(6, '0')}`;

    await Payment.create({
      restaurantId,
      subscriptionId: sub?._id,
      razorpayOrderId: order.id,
      amount: periodPrice,
      currency: 'INR',
      gateway: 'razorpay',
      billingPeriod: period,
      status: 'created',
      invoiceNumber,
    });

    console.log(`[SubscriptionService] Order created for ${restaurantId}: ${order.id}, amount: ${amount}`);

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: paymentGateway.getKeyId(),
      invoiceNumber,
    };
  }

  async verifyPayment(restaurantId: string, orderId: string, paymentId: string, signature: string) {
    const isValid = paymentGateway.verifySignature({ orderId, paymentId, signature });
    if (!isValid) {
      throw new Error('Invalid payment signature — possible tampering detected');
    }

    const payment = await Payment.findOne({ razorpayOrderId: orderId }).exec();
    if (!payment) {
      throw new Error('Payment record not found');
    }

    if (payment.status === 'success') {
      // Already processed — idempotent
      return { success: true, message: 'Payment already verified' };
    }

    // Update payment record
    payment.razorpayPaymentId = paymentId;
    payment.signature = signature;
    payment.status = 'success';
    await payment.save();

    // Generate subscription invoice
    const invoice = await Invoice.create({
      restaurantId: payment.restaurantId as any,
      paymentId: payment._id,
      invoiceNumber: payment.invoiceNumber,
      plan: payment.subscriptionId ? 'professional' : 'professional',
      amount: payment.amount,
      tax: Math.round(payment.amount * 0.18), // 18% GST
      generatedAt: new Date(),
    });

    // Activate subscription — the paid period length follows the billing
    // cadence recorded on the payment (monthly = 30d, yearly = 365d).
    const period = isBillingPeriod(payment.billingPeriod) ? payment.billingPeriod : 'monthly';
    const now = new Date();
    const expiry = new Date(now.getTime() + billingDurationDays(period) * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (sub) {
      sub.status = 'active';
      sub.billingPeriod = period;
      sub.subscriptionStart = now;
      sub.expiryDate = expiry;
      sub.renewalDate = expiry;
      sub.graceEnd = graceEnd;
      sub.plan = payment.subscriptionId ? sub.plan : 'professional';
      await sub.save();
    } else {
      await Subscription.create({
        restaurantId,
        plan: 'professional',
        status: 'active',
        subscriptionStart: now,
        expiryDate: expiry,
        renewalDate: expiry,
        graceEnd,
        startDate: now,
        maxUsers: 5,
        maxDevices: 3,
        features: ['core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty'],
      });
    }

    // Log audit
    await AuditLog.create({
      action: 'payment.verified',
      entityType: 'Subscription',
      entityId: restaurantId,
      performedBy: 'system',
      details: { orderId, paymentId, invoiceNumber: payment.invoiceNumber, amount: payment.amount },
    });

    return { success: true, message: 'Subscription activated successfully', invoice: invoice.invoiceNumber };
  }

  async handleWebhook(rawBody: string, signature: string) {
    const webhookSecret = config.razorpay.webhookSecret;

    // Verify webhook signature
    if (webhookSecret) {
      const isValid = paymentGateway.verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error('[SubscriptionService] Invalid webhook signature');
        return { received: true, error: 'Invalid signature' };
      }
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      console.error('[SubscriptionService] Invalid webhook body');
      return { received: true, error: 'Invalid JSON' };
    }

    const eventId = event.id || `evt_${crypto.randomBytes(8).toString('hex')}`;
    const eventType = event.event || 'unknown';

    // Idempotency check: skip if already processed
    const existing = await WebhookEvent.findOne({ eventId }).exec();
    if (existing) {
      if (existing.status === 'processed') {
        console.log(`[SubscriptionService] Webhook ${eventId} already processed, skipping`);
        return { received: true, idempotent: true };
      }
    } else {
      // Log incoming webhook
      await WebhookEvent.create({
        eventId,
        eventType,
        gateway: 'razorpay',
        payload: rawBody,
        status: 'received',
      });
    }

    try {
      if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
        const paymentEntity = event.payload?.payment?.entity;
        if (paymentEntity) {
          await this._processCapturedPayment(paymentEntity);
        }
      } else if (eventType === 'order.paid') {
        const orderEntity = event.payload?.order?.entity;
        if (orderEntity) {
          const paymentEntity = event.payload?.payment?.entity;
          if (paymentEntity) {
            await this._processCapturedPayment(paymentEntity);
          }
        }
      } else if (eventType === 'subscription.charged') {
        const subEntity = event.payload?.subscription?.entity;
        if (subEntity) {
          const paymentEntity = event.payload?.payment?.entity;
          if (paymentEntity) {
            await this._processCapturedPayment(paymentEntity);
          }
        }
      }

      // Mark webhook as processed
      await WebhookEvent.updateOne(
        { eventId },
        { $set: { status: 'processed', processedAt: new Date() } }
      ).exec();

      console.log(`[SubscriptionService] Webhook ${eventId} (${eventType}) processed successfully`);
    } catch (error: any) {
      console.error(`[SubscriptionService] Webhook ${eventId} processing failed:`, error.message);

      await WebhookEvent.updateOne(
        { eventId },
        { $set: { status: 'failed', errorMessage: error.message } }
      ).exec();
    }

    return { received: true };
  }

  private async _processCapturedPayment(paymentEntity: any) {
    const orderId = paymentEntity.order_id;
    if (!orderId) return;

    const paymentId = paymentEntity.id;
    const payment = await Payment.findOne({
      razorpayOrderId: orderId,
      status: { $ne: 'success' }
    }).exec();

    if (!payment) {
      console.log(`[SubscriptionService] No pending payment found for order ${orderId}`);
      return;
    }

    // Update payment record
    payment.razorpayPaymentId = paymentId;
    payment.status = 'success';
    if (paymentEntity.method) {
      payment.paymentMethod = paymentEntity.method;
    }
    await payment.save();

    // Create invoice if not already created
    const existingInvoice = await Invoice.findOne({ paymentId: payment._id }).exec();
    if (!existingInvoice) {
      await Invoice.create({
        restaurantId: payment.restaurantId as any,
        paymentId: payment._id,
        invoiceNumber: payment.invoiceNumber,
        plan: 'professional',
        amount: payment.amount,
        tax: Math.round(payment.amount * 0.18),
        generatedAt: new Date(),
      });
    }

    // Activate subscription — extend by the cadence the payment settled.
    const period = isBillingPeriod(payment.billingPeriod) ? payment.billingPeriod : 'monthly';
    const now = new Date();
    const existingSub = await Subscription.findOne({ restaurantId: payment.restaurantId as any }).exec();

    // Calculate new expiry — if still in active period, extend from current expiry
    let baseDate = now;
    if (existingSub && existingSub.expiryDate && existingSub.expiryDate > now) {
      baseDate = existingSub.expiryDate;
    }

    const newExpiry = new Date(baseDate.getTime() + billingDurationDays(period) * 24 * 60 * 60 * 1000);

    await Subscription.findOneAndUpdate(
      { restaurantId: payment.restaurantId as any },
      {
        $set: {
          status: 'active',
          billingPeriod: period,
          subscriptionStart: existingSub?.subscriptionStart || now,
          expiryDate: newExpiry,
          renewalDate: newExpiry,
          graceEnd: new Date(newExpiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
        }
      },
      { upsert: true }
    ).exec();

    console.log(`[SubscriptionService] Subscription activated via webhook for ${payment.restaurantId}, expires ${newExpiry.toISOString()}`);
  }

  async getSubscriptionHistory(restaurantId: string) {
    const payments = await Payment.find({ restaurantId }).sort({ createdAt: -1 }).exec();
    const invoices = await Invoice.find({ restaurantId }).sort({ generatedAt: -1 }).exec();
    return { payments, invoices };
  }

  async getPaymentHistory(restaurantId: string) {
    const payments = await Payment.find({ restaurantId })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
    return payments;
  }

  async manualRenew(restaurantId: string, options?: { amount?: number; notes?: string; paymentMethod?: string; billingPeriod?: string }) {
    const now = new Date();
    const existingSub = await Subscription.findOne({ restaurantId }).exec();
    if (!existingSub) {
      throw new Error('Subscription not found. Cannot renew without an active subscription.');
    }

    const period = isBillingPeriod(options?.billingPeriod) ? options.billingPeriod : (existingSub.billingPeriod || 'monthly');

    // Resolve plan to get the period's default price
    const plan = existingSub.plan
      ? await SubscriptionPlan.findOne({ planId: existingSub.plan }).exec()
      : null;
    const defaultPrice = planPriceForPeriod(plan, period) || 499;

    const parsedAmount = Math.max(1, Math.round(options?.amount || defaultPrice));
    const paymentMethod = options?.paymentMethod || 'cash';
    const notes = options?.notes || '';

    // Generate unique cash order reference
    const cashOrderId = `manual_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Generate atomic invoice number
    const counter = await InvoiceCounter.findOneAndUpdate(
      { name: 'subscription_manual' },
      { $inc: { sequence: 1 } },
      { upsert: true, new: true }
    ).exec();
    const invoiceNumber = `SUB-${new Date().getFullYear()}-${String(counter.sequence).padStart(6, '0')}`;

    // Create Payment record
    const payment = await Payment.create({
      restaurantId: existingSub.restaurantId,
      subscriptionId: existingSub._id,
      razorpayOrderId: cashOrderId,
      amount: parsedAmount,
      currency: 'INR',
      gateway: 'cash',
      paymentMethod,
      billingPeriod: period,
      status: 'success',
      invoiceNumber,
    });

    // Create Invoice record
    await Invoice.create({
      restaurantId: existingSub.restaurantId,
      paymentId: payment._id,
      invoiceNumber,
      plan: existingSub.plan || 'professional',
      amount: parsedAmount,
      tax: Math.round(parsedAmount * 0.18),
      generatedAt: now,
    });

    // Extend subscription by the cadence that was paid for.
    const baseDate = (existingSub.expiryDate && existingSub.expiryDate > now)
      ? existingSub.expiryDate
      : now;
    const newExpiry = new Date(baseDate.getTime() + billingDurationDays(period) * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOneAndUpdate(
      { restaurantId },
      {
        $set: {
          status: 'active',
          billingPeriod: period,
          subscriptionStart: existingSub.subscriptionStart || now,
          expiryDate: newExpiry,
          renewalDate: newExpiry,
          graceEnd: new Date(newExpiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
        }
      },
      { new: true, upsert: true }
    ).exec();

    // Create AuditLog entry
    await AuditLog.create({
      action: 'subscription.renewed.cash',
      entityType: 'Subscription',
      entityId: restaurantId,
      performedBy: 'restaurant_owner',
      details: {
        amount: parsedAmount,
        paymentMethod,
        billingPeriod: period,
        invoiceNumber,
        notes,
        expiryDate: newExpiry.toISOString(),
      },
    });

    console.log(`[SubscriptionService] Manual renew for ${restaurantId}: ${invoiceNumber}, amount: ${parsedAmount}`);

    return {
      subscription: sub,
      invoiceNumber,
      amount: parsedAmount,
      paymentMethod,
    };
  }

  async changePlan(restaurantId: string, planId: string, billingPeriod?: string) {
    const plan = await SubscriptionPlan.findOne({ planId }).exec();
    if (!plan) throw new Error('Plan not found');

    // Validate downgrade - check if current usage exceeds new plan limits
    const currentSub = await Subscription.findOne({ restaurantId }).exec();
    if (currentSub) {
      // Current plan lookup — used below to classify the switch (upgrade vs
      // downgrade) for logging and proration.
      // Current plan lookup — used to identify the switch (upgrade vs downgrade)
      // and to name the current plan in capacity-guard failures.
      const currentPlan = await SubscriptionPlan.findOne({ planId: currentSub.plan }).exec();
      // Downgrade / capacity guard — validate the target plan against current
      // usage whenever switching plans, regardless of price direction.
      const validation = await entitlementService.validatePlanDowngrade(restaurantId, planId);
      if (!validation.allowed) {
        throw new Error(validation.reason || `Cannot switch from ${currentPlan?.name || currentSub.plan}: current usage exceeds plan limits.`);
      }
    }

    // If the subscription is currently suspended (create_only or trial expired)
    // or still in its free trial, activating it with a fresh billing period
    // when a paid plan is selected converts the trial → paid correctly.
    const now = new Date();
    const needsActivation = !!currentSub && (currentSub.status === 'suspended' || currentSub.status === 'trial');
    const effectivePeriod = isBillingPeriod(billingPeriod) ? billingPeriod : (currentSub?.billingPeriod || 'monthly');
    const expiryDate = new Date(now.getTime() + billingDurationDays(effectivePeriod) * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(expiryDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOneAndUpdate(
      { restaurantId },
      {
        $set: {
          plan: plan.planId,
          ...(isBillingPeriod(billingPeriod) ? { billingPeriod } : {}),
          maxDevices: plan.maxDevices,
          maxUsers: plan.maxUsers,
          features: plan.features,
          limits: {
            maxRestaurants: plan.limits?.maxRestaurants ?? 1,
            maxBranches: plan.limits?.maxBranches ?? 1,
            maxDevicesPerBranch: plan.limits?.maxDevicesPerBranch ?? (plan.limits as any)?.maxDevices ?? 3,
            maxProducts: plan.limits?.maxProducts ?? 0,
            maxCustomers: plan.limits?.maxCustomers ?? 0,
            maxMonthlyOrders: plan.limits?.maxMonthlyOrders ?? 0,
            maxStorageMB: plan.limits?.maxStorageMB ?? 500,
            maxAIRequests: plan.limits?.maxAIRequests ?? 0,
            maxVoiceRequests: plan.limits?.maxVoiceRequests ?? 0,
            maxImages: plan.limits?.maxImages ?? 0,
            maxExports: plan.limits?.maxExports ?? 0,
          },
          ...(needsActivation ? {
            status: 'active',
            subscriptionStart: now,
            expiryDate,
            renewalDate: expiryDate,
            graceEnd,
          } : {}),
        }
      },
      { new: true }
    ).exec();

    if (!sub) throw new Error('Subscription not found');

    console.log(`[SubscriptionService] Plan changed for ${restaurantId}: → ${planId}${needsActivation ? ' (activated)' : ''}`);
    return sub;
  }

  /**
   * Apply a scheduled plan change stored on the subscription (set by the admin
   * Plans module via pendingPlan/pendingEffectiveDate). Keeps the features and
   * limits snapshot in sync so the change takes effect immediately.
   */
  async applyPendingPlanChange(sub: ISubscription) {
    const targetPlan = await SubscriptionPlan.findOne({ planId: sub.pendingPlan }).exec();
    if (!targetPlan) {
      // Target plan gone — clear the stale pending change.
      sub.pendingPlan = null;
      sub.pendingEffectiveDate = null;
      return;
    }
    if (targetPlan.status && targetPlan.status !== 'active') {
      throw new Error(`Cannot apply scheduled change: plan is ${targetPlan.status}`);
    }

    sub.plan = targetPlan.planId;
    sub.maxDevices = targetPlan.maxDevices;
    sub.maxUsers = targetPlan.maxUsers;
    sub.features = targetPlan.features || [];
    sub.limits = {
      maxRestaurants: targetPlan.limits?.maxRestaurants ?? 1,
      maxBranches: targetPlan.limits?.maxBranches ?? 1,
      maxDevicesPerBranch: targetPlan.limits?.maxDevicesPerBranch ?? (targetPlan.limits as any)?.maxDevices ?? 3,
      maxProducts: targetPlan.limits?.maxProducts ?? 0,
      maxCustomers: targetPlan.limits?.maxCustomers ?? 0,
      maxMonthlyOrders: targetPlan.limits?.maxMonthlyOrders ?? 0,
      maxStorageMB: targetPlan.limits?.maxStorageMB ?? 500,
      maxAIRequests: targetPlan.limits?.maxAIRequests ?? 0,
      maxVoiceRequests: targetPlan.limits?.maxVoiceRequests ?? 0,
      maxImages: targetPlan.limits?.maxImages ?? 0,
      maxExports: targetPlan.limits?.maxExports ?? 0,
    };
    // Scheduled plan change = scheduled activation: the subscription moves to
    // the target plan and activates immediately when the change is due.
    sub.status = 'active';
    sub.pendingPlan = null;
    sub.pendingEffectiveDate = null;

    await AuditLog.create({
      action: 'plan.scheduled_change.applied',
      entityType: 'Subscription',
      entityId: sub.restaurantId.toString(),
      performedBy: 'system',
      details: { plan: targetPlan.planId, limits: sub.limits, features: sub.features },
    });
  }

  /**
   * Check if a restaurant's subscription is active (not suspended).
   * Returns false if suspended.
   */
  async checkSubscriptionActive(restaurantId: string): Promise<boolean> {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) return true;
    return sub.status !== 'suspended';
  }

  /**
   * Calculate proration when changing plans mid-cycle.
   * Returns the credit (for downgrade) or extra charge (for upgrade) based on
   * remaining days in the current billing period.
   */
  async calculateProration(restaurantId: string, targetPlanId: string) {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      return { canChange: true, reason: null, proration: null };
    }

    const currentPlan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();
    const targetPlan = await SubscriptionPlan.findOne({ planId: targetPlanId }).exec();

    if (!targetPlan) {
      return { canChange: false, reason: 'Target plan not found.', proration: null };
    }

    const now = new Date();
    const daysInCycle = SUBSCRIPTION_DURATION_DAYS;

    // Determine the end of current billing period
    const billingEnd = sub.expiryDate || sub.trialEnd || new Date(now.getTime() + daysInCycle * 24 * 60 * 60 * 1000);
    const msRemaining = billingEnd.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    const daysElapsed = Math.max(1, daysInCycle - daysRemaining);

    const currentPrice = currentPlan?.price || 0;
    const targetPrice = targetPlan.price;

    const isUpgrade = targetPrice > currentPrice;
    const isDowngrade = targetPrice < currentPrice;
    const isSame = targetPrice === currentPrice;

    // Daily rate for each plan
    const currentDailyRate = currentPrice / daysInCycle;
    const targetDailyRate = targetPrice / daysInCycle;

    // For upgrade: charge the difference for remaining days
    // For downgrade: credit the difference for remaining days
    const dailyDifference = Math.abs(targetDailyRate - currentDailyRate);
    const proratedAmount = Math.round(dailyDifference * daysRemaining);

    // Calculate unused portion of current plan (credit for downgrade)
    const unusedCurrentAmount = Math.round(currentDailyRate * daysRemaining);

    // Determine the new expiry date (keep the same end date)
    // If upgrading, the expiry stays the same since they paid extra for remaining time
    // If downgrading, expiry stays the same and credit is applied

    // Validate downgrade against plan limits
    let downgradeValidation = null;
    if (isDowngrade) {
      const validation = await entitlementService.validatePlanDowngrade(restaurantId, targetPlanId);
      downgradeValidation = validation;
      if (!validation.allowed) {
        return {
          canChange: false,
          reason: validation.reason || 'Cannot downgrade: current usage exceeds plan limits.',
          proration: null,
        };
      }
    }

    // Compare features & limits for impact analysis
    const currentFeatures = sub.features || currentPlan?.features || [];
    const targetFeatures = targetPlan.features || [];
    const featuresGained = targetFeatures.filter(f => !currentFeatures.includes(f));
    const featuresLost = currentFeatures.filter(f => !targetFeatures.includes(f));

    // Compare limits (canonical three: users total, branches total, devices per branch)
    const currentLimits = sub.limits || currentPlan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };
    const targetLimits = targetPlan.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };

    const limitsChanged = {
      branches: { from: currentLimits.maxBranches, to: targetLimits.maxBranches, unlimited: targetLimits.maxBranches === 0 },
      users: { from: sub.maxUsers ?? currentPlan?.maxUsers ?? 5, to: targetPlan.maxUsers ?? 5 },
      devicesPerBranch: {
        from: (currentLimits as any).maxDevicesPerBranch ?? (currentLimits as any).maxDevices ?? 3,
        to: (targetLimits as any).maxDevicesPerBranch ?? (targetLimits as any).maxDevices ?? 3,
      },
    };

    return {
      canChange: true,
      reason: null,
      downgradeValidation,
      proration: {
        currentPlanId: sub.plan,
        currentPlanName: currentPlan?.name || sub.plan,
        currentPrice,
        targetPlanId,
        targetPlanName: targetPlan.name,
        targetPrice,
        isUpgrade,
        isDowngrade,
        isSame,
        daysInCycle,
        daysRemaining,
        daysElapsed,
        billingEnd: billingEnd.toISOString(),
        proratedAmount,
        unusedCurrentAmount,
        dailyDifference,
        currentDailyRate: Math.round(currentDailyRate * 100) / 100,
        targetDailyRate: Math.round(targetDailyRate * 100) / 100,
      },
      impact: {
        featuresGained,
        featuresLost,
        limitsChanged,
      },
    };
  }

  /**
   * Admin: Extend trial period by N days.
   */
  async extendTrial(restaurantId: string, days: number = 7): Promise<ISubscription> {
    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) throw new Error('Subscription not found');

    const newTrialEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    sub.trialEnd = newTrialEnd;
    sub.expiryDate = newTrialEnd;
    sub.graceEnd = new Date(newTrialEnd.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    if (sub.status === 'suspended' || sub.status === 'grace') {
      sub.status = 'trial';
    }
    sub.updatedAt = new Date();
    await sub.save();

    console.log(`[SubscriptionService] Trial extended for ${restaurantId}: +${days}d, new trialEnd: ${newTrialEnd.toISOString()}`);
    return sub;
  }
}

export const subscriptionService = new SubscriptionService();
