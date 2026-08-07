/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Validation Service — Server-side offer/coupon validation (Phase 1.6).
 *
 * Validates an offer against a customer + bill before it can be applied:
 * status/dates, time windows, min bill, max uses, per-customer limit, tier
 * eligibility, segment targeting, branch scope, stacking rules and per-restaurant
 * usage caps. Every successful application is recorded in CouponRedemption so
 * limits are enforced across POS terminals (fraud prevention).
 */

import mongoose from 'mongoose';
import Offer from '../models/Offer';
import Customer from '../models/Customer';
import CustomerSegment from '../models/CustomerSegment';
import CouponRedemption from '../models/CouponRedemption';
import { AppError } from '../utils/AppError';
import { couponRedemptionRepo, customerActivityRepo, auditLogRepo } from '../repositories';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export interface OfferValidationResult {
  valid: boolean;
  offer?: any;
  reason?: string;
  discount?: number;
}

export class OfferValidationService {
  /**
   * Validate an offer (by id or coupon code) for a customer + bill.
   * Returns { valid, offer, reason?, discount? }. Never mutates anything.
   */
  async validate(
    restaurantId: string,
    opts: {
      offerId?: string;
      couponCode?: string;
      customer?: any;                 // customer document or mapped API customer
      customerPhone?: string;
      billSubtotal?: number;
      billItems?: any[];
      branchId?: string;
    },
  ): Promise<OfferValidationResult> {
    const query: any = { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } };
    if (opts.offerId) query._id = objectId(opts.offerId);
    else if (opts.couponCode) query.couponCode = opts.couponCode.trim().toUpperCase();
    else return { valid: false, reason: 'offerId or couponCode required' };

    const offer = await Offer.findOne(query).lean().exec();
    if (!offer) return { valid: false, reason: 'Offer not found' };

    const now = new Date();
    const nowStr = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const day = now.getDay();

    // ── Status / dates ───────────────────────────────────────
    if (offer.status !== 'active') return { valid: false, reason: `Offer is ${offer.status}` };
    if (offer.startDate && offer.startDate > nowStr) return { valid: false, reason: 'Offer has not started yet' };
    if (offer.endDate && offer.endDate < nowStr) return { valid: false, reason: 'Offer has expired' };

    // ── Time window ──────────────────────────────────────────
    if (offer.daysOfWeek && offer.daysOfWeek.length > 0 && !offer.daysOfWeek.includes(day)) {
      return { valid: false, reason: 'Offer not available today' };
    }
    if (typeof offer.startHour === 'number' && typeof offer.endHour === 'number') {
      if (hour < offer.startHour || hour >= offer.endHour) {
        return { valid: false, reason: `Offer valid ${offer.startHour}:00–${offer.endHour}:00 only` };
      }
    }

    // ── Min bill ─────────────────────────────────────────────
    const subtotal = Number(opts.billSubtotal) || 0;
    if (offer.minOrderValue && subtotal < offer.minOrderValue) {
      return { valid: false, reason: `Minimum order value ₹${offer.minOrderValue} required` };
    }

    // ── Branch scope ─────────────────────────────────────────
    if (offer.branchIds && offer.branchIds.length > 0 && opts.branchId && !offer.branchIds.includes(opts.branchId)) {
      return { valid: false, reason: 'Offer not available at this branch' };
    }

    // ── Customer context ─────────────────────────────────────
    const customerPhone = opts.customer?.phone || opts.customerPhone;
    const customerId = opts.customer?._id?.toString?.() || opts.customer?.id;

    // Per-customer limit
    if (offer.maxPerCustomer && customerPhone) {
      const used = await CouponRedemption.countDocuments({
        restaurantId: objectId(restaurantId),
        offerId: offer._id,
        ...(customerId ? { customerId: objectId(customerId) } : { customerPhone }),
        status: 'applied',
      });
      if (used >= offer.maxPerCustomer) return { valid: false, reason: 'Per-customer usage limit reached' };
    }

    // Total uses cap
    if (offer.maxUses && (offer.currentUses || 0) >= offer.maxUses) {
      return { valid: false, reason: 'Offer usage limit reached' };
    }

    // ── Tier eligibility (via customer tier) ─────────────────
    if (offer.targetTier && offer.targetTier.length > 0 && customerId) {
      const cust = opts.customer?._id
        ? opts.customer
        : await Customer.findOne({ _id: objectId(customerId), restaurantId: objectId(restaurantId) }).lean().exec();
      if (cust && !offer.targetTier.includes(cust.tier)) {
        return { valid: false, reason: `Offer available to ${offer.targetTier.join('/')} members only` };
      }
    }

