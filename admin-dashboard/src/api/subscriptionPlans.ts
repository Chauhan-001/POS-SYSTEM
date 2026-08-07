/**
 * API — Subscription Plans
 *
 * Full CRUD for subscription plans (tiers/price points).
 *
 * Endpoints:
 *   GET   /admin/subscription-plans      → getPlans()
 *   GET   /admin/subscription-plans/:id  → getPlan()
 *   POST  /admin/subscription-plans      → createPlan()
 *   PUT   /admin/subscription-plans/:id  → updatePlan()
 *   DELETE /admin/subscription-plans/:id → deletePlan()
 */

import apiClient from './client'
import type { SubscriptionPlan, PaginatedResponse } from '../types'

// ─── Types ────────────────────────────────────────────────

export interface PlanFilters {
  page?: number
  limit?: number
  active?: string
}

export async function getPlans(filters: PlanFilters = {}): Promise<PaginatedResponse<SubscriptionPlan>> {
  const { data } = await apiClient.get('/api/admin/subscription-plans', { params: filters })
  return data
}

export async function createPlan(payload: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
  const { data } = await apiClient.post('/api/admin/subscription-plans', payload)
  return data
}

export async function updatePlan(id: string, payload: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
  const { data } = await apiClient.put(`/api/admin/subscription-plans/${id}`, payload)
  return data
}

export async function deletePlan(id: string): Promise<void> {
  await apiClient.delete(`/api/admin/subscription-plans/${id}`)
}
