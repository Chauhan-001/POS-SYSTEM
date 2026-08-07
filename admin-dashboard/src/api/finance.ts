/**
 * =============================================================================
 *  finance.ts — Restaurant Finance API (Phase 1.7)
 * =============================================================================
 *
 * Endpoints (admin-authenticated, read-only platform console view):
 *   GET /admin/restaurants/:id/finance/overview        → getFinanceOverview()
 *   GET /admin/restaurants/:id/finance/pnl             → getFinancePnl()
 *   GET /admin/restaurants/:id/finance/expenses        → getFinanceExpenses()
 *   GET /admin/restaurants/:id/finance/expense-register→ getFinanceExpenseRegister()
 *   GET /admin/restaurants/:id/finance/cashflow        → getFinanceCashFlow()
 *   GET /admin/restaurants/:id/finance/cash-ledger     → getFinanceCashLedger()
 *   GET /admin/restaurants/:id/finance/gst             → getFinanceGst()
 *   GET /admin/restaurants/:id/finance/vendors         → getFinanceVendors()
 *   GET /admin/restaurants/:id/finance/recurring       → getFinanceRecurring()
 *   GET /admin/restaurants/:id/finance/categories      → getFinanceCategories()
 *   GET /admin/restaurants/:id/finance/monthly         → getFinanceMonthly()
 *   GET /admin/restaurants/:id/finance/branches        → getFinanceBranches()
 */

import apiClient from './client'

// ─── Types ───────────────────────────────────────────────────────

export interface FinancePnlData {
  period: string
  startDate: string
  endDate: string
  revenue: number
  refunds: number
  discounts: number
  gstCollected: number
  orders: number
  cogs: number
  grossProfit: number
  operatingExpenses: number
  netProfit: number
  totalExpenses: number
  margin: number
  expenseByCategory: Record<string, { amount: number; count: number }>
}

export interface FinanceOverview {
  summary: {
    period: string
    startDate: string
    endDate: string
    pnl: { revenue: number; expenses: number; cogs: number; grossProfit: number; netProfit: number; margin: number; orders: number }
    cash: { balance: number; inflows: number; outflows: number; overShort: number }
    gst: { outputGst: number; inputGst: number; payable: number }
    vendorDues: { total: number; count: number }
    drawerBalance: number
  }
  monthly: { year: number; months: Array<{ month: number; label: string; revenue: number; expenses: number; netProfit: number; orders: number }> }
  vendorDues: { total: number; count: number }
  drawerBalance: number
  settings: Record<string, any>
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  nextPage: number | null
  previousPage: number | null
}

export interface ExpenseRow {
  id: string
  description: string
  category?: string
  categoryName?: string
  amount: number
  date: string
  paymentMethod: string
  vendorName?: string
  isCogs?: boolean
  status?: string
  isRecurring?: boolean
  branchId?: string
}

export interface VendorRow {
  id: string
  name: string
  gstin?: string
  phone?: string
  email?: string
  totalPaid: number
  outstanding: number
  expenseCount: number
  status: string
}

export interface CashLedgerRow {
  id: string
  type: string
  amount: number
  note?: string
  balanceAfter: number
  createdAt: string
  createdByName?: string
}

// ─── API functions ───────────────────────────────────────────────

export async function getFinanceOverview(restaurantId: string): Promise<FinanceOverview> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/overview`)
  return data.data
}

export async function getFinancePnl(
  restaurantId: string,
  params: { period?: string; startDate?: string; endDate?: string } = {},
): Promise<FinancePnlData> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/pnl`, { params })
  return data.data
}

export async function getFinanceExpenses(
  restaurantId: string,
  params: { page?: number; limit?: number; search?: string; category?: string; startDate?: string; endDate?: string } = {},
): Promise<Paginated<ExpenseRow>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/expenses`, { params })
  return data
}

export async function getFinanceExpenseRegister(
  restaurantId: string,
  params: { startDate?: string; endDate?: string; groupBy?: string } = {},
): Promise<any> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/expense-register`, { params })
  return data.data
}

export async function getFinanceCashFlow(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<any[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/cashflow`, { params })
  return data.data
}

export async function getFinanceCashLedger(
  restaurantId: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<CashLedgerRow>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/cash-ledger`, { params })
  return data
}

export async function getFinanceGst(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<any> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/gst`, { params })
  return data.data
}

export async function getFinanceVendors(
  restaurantId: string,
  params: { page?: number; limit?: number; search?: string } = {},
): Promise<Paginated<VendorRow>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/vendors`, { params })
  return data
}

export async function getFinanceRecurring(
  restaurantId: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<any>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/recurring`, { params })
  return data
}

export async function getFinanceCategories(restaurantId: string): Promise<any[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/categories`)
  return data.data
}

export async function getFinanceMonthly(restaurantId: string, year?: number): Promise<any> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/monthly`, {
    params: year ? { year } : {},
  })
  return data.data
}

export interface FinanceBranchComparison {
  startDate: string
  endDate: string
  branches: Array<{
    branchId: string
    revenue: number
    discounts: number
    orders: number
    expenses: number
    cogs: number
    operatingExpenses: number
    netProfit: number
  }>
}

export async function getFinanceBranches(
  restaurantId: string,
  params: { startDate?: string; endDate?: string } = {},
): Promise<FinanceBranchComparison> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/finance/branches`, { params })
  return data.data
}
