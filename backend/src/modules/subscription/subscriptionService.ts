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
import crypto from 'crypto';

export const SUBSCRIPTION_DURATION_DAYS = 30;
export const GRACE_PERIOD_DAYS = 10;
// Single source of truth for the free-trial length (config.subscription.trialDays).
const TRIAL_DAYS = config.subscription.trialDays;

/**
 * Every feature unlocked during the 7-day free trial.
 * Trial subscribers get the full product — feature restrictions apply only
 * after a paid plan is selected. Mirrors admin onboarding 'trial' mode.
 */
const ALL_TRIAL_FEATURES = [
  'core_pos', 'basic_reports', 'ai', 'inventory', 'loyalty',
  'reservations', 'multi_branch', 'analytics', 'custom_branding',
  'advanced_reports', 'expense_tracking', 'api_access', 'priority_support',
];

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
      if (sub.graceEnd && now < sub.graceEnd) {
        sub.status = 'grace';
        changed = true;
      } else if (sub.graceEnd && now > sub.graceEnd) {
        sub.status = 'suspended';
        changed = true;
      } else {
        // Trial ended but no graceEnd set — set it now
        sub.status = 'grace';
        sub.graceEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        changed = true;
      }
    } else if (sub.status === 'active' && sub.expiryDate && now > sub.expiryDate) {
      sub.status = 'grace';
      sub.graceEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      changed = true;
    } else if (sub.status === 'grace' && sub.graceEnd && now > sub.graceEnd) {
      sub.status = 'suspended';
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
    const effectiveLimits = sub.limits || plan?.limits || { maxBranches: 1, maxDevices: 3, maxEmployees: 10 };

    return {
      restaurantId,
      restaurantName: restaurant?.name || 'Restaurant',
      plan: sub.plan,
      pendingPlan: sub.pendingPlan || null,
      pendingEffectiveDate: sub.pendingEffectiveDate?.toISOString() || null,
      status: sub.status,
      trialStart: sub.trialStart,
      trialEnd: sub.trialEnd,
      subscriptionStart: sub.subscriptionStart,
      expiryDate: sub.expiryDate,
      renewalDate: sub.renewalDate,
      graceEnd: sub.graceEnd,
      maxDevices: sub.maxDevices,
      currentDevices,
      features: sub.status === 'trial' ? ALL_TRIAL_FEATURES : sub.features,
      limits: effectiveLimits,
      branchUsage: branchUsage.usage,
    };
  }

  async createOrder(restaurantId: string, planId: string) {
    const plan = await SubscriptionPlan.findOne({ planId }).exec()
      || await SubscriptionPlan.findOne({ isDefault: true }).exec();
    if (!plan) {
      throw new Error('No subscription plan found');
    }

    const amount = plan.price * 100; // Convert to paise
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
      amount: plan.price,
      currency: 'INR',
      gateway: 'razorpay',
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
      restaurantId: payment.restaurantId,
      paymentId: payment._id,
      invoiceNumber: payment.invoiceNumber,
      plan: payment.subscriptionId ? 'professional' : 'professional',
      amount: payment.amount,
      tax: Math.round(payment.amount * 0.18), // 18% GST
      generatedAt: new Date(),
    });

    // Activate subscription
    const now = new Date();
    const expiry = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (sub) {
      sub.status = 'active';
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
        restaurantId: payment.restaurantId,
        paymentId: payment._id,
        invoiceNumber: payment.invoiceNumber,
        plan: 'professional',
        amount: payment.amount,
        tax: Math.round(payment.amount * 0.18),
        generatedAt: new Date(),
      });
    }

    // Activate subscription
    const now = new Date();
    const existingSub = await Subscription.findOne({ restaurantId: payment.restaurantId }).exec();

    // Calculate new expiry — if still in active period, extend from current expiry
    let baseDate = now;
    if (existingSub && existingSub.expiryDate && existingSub.expiryDate > now) {
      baseDate = existingSub.expiryDate;
    }

    const newExpiry = new Date(baseDate.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await Subscription.findOneAndUpdate(
      { restaurantId: payment.restaurantId },
      {
        $set: {
          status: 'active',
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

  async manualRenew(restaurantId: string, options?: { amount?: number; notes?: string; paymentMethod?: string }) {
    const now = new Date();
    const existingSub = await Subscription.findOne({ restaurantId }).exec();
    if (!existingSub) {
      throw new Error('Subscription not found. Cannot renew without an active subscription.');
    }

    // Resolve plan to get default price
    const plan = existingSub.plan
      ? await SubscriptionPlan.findOne({ planId: existingSub.plan }).exec()
      : null;
    const defaultPrice = plan?.price || 499;

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

    // Extend subscription
    const baseDate = (existingSub.expiryDate && existingSub.expiryDate > now)
      ? existingSub.expiryDate
      : now;
    const newExpiry = new Date(baseDate.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOneAndUpdate(
      { restaurantId },
      {
        $set: {
          status: 'active',
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

  async changePlan(restaurantId: string, planId: string) {
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
    const expiryDate = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(expiryDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const sub = await Subscription.findOneAndUpdate(
      { restaurantId },
      {
        $set: {
          plan: plan.planId,
          maxDevices: plan.maxDevices,
          maxUsers: plan.maxUsers,
          features: plan.features,
          limits: {
            maxRestaurants: plan.limits?.maxRestaurants ?? 1,
            maxBranches: plan.limits?.maxBranches ?? 1,
            maxDevices: plan.limits?.maxDevices ?? 3,
            maxEmployees: plan.limits?.maxEmployees ?? 10,
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
      maxDevices: targetPlan.limits?.maxDevices ?? 3,
      maxEmployees: targetPlan.limits?.maxEmployees ?? 10,
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

    // Compare limits
    const currentLimits = sub.limits || currentPlan?.limits || { maxBranches: 1, maxDevices: 3, maxEmployees: 10 };
    const targetLimits = targetPlan.limits || { maxBranches: 1, maxDevices: 3, maxEmployees: 10 };

    const limitsChanged = {
      branches: { from: currentLimits.maxBranches, to: targetLimits.maxBranches, unlimited: targetLimits.maxBranches === 0 },
      devices: { from: currentLimits.maxDevices, to: targetLimits.maxDevices },
      employees: { from: currentLimits.maxEmployees, to: targetLimits.maxEmployees },
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
