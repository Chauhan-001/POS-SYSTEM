import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Subscription from '../models/Subscription';
import Restaurant from '../models/Restaurant';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Branch from '../models/Branch';
import Payment from '../models/Payment';
import Invoice from '../models/Invoice';
import InvoiceCounter from '../models/InvoiceCounter';
import AuditLog from '../models/AuditLog';
import crypto from 'crypto';
import { subscriptionService, isBillingPeriod, billingDurationDays, planPriceForPeriod } from '../modules/subscription/subscriptionService';
import { effectiveFeatures } from '../utils/subscriptionFeatures';
import { FEATURE_KEYS } from '../constants/planFeatures';
import { AppError } from '../utils/AppError';
import {
  hookSubscriptionRenewed,
  hookSubscriptionPlanChanged,
  hookSubscriptionPaused,
} from '../modules/adminReports/hooks';

export async function getSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const plan = req.query.plan as string;
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    if (plan) filter.plan = plan;

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      Subscription.countDocuments(filter).exec(),
    ]);

    // ─── Get last payment info for all subscriptions in one query ───
    const subIds = subscriptions.map((s) => s._id);
    const lastPayments = await Payment.aggregate([
      { $match: { subscriptionId: { $in: subIds }, status: 'success' } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$subscriptionId',
        lastPaymentAmount: { $first: '$amount' },
        lastPaymentDate: { $first: '$createdAt' },
        lastPaymentInvoice: { $first: '$invoiceNumber' },
        lastPaymentMethod: { $first: '$paymentMethod' },
      }},
    ]).exec();
    const lastPaymentMap = new Map(
      lastPayments.map((lp) => [
        lp._id.toString(),
        {
          amount: lp.lastPaymentAmount,
          date: lp.lastPaymentDate,
          invoiceNumber: lp.lastPaymentInvoice,
          method: lp.lastPaymentMethod,
        },
      ])
    );

    const data = await Promise.all(subscriptions.map(async (s) => {
      const [restaurant, plan] = await Promise.all([
        Restaurant.findById(s.restaurantId).exec(),
        SubscriptionPlan.findOne({ planId: s.plan }).exec(),
      ]);
      const statusMap: Record<string, 'active' | 'paused' | 'expired' | 'cancelled'> = {
        active: 'active',
        trial: 'active',
        expired: 'expired',
        cancelled: 'cancelled',
        paused: 'paused',
      };
      // Get branch count for this restaurant
      const branchCount = await Branch.countDocuments({
        restaurantId: s.restaurantId,
        isDeleted: { $ne: true },
      }).exec();
      const effectiveLimits = s.limits || plan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };
      const lastPayment = lastPaymentMap.get(s._id.toString());
      const effective = effectiveFeatures(s.features, s.grantedFeatures);
      return {
        id: s._id.toString(),
        restaurantId: s.restaurantId.toString(),
        restaurantName: restaurant?.name || 'Unknown',
        plan: s.plan,
        billingPeriod: s.billingPeriod || 'monthly',
        status: statusMap[s.status] || 'active',
        startDate: s.startDate.toISOString(),
        expiryDate: s.endDate?.toISOString() || s.trialEnd?.toISOString() || null,
        maxDevices: s.maxDevices,
        aiEnabled: effective.includes('ai'),
        features: effective,
        grantedFeatures: s.grantedFeatures || [],
        price: planPriceForPeriod(plan, s.billingPeriod) || 0,
        autoRenew: s.status === 'active',
        limits: effectiveLimits,
        branchUsage: {
          total: branchCount,
          maximum: effectiveLimits.maxBranches === 0 ? 'unlimited' : effectiveLimits.maxBranches,
        },
        lastPayment: lastPayment ? {
          amount: lastPayment.amount,
          date: new Date(lastPayment.date).toISOString(),
          invoiceNumber: lastPayment.invoiceNumber,
          method: lastPayment.method,
        } : null,
      };
    }));

    res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[AdminSubscriptions] List error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSubscription(req: Request, res: Response): Promise<void> {
  try {
    const sub = await Subscription.findById(req.params.id).exec();
    if (!sub) { res.status(404).json({ message: 'Subscription not found' }); return; }
    const [restaurant, plan] = await Promise.all([
      Restaurant.findById(sub.restaurantId).exec(),
      SubscriptionPlan.findOne({ planId: sub.plan }).exec(),
    ]);
    const statusMap: Record<string, 'active' | 'paused' | 'expired' | 'cancelled'> = {
      active: 'active', trial: 'active', expired: 'expired',
      cancelled: 'cancelled', paused: 'paused',
    };
    res.json({
      id: sub._id.toString(), restaurantId: sub.restaurantId.toString(), restaurantName: restaurant?.name || 'Unknown',
      plan: sub.plan, billingPeriod: sub.billingPeriod || 'monthly', status: statusMap[sub.status] || 'active',
      startDate: sub.startDate.toISOString(), expiryDate: sub.endDate?.toISOString() || sub.trialEnd?.toISOString() || null,
      maxDevices: sub.maxDevices, aiEnabled: sub.features.includes('ai'), price: planPriceForPeriod(plan, sub.billingPeriod) || 0, autoRenew: sub.status === 'active',
    });
  } catch (error) {
    console.error('[AdminSubscriptions] Get error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function renewSubscription(req: Request, res: Response): Promise<void> {
  try {
    // Validate subscription exists
    const sub = await Subscription.findById(req.params.id).exec();
    if (!sub) { res.status(404).json({ message: 'Subscription not found' }); return; }

    // Resolve plan + billing period to get the period's default price.
    const plan = await SubscriptionPlan.findOne({ planId: sub.plan }).exec();
    const period = isBillingPeriod(req.body.billingPeriod) ? req.body.billingPeriod : (sub.billingPeriod || 'monthly');
    const defaultPrice = planPriceForPeriod(plan, period) || 499;

    // Payment details from request body (admin can override amount for partial/cash)
    const { amount = defaultPrice, notes = '', paymentMethod = 'cash' } = req.body;
    const parsedAmount = Math.max(1, Math.round(parseFloat(amount) || defaultPrice));

    // Admin identity for audit trail
    const adminUser = (req as any).user;
    const adminName = adminUser?.name || adminUser?.userId || 'Admin';

    // Generate a unique cash order reference
    const cashOrderId = `cash_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Generate atomic invoice number
    const counter = await InvoiceCounter.findOneAndUpdate(
      { name: 'subscription_admin' },
      { $inc: { sequence: 1 } },
      { upsert: true, new: true }
    ).exec();
    const invoiceNumber = `SUB-${new Date().getFullYear()}-${String(counter.sequence).padStart(6, '0')}`;

    // Create Payment record
    const payment = await Payment.create({
      restaurantId: sub.restaurantId,
      subscriptionId: sub._id,
      razorpayOrderId: cashOrderId,
      amount: parsedAmount,
      currency: 'INR',
      gateway: 'cash',
      paymentMethod: paymentMethod,
      billingPeriod: period,
      status: 'success',
      invoiceNumber,
    });

    // Create Invoice record
    const invoice = await Invoice.create({
      restaurantId: sub.restaurantId,
      paymentId: payment._id,
      invoiceNumber,
      plan: sub.plan,
      amount: parsedAmount,
      tax: Math.round(parsedAmount * 0.18), // 18% GST
      generatedAt: new Date(),
    });

    // Extend subscription by the cadence that was paid for (monthly = 30d, yearly = 365d).
    const now = new Date();
    const baseDate = (sub.expiryDate && sub.expiryDate > now) ? sub.expiryDate : now;
    const newExpiry = new Date(baseDate.getTime() + billingDurationDays(period) * 24 * 60 * 60 * 1000);
    const newGraceEnd = new Date(newExpiry.getTime() + 10 * 24 * 60 * 60 * 1000);

    await Subscription.findByIdAndUpdate(req.params.id, {
      $set: {
        status: 'active',
        billingPeriod: period,
        subscriptionStart: sub.subscriptionStart || now,
        expiryDate: newExpiry,
        renewalDate: newExpiry,
        graceEnd: newGraceEnd,
      },
    }).exec();

    // Create AuditLog entry
    await AuditLog.create({
      action: 'subscription.renewed.cash',
      entityType: 'Subscription',
      entityId: sub._id.toString(),
      performedBy: adminName,
      performedById: adminUser?.id || adminUser?._id?.toString(),
      details: {
        restaurantId: sub.restaurantId.toString(),
        plan: sub.plan,
        billingPeriod: period,
        amount: parsedAmount,
        paymentMethod,
        invoiceNumber,
        notes,
        expiryDate: newExpiry.toISOString(),
      },
    });

    console.log(`[AdminSubscriptions] Cash renewal for ${sub.restaurantId}: ${invoiceNumber}, amount: ${parsedAmount}, by: ${adminName}`);

    hookSubscriptionRenewed({
      restaurantId: sub.restaurantId,
      subscriptionId: sub._id,
      plan: sub.plan,
      planName: plan?.name,
      amount: parsedAmount,
      ownerId: adminUser?.id || adminUser?._id,
    });

    res.json({
      message: 'Subscription renewed successfully',
      invoiceNumber,
      amount: parsedAmount,
      paymentMethod,
      billingPeriod: period,
      expiryDate: newExpiry.toISOString(),
    });
  } catch (error) {
    console.error('[AdminSubscriptions] Renew error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Resolve a subscription to its restaurantId for plan changes, and sync the
 * features/limits snapshot so plan changes take effect immediately. Delegates
 * to the subscription module's changePlan() — the canonical snapshot logic.
 */
async function resolveSubId(req: Request): Promise<mongoose.Types.ObjectId> {
  const sub = await Subscription.findById(req.params.id).select('restaurantId').exec();
  if (!sub) throw new AppError(404, 'Subscription not found');
  return sub.restaurantId;
}

/**
 * Change a subscription's plan (upgrade OR downgrade) with full snapshot sync.
 * Delegates to subscriptionService.changePlan so features/limits propagate and
 * downgrade guards (entitlementService.validatePlanDowngrade) are enforced.
 */
async function changeSubscriptionPlan(req: Request, res: Response, mode: 'upgrade' | 'downgrade') {
  const { plan, billingPeriod } = req.body;
  if (!plan?.trim()) {
    res.status(400).json({ message: 'Target plan is required' });
    return;
  }
  try {
    const restaurantId = await resolveSubId(req);
    const before = await Subscription.findById(req.params.id).select('plan').exec();
    const updated = await subscriptionService.changePlan(restaurantId.toString(), plan.trim(), billingPeriod);
    hookSubscriptionPlanChanged({
      restaurantId,
      subscriptionId: req.params.id,
      mode,
      fromPlan: before?.plan ?? undefined,
      toPlan: updated.plan,
      toPlanName: updated.plan,
    });
    res.json({
      message: `Subscription ${mode === 'upgrade' ? 'upgraded' : 'downgraded'} to ${plan.trim()}`,
      subscription: {
        id: req.params.id,
        plan: updated.plan,
        status: updated.status,
        features: updated.features || [],
        limits: updated.limits || {},
      },
    });
  } catch (error: any) {
    console.error(`[AdminSubscriptions] ${mode} error:`, error);
    res.status(error?.statusCode || 400).json({ message: error?.message || `Failed to ${mode} subscription` });
  }
}

export async function upgradeSubscription(req: Request, res: Response): Promise<void> {
  await changeSubscriptionPlan(req, res, 'upgrade');
}

export async function downgradeSubscription(req: Request, res: Response): Promise<void> {
  await changeSubscriptionPlan(req, res, 'downgrade');
}

export async function pauseSubscription(req: Request, res: Response): Promise<void> {
  try {
    const sub = await Subscription.findByIdAndUpdate(req.params.id, { status: 'paused' }, { new: true }).exec();
    if (!sub) { res.status(404).json({ message: 'Subscription not found' }); return; }
    hookSubscriptionPaused({ restaurantId: sub.restaurantId, subscriptionId: sub._id, plan: sub.plan, pause: true });
    res.json({ message: 'Subscription paused' });
  } catch (error) {
    console.error('[AdminSubscriptions] Pause error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function resumeSubscription(req: Request, res: Response): Promise<void> {
  try {
    const sub = await Subscription.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true }).exec();
    if (!sub) { res.status(404).json({ message: 'Subscription not found' }); return; }
    hookSubscriptionPaused({ restaurantId: sub.restaurantId, subscriptionId: sub._id, plan: sub.plan, pause: false });
    res.json({ message: 'Subscription resumed' });
  } catch (error) {
    console.error('[AdminSubscriptions] Resume error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSubscriptionPayments(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const search = (req.query.search as string)?.trim() || '';
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 10));

    // Build date filter
    const dateFilter: Record<string, any> = {};
    if (startDate || endDate) {
      const gte = startDate ? new Date(startDate) : undefined;
      const lte = endDate ? new Date(endDate) : undefined;
      if (gte && !isNaN(gte.getTime())) dateFilter.$gte = gte;
      if (lte && !isNaN(lte.getTime())) dateFilter.$lte = lte;
    }

    const paymentFilter: Record<string, any> = { restaurantId };
    const invoiceFilter: Record<string, any> = { restaurantId };

    if (Object.keys(dateFilter).length > 0) {
      paymentFilter.createdAt = dateFilter;
      invoiceFilter.generatedAt = dateFilter;
    }

    const [allPayments, allInvoices] = await Promise.all([
      Payment.find(paymentFilter).sort({ createdAt: -1 }).limit(200).exec(),
      Invoice.find(invoiceFilter).sort({ generatedAt: -1 }).limit(200).exec(),
    ]);

    // Apply client-side search
    let filteredPayments = allPayments;
    let filteredInvoices = allInvoices;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredPayments = allPayments.filter((p) =>
        p.invoiceNumber?.toLowerCase().includes(lowerSearch) ||
        String(p.amount).includes(lowerSearch) ||
        p.status?.toLowerCase().includes(lowerSearch)
      );
      filteredInvoices = allInvoices.filter((inv) =>
        inv.invoiceNumber?.toLowerCase().includes(lowerSearch) ||
        inv.plan?.toLowerCase().includes(lowerSearch) ||
        String(inv.amount).includes(lowerSearch)
      );
    }

    const paymentTotal = filteredPayments.length;
    const invoiceTotal = filteredInvoices.length;
    const paymentPage = Math.ceil(paymentTotal / pageSize);
    const invoicePage = Math.ceil(invoiceTotal / pageSize);
    const totalPages = Math.max(1, paymentPage, invoicePage);

    const skip = (page - 1) * pageSize;
    const payments = filteredPayments.slice(skip, skip + pageSize);
    const invoices = filteredInvoices.slice(skip, skip + pageSize);

    res.json({
      payments: payments.map((p) => ({
        id: p._id.toString(),
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        invoiceNumber: p.invoiceNumber,
        createdAt: p.createdAt.toISOString(),
      })),
      invoices: invoices.map((inv) => ({
        id: inv._id.toString(),
        invoiceNumber: inv.invoiceNumber,
        plan: inv.plan,
        amount: inv.amount,
        tax: inv.tax,
        pdfUrl: inv.pdfUrl,
        generatedAt: inv.generatedAt.toISOString(),
      })),
      totalPages,
      page,
      pageSize,
      paymentTotal,
      invoiceTotal,
    });
  } catch (error) {
    console.error('[AdminSubscriptions] Payment history error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSubscriptionByRestaurant(req: Request, res: Response): Promise<void> {
  try {
    const sub = await Subscription.findOne({ restaurantId: req.params.id }).exec();
    if (!sub) { res.status(404).json({ message: 'Subscription not found' }); return; }
    const [restaurant, plan] = await Promise.all([
      Restaurant.findById(sub.restaurantId).exec(),
      SubscriptionPlan.findOne({ planId: sub.plan }).exec(),
    ]);
    const branchCount = await Branch.countDocuments({
      restaurantId: sub.restaurantId,
      isDeleted: { $ne: true },
    }).exec();
    const effectiveLimits = sub.limits || plan?.limits || { maxBranches: 1, maxDevicesPerBranch: 3 };
    const effective = effectiveFeatures(sub.features, sub.grantedFeatures);
    res.json({
      id: sub._id.toString(),
      restaurantId: sub.restaurantId.toString(),
      restaurantName: restaurant?.name || 'Unknown',
      plan: sub.plan,
      billingPeriod: sub.billingPeriod || 'monthly',
      status: sub.status,
      startDate: sub.startDate.toISOString(),
      expiryDate: sub.endDate?.toISOString() || sub.trialEnd?.toISOString() || null,
      trialEnd: sub.trialEnd?.toISOString() || null,
      graceEnd: sub.graceEnd?.toISOString() || null,
      maxDevices: sub.maxDevices,
      price: planPriceForPeriod(plan, sub.billingPeriod) || 0,
      autoRenew: sub.status === 'active',
      // Effective feature set = plan snapshot + admin-granted add-ons.
      features: effective,
      grantedFeatures: sub.grantedFeatures || [],
      planFeatures: plan?.features || [],
      limits: effectiveLimits,
      branchUsage: {
        total: branchCount,
        maximum: effectiveLimits.maxBranches === 0 ? 'unlimited' : effectiveLimits.maxBranches,
      },
    });
  } catch (error) {
    console.error('[AdminSubscriptions] Get by restaurant error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * PUT /api/admin/restaurants/:id/subscription/features
 * Grant or revoke add-on features on the restaurant's CURRENT plan.
 *
 * Body: { grant?: string[], revoke?: string[] }
 *   - grant  — add these feature keys to the subscription's grantedFeatures
 *   - revoke — remove these feature keys from grantedFeatures
 *
 * The change is immediate and reflected everywhere entitlements are checked
 * (requireFeature middleware, entitlementService, POS subscription status,
 * admin dashboard). Grants live OUTSIDE the plan snapshot, so they survive
 * plan upgrades/downgrades and the free-tier fallback. Revoking a feature the
 * plan itself includes has no effect (plan features always stay active).
 */
export async function updateGrantedFeatures(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const { grant = [], revoke = [] } = req.body || {};
    const grantList: string[] = Array.isArray(grant) ? grant : [];
    const revokeList: string[] = Array.isArray(revoke) ? revoke : [];

    // Unknown feature keys are rejected up-front (defense-in-depth beyond the
    // Zod schema) so a typo can never silently write a bogus feature.
    const unknown = [...grantList, ...revokeList].filter((f) => !FEATURE_KEYS.has(f));
    if (unknown.length > 0) {
      res.status(400).json({ message: `Unknown feature key(s): ${unknown.join(', ')}` });
      return;
    }

    const sub = await Subscription.findOne({ restaurantId }).exec();
    if (!sub) {
      res.status(404).json({ message: 'Subscription not found' });
      return;
    }

    const granted = new Set(sub.grantedFeatures || []);
    grantList.forEach((f) => granted.add(f));
    revokeList.forEach((f) => granted.delete(f));
    sub.grantedFeatures = Array.from(granted);
    await sub.save();

    const effective = effectiveFeatures(sub.features, sub.grantedFeatures);
    const adminUser = (req as any).user;
    const adminName = adminUser?.name || adminUser?.userId || 'Admin';
    await AuditLog.create({
      action: 'subscription.features.updated',
      entityType: 'Subscription',
      entityId: sub._id.toString(),
      performedBy: adminName,
      performedById: adminUser?.id || adminUser?._id?.toString(),
      details: {
        restaurantId: sub.restaurantId.toString(),
        plan: sub.plan,
        granted: grantList,
        revoked: revokeList,
        grantedFeatures: sub.grantedFeatures,
        effectiveFeatures: effective,
      },
    });

    console.log(`[AdminSubscriptions] Feature grant updated for ${sub.restaurantId}: +${grantList.join(',') || 'none'} -${revokeList.join(',') || 'none'}`);

    res.json({
      message: 'Feature access updated',
      subscription: {
        id: sub._id.toString(),
        restaurantId: sub.restaurantId.toString(),
        plan: sub.plan,
        grantedFeatures: sub.grantedFeatures,
        features: effective,
      },
    });
  } catch (error) {
    console.error('[AdminSubscriptions] Feature grant error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
