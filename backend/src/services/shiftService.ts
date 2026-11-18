/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift Service — Cash drawer shift lifecycle (Phase 2).
 *
 * Manages shift opening and closing with atomic guards so that:
 *   - Only one active shift per register per branch (partial unique index).
 *   - Only the shift opener or a Manager/Owner can close a shift.
 *   - Concurrent close attempts are rejected (atomic conditional update).
 *   - Closed shifts are immutable.
 *
 * Cash reconciliation:
 *   Expected Cash = Opening Cash + Cash Sales(from bills) + Manual Cash In
 *                 − Manual Cash Out − Cash Expenses − Cash Refunds
 *
 * Cash sales are computed from Bills (paymentMethod='Cash' + Split cashAmount),
 * not from CashLedger entries, to avoid double counting. Manual movements
 * (cash_in/cash_out/expense) come from CashLedger.
 */

import mongoose from 'mongoose';
import { shiftRepo, cashLedgerRepo } from '../repositories';
import Shift from '../models/finance/Shift';
import CashLedger from '../models/finance/CashLedger';
import Bill from '../models/intelligence/Bill';
import Device from '../models/core/Device';
import { AppError } from '../utils/AppError';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function isManagerOrOwner(role: string | undefined): boolean {
  return role === 'Owner' || role === 'Manager' || role === 'owner' || role === 'manager';
}

export type ShiftStatus = 'open' | 'closed' | 'archived';

