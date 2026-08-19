/**
 * =============================================================================
 *  subscriptions.ts — Subscription Management API
 * =============================================================================
 *
 * Endpoints:
 *   GET  /admin/subscriptions               → List all subscriptions
 *   GET  /admin/subscriptions/:id           → Get subscription details
 *   GET  /admin/restaurants/:id/subscription → Get by restaurant
 *   POST /admin/subscriptions/:id/renew     → Renew subscription
 *   POST /admin/subscriptions/:id/pause     → Pause subscription
 *   POST /admin/subscriptions/:id/resume    → Resume subscription
 *   PUT  /admin/subscriptions/:id/upgrade   → Upgrade plan
 *   PUT  /admin/subscriptions/:id/downgrade → Downgrade plan
 *   GET  /admin/restaurants/:id/payment-history → Payment history
 */

import apiClient from './client'
import type { Subscription, PaginatedResponse, SubscriptionUsage } from '../types'

// ─── Types ───────────────────────────────────────────────────────

export interface SubscriptionFilters {
  page?: number
  limit?: number
  search?: string
  status?: string
  plan?: string
}

export async function getSubscriptions(filters: SubscriptionFilters = {}): Promise<PaginatedResponse<Subscription>> {
  const { data } = await apiClient.get('/api/admin/subscriptions', { params: filters })
  return data
}

export async function getSubscription(id: string): Promise<Subscription> {
  const { data } = await apiClient.get(`/api/admin/subscriptions/${id}`)
  return data
}

export async function getSubscriptionByRestaurant(restaurantId: string): Promise<Subscription> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/subscription`)
  return data
}

/**
 * PUT /api/admin/restaurants/:id/subscription/features
 * Grant or revoke add-on features on the restaurant's CURRENT plan.
 * Grants apply immediately everywhere (server-side gates, POS status, admin UI)
 * and survive plan changes. Revoking a feature the plan itself includes has no effect.
 */
export async function updateGrantedFeatures(
  restaurantId: string,
  payload: { grant?: string[]; revoke?: string[] }
): Promise<Subscription> {
  const { data } = await apiClient.put(`/api/admin/restaurants/${restaurantId}/subscription/features`, payload)
  return data.subscription
}

export async function renewSubscription(id: string, payload?: { amount?: number; notes?: string; paymentMethod?: string; billingPeriod?: 'monthly' | 'yearly' }): Promise<any> {
  const { data } = await apiClient.post(`/api/admin/subscriptions/${id}/renew`, payload || {})
  return data
}

export async function pauseSubscription(id: string): Promise<Subscription> {
  const { data } = await apiClient.post(`/api/admin/subscriptions/${id}/pause`)
  return data
}

export async function resumeSubscription(id: string): Promise<Subscription> {
  const { data } = await apiClient.post(`/api/admin/subscriptions/${id}/resume`)
  return data
}

export async function upgradeSubscription(id: string, planId: string, billingPeriod?: 'monthly' | 'yearly'): Promise<any> {
  const { data } = await apiClient.put(`/api/admin/subscriptions/${id}/upgrade`, { plan: planId, billingPeriod })
  return data
}

export async function downgradeSubscription(id: string, planId: string, billingPeriod?: 'monthly' | 'yearly'): Promise<any> {
  const { data } = await apiClient.put(`/api/admin/subscriptions/${id}/downgrade`, { plan: planId, billingPeriod })
  return data
}

export interface PaymentHistoryFilters {
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentHistoryResponse {
  payments: any[];
  invoices: any[];
  totalPages: number;
  page: number;
  pageSize: number;
  paymentTotal: number;
  invoiceTotal: number;
}

export async function getSubscriptionPayments(
  restaurantId: string,
  filters?: PaymentHistoryFilters
): Promise<PaymentHistoryResponse> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/payment-history`, { params: filters })
  return data
}

export async function getSubscriptionUsage(restaurantId: string): Promise<SubscriptionUsage> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/subscription-usage`)
  return data
}