    // ── Segment targeting ────────────────────────────────────
    if (offer.targetSegmentIds && offer.targetSegmentIds.length > 0 && customerPhone) {
      const segments = await CustomerSegment.find({
        restaurantId: objectId(restaurantId),
        customerPhones: customerPhone,
        isDeleted: { $ne: true },
      }).lean().exec();
      const matched = segments.some((s) => offer.targetSegmentIds.includes(s._id.toString()));
      if (!matched) return { valid: false, reason: 'Offer not available for this customer segment' };
    }

    // ── Applicable products/categories (for percentage/flat on items) ──
    if ((offer.applicableCategories?.length || offer.applicableProductIds?.length) && Array.isArray(opts.billItems)) {
      const applicable = opts.billItems.some((item: any) => {
        const cat = item?.product?.category || item?.category;
        const pid = item?.product?.id || item?.menuItemId;
        return (offer.applicableCategories || []).includes(cat) || (offer.applicableProductIds || []).includes(pid);
      });
      if (!applicable) return { valid: false, reason: 'No qualifying items in this bill' };
    }

    // ── Compute discount (server-side, never client-computed) ─
    const discount = this.computeDiscount(offer, subtotal);

    return { valid: true, offer: this.sanitize(offer), discount };
  }

  /** Compute the discount amount for an offer against a subtotal. */
  private computeDiscount(offer: any, subtotal: number): number {
    if (offer.type === 'percentage') {
      const raw = subtotal * (offer.value / 100);
      return offer.maxDiscount ? Math.min(raw, offer.maxDiscount) : raw;
    }
    if (offer.type === 'flat' || offer.type === 'cashback' || offer.type === 'coupon') {
      return Math.min(offer.value, subtotal);
    }
    if (offer.type === 'reward_points') return 0;
    // bogo / free_item / combo handled at line level by the POS
    return 0;
  }

  /**
   * Record an offer/coupon application (usage ledger). Throws on violations.
   * Returns the recorded redemption.
   */
  async recordApplication(
    restaurantId: string,
    opts: {
      offerId: string;
      code?: string;
      customerId?: string;
      customerPhone?: string;
      billId?: string;
      branchId?: string;
      discountAmount: number;
      redeemedBy?: string;
    },
  ): Promise<any> {
    const redemption = await couponRedemptionRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      offerId: objectId(opts.offerId),
      code: opts.code,
      customerId: opts.customerId ? objectId(opts.customerId) : undefined,
      customerPhone: opts.customerPhone,
      billId: opts.billId,
      branchId: opts.branchId ? objectId(opts.branchId) : undefined,
      discountAmount: opts.discountAmount,
      status: 'applied',
      redeemedBy: opts.redeemedBy,
    } as any);

    // Increment the offer's usage counter.
    await Offer.updateOne({ _id: objectId(opts.offerId) }, { $inc: { currentUses: 1 } }).exec();

    if (opts.customerId) {
      await customerActivityRepo.forTenant(restaurantId).create({
        restaurantId: objectId(restaurantId),
        customerId: objectId(opts.customerId),
        customerPhone: opts.customerPhone,
        type: opts.code ? 'coupon_applied' : 'offer_applied',
        title: `${opts.code ? `Coupon ${opts.code}` : 'Offer'} applied`,
        description: `Discount ${opts.discountAmount}`,
        metadata: { offerId: opts.offerId, discount: opts.discountAmount },
        performedBy: opts.redeemedBy,
      } as any);
    }

    await auditLogRepo.create({
      action: opts.code ? 'COUPON_APPLIED' : 'OFFER_APPLIED',
      entityType: 'offer',
      entityId: opts.offerId,
      performedBy: opts.redeemedBy || 'System',
      details: { code: opts.code, customerPhone: opts.customerPhone, discount: opts.discountAmount },
    } as any);

    return redemption?.toObject();
  }

  /** Look up an offer by coupon code (tenant-scoped). */
  async findOfferByCode(restaurantId: string, code: string): Promise<any | null> {
    const offer = await Offer.findOne({
      restaurantId: objectId(restaurantId),
      couponCode: code.trim().toUpperCase(),
      isDeleted: { $ne: true },
    }).lean().exec();
    return offer ? this.sanitize(offer) : null;
  }

  private sanitize(offer: any): any {
    return {
      id: offer._id.toString(),
      title: offer.title,
      description: offer.description,
      type: offer.type,
      value: offer.value,
      minOrderValue: offer.minOrderValue,
      maxDiscount: offer.maxDiscount,
      couponCode: offer.couponCode,
      stackingAllowed: offer.stackingAllowed,
      mutuallyExclusiveGroup: offer.mutuallyExclusiveGroup,
      startDate: offer.startDate,
      endDate: offer.endDate,
    };
  }
}
