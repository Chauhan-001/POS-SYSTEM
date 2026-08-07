/**
 * =============================================================================
 *  reports.ts — Restaurant Reports API (Phase 1.8)
 * =============================================================================
 *
 * Endpoints (admin-authenticated, read-only platform console view). Every
 * figure is computed by the backend reporting engine via MongoDB aggregation
 * pipelines / materialized summaries — the dashboard only renders it.
 *
 *   GET /admin/restaurants/:id/reports/sales-summary          → getAdminSalesSummary()
 *   GET /admin/restaurants/:id/reports/sales-trend            → getAdminSalesTrend()
 *   GET /admin/restaurants/:id/reports/sales-payments         → getAdminSalesPayments()
 *   GET /admin/restaurants/:id/reports/sales-order-types      → getAdminSalesOrderTypes()
 *   GET /admin/restaurants/:id/reports/sales-cashiers         → getAdminSalesCashiers()
 *   GET /admin/restaurants/:id/reports/products-top           → getAdminProductTop()
 *   GET /admin/restaurants/:id/reports/products-categories    → getAdminProductCategories()
 *   GET /admin/restaurants/:id/reports/products-abc           → getAdminProductAbc()
 *   GET /admin/restaurants/:id/reports/inventory-stock        → getAdminInventoryStock()
 *   GET /admin/restaurants/:id/reports/inventory-valuation    → getAdminInventoryValuation()
 *   GET /admin/restaurants/:id/reports/employees-performance  → getAdminEmployeePerformance()
 *   GET /admin/restaurants/:id/reports/closing-z              → getAdminClosingZ()
 *   GET /admin/restaurants/:id/reports/summaries-monthly      → getAdminSummariesMonthly()
 */

import apiClient from './client'

// ─── Types (mirror backend report DTOs) ──────────────────────────

export interface ReportPeriod { start: string; end: string; previousStart: string; previousEnd: string }

export interface SalesSummaryData {
  period: ReportPeriod
  summary: {
    grossSales: number
    netSales: number
    orders: number
    averageOrderValue: number
    averageItemsPerOrder: number
    itemsSold: number
    discounts: number
    taxes: number
    cashSales: number
    nonCashSales: number
    pointsEarned: number
    pointsRedeemed: number
  }
  comparison: {
    previousRevenue: number
    previousNetRevenue: number
    previousOrders: number
    previousItems?: number
    revenueGrowthPct: number
    orderGrowthPct: number
    aovGrowthPct: number
  }
  status: { completed: number; voided: number; refunded: number; refundAmount: number; cancelled: number }
}

export interface SalesTrendPoint { date?: string; name?: string; revenue: number; orders: number; items?: number }
export interface SalesPaymentRow { method: string; amount: number; count: number }
export interface SalesOrderTypeRow { type: string; count: number; revenue: number }
export interface SalesCashierRow {
  cashier: string
  orders: number
  revenue: number
  averageBill: number
  itemsSold: number
  discount: number
  voidedBills: number
  refundedBills: number
}
export interface ProductReportRow {
  name: string
  menuItemId?: string
  qty: number
  revenue: number
  discount?: number
  orders?: number
  averagePrice?: number
  category?: string
  popularityPct?: number
  revenuePct?: number
  quadrant?: string
  sharePct?: number
  cumulativePct?: number
  class?: string
}
export interface InventoryStockRow {
  name: string
  category: string
  currentStock: number
  unit: string
  minStock: number
  reorderLevel: number
  averageCost: number
  stockValue: number
  availability: boolean
  status: string
}
export interface EmployeePerformanceRow {
  employee: string
  orders: number
  revenue: number
  grossRevenue: number
  averageBill: number
  itemsSold: number
  averageItemsPerOrder: number
  discount: number
  voidedBills: number
  refundedBills: number
}
export interface ClosingZData {
  reportType: 'Z'
  generatedAt: string
  sales: {
    date: string
    grossRevenue: number
    netRevenue: number
    orders: number
    averageOrderValue: number
    discounts: number
    taxes: number
    payments: SalesPaymentRow[]
  }
  cash: {
    openingCash: number
    cashSales: number
    cashIn: number
    cashOut: number
    expenses: number
    adjustments: number
    expectedCash: number
    actualCash: number
    overShort: number
  }
  requiresManagerApproval: boolean
}
export interface MonthlySummaryRow {
  month: string
  totalRevenue: number
  totalOrders: number
  totalItemsSold: number
  averageOrderValue: number
  cashSales: number
}

// ─── API functions ───────────────────────────────────────────────

export async function getAdminSalesSummary(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<SalesSummaryData> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/sales-summary`, { params })
  return data.data
}

export async function getAdminSalesTrend(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<SalesTrendPoint[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/sales-trend`, { params })
  return data.data
}

export async function getAdminSalesPayments(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<SalesPaymentRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/sales-payments`, { params })
  return data.data
}

export async function getAdminSalesOrderTypes(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<SalesOrderTypeRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/sales-order-types`, { params })
  return data.data
}

export async function getAdminSalesCashiers(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<SalesCashierRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/sales-cashiers`, { params })
  return data.data
}

export async function getAdminProductTop(
  restaurantId: string,
  params: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<ProductReportRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/products-top`, { params })
  return data.data
}

export async function getAdminProductCategories(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<Array<{ category: string; qty: number; revenue: number }>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/products-categories`, { params })
  return data.data
}

export async function getAdminProductAbc(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<ProductReportRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/products-abc`, { params })
  return data.data
}

export async function getAdminInventoryStock(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<InventoryStockRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/inventory-stock`, { params })
  return data.data
}

export async function getAdminInventoryValuation(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<{ totalValue: number; itemCount: number; categories: Array<{ category: string; value: number; units: number }> }> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/inventory-valuation`, { params })
  return data.data
}

export async function getAdminEmployeePerformance(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<EmployeePerformanceRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/employees-performance`, { params })
  return data.data
}

export async function getAdminClosingZ(
  restaurantId: string,
  params: { date?: string } = {},
): Promise<ClosingZData> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/closing-z`, { params })
  return data.data
}

export async function getAdminSummariesMonthly(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<MonthlySummaryRow[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/reports/summaries-monthly`, { params })
  return data.data
}
