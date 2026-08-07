/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BranchReportService — Consolidated per-branch report (Phase 1.8).
 *
 * Aggregates sales (orders/revenue/discount/tax), expenses and employee
 * headcount per branch using MongoDB pipelines, tenant-scoped by
 * restaurantId and branch-aware. Voided bills are excluded; refunded bills
 * contribute their net value. Returns per-branch rows plus grand totals so
 * exports exactly match the displayed report.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import Expense from '../../../models/Expense';
import Employee from '../../../models/Employee';
import Branch from '../../../models/Branch';
import { dateRange } from './salesReportService';
import type { ReportScope } from '../types';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class BranchReportService {
  /** Per-branch consolidated summary for the restaurant/range. */
  async branchSummary(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const tenantMatch: Record<string, any> = { restaurantId: objectId(scope.restaurantId) };
    const billMatch: Record<string, any> = {
      ...tenantMatch,
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
    };
    if (scope.branchId) billMatch.branchId = objectId(scope.branchId);

    const [billRows, expenseRows, employeeRows, branches] = await Promise.all([
      Bill.aggregate([
        { $match: billMatch },
        {
          $group: {
            _id: '$branchId',
            orders: { $sum: 1 },
            revenue: {
              $sum: {
                $cond: [{ $eq: ['$isRefunded', true] }, { $subtract: ['$grandTotal', '$refundAmount'] }, '$grandTotal'],
              },
            },
            discount: { $sum: { $ifNull: ['$discount', 0] } },
            tax: { $sum: { $ifNull: ['$gst', 0] } },
          },
        },
      ]).exec(),
      Expense.aggregate([
        { $match: { ...tenantMatch, date: { $gte: start, $lte: end }, isDeleted: { $ne: true } } },
        { $group: { _id: '$branchId', amount: { $sum: '$amount' } } },
      ]).exec(),
      Employee.aggregate([
        { $match: tenantMatch },
        {
          $group: {
            _id: '$branchId',
            employees: { $sum: 1 },
            activeEmployees: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } },
          },
        },
      ]).exec(),
      Branch.find(tenantMatch).select('name').lean().exec(),
    ]);

    const branchName = new Map<string, string>();
    (branches as any[]).forEach((b) => branchName.set(String(b._id), b.name || 'Unnamed Branch'));
    const expMap = new Map(expenseRows.map((r: any) => [String(r._id), r.amount || 0]));
    const empMap = new Map(employeeRows.map((r: any) => [String(r._id), r]));

    // Union of branch ids across all three datasets (null = unassigned).
    const ids = new Set<string>();
    billRows.forEach((r: any) => ids.add(String(r._id)));
    expenseRows.forEach((r: any) => ids.add(String(r._id)));
    employeeRows.forEach((r: any) => ids.add(String(r._id)));

    const rows = Array.from(ids)
      .map((bid) => {
        const b = billRows.find((r: any) => String(r._id) === bid) || { orders: 0, revenue: 0, discount: 0, tax: 0 };
        const expenses = Math.round((expMap.get(bid) || 0) * 100) / 100;
        const emp = empMap.get(bid) || { employees: 0, activeEmployees: 0 };
        const revenue = Math.round((b.revenue || 0) * 100) / 100;
        const discount = Math.round((b.discount || 0) * 100) / 100;
        const tax = Math.round((b.tax || 0) * 100) / 100;
        const isUnassigned = bid === 'null' || bid === 'undefined';
        return {
          branchId: isUnassigned ? '' : bid,
          branchName: isUnassigned ? 'Unassigned' : branchName.get(bid) || 'Unknown Branch',
          orders: b.orders || 0,
          revenue,
          discount,
          tax,
          netRevenue: Math.round((revenue - discount) * 100) / 100,
          expenses,
          employees: emp.employees || 0,
          activeEmployees: emp.activeEmployees || 0,
          profit: Math.round((revenue - discount - expenses) * 100) / 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const totals = rows.reduce(
      (t, r) => ({
        orders: t.orders + r.orders,
        revenue: t.revenue + r.revenue,
        discount: t.discount + r.discount,
        tax: t.tax + r.tax,
        netRevenue: t.netRevenue + r.netRevenue,
        expenses: t.expenses + r.expenses,
        employees: t.employees + r.employees,
        activeEmployees: t.activeEmployees + r.activeEmployees,
        profit: t.profit + r.profit,
      }),
      { orders: 0, revenue: 0, discount: 0, tax: 0, netRevenue: 0, expenses: 0, employees: 0, activeEmployees: 0, profit: 0 }
    );

    return { period: { start, end }, branches: rows, totals };
  }
}

export const branchReportService = new BranchReportService();
