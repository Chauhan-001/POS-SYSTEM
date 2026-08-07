/**
 * =============================================================================
 *  crm.ts — Customer CRM API (Phase 1.6)
 * =============================================================================
 *
 * Endpoints (admin-authenticated, read-only platform console view):
 *   GET /admin/restaurants/:id/crm/overview           → getCrmOverview()
 *   GET /admin/restaurants/:id/crm/customers          → getCrmCustomers()
 *   GET /admin/restaurants/:id/crm/loyalty-settings   → getCrmLoyaltySettings()
 *   GET /admin/restaurants/:id/crm/tiers              → getCrmTiers()
 *   GET /admin/restaurants/:id/crm/campaigns          → getCrmCampaigns()
 *   GET /admin/restaurants/:id/crm/referrals          → getCrmReferrals()
 *   GET /admin/restaurants/:id/crm/report             → getCrmReport()
 *   GET /admin/restaurants/:id/crm/offers             → getCrmOffers()
 *   GET /admin/restaurants/:id/crm/rewards            → getCrmRewards()
 */

import apiClient from './client'

// ─── Types ───────────────────────────────────────────────────────

export interface CrmOverview {
  summary: Record<string, number>
  tierDistribution: Record<string, number>
  segmentDistribution: Array<{ name: string; type: string; customerCount: number }>
  topCustomers: Array<{
    phone: string; name: string; tier: string; totalSpend: number;
    averageSpend: number; visits: number; totalOrders: number;
    points: number; walletBalance: number; lastVisit?: string; isVip?: boolean
  }>
  growth: Array<{ month: string; newCustomers: number }>
  settings: Record<string, any>
  tiers: any[]
  campaigns: { total: number; recent: any[] }
  referrals: { total: number; recent: any[] }
  generatedAt: string
}

export interface CrmCustomer {
  id: string
  phone: string
  name: string
  email?: string
  tier?: string
  points?: number
  walletBalance?: number
  totalSpend?: number
  averageSpend?: number
  visits?: number
  totalOrders?: number
  lastVisit?: string
  status?: string
  isBlocked?: boolean
  isVip?: boolean
  referralCode?: string
  referralCount?: number
  createdAt?: string
}

export interface CrmPaginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  nextPage: number | null
  previousPage: number | null
}

// ─── Overview ────────────────────────────────────────────────────

export async function getCrmOverview(restaurantId: string): Promise<CrmOverview> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/overview`)
  return data.data
}

export async function getCrmCustomers(
  restaurantId: string,
  params: { page?: number; limit?: number; search?: string; tier?: string; status?: string } = {},
): Promise<CrmPaginated<CrmCustomer>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/customers`, { params })
  return data
}

export async function getCrmLoyaltySettings(restaurantId: string): Promise<Record<string, any>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/loyalty-settings`)
  return data.data
}

export async function getCrmTiers(restaurantId: string): Promise<any[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/tiers`)
  return data.data
}

export async function getCrmCampaigns(
  restaurantId: string,
  params: { page?: number; limit?: number; status?: string } = {},
): Promise<CrmPaginated<any>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/campaigns`, { params })
  return data
}

export async function getCrmReferrals(
  restaurantId: string,
  params: { page?: number; limit?: number; status?: string } = {},
): Promise<CrmPaginated<any>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/referrals`, { params })
  return data
}

export async function getCrmReport(restaurantId: string): Promise<Record<string, any>> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/report`)
  return data.data
}

export async function getCrmOffers(restaurantId: string): Promise<any[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/offers`)
  return data.data
}

export async function getCrmRewards(restaurantId: string): Promise<any[]> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/crm/rewards`)
  return data.data
}
