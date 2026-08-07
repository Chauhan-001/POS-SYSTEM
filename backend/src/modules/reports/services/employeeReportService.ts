/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EmployeeReportService — Staff performance reporting (Phase 1.8).
 *
 * Sales/orders/revenue by cashier, average bill, voids, refunds, manager
 * actions (from audit log) and performance ranking. Aggregated server-side.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import AuditLog from '../../../models/AuditLog';
import { dateRange, ReportScope } from './salesReportService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class EmployeeReportService {
  private billMatch(scope: ReportScope): Record<string, any> {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    return match;
  }

  /** GET /api/reports/employees/performance — per-employee ranking. */
  async performance(scope: ReportScope) {
    const match = this.billMatch(scope);
    const rows = await Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$cashierName',
          orders: { $sum: 1 },
          revenue: { $sum: { $subtract: ['$grandTotal', { $cond: [{ $eq: ['$isRefunded', true] }, { $ifNull: ['$refundAmount', 0] }, 0] }] } },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
          grossRevenue: { $sum: '$grandTotal' },
          voided: { $sum: { $cond: [{ $eq: ['$isVoided', true] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, 1, 0] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]).exec();

    // Items per employee via BillItem.
    const bills = (await Bill.find(match).select('_id cashierName').lean().exec()) as Array<{ _id: any; cashierName: string }>;
    const billEmp = new Map<string, string>();
    bills.forEach((b) => billEmp.set(b._id.toString(), b.cashierName));
    const empItems = new Map<string, number>();
    const itemRows = bills.length
      ? await BillItem.aggregate([
          { $match: { billId: { $in: bills.map((b) => b._id) } } },
          { $group: { _id: '$billId', items: { $sum: '$quantity' } } },
        ]).exec()
      : [];
    itemRows.forEach((r: any) => {
      const emp = billEmp.get(r._id.toString());
      if (emp) empItems.set(emp, (empItems.get(emp) || 0) + r.items);
    });

    return rows.map((r: any) => ({
      employee: r._id,
      orders: r.orders,
      revenue: Math.round(r.revenue * 100) / 100,
      grossRevenue: Math.round(r.grossRevenue * 100) / 100,
      averageBill: r.orders > 0 ? Math.round((r.revenue / r.orders) * 100) / 100 : 0,
      itemsSold: empItems.get(r._id) || 0,
      averageItemsPerOrder: r.orders > 0 ? Math.round(((empItems.get(r._id) || 0) / r.orders) * 100) / 100 : 0,
      discount: Math.round(r.discount * 100) / 100,
      voidedBills: r.voided,
      refundedBills: r.refunded,
    }));
  }

  /** GET /api/reports/employees/audit-activity — manager/staff actions in range. */
  async auditActivity(scope: ReportScope, limit = 100) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const rows = await AuditLog.find({
      restaurantId: objectId(scope.restaurantId),
      createdAt: { $gte: new Date(`${start}T00:00:00Z`), $lte: new Date(`${end}T23:59:59Z`) },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((r: any) => ({
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      performedBy: r.performedBy,
      timestamp: r.createdAt,
      details: r.details,
    }));
  }
}

export const employeeReportService = new EmployeeReportService();
