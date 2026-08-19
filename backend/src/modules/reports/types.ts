/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reports/types.ts — Shared types for the reports module (Phase 1.8).
 */

import { Request } from 'express';

export interface ReportUser {
  restaurantId: string;
  branchId?: string;
  role?: string;
}

export interface ReportScope {
  restaurantId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  /** Business-day opening time (HH:mm) — "today" report window starts here. */
  openingTime?: string;
}

export interface AuthenticatedReportRequest extends Request {
  user?: ReportUser;
}

export interface SalesSummary {
  grossSales: number;
  netSales: number;
  orders: number;
  averageOrderValue: number;
  averageItemsPerOrder: number;
  itemsSold: number;
  discounts: number;
  taxes: number;
  cashSales: number;
  nonCashSales: number;
}

export interface Comparison {
  previousRevenue: number;
  previousNetRevenue: number;
  previousOrders: number;
  revenueGrowthPct: number;
  orderGrowthPct: number;
  aovGrowthPct: number;
}
