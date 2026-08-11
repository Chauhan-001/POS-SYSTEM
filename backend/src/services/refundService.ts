/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RefundService — drives the RefundRecord state machine:
 *
 *   PENDING → PROCESSING → SUCCEEDED  (provider/cashier confirmed)
 *                         → FAILED     (never silently retried/claimed)
 *
 * Two gateways:
 *   - 'ledger'   : POS cash-ledger refund through BillService.refundBill. The
 *                  bill's isRefunded flag + refundedAt IS the confirmation.
 *   - 'razorpay' : provider-mediated refund. SUCCEEDED only when the gateway
 *                  returns a refund id.
 *
 * Idempotency: every entry has a unique refundId — a duplicate request returns
 * the existing record instead of issuing a second refund.
 */

import mongoose from 'mongoose';
import RefundRecord, { IRefundRecord, RefundStatus } from '../models/RefundRecord';
import { auditLogRepo } from '../repositories';
import { paymentGateway } from '../modules/payment/RazorpayGateway';
import { AppError } from '../utils/AppError';

export interface RefundInput {
  refundId: string;
  orderId: string;
  restaurantId: string;
  branchId?: string | null;
  amount: number;
  gateway?: 'ledger' | 'razorpay' | 'manual';
  billId?: string | null;
  paymentRef?: string;
  reason: string;
  performedBy: string;
  performedById?: string;
}

export class RefundService {
  /**
   * Create (or return the existing) refund record. The idempotency key makes
   * duplicate submissions safe: second call with the same refundId returns the
   * original record untouched.
   */
  async create(input: RefundInput): Promise<IRefundRecord> {
    const existing = await RefundRecord.findOne({ refundId: input.refundId }).exec();
    if (existing) {
      console.log(`[RefundService] idempotent replay: refundId=${input.refundId} already recorded (${existing.status})`);
      return existing;
    }

    const record = await RefundRecord.create({
      refundId: input.refundId,
      orderId: new mongoose.Types.ObjectId(input.orderId),
      billId: input.billId ? new mongoose.Types.ObjectId(input.billId) : null,
      restaurantId: new mongoose.Types.ObjectId(input.restaurantId),
      branchId: input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)
        ? new mongoose.Types.ObjectId(input.branchId)
        : null,
      amount: Math.round(input.amount * 100) / 100,
      status: 'PENDING',
      gateway: input.gateway || 'ledger',
      paymentRef: input.paymentRef,
      reason: input.reason,
      performedBy: input.performedBy,
      performedById: input.performedById,
    });

    auditLogRepo.create({
      action: 'refund.created',
      entityType: 'order',
      entityId: input.orderId,
      performedBy: input.performedBy,
      performedById: input.performedById,
      restaurantId: record.restaurantId,
      branchId: record.branchId || undefined,
      details: { refundId: record.refundId, amount: record.amount, gateway: record.gateway, status: 'PENDING' },
    } as any).catch((err: any) => console.warn('[RefundService] audit write failed:', err?.message));

    return record;
  }

  /** Move a record to PROCESSING. */
  async markProcessing(refundId: string, paymentRef?: string): Promise<IRefundRecord | null> {
    return RefundRecord.findOneAndUpdate(
      { refundId },
      { $set: { status: 'PROCESSING' as RefundStatus, paymentRef } },
      { new: true }
    ).exec();
  }

  /** Confirm success — called ONLY when the payment system confirms. */
  async markSucceeded(refundId: string, providerRefundId?: string, error?: string): Promise<IRefundRecord | null> {
    const record = await RefundRecord.findOneAndUpdate(
      { refundId },
      { $set: { status: 'SUCCEEDED' as RefundStatus, providerRefundId, error: error || undefined } },
      { new: true }
    ).exec();
    if (record) {
      auditLogRepo.create({
        action: 'refund.completed',
        entityType: 'order',
        entityId: record.orderId.toString(),
        performedBy: record.performedBy,
        restaurantId: record.restaurantId,
        details: { refundId: record.refundId, amount: record.amount, providerRefundId: providerRefundId || null },
      } as any).catch(() => undefined);
    }
    return record;
  }

  /** Mark failed — a FAILED refund never claims money moved. */
  async markFailed(refundId: string, error: string): Promise<IRefundRecord | null> {
    const record = await RefundRecord.findOneAndUpdate(
      { refundId },
      { $set: { status: 'FAILED' as RefundStatus, error } },
      { new: true }
    ).exec();
    if (record) {
      auditLogRepo.create({
        action: 'refund.failed',
        entityType: 'order',
        entityId: record.orderId.toString(),
        performedBy: record.performedBy,
        restaurantId: record.restaurantId,
        details: { refundId: record.refundId, amount: record.amount, error },
      } as any).catch(() => undefined);
    }
    return record;
  }

  /**
   * Execute a gateway refund for an online payment. Only reaches SUCCEEDED
   * when the gateway returns a refund id; any failure leaves the record FAILED
   * and rethrows so the caller surfaces the human-friendly error.
   */
  async refundOnlinePayment(record: IRefundRecord, amountInPaise: number): Promise<IRefundRecord> {
    if (!record.paymentRef) {
      const failed = await this.markFailed(record.refundId, 'No payment reference on refund record');
      throw new AppError(400, 'Cannot refund: no payment reference exists for this order');
    }
    await this.markProcessing(record.refundId, record.paymentRef);
    try {
      const result = await paymentGateway.refund({
        paymentId: record.paymentRef,
        amount: amountInPaise,
        notes: { orderId: record.orderId.toString(), refundId: record.refundId },
      });
      // Provider accepted the refund — record its id as the confirmation.
      const done = await this.markSucceeded(record.refundId, result.id);
      if (!done) throw new Error('Refund record vanished during processing');
      return done;
    } catch (err: any) {
      await this.markFailed(record.refundId, err?.message || 'Gateway refund failed');
      throw err;
    }
  }

  /** List refunds for an order. */
  async listForOrder(orderId: string): Promise<any[]> {
    const rows = await RefundRecord.find({ orderId: new mongoose.Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return rows;
  }
}

export const refundService = new RefundService();