export class ShiftService {
  /**
   * Open a shift for a register. Creates a Shift record and a CashLedger
   * opening entry. Fails if the register already has an open shift (enforced
   * by the partial unique index on {restaurantId, branchId, registerId,
   * status: 'open'}).
   */
  async openShift(
    restaurantId: string,
    data: {
      branchId: string;
      registerId: string;
      openingCash: number;
      assignedStaff?: string;
      operatorId?: string;
      operatorRole?: string;
      operatorName?: string;
    }
  ) {
    const oid = objectId(restaurantId);
    const branchOid = objectId(data.branchId);
    const openedByOid = objectId(data.operatorId || data.registerId);
    const assignedStaffOid = data.assignedStaff ? objectId(data.assignedStaff) : undefined;

    // Validate the register exists for this restaurant/branch.
    const device = await Device.findOne({
      deviceId: data.registerId,
      restaurantId: oid,
      branchId: branchOid,
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!device) {
      throw new AppError(400, `Register "${data.registerId}" not found for this restaurant/branch`);
    }

    const now = new Date();

    // Create the shift. The partial unique index
    // {restaurantId, branchId, registerId, status: 'open'} prevents concurrent
    // opens — a duplicate key error (11000) means the register already has an
    // open shift.
    try {
      const shift = await shiftRepo.forTenant(restaurantId).create({
        restaurantId: oid,
        branchId: branchOid,
        registerId: data.registerId,
        openedBy: openedByOid,
        assignedStaff: assignedStaffOid,
        openingCash: Math.round(data.openingCash * 100) / 100,
        expectedCash: Math.round(data.openingCash * 100) / 100,
        status: 'open',
        openedAt: now,
        isDeleted: false,
      } as any);

      // CashLedger opening entry (best-effort — shift is valid even if ledger
      // entry fails; the opening cash is still tracked on the shift record).
      try {
        await cashLedgerRepo.forTenant(restaurantId).create({
          restaurantId: oid,
          branchId: branchOid,
          date: now.toISOString().slice(0, 10),
          type: 'opening',
          amount: Math.round(data.openingCash * 100) / 100,
          balanceAfter: Math.round(data.openingCash * 100) / 100,
          refType: 'shift',
          refId: shift._id.toString(),
          shiftId: shift._id.toString(),
          note: 'Opening cash',
          performedBy: data.operatorName || 'System',
          isDeleted: false,
        } as any);
      } catch (err: any) {
        console.warn('[ShiftService] ledger opening entry skipped:', err.message);
      }

      return shift.toObject();
    } catch (err: any) {
      // Duplicate key on the partial index = register already has an open shift.
      if (err.code === 11000 || err.code === 11001) {
        throw new AppError(400, `Register "${data.registerId}" already has an open shift`);
      }
      throw err;
    }
  }

  /**
   * Close a shift. Computes expected cash from bills + CashLedger, records
   * variance, and creates a shift_closing ledger entry. Atomic conditional
   * update prevents concurrent closes.
   */
  async closeShift(
    restaurantId: string,
    data: {
      branchId?: string;
      registerId: string;
      closingCash: number;
      operatorId: string;
      operatorRole: string;
      operatorName: string;
      approvedBy?: string;
      approvalNotes?: string;
    }
  ) {
    const oid = objectId(restaurantId);
    const branchOid = data.branchId ? objectId(data.branchId) : undefined;

    // Find the open shift for this register (tenant-scoped).
    const shift = await shiftRepo.forTenant(restaurantId).findOne({
      registerId: data.registerId,
      status: 'open',
    } as any);

    if (!shift) {
      throw new AppError(404, `No open shift for register "${data.registerId}"`);
    }

    // Authorization: only opener or Manager/Owner can close.
    const isOpener = shift.openedBy.toString() === data.operatorId;
    if (!isOpener && !isManagerOrOwner(data.operatorRole)) {
      throw new AppError(403, 'Only the shift opener or a Manager/Owner can close this shift');
    }

    const now = new Date();
    const closeDate = now.toISOString().slice(0, 10);

    // ── Compute expected cash ──────────────────────────────────────
    // Cash sales from bills during the shift period.
    const billMatch: any = {
      restaurantId: oid,
      ...(branchOid ? { branchId: branchOid } : {}),
      createdAt: { $gte: shift.openedAt, $lte: now },
      isVoided: { $ne: true },
    };

    const [cashBills, splitBills] = await Promise.all([
      Bill.aggregate([
        { $match: { ...billMatch, paymentMethod: 'Cash' } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } },
      ]).exec(),
      Bill.aggregate([
        { $match: { ...billMatch, paymentMethod: 'Split' } },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$splitDetails.cashAmount', 0] } },
          },
        },
      ]).exec(),
    ]);

    const cashSales = Math.round(
      ((cashBills[0]?.total || 0) + (splitBills[0]?.total || 0)) * 100
    ) / 100;

    // Manual cash movements from CashLedger during the shift.
    const ledgerMatch: any = {
      restaurantId: oid,
      ...(branchOid ? { branchId: branchOid } : {}),
      shiftId: shift._id.toString(),
      createdAt: { $gte: shift.openedAt, $lte: now },
      isDeleted: { $ne: true },
    };

    const ledgerAgg = await CashLedger.aggregate([
      { $match: ledgerMatch },
      {
        $group: {
          _id: null,
          cashIn: { $sum: { $cond: [{ $eq: ['$type', 'cash_in'] }, '$amount', 0] } },
          cashOut: { $sum: { $cond: [{ $eq: ['$type', 'cash_out'] }, { $abs: '$amount' }, 0] } },
          cashExpenses: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, { $abs: '$amount' }, 0] } },
        },
      },
    ]).exec();

    const ledger = ledgerAgg[0] || { cashIn: 0, cashOut: 0, cashExpenses: 0 };

    // Cash refunds: refunded bills paid in cash during the shift.
    const refundAgg = await Bill.aggregate([
      {
        $match: {
          ...billMatch,
          isRefunded: true,
          $or: [{ paymentMethod: 'Cash' }, { 'splitDetails.cashAmount': { $gt: 0 } }],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $eq: ['$paymentMethod', 'Cash'] },
                '$refundAmount',
                { $ifNull: ['$splitDetails.cashAmount', 0] },
              ],
            },
          },
        },
      },
    ]).exec();

    const cashRefunds = Math.round((refundAgg[0]?.total || 0) * 100) / 100;

    const expectedCash = Math.round(
      ((shift.openingCash || 0) + cashSales + ledger.cashIn - ledger.cashOut - ledger.cashExpenses - cashRefunds) * 100
    ) / 100;

    const closingCash = Math.round(data.closingCash * 100) / 100;
    const variance = Math.round((closingCash - expectedCash) * 100) / 100;

    // Manager approval required for variance.
    if (variance !== 0 && !isManagerOrOwner(data.operatorRole)) {
      throw new AppError(
        403,
        `Variance of ₹${variance} requires Manager approval for shift close`
      );
    }

    // Atomic close: conditional update on status='open' prevents concurrent closes.
    const updated = await shiftRepo.forTenant(restaurantId).findOneAndUpdate(
      {
        _id: shift._id,
        status: 'open',
      } as any,
      {
        closingCash,
        expectedCash,
        variance,
        status: 'closed',
        closedAt: now,
        approvedBy: data.approvedBy ? objectId(data.approvedBy) : undefined,
        approvalNotes: data.approvalNotes || null,
      } as any,
    );

    if (!updated) {
      throw new AppError(409, 'Shift was closed concurrently — please retry');
    }

    // CashLedger shift_closing entry (best-effort).
    try {
      await cashLedgerRepo.forTenant(restaurantId).create({
        restaurantId: oid,
        branchId: branchOid,
        date: closeDate,
        type: 'shift_closing',
        amount: variance,
        balanceAfter: closingCash,
        refType: 'shift',
        refId: shift._id.toString(),
        shiftId: shift._id.toString(),
        countedCash: closingCash,
        overShort: variance,
        performedBy: data.operatorName,
        note: variance >= 0 ? 'Shift closed' : `Cash short by ₹${Math.abs(variance)}`,
        isDeleted: false,
      } as any);
    } catch (err: any) {
      console.warn('[ShiftService] ledger closing entry skipped:', err.message);
    }

    return {
      ...updated.toObject(),
      expectedCash,
      variance,
      cashSales,
      cashIn: ledger.cashIn,
      cashOut: ledger.cashOut,
      cashExpenses: ledger.cashExpenses,
      cashRefunds,
    };
  }

  /** Get a single shift by id (tenant-scoped). */
  async getShift(restaurantId: string, shiftId: string) {
    const oid = objectId(restaurantId);
    const shift = await shiftRepo.forTenant(restaurantId).findOne({
      _id: shiftId,
    } as any);
    if (!shift) throw new AppError(404, 'Shift not found');
    return shift;
  }

  /** List shifts for a restaurant/branch, optionally filtered by status/register. */
  async listShifts(
    restaurantId: string,
    params: {
      branchId?: string;
      registerId?: string;
      status?: ShiftStatus;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const oid = objectId(restaurantId);
    const query: any = { restaurantId: oid, isDeleted: { $ne: true } };
    if (params.branchId) query.branchId = objectId(params.branchId);
    if (params.registerId) query.registerId = params.registerId;
    if (params.status) query.status = params.status;
    if (params.startDate || params.endDate) {
      query.openedAt = {};
      if (params.startDate) query.openedAt.$gte = new Date(params.startDate);
      if (params.endDate) query.openedAt.$lte = new Date(params.endDate);
    }

    const result = await shiftRepo.forTenant(restaurantId).findAll(query, {
      page: params.page || 1,
      limit: params.limit || 50,
      sort: { openedAt: -1 },
    });
    return {
      data: result.data,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /** Get the currently open shift for a register (if any). */
  async getOpenShift(restaurantId: string, registerId: string) {
    const oid = objectId(restaurantId);
    return shiftRepo.forTenant(restaurantId).findOne({
      registerId,
      status: 'open',
    } as any);
  }
}

export const shiftService = new ShiftService();
